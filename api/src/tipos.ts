// Tipos compartidos del Worker. `Env` lo genera `wrangler types` (worker-configuration.d.ts).
export type AppEnv = { Bindings: Env };

export const PREFIJO_API = '/api/v1';
export const MS_HORA = 60 * 60 * 1000;
export const MS_DIA = 24 * MS_HORA;
