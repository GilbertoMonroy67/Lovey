// Registro central de plantillas. Agregar una plantilla nueva =
//   1) crear css/plantillas/<id>.css con sus variables bajo [data-plantilla="<id>"]
//   2) agregar su entrada aquí.
// Nada más: el generador pinta la galería y pregunta.js la aplica a partir de este arreglo.

import { PLANTILLA_POR_DEFECTO } from './limites.js';

const GF = 'https://fonts.googleapis.com/css2?display=swap&';

/**
 * @typedef {Object} Plantilla
 * @property {string} id
 * @property {string} nombre
 * @property {string} descripcion
 * @property {string[]} ideal            tipos de pregunta para los que luce mejor (filtro de la galería)
 * @property {string} colorMuestra
 * @property {string} familiasFuente     parámetro family=… de Google Fonts (máx. 2 familias)
 * @property {string} textoSi
 * @property {string} textoNo
 * @property {string[]} textosNo         frases del "No" que huye (rotan en orden)
 * @property {string} mensajeCelebracion mensaje final si quien envía no escribió uno
 * @property {{modo: 'explosion'|'lluvia', simbolos: string[], colores?: string[], cantidad: number}} efecto
 */

/** @type {Plantilla[]} */
export const PLANTILLAS = [
  {
    id: 'romantica',
    nombre: 'Romántica clásica',
    descripcion: 'Rosas y rojos con corazones flotando. Nunca falla.',
    ideal: ['novia', 'novio', 'esposa', 'esposo', 'cita', 'otro'],
    colorMuestra: '#c2185b',
    familiasFuente: 'family=Dancing+Script:wght@600;700&family=Quicksand:wght@400;600;700',
    textoSi: '¡Sí!',
    textoNo: 'No',
    textosNo: ['¿Segur@?', 'Piénsalo bien', '¿De verdad?', 'Mi corazón…', 'No te creo', 'Última oportunidad', 'Ups, se me escapó'],
    mensajeCelebracion: '¡Sabía que dirías que sí! Me haces la persona más feliz.',
    efecto: { modo: 'explosion', simbolos: ['💖', '💕', '❤️', '💗', '💘'], cantidad: 46 },
  },
  {
    id: 'noche',
    nombre: 'Noche estrellada',
    descripcion: 'Azul profundo, luna y estrellas que titilan. Íntima y soñadora.',
    ideal: ['novia', 'novio', 'esposa', 'esposo', 'cita', 'otro'],
    colorMuestra: '#1b2452',
    familiasFuente: 'family=Playfair+Display:ital,wght@0,600;1,600&family=Nunito:wght@400;600;700',
    textoSi: 'Sí, bajo esta luna',
    textoNo: 'No',
    textosNo: ['¿Ni una estrella?', 'La luna dice que sí', 'Mira el cielo…', 'Se me escapó', '¿Segur@?', 'Pide un deseo'],
    mensajeCelebracion: 'Todas las estrellas se alinearon para este momento.',
    efecto: { modo: 'explosion', simbolos: ['✨', '⭐', '🌟', '💫'], cantidad: 40 },
  },
  {
    id: 'vintage',
    nombre: 'Carta vintage',
    descripcion: 'Papel envejecido, sello de cera y letra manuscrita.',
    ideal: ['novia', 'novio', 'esposa', 'esposo', 'otro'],
    colorMuestra: '#8b1e1e',
    familiasFuente: 'family=Caveat:wght@600;700&family=Lora:ital,wght@0,400;0,600;1,400',
    textoSi: 'Sí, acepto',
    textoNo: 'No',
    textosNo: ['Relee la carta', '¿Está usted segur@?', 'Tinta corrida…', 'Mejor no', 'Se lo llevó el viento', 'Ni lo pienses'],
    mensajeCelebracion: 'Guardaré esta respuesta como mi carta favorita.',
    efecto: { modo: 'lluvia', simbolos: ['🌹', '🌸', '🥀', '💌'], cantidad: 34 },
  },
  {
    id: 'kawaii',
    nombre: 'Kawaii',
    descripcion: 'Pasteles, carita tierna y rebotes exagerados. Pura ternura.',
    ideal: ['novia', 'novio', 'cita', 'otro'],
    colorMuestra: '#ff8fb8',
    familiasFuente: 'family=Baloo+2:wght@500;700;800',
    textoSi: '¡Siii! (◕‿◕)',
    textoNo: 'No',
    textosNo: ['(｡•́︿•̀｡)', '¿Nooo?', '¡Atrápame!', 'Hehe, aquí no', '(╥﹏╥)', '¡Pío pío!', 'Nop, nop'],
    mensajeCelebracion: '¡Yaaay! Eres lo más tierno del universo.',
    efecto: { modo: 'explosion', simbolos: ['🍓', '🌸', '💗', '🐰', '⭐', '🍡'], cantidad: 48 },
  },
  {
    id: 'minimalista',
    nombre: 'Minimalista elegante',
    descripcion: 'Blanco, negro y un acento rojo. Serif fina y mucho aire.',
    ideal: ['novia', 'novio', 'esposa', 'esposo', 'cita', 'otro'],
    colorMuestra: '#111111',
    familiasFuente: 'family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600',
    textoSi: 'Sí',
    textoNo: 'No',
    textosNo: ['¿Segur@?', 'Reconsidéralo', 'No.', 'Mm, no', 'Intenta otra vez'],
    mensajeCelebracion: 'Simple: tú y yo.',
    efecto: { modo: 'lluvia', simbolos: ['■', '●', '▲'], colores: ['#111111', '#c8102e', '#9e9e9e'], cantidad: 36 },
  },
  {
    id: 'retro',
    nombre: 'Retro 8-bit',
    descripcion: 'Videojuego pixel art: el "No" es un enemigo que escapa.',
    ideal: ['novia', 'novio', 'cita', 'otro'],
    colorMuestra: '#38b764',
    familiasFuente: 'family=Press+Start+2P&family=VT323',
    textoSi: '▶ SÍ',
    textoNo: 'NO',
    textosNo: ['¡FALLASTE!', 'MISS!', '+1 VIDA', 'GAME OVER? NO', 'TRY AGAIN', 'ESQUIVA!', '404 NO'],
    mensajeCelebracion: '¡NIVEL COMPLETADO! Desbloqueaste: mi corazón.',
    efecto: { modo: 'explosion', simbolos: ['■'], colores: ['#38b764', '#ffcd75', '#ef7d57', '#41a6f6', '#f4f4f4'], cantidad: 44 },
  },
  {
    id: 'propuesta',
    nombre: 'Propuesta de matrimonio',
    descripcion: 'Dorado y marfil, anillo y un tono solemne. Para el gran día.',
    ideal: ['esposa', 'esposo'],
    colorMuestra: '#c9a227',
    familiasFuente: 'family=Cinzel:wght@500;600&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500',
    textoSi: 'Sí, acepto',
    textoNo: 'No',
    textosNo: ['¿Segur@?', 'Mira el anillo', 'Para siempre…', 'Piénsalo', 'No puede ser'],
    mensajeCelebracion: 'Hoy empieza nuestro para siempre.',
    efecto: { modo: 'lluvia', simbolos: ['✨', '💍', '🤍', '✦'], cantidad: 36 },
  },
];

