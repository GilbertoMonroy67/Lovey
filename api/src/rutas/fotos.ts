// POST /fotos y GET /fotos/:id (docs/arquitectura.md §5.1 y D1).
// v2: las fotos llegan cifradas desde el navegador (AES-GCM); R2 solo guarda bytes ilegibles.
import { Hono } from 'hono';
import { LIMITES, PATRONES } from '../../../js/limites.js';
import { iso, urlFoto } from '../comun';
import { ErrorApi } from '../errores';
import { nuevoIdFoto } from '../ids';
import { hashIp, limitar } from '../limite-tasa';
import { MS_HORA, type AppEnv } from '../tipos';

/** Detecta el tipo real por los bytes mágicos: JPEG (FF D8 FF) o WebP (RIFF....WEBP). */
export function detectarTipo(b: Uint8Array): 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' &&
    String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const MUY_GRANDE = 'La foto pesa demasiado (máximo 500 KB).';
const TIPO_CIFRADO = 'application/octet-stream';
// 1 byte de versión + 12 de IV + 16 de etiqueta GCM + al menos 1 byte de foto (ver js/cifrado.js).
const MINIMO_CIFRADO = 30;
const VERSION_CIFRADO = 1;

export const rutasFotos = new Hono<AppEnv>();

rutasFotos.post('/', async (c) => {
  const ahora = Date.now();
  const ipHash = await hashIp(c.req.raw, c.env.SAL_IP);
  await limitar(c.env.DB, 'fotos', ipHash, ahora);

  const declarado = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (declarado !== TIPO_CIFRADO) throw new ErrorApi(415, 'tipo_no_soportado');
  if (Number(c.req.header('Content-Length') ?? '0') > LIMITES.fotoCifradaBytes) {
    throw new ErrorApi(413, 'archivo_muy_grande', MUY_GRANDE);
  }

  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > LIMITES.fotoCifradaBytes) throw new ErrorApi(413, 'archivo_muy_grande', MUY_GRANDE);
  // Sin la llave no se puede comprobar el contenido; sí la forma del sobre cifrado.
  // Una imagen en claro (JPEG/WebP reconocible) se rechaza: la app siempre cifra antes de subir.
  if (bytes.byteLength < MINIMO_CIFRADO || bytes[0] !== VERSION_CIFRADO || detectarTipo(bytes)) {
    throw new ErrorApi(415, 'tipo_no_soportado');
  }

  const id = nuevoIdFoto();
  const r2Clave = `fotos/${id}`;
  await c.env.FOTOS.put(r2Clave, bytes, { httpMetadata: { contentType: TIPO_CIFRADO } });
  try {
    await c.env.DB.prepare(
      'INSERT INTO fotos (id, propuesta_id, r2_clave, tipo_mime, bytes, ip_hash, creada_en) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6)',
    )
      .bind(id, r2Clave, TIPO_CIFRADO, bytes.byteLength, ipHash, ahora)
      .run();
  } catch (e) {
    await c.env.FOTOS.delete(r2Clave); // no dejar objetos sin fila
    throw e;
  }

  return c.json(
    { id, url: urlFoto(c.req.raw, id), expiraEn: iso(ahora + LIMITES.horasFotoHuerfana * MS_HORA) },
    201,
  );
});

rutasFotos.get('/:id', async (c) => {
  const id = c.req.param('id');
  const ahora = Date.now();
  if (!PATRONES.idFoto.test(id)) throw new ErrorApi(404, 'no_encontrado', 'Esta foto no existe.');

  const fila = await c.env.DB.prepare(
    `SELECT f.r2_clave, f.tipo_mime, f.creada_en, f.propuesta_id, p.expira_en
       FROM fotos f LEFT JOIN propuestas p ON p.id = f.propuesta_id
      WHERE f.id = ?1`,
  )
    .bind(id)
    .first<{ r2_clave: string; tipo_mime: string; creada_en: number; propuesta_id: string | null; expira_en: number | null }>();

  const vigente =
    fila &&
    (fila.propuesta_id === null
      ? fila.creada_en + LIMITES.horasFotoHuerfana * MS_HORA > ahora
      : (fila.expira_en ?? 0) > ahora);
  if (!fila || !vigente) throw new ErrorApi(404, 'no_encontrado', 'Esta foto no existe.');

  const objeto = await c.env.FOTOS.get(fila.r2_clave);
  if (!objeto) throw new ErrorApi(404, 'no_encontrado', 'Esta foto no existe.');

  return new Response(objeto.body, {
    status: 200,
    headers: {
      'Content-Type': fila.tipo_mime,
      'Content-Length': String(objeto.size),
      // private: navegadores sí, cachés compartidas (proxies) no; son fotos personales.
      'Cache-Control': 'private, max-age=86400',
      // El frontend la descarga con fetch (CORS) y la descifra; nunca se muestra directo desde la API.
      'Content-Disposition': 'attachment',
      ETag: objeto.httpEtag,
    },
  });
});
