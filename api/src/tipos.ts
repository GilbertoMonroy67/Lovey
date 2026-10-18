// Tipos compartidos del Worker. `Env` lo genera `wrangler types` (worker-configuration.d.ts).
// TURNSTILE_SECRETO es un secreto opcional: sin él no se verifica Turnstile (ver src/turnstile.ts).
// PERMITIR_LOCALHOST="1" solo en desarrollo (.dev.vars): acepta http://localhost y 127.0.0.1 en CORS.
// En producción no se define (ni en wrangler.jsonc ni como secreto).
export type AppEnv = { Bindings: Env & { TURNSTILE_SECRETO?: string; PERMITIR_LOCALHOST?: string } };

export const PREFIJO_API = '/api/v1';
export const MS_HORA = 60 * 60 * 1000;
export const MS_DIA = 24 * MS_HORA;
