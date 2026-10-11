// Adaptador de la API (contrato §6.2). Elige entre la implementación real (Worker)
// y la simulada (localStorage) según MODO. La interfaz es idéntica en ambos modos.
//
// Cifrado de extremo a extremo (v2): aquí se cifra todo antes de salir del navegador y se descifra
// al llegar, para los dos modos. El servidor (y el mock) solo ven el sobre { v, cifrado, fotos }.

import { API_BASE, MODO } from './config.js';
import {
  CONTEXTO, cifrarBytes, cifrarJson, claveValida, descifrarBytes, descifrarJson, generarClave,
} from './cifrado.js';
import { VERSION_PROPUESTA, VERSION_PROPUESTA_V1 } from './limites.js';
import { ErrorApi } from './utilidades.js';
import { urlFotoValida, validarPropuesta } from './validacion.js';
import * as mock from './api-mock.js';

export { ErrorApi };
export { MODO };
export { generarClave };

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

async function pedir(ruta, { metodo = 'GET', cuerpo, clave, turnstile, timeout = TIMEOUT_MS } = {}) {
  const cabeceras = {};
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (clave) cabeceras.Authorization = `Bearer ${clave}`;
  if (turnstile) cabeceras['X-Turnstile-Token'] = turnstile;
  let respuesta;
  try {
    respuesta = await fetch(`${API_BASE}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: senalTimeout(timeout),
      cache: 'no-store',
      credentials: 'omit',
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
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
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

  crearPropuesta: (sobre, { turnstile } = {}) => pedir('/propuestas', { metodo: 'POST', cuerpo: sobre, turnstile }),

  obtenerPropuesta: (id) => pedir(`/propuestas/${encodeURIComponent(id)}`),

  async descargarFoto(url) {
    let respuesta;
    try {
      respuesta = await fetch(url, {
        credentials: 'omit', referrerPolicy: 'no-referrer', signal: senalTimeout(TIMEOUT_FOTOS_MS),
      });
    } catch {
      throw errorRed();
    }
    if (!respuesta.ok) throw await errorDesdeRespuesta(respuesta);
    return new Uint8Array(await respuesta.arrayBuffer());
  },

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

const errorLlave = (codigo, mensaje) => new ErrorApi(codigo, mensaje, 0);

/** Detecta el formato de una foto ya descifrada por sus bytes mágicos. */
function tipoImagen(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Comprime aparte (fotos.js); aquí se cifra con la llave de la propuesta y se sube.
 * @param {Blob} blob foto ya comprimida (WebP/JPEG)
 * @param {{clave: string, alProgresar?: (p: number) => void}} opciones
 * @returns {Promise<{id: string, url: string, expiraEn?: string}>}
 */
export async function subirFoto(blob, { clave, alProgresar } = {}) {
  const cifrada = await cifrarBytes(clave, new Uint8Array(await blob.arrayBuffer()), CONTEXTO.foto);
  return impl.subirFoto(new Blob([cifrada], { type: 'application/octet-stream' }), { alProgresar });
}

/**
 * Valida la propuesta en claro (contrato §3.3), la cifra y manda solo el sobre.
 * @param {object} propuesta modelo §3.1 en claro
 * @param {{clave: string, turnstile?: string}} opciones
 */
export async function crearPropuesta(propuesta, { clave, turnstile } = {}) {
  const { datos, detalles } = validarPropuesta(propuesta);
  if (detalles.length) throw new ErrorApi('validacion', 'Revisa los datos marcados.', 422, detalles);
  const sobre = {
    v: VERSION_PROPUESTA,
    cifrado: await cifrarJson(clave, datos, CONTEXTO.propuesta),
    fotos: datos.pasos.flatMap((p) => p.fotos.map((f) => f.id)),
    avisos: { push: propuesta?.avisos?.push === true },
  };
  return impl.crearPropuesta(sobre, { turnstile });
}

/**
 * Descarga y descifra la propuesta. Devuelve el modelo §3.2 en claro con `cifrada` (false en las v1).
 * @param {string} id
 * @param {string} clave llave de cifrado del fragmento #c=
 */
export async function obtenerPropuesta(id, clave) {
  const p = await impl.obtenerPropuesta(id);
  if (p?.v === VERSION_PROPUESTA_V1) return { ...p, cifrada: false };
  if (!claveValida(clave)) {
    throw errorLlave('llave_faltante', 'El enlace está incompleto: le falta la parte final (#c=…).');
  }
  let contenido;
  try {
    contenido = await descifrarJson(clave, p?.cifrado, CONTEXTO.propuesta);
  } catch {
    throw errorLlave('llave_invalida', 'No pudimos abrir esta sorpresa: el enlace está incompleto o alterado.');
  }
  const urls = new Map((Array.isArray(p.fotos) ? p.fotos : []).map((f) => [f?.id, f?.url]));
  const pasos = (Array.isArray(contenido?.pasos) ? contenido.pasos : []).map((paso) => ({
    ...paso,
    fotos: (Array.isArray(paso?.fotos) ? paso.fotos : [])
      .filter((f) => urls.has(f?.id))
      .map((f) => ({ ...f, url: urls.get(f.id) })),
  }));
  return { ...contenido, pasos, id: p.id, creadaEn: p.creadaEn, expiraEn: p.expiraEn, cifrada: true };
}

/**
 * Descarga una foto, la descifra (si `clave` no es null) y devuelve una URL blob: para <img>.
 * Quien la use debe liberarla con URL.revokeObjectURL cuando ya no la necesite.
 */
export async function cargarFoto(url, clave) {
  if (!urlFotoValida(url, API_BASE, MODO)) throw new ErrorApi('foto_invalida', 'Foto no válida.', 0);
  const bytes = await impl.descargarFoto(url);
  const claro = clave ? await descifrarBytes(clave, bytes, CONTEXTO.foto) : bytes;
  const tipo = tipoImagen(claro);
  if (!tipo) throw new ErrorApi('foto_invalida', 'Foto no válida.', 0);
  return URL.createObjectURL(new Blob([claro], { type: tipo }));
}

/** Cifra la elección de celebración (opción + nota) para el evento `celebracion_elegida`. */
export const cifrarEleccion = (clave, eleccion) => cifrarJson(clave, eleccion, CONTEXTO.evento);

/** Dispara y olvida: nunca lanza. */
export function enviarEvento(id, evento, opciones = {}) {
  try { impl.enviarEvento(id, evento, opciones); } catch { /* nunca lanza */ }
}

const contenidoDelPanel = new Map(); // id → contenido descifrado (se recibe solo con desde = 0)

async function descifrarEleccion(clave, cifrado, opciones) {
  try {
    const { opcionId, nota } = await descifrarJson(clave, cifrado, CONTEXTO.evento);
    const etiqueta = opciones.find((o) => o.id === opcionId)?.etiqueta ?? null;
    return { opcionId: typeof opcionId === 'string' ? opcionId : null, etiqueta, nota: typeof nota === 'string' && nota ? nota : null };
  } catch {
    return { opcionId: null, etiqueta: null, nota: null };
  }
}

/**
 * Panel: devuelve el formato de §5.2 ya descifrado (`para`, `etiqueta` y `nota` en claro).
 * `llaveFaltante` es true si la propuesta está cifrada y el enlace no trae una llave que la abra.
 */
export async function obtenerEventos(id, claveAdmin, desde, clave) {
  const r = await impl.obtenerEventos(id, claveAdmin, desde);
  if (typeof r?.cifrado === 'string' && claveValida(clave)) {
    try {
      contenidoDelPanel.set(id, await descifrarJson(clave, r.cifrado, CONTEXTO.propuesta));
    } catch { /* llave incorrecta: se marca abajo */ }
  }
  const contenido = contenidoDelPanel.get(id);
  const opciones = Array.isArray(contenido?.celebracion?.opciones) ? contenido.celebracion.opciones : [];
  const eventos = await Promise.all((r.eventos ?? []).map(async (e) => (
    typeof e?.cifrado === 'string' ? { ...e, ...(await descifrarEleccion(clave, e.cifrado, opciones)) } : e
  )));
  let celebracion = r.resumen?.celebracion ?? null;
  if (typeof celebracion?.cifrado === 'string') {
    celebracion = { en: celebracion.en, ...(await descifrarEleccion(clave, celebracion.cifrado, opciones)) };
  }
  const cifrada = r.para === null;
  return {
    ...r,
    eventos,
    resumen: { ...r.resumen, celebracion },
    para: r.para ?? (typeof contenido?.para === 'string' ? contenido.para : null),
    llaveFaltante: cifrada && !contenido,
  };
}

export const borrarPropuesta = (id, claveAdmin) => impl.borrarPropuesta(id, claveAdmin);
