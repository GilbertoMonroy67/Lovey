// IDs y claves aleatorias con crypto.getRandomValues y rechazo de sesgo (docs/arquitectura.md §5.8).
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// 62 * 4 = 248: los bytes >= 248 se descartan para que cada símbolo tenga la misma probabilidad.
const LIMITE_SIN_SESGO = 248;

export function base62(longitud: number): string {
  let salida = '';
  while (salida.length < longitud) {
    const bytes = crypto.getRandomValues(new Uint8Array(longitud * 2));
    for (const b of bytes) {
      if (b < LIMITE_SIN_SESGO) {
        salida += BASE62[b % 62];
        if (salida.length === longitud) break;
      }
    }
  }
  return salida;
}

export const nuevoIdPropuesta = () => base62(12);
export const nuevoIdFoto = () => `f_${base62(16)}`;
export const nuevaClaveAdmin = () => base62(32);
export const nuevoTemaNtfy = () => base62(32);

export async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparación en tiempo constante de dos cadenas (pensada para hashes hex de igual longitud). */
export function igualesTiempoConstante(a: string, b: string): boolean {
  let diferencia = a.length ^ b.length;
  const largo = Math.max(a.length, b.length);
  for (let i = 0; i < largo; i++) {
    diferencia |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diferencia === 0;
}
