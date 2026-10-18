// Boleto de subida (contrato §15): único dueño de Cloudflare Turnstile y del boleto en el navegador.
//
// - Turnstile se carga al abrir el generador, pero el token se pide solo cuando hace falta un boleto
//   (`execution: 'execute'`). Con `appearance: 'interaction-only'` no se ve nada salvo que Cloudflare
//   pida interacción; entonces el contenedor aparece como panel fijo abajo, dentro del viewport.
// - El boleto vive SOLO en memoria (nunca en localStorage ni en sessionStorage). Se reutiliza para las
//   fotos y para crear la propuesta, y se renueva 2 min antes de vencer.
// - Una sola solicitud en vuelo: varias fotos elegidas a la vez comparten la misma promesa.
// - Ante un error `boleto_*` se pide otro boleto y se reintenta UNA sola vez. Nunca hay bucles.

import { CODIGOS_BOLETO, ErrorApi, MODO, obtenerBoleto } from './api.js';
import { TURNSTILE_SITIO } from './config.js';
import { LIMITES } from './limites.js';
import { crear } from './utilidades.js';

const MARGEN_MS = 2 * 60 * 1000;
const TIMEOUT_TURNSTILE_MS = 60000;
const URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=alCargarTurnstile';

const turnstileActivo = Boolean(TURNSTILE_SITIO) && MODO === 'api';

/** @type {{boleto: string, expiraMs: number} | null} */
let actual = null;
/** @type {Promise<string> | null} */
let enVuelo = null;

let contenedor = null;
let widget = null;
/** Se resuelve cuando el widget ya está renderizado (o se rechaza si el script no carga). */
let widgetListo = null;
/** Resolución pendiente de un `execute`: { resolve, reject }. */
let pendiente = null;

const errorVerificacion = () => new ErrorApi('verificacion_bot',
  'No pudimos completar la verificación de seguridad. Inténtalo de nuevo.', 403);

function mostrarPanel(visible) {
  contenedor?.classList.toggle('visible', visible);
}

function terminar(token, error) {
  const p = pendiente;
  pendiente = null;
  mostrarPanel(false);
  if (!p) return;
  clearTimeout(p.temporizador);
  if (token) p.resolve(token);
  else p.reject(error ?? errorVerificacion());
}

/**
 * Prepara Turnstile (si está configurado y el modo es 'api'). No pide nada todavía.
 * @param {HTMLElement | null} elemento contenedor del panel "Verificación de seguridad"
 */
export function iniciarVerificacion(elemento) {
  if (!turnstileActivo || !elemento || widgetListo) return;
  contenedor = elemento;
  contenedor.hidden = false; // sigue invisible (clase sin .visible) hasta que Cloudflare pida interacción
  const destino = crear('div', { clase: 'panel-verificacion-widget' });
  contenedor.append(destino);

  widgetListo = new Promise((resolve, reject) => {
    window.alCargarTurnstile = () => {
      try {
        widget = window.turnstile.render(destino, {
          sitekey: TURNSTILE_SITIO,
          language: 'es',
          execution: 'execute',
          appearance: 'interaction-only',
          callback: (token) => terminar(token),
          'error-callback': () => { terminar(null); return true; },
          'expired-callback': () => { /* el token se usa al instante; si caduca, se pide otro */ },
          'timeout-callback': () => terminar(null),
          'before-interactive-callback': () => mostrarPanel(true),
          'after-interactive-callback': () => mostrarPanel(false),
        });
        resolve();
      } catch {
        reject(errorVerificacion());
      }
    };
    const script = document.createElement('script');
    script.src = URL_TURNSTILE;
    script.async = true;
    script.onerror = () => reject(new ErrorApi('verificacion_bot',
      'No se pudo cargar la verificación de seguridad. Revisa tu conexión o desactiva el bloqueador de contenido.', 0));
    document.head.append(script);
  });
  widgetListo.catch(() => { /* se informa al pedir el token */ });
}

function reiniciarWidget() {
  if (widget === null) return;
  try { window.turnstile?.reset(widget); } catch { /* sin widget: nada que reiniciar */ }
}

/** Pide un token de un solo uso. Sin Turnstile activo devuelve undefined. */
async function pedirToken() {
  if (!turnstileActivo) return undefined;
  if (!widgetListo) throw errorVerificacion(); // iniciarVerificacion no se llamó
  let espera;
  const limite = new Promise((_, reject) => {
    espera = setTimeout(() => reject(errorVerificacion()), TIMEOUT_TURNSTILE_MS);
  });
  try {
    await Promise.race([widgetListo, limite]);
  } finally {
    clearTimeout(espera);
  }
  if (pendiente) terminar(null); // nunca debería pasar: hay una sola solicitud en vuelo
  return new Promise((resolve, reject) => {
    const temporizador = setTimeout(() => terminar(null), TIMEOUT_TURNSTILE_MS);
    pendiente = { resolve, reject, temporizador };
    try {
      window.turnstile.execute(widget);
    } catch {
      terminar(null);
    }
  });
}

async function pedirNuevo() {
  actual = null;
  try {
    const turnstile = await pedirToken();
    const r = await obtenerBoleto({ turnstile });
    const expiraMs = Date.parse(r.expiraEn);
    actual = {
      boleto: r.boleto,
      expiraMs: Number.isFinite(expiraMs) ? expiraMs : Date.now() + LIMITES.minutosBoleto * 60 * 1000,
    };
    return actual.boleto;
  } catch (error) {
    // Marca el origen para distinguir un 429 de /boletos de uno de /fotos.
    if (error && typeof error === 'object') error.origen = 'boleto';
    throw error;
  } finally {
    reiniciarWidget(); // cada token sirve una sola vez
  }
}

/**
 * Devuelve el boleto vigente o pide uno (compartiendo la solicitud en vuelo).
 * Se puede llamar por adelantado, en paralelo con otro trabajo (por ejemplo, comprimir una foto).
 * @returns {Promise<string>}
 */
export function prepararBoleto() {
  if (actual && actual.expiraMs - Date.now() > MARGEN_MS) return Promise.resolve(actual.boleto);
  if (!enVuelo) enVuelo = pedirNuevo().finally(() => { enVuelo = null; });
  return enVuelo;
}

function descartar(boleto) {
  if (actual?.boleto === boleto) actual = null; // otra operación pudo traer ya uno nuevo
}

/**
 * Ejecuta `operacion(boleto)`. Si falla con un código de boleto, pide otro y reintenta UNA vez.
 * @template T
 * @param {(boleto: string) => Promise<T>} operacion
 * @returns {Promise<T>}
 */
export async function conBoleto(operacion) {
  const boleto = await prepararBoleto();
  try {
    return await operacion(boleto);
  } catch (error) {
    if (!CODIGOS_BOLETO.includes(error?.codigo)) throw error;
    descartar(boleto);
    return operacion(await prepararBoleto());
  }
}

/** Descarta el boleto en memoria (tras crear la propuesta). */
export function olvidarBoleto() {
  actual = null;
}
