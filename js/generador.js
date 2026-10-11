// Generador (index.html): datos, galería de plantillas, pasos, pregunta, celebración,
// avisos, vista previa y creación del enlace vía js/api.js.

import { crearPropuesta, generarClave, MODO } from './api.js';
import { CELEBRACIONES, TITULO_CELEBRACION } from './celebraciones.js';
import { crearEditorPasos } from './editor-pasos.js';
import { LIMITES, PLANTILLA_POR_DEFECTO } from './limites.js';
import { TURNSTILE_SITIO } from './config.js';
import { cargarTodas, obtenerPlantilla, PLANTILLAS } from './plantillas.js';
import {
  anunciar, copiarTexto, crear, enlacePregunta, enlaceRespuestas, escribirAlmacen, formatearFechaHora,
  guardarMiPropuesta, largo, leerMisPropuestas, limpiarTexto, mostrarAvisoDemo, vaciar,
} from './utilidades.js';

const $ = (id) => document.getElementById(id);
const regionAnuncio = $('anuncio');

const PREGUNTAS = {
  novia: '¿Quieres ser mi novia?',
  novio: '¿Quieres ser mi novio?',
  esposa: '¿Quieres casarte conmigo?',
  esposo: '¿Quieres casarte conmigo?',
  cita: '¿Quieres salir conmigo?',
  otro: '',
};

let preguntaEditada = false;
const personalizadas = []; // [{ etiqueta, emoji }]

// Llave de cifrado de esta propuesta: se genera aquí, cifra el contenido y las fotos, y solo
// sale del navegador dentro del fragmento #c= de los enlaces. "Crear otra" recarga y crea una nueva.
const claveCifrado = generarClave();

// ---------- Protección contra bots (Turnstile, opcional) ----------

const turnstileActivo = Boolean(TURNSTILE_SITIO) && MODO === 'api';
let tokenTurnstile = '';
let widgetTurnstile = null;

function iniciarTurnstile() {
  if (!turnstileActivo) return;
  const caja = $('turnstile');
  caja.hidden = false;
  window.alCargarTurnstile = () => {
    widgetTurnstile = window.turnstile.render(caja, {
      sitekey: TURNSTILE_SITIO,
      language: 'es',
      callback: (token) => { tokenTurnstile = token; },
      'expired-callback': () => { tokenTurnstile = ''; },
      'error-callback': () => { tokenTurnstile = ''; },
    });
  };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=alCargarTurnstile';
  script.async = true;
  document.head.append(script);
}

function reiniciarTurnstile() {
  tokenTurnstile = '';
  if (widgetTurnstile !== null) window.turnstile?.reset(widgetTurnstile);
}

// ---------- Datos básicos ----------

const tipoActual = () => document.querySelector('input[name="tipo"]:checked')?.value ?? 'novia';

function actualizarPreguntaSugerida() {
  const entrada = $('pregunta');
  const sugerida = PREGUNTAS[tipoActual()];
  entrada.placeholder = sugerida || 'Escribe tu pregunta, por ejemplo: ¿Vamos juntos al baile?';
  if (!preguntaEditada) entrada.value = sugerida;
  actualizarMiniPreguntas();
}

function actualizarMiniPreguntas() {
  const texto = limpiarTexto($('pregunta').value) || PREGUNTAS[tipoActual()] || '¿Quieres…?';
  document.querySelectorAll('.mini-pregunta').forEach((p) => { p.textContent = texto; });
}

const CAMPOS_TEXTO = [
  { id: 'de', limite: LIMITES.nombre, nombre: 'Tu nombre' },
  { id: 'para', limite: LIMITES.nombre, nombre: 'Su nombre' },
  { id: 'pregunta', limite: LIMITES.pregunta, nombre: 'La pregunta' },
  { id: 'titulo-celebracion', limite: LIMITES.tituloCelebracion, nombre: 'El título', soloSiHayOpciones: true },
];

function validarCampo({ id, limite, nombre, soloSiHayOpciones }) {
  const entrada = $(id);
  const error = $(`error-${id}`);
  const n = largo(limpiarTexto(entrada.value));
  let mensaje = '';
  const aplica = !soloSiHayOpciones || opcionesElegidas().length > 0;
  if (aplica && n < limite.min) mensaje = `${nombre} es obligatorio.`;
  else if (n > limite.max) mensaje = `${nombre} admite como máximo ${limite.max} caracteres.`;
  error.textContent = mensaje;
  if (mensaje) entrada.setAttribute('aria-invalid', 'true');
  else entrada.removeAttribute('aria-invalid');
  return mensaje ? { mensaje, elemento: entrada } : null;
}

