// Implementación simulada de la API con localStorage (contrato §6.2).
// Misma interfaz y mismos errores que el Worker. Permite probar pregunta.html y
// respuestas.html en dos pestañas del mismo navegador.
// Igual que el Worker v2, solo guarda el sobre cifrado y fotos cifradas: el cifrado lo hace js/api.js.
// v2.2 (contrato §15.8): simula el Worker CON Turnstile activo (sin siteverify): boletos de subida,
// cupo diario de 3 fotos por "conexión" (este navegador) y fallos inyectables de un solo disparo.

import { LIMITES, PATRONES, TIPOS_EVENTO, VERSION_PROPUESTA } from './limites.js';
import { ErrorApi, idAleatorio, leerAlmacen } from './utilidades.js';

const CLAVE_PROPUESTAS = 'noviazgo:mock:propuestas';
const CLAVE_FOTOS = 'noviazgo:mock:fotos';
const CLAVE_EVENTOS = 'noviazgo:mock:eventos';
const CLAVE_BOLETOS = 'noviazgo:mock:boletos';
const CLAVE_CUPO_FOTOS = 'noviazgo:mock:cupo-fotos';
const CLAVE_FALLO = 'noviazgo:mock:fallo';
const CUPO_FOTOS_DIA = 3; // igual que el Worker: 3 fotos por IP y día UTC (§15.3)
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

