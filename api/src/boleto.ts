// Boleto de subida (contrato v2.2, docs/arquitectura.md §15.1–§15.4).
// POST /boletos lo entrega tras pasar Turnstile; vale para LIMITES.fotosPorBoleto fotos y 1 propuesta
// durante LIMITES.minutosBoleto minutos. Formato: `b1.<P>.<F>`, con P = base64url del JSON
// {"v":1,"n":<16 base62>,"exp":<s>,"f":<cupo>} y F = base64url(HMAC-SHA256(llave, "b1." + P)).
// La llave se deriva de SAL_IP con HKDF (§15.2): no hay secreto nuevo.
import { LIMITES } from '../../js/limites.js';
import { iso } from './comun';
import { ErrorApi } from './errores';
import { base62 } from './ids';
import { sumarSiCabe } from './limite-tasa';

export const CABECERA_BOLETO = 'X-Boleto';

const PREFIJO = 'b1.';
const FORMA = /^b1\.[A-Za-z0-9_-]{40,120}\.[A-Za-z0-9_-]{43}$/;
const LARGO_MAXIMO = 200;
const NONCE = /^[A-Za-z0-9]{16}$/;
const texto = new TextEncoder();

/** Contenido de un boleto ya verificado. */
export interface Boleto {
  v: 1;
  n: string;
  exp: number;
  f: number;
}

function aBase64url(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64url(cadena: string): Uint8Array {
  const b64 = cadena.replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

let cache: { sal: string; llave: Promise<CryptoKey> } | null = null;

/**
 * Llave HMAC-SHA256 no extraíble derivada de SAL_IP con HKDF-SHA256 (salt 'noviazgo',
 * info 'noviazgo/v2.2/boleto-hmac'). Se cachea por isolate con la sal como clave.
 */
export function llaveBoleto(sal: string): Promise<CryptoKey> {
  if (cache?.sal === sal) return cache.llave;
  const llave = (async () => {
    const base = await crypto.subtle.importKey('raw', texto.encode(sal), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: texto.encode('noviazgo'), info: texto.encode('noviazgo/v2.2/boleto-hmac') },
      base,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    );
  })();
  cache = { sal, llave };
  llave.catch(() => {
    if (cache?.llave === llave) cache = null;
  });
  return llave;
}

let avisoSinSal = false;

/**
 * Llave de los boletos según el entorno. Con Turnstile activo y sin SAL_IP falla cerrada (500 `interno`):
 * sin sal la llave sería pública y cualquiera podría firmar boletos. Sin Turnstile (desarrollo) usa la
 * sal vacía, igual que hashIp(), y solo avisa.
 */
export function llaveDelEntorno(env: { SAL_IP?: string; TURNSTILE_SECRETO?: string }): Promise<CryptoKey> {
  if (!env.SAL_IP) {
    if (env.TURNSTILE_SECRETO) {
      console.error('boleto_sin_sal');
      throw new ErrorApi(500, 'interno');
    }
    if (!avisoSinSal) {
      avisoSinSal = true;
      console.warn('SAL_IP no está configurada: los boletos se firman con una llave pública (solo desarrollo).');
    }
  }
  return llaveBoleto(env.SAL_IP ?? '');
}

/** Firma un contenido de boleto. Exportada para los tests (p. ej. un `f` fuera de rango bien firmado). */
export async function firmarBoleto(llave: CryptoKey, contenido: Record<string, unknown>): Promise<string> {
  const p = aBase64url(texto.encode(JSON.stringify(contenido)));
  const firma = await crypto.subtle.sign('HMAC', llave, texto.encode(PREFIJO + p));
  return `${PREFIJO}${p}.${aBase64url(new Uint8Array(firma))}`;
}

/** Emite un boleto nuevo: nonce de 16 base62, vence en LIMITES.minutosBoleto y vale para LIMITES.fotosPorBoleto fotos. */
export async function emitirBoleto(
  llave: CryptoKey,
  ahora = Date.now(),
): Promise<{ boleto: string; expiraEn: string; fotos: number }> {
  const exp = Math.floor(ahora / 1000) + LIMITES.minutosBoleto * 60;
  const f = LIMITES.fotosPorBoleto;
  // Claves en este orden (§15.1).
  const boleto = await firmarBoleto(llave, { v: 1, n: base62(16), exp, f });
  return { boleto, expiraEn: iso(exp * 1000), fotos: f };
}

const invalido = () => new ErrorApi(401, 'boleto_invalido');

/**
 * Verifica un boleto (§15.1), sin leer D1: forma → firma (crypto.subtle.verify, tiempo constante) →
 * contenido → vigencia. Lanza 401 `boleto_invalido` o `boleto_vencido`.
 */
export async function verificarBoleto(cadena: string, llave: CryptoKey, ahora = Date.now()): Promise<Boleto> {
  // 1. Forma.
  if (cadena.length > LARGO_MAXIMO || !FORMA.test(cadena)) throw invalido();
  const [, p, f] = cadena.split('.') as [string, string, string];

  // 2. Firma. Nunca se recalcula para compararla con ===: verify compara en tiempo constante.
  const firma = deBase64url(f);
  // Solo la codificación canónica (los bits de relleno del último carácter deben ser cero): un mismo
  // boleto no puede escribirse de varias maneras.
  if (firma.byteLength !== 32 || aBase64url(firma) !== f) throw invalido();
  const valida = await crypto.subtle.verify('HMAC', llave, firma, texto.encode(PREFIJO + p));
  if (!valida) throw invalido();

  // 3. Contenido (solo con la firma ya válida).
  let datos: Record<string, unknown>;
  try {
    datos = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(deBase64url(p))) as Record<string, unknown>;
  } catch {
    throw invalido();
  }
  if (
    !datos ||
    typeof datos !== 'object' ||
    datos.v !== 1 ||
    typeof datos.n !== 'string' ||
    !NONCE.test(datos.n) ||
    !Number.isSafeInteger(datos.exp) ||
    !Number.isSafeInteger(datos.f) ||
    (datos.f as number) < 1 ||
    (datos.f as number) > LIMITES.fotosPorBoleto
  ) {
    throw invalido();
  }

  // 4. Vigencia: solo el reloj del servidor, sin tolerancia.
  const boleto: Boleto = { v: 1, n: datos.n, exp: datos.exp as number, f: datos.f as number };
  if (boleto.exp * 1000 <= ahora) throw new ErrorApi(401, 'boleto_vencido');
  return boleto;
}

/**
 * Gasta un uso del boleto (§15.3, §15.4): `boleto:<n>` hasta `f` fotos, `boleto-prop:<n>` una sola
 * propuesta. El contador vence con el boleto. Si ya se agotó: 403 `boleto_agotado` (sin escribir).
 */
export async function consumirBoleto(db: D1Database, tipo: 'boleto' | 'boleto-prop', boleto: Boleto): Promise<void> {
  const maximo = tipo === 'boleto' ? boleto.f : 1;
  const { conteo } = await sumarSiCabe(db, `${tipo}:${boleto.n}`, boleto.exp * 1000, maximo);
  if (conteo === null) throw new ErrorApi(403, 'boleto_agotado');
}
