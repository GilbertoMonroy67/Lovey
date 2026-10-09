// Implementación simulada de la API con localStorage (contrato §6.2).
// Misma interfaz y mismos errores que el Worker. Permite probar pregunta.html y
// respuestas.html en dos pestañas del mismo navegador.

import { LIMITES, PATRONES, TIPOS_EVENTO } from './limites.js';
import { ErrorApi, idAleatorio, leerAlmacen, limpiarTexto, largo } from './utilidades.js';
import { validarPropuesta } from './validacion.js';

const CLAVE_PROPUESTAS = 'noviazgo:mock:propuestas';
const CLAVE_FOTOS = 'noviazgo:mock:fotos';
const CLAVE_EVENTOS = 'noviazgo:mock:eventos';
const LATENCIA_MS = 300;
const DIA_MS = 24 * 60 * 60 * 1000;

const esperar = (ms = LATENCIA_MS) => new Promise((r) => setTimeout(r, ms));

function leer(clave) {
  return leerAlmacen(localStorage, clave, {});
}

function guardar(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
      throw new ErrorApi('capacidad_agotada',
        'El modo demostración se quedó sin espacio en este navegador. Usa menos fotos o borra propuestas antiguas.', 503);
    }
    throw new ErrorApi('interno', 'No se pudo guardar en el modo demostración.', 500);
  }
}

function blobADataUrl(blob) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(blob);
  });
}

