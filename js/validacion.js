// Validación del contenido de la propuesta (contrato §3.3) en el navegador.
// Desde v2 el contenido viaja cifrado y el servidor no puede leerlo: esta es la única validación
// de los textos. La usa js/api.js antes de cifrar. Devuelve la propuesta normalizada y una lista
// de { campo, mensaje } con el mismo formato que `detalles` del error 422 de la API.

import { LIMITES, PATRONES, TIPOS } from './limites.js';
import { largo, limpiarTexto } from './utilidades.js';

export function validarPropuesta(entrada) {
  const detalles = [];
  const error = (campo, mensaje) => detalles.push({ campo, mensaje });
  const p = entrada && typeof entrada === 'object' ? entrada : {};

  const texto = (valor, campo, { min = 0, max, multilinea = false, nombre }) => {
    if (valor !== undefined && valor !== null && typeof valor !== 'string') {
      error(campo, `${nombre} debe ser texto.`);
      return '';
    }
    const limpio = limpiarTexto(valor, { multilinea });
    const n = largo(limpio);
    if (n < min) error(campo, min === 1 ? `${nombre} es obligatorio.` : `${nombre} debe tener al menos ${min} caracteres.`);
    else if (max !== undefined && n > max) error(campo, `${nombre} admite como máximo ${max} caracteres.`);
    return limpio;
  };

  const plantilla = typeof p.plantilla === 'string' ? p.plantilla : '';
  if (!PATRONES.idPlantilla.test(plantilla)) error('plantilla', 'La plantilla no es válida.');

  if (!TIPOS.includes(p.tipo)) error('tipo', 'Elige el tipo de pregunta.');

  const de = texto(p.de, 'de', { ...LIMITES.nombre, nombre: 'Tu nombre' });
  const para = texto(p.para, 'para', { ...LIMITES.nombre, nombre: 'Su nombre' });

  const pasos = [];
  if (!Array.isArray(p.pasos) || p.pasos.length < LIMITES.pasos.min || p.pasos.length > LIMITES.pasos.max) {
    error('pasos', `Debe haber entre ${LIMITES.pasos.min} y ${LIMITES.pasos.max} pasos.`);
  }
  let fotosTotales = 0;
  const idsFotos = new Set(); // el Worker rechaza la misma foto dos veces en una propuesta
  (Array.isArray(p.pasos) ? p.pasos : []).forEach((paso, i) => {
    const textoPaso = texto(paso?.texto, `pasos.${i}.texto`, {
      ...LIMITES.textoPaso, multilinea: true, nombre: `El texto del paso ${i + 1}`,
    });
    const fotos = [];
    const crudas = Array.isArray(paso?.fotos) ? paso.fotos : [];
    if (crudas.length > LIMITES.fotosPorPaso.max) {
      error(`pasos.${i}.fotos`, `Cada paso admite como máximo ${LIMITES.fotosPorPaso.max} fotos.`);
    }
    crudas.forEach((foto, j) => {
      if (!PATRONES.idFoto.test(foto?.id ?? '')) error(`pasos.${i}.fotos.${j}.id`, 'Foto no válida.');
      else if (idsFotos.has(foto.id)) error('pasos', 'Una foto no puede repetirse.');
      idsFotos.add(foto?.id);
      const alt = texto(foto?.alt ?? '', `pasos.${i}.fotos.${j}.alt`, {
        max: LIMITES.altFoto.max, nombre: 'La descripción de la foto',
      });
      fotos.push({ id: foto?.id, alt });
    });
    fotosTotales += crudas.length;
    pasos.push({ texto: textoPaso, fotos });
  });
  if (fotosTotales > LIMITES.fotosTotales.max) {
    error('pasos', `Puedes usar como máximo ${LIMITES.fotosTotales.max} fotos en total.`);
  }

  const pregunta = texto(p.pregunta, 'pregunta', { ...LIMITES.pregunta, nombre: 'La pregunta' });

  let celebracion;
  if (p.celebracion !== undefined && p.celebracion !== null) {
    const c = p.celebracion;
    const titulo = texto(c.titulo, 'celebracion.titulo', { ...LIMITES.tituloCelebracion, nombre: 'El título de la celebración' });
    const opciones = [];
    const crudas = Array.isArray(c.opciones) ? c.opciones : [];
    if (crudas.length > LIMITES.opcionesCelebracion.max) {
      error('celebracion.opciones', `Puedes ofrecer como máximo ${LIMITES.opcionesCelebracion.max} opciones.`);
    }
    const ids = new Set();
    crudas.forEach((op, i) => {
      const id = typeof op?.id === 'string' ? op.id : '';
      if (!PATRONES.idOpcion.test(id)) error(`celebracion.opciones.${i}.id`, 'Identificador de opción no válido.');
      else if (ids.has(id)) error(`celebracion.opciones.${i}.id`, 'Hay opciones repetidas.');
      ids.add(id);
      const etiqueta = texto(op?.etiqueta, `celebracion.opciones.${i}.etiqueta`, {
        ...LIMITES.etiquetaOpcion, nombre: `La opción ${i + 1}`,
      });
      const emoji = texto(op?.emoji ?? '', `celebracion.opciones.${i}.emoji`, {
        max: LIMITES.emojiOpcion.max, nombre: 'El emoji',
      });
      opciones.push(emoji ? { id, etiqueta, emoji } : { id, etiqueta });
    });
    celebracion = { titulo, opciones };
  }

  const mensajeFinal = texto(p.mensajeFinal ?? '', 'mensajeFinal', {
    max: LIMITES.mensajeFinal.max, multilinea: true, nombre: 'El mensaje final',
  });

  // Solo estos campos se cifran y se guardan: cualquier otro que traiga la entrada se descarta.
  const datos = { plantilla, tipo: p.tipo, de, para, pasos, pregunta, mensajeFinal };
  if (celebracion) datos.celebracion = celebracion;
  return { datos, detalles };
}

/** Comprueba que la URL de una foto sea de confianza antes de descargarla (contrato §6.2). */
export function urlFotoValida(url, apiBase, modo) {
  if (typeof url !== 'string') return false;
  const prefijo = `${apiBase}/fotos/`;
  if (url.startsWith(prefijo) && PATRONES.idFoto.test(url.slice(prefijo.length))) return true;
  return modo === 'mock' && /^data:application\/octet-stream;base64,[A-Za-z0-9+/]+=*$/.test(url);
}
