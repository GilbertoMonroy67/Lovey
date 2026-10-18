// Único lugar con URLs de la API (contrato §6.1).
const ES_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const API_BASE = ES_LOCAL
  ? 'http://localhost:8787/api/v1'
  : 'https://noviazgo-api.gilbertoalejandromonroymorales.workers.dev/api/v1';

function leerModoForzado() {
  try {
    return localStorage.getItem('noviazgo:modo');
  } catch {
    return null; // almacenamiento bloqueado (modo privado estricto)
  }
}

// 'mock' | 'api'. Prioridad: localStorage['noviazgo:modo'] > reglas por defecto.
// Por defecto: 'mock' en localhost o si API_BASE sigue con el marcador; 'api' en otro caso.
export const MODO = (() => {
  const forzado = leerModoForzado();
  if (forzado === 'mock' || forzado === 'api') return forzado;
  if (ES_LOCAL || API_BASE.includes('TU-SUBDOMINIO')) return 'mock';
  return 'api';
})();

export const SONDEO_MS = 5000;

// Protección contra bots con Cloudflare Turnstile al crear propuestas (contrato §13.3).
// La "site key" es PÚBLICA por diseño (el navegador la necesita y solo funciona en el hostname
// registrado, gilbertomonroy67.github.io). La "secret key" NUNCA va en el repo: vive solo en el
// Worker (`npx wrangler secret put TURNSTILE_SECRETO`). Vacío = desactivado. Solo se usa en modo 'api'.
// En localhost se usa la site key de PRUEBA de Cloudflare (siempre pasa, sin interacción), para probar
// el boleto de subida contra `wrangler dev` con TURNSTILE_SECRETO=1x0000000000000000000000000000000AA (§15.9).
export const TURNSTILE_SITIO = ES_LOCAL ? '1x00000000000000000000AA' : '0x4AAAAAAFUJ_kJNXNOvPkKl';