/** Bytes → base64 estándar, por bloques para no desbordar la pila con fotos grandes. */
function aBase64(bytes) {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

const pareceImagen = (b) => (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
  || String.fromCharCode(...b.subarray(0, 4)) === 'RIFF';

const cifradoValido = (texto, max) => typeof texto === 'string' && texto.length >= 40 && texto.length <= max
  && PATRONES.cifrado.test(texto);

const errorValidacion = (campo, mensaje) => new ErrorApi('validacion', 'Algunos datos no son válidos.', 422, [{ campo, mensaje }]);

// ---------- Boletos de subida (§15.1, §15.8) ----------

const MENSAJES = {
  boleto_ausente: [401, 'Falta la verificación de seguridad para subir fotos.'],
  boleto_invalido: [401, 'La verificación de seguridad no es válida. Vuelve a intentarlo.'],
  boleto_vencido: [401, 'La verificación de seguridad venció. Vuelve a intentarlo.'],
  boleto_agotado: [403, 'Esta verificación ya se usó por completo.'],
  demasiadas_solicitudes: [429, 'Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.'],
  verificacion_bot: [403, 'No pudimos verificar que eres una persona. Recarga la página e inténtalo de nuevo.'],
};
const errorCodigo = (codigo) => new ErrorApi(codigo, MENSAJES[codigo][1], MENSAJES[codigo][0]);

/** Fallo inyectado de un solo disparo: si la clave trae uno de `posibles`, se borra y se lanza. */
function falloInyectado(posibles) {
  let fallo = null;
  try { fallo = localStorage.getItem(CLAVE_FALLO); } catch { /* almacenamiento bloqueado */ }
  if (!fallo || !posibles.includes(fallo)) return;
  try { localStorage.removeItem(CLAVE_FALLO); } catch { /* nada */ }
  throw errorCodigo(fallo);
}

const aBase64Url = (texto) => btoa(String.fromCharCode(...new TextEncoder().encode(texto)))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

function deBase64Url(texto) {
  const b64 = texto.replaceAll('-', '+').replaceAll('_', '/');
  const binario = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
}

const FORMA_BOLETO = /^b1\.([A-Za-z0-9_-]{40,120})\.([A-Za-z0-9_-]{43})$/;
const ALFABETO_FIRMA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export async function obtenerBoleto() {
  await esperar();
  falloInyectado(['verificacion_bot']); // el token se ignora: Turnstile simulado siempre pasa
  const n = idAleatorio(16);
  const exp = Math.floor(Date.now() / 1000) + LIMITES.minutosBoleto * 60;
  const P = aBase64Url(JSON.stringify({ v: 1, n, exp, f: LIMITES.fotosPorBoleto }));
  // La "firma" es aleatoria: el mock la recuerda y así detecta boletos alterados.
  const F = Array.from(crypto.getRandomValues(new Uint8Array(43)), (b) => ALFABETO_FIRMA[b % 64]).join('');
  const boletos = leer(CLAVE_BOLETOS);
  const ahoraS = Math.floor(Date.now() / 1000);
  for (const [clave, b] of Object.entries(boletos)) if (!(b?.exp > ahoraS)) delete boletos[clave]; // limpieza
  boletos[n] = { exp, fotos: 0, propuesta: false, firma: F };
  guardar(CLAVE_BOLETOS, boletos);
  return { boleto: `b1.${P}.${F}`, expiraEn: new Date(exp * 1000).toISOString(), fotos: LIMITES.fotosPorBoleto };
}

/** Como verificarBoleto del Worker: forma → firma → contenido → vigencia. */
function verificarBoleto(boleto) {
  const m = typeof boleto === 'string' && boleto.length <= 200 ? FORMA_BOLETO.exec(boleto) : null;
  if (!m) throw errorCodigo('boleto_invalido');
  let datos;
  try { datos = JSON.parse(deBase64Url(m[1])); } catch { throw errorCodigo('boleto_invalido'); }
  const guardado = leer(CLAVE_BOLETOS)[datos?.n];
  if (!guardado || guardado.firma !== m[2] || datos.v !== 1 || datos.exp !== guardado.exp
    || !Number.isInteger(datos.f) || datos.f < 1 || datos.f > LIMITES.fotosPorBoleto) {
    throw errorCodigo('boleto_invalido');
  }
  if (datos.exp * 1000 <= Date.now()) throw errorCodigo('boleto_vencido');
  return { n: datos.n, f: datos.f };
}

/** Consume un uso del boleto: 'fotos' (hasta f) o 'propuesta' (una vez). */
function consumirBoleto({ n, f }, uso) {
  const boletos = leer(CLAVE_BOLETOS);
  const b = boletos[n];
  if (!b) throw errorCodigo('boleto_invalido');
  if (uso === 'fotos') {
    if (b.fotos >= f) throw errorCodigo('boleto_agotado');
    b.fotos += 1;
  } else {
    if (b.propuesta) throw errorCodigo('boleto_agotado');
    b.propuesta = true;
  }
  guardar(CLAVE_BOLETOS, boletos);
}

/** Cupo diario de fotos de este navegador (la "conexión" del mock), por día UTC. */
function consumirCupoFotos() {
  const dia = new Date().toISOString().slice(0, 10);
  const cupo = leerAlmacen(localStorage, CLAVE_CUPO_FOTOS, null);
  const n = cupo?.dia === dia && Number.isInteger(cupo.n) ? cupo.n : 0;
  if (n >= CUPO_FOTOS_DIA) throw errorCodigo('demasiadas_solicitudes'); // condicional: no pasa del máximo
  guardar(CLAVE_CUPO_FOTOS, { dia, n: n + 1 });
}

export async function subirFoto(blob, { boleto, alProgresar } = {}) {
  // Progreso simulado para que la barra se vea igual que en modo api.
  for (const p of [0.25, 0.6, 0.9]) {
    alProgresar?.(p);
    await esperar(LATENCIA_MS / 3);
  }
  // Mismo orden que el Worker (§15.3): boleto → forma → uso del boleto → cupo diario → guardar.
  // Los usos ya gastados no se devuelven si falla un paso posterior.
  if (!boleto) throw errorCodigo('boleto_ausente');
  falloInyectado(['boleto_invalido', 'boleto_vencido']);
  const verificado = verificarBoleto(boleto);
  if (!(blob instanceof Blob)) throw new ErrorApi('tipo_no_soportado', 'La foto debe llegar cifrada desde la app.', 415);
  if (blob.size > LIMITES.fotoCifradaBytes) throw new ErrorApi('archivo_muy_grande', 'La foto pesa más de 500 KB.', 413);
  const cabecera = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (blob.size < 30 || cabecera[0] !== 1 || pareceImagen(cabecera)) {
    throw new ErrorApi('tipo_no_soportado', 'La foto debe llegar cifrada desde la app.', 415);
  }
  falloInyectado(['boleto_agotado']);
  consumirBoleto(verificado, 'fotos');
  falloInyectado(['demasiadas_solicitudes']);
  consumirCupoFotos();

  const id = `f_${idAleatorio(16)}`;
  const dataUrl = `data:application/octet-stream;base64,${aBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  const fotos = leer(CLAVE_FOTOS);
  fotos[id] = { dataUrl, propuestaId: null, creadaEn: Date.now() };
  guardar(CLAVE_FOTOS, fotos);
  alProgresar?.(1);
  return { id, url: dataUrl, expiraEn: new Date(Date.now() + LIMITES.horasFotoHuerfana * 3600 * 1000).toISOString() };
}

/** En modo mock la "URL" es un data: URL con los bytes cifrados (se decodifica sin red). */
export async function descargarFoto(url) {
  const binario = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Imita la validación Zod del sobre v2 en el Worker (incluido el rechazo de campos extra). */
function validarSobre(sobre) {
  const permitidos = ['v', 'cifrado', 'fotos', 'avisos'];
  const extra = Object.keys(sobre ?? {}).find((k) => !permitidos.includes(k));
  if (extra) throw errorValidacion('(raíz)', `Campo no permitido: ${extra}.`);
  if (sobre.v !== VERSION_PROPUESTA) throw errorValidacion('v', `La versión debe ser ${VERSION_PROPUESTA}.`);
  if (!cifradoValido(sobre.cifrado, LIMITES.cifradoPropuesta)) throw errorValidacion('cifrado', 'El contenido cifrado no es válido.');
  const fotos = sobre.fotos ?? [];
  if (!Array.isArray(fotos) || fotos.length > LIMITES.fotosTotales.max) throw errorValidacion('fotos', 'Demasiadas fotos.');
  if (fotos.some((f) => !PATRONES.idFoto.test(String(f)))) throw errorValidacion('fotos', 'Id de foto inválido.');
  if (new Set(fotos).size !== fotos.length) throw errorValidacion('fotos', 'Una foto no puede repetirse.');
  return { v: sobre.v, cifrado: sobre.cifrado, fotos };
}

export async function crearPropuesta(sobre, { boleto, turnstile } = {}) {
  await esperar();
  // Verificación humana (§15.4): con boleto no se mira el token; sin boleto, el token (simulado).
  let verificado = null;
  if (boleto) {
    falloInyectado(['boleto_invalido', 'boleto_vencido']);
    verificado = verificarBoleto(boleto);
  } else {
    falloInyectado(['verificacion_bot']);
    if (!turnstile) throw errorCodigo('verificacion_bot');
  }
  if (new Blob([JSON.stringify(sobre)]).size > LIMITES.cuerpoJsonBytes) {
    throw new ErrorApi('archivo_muy_grande', 'La propuesta es demasiado grande.', 413);
  }
  const datos = validarSobre(sobre);

  const fotos = leer(CLAVE_FOTOS);
  const ahora = Date.now();
  for (const idFoto of datos.fotos) {
    const guardada = fotos[idFoto];
    const huerfanaVencida = guardada && !guardada.propuestaId
      && ahora - guardada.creadaEn > LIMITES.horasFotoHuerfana * 3600 * 1000;
    if (!guardada || guardada.propuestaId || huerfanaVencida) {
      throw new ErrorApi('foto_invalida', 'Una de las fotos ya no está disponible. Vuelve a subirla.', 422);
    }
  }
  // Se consume después de validar: un 422 no gasta la propuesta del boleto.
  if (verificado) {
    falloInyectado(['boleto_agotado']);
    consumirBoleto(verificado, 'propuesta');
  }

  const id = idAleatorio(12);
  const claveAdmin = idAleatorio(32);
  const ntfyTema = sobre?.avisos?.push === true ? idAleatorio(32) : null;
  for (const idFoto of datos.fotos) fotos[idFoto].propuestaId = id;

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
  const { v, cifrado } = guardada.datos;
  return {
    v,
    id,
    cifrado,
    fotos: (guardada.datos.fotos ?? []).map((f) => ({ id: f, url: fotos[f]?.dataUrl ?? '' })),
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
  buscarPropuesta(id);
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
    // Igual que el Worker: la opción y la nota llegan cifradas y se guardan tal cual.
    if (!cifradoValido(evento.cifrado, LIMITES.cifradoEvento) || 'opcionId' in evento) return;
    nuevo.cifrado = evento.cifrado;
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
  const todos = leer(CLAVE_EVENTOS)[id] ?? [];

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
      celebracion: ultimaCelebracion ? { cifrado: ultimaCelebracion.cifrado, en: ultimaCelebracion.creadoEn } : null,
    },
    para: null,
    // Como el Worker: el contenido cifrado solo viaja en la primera consulta.
    ...(Number(desde) ? {} : { cifrado: propuesta.datos.cifrado }),
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
