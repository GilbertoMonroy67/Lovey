// Tipos compartidos del Worker. `Env` lo genera `wrangler types` (worker-configuration.d.ts).
// TURNSTILE_SECRETO es un secreto opcional: sin él no se verifica Turnstile (ver src/turnstile.ts).
export type AppEnv = { Bindings: Env & { TURNSTILE_SECRETO?: string } };

export const PREFIJO_API = '/api/v1';
export const MS_HORA = 60 * 60 * 1000;
export const MS_DIA = 24 * MS_HORA;
