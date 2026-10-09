// Límites de tasa por hash de IP y topes globales diarios (docs/arquitectura.md §5.5).
// Ventana fija guardada en la tabla `limites` (clave = accion:sujeto:ventana).
import { ErrorApi } from './errores';
import { sha256Hex } from './ids';
import { MS_DIA, MS_HORA } from './tipos';

export type Accion = 'fotos' | 'propuestas' | 'eventos' | 'panel' | 'leer';

interface Regla {
  maximo: number;
  ventanaMs: number;
}

export const REGLAS_IP: Record<Accion, Regla> = {
  fotos: { maximo: 30, ventanaMs: MS_HORA },
  propuestas: { maximo: 10, ventanaMs: MS_HORA },
  eventos: { maximo: 60, ventanaMs: 60_000 },
  panel: { maximo: 30, ventanaMs: 60_000 },
  leer: { maximo: 120, ventanaMs: 60_000 },
};

export const TOPES_GLOBALES: Partial<Record<Accion, Regla>> = {
  fotos: { maximo: 500, ventanaMs: MS_DIA },
  propuestas: { maximo: 300, ventanaMs: MS_DIA },
};

let avisoSinSal = false;

/** Hash con sal de la IP; la IP en claro nunca se guarda ni se registra. */
export async function hashIp(req: Request, sal: string | undefined): Promise<string> {
  if (!sal && !avisoSinSal) {
    avisoSinSal = true;
    console.warn('SAL_IP no está configurada: usa `wrangler secret put SAL_IP` (o .dev.vars en local).');
  }
  const ip = req.headers.get('CF-Connecting-IP') ?? 'sin-ip';
  return sha256Hex(`${sal ?? ''}${ip}`);
}

/** Suma 1 al contador de la ventana actual y devuelve el valor resultante y los segundos hasta que termine. */
export async function incrementar(
  db: D1Database,
  accion: string,
  sujeto: string,
  regla: Regla,
  ahora: number,
): Promise<{ conteo: number; reintentarEn: number }> {
  const ventana = Math.floor(ahora / regla.ventanaMs);
  const finVentana = (ventana + 1) * regla.ventanaMs;
  const fila = await db
    .prepare(
      `INSERT INTO limites (clave, conteo, expira_en) VALUES (?1, 1, ?2)
       ON CONFLICT(clave) DO UPDATE SET conteo = conteo + 1
       RETURNING conteo`,
    )
    .bind(`${accion}:${sujeto}:${ventana}`, finVentana)
    .first<{ conteo: number }>();
  return { conteo: fila?.conteo ?? 1, reintentarEn: Math.max(1, Math.ceil((finVentana - ahora) / 1000)) };
}

/** Aplica el límite por IP (429) y, si existe, el tope global diario (503). */
export async function limitar(db: D1Database, accion: Accion, ipHash: string, ahora = Date.now()): Promise<void> {
  const regla = REGLAS_IP[accion];
  const porIp = await incrementar(db, accion, ipHash, regla, ahora);
  if (porIp.conteo > regla.maximo) {
    throw new ErrorApi(429, 'demasiadas_solicitudes', undefined, undefined, porIp.reintentarEn);
  }
  const tope = TOPES_GLOBALES[accion];
  if (tope) {
    const global = await incrementar(db, accion, 'global', tope, ahora);
    if (global.conteo > tope.maximo) throw new ErrorApi(503, 'capacidad_agotada');
  }
}
