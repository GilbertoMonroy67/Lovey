// Utilidades compartidas por las rutas: carga de propuestas, autenticación admin y URLs de fotos.
import { PATRONES } from '../../js/limites.js';
import { ErrorApi } from './errores';
import type { DatosPropuesta } from './esquemas';
import { igualesTiempoConstante, sha256Hex } from './ids';
import { PREFIJO_API } from './tipos';

export interface FilaPropuesta {
  id: string;
  clave_hash: string;
  datos: string;
  ntfy_tema: string | null;
  creada_en: number;
  expira_en: number;
}

export interface PropuestaCargada {
  fila: FilaPropuesta;
  datos: DatosPropuesta;
}

/**
 * Busca la propuesta por id. 404 si el id no tiene el formato o no existe;
 * 410 si ya expiró y `permitirExpirada` es falso.
 */
export async function cargarPropuesta(
  db: D1Database,
  id: string,
  ahora: number,
  permitirExpirada = false,
): Promise<PropuestaCargada> {
  if (!PATRONES.idPropuesta.test(id)) throw new ErrorApi(404, 'no_encontrado', 'Esta propuesta no existe.');
  const fila = await db
    .prepare('SELECT id, clave_hash, datos, ntfy_tema, creada_en, expira_en FROM propuestas WHERE id = ?1')
    .bind(id)
    .first<FilaPropuesta>();
  if (!fila) throw new ErrorApi(404, 'no_encontrado', 'Esta propuesta no existe.');
  if (!permitirExpirada && fila.expira_en <= ahora) throw new ErrorApi(410, 'expirada');
  return { fila, datos: JSON.parse(fila.datos) as DatosPropuesta };
}

/** Verifica `Authorization: Bearer <claveAdmin>` contra el hash guardado, en tiempo constante. */
export async function verificarAdmin(req: Request, fila: FilaPropuesta): Promise<void> {
  const cabecera = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(\S{1,200})$/i.exec(cabecera.trim());
  // Se calcula el hash aunque falte la clave para no revelar diferencias de tiempo.
  const hash = await sha256Hex(m?.[1] ?? '');
  if (!m || !igualesTiempoConstante(hash, fila.clave_hash)) throw new ErrorApi(401, 'no_autorizado');
}

export function urlFoto(req: Request, idFoto: string): string {
  return `${new URL(req.url).origin}${PREFIJO_API}/fotos/${idFoto}`;
}

export const iso = (ms: number) => new Date(ms).toISOString();
