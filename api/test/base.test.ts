import { describe, expect, it } from 'vitest';
import { LIMITES } from '../../js/limites.js';
import { origenPermitido } from '../src/cors';
import { base62, igualesTiempoConstante, sha256Hex } from '../src/ids';
import { pedir, pedirCon } from './ayuda';

describe('GET /salud y cabeceras', () => {
  it('responde ok con cabeceras de seguridad', async () => {
    const r = await pedir('/salud');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, version: 2 });
    expect(r.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox");
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
    expect(r.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(r.headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
  });

  it('las respuestas de error también llevan las cabeceras de seguridad', async () => {
    const r = await pedir('/propuestas/AAAAAAAAAAAA');
    expect(r.status).toBe(404);
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
    expect(r.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});

describe('HTTPS obligatorio', () => {
  it('GET por http → 301 a https', async () => {
    const r = await pedir('/salud', { base: 'http://api.test/api/v1' });
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('https://api.test/api/v1/salud');
  });

  it('POST por http → 403 https_requerido (no se reenvían cuerpos ni claves)', async () => {
    const r = await pedir('/propuestas', { base: 'http://api.test/api/v1', method: 'POST', body: '{}' });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).error.codigo).toBe('https_requerido');
  });

  it('localhost por http se permite (wrangler dev) y sin HSTS', async () => {
    const r = await pedir('/salud', { base: 'http://localhost:8787/api/v1' });
    expect(r.status).toBe(200);
    expect(r.headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('ruta desconocida → 404 no_encontrado con formato uniforme', async () => {
    const r = await pedir('/nada');
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { codigo: 'no_encontrado', mensaje: expect.any(String) } });
  });
});

describe('CORS', () => {
  it('origen permitido recibe el origen exacto y Vary', async () => {
    const r = await pedir('/salud', { headers: { Origin: 'https://ejemplo.github.io' } });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://ejemplo.github.io');
    expect(r.headers.get('Vary')).toContain('Origin');
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('sin PERMITIR_LOCALHOST (producción) localhost y 127.0.0.1 se rechazan', async () => {
    for (const origen of ['http://localhost:8000', 'http://127.0.0.1:5500', 'http://localhost']) {
      const r = await pedir('/salud', { headers: { Origin: origen } });
      expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
      const pre = await pedir('/fotos', { method: 'OPTIONS', headers: { Origin: origen, 'Access-Control-Request-Method': 'POST' } });
      expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    // Un valor distinto de "1" no lo habilita.
    const r = await pedirCon({ PERMITIR_LOCALHOST: 'true' }, '/salud', { headers: { Origin: 'http://localhost:8000' } });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('con PERMITIR_LOCALHOST="1" (desarrollo) localhost con cualquier puerto se acepta', async () => {
    const r = await pedirCon({ PERMITIR_LOCALHOST: '1' }, '/salud', { headers: { Origin: 'http://localhost:8000' } });
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8000');
  });

  it('el origen de Pages funciona con y sin PERMITIR_LOCALHOST', async () => {
    for (const extra of [{}, { PERMITIR_LOCALHOST: '1' }] as Record<string, string>[]) {
      const r = await pedirCon(extra, '/salud', { headers: { Origin: 'https://ejemplo.github.io' } });
      expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://ejemplo.github.io');
    }
  });

  it('origen no permitido no recibe cabeceras CORS', async () => {
    const r = await pedir('/salud', { headers: { Origin: 'https://malo.example' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('preflight permitido → 204 con métodos, cabeceras y max-age', async () => {
    const r = await pedirCon({ PERMITIR_LOCALHOST: '1' }, '/fotos', {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:5500', 'Access-Control-Request-Method': 'POST' },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:5500');
    expect(r.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, DELETE, OPTIONS');
    expect(r.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, X-Turnstile-Token, X-Boleto');
    expect(r.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('preflight no permitido → 204 sin cabeceras CORS', async () => {
    const r = await pedir('/propuestas', { method: 'OPTIONS', headers: { Origin: 'https://malo.example' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('origenPermitido no acepta subcadenas ni http en otros hosts', () => {
    expect(origenPermitido('https://ejemplo.github.io.malo.com', 'https://ejemplo.github.io')).toBe(false);
    expect(origenPermitido('http://localhost.malo.com', '', true)).toBe(false);
    expect(origenPermitido('http://localhost:8000', '')).toBe(false);
    expect(origenPermitido('http://localhost:8000', '', true)).toBe(true);
    expect(origenPermitido('https://localhost:8000', '', true)).toBe(false);
    expect(origenPermitido(undefined, 'https://ejemplo.github.io')).toBe(false);
  });
});

describe('ids y límites compartidos', () => {
  it('base62 genera la longitud y el alfabeto correctos', () => {
    const id = base62(500);
    expect(id).toMatch(/^[A-Za-z0-9]{500}$/);
  });

  it('sha256 y comparación en tiempo constante', async () => {
    const h = await sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(igualesTiempoConstante(h, h)).toBe(true);
    expect(igualesTiempoConstante(h, h.slice(0, -1) + '0')).toBe(false);
    expect(igualesTiempoConstante(h, '')).toBe(false);
  });

  it('el Worker usa js/limites.js (fuente única)', () => {
    expect(LIMITES.fotoBytes).toBe(512000);
    expect(LIMITES.diasExpiracion).toBe(30);
  });
});
