import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { limitar, REGLAS_IP, TOPES_GLOBALES } from '../src/limite-tasa';
import { limpiar } from '../src/limpieza';
import { ErrorApi } from '../src/errores';
import { crearPropuesta, json, nuevaIp, pedir, propuestaValida, subirFoto } from './ayuda';

const HORA = 3_600_000;

async function capturar(p: Promise<unknown>): Promise<ErrorApi | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ErrorApi;
  }
}

describe('límites de tasa (reloj simulado)', () => {
  it('ventana fija por IP: 60 eventos por minuto, el 61 → 429 con Retry-After', async () => {
    const t0 = Date.UTC(2030, 0, 1, 12, 0, 10);
    for (let i = 0; i < REGLAS_IP.eventos.maximo; i++) await limitar(env.DB, 'eventos', 'ipA', t0);
    const e = await capturar(limitar(env.DB, 'eventos', 'ipA', t0));
    expect(e?.estado).toBe(429);
    expect(e?.codigo).toBe('demasiadas_solicitudes');
    expect(e?.reintentarEn).toBe(50);
    // Otra IP no se ve afectada y el minuto siguiente vuelve a permitir.
    expect(await capturar(limitar(env.DB, 'eventos', 'ipB', t0))).toBeNull();
    expect(await capturar(limitar(env.DB, 'eventos', 'ipA', t0 + 60_000))).toBeNull();
  });

  it('tope global diario de fotos → 503 capacidad_agotada', async () => {
    const t0 = Date.UTC(2030, 0, 2, 3, 0, 0);
    const tope = TOPES_GLOBALES.fotos!.maximo;
    await env.DB.prepare('INSERT INTO limites (clave, conteo, expira_en) VALUES (?, ?, ?)')
      .bind(`fotos:global:${Math.floor(t0 / 86_400_000)}`, tope, t0 + 86_400_000)
      .run();
    const e = await capturar(limitar(env.DB, 'fotos', 'ipC', t0));
    expect(e?.estado).toBe(503);
    expect(e?.codigo).toBe('capacidad_agotada');
  });

  it('HTTP: la propuesta 11 de la misma IP en una hora → 429 con cabecera Retry-After', async () => {
    const ip = nuevaIp();
    for (let i = 0; i < REGLAS_IP.propuestas.maximo; i++) {
      expect((await pedir('/propuestas', json(propuestaValida(), { ip }))).status).toBe(201);
    }
    const r = await pedir('/propuestas', json(propuestaValida(), { ip }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(((await r.json()) as any).error.codigo).toBe('demasiadas_solicitudes');
  });

  it('la IP en claro nunca se guarda', async () => {
    const ip = '203.0.113.77';
    await pedir('/fotos', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'x', ip });
    const { results } = await env.DB.prepare('SELECT clave FROM limites').all<{ clave: string }>();
    expect(results.some((r) => r.clave.includes(ip))).toBe(false);
  });
});

describe('limpieza programada', () => {
  it('borra propuestas expiradas (con fotos y eventos), fotos huérfanas viejas y contadores vencidos', async () => {
    const ahora = Date.now();
    const fotoUsada = (await (await subirFoto()).json()) as { id: string };
    const huerfanaVieja = (await (await subirFoto()).json()) as { id: string };
    const huerfanaNueva = (await (await subirFoto()).json()) as { id: string };
    const vieja = await crearPropuesta({ fotos: [fotoUsada.id] });
    const vigente = await crearPropuesta();
    await pedir(`/propuestas/${vieja.id}/eventos`, { method: 'POST', body: JSON.stringify({ tipo: 'abierto', sesion: 'Qw8e7r6t5y4u3i2o' }) });

    await env.DB.prepare('UPDATE propuestas SET expira_en = ? WHERE id = ?').bind(ahora - 1, vieja.id).run();
    await env.DB.prepare('UPDATE fotos SET creada_en = ? WHERE id = ?').bind(ahora - 25 * HORA, huerfanaVieja.id).run();
    await env.DB.prepare("INSERT INTO limites (clave, conteo, expira_en) VALUES ('x:y:1', 1, ?)").bind(ahora - 1).run();

    const r = await limpiar(env, ahora);
    expect(r.propuestas).toBeGreaterThanOrEqual(1);
    expect(r.fotosHuerfanas).toBeGreaterThanOrEqual(1);
    expect(r.limites).toBeGreaterThanOrEqual(1);

    const existe = async (sql: string, id: string) => (await env.DB.prepare(sql).bind(id).first()) !== null;
    expect(await existe('SELECT 1 FROM propuestas WHERE id = ?', vieja.id)).toBe(false);
    expect(await existe('SELECT 1 FROM propuestas WHERE id = ?', vigente.id)).toBe(true);
    expect(await existe('SELECT 1 FROM eventos WHERE propuesta_id = ?', vieja.id)).toBe(false);
    expect(await existe('SELECT 1 FROM fotos WHERE id = ?', fotoUsada.id)).toBe(false);
    expect(await existe('SELECT 1 FROM fotos WHERE id = ?', huerfanaVieja.id)).toBe(false);
    expect(await existe('SELECT 1 FROM fotos WHERE id = ?', huerfanaNueva.id)).toBe(true);
    expect(await env.FOTOS.head(`fotos/${fotoUsada.id}`)).toBeNull();
    expect(await env.FOTOS.head(`fotos/${huerfanaVieja.id}`)).toBeNull();
    expect(await env.FOTOS.head(`fotos/${huerfanaNueva.id}`)).not.toBeNull();
    expect(await existe("SELECT 1 FROM limites WHERE clave = ?", 'x:y:1')).toBe(false);
  });

  it('el handler scheduled ejecuta la limpieza', async () => {
    const { id } = await crearPropuesta();
    await env.DB.prepare('UPDATE propuestas SET expira_en = ? WHERE id = ?').bind(Date.now() - 1, id).run();
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 4 * * *', scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await env.DB.prepare('SELECT 1 FROM propuestas WHERE id = ?').bind(id).first()).toBeNull();
  });
});
