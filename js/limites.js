// Límites compartidos entre el frontend y el Worker (api/).
// Fuente única de verdad: docs/arquitectura.md §3.3. Solo lo modifica el agente arquitecto.
// Módulo ES puro, sin dependencias ni acceso al DOM, para que también lo importe el Worker.

// v2 (2026-10-11): el contenido y las fotos viajan cifrados de extremo a extremo (AES-GCM).
// El servidor solo guarda `cifrado` y la lista de fotos; la llave vive en el fragmento `#c=` del enlace.
export const VERSION_PROPUESTA = 2;
// Propuestas creadas antes del cifrado: el servidor y el frontend solo las leen (expiran a los 30 días).
export const VERSION_PROPUESTA_V1 = 1;

export const TIPOS = Object.freeze(['novia', 'novio', 'esposa', 'esposo', 'cita', 'otro']);

export const TIPOS_EVENTO = Object.freeze(['abierto', 'intento_no', 'si', 'celebracion_elegida']);

export const PLANTILLA_POR_DEFECTO = 'romantica';

export const LIMITES = Object.freeze({
  nombre: { min: 1, max: 40 },
  pasos: { min: 1, max: 5 },
  textoPaso: { min: 1, max: 280 },
  // v2.2 (2026-10-18): como máximo 3 fotos en TOTAL por propuesta, repartidas como se quiera entre
  // los pasos (antes 10). Solo se aplica al crear: las propuestas v2 anteriores con más fotos se siguen
  // leyendo (al leer solo se recorta por paso con fotosPorPaso).
  fotosPorPaso: { max: 3 },
  fotosTotales: { max: 3 },
  // Boleto de subida (contrato §15): lo emite POST /boletos tras Turnstile; vale para estas fotos
  // y para crear una propuesta, durante estos minutos.
  fotosPorBoleto: 3,
  minutosBoleto: 60,
  altFoto: { max: 100 },
  pregunta: { min: 1, max: 120 },
  tituloCelebracion: { min: 1, max: 60 },
  opcionesCelebracion: { max: 8 },
  etiquetaOpcion: { min: 1, max: 40 },
  emojiOpcion: { max: 8 },
  mensajeFinal: { max: 200 },
  nota: { max: 140 },
  conteoIntentoNo: { min: 1, max: 1000 },
  cuerpoJsonBytes: 32 * 1024,
  fotoBytes: 512000,
  // Foto cifrada = 1 byte de versión + 12 de IV + foto + 16 de etiqueta GCM.
  fotoCifradaBytes: 512000 + 29,
  // Largo máximo (en caracteres base64url) del contenido cifrado de una propuesta y de un evento.
  cifradoPropuesta: 30000,
  cifradoEvento: 1200,
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
  // Llave AES-256 en base64url sin relleno (32 bytes → 43 caracteres).
  claveCifrado: /^[A-Za-z0-9_-]{43}$/,
  cifrado: /^[A-Za-z0-9_-]+$/,
});
