import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './tipos';

const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function origenPermitido(origen: string | undefined, lista: string | undefined): boolean {
  if (!origen) return false;
  if (LOCAL.test(origen)) return true;
  return (lista ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .includes(origen);
}

/**
 * CORS según docs/arquitectura.md §5.4: origen exacto + Vary: Origin, sin credenciales.
 * Un origen no permitido recibe la respuesta sin cabeceras CORS (el navegador la bloquea).
 */
export const cors: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origen = c.req.header('Origin');
  const permitido = origenPermitido(origen, c.env.ORIGENES_PERMITIDOS);

  if (c.req.method === 'OPTIONS') {
    const cabeceras = new Headers({ Vary: 'Origin' });
    if (permitido && origen) {
      cabeceras.set('Access-Control-Allow-Origin', origen);
      cabeceras.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      cabeceras.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      cabeceras.set('Access-Control-Max-Age', '86400');
    }
    return new Response(null, { status: 204, headers: cabeceras });
  }

  await next();
  c.res.headers.append('Vary', 'Origin');
  if (permitido && origen) c.res.headers.set('Access-Control-Allow-Origin', origen);
};
