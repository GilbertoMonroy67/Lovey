// Protección contra bots con Cloudflare Turnstile al crear propuestas (docs/arquitectura.md §5.8).
// Solo se activa si existe el secreto TURNSTILE_SECRETO (`wrangler secret put TURNSTILE_SECRETO`).
// Sin secreto (desarrollo, tests) no se verifica nada y el contrato no cambia.
import { ErrorApi } from './errores';

const URL_VERIFICAR = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const CABECERA_TURNSTILE = 'X-Turnstile-Token';

/** Consulta siteverify. Ante cualquier falla de red responde false (falla cerrada). */
export async function verificarTurnstile(
  secreto: string,
  token: string,
  ip: string | null,
  hacerFetch: typeof fetch = fetch,
): Promise<boolean> {
  const cuerpo = new FormData();
  cuerpo.append('secret', secreto);
  cuerpo.append('response', token);
  if (ip) cuerpo.append('remoteip', ip);
  try {
    const r = await hacerFetch(URL_VERIFICAR, { method: 'POST', body: cuerpo, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const datos = (await r.json()) as { success?: boolean };
    return datos.success === true;
  } catch (e) {
    console.warn('turnstile_fallo', { tipo: (e as Error).name });
    return false;
  }
}

/** Lanza 403 `verificacion_bot` si Turnstile está activo y el token falta o no es válido. */
export async function exigirHumano(req: Request, secreto: string | undefined, hacerFetch: typeof fetch = fetch) {
  if (!secreto) return;
  const token = req.headers.get(CABECERA_TURNSTILE)?.trim() ?? '';
  const valido =
    token.length > 0 &&
    token.length <= 2048 &&
    (await verificarTurnstile(secreto, token, req.headers.get('CF-Connecting-IP'), hacerFetch));
  if (!valido) throw new ErrorApi(403, 'verificacion_bot');
}
