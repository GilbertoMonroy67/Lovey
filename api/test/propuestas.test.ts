import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { crearPropuesta, json, pedir, propuestaValida, subirFoto } from './ayuda';

async function crear(cuerpo: unknown) {
  return pedir('/propuestas', json(cuerpo));
}

async function erroresDe(r: Response) {
  const b = (await r.json()) as { error: { codigo: string; detalles?: { campo: string }[] } };
  return b.error;
}

describe('POST /propuestas', () => {
  it('crea y devuelve id, claveAdmin, expiraEn y ntfyTema nulo', async () => {
    const r = await crear(propuestaValida());
    expect(r.status).toBe(201);
    const b = (await r.json()) as Record<string, string | null>;
    expect(b.id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(b.claveAdmin).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(b.ntfyTema).toBeNull();
    const dias = (Date.parse(b.expiraEn!) - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(29.9);
    expect(dias).toBeLessThanOrEqual(30);
    // Solo se guarda el hash de la clave.
    const fila = await env.DB.prepare('SELECT clave_hash, datos FROM propuestas WHERE id = ?').bind(b.id).first<{ clave_hash: string; datos: string }>();
    expect(fila!.clave_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(fila!.clave_hash).not.toContain(b.claveAdmin);
    expect(JSON.parse(fila!.datos)).not.toHaveProperty('avisos');
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

  it('cuerpo > 16 KB → 413', async () => {
    const r = await crear(propuestaValida({ relleno: 'x'.repeat(17 * 1024) }));
    expect(r.status).toBe(413);
    expect((await erroresDe(r)).codigo).toBe('archivo_muy_grande');
  });

  const casos: [string, Record<string, unknown>, string][] = [
    ['v distinto de 1', { v: 2 }, 'v'],
    ['plantilla con mayúsculas', { plantilla: 'Romantica' }, 'plantilla'],
    ['tipo desconocido', { tipo: 'amante' }, 'tipo'],
    ['de vacío tras trim', { de: '   ' }, 'de'],
    ['para de 41 caracteres', { para: 'a'.repeat(41) }, 'para'],
    ['0 pasos', { pasos: [] }, 'pasos'],
    ['6 pasos', { pasos: Array.from({ length: 6 }, () => ({ texto: 'hola', fotos: [] })) }, 'pasos'],
    ['texto de 281', { pasos: [{ texto: 'a'.repeat(281), fotos: [] }] }, 'pasos.0.texto'],
    ['texto con carácter de control', { pasos: [{ texto: 'hola\u0007', fotos: [] }] }, 'pasos.0.texto'],
    ['4 fotos en un paso', { pasos: [{ texto: 'a', fotos: Array.from({ length: 4 }, (_, i) => ({ id: `f_AAAAAAAAAAAAAAA${i}` })) }] }, 'pasos.0.fotos'],
    ['id de foto con formato malo', { pasos: [{ texto: 'a', fotos: [{ id: 'foto1' }] }] }, 'pasos.0.fotos.0.id'],
    ['alt de 101', { pasos: [{ texto: 'a', fotos: [{ id: 'f_AAAAAAAAAAAAAAAA', alt: 'a'.repeat(101) }] }] }, 'pasos.0.fotos.0.alt'],
    ['pregunta de 121', { pregunta: 'a'.repeat(121) }, 'pregunta'],
    ['pregunta con salto de línea', { pregunta: 'hola\nadiós' }, 'pregunta'],
    ['título de celebración vacío', { celebracion: { titulo: '', opciones: [] } }, 'celebracion.titulo'],
    ['9 opciones', { celebracion: { titulo: 't', opciones: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, etiqueta: 'x' })) } }, 'celebracion.opciones'],
    ['opción con id repetido', { celebracion: { titulo: 't', opciones: [{ id: 'btk', etiqueta: 'a' }, { id: 'btk', etiqueta: 'b' }] } }, 'celebracion.opciones.1.id'],
    ['etiqueta de 41', { celebracion: { titulo: 't', opciones: [{ id: 'a', etiqueta: 'a'.repeat(41) }] } }, 'celebracion.opciones.0.etiqueta'],
    ['emoji de 9', { celebracion: { titulo: 't', opciones: [{ id: 'a', etiqueta: 'a', emoji: '123456789' }] } }, 'celebracion.opciones.0.emoji'],
    ['mensajeFinal de 201', { mensajeFinal: 'a'.repeat(201) }, 'mensajeFinal'],
  ];

  it.each(casos)('%s → 422 validacion', async (_n, cambios, campo) => {
    const r = await crear(propuestaValida(cambios));
    expect(r.status).toBe(422);
    const e = await erroresDe(r);
    expect(e.codigo).toBe('validacion');
    expect(e.detalles!.map((d) => d.campo)).toContain(campo);
  });

  it('más de 10 fotos en total → 422', async () => {
    const pasos = Array.from({ length: 4 }, (_, p) => ({
      texto: 'a',
      fotos: Array.from({ length: 3 }, (_, i) => ({ id: `f_AAAAAAAAAAAAAA${p}${i}` })),
    }));
    const r = await crear(propuestaValida({ pasos }));
    expect(r.status).toBe(422);
    expect((await erroresDe(r)).detalles!.map((d) => d.campo)).toContain('pasos');
  });

  it('acepta los valores en el borde de los límites y normaliza con trim', async () => {
    const r = await crear(
      propuestaValida({
        de: '  ' + 'a'.repeat(40) + '  ',
        pasos: Array.from({ length: 5 }, () => ({ texto: 'b'.repeat(280), fotos: [] })),
        pregunta: 'c'.repeat(120),
        celebracion: undefined,
        mensajeFinal: '',
      }),
    );
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    const g = (await (await pedir(`/propuestas/${id}`)).json()) as Record<string, unknown>;
    expect(g.de).toBe('a'.repeat(40));
    expect(g).not.toHaveProperty('celebracion');
  });

  // Criterio único de longitud (contrato §3.3): code points, igual que largo() de js/utilidades.js.
  // Zod ≥ 4.6 cuenta code points en .min/.max de strings; este test fija ese comportamiento.
  it('cuenta la longitud en code points (emojis), igual que el frontend', async () => {
    const ok = await crear(
      propuestaValida({
        pasos: [{ texto: '💖'.repeat(280), fotos: [] }],
        celebracion: { titulo: 't', opciones: [{ id: 'a', etiqueta: 'a', emoji: '👨‍👩‍👧‍👦' }] },
      }),
    );
    expect(ok.status).toBe(201);
    const largo = await crear(propuestaValida({ pasos: [{ texto: '💖'.repeat(281), fotos: [] }] }));
    expect(largo.status).toBe(422);
    expect((await erroresDe(largo)).detalles!.map((d) => d.campo)).toContain('pasos.0.texto');
  });

  it('una foto inexistente → 422 foto_invalida', async () => {
    const r = await crear(propuestaValida({ pasos: [{ texto: 'a', fotos: [{ id: 'f_AAAAAAAAAAAAAAAA' }] }] }));
    expect(r.status).toBe(422);
    expect((await erroresDe(r)).codigo).toBe('foto_invalida');
  });
});

describe('GET /propuestas/:id', () => {
  it('devuelve §3.2: sin avisos, con url de fotos y fechas', async () => {
    const foto = (await (await subirFoto()).json()) as { id: string };
    const { id } = await crearPropuesta({
      avisos: { push: true },
      pasos: [{ texto: 'Primer paso', fotos: [{ id: foto.id, alt: 'Nuestra cita' }] }],
    });
    const r = await pedir(`/propuestas/${id}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const b = (await r.json()) as Record<string, any>;
    expect(b).not.toHaveProperty('avisos');
    expect(b).toMatchObject({ v: 1, id, plantilla: 'romantica', tipo: 'novia', de: 'Gilberto', para: 'Ana' });
    expect(b.pasos[0].fotos[0]).toEqual({ id: foto.id, url: `http://api.test/api/v1/fotos/${foto.id}`, alt: 'Nuestra cita' });
    expect(b.celebracion.opciones).toHaveLength(2);
    expect(Date.parse(b.creadaEn)).toBeLessThan(Date.parse(b.expiraEn));
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
    const { id, claveAdmin } = await crearPropuesta({ pasos: [{ texto: 'a', fotos: [{ id: foto.id }] }] });
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

describe('mensajes de validación', () => {
  it('los mensajes genéricos de Zod salen en español', async () => {
    const r = await pedir('/propuestas', json({ v: 1 }));
    const e = (await r.json()) as { error: { detalles: { campo: string; mensaje: string }[] } };
    const plantilla = e.error.detalles.find((d) => d.campo === 'plantilla')!;
    expect(plantilla.mensaje).not.toMatch(/Invalid input/);
    expect(plantilla.mensaje).toMatch(/inválid|Se esperaba/i);
  });
});