// ---------- Galería de plantillas ----------

function pintarGaleria() {
  const galeria = $('galeria');
  vaciar(galeria);
  galeria.append(crear('legend', { clase: 'visualmente-oculto', texto: 'Plantillas' }));
  for (const p of PLANTILLAS) {
    const idDesc = `desc-${p.id}`;
    const decoracion = crear('div', {
      clase: 'decoracion',
      hijos: [1, 2, 3, 4].map(() => crear('span', { clase: 'deco' })),
    });
    const mini = crear('div', {
      clase: 'mini-render',
      atributos: { 'data-plantilla': p.id, 'aria-hidden': 'true' },
      hijos: [
        decoracion,
        crear('div', {
          clase: 'mini-tarjeta',
          hijos: [
            crear('p', { clase: 'mini-pregunta' }),
            crear('div', {
              clase: 'mini-botones',
              hijos: [
                crear('span', { clase: 'mini-si', texto: p.textoSi }),
                crear('span', { clase: 'mini-no', texto: p.textoNo }),
              ],
            }),
          ],
        }),
      ],
    });
    const entrada = crear('input', {
      atributos: {
        type: 'radio', name: 'plantilla', value: p.id, 'aria-label': p.nombre, 'aria-describedby': idDesc,
        checked: p.id === PLANTILLA_POR_DEFECTO,
      },
    });
    galeria.append(crear('label', {
      clase: 'tarjeta-plantilla',
      atributos: { 'data-ideal': p.ideal.join(',') },
      hijos: [
        entrada,
        crear('div', {
          clase: 'marco',
          hijos: [
            mini,
            crear('div', {
              clase: 'info-plantilla',
              hijos: [
                crear('strong', { texto: p.nombre }),
                crear('span', { texto: p.descripcion, atributos: { id: idDesc } }),
              ],
            }),
          ],
        }),
        crear('span', { clase: 'check', texto: '✓', atributos: { 'aria-hidden': 'true' } }),
      ],
    }));
  }
  actualizarMiniPreguntas();
}

const plantillaActual = () =>
  obtenerPlantilla(document.querySelector('input[name="plantilla"]:checked')?.value);

function aplicarFiltro(boton) {
  const filtro = boton.dataset.filtro;
  document.querySelectorAll('.chip-filtro').forEach((b) => b.setAttribute('aria-pressed', String(b === boton)));
  const tipos = filtro === 'todas' ? null : filtro.split(',');
  let visibles = 0;
  document.querySelectorAll('.tarjeta-plantilla').forEach((tarjeta) => {
    const ideal = tarjeta.dataset.ideal.split(',');
    const mostrar = !tipos || tipos.some((t) => ideal.includes(t));
    // Nunca se oculta la plantilla elegida, para que la selección siga visible.
    const elegida = tarjeta.querySelector('input').checked;
    tarjeta.hidden = !mostrar && !elegida;
    if (!tarjeta.hidden) visibles += 1;
  });
  anunciar(regionAnuncio, `${visibles} plantillas visibles.`);
}

function alCambiarPlantilla() {
  $('mensaje-final').placeholder = plantillaActual().mensajeCelebracion;
}

// ---------- Celebración ----------

function pintarPredefinidas() {
  const contenedor = $('opciones-predefinidas');
  for (const op of CELEBRACIONES) {
    contenedor.append(crear('label', {
      clase: 'casilla',
      hijos: [
        crear('input', { atributos: { type: 'checkbox', name: 'celebracion', value: op.id, checked: op.marcada } }),
        crear('span', { texto: `${op.emoji} ${op.etiqueta}` }),
      ],
    }));
  }
}

function opcionesElegidas() {
  const predefinidas = [...document.querySelectorAll('input[name="celebracion"]:checked')]
    .map((c) => CELEBRACIONES.find((op) => op.id === c.value))
    .filter(Boolean)
    .map(({ id, etiqueta, emoji }) => ({ id, etiqueta, emoji }));
  const propias = personalizadas.map((op, i) => {
    const opcion = { id: `c${i + 1}`, etiqueta: op.etiqueta };
    if (op.emoji) opcion.emoji = op.emoji;
    return opcion;
  });
  return [...predefinidas, ...propias];
}

