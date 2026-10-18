// Editor de pasos del generador: de 1 a 5 pasos, cada uno con texto y de 0 a 3 fotos.
// Se reordena con botones (sin arrastrar, por accesibilidad). Las fotos se comprimen
// y se suben en cuanto se eligen, con barra de progreso.
// v2.2 (contrato §15): como máximo 3 fotos en toda la propuesta, y cada subida usa el boleto de
// js/boleto.js (que se pide en paralelo con la compresión de la primera foto).

import { subirFoto } from './api.js';
import { conBoleto, prepararBoleto } from './boleto.js';
import { comprimirFoto } from './fotos.js';
import { LIMITES } from './limites.js';
import { anunciar, crear, largo, limpiarTexto, vaciar } from './utilidades.js';

const TEXTOS_SUGERIDOS = [
  'Desde que llegaste a mi vida, todo tiene más color. Tengo algo importante que decirte…',
  'Cada momento contigo se convierte en mi recuerdo favorito.',
  'Me encanta cómo te ríes, cómo me miras y cómo haces que todo sea más fácil.',
  'Así que preparé esto para ti, con todo mi cariño.',
  'Y ahora sí, la pregunta…',
];

let siguienteClave = 1;
const nuevaClave = () => `k${siguienteClave++}`;

/**
 * @param {HTMLOListElement} lista
 * @param {HTMLButtonElement} botonAgregar
 * @param {HTMLElement} regionAnuncio
 * @param {string} claveCifrado llave de la propuesta: cada foto se cifra con ella antes de subir
 */
