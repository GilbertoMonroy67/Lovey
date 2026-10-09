// Límites compartidos entre el frontend y el Worker (api/).
// Fuente única de verdad: docs/arquitectura.md §3.3. Solo lo modifica el agente arquitecto.
// Módulo ES puro, sin dependencias ni acceso al DOM, para que también lo importe el Worker.

export const VERSION_PROPUESTA = 1;

export const TIPOS = Object.freeze(['novia', 'novio', 'esposa', 'esposo', 'cita', 'otro']);

export const TIPOS_EVENTO = Object.freeze(['abierto', 'intento_no', 'si', 'celebracion_elegida']);

export const PLANTILLA_POR_DEFECTO = 'romantica';

export const LIMITES = Object.freeze({
  nombre: { min: 1, max: 40 },
  pasos: { min: 1, max: 5 },
  textoPaso: { min: 1, max: 280 },
  fotosPorPaso: { max: 3 },
  fotosTotales: { max: 10 },
  altFoto: { max: 100 },
  pregunta: { min: 1, max: 120 },
  tituloCelebracion: { min: 1, max: 60 },
  opcionesCelebracion: { max: 8 },
  etiquetaOpcion: { min: 1, max: 40 },
  emojiOpcion: { max: 8 },
  mensajeFinal: { max: 200 },
  nota: { max: 140 },
  conteoIntentoNo: { min: 1, max: 1000 },
  cuerpoJsonBytes: 16 * 1024,
  fotoBytes: 512000,
  fotoLadoMayorPx: 1280,
  fotoTipos: Object.freeze(['image/webp', 'image/jpeg']),
  diasExpiracion: 30,
  horasFotoHuerfana: 24,
  eventosPorPropuesta: 300,
  celebracionesPorPropuesta: 10,
  intervaloIntentoNoMs: 3000,
  sondeoMs: 5000,
});

export const PATRONES = Object.freeze({
  idPropuesta: /^[A-Za-z0-9]{12}$/,
  idFoto: /^f_[A-Za-z0-9]{16}$/,
  idPlantilla: /^[a-z0-9-]{1,30}$/,
  idOpcion: /^[a-z0-9-]{1,20}$/,
  sesion: /^[A-Za-z0-9]{16}$/,
});
