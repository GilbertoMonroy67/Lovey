// Worker de Noviazgo: app Hono (fetch) + limpieza programada (scheduled).
import { Hono } from 'hono';
import { VERSION_PROPUESTA } from '../../js/limites.js';
import { cors } from './cors';
import { ErrorApi, manejarError, respuestaError } from './errores';
import { limpiar } from './limpieza';
import { rutasEventos } from './rutas/eventos';
import { rutasFotos } from './rutas/fotos';
import { rutasPropuestas } from './rutas/propuestas';
import { PREFIJO_API, type AppEnv } from './tipos';

export const app = new Hono<AppEnv>();

app.use('*', cors);

// Cabeceras de seguridad (§5.8). Las fotos fijan su propio Cache-Control.
app.use('*', async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  if (h.get('Content-Type')?.startsWith('application/json')) h.set('Content-Type', 'application/json; charset=utf-8');
});

const api = new Hono<AppEnv>();
api.get('/salud', (c) => c.json({ ok: true, version: VERSION_PROPUESTA }));
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
