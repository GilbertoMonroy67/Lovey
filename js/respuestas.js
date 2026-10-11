// Panel de quien envía (respuestas.html, contrato §2.3).
// Sondeo cada 5 s con la pestaña visible, pausa al ocultarla y backoff 5 → 10 → 20 → 60 s ante errores.
// Sondeo adaptativo (contrato §2.3): 15 s tras 10 min sin eventos nuevos y 60 s cuando ya eligió
// celebración, para no gastar la cuota diaria de Workers y D1 con un panel abierto todo el día.
// Todo se pinta con textContent.

import { borrarPropuesta, MODO, obtenerEventos } from './api.js';
import { SONDEO_MS } from './config.js';
import { lanzarParticulas } from './particulas.js';
import { obtenerPlantilla } from './plantillas.js';
import {
  anunciar, copiarTexto, crear, enlacePregunta, enlaceRespuestas, formatearFechaHora, formatearHora,
  leerFragmento, leerMisPropuestas, mostrarAvisoDemo, quitarMiPropuesta, vaciar,
} from './utilidades.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id') ?? '';
// Ambas claves viven solo en el fragmento (#k=…&c=…): el navegador nunca las manda en la URL al servidor.
const clave = leerFragmento('k');
const claveCifrado = leerFragmento('c');
const BACKOFF = [5000, 10000, 20000, 60000];
const SONDEO_INACTIVO_MS = 15000;
const SONDEO_TERMINADO_MS = 60000;
const INACTIVIDAD_MS = 10 * 60 * 1000;

const estado = {
  cursor: 0, temporizador: 0, fallos: 0, detenido: false, enCurso: false, siPrevio: null, ultimoCambio: Date.now(),
};

function intervaloSondeo(resumen) {
  if (resumen?.celebracion) return SONDEO_TERMINADO_MS;
  return Date.now() - estado.ultimoCambio > INACTIVIDAD_MS ? SONDEO_INACTIVO_MS : SONDEO_MS;
}

// ---------- Resumen ----------

function dato({ icono, etiqueta, valor, detalle, clase }) {
  return crear('div', {
    clase: `dato-panel ${clase ?? ''}`,
    hijos: [
      crear('span', { clase: 'icono', texto: icono, atributos: { 'aria-hidden': 'true' } }),
      crear('span', { clase: 'etiqueta-dato', texto: etiqueta }),
      crear('span', { clase: 'valor', texto: valor }),
      detalle ? crear('span', { clase: 'detalle', texto: detalle }) : null,
    ],
  });
}

function pintarResumen(r, para) {
  const contenedor = $('resumen');
  vaciar(contenedor);
  const veces = r.vecesAbierto ?? 0;
  contenedor.append(
    dato({
      icono: '👀', etiqueta: 'Abrió el enlace',
      valor: r.abierto ? 'Sí ✓' : 'Todavía no',
      detalle: r.abierto
        ? `${veces} ${veces === 1 ? 'vez' : 'veces'} · la primera a las ${formatearHora(r.primeraApertura)}`
        : '',
      clase: r.abierto ? 'logrado' : '',
    }),
    dato({
      icono: '🙈', etiqueta: 'Intentos de decir «No»',
      valor: String(r.intentosNo ?? 0),
      detalle: r.intentosNo ? 'El botón huyó todas las veces 😄' : '',
    }),
    dato({
      icono: '💖', etiqueta: 'Respuesta',
      valor: r.si ? '¡Dijo que SÍ!' : 'Esperando…',
      detalle: r.si ? `A las ${formatearHora(r.siEn)}` : '',
      clase: r.si ? 'destacado' : '',
    }),
    dato({
      icono: '🎉', etiqueta: 'Dónde celebrar',
      valor: r.celebracion ? (r.celebracion.etiqueta ?? r.celebracion.opcionId ?? 'Elegida') : 'Sin elegir',
      detalle: r.celebracion?.nota ? `“${r.celebracion.nota}”` : '',
      clase: r.celebracion ? 'logrado' : '',
    }),
  );

  if (r.si && estado.siPrevio === false) {
    // Llegó el Sí mientras el panel estaba abierto: pequeña celebración.
    lanzarParticulas(obtenerPlantilla().efecto);
    anunciar($('anuncio'), `¡${para || 'Tu pareja'} dijo que sí!`);
  }
  estado.siPrevio = Boolean(r.si);
  document.title = r.si ? `💖 ¡Dijo que sí! · Respuestas` : `Respuestas${para ? ` de ${para}` : ''} · Noviazgo`;
}

// ---------- Línea de tiempo ----------

function describir(e) {
  switch (e.tipo) {
    case 'abierto': return ['👀', 'Abrió tu enlace'];
    case 'intento_no': return ['🙈', `Intentó decir que No (${e.conteo} ${e.conteo === 1 ? 'vez' : 'veces'})`];
    case 'si': return ['💖', '¡Dijo que SÍ!'];
    case 'celebracion_elegida':
      return ['🎉', `Eligió celebrar en: ${e.etiqueta ?? e.opcionId ?? 'una opción (cifrada)'}${e.nota ? `\n“${e.nota}”` : ''}`];
    default: return ['•', 'Evento'];
  }
}

function agregarEventos(eventos) {
  const lista = $('linea-tiempo');
  for (const e of eventos) {
    const [icono, texto] = describir(e);
    // Los más recientes arriba.
    lista.prepend(crear('li', {
      hijos: [
        crear('time', { texto: formatearHora(e.creadoEn), atributos: { datetime: e.creadoEn, title: formatearFechaHora(e.creadoEn) } }),
        crear('span', { texto: icono, atributos: { 'aria-hidden': 'true' } }),
        crear('span', { clase: 'texto-evento', texto }),
      ],
    }));
  }
  $('sin-eventos').hidden = lista.children.length > 0;
}

