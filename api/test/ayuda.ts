// Utilidades de prueba: peticiones al Worker, propuestas válidas e imágenes mínimas.
import { exports } from 'cloudflare:workers';

// `wrangler types` no tipa el export por defecto; es el fetch del Worker principal.
const worker = (exports as unknown as { default: Fetcher }).default;

export const BASE = 'http://api.test/api/v1';

let contadorIp = 0;
/** IP distinta por llamada para que los límites de tasa de un test no afecten a otro. */
export const nuevaIp = () => `10.0.${Math.floor(++contadorIp / 250)}.${contadorIp % 250}`;

export function pedir(ruta: string, init: RequestInit & { ip?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', init.ip ?? nuevaIp());
  return worker.fetch(new Request(BASE + ruta, { ...init, headers }));
}

export const json = (cuerpo: unknown, extra: RequestInit & { ip?: string } = {}) => ({
  method: 'POST',
  ...extra,
  headers: { 'Content-Type': 'application/json', ...(extra.headers as Record<string, string> | undefined) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});

export function propuestaValida(cambios: Record<string, unknown> = {}) {
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
    avisos: { push: false },
    ...cambios,
  };
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

export async function subirFoto(bytes: Uint8Array = WEBP(), tipo = 'image/webp') {
  return pedir('/fotos', { method: 'POST', headers: { 'Content-Type': tipo }, body: bytes });
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
