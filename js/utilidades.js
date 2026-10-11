// Utilidades compartidas: IDs aleatorios, helpers de DOM (siempre con textContent),
// normalización de textos, fechas y el error de la API.

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** ID aleatorio base62 con crypto.getRandomValues y rechazo de sesgo. */
export function idAleatorio(largo = 16) {
  let salida = '';
  const tope = 248; // mayor múltiplo de 62 que cabe en un byte (62 * 4)
  while (salida.length < largo) {
    const bytes = crypto.getRandomValues(new Uint8Array(largo * 2));
    for (const b of bytes) {
      if (b < tope) salida += BASE62[b % 62];
      if (salida.length === largo) break;
    }
  }
  return salida;
}

/** Error uniforme de la API (contrato §6.2). */
export class ErrorApi extends Error {
  constructor(codigo, mensaje, estado = 0, detalles = undefined) {
    super(mensaje || 'Ocurrió un error inesperado.');
    this.name = 'ErrorApi';
    this.codigo = codigo;
    this.estado = estado;
    this.detalles = detalles;
  }
}

/**
 * Crea un elemento. Los textos siempre se asignan con textContent.
 * @param {string} etiqueta
 * @param {{clase?: string, texto?: string, atributos?: Record<string,string>, hijos?: Node[]}} [opciones]
 */
export function crear(etiqueta, { clase, texto, atributos, hijos } = {}) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto !== undefined && texto !== null) el.textContent = String(texto);
  if (atributos) {
    for (const [nombre, valor] of Object.entries(atributos)) {
      if (valor === false || valor === null || valor === undefined) continue;
      el.setAttribute(nombre, valor === true ? '' : String(valor));
    }
  }
  if (hijos) el.append(...hijos.filter(Boolean));
  return el;
}

/** Vacía un nodo sin usar innerHTML. */
export function vaciar(nodo) {
  while (nodo.firstChild) nodo.firstChild.remove();
}

// Caracteres de control salvo \n (que solo se permite en algunos campos).
const CONTROL_SIN_SALTO = /[\u0000-\u0009\u000B-\u001F\u007F]/g;
const CONTROL_TODOS = /[\u0000-\u001F\u007F]/g;

/** trim() + quita caracteres de control. Con multilinea se conserva \n (y \r\n → \n). */
export function limpiarTexto(valor, { multilinea = false } = {}) {
  const texto = String(valor ?? '').replace(/\r\n?/g, '\n');
  return (multilinea ? texto.replace(CONTROL_SIN_SALTO, '') : texto.replace(CONTROL_TODOS, '')).trim();
}

/** Longitud en code points (como la ve la persona). */
export function largo(texto) {
  return [...String(texto ?? '')].length;
}

const FORMATO_HORA = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function formatearHora(iso) {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : FORMATO_HORA.format(fecha);
}

export function formatearFechaHora(iso) {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : FORMATO_FECHA_HORA.format(fecha);
}

export const prefiereMenosMovimiento = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Copia texto al portapapeles con respaldo para navegadores sin Clipboard API. */
export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = crear('textarea', { atributos: { readonly: true, 'aria-hidden': 'true' } });
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/** Lee JSON de localStorage/sessionStorage sin lanzar. */
export function leerAlmacen(almacen, clave, porDefecto) {
  try {
    const crudo = almacen.getItem(clave);
    return crudo === null ? porDefecto : JSON.parse(crudo);
  } catch {
    return porDefecto;
  }
}

/** Escribe JSON en el almacén. Devuelve false si falla (cuota, modo privado…). */
export function escribirAlmacen(almacen, clave, valor) {
  try {
    almacen.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

/** Muestra el aviso de modo demostración si la app corre con la API simulada. */
export function mostrarAvisoDemo(modo) {
  if (modo !== 'mock') return;
  const aviso = document.getElementById('aviso-demo');
  if (aviso) aviso.hidden = false;
}

/** Anuncia un mensaje en la región aria-live indicada. */
export function anunciar(region, mensaje) {
  if (!region) return;
  region.textContent = '';
  // Un pequeño retraso hace que los lectores de pantalla repitan mensajes iguales.
  setTimeout(() => { region.textContent = mensaje; }, 60);
}

// ---------- Enlaces y "Mis propuestas" (contrato §2.1 y §D3) ----------

const CLAVE_MIS_PROPUESTAS = 'noviazgo:mis-propuestas';

/**
 * Enlace para la pareja. Relativo a la página actual: funciona bajo /<repo>/ en GitHub Pages.
 * La llave de cifrado va en el fragmento (#c=): el navegador nunca la manda al servidor.
 */
export function enlacePregunta(id, claveCifrado) {
  const url = new URL('pregunta.html', location.href);
  url.search = '';
  url.hash = claveCifrado ? `c=${encodeURIComponent(claveCifrado)}` : '';
  url.searchParams.set('id', id);
  return url.href;
}

/** Enlace privado de seguimiento: la clave de administración (#k=) y la de cifrado (&c=) van en el fragmento. */
export function enlaceRespuestas(id, claveAdmin, claveCifrado) {
  const url = new URL('respuestas.html', location.href);
  url.search = '';
  url.searchParams.set('id', id);
  const fragmento = new URLSearchParams({ k: claveAdmin });
  if (claveCifrado) fragmento.set('c', claveCifrado);
  url.hash = fragmento.toString();
  return url.href;
}

/** Lee un valor del fragmento (#k=…&c=…) sin que llegue nunca al servidor. */
export const leerFragmento = (nombre) => new URLSearchParams(location.hash.slice(1)).get(nombre) ?? '';

export function leerMisPropuestas() {
  const lista = leerAlmacen(localStorage, CLAVE_MIS_PROPUESTAS, []);
  return Array.isArray(lista)
    ? lista.filter((p) => p && typeof p.id === 'string' && typeof p.claveAdmin === 'string')
    : [];
}

export function guardarMiPropuesta(entrada) {
  const lista = leerMisPropuestas().filter((p) => p.id !== entrada.id);
  lista.unshift(entrada);
  escribirAlmacen(localStorage, CLAVE_MIS_PROPUESTAS, lista.slice(0, 30));
}

export function quitarMiPropuesta(id) {
  escribirAlmacen(localStorage, CLAVE_MIS_PROPUESTAS, leerMisPropuestas().filter((p) => p.id !== id));
}
