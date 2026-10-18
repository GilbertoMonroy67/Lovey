// Worker de Noviazgo: app Hono (fetch) + limpieza programada (scheduled).
import { Hono } from 'hono';
import { VERSION_PROPUESTA } from '../../js/limites.js';
import { cors } from './cors';
import { ErrorApi, manejarError, respuestaError } from './errores';
import { limpiar } from './limpieza';
import { rutasBoletos } from './rutas/boletos';
import { rutasEventos } from './rutas/eventos';
import { rutasFotos } from './rutas/fotos';
import { rutasPropuestas } from './rutas/propuestas';
import { PREFIJO_API, type AppEnv } from './tipos';

export const app = new Hono<AppEnv>();

const HOST_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

// Forzar HTTPS (§5.8): en producción nada viaja en claro. GET/HEAD se redirigen; el resto se rechaza
// para no reenviar cuerpos ni claves por un canal inseguro. `wrangler dev` (localhost) queda exento.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.protocol === 'http:' && !HOST_LOCAL.test(url.hostname)) {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
      url.protocol = 'https:';
      return c.redirect(url.href, 301);
    }
    return respuestaError(c, new ErrorApi(403, 'https_requerido'));
  }
  await next();
});

app.use('*', cors);

// Cabeceras de seguridad (§5.8). Las fotos fijan su propio Cache-Control.
app.use('*', async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  // La API nunca se muestra como página: sin marcos, sin scripts y sin cargar nada.
  h.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox");
  h.set('X-Frame-Options', 'DENY');
  // Solo el propio origen puede incrustar respuestas sin CORS (<img>, <script>…); el frontend usa fetch con CORS.
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (new URL(c.req.url).protocol === 'https:') h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  if (h.get('Content-Type')?.startsWith('application/json')) h.set('Content-Type', 'application/json; charset=utf-8');
});

const api = new Hono<AppEnv>();
api.get('/salud', (c) => c.json({ ok: true, version: VERSION_PROPUESTA }));
api.route('/boletos', rutasBoletos);
api.route('/fotos', rutasFotos);
api.route('/propuestas', rutasPropuestas);
api.route('/propuestas', rutasEventos);

app.route(PREFIJO_API, api);
app.notFound((c) => respuestaError(c, new ErrorApi(404, 'no_encontrado')));
app.onError(manejarError);

export default {
  fetch: app.fetch,
  async scheduled(_controlador, env, ctx) {
    ctx.waitUntil(limpiar(env));
  },
} satisfies ExportedHandler<Env>;