function actualizarCupoOpciones() {
  const total = opcionesElegidas().length;
  const max = LIMITES.opcionesCelebracion.max;
  const lleno = total >= max;
  document.querySelectorAll('input[name="celebracion"]').forEach((c) => { c.disabled = lleno && !c.checked; });
  $('agregar-opcion').disabled = lleno;
  $('contador-opciones').textContent = total === 0
    ? 'Sin opciones: después del «Sí» se mostrará directamente el mensaje final.'
    : `${total} de ${max} opciones.`;
}

function pintarPersonalizadas() {
  const lista = $('lista-personalizadas');
  vaciar(lista);
  personalizadas.forEach((op, i) => {
    const quitar = crear('button', {
      clase: 'boton boton-fantasma boton-chico',
      texto: 'Quitar',
      atributos: { type: 'button', 'aria-label': `Quitar la opción ${op.etiqueta}` },
    });
    quitar.addEventListener('click', () => {
      personalizadas.splice(i, 1);
      pintarPersonalizadas();
      $('texto-opcion').focus();
      anunciar(regionAnuncio, 'Opción quitada.');
    });
    lista.append(crear('li', {
      hijos: [crear('span', { texto: `${op.emoji ? `${op.emoji} ` : ''}${op.etiqueta}` }), quitar],
    }));
  });
  actualizarCupoOpciones();
}

function agregarPersonalizada() {
  const error = $('error-opciones');
  const etiqueta = limpiarTexto($('texto-opcion').value);
  const emoji = limpiarTexto($('emoji-opcion').value);
  error.textContent = '';
  if (largo(etiqueta) < LIMITES.etiquetaOpcion.min) { error.textContent = 'Escribe el nombre de la opción.'; $('texto-opcion').focus(); return; }
  if (largo(etiqueta) > LIMITES.etiquetaOpcion.max) { error.textContent = `Máximo ${LIMITES.etiquetaOpcion.max} caracteres.`; return; }
  if (emoji.length > LIMITES.emojiOpcion.max) { error.textContent = 'Usa un solo emoji.'; $('emoji-opcion').focus(); return; }
  if (opcionesElegidas().length >= LIMITES.opcionesCelebracion.max) {
    error.textContent = `Máximo ${LIMITES.opcionesCelebracion.max} opciones.`; return;
  }
  personalizadas.push({ etiqueta, emoji });
  $('texto-opcion').value = '';
  $('emoji-opcion').value = '';
  pintarPersonalizadas();
  $('texto-opcion').focus();
  anunciar(regionAnuncio, `Opción «${etiqueta}» agregada.`);
}

// ---------- Propuesta ----------

function construirPropuesta(editor, { conUrl = false } = {}) {
  const opciones = opcionesElegidas();
  const propuesta = {
    plantilla: plantillaActual().id,
    tipo: tipoActual(),
    de: limpiarTexto($('de').value),
    para: limpiarTexto($('para').value),
    pasos: editor.obtenerPasos({ conUrl }),
    pregunta: limpiarTexto($('pregunta').value),
    mensajeFinal: limpiarTexto($('mensaje-final').value, { multilinea: true }),
    avisos: { push: $('avisos-push').checked },
  };
  if (opciones.length) {
    propuesta.celebracion = {
      titulo: limpiarTexto($('titulo-celebracion').value) || TITULO_CELEBRACION,
      opciones,
    };
  }
  return propuesta;
}

function mostrarErrores(errores) {
  const resumen = $('resumen-errores');
  vaciar(resumen);
  if (!errores.length) { resumen.hidden = true; return; }
  resumen.append(
    crear('strong', { texto: 'Revisa estos detalles antes de continuar:' }),
    crear('ul', { hijos: errores.map((e) => crear('li', { texto: e.mensaje })) }),
  );
  resumen.hidden = false;
  const primero = errores.find((e) => e.elemento)?.elemento;
  if (primero) primero.focus();
  else resumen.focus();
}

function validarTodo(editor) {
  const errores = [];
  for (const campo of CAMPOS_TEXTO) {
    const e = validarCampo(campo);
    if (e) errores.push(e);
  }
  errores.push(...editor.validar());
  return errores;
}

