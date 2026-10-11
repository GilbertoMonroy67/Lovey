// POST /propuestas, GET /propuestas/:id y DELETE /propuestas/:id (docs/arquitectura.md §3 y §5.1).
// v2: el contenido llega cifrado de extremo a extremo; el servidor guarda el sobre tal cual.
import { Hono } from 'hono';
import { LIMITES } from '../../../js/limites.js';
import { cargarPropuesta, iso, urlFoto, verificarAdmin } from '../comun';
import { ErrorApi } from '../errores';
import { esCifrada, esquemaPropuesta, leerJson, validar, type DatosPropuesta, type DatosPropuestaV2 } from '../esquemas';
import { nuevaClaveAdmin, nuevoIdPropuesta, nuevoTemaNtfy, sha256Hex } from '../ids';
import { hashIp, limitar } from '../limite-tasa';
import { exigirHumano } from '../turnstile';
import { MS_DIA, MS_HORA, type AppEnv } from '../tipos';

export const rutasPropuestas = new Hono<AppEnv>();

rutasPropuestas.post('/', async (c) => {
  const ahora = Date.now();
  const ipHash = await hashIp(c.req.raw, c.env.SAL_IP);
  await limitar(c.env.DB, 'propuestas', ipHash, ahora);
  await exigirHumano(c.req.raw, c.env.TURNSTILE_SECRETO);

  const { avisos, ...sobre } = validar(esquemaPropuesta, await leerJson(c.req.raw));
  // Se arma explícitamente: solo estos campos llegan a D1.
  const datos: DatosPropuestaV2 = { v: sobre.v, cifrado: sobre.cifrado, fotos: sobre.fotos };
  const idsFotos = datos.fotos;

  // Cada foto debe existir, estar libre (huérfana) y no haber expirado.
  if (idsFotos.length) {
    const marcadores = idsFotos.map((_, i) => `?${i + 1}`).join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT id, propuesta_id, creada_en FROM fotos WHERE id IN (${marcadores})`,
    )
      .bind(...idsFotos)
      .all<{ id: string; propuesta_id: string | null; creada_en: number }>();
    const limiteHuerfana = ahora - LIMITES.horasFotoHuerfana * MS_HORA;
    const validas = new Set(
      results.filter((f) => f.propuesta_id === null && f.creada_en > limiteHuerfana).map((f) => f.id),
    );
    const invalidas = idsFotos.filter((id) => !validas.has(id));
    if (invalidas.length) {
      throw new ErrorApi(422, 'foto_invalida', undefined, invalidas.map((id) => ({ campo: `fotos.${id}`, mensaje: 'Foto inexistente, ya usada o expirada.' })));
    }
  }

  const id = nuevoIdPropuesta();
  const claveAdmin = nuevaClaveAdmin();
  const ntfyTema = avisos.push ? nuevoTemaNtfy() : null;
  const expiraEn = ahora + LIMITES.diasExpiracion * MS_DIA;

  const sentencias = [
    c.env.DB.prepare(
      'INSERT INTO propuestas (id, clave_hash, datos, ntfy_tema, usuario_id, creada_en, expira_en) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)',
    ).bind(id, await sha256Hex(claveAdmin), JSON.stringify(datos), ntfyTema, ahora, expiraEn),
  ];
  if (idsFotos.length) {
    const marcadores = idsFotos.map((_, i) => `?${i + 2}`).join(',');
    sentencias.push(
      c.env.DB.prepare(`UPDATE fotos SET propuesta_id = ?1 WHERE propuesta_id IS NULL AND id IN (${marcadores})`).bind(
        id,
        ...idsFotos,
      ),
    );
  }
  const resultados = await c.env.DB.batch(sentencias);

  // Carrera improbable: otra propuesta tomó alguna foto entre la verificación y la asociación. Se deshace.
  if (idsFotos.length && (resultados[1]?.meta.changes ?? 0) !== idsFotos.length) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE fotos SET propuesta_id = NULL WHERE propuesta_id = ?1').bind(id),
      c.env.DB.prepare('DELETE FROM propuestas WHERE id = ?1').bind(id),
    ]);
    throw new ErrorApi(422, 'foto_invalida');
  }

  return c.json({ id, claveAdmin, expiraEn: iso(expiraEn), ntfyTema }, 201);
});

/**
 * Arma la respuesta pública de §3.2 con solo lo necesario: nunca el hash de la clave, el tema de ntfy
 * ni datos de las fotos más allá de su id y su URL.
 */
export function propuestaPublica(req: Request, id: string, datos: DatosPropuesta, creada: number, expira: number) {
  if (esCifrada(datos)) {
    return {
      v: datos.v,
      id,
      cifrado: datos.cifrado,
      fotos: datos.fotos.map((f) => ({ id: f, url: urlFoto(req, f) })),
      creadaEn: iso(creada),
      expiraEn: iso(expira),
    };
  }
  const { v, ...resto } = datos;
  return {
    v,
    id,
    ...resto,
    pasos: datos.pasos.map((p) => ({
      texto: p.texto,
      fotos: p.fotos.map((f) => ({ id: f.id, url: urlFoto(req, f.id), alt: f.alt })),
    })),
    creadaEn: iso(creada),
    expiraEn: iso(expira),
  };
}

rutasPropuestas.get('/:id', async (c) => {
  const ahora = Date.now();
  await limitar(c.env.DB, 'leer', await hashIp(c.req.raw, c.env.SAL_IP), ahora);
  const { fila, datos } = await cargarPropuesta(c.env.DB, c.req.param('id'), ahora);
  return c.json(propuestaPublica(c.req.raw, fila.id, datos, fila.creada_en, fila.expira_en));
});

/** Borra fotos en R2 y después la propuesta (el CASCADE limpia fotos y eventos en D1). */
export async function borrarPropuesta(env: Env, id: string): Promise<void> {
  const { results } = await env.DB.prepare('SELECT r2_clave FROM fotos WHERE propuesta_id = ?1')
    .bind(id)
    .all<{ r2_clave: string }>();
  if (results.length) await env.FOTOS.delete(results.map((f) => f.r2_clave));
  await env.DB.prepare('DELETE FROM propuestas WHERE id = ?1').bind(id).run();
}

rutasPropuestas.delete('/:id', async (c) => {
  const ahora = Date.now();
  await limitar(c.env.DB, 'panel', await hashIp(c.req.raw, c.env.SAL_IP), ahora);
  // Se permite borrar aunque haya expirado (aún no la limpió el cron).
  const { fila } = await cargarPropuesta(c.env.DB, c.req.param('id'), ahora, true);
  await verificarAdmin(c.req.raw, fila);
  await borrarPropuesta(c.env, fila.id);
  return c.body(null, 204);
});
