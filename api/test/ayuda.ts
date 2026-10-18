// Utilidades de prueba: peticiones al Worker, propuestas válidas (v2 cifradas y v1 heredadas) e imágenes mínimas.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { sha256Hex } from '../src/ids';
import { app } from '../src/index';

// `wrangler types` no tipa el export por defecto; es el fetch del Worker principal.
const worker = (exports as unknown as { default: Fetcher }).default;

export const BASE = 'https://api.test/api/v1';

let contadorIp = 0;
/** IP distinta por llamada para que los límites de tasa de un test no afecten a otro. */
export const nuevaIp = () => `10.0.${Math.floor(++contadorIp / 250)}.${contadorIp % 250}`;

export function pedir(ruta: string, init: RequestInit & { ip?: string; base?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', init.ip ?? nuevaIp());
  return worker.fetch(new Request((init.base ?? BASE) + ruta, { ...init, headers, redirect: 'manual' }));
}

/**
 * Igual que `pedir`, pero con variables de entorno extra (p. ej. TURNSTILE_SECRETO o PERMITIR_LOCALHOST)
 * sin tocar la configuración compartida de los tests. Llama a la app Hono directamente.
 */
export async function pedirCon(
  extra: Record<string, string>,
  ruta: string,
  init: RequestInit & { ip?: string; base?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', init.ip ?? nuevaIp());
  const ctx = createExecutionContext();
  const r = await app.fetch(new Request((init.base ?? BASE) + ruta, { ...init, headers, redirect: 'manual' }), { ...env, ...extra }, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}

export const json = (cuerpo: unknown, extra: RequestInit & { ip?: string } = {}) => ({
  method: 'POST',
  ...extra,
  headers: { 'Content-Type': 'application/json', ...(extra.headers as Record<string, string> | undefined) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});

/** Texto cifrado de mentira: al servidor solo le importa su forma (base64url) y su tamaño. */
export const CIFRADO = (largo = 200) => 'AbC_-'.repeat(Math.ceil(largo / 5)).slice(0, largo);

/** Sobre de una propuesta v2 (el contenido real va cifrado en el navegador). */
export function propuestaValida(cambios: Record<string, unknown> = {}) {
  return { v: 2, cifrado: CIFRADO(), fotos: [], avisos: { push: false }, ...cambios };
}

/** Contenido en claro de una propuesta v1 (anterior al cifrado). */
export function datosV1(cambios: Record<string, unknown> = {}) {
  return {
    v: 1,
    plantilla: 'romantica',
    tipo: 'novia',
    de: 'Gilberto',
    para: 'Ana',
    pasos: [
      { texto: 'Desde que te conocí…\nTodo cambió', fotos: [] },
      { texto: 'Cada día contigo', fotos: [] },
    ],
    pregunta: '¿Quieres ser mi novia?',
    celebracion: {
      titulo: '¿Dónde lo celebramos?',
      opciones: [
        { id: 'btk', etiqueta: 'La BTK', emoji: '🍔' },
        { id: 'helado', etiqueta: 'Un helado', emoji: '🍦' },
      ],
    },
    mensajeFinal: '¡Sabía que dirías que sí!',
    ...cambios,
  };
}

/** Inserta directo en D1 una propuesta v1, como las que existían antes del cifrado. */
export async function crearPropuestaV1(cambios: Record<string, unknown> = {}, ntfyTema: string | null = null) {
  const id = `V1${String(++contadorIp).padStart(10, '0')}`;
  const claveAdmin = 'C'.repeat(32);
  const ahora = Date.now();
  await env.DB.prepare(
    'INSERT INTO propuestas (id, clave_hash, datos, ntfy_tema, usuario_id, creada_en, expira_en) VALUES (?, ?, ?, ?, NULL, ?, ?)',
  )
    .bind(id, await sha256Hex(claveAdmin), JSON.stringify(datosV1(cambios)), ntfyTema, ahora, ahora + 30 * 86_400_000)
    .run();
  return { id, claveAdmin };
}

export interface Creada {
  id: string;
  claveAdmin: string;
  expiraEn: string;
  ntfyTema: string | null;
}

export async function crearPropuesta(cambios: Record<string, unknown> = {}): Promise<Creada> {
  const r = await pedir('/propuestas', json(propuestaValida(cambios)));
  if (r.status !== 201) throw new Error(`crearPropuesta: ${r.status} ${await r.text()}`);
  return r.json();
}

export const JPEG = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
export const WEBP = () => {
  const b = new Uint8Array(32);
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
  b.set([24, 0, 0, 0], 4);
  b.set([...'WEBPVP8 '].map((c) => c.charCodeAt(0)), 8);
  return b;
};
export const PNG = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

/** Foto cifrada de mentira: byte de versión 1 + IV + datos + etiqueta (ver js/cifrado.js). */
export const CIFRADA = (largo = 64) => {
  const b = new Uint8Array(largo);
  for (let i = 0; i < largo; i++) b[i] = (i * 37 + 11) % 256;
  b[0] = 1;
  return b;
};

/** Pide un boleto de subida (contrato v2.2, §15.1) sin Turnstile y devuelve el texto del boleto. */
export async function obtenerBoleto(ip?: string): Promise<string> {
  const r = await pedir('/boletos', { method: 'POST', ip });
  if (r.status !== 201) throw new Error(`obtenerBoleto: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { boleto: string }).boleto;
}

/**
 * Sube una foto con su boleto (`X-Boleto`). Sin `boleto`, pide uno nuevo desde la misma IP; sin `ip`,
 * usa una IP nueva (cada IP solo puede subir 3 fotos al día).
 */
export async function subirFoto(
  bytes: Uint8Array = CIFRADA(),
  tipo = 'application/octet-stream',
  opciones: { boleto?: string | null; ip?: string } = {},
) {
  const ip = opciones.ip ?? nuevaIp();
  const boleto = opciones.boleto === undefined ? await obtenerBoleto(ip) : opciones.boleto;
  const headers: Record<string, string> = { 'Content-Type': tipo };
  if (boleto !== null) headers['X-Boleto'] = boleto;
  return pedir('/fotos', { method: 'POST', headers, body: bytes, ip });
}

export const sesion = () => 'Qw8e7r6t5y4u3i2o';

export const evento = (id: string, cuerpo: Record<string, unknown>, ip?: string) =>
  pedir(`/propuestas/${id}/eventos`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ sesion: sesion(), ...cuerpo }),
    ip,
  });

export const panel = (id: string, clave: string | null, desde?: number) =>
  pedir(`/propuestas/${id}/eventos${desde !== undefined ? `?desde=${desde}` : ''}`, {
    headers: clave ? { Authorization: `Bearer ${clave}` } : {},
  });