/** Traduce los `detalles` del 422 a los campos del formulario. */
function erroresDelServidor(error, editor) {
  const mapa = { de: $('de'), para: $('para'), pregunta: $('pregunta'), 'celebracion.titulo': $('titulo-celebracion') };
  return (error.detalles ?? []).map((d) => {
    const paso = /^pasos\.(\d+)\.texto$/.exec(d.campo ?? '');
    return { mensaje: d.mensaje, elemento: paso ? editor.textareaDePaso(Number(paso[1])) : mapa[d.campo] ?? null };
  });
}

function abrirVistaPrevia(editor) {
  const propuesta = construirPropuesta(editor, { conUrl: true });
  const datos = {
    ...propuesta,
    de: propuesta.de || 'Tu nombre',
    para: propuesta.para || 'Tu persona favorita',
    pregunta: propuesta.pregunta || PREGUNTAS[propuesta.tipo] || '¿Quieres…?',
  };
  delete datos.avisos;
  // Las fotos subidas ya están cifradas: la vista previa necesita la llave para mostrarlas.
  datos.clave = claveCifrado;
  let guardado = escribirAlmacen(sessionStorage, 'noviazgo:preview', datos);
  if (!guardado) {
    // Fotos en data URL (modo demostración) pueden no caber: se muestra sin ellas.
    datos.pasos = datos.pasos.map((p) => ({ ...p, fotos: [] }));
    guardado = escribirAlmacen(sessionStorage, 'noviazgo:preview', datos);
    anunciar(regionAnuncio, 'La vista previa se muestra sin fotos porque no caben en la memoria del navegador.');
  }
  if (!guardado) { mostrarErrores([{ mensaje: 'Tu navegador no permite abrir la vista previa.' }]); return; }
  // Sin noopener: así la pestaña nueva hereda el sessionStorage con la vista previa.
  const ventana = window.open('pregunta.html?preview=1', '_blank');
  if (!ventana) location.href = 'pregunta.html?preview=1';
}

