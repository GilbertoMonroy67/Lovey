// Protección contra bots con Cloudflare Turnstile al crear propuestas (docs/arquitectura.md §5.8).
// Solo se activa si existe el secreto TURNSTILE_SECRETO (`wrangler secret put TURNSTILE_SECRETO`).
// Sin secreto (desarrollo, tests) no se verifica nada y el contrato no cambia.
import { ErrorApi } from './errores';

const URL_VERIFICAR = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const CABECERA_TURNSTILE = 'X-Turnstile-Token';

/**
 * Secretos de prueba documentados por Cloudflare (siempre pasa, siempre falla, token ya usado).
 * Con ellos siteverify devuelve `hostname: "example.com"`, así que ese host solo se acepta con estos secretos.
 */
export const SECRETOS_PRUEBA: readonly string[] = [
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
];
const HOST_PRUEBA = 'example.com';
const HOSTS_LOCALES = ['localhost', '127.0.0.1'];

/** De dónde puede venir un token válido: los hosts de ORIGENES_PERMITIDOS y, en desarrollo, localhost. */
export interface ConfigTurnstile {
  origenes?: string;
  permitirLocal?: boolean;
}

/** Hosts (sin esquema ni puerto) de la lista de orígenes separada por comas; ignora entradas inválidas. */
function hostsDeOrigenes(lista: string | undefined): string[] {
  return (lista ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .flatMap((o) => {
      try {
        return [new URL(o).hostname.toLowerCase()];
      } catch {
        return [];
      }
    });
}

/**
 * ¿El `hostname` que devolvió siteverify corresponde a nuestra página? (auditoría v2.2, H8).
 * Evita aceptar tokens resueltos en otro sitio que use la misma site key.
 */
export function hostTurnstilePermitido(hostname: unknown, secreto: string, cfg: ConfigTurnstile): boolean {
  if (typeof hostname !== 'string' || !hostname) return false;
  const host = hostname.toLowerCase();
  if (hostsDeOrigenes(cfg.origenes).includes(host)) return true;
  if (cfg.permitirLocal && HOSTS_LOCALES.includes(host)) return true;
  return host === HOST_PRUEBA && SECRETOS_PRUEBA.includes(secreto);
}

/** Consulta siteverify y comprueba el hostname. Ante cualquier falla de red responde false (falla cerrada). */
export async function verificarTurnstile(
  secreto: string,
  token: string,
  ip: string | null,
  cfg: ConfigTurnstile,
  hacerFetch: typeof fetch = fetch,
): Promise<boolean> {
  const cuerpo = new FormData();
  cuerpo.append('secret', secreto);
  cuerpo.append('response', token);
  if (ip) cuerpo.append('remoteip', ip);
  try {
    const r = await hacerFetch(URL_VERIFICAR, { method: 'POST', body: cuerpo, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const datos = (await r.json()) as { success?: boolean; hostname?: unknown };
    if (datos.success !== true) return false;
    if (!hostTurnstilePermitido(datos.hostname, secreto, cfg)) {
      console.warn('turnstile_host_ajeno');
      return false;
    }
    return true;
  } catch (e) {
    console.warn('turnstile_fallo', { tipo: (e as Error).name });
    return false;
  }
}

/** Lanza 403 `verificacion_bot` si Turnstile está activo y el token falta, no es válido o viene de otro host. */
export async function exigirHumano(
  req: Request,
  secreto: string | undefined,
  cfg: ConfigTurnstile,
  hacerFetch: typeof fetch = fetch,
) {
  if (!secreto) return;
  const token = req.headers.get(CABECERA_TURNSTILE)?.trim() ?? '';
  const valido =
    token.length > 0 &&
    token.length <= 2048 &&
    (await verificarTurnstile(secreto, token, req.headers.get('CF-Connecting-IP'), cfg, hacerFetch));
  if (!valido) throw new ErrorApi(403, 'verificacion_bot');
}

/** Configuración de hosts a partir de las variables del Worker. */
export const configTurnstile = (env: { ORIGENES_PERMITIDOS?: string; PERMITIR_LOCALHOST?: string }): ConfigTurnstile => ({
  origenes: env.ORIGENES_PERMITIDOS,
  permitirLocal: env.PERMITIR_LOCALHOST === '1',
});
