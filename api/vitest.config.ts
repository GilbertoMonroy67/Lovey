import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migraciones = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migraciones,
            SAL_IP: 'sal-de-pruebas',
            ORIGENES_PERMITIDOS: 'https://ejemplo.github.io',
            // Como en producción: localhost no es un origen CORS válido (anula el PERMITIR_LOCALHOST de .dev.vars).
            PERMITIR_LOCALHOST: '',
            NTFY_BASE: '', // sin salidas a internet en los tests; ntfy se prueba con un fetch simulado
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/configurar.ts'],
    },
  };
});