async function tipoPorBytesMagicos(blob) {
  const cabecera = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (cabecera[0] === 0xff && cabecera[1] === 0xd8 && cabecera[2] === 0xff) return 'image/jpeg';
  const ascii = String.fromCharCode(...cabecera);
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function subirFoto(blob, { alProgresar } = {}) {
  // Progreso simulado para que la barra se vea igual que en modo api.
  for (const p of [0.25, 0.6, 0.9]) {
    alProgresar?.(p);
    await esperar(LATENCIA_MS / 3);
  }
  if (!(blob instanceof Blob)) throw new ErrorApi('tipo_no_soportado', 'El archivo no es una imagen válida.', 415);
  if (blob.size > LIMITES.fotoBytes) throw new ErrorApi('archivo_muy_grande', 'La foto pesa más de 500 KB.', 413);
  const tipo = await tipoPorBytesMagicos(blob);
  if (!tipo) throw new ErrorApi('tipo_no_soportado', 'Solo se aceptan fotos WebP o JPEG.', 415);

  const id = `f_${idAleatorio(16)}`;
  const dataUrl = (await blobADataUrl(blob)).replace(/^data:[^;]*;/, `data:${tipo};`);
  const fotos = leer(CLAVE_FOTOS);
  fotos[id] = { dataUrl, propuestaId: null, creadaEn: Date.now() };
  guardar(CLAVE_FOTOS, fotos);
  alProgresar?.(1);
  return { id, url: dataUrl, expiraEn: new Date(Date.now() + LIMITES.horasFotoHuerfana * 3600 * 1000).toISOString() };
}

export async function crearPropuesta(propuesta) {
  await esperar();
  if (new Blob([JSON.stringify(propuesta)]).size > LIMITES.cuerpoJsonBytes) {
    throw new ErrorApi('archivo_muy_grande', 'La propuesta es demasiado grande.', 413);
  }
  const { datos, detalles } = validarPropuesta(propuesta);
  if (detalles.length) throw new ErrorApi('validacion', 'Revisa los datos marcados.', 422, detalles);

  const fotos = leer(CLAVE_FOTOS);
  const ahora = Date.now();
  for (const paso of datos.pasos) {
    for (const foto of paso.fotos) {
      const guardada = fotos[foto.id];
      const huerfanaVencida = guardada && !guardada.propuestaId
        && ahora - guardada.creadaEn > LIMITES.horasFotoHuerfana * 3600 * 1000;
      if (!guardada || guardada.propuestaId || huerfanaVencida) {
        throw new ErrorApi('foto_invalida', 'Una de las fotos ya no está disponible. Vuelve a subirla.', 422);
      }
    }
  }

  const id = idAleatorio(12);
  const claveAdmin = idAleatorio(32);
  const ntfyTema = propuesta?.avisos?.push === true ? `noviazgo-${idAleatorio(24)}` : null;
  for (const paso of datos.pasos) for (const foto of paso.fotos) fotos[foto.id].propuestaId = id;

  const propuestas = leer(CLAVE_PROPUESTAS);
  propuestas[id] = {
    datos, claveAdmin, ntfyTema, creadaEn: ahora, expiraEn: ahora + LIMITES.diasExpiracion * DIA_MS,
  };
  guardar(CLAVE_PROPUESTAS, propuestas);
  guardar(CLAVE_FOTOS, fotos);
  return { id, claveAdmin, expiraEn: new Date(propuestas[id].expiraEn).toISOString(), ntfyTema };
}

function buscarPropuesta(id, { permitirExpirada = false } = {}) {
  if (!PATRONES.idPropuesta.test(String(id ?? ''))) {
    throw new ErrorApi('no_encontrado', 'Este enlace no existe o ya expiró.', 404);
  }
  const guardada = leer(CLAVE_PROPUESTAS)[id];
  if (!guardada) throw new ErrorApi('no_encontrado', 'Este enlace no existe o ya expiró.', 404);
  // Igual que el Worker: DELETE se permite aunque haya expirado.
  if (!permitirExpirada && guardada.expiraEn <= Date.now()) throw new ErrorApi('expirada', 'Este enlace ya expiró.', 410);
  return guardada;
}

export async function obtenerPropuesta(id) {
  await esperar();
  const guardada = buscarPropuesta(id);
  const fotos = leer(CLAVE_FOTOS);
  const datos = structuredClone(guardada.datos);
  datos.pasos.forEach((paso) => {
    paso.fotos = paso.fotos.map((f) => ({ ...f, url: fotos[f.id]?.dataUrl ?? '' }));
  });
  return {
    ...datos,
    id,
    creadaEn: new Date(guardada.creadaEn).toISOString(),
    expiraEn: new Date(guardada.expiraEn).toISOString(),
  };
}

/** Dispara y olvida: nunca lanza. */
export function enviarEvento(id, evento) {
  esperar(80).then(() => {
    try {
      registrarEvento(id, evento);
    } catch {
      /* el modo mock imita al servidor: los errores se ignoran del lado del cliente */
    }
  });
}

function registrarEvento(id, evento) {
  const propuesta = buscarPropuesta(id);
  if (!evento || !TIPOS_EVENTO.includes(evento.tipo) || !PATRONES.sesion.test(evento.sesion ?? '')) return;
  const todos = leer(CLAVE_EVENTOS);
  const lista = todos[id] ?? [];
  if (lista.length >= LIMITES.eventosPorPropuesta) return;

  const nuevo = { tipo: evento.tipo, sesion: evento.sesion };
  if (evento.tipo === 'intento_no') {
    const conteo = Number(evento.conteo);
    if (!Number.isInteger(conteo) || conteo < LIMITES.conteoIntentoNo.min || conteo > LIMITES.conteoIntentoNo.max) return;
    nuevo.conteo = conteo;
  } else if (evento.tipo === 'si') {
    if (lista.some((e) => e.tipo === 'si')) return; // duplicado
  } else if (evento.tipo === 'celebracion_elegida') {
    if (lista.filter((e) => e.tipo === 'celebracion_elegida').length >= LIMITES.celebracionesPorPropuesta) return;
    const opcion = propuesta.datos.celebracion?.opciones.find((o) => o.id === evento.opcionId);
    if (!opcion) return;
    nuevo.opcionId = opcion.id;
    const nota = limpiarTexto(evento.nota ?? '', { multilinea: true });
    if (largo(nota) > LIMITES.nota.max) return;
    if (nota) nuevo.nota = nota;
  }

  const contador = (leerAlmacen(localStorage, 'noviazgo:mock:cursor', 0) || 0) + 1;
  guardar('noviazgo:mock:cursor', contador);
  nuevo.id = contador;
  nuevo.creadoEn = new Date().toISOString();
  lista.push(nuevo);
  todos[id] = lista;
  guardar(CLAVE_EVENTOS, todos);
}

export async function obtenerEventos(id, claveAdmin, desde = 0) {
  await esperar();
  const propuesta = buscarPropuesta(id);
  if (!claveAdmin || claveAdmin !== propuesta.claveAdmin) {
    throw new ErrorApi('no_autorizado', 'La clave de este enlace no es válida.', 401);
  }
  const opciones = propuesta.datos.celebracion?.opciones ?? [];
  const etiquetaDe = (opcionId) => opciones.find((o) => o.id === opcionId)?.etiqueta ?? null;
  const todos = (leer(CLAVE_EVENTOS)[id] ?? []).map((e) => (
    e.tipo === 'celebracion_elegida' ? { ...e, etiqueta: etiquetaDe(e.opcionId), nota: e.nota ?? null } : e
  ));

  const nuevos = todos.filter((e) => e.id > (Number(desde) || 0)).slice(0, 100);
  const aperturas = todos.filter((e) => e.tipo === 'abierto');
  const si = todos.find((e) => e.tipo === 'si');
  const ultimaCelebracion = todos.filter((e) => e.tipo === 'celebracion_elegida').at(-1);

  return {
    eventos: nuevos,
    cursor: nuevos.length ? nuevos.at(-1).id : Number(desde) || 0,
    resumen: {
      abierto: aperturas.length > 0,
      vecesAbierto: aperturas.length,
      primeraApertura: aperturas[0]?.creadoEn ?? null,
      intentosNo: todos.filter((e) => e.tipo === 'intento_no').reduce((s, e) => s + e.conteo, 0),
      si: Boolean(si),
      siEn: si?.creadoEn ?? null,
      celebracion: ultimaCelebracion
        ? {
          opcionId: ultimaCelebracion.opcionId,
          etiqueta: ultimaCelebracion.etiqueta,
          nota: ultimaCelebracion.nota ?? null, // el Worker devuelve null sin nota
          en: ultimaCelebracion.creadoEn,
        }
        : null,
    },
    para: propuesta.datos.para,
    expiraEn: new Date(propuesta.expiraEn).toISOString(),
    ntfyTema: propuesta.ntfyTema,
  };
}

export async function borrarPropuesta(id, claveAdmin) {
  await esperar();
  const propuesta = buscarPropuesta(id, { permitirExpirada: true });
  if (!claveAdmin || claveAdmin !== propuesta.claveAdmin) {
    throw new ErrorApi('no_autorizado', 'La clave de este enlace no es válida.', 401);
  }
  const propuestas = leer(CLAVE_PROPUESTAS);
  const fotos = leer(CLAVE_FOTOS);
  const eventos = leer(CLAVE_EVENTOS);
  delete propuestas[id];
  delete eventos[id];
  for (const [idFoto, foto] of Object.entries(fotos)) if (foto.propuestaId === id) delete fotos[idFoto];
  guardar(CLAVE_PROPUESTAS, propuestas);
  guardar(CLAVE_FOTOS, fotos);
  guardar(CLAVE_EVENTOS, eventos);
}
