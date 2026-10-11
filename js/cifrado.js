// Cifrado de extremo a extremo con WebCrypto (AES-GCM de 256 bits), sin dependencias.
// La llave se genera en el navegador de quien envía y viaja solo en el fragmento del enlace (#c=…),
// que el navegador nunca manda al servidor. El Worker, D1 y R2 solo ven bytes cifrados.
//
// Formato de un mensaje cifrado: [1 byte de versión][12 bytes de IV][texto cifrado + etiqueta de 16 bytes].
// Cada uso lleva su propio contexto como datos asociados (AAD), para que una foto cifrada no se pueda
// hacer pasar por el contenido de la propuesta ni por un evento.

import { PATRONES } from './limites.js';

const VERSION = 1;
const LARGO_IV = 12;

export const CONTEXTO = Object.freeze({
  propuesta: 'noviazgo/v2/propuesta',
  foto: 'noviazgo/v2/foto',
  evento: 'noviazgo/v2/evento',
});

const codificador = new TextEncoder();
const llavesImportadas = new Map(); // texto base64url → CryptoKey (no extraíble)

export function aBase64Url(bytes) {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deBase64Url(texto) {
  const normal = texto.replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Llave nueva de 256 bits en base64url (43 caracteres). */
export function generarClave() {
  return aBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export const claveValida = (clave) => typeof clave === 'string' && PATRONES.claveCifrado.test(clave);

async function importar(clave) {
  if (!claveValida(clave)) throw new Error('llave de cifrado inválida');
  let llave = llavesImportadas.get(clave);
  if (!llave) {
    llave = await crypto.subtle.importKey('raw', deBase64Url(clave), 'AES-GCM', false, ['encrypt', 'decrypt']);
    llavesImportadas.set(clave, llave);
  }
  return llave;
}

/** @returns {Promise<Uint8Array>} */
export async function cifrarBytes(clave, datos, contexto) {
  const iv = crypto.getRandomValues(new Uint8Array(LARGO_IV));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: codificador.encode(contexto) },
    await importar(clave),
    datos,
  ));
  const salida = new Uint8Array(1 + LARGO_IV + cifrado.length);
  salida[0] = VERSION;
  salida.set(iv, 1);
  salida.set(cifrado, 1 + LARGO_IV);
  return salida;
}

/** Lanza si la llave no corresponde o si los datos se alteraron (la etiqueta GCM no coincide). */
export async function descifrarBytes(clave, datos, contexto) {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  if (bytes.length < 1 + LARGO_IV + 16 || bytes[0] !== VERSION) throw new Error('formato cifrado desconocido');
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(1, 1 + LARGO_IV), additionalData: codificador.encode(contexto) },
    await importar(clave),
    bytes.subarray(1 + LARGO_IV),
  ));
}

export async function cifrarJson(clave, valor, contexto) {
  return aBase64Url(await cifrarBytes(clave, codificador.encode(JSON.stringify(valor)), contexto));
}

export async function descifrarJson(clave, texto, contexto) {
  if (typeof texto !== 'string' || !PATRONES.cifrado.test(texto)) throw new Error('contenido cifrado inválido');
  const bytes = await descifrarBytes(clave, deBase64Url(texto), contexto);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
