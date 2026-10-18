// Límites de tasa por hash de IP y topes globales diarios (docs/arquitectura.md §5.5 y §15.3).
// Ventana fija guardada en la tabla `limites` (clave = accion:sujeto:ventana).
//
// Piezas separadas a propósito (auditoría 2026-10-18, H1, y contrato v2.2):
//  - limitarIp(): frena a cada cliente (429). Va al principio de la ruta.
//  - consumirCupoDiarioIp(): solo el cupo diario por IP; POST /fotos lo gasta después de validar (§15.3).
//  - consumirTopeGlobal(): gasta el cupo diario compartido por todos (503). Va al final, solo cuando la
//    solicitud ya pasó Turnstile (o el boleto) y las validaciones.
// Todos los contadores son condicionales (v2.2): por encima del máximo la sentencia no escribe en D1.
import { ErrorApi } from './errores';
import { sha256Hex } from './ids';
import { MS_DIA, MS_HORA } from './tipos';

export type Accion = 'fotos' | 'propuestas' | 'eventos' | 'panel' | 'leer' | 'boletos';

export interface Regla {
  maximo: number;
  ventanaMs: number;
}

/** Límite corto por IP (por hora o por minuto). `fotos` no tiene: con 3 al día sobra (§15.3). */
export const REGLAS_IP: Partial<Record<Accion, Regla>> = {
  propuestas: { maximo: 10, ventanaMs: MS_HORA },
  boletos: { maximo: 10, ventanaMs: MS_HORA },
  eventos: { maximo: 60, ventanaMs: 60_000 },
  panel: { maximo: 30, ventanaMs: 60_000 },
  leer: { maximo: 120, ventanaMs: 60_000 },
};

/**
 * Límite diario por IP (ventana = día UTC), además del corto (auditoría 2026-10-18, H2; v2.2 §15).
 * `fotos`: 3 al día por IP (decisión del usuario), contado solo con subidas ya validadas.
 */
export const REGLAS_IP_DIARIAS: Partial<Record<Accion, Regla>> = {
  fotos: { maximo: 3, ventanaMs: MS_DIA },
  propuestas: { maximo: 20, ventanaMs: MS_DIA },
  boletos: { maximo: 20, ventanaMs: MS_DIA },
};

export const TOPES_GLOBALES: Partial<Record<Accion, Regla>> = {
  fotos: { maximo: 500, ventanaMs: MS_DIA },
  propuestas: { maximo: 300, ventanaMs: MS_DIA },
};

const HEX4 = /^[0-9a-f]{1,4}$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Convierte "a.b.c.d" en dos grupos hexadecimales de IPv6, o null si no es una IPv4 válida. */
function ipv4AGrupos(texto: string): [string, string] | null {
  const m = IPV4.exec(texto);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return [((o[0]! << 8) | o[1]!).toString(16), ((o[2]! << 8) | o[3]!).toString(16)];
}

/** Expande una IPv6 (con o sin `::` y con IPv4 incrustada al final) a sus 8 grupos numéricos, o null si no es válida. */
function expandirIpv6(texto: string): number[] | null {
  const partes = texto.split('::');
  if (partes.length > 2) return null;
  const aGrupos = (s: string): string[] | null => {
    if (s === '') return [];
    const grupos = s.split(':');
    const ultimo = grupos[grupos.length - 1]!;
    if (ultimo.includes('.')) {
      const v4 = ipv4AGrupos(ultimo);
      if (!v4) return null;
      grupos.splice(grupos.length - 1, 1, ...v4);
    }
    return grupos;
  };
  const cabeza = aGrupos(partes[0]!);
  const cola = partes.length === 2 ? aGrupos(partes[1]!) : [];
  if (!cabeza || !cola) return null;
  // Una IPv4 incrustada solo puede ir al final de la dirección.
  if (partes.length === 2 && partes[0]!.includes('.')) return null;
  let grupos: string[];
  if (partes.length === 2) {
    const faltan = 8 - cabeza.length - cola.length;
    if (faltan < 1) return null;
    grupos = [...cabeza, ...Array<string>(faltan).fill('0'), ...cola];
  } else {
    grupos = cabeza;
  }
  if (grupos.length !== 8 || !grupos.every((g) => HEX4.test(g))) return null;
  return grupos.map((g) => parseInt(g, 16));
}

/**
 * Sujeto del límite de tasa a partir de la IP:
 *  - IPv4: tal cual.
 *  - IPv4 mapeada en IPv6 (`::ffff:a.b.c.d` o `::ffff:xxxx:yyyy`): como la IPv4.
 *  - IPv6: su prefijo /64 (un cliente suele tener un /64 completo; contar por dirección daría IPs ilimitadas).
 *  - Cualquier otra cosa: el texto tal cual (falla cerrada: no se agrupa con nadie más).
 */
export function normalizarIp(crudo: string): string {
  let ip = crudo.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  if (!ip.includes(':')) return ip;
  ip = ip.replace(/%.*$/, ''); // identificador de zona (fe80::1%eth0)
  const g = expandirIpv6(ip);
  if (!g) return crudo;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return `${g[6]! >> 8}.${g[6]! & 0xff}.${g[7]! >> 8}.${g[7]! & 0xff}`;
  }
  return `${g
    .slice(0, 4)
    .map((n) => n.toString(16).padStart(4, '0'))
    .join(':')}::/64`;
}

let avisoSinSal = false;

