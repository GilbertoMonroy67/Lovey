import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { LIMITES } from '../../js/limites.js';
import { detectarTipo } from '../src/rutas/fotos';
import { CIFRADA, JPEG, PNG, WEBP, crearPropuesta, json, pedir, propuestaValida, subirFoto } from './ayuda';

describe('POST /fotos (cifradas)', () => {
  it('sube una foto cifrada → 201 con id, url y expiración de 24 h', async () => {
    const r = await subirFoto();
    expect(r.status).toBe(201);
    const b = (await r.json()) as { id: string; url: string; expiraEn: string };
    expect(b.id).toMatch(/^f_[A-Za-z0-9]{16}$/);
    expect(b.url).toBe(`https://api.test/api/v1/fotos/${b.id}`);
    const horas = (Date.parse(b.expiraEn) - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(23.9);
    const objeto = await env.FOTOS.head(`fotos/${b.id}`);
    expect(objeto?.httpMetadata?.contentType).toBe('application/octet-stream');
  });

  it('una imagen en claro (JPEG/WebP) se rechaza aunque se declare como octet-stream → 415', async () => {
    for (const imagen of [JPEG(), WEBP()]) {
      const r = await subirFoto(imagen, 'application/octet-stream');
      expect(r.status).toBe(415);
      expect(((await r.json()) as any).error.codigo).toBe('tipo_no_soportado');
    }
  });

  it('los tipos de imagen ya no se aceptan: la foto debe ir cifrada → 415', async () => {
    expect((await subirFoto(JPEG(), 'image/jpeg')).status).toBe(415);
    expect((await subirFoto(CIFRADA(), 'image/webp')).status).toBe(415);
    expect((await subirFoto(PNG(), 'image/png')).status).toBe(415);
  });

  it('sobre con versión desconocida o demasiado corto → 415', async () => {
    const otraVersion = CIFRADA();
    otraVersion[0] = 2;
    expect((await subirFoto(otraVersion)).status).toBe(415);
    expect((await subirFoto(CIFRADA(29))).status).toBe(415);
    expect((await subirFoto(new Uint8Array())).status).toBe(415);
  });

  it('más del máximo cifrado → 413; justo en el máximo se acepta', async () => {
    const r = await subirFoto(CIFRADA(LIMITES.fotoCifradaBytes + 1));
    expect(r.status).toBe(413);
    expect(((await r.json()) as any).error.codigo).toBe('archivo_muy_grande');
    expect((await subirFoto(CIFRADA(LIMITES.fotoCifradaBytes))).status).toBe(201);
  });

  it('detectarTipo reconoce los bytes mágicos', () => {
    expect(detectarTipo(JPEG())).toBe('image/jpeg');
    expect(detectarTipo(WEBP())).toBe('image/webp');
    expect(detectarTipo(PNG())).toBeNull();
    expect(detectarTipo(CIFRADA())).toBeNull();
    expect(detectarTipo(new TextEncoder().encode('RIFF1234WAVE'))).toBeNull();
  });
});

describe('GET /fotos/:id', () => {
  it('sirve los bytes cifrados como descarga opaca, sin poder incrustarse en otros sitios', async () => {
    const { id } = (await (await subirFoto()).json()) as { id: string };
    const r = await pedir(`/fotos/${id}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(r.headers.get('Content-Disposition')).toBe('attachment');
    expect(r.headers.get('Cache-Control')).toBe('private, max-age=86400');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(CIFRADA());
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
    await crearPropuesta({ fotos: [foto] });
    const r = await pedir('/propuestas', json(propuestaValida({ fotos: [foto] })));
    expect(r.status).toBe(422);
    expect(((await r.json()) as any).error.codigo).toBe('foto_invalida');
  });

  it('una foto huérfana expirada no puede asociarse', async () => {
    const { id: foto } = (await (await subirFoto()).json()) as { id: string };
    await env.DB.prepare('UPDATE fotos SET creada_en = ? WHERE id = ?').bind(Date.now() - 25 * 3_600_000, foto).run();
    const r = await pedir('/propuestas', json(propuestaValida({ fotos: [foto] })));
    expect(r.status).toBe(422);
  });

  it('la misma foto repetida en la propuesta → 422 validacion', async () => {
    const { id: foto } = (await (await subirFoto()).json()) as { id: string };
    const r = await pedir('/propuestas', json(propuestaValida({ fotos: [foto, foto] })));
    expect(r.status).toBe(422);
    expect(((await r.json()) as any).error.codigo).toBe('validacion');
  });
});