export function crearEditorPasos(lista, botonAgregar, regionAnuncio, claveCifrado) {
  /** @type {{clave: string, texto: string, fotos: any[]}[]} */
  const pasos = [{ clave: nuevaClave(), texto: TEXTOS_SUGERIDOS[0], fotos: [] }];

  // Cuenta las fotos en proceso, subiendo y listas; no las que fallaron.
  const fotosTotales = () => pasos.reduce((n, p) => n + p.fotos.filter((f) => f.estado !== 'error').length, 0);
  const MAX_FOTOS = LIMITES.fotosTotales.max;
  const MENSAJE_MAXIMO = `Llegaste al máximo de ${MAX_FOTOS} fotos por propuesta.`;
  const MENSAJE_CUPO_DIARIO = `Ya subiste ${MAX_FOTOS} fotos hoy desde esta conexión. `
    + 'Puedes crear la propuesta con las que tienes o intentarlo mañana.';

  // Resumen global de fotos, encima de la lista de pasos.
  const contadorFotos = crear('p', { clase: 'contador-fotos', atributos: { 'aria-live': 'polite' } });
  const avisoFotos = crear('p', { clase: 'aviso-fotos', atributos: { hidden: true } });
  lista.before(crear('div', {
    clase: 'resumen-fotos',
    hijos: [
      crear('p', {
        clase: 'ayuda',
        texto: `Hasta ${MAX_FOTOS} fotos en toda la propuesta. Cada foto que subes cuenta para el límite de `
          + `${MAX_FOTOS} al día desde tu conexión, aunque después la quites.`,
      }),
      contadorFotos,
      avisoFotos,
    ],
  }));
  let mensajeExceso = ''; // "Solo se agregaron n foto(s)…", hasta el siguiente cambio de fotos
  let estabaLleno = false;

  function actualizarResumenFotos() {
    const total = fotosTotales();
    const texto = `Fotos: ${total} de ${MAX_FOTOS}`;
    if (contadorFotos.textContent !== texto) contadorFotos.textContent = texto;
    const lleno = total >= MAX_FOTOS;
    contadorFotos.classList.toggle('lleno', lleno);
    const aviso = [mensajeExceso, lleno && !mensajeExceso.includes(MENSAJE_MAXIMO) ? MENSAJE_MAXIMO : '']
      .filter(Boolean).join(' ');
    avisoFotos.textContent = aviso;
    avisoFotos.hidden = !aviso;
    // Se anuncia al llegar al máximo (si no lo anunció ya el aviso de exceso).
    if (lleno && !estabaLleno && !mensajeExceso) anunciar(regionAnuncio, MENSAJE_MAXIMO);
    estabaLleno = lleno;
  }

  // ---------- Fotos ----------

  function elementoFoto(paso, foto) {
    const hijos = [];
    if (foto.vistaUrl) {
      hijos.push(crear('img', { atributos: { src: foto.vistaUrl, alt: '' } }));
    } else {
      hijos.push(crear('div', { clase: 'foto-cargando', atributos: { 'aria-hidden': 'true' } }));
    }
    if (foto.estado === 'subiendo' || foto.estado === 'procesando') {
      hijos.push(crear('progress', {
        clase: 'progreso-foto',
        atributos: { max: '100', value: String(Math.round((foto.progreso ?? 0) * 100)), 'aria-label': 'Subiendo foto' },
      }));
      hijos.push(crear('span', {
        clase: 'estado-foto',
        texto: foto.estado === 'procesando' ? 'Optimizando…' : 'Subiendo…',
      }));
    } else if (foto.estado === 'error') {
      hijos.push(crear('span', { clase: 'estado-foto error', texto: foto.mensaje, atributos: { role: 'alert' } }));
    } else {
      const entradaAlt = crear('input', {
        atributos: {
          type: 'text',
          maxlength: String(LIMITES.altFoto.max),
          placeholder: 'Describe la foto (opcional)',
          'aria-label': 'Descripción de la foto, para lectores de pantalla',
        },
      });
      entradaAlt.value = foto.alt;
      entradaAlt.addEventListener('input', () => { foto.alt = entradaAlt.value; });
      hijos.push(entradaAlt);
    }
    const quitar = crear('button', {
      clase: 'boton-quitar-foto',
      texto: '✕',
      atributos: { type: 'button', 'aria-label': 'Quitar esta foto' },
    });
    quitar.addEventListener('click', () => {
      paso.fotos = paso.fotos.filter((f) => f !== foto);
      foto.cancelada = true;
      mensajeExceso = '';
      if (foto.vistaUrl) URL.revokeObjectURL(foto.vistaUrl);
      pintar({ clave: paso.clave, accion: 'subir-foto' });
      anunciar(regionAnuncio, 'Foto quitada.');
    });
    hijos.push(quitar);
    return crear('li', { clase: 'foto-editor', atributos: { 'data-foto': foto.clave }, hijos });
  }

  function actualizarFoto(paso, foto) {
    const actual = lista.querySelector(`[data-foto="${foto.clave}"]`);
    if (actual) actual.replaceWith(elementoFoto(paso, foto));
    actualizarEntradasFotos();
  }

  async function procesarFoto(paso, archivo) {
    const foto = { clave: nuevaClave(), estado: 'procesando', progreso: 0.05, alt: '', vistaUrl: '' };
    paso.fotos.push(foto);
    pintar();
    try {
      // El boleto se pide en paralelo con la compresión; varias fotos comparten la misma solicitud.
      const boletoListo = prepararBoleto();
      boletoListo.catch(() => { /* se informa abajo, al esperarlo */ });
      const { blob } = await comprimirFoto(archivo);
      if (foto.cancelada) return;
      foto.vistaUrl = URL.createObjectURL(blob);
      foto.estado = 'subiendo';
      foto.progreso = 0.1;
      actualizarFoto(paso, foto);
      await boletoListo;
      if (foto.cancelada) return;
      const resultado = await conBoleto((boleto) => subirFoto(blob, {
        clave: claveCifrado,
        boleto,
        alProgresar(p) {
          foto.progreso = p;
          const barra = lista.querySelector(`[data-foto="${foto.clave}"] progress`);
          if (barra) barra.value = Math.round(p * 100);
        },
      }));
      if (foto.cancelada) return;
      foto.id = resultado.id;
      foto.url = resultado.url;
      foto.estado = 'lista';
      actualizarFoto(paso, foto);
      anunciar(regionAnuncio, 'Foto lista.');
    } catch (error) {
      if (foto.cancelada) return;
      foto.estado = 'error';
      foto.mensaje = error?.mensaje || error?.message || 'No se pudo subir la foto. Puedes seguir sin ella.';
      if (error?.codigo === 'sin_conexion') foto.mensaje = 'No se pudo subir (sin conexión). Puedes quitarla y seguir.';
      // 429 de POST /fotos: cupo diario por conexión. Sin reintento (§15.5).
      if (error?.codigo === 'demasiadas_solicitudes' && error.origen !== 'boleto') foto.mensaje = MENSAJE_CUPO_DIARIO;
      actualizarFoto(paso, foto);
    }
  }

  function alElegirArchivos(paso, entrada) {
    const archivos = [...(entrada.files ?? [])];
    entrada.value = '';
    if (!archivos.length) return;
    const libresPaso = LIMITES.fotosPorPaso.max - paso.fotos.length;
    const libresTotal = MAX_FOTOS - fotosTotales();
    const cupo = Math.max(0, Math.min(libresPaso, libresTotal));
    mensajeExceso = '';
    if (archivos.length > cupo) {
      mensajeExceso = cupo === 0
        ? MENSAJE_MAXIMO
        : `Solo se agregaron ${cupo} foto(s): máximo ${MAX_FOTOS} por propuesta.`;
      const llenara = fotosTotales() + cupo >= MAX_FOTOS && !mensajeExceso.includes(MENSAJE_MAXIMO);
      anunciar(regionAnuncio, llenara ? `${mensajeExceso} ${MENSAJE_MAXIMO}` : mensajeExceso);
    }
    archivos.slice(0, cupo).forEach((archivo) => procesarFoto(paso, archivo));
    actualizarResumenFotos();
  }

  function actualizarEntradasFotos() {
    const total = fotosTotales();
    for (const paso of pasos) {
      const entrada = lista.querySelector(`[data-paso="${paso.clave}"] input[type="file"]`);
      if (entrada) entrada.disabled = paso.fotos.length >= LIMITES.fotosPorPaso.max || total >= MAX_FOTOS;
    }
    actualizarResumenFotos();
  }

  // ---------- Pasos ----------

  function mover(indice, delta) {
    const destino = indice + delta;
    if (destino < 0 || destino >= pasos.length) return;
    [pasos[indice], pasos[destino]] = [pasos[destino], pasos[indice]];
    pintar({ clave: pasos[destino].clave, accion: delta < 0 ? 'subir' : 'bajar' });
    anunciar(regionAnuncio, `Paso movido a la posición ${destino + 1}.`);
  }

  function quitarPaso(indice) {
    const [quitado] = pasos.splice(indice, 1);
    quitado.fotos.forEach((f) => { f.cancelada = true; if (f.vistaUrl) URL.revokeObjectURL(f.vistaUrl); });
    const siguiente = pasos[Math.min(indice, pasos.length - 1)];
    pintar({ clave: siguiente.clave, accion: 'texto' });
    anunciar(regionAnuncio, `Paso ${indice + 1} eliminado.`);
  }

  function elementoPaso(paso, i) {
    const idTexto = `texto-${paso.clave}`;
    const idError = `error-${paso.clave}`;
    const idContador = `contador-${paso.clave}`;

    const herramienta = (texto, etiqueta, accion, deshabilitado, alPulsar) => {
      const b = crear('button', {
        clase: 'boton-icono',
        texto,
        atributos: { type: 'button', 'aria-label': etiqueta, 'data-accion': accion, disabled: deshabilitado },
      });
      b.addEventListener('click', alPulsar);
      return b;
    };

    const area = crear('textarea', {
      atributos: {
        id: idTexto, rows: '3', maxlength: String(LIMITES.textoPaso.max), required: true,
        'data-accion': 'texto', 'aria-describedby': `${idContador} ${idError}`,
        placeholder: TEXTOS_SUGERIDOS[i] ?? 'Escribe algo bonito…',
      },
    });
    area.value = paso.texto;
    const contador = crear('span', { clase: 'contador', atributos: { id: idContador } });
    const error = crear('span', { clase: 'error-campo', atributos: { id: idError } });
    const actualizarContador = () => {
      const n = largo(area.value);
      contador.textContent = `${n} / ${LIMITES.textoPaso.max}`;
      contador.classList.toggle('excedido', n > LIMITES.textoPaso.max);
    };
    actualizarContador();
    area.addEventListener('input', () => {
      paso.texto = area.value;
      actualizarContador();
      if (limpiarTexto(area.value)) { error.textContent = ''; area.removeAttribute('aria-invalid'); }
    });

    const entradaArchivo = crear('input', {
      atributos: {
        type: 'file', accept: 'image/*', multiple: true, 'data-accion': 'subir-foto',
        id: `fotos-${paso.clave}`,
      },
    });
    entradaArchivo.addEventListener('change', () => alElegirArchivos(paso, entradaArchivo));

    const fotos = crear('ul', {
      clase: 'fotos-editor',
      atributos: { 'aria-label': `Fotos del paso ${i + 1}` },
      hijos: paso.fotos.map((f) => elementoFoto(paso, f)),
    });

    return crear('li', {
      clase: 'paso-editor',
      atributos: { 'data-paso': paso.clave },
      hijos: [
        crear('div', {
          clase: 'paso-cabecera',
          hijos: [
            crear('h3', { texto: `Paso ${i + 1}` }),
            crear('div', {
              clase: 'paso-herramientas',
              hijos: [
                herramienta('↑', `Subir el paso ${i + 1}`, 'subir', i === 0, () => mover(i, -1)),
                herramienta('↓', `Bajar el paso ${i + 1}`, 'bajar', i === pasos.length - 1, () => mover(i, 1)),
                herramienta('🗑', `Eliminar el paso ${i + 1}`, 'eliminar', pasos.length <= LIMITES.pasos.min, () => quitarPaso(i)),
              ],
            }),
          ],
        }),
        crear('div', {
          clase: 'campo',
          hijos: [
            crear('label', { texto: 'Palabras bonitas', atributos: { for: idTexto } }),
            area, contador, error,
          ],
        }),
        fotos,
        crear('div', {
          clase: 'fila-fotos',
          hijos: [
            crear('label', {
              clase: 'subir-foto',
              hijos: [
                entradaArchivo,
                crear('span', { clase: 'boton boton-secundario boton-chico', texto: '📷 Agregar fotos' }),
              ],
            }),
            crear('span', { clase: 'ayuda', texto: ' Se optimizan y se les quita la ubicación.' }),
          ],
        }),
      ],
    });
  }

  function pintar(foco) {
    vaciar(lista);
    pasos.forEach((paso, i) => lista.append(elementoPaso(paso, i)));
    botonAgregar.disabled = pasos.length >= LIMITES.pasos.max;
    botonAgregar.textContent = pasos.length >= LIMITES.pasos.max
      ? `Máximo ${LIMITES.pasos.max} pasos`
      : '+ Agregar otro paso';
    actualizarEntradasFotos();
    if (foco) {
      const nodo = lista.querySelector(`[data-paso="${foco.clave}"]`);
      let destino = nodo?.querySelector(`[data-accion="${foco.accion}"]`);
      if (!destino || destino.disabled) destino = nodo?.querySelector('[data-accion="texto"]');
      destino?.focus();
    }
  }

  botonAgregar.addEventListener('click', () => {
    if (pasos.length >= LIMITES.pasos.max) return;
    const paso = { clave: nuevaClave(), texto: '', fotos: [] };
    pasos.push(paso);
    pintar({ clave: paso.clave, accion: 'texto' });
    anunciar(regionAnuncio, `Paso ${pasos.length} agregado.`);
  });

  pintar();

  return {
    /** Pasos listos para el modelo §3.1 (sin fotos fallidas ni en proceso). */
    obtenerPasos({ conUrl = false } = {}) {
      return pasos.map((p) => ({
        texto: limpiarTexto(p.texto, { multilinea: true }),
        fotos: p.fotos.filter((f) => f.estado === 'lista').map((f) => {
          const foto = { id: f.id, alt: limpiarTexto(f.alt) };
          if (conUrl) foto.url = f.url;
          return foto;
        }),
      }));
    },
    fotosPendientes: () => pasos.some((p) => p.fotos.some((f) => f.estado === 'procesando' || f.estado === 'subiendo')),
    /** Marca los textos vacíos. Devuelve la lista de errores [{ mensaje, elemento }]. */
    validar() {
      const errores = [];
      pasos.forEach((paso, i) => {
        const nodo = lista.querySelector(`[data-paso="${paso.clave}"]`);
        const area = nodo?.querySelector('textarea');
        const error = nodo?.querySelector('.error-campo');
        const n = largo(limpiarTexto(paso.texto, { multilinea: true }));
        let mensaje = '';
        if (n < LIMITES.textoPaso.min) mensaje = `Escribe algo en el paso ${i + 1}.`;
        else if (n > LIMITES.textoPaso.max) mensaje = `El paso ${i + 1} admite como máximo ${LIMITES.textoPaso.max} caracteres.`;
        if (error) error.textContent = mensaje;
        if (mensaje) { area?.setAttribute('aria-invalid', 'true'); errores.push({ mensaje, elemento: area }); }
        else area?.removeAttribute('aria-invalid');
      });
      return errores;
    },
    /** Elemento del textarea de un paso (para enfocar errores del servidor). */
    textareaDePaso: (i) => lista.querySelectorAll('textarea')[i] ?? null,
  };
}