// ---------- Sondeo ----------

function estadoConexion(texto, error = false) {
  const el = $('estado-conexion');
  el.textContent = texto;
  el.classList.toggle('error', error);
}

function programar(ms) {
  clearTimeout(estado.temporizador);
  if (estado.detenido || document.visibilityState === 'hidden') return;
  estado.temporizador = setTimeout(consultar, ms);
}

function detener(titulo, texto) {
  estado.detenido = true;
  clearTimeout(estado.temporizador);
  for (const s of ['panel', 'seccion-linea', 'seccion-enlaces']) $(s).hidden = true;
  $('t-final-panel').textContent = titulo;
  $('texto-final-panel').textContent = texto;
  $('mensaje-final-panel').hidden = false;
}

async function consultar() {
  if (estado.detenido || estado.enCurso) return;
  estado.enCurso = true;
  try {
    let respuesta;
    do {
      respuesta = await obtenerEventos(id, clave, estado.cursor, claveCifrado);
      agregarEventos(respuesta.eventos ?? []);
      if ((respuesta.eventos ?? []).length) estado.ultimoCambio = Date.now();
      estado.cursor = respuesta.cursor ?? estado.cursor;
    } while ((respuesta.eventos ?? []).length >= 100);

    pintarResumen(respuesta.resumen ?? {}, respuesta.para);
    if (respuesta.para) {
      $('titulo-panel').textContent = `Respuestas de ${respuesta.para}`;
    }
    if (respuesta.llaveFaltante) {
      $('subtitulo-panel').textContent = 'Tu sorpresa está cifrada y a este enlace le falta la llave (&c=…): '
        + 'verás si abrió y si dijo que sí, pero no el nombre ni el plan elegido.';
    }
    $('info-expira').textContent = respuesta.expiraEn
      ? `La sorpresa y sus respuestas se borran solas el ${formatearFechaHora(respuesta.expiraEn)}.` : '';
    if (respuesta.ntfyTema) {
      $('info-ntfy').hidden = false;
      $('info-ntfy').textContent = `Avisos push activos en el tema de ntfy: ${respuesta.ntfyTema}`;
    }
    estado.fallos = 0;
    estadoConexion(`En vivo · actualizado ${formatearHora(new Date().toISOString())}`);
    programar(intervaloSondeo(respuesta.resumen));
  } catch (error) {
    if (error?.codigo === 'no_autorizado' || error?.estado === 401) {
      detener('Clave inválida', 'Este enlace privado no es correcto. Revisa que lo copiaste completo, incluida la parte #k=…');
    } else if (['no_encontrado', 'expirada'].includes(error?.codigo) || [404, 410].includes(error?.estado)) {
      quitarMiPropuesta(id);
      detener('Esta sorpresa ya no existe', 'Se borró o ya pasaron sus 30 días.');
    } else {
      const espera = BACKOFF[Math.min(estado.fallos, BACKOFF.length - 1)];
      estado.fallos += 1;
      estadoConexion(`Sin conexión · reintentando en ${Math.round(espera / 1000)} s`, true);
      programar(espera);
    }
  } finally {
    estado.enCurso = false;
  }
}

// ---------- Sin clave: Mis propuestas ----------

function mostrarSinClave() {
  $('sin-clave').hidden = false;
  const propuestas = leerMisPropuestas();
  $('bloque-mis').hidden = propuestas.length === 0;
  const lista = $('lista-mis-propuestas');
  for (const p of propuestas) {
    lista.append(crear('li', {
      hijos: [
        crear('span', { texto: `Para ${p.para || '—'} · ${formatearFechaHora(p.creadaEn)}` }),
        crear('a', { texto: 'Ver respuestas', atributos: { href: enlaceRespuestas(p.id, p.claveAdmin, p.claveCifrado) } }),
      ],
    }));
  }
}

// ---------- Arranque ----------

function iniciar() {
  mostrarAvisoDemo(MODO);
  if (!id || !clave) { mostrarSinClave(); return; }

  for (const s of ['panel', 'seccion-linea', 'seccion-enlaces']) $(s).hidden = false;
  $('enlace-pareja').value = enlacePregunta(id, claveCifrado);
  $('copiar-pareja').addEventListener('click', async () => {
    const ok = await copiarTexto($('enlace-pareja').value);
    $('confirmacion-pareja').textContent = ok ? '¡Copiado! ✓' : 'No se pudo copiar.';
    setTimeout(() => { $('confirmacion-pareja').textContent = ''; }, 2500);
  });

  $('boton-borrar').addEventListener('click', async (e) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('¿Borrar esta sorpresa? El enlace dejará de funcionar y se perderán las respuestas.')) return;
    const boton = e.currentTarget;
    boton.disabled = true;
    try {
      await borrarPropuesta(id, clave);
      quitarMiPropuesta(id);
      detener('Sorpresa borrada', 'El enlace ya no funciona y sus datos se eliminaron.');
    } catch (error) {
      boton.disabled = false;
      estadoConexion(error?.message || 'No se pudo borrar. Inténtalo de nuevo.', true);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') clearTimeout(estado.temporizador);
    else if (!estado.detenido) { estado.ultimoCambio = Date.now(); consultar(); }
  });
  window.addEventListener('online', () => { if (!estado.detenido) consultar(); });

  consultar();
}

iniciar();
