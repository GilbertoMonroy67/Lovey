import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITES } from '../../js/limites.js';
import { exigirHumano, verificarTurnstile } from '../src/turnstile';
import { CIFRADO, crearPropuesta, crearPropuestaV1, json, pedir, propuestaValida, subirFoto } from './ayuda';

async function crear(cuerpo: unknown) {
  return pedir('/propuestas', json(cuerpo));
}

async function erroresDe(r: Response) {
  const b = (await r.json()) as { error: { codigo: string; detalles?: { campo: string }[] } };
  return b.error;
}

describe('POST /propuestas (v2 cifrada)', () => {
  it('crea y devuelve id, claveAdmin, expiraEn y ntfyTema nulo', async () => {
    const r = await crear(propuestaValida());
    expect(r.status).toBe(201);
    const b = (await r.json()) as Record<string, string | null>;
    expect(Object.keys(b).sort()).toEqual(['claveAdmin', 'expiraEn', 'id', 'ntfyTema']);
    expect(b.id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(b.claveAdmin).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(b.ntfyTema).toBeNull();
    const dias = (Date.parse(b.expiraEn!) - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(29.9);
    expect(dias).toBeLessThanOrEqual(30);
    // Solo se guarda el hash de la clave y el sobre cifrado (nada en claro).
    const fila = await env.DB.prepare('SELECT clave_hash, datos FROM propuestas WHERE id = ?').bind(b.id).first<{ clave_hash: string; datos: string }>();
    expect(fila!.clave_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila!.clave_hash).not.toContain(b.claveAdmin);
    expect(JSON.parse(fila!.datos)).toEqual({ v: 2, cifrado: CIFRADO(), fotos: [] });
  });

  it('con avisos.push genera un tema ntfy secreto', async () => {
    const b = await crearPropuesta({ avisos: { push: true } });
    expect(b.ntfyTema).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('JSON inválido → 400 json_invalido', async () => {
    const r = await crear('{no es json');
    expect(r.status).toBe(400);
    expect((await erroresDe(r)).codigo).toBe('json_invalido');
  });

  it('cuerpo > 32 KB → 413', async () => {
    const r = await crear(propuestaValida({ cifrado: CIFRADO(33 * 1024) }));
    expect(r.status).toBe(413);
    expect((await erroresDe(r)).codigo).toBe('archivo_muy_grande');
  });

  const casos: [string, Record<string, unknown>, string][] = [
    ['v = 1 (ya no se crean propuestas sin cifrar)', { v: 1 }, 'v'],
    ['sin cifrado', { cifrado: undefined }, 'cifrado'],
    ['cifrado con caracteres fuera de base64url', { cifrado: CIFRADO(100) + '+/=' }, 'cifrado'],
    ['cifrado demasiado corto', { cifrado: CIFRADO(39) }, 'cifrado'],
    ['cifrado demasiado largo', { cifrado: CIFRADO(LIMITES.cifradoPropuesta + 1) }, 'cifrado'],
    ['11 fotos', { fotos: Array.from({ length: 11 }, (_, i) => `f_AAAAAAAAAAAAAA${String(i).padStart(2, '0')}`) }, 'fotos'],
    ['id de foto con formato malo', { fotos: ['foto1'] }, 'fotos.0'],
    ['foto repetida', { fotos: ['f_AAAAAAAAAAAAAAAA', 'f_AAAAAAAAAAAAAAAA'] }, 'fotos'],
    ['avisos con campos extra', { avisos: { push: true, tema: 'elegido-por-mi' } }, 'avisos'],
  ];

  it.each(casos)('%s → 422 validacion', async (_n, cambios, campo) => {
    const r = await crear(propuestaValida(cambios));
    expect(r.status).toBe(422);
    const e = await erroresDe(r);
    expect(e.codigo).toBe('validacion');
    expect(e.detalles!.map((d) => d.campo)).toContain(campo);
  });

  // Manipulación de campos: lo que fija el servidor (id, clave, fechas, tema) no se puede mandar.
  it.each([
    ['id', { id: 'AAAAAAAAAAAA' }],
    ['claveAdmin', { claveAdmin: 'x'.repeat(32) }],
    ['expiraEn', { expiraEn: '2099-01-01T00:00:00Z' }],
    ['ntfyTema', { ntfyTema: 'mi-tema' }],
    ['campos v1 en claro', { para: 'Ana' }],
  ])('campo no permitido "%s" → 422', async (_n, extra) => {
    const r = await crear(propuestaValida(extra));
    expect(r.status).toBe(422);
    expect((await erroresDe(r)).codigo).toBe('validacion');
  });

  it('una foto inexistente → 422 foto_invalida', async () => {
    const r = await crear(propuestaValida({ fotos: ['f_AAAAAAAAAAAAAAAA'] }));
    expect(r.status).toBe(422);
    expect((await erroresDe(r)).codigo).toBe('foto_invalida');
  });
});

describe('GET /propuestas/:id', () => {
  it('v2: devuelve solo el sobre cifrado, las URLs de las fotos y las fechas', async () => {
    const foto = (await (await subirFoto()).json()) as { id: string };
    const { id } = await crearPropuesta({ avisos: { push: true }, fotos: [foto.id] });
    const r = await pedir(`/propuestas/${id}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const b = (await r.json()) as Record<string, any>;
    expect(Object.keys(b).sort()).toEqual(['cifrado', 'creadaEn', 'expiraEn', 'fotos', 'id', 'v']);
    expect(b).toMatchObject({ v: 2, id, cifrado: CIFRADO() });
    expect(b.fotos).toEqual([{ id: foto.id, url: `https://api.test/api/v1/fotos/${foto.id}` }]);
    expect(Date.parse(b.creadaEn)).toBeLessThan(Date.parse(b.expiraEn));
  });

  it('v1 heredada: se sigue leyendo en claro hasta que expire', async () => {
    const { id } = await crearPropuestaV1();
    const b = (await (await pedir(`/propuestas/${id}`)).json()) as Record<string, any>;
    expect(b).toMatchObject({ v: 1, id, plantilla: 'romantica', tipo: 'novia', de: 'Gilberto', para: 'Ana' });
    expect(b.celebracion.opciones).toHaveLength(2);
  });

  it('id inexistente o mal formado → 404', async () => {
    expect((await pedir('/propuestas/AAAAAAAAAAAA')).status).toBe(404);
    expect((await pedir('/propuestas/AAAAAAAAAAA%21')).status).toBe(404);
    expect((await pedir('/propuestas/corto')).status).toBe(404);
  });

  it('propuesta expirada (sin limpiar aún) → 410 expirada', async () => {
    const { id } = await crearPropuesta();
    await env.DB.prepare('UPDATE propuestas SET expira_en = ? WHERE id = ?').bind(Date.now() - 1000, id).run();
    const r = await pedir(`/propuestas/${id}`);
    expect(r.status).toBe(410);
    expect((await erroresDe(r)).codigo).toBe('expirada');
  });
});

describe('DELETE /propuestas/:id', () => {
  it('sin clave → 401; clave incorrecta → 401; correcta → 204 y borra todo', async () => {
    const foto = (await (await subirFoto()).json()) as { id: string };
    const { id, claveAdmin } = await crearPropuesta({ fotos: [foto.id] });
    await pedir(`/propuestas/${id}/eventos`, { method: 'POST', body: JSON.stringify({ tipo: 'abierto', sesion: 'Qw8e7r6t5y4u3i2o' }) });

    expect((await pedir(`/propuestas/${id}`, { method: 'DELETE' })).status).toBe(401);
    expect((await pedir(`/propuestas/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + 'x'.repeat(32) } })).status).toBe(401);
    const r = await pedir(`/propuestas/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${claveAdmin}` } });
    expect(r.status).toBe(204);

    expect((await pedir(`/propuestas/${id}`)).status).toBe(404);
    expect((await pedir(`/fotos/${foto.id}`)).status).toBe(404);
    expect(await env.FOTOS.get(`fotos/${foto.id}`)).toBeNull();
    const ev = await env.DB.prepare('SELECT COUNT(*) AS n FROM eventos WHERE propuesta_id = ?').bind(id).first<{ n: number }>();
    expect(ev!.n).toBe(0);
  });

  it('propuesta inexistente → 404', async () => {
    const r = await pedir('/propuestas/AAAAAAAAAAAB', { method: 'DELETE', headers: { Authorization: 'Bearer x' } });
    expect(r.status).toBe(404);
  });
});

describe('Turnstile (protección contra bots)', () => {
  const respuesta = (exito: boolean) =>
    (async () => new Response(JSON.stringify({ success: exito }), { status: 200 })) as unknown as typeof fetch;
  const conToken = (token?: string) =>
    new Request('https://api.test/api/v1/propuestas', { method: 'POST', headers: token ? { 'X-Turnstile-Token': token } : {} });

  it('sin secreto configurado no se verifica nada', async () => {
    await expect(exigirHumano(conToken(), undefined)).resolves.toBeUndefined();
  });

  it('con secreto: sin token o con token rechazado → 403 verificacion_bot; válido → pasa', async () => {
    await expect(exigirHumano(conToken(), 'secreto', respuesta(true))).rejects.toMatchObject({ estado: 403, codigo: 'verificacion_bot' });
    await expect(exigirHumano(conToken('malo'), 'secreto', respuesta(false))).rejects.toMatchObject({ codigo: 'verificacion_bot' });
    await expect(exigirHumano(conToken('bueno'), 'secreto', respuesta(true))).resolves.toBeUndefined();
  });

  it('si siteverify no responde, falla cerrada', async () => {
    const roto = (async () => {
      throw new TypeError('sin red');
    }) as unknown as typeof fetch;
    expect(await verificarTurnstile('secreto', 'token', '1.2.3.4', roto)).toBe(false);
  });

  it('manda secreto, token e IP a siteverify', async () => {
    let cuerpo: FormData | null = null;
    const falso = (async (_url: string, init: RequestInit) => {
      cuerpo = init.body as FormData;
      return new Response('{"success":true}');
    }) as unknown as typeof fetch;
    expect(await verificarTurnstile('s3cr3t', 'tok', '1.2.3.4', falso)).toBe(true);
    expect(cuerpo!.get('secret')).toBe('s3cr3t');
    expect(cuerpo!.get('response')).toBe('tok');
    expect(cuerpo!.get('remoteip')).toBe('1.2.3.4');
  });
});

describe('mensajes de validación', () => {
  it('los mensajes genéricos de Zod salen en español', async () => {
    const r = await pedir('/propuestas', json({ v: 2, cifrado: CIFRADO(), fotos: 'no-es-lista' }));
    const e = (await r.json()) as { error: { detalles: { campo: string; mensaje: string }[] } };
    const fotos = e.error.detalles.find((d) => d.campo === 'fotos')!;
    expect(fotos.mensaje).not.toMatch(/Invalid input/);
    expect(fotos.mensaje).toMatch(/inválid|Se esperaba/i);
  });
});
