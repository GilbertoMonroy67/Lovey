// Regresiones de la auditoría de cyberbot del 2026-10-18 (docs/seguridad.md): H1 y H2
// (ajustadas a la v2.2: boleto en POST /fotos y 3 fotos por IP al día; H4 está en boletos.test.ts).
// H3 (localhost en CORS) está en base.test.ts.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/errores';
import { sha256Hex } from '../src/ids';
import { consumirTopeGlobal, hashIp, limitarIp, normalizarIp, REGLAS_IP_DIARIAS, TOPES_GLOBALES } from '../src/limite-tasa';
import { CIFRADA, json, JPEG, pedir, pedirCon, propuestaValida, subirFoto } from './ayuda';

const HORA = 3_600_000;
const DIA = 86_400_000;

async function capturar(p: Promise<unknown>): Promise<ErrorApi | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ErrorApi;
  }
}

/** Suma de todos los contadores globales de la acción (no depende de en qué día UTC corra el test). */
async function totalGlobal(accion: 'propuestas' | 'fotos'): Promise<number> {
  const fila = await env.DB.prepare('SELECT COALESCE(SUM(conteo), 0) AS n FROM limites WHERE clave LIKE ?')
    .bind(`${accion}:global:%`)
    .first<{ n: number }>();
  return fila?.n ?? 0;
}

// v2.2: cada subida lleva su boleto (lo pide el ayudante desde la misma IP).
const subir = (bytes: Uint8Array, ip: string, tipo = 'application/octet-stream') => subirFoto(bytes, tipo, { ip });

describe('H1: el tope global se gasta solo con solicitudes válidas', () => {
  it('300 POST /propuestas sin token de Turnstile → 403 y el contador global no cambia; una IP nueva no recibe 503', async () => {
    const turnstile = { TURNSTILE_SECRETO: 'secreto-falso' }; // sin token, siteverify ni siquiera se llama
    const antes = await totalGlobal('propuestas');
    const estados: Record<number, number> = {};
    for (let i = 0; i < 300; i++) {
      const ip = `198.18.${Math.floor(i / 10)}.1`; // 30 IP, 10 por IP (el máximo horario)
      const r = await pedirCon(turnstile, '/propuestas', json(propuestaValida(), { ip }));
      estados[r.status] = (estados[r.status] ?? 0) + 1;
    }
    expect(estados).toEqual({ 403: 300 });
    expect(await totalGlobal('propuestas')).toBe(antes);

    // Una persona real desde otra IP sigue pudiendo crear su propuesta.
    const r = await pedir('/propuestas', json(propuestaValida(), { ip: '198.51.100.7' }));
    expect(r.status).toBe(201);
    expect(await totalGlobal('propuestas')).toBe(antes + 1);
  }, 60_000); // 300 solicitudes: más que el timeout por defecto (5 s) en máquinas lentas

  it('el límite por IP va antes de Turnstile: la solicitud 11 sin token → 429 (no llega a siteverify)', async () => {
    const ip = '198.18.200.1';
    for (let i = 0; i < 10; i++) {
      expect((await pedirCon({ TURNSTILE_SECRETO: 'x' }, '/propuestas', json(propuestaValida(), { ip }))).status).toBe(403);
    }
    expect((await pedirCon({ TURNSTILE_SECRETO: 'x' }, '/propuestas', json(propuestaValida(), { ip }))).status).toBe(429);
  });

  it('cuerpos inválidos y fotos inexistentes no gastan el tope global de propuestas', async () => {
    const antes = await totalGlobal('propuestas');
    expect((await pedir('/propuestas', json({ v: 2 }))).status).toBe(422);
    expect((await pedir('/propuestas', json('no es json{'))).status).toBe(400);
    expect((await pedir('/propuestas', json(propuestaValida({ fotos: ['AAAAAAAAAAAAAAAA'] })))).status).toBe(422);
    expect(await totalGlobal('propuestas')).toBe(antes);
  });

  it('el tope global sigue aplicando a las solicitudes válidas → 503', async () => {
    const t0 = Date.now();
    await env.DB.prepare('INSERT OR REPLACE INTO limites (clave, conteo, expira_en) VALUES (?, ?, ?)')
      .bind(`propuestas:global:${Math.floor(t0 / DIA)}`, TOPES_GLOBALES.propuestas!.maximo, t0 + DIA)
      .run();
    const r = await pedir('/propuestas', json(propuestaValida()));
    // Si el test cruza la medianoche UTC justo aquí, el contador del día nuevo empieza en 1 → 201.
    expect([503, 201]).toContain(r.status);
    if (r.status === 503) expect(((await r.json()) as any).error.codigo).toBe('capacidad_agotada');
    await env.DB.prepare("DELETE FROM limites WHERE clave LIKE 'propuestas:global:%'").run();
  });

  it('fotos rechazadas (tipo, imagen en claro, basura sin versión) no gastan el tope global de fotos', async () => {
    const antes = await totalGlobal('fotos');
    expect((await subir(CIFRADA(), '198.18.210.1', 'image/png')).status).toBe(415);
    expect((await subir(JPEG(), '198.18.210.2')).status).toBe(415);
    expect((await subir(new Uint8Array(40), '198.18.210.3')).status).toBe(415);
    expect(await totalGlobal('fotos')).toBe(antes);
    expect((await subir(CIFRADA(), '198.18.210.4')).status).toBe(201);
    expect(await totalGlobal('fotos')).toBe(antes + 1);
  });

  it('consumirTopeGlobal: 503 al pasar el tope; acciones sin tope no hacen nada', async () => {
    const t0 = Date.UTC(2031, 5, 1, 10);
    await env.DB.prepare('INSERT INTO limites (clave, conteo, expira_en) VALUES (?, ?, ?)')
      .bind(`fotos:global:${Math.floor(t0 / DIA)}`, TOPES_GLOBALES.fotos!.maximo, t0 + DIA)
      .run();
    expect((await capturar(consumirTopeGlobal(env.DB, 'fotos', t0)))?.codigo).toBe('capacidad_agotada');
    expect(await capturar(consumirTopeGlobal(env.DB, 'eventos', t0))).toBeNull();
    const fila = await env.DB.prepare("SELECT 1 FROM limites WHERE clave LIKE 'eventos:global:%'").first();
    expect(fila).toBeNull();
  });
});

