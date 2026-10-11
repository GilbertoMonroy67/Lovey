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

// Protección contra bots con Cloudflare Turnstile al crear propuestas (contrato §5.8).
// Vacío = desactivado. Para activarlo: crea un widget en el panel de Cloudflare (Turnstile) para
// gilbertomonroy67.github.io, pega aquí su "site key" (es pública) y guarda la "secret key" con
// `npx wrangler secret put TURNSTILE_SECRETO` en api/. Solo se usa en modo 'api'.
export const TURNSTILE_SITIO = '';
