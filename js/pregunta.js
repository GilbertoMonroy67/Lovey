// Máquina de estados de pregunta.html (contrato §2.2):
// cargando → paso[0..n] → pregunta → (celebracion) → final, con error + Reintentar.

import { cargarFoto, obtenerPropuesta, MODO } from './api.js';
import { API_BASE } from './config.js';
import { activarBotonNo } from './boton-no.js';
import { crearEmisor } from './eventos.js';
import { LIMITES } from './limites.js';
import { lanzarParticulas } from './particulas.js';
import { cargarPlantilla, obtenerPlantilla } from './plantillas.js';
import {
  anunciar, crear, escribirAlmacen, largo, leerAlmacen, leerFragmento, limpiarTexto, mostrarAvisoDemo, vaciar,
} from './utilidades.js';
import { urlFotoValida } from './validacion.js';

const $ = (id) => document.getElementById(id);
const parametros = new URLSearchParams(location.search);
const idPropuesta = parametros.get('id') ?? '';
const vistaPrevia = parametros.get('preview') === '1';
// Llave de cifrado del fragmento #c=: nunca se envía al servidor.
const claveCifrado = leerFragmento('c');
const claveRespondida = `noviazgo:respondida:${idPropuesta}`;

const estado = {
  propuesta: null,
  claveFotos: null, // llave para descifrar las fotos (null en propuestas v1, sin cifrar)
  fotos: new Map(), // url → Promise<URL blob:> ya descifrada
  plantilla: obtenerPlantilla(),
  emisor: null,
  paso: 0,
  controlNo: null,
};

// ---------- Pantallas ----------

const PANTALLAS = ['cargando', 'error', 'paso', 'pregunta', 'celebracion', 'final'];

function mostrarPantalla(nombre, anuncio) {
  for (const p of PANTALLAS) $(`pantalla-${p}`).hidden = p !== nombre;
  if (nombre !== 'pregunta') estado.controlNo?.restablecer();
  const titulo = $(`pantalla-${nombre}`).querySelector('[data-titulo]');
  // El foco va al encabezado de la pantalla nueva; aria-live anuncia el cambio.
  if (titulo && nombre !== 'cargando') titulo.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  anunciar($('anuncio'), anuncio ?? titulo?.textContent ?? '');
}

function mostrarError(error) {
  const llave = error?.codigo === 'llave_faltante' || error?.codigo === 'llave_invalida';
  const noExiste = !idPropuesta && !vistaPrevia
    || error?.codigo === 'no_encontrado' || error?.codigo === 'expirada'
    || error?.estado === 404 || error?.estado === 410;
  $('titulo-error').textContent = llave
    ? 'Este enlace está incompleto'
    : noExiste ? 'Este enlace no existe o ya expiró' : 'No pudimos cargar tu sorpresa';
  $('mensaje-error').textContent = llave
    ? 'Tu sorpresa está protegida y el enlace llegó cortado. Pídele a quien te lo envió que te lo comparta completo.'
    : noExiste
      ? 'Pídele a quien te lo envió que te comparta uno nuevo.'
      : 'Inténtalo en un momento. Revisa tu conexión a internet.';
  $('boton-reintentar').hidden = noExiste || llave;
  mostrarPantalla('error');
}

// ---------- Datos ----------

/** Normaliza lo que llega de la API o de la vista previa: nunca confiamos en su forma. */
function normalizar(p) {
  if (!p || typeof p !== 'object') throw new Error('propuesta inválida');
  const texto = (v, max, multilinea = false) => {
    const t = limpiarTexto(typeof v === 'string' ? v : '', { multilinea });
    return largo(t) > max ? [...t].slice(0, max).join('') : t;
  };
  const pasos = (Array.isArray(p.pasos) ? p.pasos : []).slice(0, LIMITES.pasos.max).map((paso) => ({
    texto: texto(paso?.texto, LIMITES.textoPaso.max, true),
    fotos: (Array.isArray(paso?.fotos) ? paso.fotos : [])
      .slice(0, LIMITES.fotosPorPaso.max)
      .filter((f) => urlFotoValida(f?.url, API_BASE, MODO))
      .map((f) => ({ url: f.url, alt: texto(f.alt, LIMITES.altFoto.max) })),
  })).filter((paso) => paso.texto || paso.fotos.length);

  const opciones = (Array.isArray(p.celebracion?.opciones) ? p.celebracion.opciones : [])
    .slice(0, LIMITES.opcionesCelebracion.max)
    .map((o) => ({
      id: typeof o?.id === 'string' ? o.id : '',
      etiqueta: texto(o?.etiqueta, LIMITES.etiquetaOpcion.max),
      emoji: texto(o?.emoji, LIMITES.emojiOpcion.max),
    }))
    .filter((o) => o.id && o.etiqueta);

  return {
    plantilla: typeof p.plantilla === 'string' ? p.plantilla : '',
    de: texto(p.de, LIMITES.nombre.max) || 'Alguien especial',
    para: texto(p.para, LIMITES.nombre.max),
    pasos,
    pregunta: texto(p.pregunta, LIMITES.pregunta.max) || '¿Quieres ser mi pareja?',
    celebracion: {
      titulo: texto(p.celebracion?.titulo, LIMITES.tituloCelebracion.max) || '¿Dónde lo celebramos?',
      opciones,
    },
    mensajeFinal: texto(p.mensajeFinal, LIMITES.mensajeFinal.max, true),
  };
}