describe('H2: IPv6 por /64', () => {
  it('normalizarIp expande `::` y agrupa por /64', () => {
    const a = normalizarIp('2001:db8:85a3::8a2e:370:7334');
    expect(a).toBe('2001:0db8:85a3:0000::/64');
    expect(normalizarIp('2001:0DB8:85A3:0000:ffff:ffff:ffff:ffff')).toBe(a);
    expect(normalizarIp('2001:db8:85a3:0:1:2:3:4')).toBe(a);
    expect(normalizarIp('[2001:db8:85a3::1]')).toBe(a);
    expect(normalizarIp('2001:db8:85a3:1::1')).toBe('2001:0db8:85a3:0001::/64');
    expect(normalizarIp('2001:db8::')).toBe('2001:0db8:0000:0000::/64');
    expect(normalizarIp('::1')).toBe('0000:0000:0000:0000::/64');
    expect(normalizarIp('::')).toBe('0000:0000:0000:0000::/64');
    expect(normalizarIp('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64');
    expect(normalizarIp('64:ff9b::192.0.2.1')).toBe('0064:ff9b:0000:0000::/64');
  });

  it('IPv4 mapeada en IPv6 cuenta como la IPv4', () => {
    expect(normalizarIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(normalizarIp('::ffff:c000:201')).toBe('192.0.2.1');
    expect(normalizarIp('0:0:0:0:0:ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(normalizarIp('192.0.2.1')).toBe('192.0.2.1');
  });

  it('direcciones inválidas se usan tal cual (no se agrupan con nadie)', () => {
    for (const ip of ['2001:db8::1::2', '1:2:3', 'gggg::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8', '::ffff:300.1.1.1', '1.2.3.4::1', 'sin-ip']) {
      expect(normalizarIp(ip)).toBe(ip);
    }
  });

  it('hashIp: dos IPv6 del mismo /64 (una abreviada) dan el mismo hash; otro /64, otro hash', async () => {
    const h = (ip: string) => hashIp(new Request('https://api.test/', { headers: { 'CF-Connecting-IP': ip } }), 'sal');
    const mismo1 = await h('2001:db8:a:b::1');
    const mismo2 = await h('2001:0db8:000a:000b:ffff:1234:5678:9abc');
    const otro = await h('2001:db8:a:c::1');
    expect(mismo1).toBe(mismo2);
    expect(otro).not.toBe(mismo1);
    expect(mismo1).toBe(await sha256Hex('sal2001:0db8:000a:000b::/64'));
  });

  it('HTTP: el mismo /64 comparte el límite de propuestas; otro /64 no', async () => {
    const ips = ['2001:db8:77:1::1', '2001:0db8:0077:0001:0000:0000:0000:0002', '2001:db8:77:1:abcd::'];
    for (let i = 0; i < 10; i++) {
      expect((await pedir('/propuestas', json(propuestaValida(), { ip: ips[i % 3] }))).status).toBe(201);
    }
    expect((await pedir('/propuestas', json(propuestaValida(), { ip: '2001:db8:77:1:ffff:ffff:ffff:fffe' }))).status).toBe(429);
    expect((await pedir('/propuestas', json(propuestaValida(), { ip: '2001:db8:77:2::1' }))).status).toBe(201);
  }, 30_000);
});

describe('H2: tope diario por IP', () => {
  it('fotos (v2.2): 3 al día sin regla horaria; la 4.ª del día (tercera hora) → 429 hasta el fin del día', async () => {
    const t0 = Date.UTC(2031, 0, 10, 0, 0, 0);
    expect(REGLAS_IP_DIARIAS.fotos!.maximo).toBe(3);
    // Las 3 en la misma hora pasan: ya no hay límite horario de fotos.
    for (let i = 0; i < 3; i++) expect(await capturar(limitarIp(env.DB, 'fotos', 'ipDiaria', t0))).toBeNull();
    expect((await capturar(limitarIp(env.DB, 'fotos', 'ipDiaria', t0 + HORA)))?.estado).toBe(429);
    const e = await capturar(limitarIp(env.DB, 'fotos', 'ipDiaria', t0 + 2 * HORA));
    expect(e?.estado).toBe(429);
    expect(e?.codigo).toBe('demasiadas_solicitudes');
    expect(e?.reintentarEn).toBe(22 * 3600); // hasta la medianoche UTC
    // Otra IP no se ve afectada y al día siguiente vuelve a permitir.
    expect(await capturar(limitarIp(env.DB, 'fotos', 'otraIp', t0 + 2 * HORA))).toBeNull();
    expect(await capturar(limitarIp(env.DB, 'fotos', 'ipDiaria', t0 + DIA))).toBeNull();
  });

  it('propuestas: la 21 del día → 429', async () => {
    const t0 = Date.UTC(2031, 0, 11, 5, 0, 0);
    expect(REGLAS_IP_DIARIAS.propuestas!.maximo).toBe(20);
    for (let i = 0; i < 10; i++) await limitarIp(env.DB, 'propuestas', 'ipP', t0);
    for (let i = 0; i < 10; i++) await limitarIp(env.DB, 'propuestas', 'ipP', t0 + HORA);
    expect((await capturar(limitarIp(env.DB, 'propuestas', 'ipP', t0 + 2 * HORA)))?.estado).toBe(429);
  });

  it('HTTP: la 4.ª foto del día desde la misma IP → 429 con Retry-After (sin gastar el tope global)', async () => {
    const ip = '198.18.220.1';
    const ahora = Date.now();
    const hash = await sha256Hex(`${env.SAL_IP}${ip}`);
    // Simula 3 fotos ya subidas hoy por esta IP (en horas anteriores).
    await env.DB.prepare('INSERT INTO limites (clave, conteo, expira_en) VALUES (?, ?, ?)')
      .bind(`fotos:dia:${hash}:${Math.floor(ahora / DIA)}`, 3, (Math.floor(ahora / DIA) + 1) * DIA)
      .run();
    const antes = await totalGlobal('fotos');
    const r = await subir(CIFRADA(), ip);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(((await r.json()) as any).error.codigo).toBe('demasiadas_solicitudes');
    expect(await totalGlobal('fotos')).toBe(antes);
  });
});
