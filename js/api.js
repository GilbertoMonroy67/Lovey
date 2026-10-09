// Adaptador de la API (contrato §6.2). Elige entre la implementación real (Worker)
// y la simulada (localStorage) según MODO. La interfaz es idéntica en ambos modos.

import { API_BASE, MODO } from './config.js';
import { ErrorApi } from './utilidades.js';
import * as mock from './api-mock.js';

export { ErrorApi };
export { MODO };

const TIMEOUT_MS = 15000;
const TIMEOUT_FOTOS_MS = 60000;

function senalTimeout(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const control = new AbortController();
  setTimeout(() => control.abort(), ms);
  return control.signal;
}

const errorRed = () => new ErrorApi('sin_conexion',
  'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.', 0);

async function errorDesdeRespuesta(respuesta) {
  let cuerpo = null;
  try { cuerpo = await respuesta.json(); } catch { /* cuerpo vacío o no JSON */ }
  const e = cuerpo?.error;
  return new ErrorApi(
    typeof e?.codigo === 'string' ? e.codigo : 'interno',
    typeof e?.mensaje === 'string' ? e.mensaje : 'Ocurrió un error inesperado. Inténtalo en un momento.',
    respuesta.status,
    Array.isArray(e?.detalles) ? e.detalles : undefined,
  );
}

async function pedir(ruta, { metodo = 'GET', cuerpo, clave, timeout = TIMEOUT_MS } = {}) {
  const cabeceras = {};
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (clave) cabeceras.Authorization = `Bearer ${clave}`;
  let respuesta;
  try {
    respuesta = await fetch(`${API_BASE}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: senalTimeout(timeout),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw errorRed();
  }
  if (!respuesta.ok) throw await errorDesdeRespuesta(respuesta);
  if (respuesta.status === 204) return undefined;
  try {
    return await respuesta.json();
  } catch {
    throw new ErrorApi('interno', 'La respuesta del servidor no es válida.', respuesta.status);
  }
}

// ---------- Implementación real ----------

const real = {
  subirFoto(blob, { alProgresar } = {}) {
    // XMLHttpRequest permite informar el progreso de la subida (fetch no).
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/fotos`);
      xhr.timeout = TIMEOUT_FOTOS_MS;
      xhr.setRequestHeader('Content-Type', blob.type || 'image/jpeg');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) alProgresar?.(e.loaded / e.total); };
      xhr.onerror = () => reject(errorRed());
      xhr.ontimeout = () => reject(errorRed());
      xhr.onload = () => {
        let cuerpo = null;
        try { cuerpo = JSON.parse(xhr.responseText); } catch { /* no JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && cuerpo?.id) {
          alProgresar?.(1);
          resolve(cuerpo);
        } else {
          const e = cuerpo?.error;
          reject(new ErrorApi(e?.codigo ?? 'interno', e?.mensaje ?? 'No se pudo subir la foto.', xhr.status, e?.detalles));
        }
      };
      xhr.send(blob);
    });
  },

  crearPropuesta: (propuesta) => pedir('/propuestas', { metodo: 'POST', cuerpo: propuesta }),

  obtenerPropuesta: (id) => pedir(`/propuestas/${encodeURIComponent(id)}`),

  enviarEvento(id, evento, { keepalive = false } = {}) {
    try {
      fetch(`${API_BASE}/propuestas/${encodeURIComponent(id)}/eventos`, {
        method: 'POST',
        // text/plain = solicitud simple: sin preflight CORS y compatible con keepalive (contrato §4).
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(evento),
        keepalive,
        referrerPolicy: 'no-referrer',
      }).catch(() => {});
    } catch {
      /* dispara y olvida: nunca rompe la página */
    }
  },

  obtenerEventos(id, claveAdmin, desde = 0) {
    const consulta = desde ? `?desde=${encodeURIComponent(desde)}` : '';
    return pedir(`/propuestas/${encodeURIComponent(id)}/eventos${consulta}`, { clave: claveAdmin });
  },

  borrarPropuesta: (id, claveAdmin) =>
    pedir(`/propuestas/${encodeURIComponent(id)}`, { metodo: 'DELETE', clave: claveAdmin }),
};

const impl = MODO === 'mock' ? mock : real;

/** @returns {Promise<{id: string, url: string, expiraEn?: string}>} */
export const subirFoto = (blob, opciones) => impl.subirFoto(blob, opciones);
export const crearPropuesta = (propuesta) => impl.crearPropuesta(propuesta);
export const obtenerPropuesta = (id) => impl.obtenerPropuesta(id);
/** Dispara y olvida: nunca lanza. */
export function enviarEvento(id, evento, opciones = {}) {
  try { impl.enviarEvento(id, evento, opciones); } catch { /* nunca lanza */ }
}
export const obtenerEventos = (id, claveAdmin, desde) => impl.obtenerEventos(id, claveAdmin, desde);
export const borrarPropuesta = (id, claveAdmin) => impl.borrarPropuesta(id, claveAdmin);