async function crear_(editor) {
  const boton = $('boton-crear');
  mostrarErrores([]);
  const errores = validarTodo(editor);
  if (editor.fotosPendientes()) errores.push({ mensaje: 'Espera a que terminen de subir las fotos.' });
  if (turnstileActivo && !tokenTurnstile) {
    errores.push({ mensaje: 'Espera a que termine la verificación de seguridad (el recuadro de abajo).' });
  }
  if (errores.length) { mostrarErrores(errores); return; }

  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Creando…';
  try {
    const propuesta = construirPropuesta(editor);
    const respuesta = await crearPropuesta(propuesta, { clave: claveCifrado, turnstile: tokenTurnstile });
    guardarMiPropuesta({
      id: respuesta.id,
      claveAdmin: respuesta.claveAdmin,
      claveCifrado,
      para: propuesta.para,
      creadaEn: new Date().toISOString(),
    });
    mostrarResultado(respuesta);
  } catch (error) {
    const detalles = error?.codigo === 'validacion' ? erroresDelServidor(error, editor) : [];
    mostrarErrores(detalles.length ? detalles : [{ mensaje: error?.message || 'No se pudo crear el enlace. Inténtalo de nuevo.' }]);
  } finally {
    if (turnstileActivo) reiniciarTurnstile(); // cada token sirve una sola vez
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// ---------- Resultado ----------

function confirmarCopia(boton, salida, ok) {
  salida.textContent = ok ? '¡Copiado! ✓' : 'No se pudo copiar; selecciona el texto y cópialo a mano.';
  const original = boton.dataset.texto ?? boton.textContent;
  boton.dataset.texto = original;
  if (ok) boton.textContent = '¡Copiado! ✓';
  setTimeout(() => { boton.textContent = original; salida.textContent = ''; }, 2500);
}

function mostrarResultado({ id, claveAdmin, expiraEn, ntfyTema }) {
  const pareja = enlacePregunta(id, claveCifrado);
  const privado = enlaceRespuestas(id, claveAdmin, claveCifrado);
  $('enlace-pareja').value = pareja;
  $('enlace-respuestas').value = privado;
  $('abrir-pareja').href = pareja;
  $('abrir-respuestas').href = privado;
  $('caja-ntfy').hidden = !ntfyTema;
  if (ntfyTema) {
    $('tema-ntfy').value = ntfyTema;
    $('abrir-ntfy').href = `https://ntfy.sh/${encodeURIComponent(ntfyTema)}`;
  }
  $('expira').textContent = expiraEn ? `El enlace funciona hasta el ${formatearFechaHora(expiraEn)}.` : '';
  $('form-generador').hidden = true;
  $('resultado').hidden = false;
  $('t-resultado').focus();
  window.scrollTo({ top: $('resultado').offsetTop - 16 });
  pintarMisPropuestas();
}

function pintarMisPropuestas() {
  const propuestas = leerMisPropuestas();
  const lista = $('lista-mis-propuestas');
  vaciar(lista);
  $('mis-propuestas').hidden = propuestas.length === 0;
  for (const p of propuestas) {
    const fecha = formatearFechaHora(p.creadaEn);
    lista.append(crear('li', {
      hijos: [
        crear('span', { texto: `Para ${p.para || '—'}${fecha ? ` · ${fecha}` : ''}` }),
        crear('a', {
          texto: 'Ver respuestas',
          atributos: {
            href: enlaceRespuestas(p.id, p.claveAdmin, p.claveCifrado), target: '_blank', rel: 'noopener noreferrer',
          },
        }),
      ],
    }));
  }
}

// ---------- Arranque ----------

function iniciar() {
  mostrarAvisoDemo(MODO);
  cargarTodas();

  for (const { id, limite } of CAMPOS_TEXTO) $(id).maxLength = limite.max;
  $('mensaje-final').maxLength = LIMITES.mensajeFinal.max;
  $('texto-opcion').maxLength = LIMITES.etiquetaOpcion.max;
  $('emoji-opcion').maxLength = LIMITES.emojiOpcion.max;
  $('titulo-celebracion').value = TITULO_CELEBRACION;

  pintarGaleria();
  pintarPredefinidas();
  pintarPersonalizadas();
  actualizarPreguntaSugerida();
  alCambiarPlantilla();
  pintarMisPropuestas();

  const editor = crearEditorPasos($('lista-pasos'), $('agregar-paso'), regionAnuncio, claveCifrado);
  iniciarTurnstile();

  const contadorMensaje = () => {
    $('contador-mensaje').textContent = `${largo($('mensaje-final').value)} / ${LIMITES.mensajeFinal.max}`;
  };
  contadorMensaje();
  $('mensaje-final').addEventListener('input', contadorMensaje);

  $('tipos').addEventListener('change', actualizarPreguntaSugerida);
  $('pregunta').addEventListener('input', () => {
    preguntaEditada = $('pregunta').value.trim() !== '';
    actualizarMiniPreguntas();
  });
  for (const campo of CAMPOS_TEXTO) {
    $(campo.id).addEventListener('blur', () => { if ($(campo.id).value) validarCampo(campo); });
    $(campo.id).addEventListener('input', () => {
      if ($(campo.id).getAttribute('aria-invalid') === 'true') validarCampo(campo);
    });
  }

  $('galeria').addEventListener('change', alCambiarPlantilla);
  $('filtros-plantilla').addEventListener('click', (e) => {
    const boton = e.target.closest('.chip-filtro');
    if (boton) aplicarFiltro(boton);
  });

  $('opciones-predefinidas').addEventListener('change', actualizarCupoOpciones);
  $('agregar-opcion').addEventListener('click', agregarPersonalizada);
  $('texto-opcion').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); agregarPersonalizada(); }
  });

  $('boton-vista-previa').addEventListener('click', () => abrirVistaPrevia(editor));
  $('form-generador').addEventListener('submit', (e) => { e.preventDefault(); crear_(editor); });

  $('copiar-pareja').addEventListener('click', async (e) => {
    confirmarCopia(e.currentTarget, $('confirmacion-pareja'), await copiarTexto($('enlace-pareja').value));
  });
  $('copiar-respuestas').addEventListener('click', async (e) => {
    confirmarCopia(e.currentTarget, $('confirmacion-respuestas'), await copiarTexto($('enlace-respuestas').value));
  });
  if (typeof navigator.share === 'function') {
    $('compartir-pareja').hidden = false;
    $('compartir-pareja').addEventListener('click', () => {
      navigator.share({
        title: 'Tienes una sorpresa 💌',
        text: 'Preparé algo para ti. Ábrelo cuando tengas un momento 💌',
        url: $('enlace-pareja').value,
      }).catch(() => { /* la persona canceló */ });
    });
  }
  // Empezar de cero: las fotos ya quedaron asociadas a la propuesta creada y no se pueden reutilizar.
  $('crear-otra').addEventListener('click', () => { location.href = location.pathname; });
}

iniciar();