/** Hash con sal de la IP (IPv6 agrupada por /64); la IP en claro nunca se guarda ni se registra. */
export async function hashIp(req: Request, sal: string | undefined): Promise<string> {
  if (!sal && !avisoSinSal) {
    avisoSinSal = true;
    console.warn('SAL_IP no está configurada: usa `wrangler secret put SAL_IP` (o .dev.vars en local).');
  }
  const ip = normalizarIp(req.headers.get('CF-Connecting-IP') ?? 'sin-ip');
  return sha256Hex(`${sal ?? ''}${ip}`);
}

/**
 * Suma 1 al contador `clave` solo si todavía no llegó a `maximo` (§15.3). Devuelve el valor nuevo, o
 * `conteo: null` si el límite ya estaba alcanzado: en ese caso la sentencia no modifica filas
 * (`escritas === 0`) y el valor guardado nunca supera el máximo.
 */
export async function sumarSiCabe(
  db: D1Database,
  clave: string,
  expiraEn: number,
  maximo: number,
): Promise<{ conteo: number | null; escritas: number }> {
  const r = await db
    .prepare(
      `INSERT INTO limites (clave, conteo, expira_en) VALUES (?1, 1, ?2)
       ON CONFLICT(clave) DO UPDATE SET conteo = conteo + 1 WHERE conteo < ?3
       RETURNING conteo`,
    )
    .bind(clave, expiraEn, maximo)
    .run<{ conteo: number }>();
  return { conteo: r.results[0]?.conteo ?? null, escritas: r.meta.rows_written ?? 0 };
}

/** Contador de ventana fija: `permitido` es falso si ya estaba en el máximo (y entonces no escribe). */
export async function incrementar(
  db: D1Database,
  accion: string,
  sujeto: string,
  regla: Regla,
  ahora: number,
): Promise<{ permitido: boolean; reintentarEn: number }> {
  const ventana = Math.floor(ahora / regla.ventanaMs);
  const finVentana = (ventana + 1) * regla.ventanaMs;
  const { conteo } = await sumarSiCabe(db, `${accion}:${sujeto}:${ventana}`, finVentana, regla.maximo);
  return { permitido: conteo !== null, reintentarEn: Math.max(1, Math.ceil((finVentana - ahora) / 1000)) };
}

/**
 * Cupo diario por IP de la acción (si existe), con clave propia `accion:dia` para no mezclar la ventana
 * diaria con la horaria. Lanza 429 con Retry-After hasta las 00:00 UTC.
 */
export async function consumirCupoDiarioIp(db: D1Database, accion: Accion, ipHash: string, ahora = Date.now()): Promise<void> {
  const diaria = REGLAS_IP_DIARIAS[accion];
  if (!diaria) return;
  const dia = await incrementar(db, `${accion}:dia`, ipHash, diaria, ahora);
  if (!dia.permitido) throw new ErrorApi(429, 'demasiadas_solicitudes', undefined, undefined, dia.reintentarEn);
}

/**
 * Lanza 429 (Retry-After hasta las 00:00 UTC) si el cupo diario por IP ya está lleno. Solo lee (un SELECT):
 * así, con el cupo agotado, ninguna solicitud vuelve a escribir en D1 (auditoría v2.2, H6).
 */
export async function rechazarSiCupoDiarioLleno(db: D1Database, accion: Accion, ipHash: string, ahora = Date.now()): Promise<void> {
  const diaria = REGLAS_IP_DIARIAS[accion];
  if (!diaria) return;
  const ventana = Math.floor(ahora / diaria.ventanaMs);
  const fila = await db
    .prepare('SELECT conteo FROM limites WHERE clave = ?1')
    .bind(`${accion}:dia:${ipHash}:${ventana}`)
    .first<{ conteo: number }>();
  if (fila && fila.conteo >= diaria.maximo) {
    const reintentarEn = Math.max(1, Math.ceil(((ventana + 1) * diaria.ventanaMs - ahora) / 1000));
    throw new ErrorApi(429, 'demasiadas_solicitudes', undefined, undefined, reintentarEn);
  }
}

/**
 * Límite por IP: primero se consulta (sin escribir) si el cupo diario ya está lleno; después el corto
 * (hora/minuto), si existe, y el diario, ambos con incremento condicional por si hay carreras.
 * Lanza 429 con Retry-After.
 */
export async function limitarIp(db: D1Database, accion: Accion, ipHash: string, ahora = Date.now()): Promise<void> {
  await rechazarSiCupoDiarioLleno(db, accion, ipHash, ahora);
  const regla = REGLAS_IP[accion];
  if (regla) {
    const corto = await incrementar(db, accion, ipHash, regla, ahora);
    if (!corto.permitido) throw new ErrorApi(429, 'demasiadas_solicitudes', undefined, undefined, corto.reintentarEn);
  }
  await consumirCupoDiarioIp(db, accion, ipHash, ahora);
}

/** Gasta una unidad del tope global diario de la acción (si existe). Lanza 503 `capacidad_agotada`. */
export async function consumirTopeGlobal(db: D1Database, accion: Accion, ahora = Date.now()): Promise<void> {
  const tope = TOPES_GLOBALES[accion];
  if (!tope) return;
  const global = await incrementar(db, accion, 'global', tope, ahora);
  if (!global.permitido) throw new ErrorApi(503, 'capacidad_agotada');
}

/**
 * Límite por IP + tope global en un solo paso. Solo para rutas en las que no hay nada que validar
 * antes de gastar el cupo; `POST /fotos` y `POST /propuestas` usan las piezas por separado.
 */
export async function limitar(db: D1Database, accion: Accion, ipHash: string, ahora = Date.now()): Promise<void> {
  await limitarIp(db, accion, ipHash, ahora);
  await consumirTopeGlobal(db, accion, ahora);
}
