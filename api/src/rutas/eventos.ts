// POST y GET /propuestas/:id/eventos (docs/arquitectura.md §4 y §5.2).
import { Hono } from 'hono';
import { LIMITES } from '../../../js/limites.js';
import { cargarPropuesta, iso, verificarAdmin } from '../comun';
import { ErrorApi } from '../errores';
import { esquemaEvento, leerJson, validar, type DatosPropuesta } from '../esquemas';
import { hashIp, limitar } from '../limite-tasa';
import { construirAviso, publicarNtfy } from '../ntfy';
import type { AppEnv } from '../tipos';

const POR_PAGINA = 100;

interface FilaEvento {
  id: number;
  tipo: 'abierto' | 'intento_no' | 'si' | 'celebracion_elegida';
  datos: string | null;
  sesion: string;
  creado_en: number;
}

const etiquetaDe = (datos: DatosPropuesta, opcionId: string) =>
  datos.celebracion?.opciones.find((o) => o.id === opcionId)?.etiqueta ?? null;

export const rutasEventos = new Hono<AppEnv>();

rutasEventos.post('/:id/eventos', async (c) => {
  const ahora = Date.now();
  await limitar(c.env.DB, 'eventos', await hashIp(c.req.raw, c.env.SAL_IP), ahora);
  const { fila, datos } = await cargarPropuesta(c.env.DB, c.req.param('id'), ahora);
  const evento = validar(esquemaEvento, await leerJson(c.req.raw));

  let extra: Record<string, unknown> | null = null;
  if (evento.tipo === 'intento_no') extra = { conteo: evento.conteo };
  if (evento.tipo === 'celebracion_elegida') {
    if (!etiquetaDe(datos, evento.opcionId)) {
      throw new ErrorApi(422, 'validacion', undefined, [
        { campo: 'opcionId', mensaje: 'La opción no existe en esta propuesta.' },
      ]);
    }
    extra = { opcionId: evento.opcionId, nota: evento.nota || null };
  }

  const cuenta = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(tipo = 'si'), 0) AS si,
            COALESCE(SUM(tipo = 'celebracion_elegida'), 0) AS celebraciones
       FROM eventos WHERE propuesta_id = ?1`,
  )
    .bind(fila.id)
    .first<{ total: number; si: number; celebraciones: number }>();

  // Un "si" repetido es idempotente: no cuenta contra el tope y no crea otra fila.
  if (evento.tipo === 'si' && (cuenta?.si ?? 0) > 0) return c.json({ ok: true, duplicado: true }, 200);
  if ((cuenta?.total ?? 0) >= LIMITES.eventosPorPropuesta) throw new ErrorApi(409, 'limite_eventos');
  if (evento.tipo === 'celebracion_elegida' && (cuenta?.celebraciones ?? 0) >= LIMITES.celebracionesPorPropuesta) {
    throw new ErrorApi(409, 'limite_eventos');
  }

  const r = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO eventos (propuesta_id, tipo, datos, sesion, creado_en) VALUES (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(fila.id, evento.tipo, extra ? JSON.stringify(extra) : null, evento.sesion, ahora)
    .run();
  // El índice único parcial cubre la carrera de dos "si" simultáneos.
  if (r.meta.changes === 0) return c.json({ ok: true, duplicado: true }, 200);

  if (fila.ntfy_tema) {
    const aviso = construirAviso(
      evento.tipo,
      datos.para,
      evento.tipo === 'celebracion_elegida' ? etiquetaDe(datos, evento.opcionId) : null,
    );
    if (aviso) c.executionCtx.waitUntil(publicarNtfy(c.env.NTFY_BASE, fila.ntfy_tema, aviso));
  }

  return c.json({ ok: true }, 202);
});

/** Convierte una fila al formato de §5.2. */
function eventoPublico(e: FilaEvento, datos: DatosPropuesta) {
  const base = { id: e.id, tipo: e.tipo, sesion: e.sesion, creadoEn: iso(e.creado_en) };
  const extra = e.datos ? (JSON.parse(e.datos) as Record<string, unknown>) : {};
  if (e.tipo === 'intento_no') return { ...base, conteo: Number(extra.conteo ?? 0) };
  if (e.tipo === 'celebracion_elegida') {
    const opcionId = String(extra.opcionId ?? '');
    return { ...base, opcionId, etiqueta: etiquetaDe(datos, opcionId), nota: (extra.nota as string | null) ?? null };
  }
  return base;
}

type EventoPublico = ReturnType<typeof eventoPublico>;

export function calcularResumen(eventos: EventoPublico[]) {
  const resumen = {
    abierto: false,
    vecesAbierto: 0,
    primeraApertura: null as string | null,
    intentosNo: 0,
    si: false,
    siEn: null as string | null,
    celebracion: null as null | { opcionId: string; etiqueta: string | null; nota: string | null; en: string },
  };
  for (const e of eventos) {
    if (e.tipo === 'abierto') {
      resumen.abierto = true;
      resumen.vecesAbierto++;
      resumen.primeraApertura ??= e.creadoEn;
    } else if (e.tipo === 'intento_no' && 'conteo' in e) {
      resumen.intentosNo += e.conteo;
    } else if (e.tipo === 'si') {
      resumen.si = true;
      resumen.siEn ??= e.creadoEn;
    } else if (e.tipo === 'celebracion_elegida' && 'opcionId' in e) {
      // La última elección es la que cuenta.
      resumen.celebracion = { opcionId: e.opcionId, etiqueta: e.etiqueta, nota: e.nota, en: e.creadoEn };
    }
  }
  return resumen;
}

rutasEventos.get('/:id/eventos', async (c) => {
  const ahora = Date.now();
  await limitar(c.env.DB, 'panel', await hashIp(c.req.raw, c.env.SAL_IP), ahora);
  const { fila, datos } = await cargarPropuesta(c.env.DB, c.req.param('id'), ahora);
  await verificarAdmin(c.req.raw, fila);

  const desdeTexto = c.req.query('desde') ?? '0';
  if (!/^\d{1,15}$/.test(desdeTexto)) {
    throw new ErrorApi(422, 'validacion', undefined, [{ campo: 'desde', mensaje: 'Debe ser un entero mayor o igual a 0.' }]);
  }
  const desde = Number(desdeTexto);

  // Como máximo 300 filas por propuesta: se leen todas para el resumen y se pagina en memoria.
  const { results } = await c.env.DB.prepare(
    'SELECT id, tipo, datos, sesion, creado_en FROM eventos WHERE propuesta_id = ?1 ORDER BY id ASC',
  )
    .bind(fila.id)
    .all<FilaEvento>();
  const todos = results.map((e) => eventoPublico(e, datos));
  const pagina = todos.filter((e) => e.id > desde).slice(0, POR_PAGINA);

  return c.json({
    eventos: pagina,
    cursor: pagina.length ? pagina[pagina.length - 1]!.id : desde,
    resumen: calcularResumen(todos),
    para: datos.para,
    expiraEn: iso(fila.expira_en),
    ntfyTema: fila.ntfy_tema,
  });
});