async function obtenerDatos() {
  if (vistaPrevia) {
    const guardada = leerAlmacen(sessionStorage, 'noviazgo:preview', null);
    if (!guardada) throw Object.assign(new Error('sin vista previa'), { codigo: 'no_encontrado' });
    return guardada;
  }
  if (!idPropuesta) throw Object.assign(new Error('sin id'), { codigo: 'no_encontrado' });
  return obtenerPropuesta(idPropuesta, claveCifrado);
}

/** Descarga y descifra una foto una sola vez; las siguientes veces reutiliza la URL blob:. */
function urlDeFoto(url) {
  let promesa = estado.fotos.get(url);
  if (!promesa) {
    promesa = cargarFoto(url, estado.claveFotos);
    promesa.catch(() => estado.fotos.delete(url)); // si falló, se puede reintentar más tarde
    estado.fotos.set(url, promesa);
  }
  return promesa;
}

const leerRespondida = () => (vistaPrevia ? null : leerAlmacen(localStorage, claveRespondida, null));
const guardarRespondida = (valor) => { if (!vistaPrevia) escribirAlmacen(localStorage, claveRespondida, valor); };

// ---------- Pasos ----------

function pintarFotos(contenedor, fotos) {
  vaciar(contenedor);
  contenedor.hidden = fotos.length === 0;
  contenedor.dataset.cantidad = String(fotos.length);
  for (const foto of fotos) {
    const img = crear('img', {
      atributos: {
        alt: foto.alt || 'Foto de un recuerdo', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
      },
    });
    const figura = crear('figure', { clase: 'foto', hijos: [img] });
    const quitar = () => {
      figura.remove();
      contenedor.dataset.cantidad = String(contenedor.children.length);
      if (!contenedor.children.length) contenedor.hidden = true;
    };
    img.addEventListener('error', quitar, { once: true });
    contenedor.append(figura);
    // Si la foto no se puede descargar o descifrar, el paso se muestra solo con el texto.
    urlDeFoto(foto.url).then((url) => { img.src = url; }, quitar);
  }
}

function precargar(indice) {
  const paso = estado.propuesta.pasos[indice];
  for (const foto of paso?.fotos ?? []) urlDeFoto(foto.url).catch(() => {});
}

function mostrarPaso(indice) {
  const { pasos } = estado.propuesta;
  if (!pasos.length) { mostrarPregunta(); return; }
  estado.paso = indice;
  const paso = pasos[indice];
  $('titulo-paso').textContent = `Paso ${indice + 1} de ${pasos.length}`;
  $('texto-paso').textContent = paso.texto;
  pintarFotos($('fotos-paso'), paso.fotos);

  const progreso = $('progreso-pasos');
  vaciar(progreso);
  pasos.forEach((_, i) => {
    progreso.append(crear('li', { clase: i === indice ? 'activo' : i < indice ? 'visto' : '' }));
  });
  progreso.hidden = pasos.length < 2;

  $('boton-atras').hidden = indice === 0;
  $('boton-siguiente').textContent = indice === pasos.length - 1 ? 'Continuar' : 'Siguiente';
  precargar(indice + 1);
  mostrarPantalla('paso', `Paso ${indice + 1} de ${pasos.length}`);
}

// ---------- Pregunta ----------

function mostrarPregunta() {
  const { propuesta, plantilla } = estado;
  $('saludo-pregunta').textContent = propuesta.para ? `${propuesta.para}…` : '';
  $('titulo-pregunta').textContent = propuesta.pregunta;
  const si = $('boton-si');
  const no = $('boton-no');
  si.textContent = plantilla.textoSi;
  no.textContent = plantilla.textoNo;
  si.style.setProperty('--escala-si', '1');
  mostrarPantalla('pregunta');

  if (!estado.controlNo) {
    estado.controlNo = activarBotonNo(no, si, {
      textos: plantilla.textosNo,
      alHuir(conteo) {
        // El "Sí" crece poco a poco (con tope) para que el juego sea divertido, no frustrante.
        si.style.setProperty('--escala-si', String(Math.min(1 + conteo * 0.07, 1.6)));
        estado.controlNo?.reacomodar();
        estado.emisor.intentoNo();
      },
    });
  }
}

function alDecirSi() {
  const si = $('boton-si').getBoundingClientRect();
  estado.emisor.si();
  const opciones = estado.propuesta.celebracion.opciones;
  guardarRespondida({ si: true, celebracion: null });
  lanzarParticulas(estado.plantilla.efecto, { origen: { x: si.left + si.width / 2, y: si.top + si.height / 2 } });
  if (opciones.length) mostrarCelebracion();
  else mostrarFinal(null, false);
}

// ---------- Celebración ----------

