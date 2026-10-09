// Limpieza programada (cron diario, docs/arquitectura.md §5.6).
import { LIMITES } from '../../js/limites.js';
import { borrarPropuesta } from './rutas/propuestas';
import { MS_HORA } from './tipos';

const LOTE = 100;

export interface ResultadoLimpieza {
  propuestas: number;
  fotosHuerfanas: number;
  limites: number;
}

export async function limpiar(env: Env, ahora = Date.now()): Promise<ResultadoLimpieza> {
  const resultado: ResultadoLimpieza = { propuestas: 0, fotosHuerfanas: 0, limites: 0 };

  // 1. Propuestas expiradas, con sus fotos (R2 + D1) y eventos.
  for (;;) {
    const { results } = await env.DB.prepare('SELECT id FROM propuestas WHERE expira_en <= ?1 LIMIT ?2')
      .bind(ahora, LOTE)
      .all<{ id: string }>();
    for (const { id } of results) await borrarPropuesta(env, id);
    resultado.propuestas += results.length;
    if (results.length < LOTE) break;
  }

  // 2. Fotos huérfanas de más de 24 h.
  const limiteHuerfana = ahora - LIMITES.horasFotoHuerfana * MS_HORA;
  for (;;) {
    const { results } = await env.DB.prepare(
      'SELECT id, r2_clave FROM fotos WHERE propuesta_id IS NULL AND creada_en <= ?1 LIMIT ?2',
    )
      .bind(limiteHuerfana, LOTE)
      .all<{ id: string; r2_clave: string }>();
    if (results.length) {
      await env.FOTOS.delete(results.map((f) => f.r2_clave));
      const marcadores = results.map((_, i) => `?${i + 1}`).join(',');
      await env.DB.prepare(`DELETE FROM fotos WHERE propuesta_id IS NULL AND id IN (${marcadores})`)
        .bind(...results.map((f) => f.id))
        .run();
    }
    resultado.fotosHuerfanas += results.length;
    if (results.length < LOTE) break;
  }

  // 3. Contadores de límites de tasa vencidos.
  const r = await env.DB.prepare('DELETE FROM limites WHERE expira_en <= ?1').bind(ahora).run();
  resultado.limites = r.meta.changes ?? 0;

  console.log('limpieza', resultado);
  return resultado;
}
