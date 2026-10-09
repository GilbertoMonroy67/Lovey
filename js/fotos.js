// Compresión de fotos en el navegador (contrato §1, D1).
// createImageBitmap → <canvas> (lado mayor ≤ 1280 px) → WebP 0.8; si el navegador no codifica WebP
// (Safari devuelve PNG en silencio) se reintenta en JPEG 0.82. Si pesa > 500 KB se baja la calidad
// y luego el tamaño. Volver a codificar elimina el EXIF (incluida la ubicación GPS): nunca se sube el original.

import { LIMITES } from './limites.js';
import { ErrorApi } from './utilidades.js';

const CALIDADES = [0.8, 0.7, 0.6];
const LADOS = [LIMITES.fotoLadoMayorPx, 1024, 800];

let soportaWebp = null; // se descubre en la primera codificación

async function decodificar(archivo) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch {
      try { return await createImageBitmap(archivo); } catch { /* respaldo con <img> */ }
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function lienzoA(fuente, ladoMayor) {
  const ancho = fuente.width;
  const alto = fuente.height;
  const escala = Math.min(1, ladoMayor / Math.max(ancho, alto));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(ancho * escala));
  lienzo.height = Math.max(1, Math.round(alto * escala));
  const ctx = lienzo.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Fondo blanco: un PNG transparente pasado a JPEG quedaría con fondo negro.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  return lienzo;
}

const aBlob = (lienzo, tipo, calidad) =>
  new Promise((resolve) => lienzo.toBlob(resolve, tipo, calidad));

async function codificar(lienzo, calidad) {
  if (soportaWebp !== false) {
    const webp = await aBlob(lienzo, 'image/webp', calidad);
    if (webp && webp.type === 'image/webp') { soportaWebp = true; return webp; }
    soportaWebp = false;
  }
  return aBlob(lienzo, 'image/jpeg', Math.min(calidad + 0.02, 0.9));
}

/**
 * Comprime una foto elegida por quien envía.
 * @param {File|Blob} archivo
 * @returns {Promise<{blob: Blob, ancho: number, alto: number}>}
 */
export async function comprimirFoto(archivo) {
  if (archivo.type && !archivo.type.startsWith('image/')) {
    throw new ErrorApi('formato_no_compatible', 'Ese archivo no es una imagen.', 0);
  }
  let fuente;
  try {
    fuente = await decodificar(archivo);
  } catch {
    throw new ErrorApi('formato_no_compatible', 'Formato no compatible, prueba con JPG o PNG.', 0);
  }

  try {
    for (const lado of LADOS) {
      const lienzo = lienzoA(fuente, lado);
      for (const calidad of CALIDADES) {
        const blob = await codificar(lienzo, calidad);
        if (blob && blob.size <= LIMITES.fotoBytes && LIMITES.fotoTipos.includes(blob.type)) {
          return { blob, ancho: lienzo.width, alto: lienzo.height };
        }
      }
      lienzo.width = 0; // libera memoria en Safari
    }
  } finally {
    fuente.close?.();
  }
  throw new ErrorApi('archivo_muy_grande', 'No pudimos reducir esta foto lo suficiente. Prueba con otra.', 0);
}