function mostrarCelebracion() {
  const { celebracion } = estado.propuesta;
  $('titulo-celebracion').textContent = celebracion.titulo;
  const grupo = $('opciones-celebracion');
  vaciar(grupo);
  grupo.append(crear('legend', { clase: 'visualmente-oculto', texto: celebracion.titulo }));
  celebracion.opciones.forEach((opcion, i) => {
    const entrada = crear('input', {
      clase: 'visualmente-oculto',
      atributos: { type: 'radio', name: 'opcion', value: opcion.id, id: `opcion-${i}`, required: true },
    });
    const etiqueta = crear('label', {
      clase: 'opcion-celebracion',
      atributos: { for: `opcion-${i}` },
      hijos: [
        opcion.emoji ? crear('span', { clase: 'opcion-emoji', texto: opcion.emoji, atributos: { 'aria-hidden': 'true' } }) : null,
        crear('span', { clase: 'opcion-texto', texto: opcion.etiqueta }),
      ],
    });
    grupo.append(entrada, etiqueta);
  });
  $('nota').value = '';
  $('contador-nota').textContent = `0 / ${LIMITES.nota.max}`;
  $('boton-enviar-celebracion').disabled = true;
  mostrarPantalla('celebracion');
}

function alEnviarCelebracion(e) {
  e.preventDefault();
  const elegida = new FormData(e.currentTarget).get('opcion');
  const opcion = estado.propuesta.celebracion.opciones.find((o) => o.id === elegida);
  if (!opcion) return;
  const nota = limpiarTexto($('nota').value, { multilinea: true }).slice(0, LIMITES.nota.max);
  estado.emisor.celebracion(opcion.id, nota);
  guardarRespondida({ si: true, celebracion: { id: opcion.id, etiqueta: opcion.etiqueta, emoji: opcion.emoji } });
  mostrarFinal(opcion, true);
}

// ---------- Final ----------

function mostrarFinal(opcion, conEfecto) {
  const { propuesta, plantilla } = estado;
  $('titulo-final').textContent = propuesta.mensajeFinal || plantilla.mensajeCelebracion;
  const detalle = $('detalle-final');
  detalle.hidden = !opcion;
  detalle.textContent = opcion ? `Plan: ${opcion.emoji ? `${opcion.emoji} ` : ''}${opcion.etiqueta}` : '';
  $('aviso-final').textContent = vistaPrevia
    ? 'En la vista previa no se avisa a nadie.'
    : `Le avisamos a ${propuesta.de}. 💌`;
  mostrarPantalla('final');
  if (conEfecto) lanzarParticulas(plantilla.efecto);
}

// ---------- Arranque ----------

async function iniciar() {
  mostrarPantalla('cargando', 'Preparando tu sorpresa');
  let datos;
  try {
    datos = await obtenerDatos();
    estado.propuesta = normalizar(datos);
    // v1 (sin cifrar) → null. Vista previa → la llave que dejó el generador.
    estado.claveFotos = datos.cifrada === false ? null : vistaPrevia ? datos.clave : claveCifrado;
  } catch (error) {
    mostrarError(error);
    return;
  }

  estado.plantilla = obtenerPlantilla(estado.propuesta.plantilla);
  await cargarPlantilla(estado.plantilla);
  $('escenario').dataset.plantilla = estado.plantilla.id;
  document.title = estado.propuesta.para ? `Una sorpresa para ${estado.propuesta.para} 💌` : 'Tienes una sorpresa 💌';
  $('saludo-paso').textContent = estado.propuesta.para ? `Para ${estado.propuesta.para}` : 'Para ti';

  if (!estado.emisor) {
    estado.emisor = crearEmisor(idPropuesta, { vistaPrevia, clave: datos.cifrada ? claveCifrado : null });
    estado.emisor.abierto();
  }

  const respondida = leerRespondida();
  if (respondida?.si) {
    const opciones = estado.propuesta.celebracion.opciones;
    if (!respondida.celebracion && opciones.length) mostrarCelebracion();
    else mostrarFinal(respondida.celebracion, false);
    return;
  }
  mostrarPaso(0);
}

function enlazar() {
  $('boton-reintentar').addEventListener('click', iniciar);
  $('boton-siguiente').addEventListener('click', () => {
    if (estado.paso < estado.propuesta.pasos.length - 1) mostrarPaso(estado.paso + 1);
    else mostrarPregunta();
  });
  $('boton-atras').addEventListener('click', () => mostrarPaso(Math.max(0, estado.paso - 1)));
  $('boton-si').addEventListener('click', alDecirSi);
  $('form-celebracion').addEventListener('change', (e) => {
    if (e.target.name === 'opcion') $('boton-enviar-celebracion').disabled = false;
  });
  $('nota').addEventListener('input', (e) => {
    $('contador-nota').textContent = `${largo(e.target.value)} / ${LIMITES.nota.max}`;
  });
  $('form-celebracion').addEventListener('submit', alEnviarCelebracion);
  $('boton-ver-de-nuevo').addEventListener('click', () => mostrarPaso(0));
}

$('nota').maxLength = LIMITES.nota.max;
if (vistaPrevia) $('aviso-vista-previa').hidden = false;
else mostrarAvisoDemo(MODO);
enlazar();
iniciar();