const POR_ID = new Map(PLANTILLAS.map((p) => [p.id, p]));

/** Devuelve la plantilla o la de por defecto si el id no existe. */
export function obtenerPlantilla(id) {
  return POR_ID.get(id) ?? POR_ID.get(PLANTILLA_POR_DEFECTO);
}

export const urlCssPlantilla = (id) => `css/plantillas/${id}.css`;

export const urlFuentes = (plantillas) =>
  `${GF}${plantillas.map((p) => p.familiasFuente).join('&')}`;

/** Inserta un <link rel=stylesheet> y resuelve al cargar (o al fallar / tras 2.5 s, para no bloquear). */
function insertarHoja(href, { esperar = true } = {}) {
  return new Promise((resolve) => {
    if (document.querySelector(`link[data-hoja="${CSS.escape(href)}"]`)) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.hoja = href;
    const listo = () => resolve();
    link.addEventListener('load', listo, { once: true });
    link.addEventListener('error', listo, { once: true });
    if (!esperar) resolve();
    setTimeout(listo, 2500);
    document.head.append(link);
  });
}

/** Carga el CSS y las fuentes de una plantilla. Las fuentes no bloquean (display=swap). */
export function cargarPlantilla(plantilla) {
  insertarHoja(urlFuentes([plantilla]), { esperar: false });
  return insertarHoja(urlCssPlantilla(plantilla.id));
}

/** Carga todas las plantillas (para la galería del generador). */
export function cargarTodas() {
  insertarHoja(urlFuentes(PLANTILLAS), { esperar: false });
  return Promise.all(PLANTILLAS.map((p) => insertarHoja(urlCssPlantilla(p.id))));
}
