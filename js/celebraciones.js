// Catálogo de opciones de celebración predefinidas (contrato §2.1, paso 5).
// Las predefinidas usan su slug como id; las personalizadas, c1…c8.

export const CELEBRACIONES = Object.freeze([
  { id: 'btk', etiqueta: 'La BTK', emoji: '🍔', marcada: true },
  { id: 'helado', etiqueta: 'Un helado', emoji: '🍦', marcada: true },
  { id: 'parque', etiqueta: 'Paseo en el parque', emoji: '🌳', marcada: true },
  { id: 'cine', etiqueta: 'El cine', emoji: '🎬', marcada: true },
  { id: 'cenar', etiqueta: 'Cenar juntos', emoji: '🍝', marcada: false },
  { id: 'picnic', etiqueta: 'Picnic', emoji: '🧺', marcada: false },
]);

export const TITULO_CELEBRACION = '¿Dónde lo celebramos?';
