import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { construirAviso, publicarNtfy } from '../src/ntfy';
import { CIFRADO, crearPropuesta, crearPropuestaV1, evento, panel, pedir } from './ayuda';

type Panel = {
  eventos: Record<string, any>[];
  cursor: number;
  resumen: Record<string, any>;
  para: string | null;
  cifrado?: string;
  expiraEn: string;
  ntfyTema: string | null;
};

describe('POST /propuestas/:id/eventos', () => {
  it('flujo completo v2 (cifrado) con text/plain y panel con resumen', async () => {
    const { id, claveAdmin } = await crearPropuesta();
    const eleccion1 = CIFRADO(80);
    const eleccion2 = CIFRADO(120);
    expect((await evento(id, { tipo: 'abierto' })).status).toBe(202);
    expect((await evento(id, { tipo: 'intento_no', conteo: 4 })).status).toBe(202);
    expect((await evento(id, { tipo: 'intento_no', conteo: 2 })).status).toBe(202);
    expect((await evento(id, { tipo: 'abierto' })).status).toBe(202);
    const si = await evento(id, { tipo: 'si' });
    expect(si.status).toBe(202);
    expect(await si.json()).toEqual({ ok: true });
    expect((await evento(id, { tipo: 'celebracion_elegida', cifrado: eleccion1 })).status).toBe(202);
    expect((await evento(id, { tipo: 'celebracion_elegida', cifrado: eleccion2 })).status).toBe(202);

    const r = await panel(id, claveAdmin);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const b = (await r.json()) as Panel;
    expect(b.eventos.map((e) => e.tipo)).toEqual(['abierto', 'intento_no', 'intento_no', 'abierto', 'si', 'celebracion_elegida', 'celebracion_elegida']);
    expect(b.eventos[1]).toMatchObject({ tipo: 'intento_no', conteo: 4, sesion: 'Qw8e7r6t5y4u3i2o' });
    // El servidor no puede leer la elección: la devuelve tal como llegó, cifrada.
    expect(b.eventos[6]).toMatchObject({ tipo: 'celebracion_elegida', cifrado: eleccion2 });
    expect(b.eventos[6]).not.toHaveProperty('opcionId');
    expect(b.cursor).toBe(b.eventos[6]!.id);
    // El nombre viaja dentro del contenido cifrado, que solo se manda en la primera consulta.
    expect(b.para).toBeNull();
    expect(b.cifrado).toBe(CIFRADO());
    expect(b.ntfyTema).toBeNull();
    expect(b.resumen).toMatchObject({
      abierto: true,
      vecesAbierto: 2,
      intentosNo: 6,
      si: true,
      celebracion: { cifrado: eleccion2 },
    });
    expect(b.resumen.primeraApertura).toBe(b.eventos[0]!.creadoEn);
    expect(b.resumen.siEn).toBe(b.eventos[4]!.creadoEn);

    // Cursor: solo eventos nuevos, pero el resumen sigue siendo total.
    const r2 = (await (await panel(id, claveAdmin, b.cursor)).json()) as Panel;
    expect(r2.eventos).toEqual([]);
    expect(r2).not.toHaveProperty('cifrado');
    expect(r2.cursor).toBe(b.cursor);
    expect(r2.resumen.intentosNo).toBe(6);
    const r3 = (await (await panel(id, claveAdmin, b.eventos[4]!.id)).json()) as Panel;
    expect(r3.eventos).toHaveLength(2);
  });

  it('flujo v1 heredado: opcionId y nota en claro con etiqueta y nombre', async () => {
    const { id, claveAdmin } = await crearPropuestaV1();
    expect((await evento(id, { tipo: 'celebracion_elegida', opcionId: 'helado' })).status).toBe(202);
    expect((await evento(id, { tipo: 'celebracion_elegida', opcionId: 'btk', nota: '  ¡Pero tú invitas!  ' })).status).toBe(202);
    // En una propuesta v1 no se acepta la elección cifrada.
    expect((await evento(id, { tipo: 'celebracion_elegida', cifrado: CIFRADO() })).status).toBe(422);
    const b = (await (await panel(id, claveAdmin)).json()) as Panel;
    expect(b.eventos[1]).toMatchObject({ opcionId: 'btk', etiqueta: 'La BTK', nota: '¡Pero tú invitas!' });
    expect(b.para).toBe('Ana');
    expect(b).not.toHaveProperty('cifrado');
    expect(b.resumen.celebracion).toMatchObject({ opcionId: 'btk', etiqueta: 'La BTK', nota: '¡Pero tú invitas!' });
  });

  it('acepta también application/json', async () => {
    const { id } = await crearPropuesta();
    const r = await pedir(`/propuestas/${id}/eventos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'abierto', sesion: 'Qw8e7r6t5y4u3i2o' }),
    });
    expect(r.status).toBe(202);
  });

  it('"si" repetido → 200 duplicado y una sola fila', async () => {
    const { id } = await crearPropuesta();
    expect((await evento(id, { tipo: 'si' })).status).toBe(202);
    const r = await evento(id, { tipo: 'si' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, duplicado: true });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM eventos WHERE propuesta_id = ? AND tipo = 'si'").bind(id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  const invalidos: [string, Record<string, unknown>][] = [
    ['tipo desconocido', { tipo: 'no' }],
    ['sesión mal formada', { tipo: 'abierto', sesion: 'corta' }],
    ['conteo 0', { tipo: 'intento_no', conteo: 0 }],
    ['conteo 1001', { tipo: 'intento_no', conteo: 1001 }],
    ['conteo decimal', { tipo: 'intento_no', conteo: 1.5 }],
    ['celebración v2 con opcionId en claro', { tipo: 'celebracion_elegida', opcionId: 'btk' }],
    ['celebración con cifrado y opcionId a la vez', { tipo: 'celebracion_elegida', cifrado: CIFRADO(), opcionId: 'btk' }],
    ['celebración sin elección', { tipo: 'celebracion_elegida' }],
    ['cifrado fuera de base64url', { tipo: 'celebracion_elegida', cifrado: CIFRADO() + '<script>' }],
    ['cifrado demasiado largo', { tipo: 'celebracion_elegida', cifrado: CIFRADO(1201) }],
    ['campo extra en abierto', { tipo: 'abierto', admin: true }],
    ['campo extra en si', { tipo: 'si', creadoEn: '2020-01-01T00:00:00Z' }],
  ];
  it.each(invalidos)('%s → 422 validacion', async (_n, cuerpo) => {
    const { id } = await crearPropuesta();
    const r = await evento(id, cuerpo);
    expect(r.status).toBe(422);
    expect(((await r.json()) as any).error.codigo).toBe('validacion');
  });

  const invalidosV1: [string, Record<string, unknown>][] = [
    ['opción que no existe', { tipo: 'celebracion_elegida', opcionId: 'cine' }],
    ['nota de 141', { tipo: 'celebracion_elegida', opcionId: 'btk', nota: 'a'.repeat(141) }],
  ];
  it.each(invalidosV1)('v1: %s → 422 validacion', async (_n, cuerpo) => {
    const { id } = await crearPropuestaV1();
    const r = await evento(id, cuerpo);
    expect(r.status).toBe(422);
    expect(((await r.json()) as any).error.codigo).toBe('validacion');
  });

  it('cuerpo no JSON → 400', async () => {
    const { id } = await crearPropuesta();
    const r = await pedir(`/propuestas/${id}/eventos`, { method: 'POST', body: 'hola' });
    expect(r.status).toBe(400);
  });

  it('propuesta inexistente → 404; expirada → 410', async () => {
    expect((await evento('AAAAAAAAAAAC', { tipo: 'abierto' })).status).toBe(404);
    const { id } = await crearPropuesta();
    await env.DB.prepare('UPDATE propuestas SET expira_en = ? WHERE id = ?').bind(Date.now() - 1, id).run();
    expect((await evento(id, { tipo: 'abierto' })).status).toBe(410);
  });

  it('tope de 300 eventos → 409 limite_eventos (un "si" sigue sin duplicarse)', async () => {
    const { id } = await crearPropuesta();
    const ahora = Date.now();
    const insertar = env.DB.prepare(
      "INSERT INTO eventos (propuesta_id, tipo, datos, sesion, creado_en) VALUES (?, 'intento_no', '{\"conteo\":1}', 'Qw8e7r6t5y4u3i2o', ?)",
    );
    await env.DB.batch(Array.from({ length: 299 }, () => insertar.bind(id, ahora)));
    expect((await evento(id, { tipo: 'si' })).status).toBe(202); // el 300
    const r = await evento(id, { tipo: 'abierto' });
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).error.codigo).toBe('limite_eventos');
    expect((await evento(id, { tipo: 'si' })).status).toBe(200);
  });

  it('más de 10 celebraciones → 409', async () => {
    const { id } = await crearPropuesta();
    for (let i = 0; i < 10; i++) expect((await evento(id, { tipo: 'celebracion_elegida', cifrado: CIFRADO() })).status).toBe(202);
    expect((await evento(id, { tipo: 'celebracion_elegida', cifrado: CIFRADO() })).status).toBe(409);
  });
});

describe('GET /propuestas/:id/eventos (panel)', () => {
  it('sin clave o con clave incorrecta → 401; propuesta inexistente → 404', async () => {
    const { id, claveAdmin } = await crearPropuesta();
    expect((await panel(id, null)).status).toBe(401);
    const malo = await panel(id, claveAdmin.slice(0, -1) + (claveAdmin.endsWith('a') ? 'b' : 'a'));
    expect(malo.status).toBe(401);
    expect(((await malo.json()) as any).error.codigo).toBe('no_autorizado');
    expect((await panel('AAAAAAAAAAAD', claveAdmin)).status).toBe(404);
  });

  it('desde inválido → 422', async () => {
    const { id, claveAdmin } = await crearPropuesta();
    const r = await pedir(`/propuestas/${id}/eventos?desde=-1`, { headers: { Authorization: `Bearer ${claveAdmin}` } });
    expect(r.status).toBe(422);
  });

  it('pagina de 100 en 100 con el cursor', async () => {
    const { id, claveAdmin } = await crearPropuesta();
    const insertar = env.DB.prepare(
      "INSERT INTO eventos (propuesta_id, tipo, datos, sesion, creado_en) VALUES (?, 'intento_no', '{\"conteo\":1}', 'Qw8e7r6t5y4u3i2o', ?)",
    );
    await env.DB.batch(Array.from({ length: 150 }, () => insertar.bind(id, Date.now())));
    const p1 = (await (await panel(id, claveAdmin)).json()) as Panel;
    expect(p1.eventos).toHaveLength(100);
    expect(p1.resumen.intentosNo).toBe(150);
    const p2 = (await (await panel(id, claveAdmin, p1.cursor)).json()) as Panel;
    expect(p2.eventos).toHaveLength(50);
  });

  it('devuelve el tema ntfy cuando se activaron los avisos', async () => {
    const { id, claveAdmin, ntfyTema } = await crearPropuesta({ avisos: { push: true } });
    expect((await evento(id, { tipo: 'si' })).status).toBe(202); // NTFY_BASE vacío en tests: no sale a internet
    const b = (await (await panel(id, claveAdmin)).json()) as Panel;
    expect(b.ntfyTema).toBe(ntfyTema);
  });
});

describe('ntfy', () => {
  it('construye avisos solo para abierto, si y celebracion_elegida', () => {
    expect(construirAviso('abierto', 'Ana')!.mensaje).toBe('Ana abrió tu enlace');
    expect(construirAviso('si', 'Ana')!.mensaje).toBe('¡Ana dijo que SÍ! 💖');
    expect(construirAviso('celebracion_elegida', 'Ana', 'La BTK')!.mensaje).toBe('Ana eligió celebrar en: La BTK');
    expect(construirAviso('intento_no', 'Ana')).toBeNull();
  });

  it('en propuestas cifradas el aviso no lleva nombre ni opción (el servidor no los conoce)', () => {
    expect(construirAviso('abierto', null)!.mensaje).toBe('Abrieron tu enlace 👀');
    expect(construirAviso('si', null)!.mensaje).toBe('¡Dijo que SÍ! 💖');
    expect(construirAviso('celebracion_elegida', null, null)!.mensaje).not.toMatch(/BTK|Ana/);
  });

  it('publica JSON en la raíz del servidor ntfy', async () => {
    const llamadas: [string, RequestInit][] = [];
    const falso = (async (url: string, init: RequestInit) => {
      llamadas.push([url, init]);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const ok = await publicarNtfy('https://ntfy.sh/', 'TemaSecreto', construirAviso('si', 'Ana')!, falso);
    expect(ok).toBe(true);
    expect(llamadas[0]![0]).toBe('https://ntfy.sh/');
    expect(JSON.parse(String(llamadas[0]![1].body))).toMatchObject({ topic: 'TemaSecreto', message: '¡Ana dijo que SÍ! 💖' });
  });

  it('nunca lanza si ntfy falla y no hace nada sin base', async () => {
    const roto = (async () => {
      throw new TypeError('sin red');
    }) as unknown as typeof fetch;
    expect(await publicarNtfy('https://ntfy.sh', 't', { titulo: 'x', mensaje: 'y' }, roto)).toBe(false);
    expect(await publicarNtfy('', 't', { titulo: 'x', mensaje: 'y' }, roto)).toBe(false);
  });
});
