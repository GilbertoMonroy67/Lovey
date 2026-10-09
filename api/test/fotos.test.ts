import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { detectarTipo } from '../src/rutas/fotos';
import { JPEG, PNG, WEBP, crearPropuesta, json, pedir, propuestaValida, subirFoto } from './ayuda';

describe('POST /fotos', () => {
  it('sube un WebP → 201 con id, url y expiración de 24 h', async () => {
    const r = await subirFoto(WEBP(), 'image/webp');
    expect(r.status).toBe(201);
    const b = (await r.json()) as { id: string; url: string; expiraEn: string };
    expect(b.id).toMatch(/^f_[A-Za-z0-9]{16}$/);
    expect(b.url).toBe(`http://api.test/api/v1/fotos/${b.id}`);
    const horas = (Date.parse(b.expiraEn) - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(23.9);
    expect(await env.FOTOS.head(`fotos/${b.id}`)).not.toBeNull();
  });

  it('sube un JPEG → 201', async () => {
    expect((await subirFoto(JPEG(), 'image/jpeg')).status).toBe(201);
  });

  it('PNG renombrado como WebP → 415', async () => {
    const r = await subirFoto(PNG(), 'image/webp');
    expect(r.status).toBe(415);
    expect(((await r.json()) as any).error.codigo).toBe('tipo_no_soportado');
  });

  it('Content-Type que no coincide con los bytes → 415', async () => {
    expect((await subirFoto(JPEG(), 'image/webp')).status).toBe(415);
  });

  it('Content-Type no permitido → 415', async () => {
    expect((await subirFoto(PNG(), 'image/png')).status).toBe(415);
  });

  it('cuerpo vacío → 415', async () => {
    expect((await subirFoto(new Uint8Array(), 'image/jpeg')).status).toBe(415);
  });

  it('más de 500 KB → 413', async () => {
    const grande = new Uint8Array(512001);
    grande.set(JPEG());
    const r = await subirFoto(grande, 'image/jpeg');
    expect(r.status).toBe(413);
    expect(((await r.json()) as any).error.codigo).toBe('archivo_muy_grande');
  });

  it('exactamente 500 KB se acepta', async () => {
    const justo = new Uint8Array(512000);
    justo.set(JPEG());
    expect((await subirFoto(justo, 'image/jpeg')).status).toBe(201);
  });

  it('detectarTipo reconoce los bytes mágicos', () => {
    expect(detectarTipo(JPEG())).toBe('image/jpeg');
    expect(detectarTipo(WEBP())).toBe('image/webp');
    expect(detectarTipo(PNG())).toBeNull();
    expect(detectarTipo(new TextEncoder().encode('RIFF1234WAVE'))).toBeNull();
  });
});

describe('GET /fotos/:id', () => {
  it('sirve la imagen con las cabeceras del contrato', async () => {
    const { id } = (await (await subirFoto(JPEG(), 'image/jpeg')).json()) as { id: string };
    const r = await pedir(`/fotos/${id}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('image/jpeg');
    expect(r.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(JPEG());
  });

  it('id inexistente o mal formado → 404', async () => {
    expect((await pedir('/fotos/f_AAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await pedir('/fotos/otra-cosa')).status).toBe(404);
  });

  it('foto huérfana de más de 24 h → 404', async () => {
    const { id } = (await (await subirFoto()).json()) as { id: string };
    await env.DB.prepare('UPDATE fotos SET creada_en = ? WHERE id = ?').bind(Date.now() - 25 * 3_600_000, id).run();
    expect((await pedir(`/fotos/${id}`)).status).toBe(404);
  });
});

describe('fotos asociadas a propuestas', () => {
  it('una foto ya usada no puede asociarse a otra propuesta', async () => {
    const { id: foto } = (await (await subirFoto()).json()) as { id: string };
    const pasos = [{ texto: 'a', fotos: [{ id: foto }] }];
    await crearPropuesta({ pasos });
    const r = await pedir('/propuestas', json(propuestaValida({ pasos })));
    expect(r.status).toBe(422);
    expect(((await r.json()) as any).error.codigo).toBe('foto_invalida');
  });

  it('una foto huérfana expirada no puede asociarse', async () => {
    const { id: foto } = (await (await subirFoto()).json()) as { id: string };
    await env.DB.prepare('UPDATE fotos SET creada_en = ? WHERE id = ?').bind(Date.now() - 25 * 3_600_000, foto).run();
    const r = await pedir('/propuestas', json(propuestaValida({ pasos: [{ texto: 'a', fotos: [{ id: foto }] }] })));
    expect(r.status).toBe(422);
  });

  it('la misma foto repetida en la propuesta → 422 validacion', async () => {
    const { id: foto } = (await (await subirFoto()).json()) as { id: string };
    const r = await pedir('/propuestas', json(propuestaValida({ pasos: [{ texto: 'a', fotos: [{ id: foto }, { id: foto }] }] })));
    expect(r.status).toBe(422);
    expect(((await r.json()) as any).error.codigo).toBe('validacion');
  });
});
