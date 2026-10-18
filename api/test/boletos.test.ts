// Contrato v2.2 (docs/arquitectura.md §15): boleto de subida, 3 fotos por propuesta y 3 por IP al día.
// Cierra H4 de la auditoría de cyberbot. Los números siguen la lista de §15.9 "Backend".
// siteverify siempre está simulado: ningún test sale a internet.
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITES } from '../../js/limites.js';
import { consumirBoleto, emitirBoleto, firmarBoleto, llaveBoleto, verificarBoleto } from '../src/boleto';
import { ErrorApi } from '../src/errores';
import { sha256Hex } from '../src/ids';
import { limitarIp, REGLAS_IP_DIARIAS, sumarSiCabe, TOPES_GLOBALES } from '../src/limite-tasa';
import { limpiar } from '../src/limpieza';
import { CIFRADA, CIFRADO, JPEG, json, nuevaIp, obtenerBoleto, pedir, pedirCon, propuestaValida, subirFoto } from './ayuda';

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const FORMA = /^b1\.[A-Za-z0-9_-]{40,120}\.[A-Za-z0-9_-]{43}$/;
const TURNSTILE = { TURNSTILE_SECRETO: 'secreto-de-pruebas' };

async function capturar(p: Promise<unknown>): Promise<ErrorApi | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as ErrorApi;
  }
}

const codigo = async (r: Response) => ((await r.json()) as { error: { codigo: string } }).error.codigo;

/** Simula siteverify (y cualquier otro fetch saliente) y cuenta las llamadas. El host es el de ORIGENES_PERMITIDOS de los tests. */
function simularSiteverify(exito = true, hostname = 'ejemplo.github.io') {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify({ success: exito, hostname }), { status: 200 }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Todas las filas de `limites`, para comprobar que una solicitud rechazada no escribió nada. */
async function fotoLimites(): Promise<string> {
  const { results } = await env.DB.prepare('SELECT clave, conteo FROM limites ORDER BY clave').all();
  return JSON.stringify(results);
}

const conteoDe = async (clave: string) =>
  (await env.DB.prepare('SELECT conteo FROM limites WHERE clave = ?').bind(clave).first<{ conteo: number }>())?.conteo ?? null;

const nonceDe = (boleto: string) => JSON.parse(atob(boleto.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).n as string;

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Cambia un carácter del texto en la posición `i` por otro del alfabeto base64url. */
const cambiar = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);

describe('1–2. POST /boletos', () => {
  it('1. sin Turnstile → 201 con el boleto, expiraEn ≈ ahora + 60 min y fotos = 3', async () => {
    const r = await pedir('/boletos', { method: 'POST', body: 'el cuerpo se ignora' });
    expect(r.status).toBe(201);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const b = (await r.json()) as { boleto: string; expiraEn: string; fotos: number };
    expect(Object.keys(b).sort()).toEqual(['boleto', 'expiraEn', 'fotos']);
    expect(b.boleto).toMatch(FORMA);
    expect(b.boleto.length).toBeLessThanOrEqual(200);
    expect(b.fotos).toBe(3);
    const minutos = (Date.parse(b.expiraEn) - Date.now()) / MIN;
    expect(minutos).toBeGreaterThan(59);
    expect(minutos).toBeLessThanOrEqual(60);
    // El contenido es el JSON compacto de §15.1, con las claves en ese orden.
    const p = atob(b.boleto.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    expect(p).toMatch(/^\{"v":1,"n":"[A-Za-z0-9]{16}","exp":\d+,"f":3\}$/);
  });

  it('2. con Turnstile y sin token → 403 verificacion_bot (sin llamar a siteverify)', async () => {
    const espia = simularSiteverify(true);
    const r = await pedirCon(TURNSTILE, '/boletos', { method: 'POST' });
    expect(r.status).toBe(403);
    expect(await codigo(r)).toBe('verificacion_bot');
    expect(espia).not.toHaveBeenCalled();
  });

  it('2. con Turnstile y siteverify (simulado) en éxito → 201, y el boleto sirve para subir', async () => {
    const espia = simularSiteverify(true);
    const ip = nuevaIp();
    const r = await pedirCon(TURNSTILE, '/boletos', { method: 'POST', ip, headers: { 'X-Turnstile-Token': 'token-bueno' } });
    expect(r.status).toBe(201);
    expect(espia).toHaveBeenCalledTimes(1);
    const { boleto } = (await r.json()) as { boleto: string };
    expect((await pedirCon(TURNSTILE, '/fotos', { method: 'POST', ip, headers: { 'Content-Type': 'application/octet-stream', 'X-Boleto': boleto }, body: CIFRADA() })).status).toBe(201);
    // Un token rechazado → 403.
    espia.mockImplementation(async () => new Response('{"success":false}'));
    const malo = await pedirCon(TURNSTILE, '/boletos', { method: 'POST', headers: { 'X-Turnstile-Token': 'token-malo' } });
    expect(malo.status).toBe(403);
  });

  it('2. la solicitud 11 de la hora → 429 sin llamar a siteverify (y el contador no pasa de 10)', async () => {
    const espia = simularSiteverify(true);
    const ip = nuevaIp();
    const pedirBoleto = () => pedirCon(TURNSTILE, '/boletos', { method: 'POST', ip, headers: { 'X-Turnstile-Token': 't' } });
    for (let i = 0; i < 10; i++) expect((await pedirBoleto()).status).toBe(201);
    expect(espia).toHaveBeenCalledTimes(10);
    const r = await pedirBoleto();
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(espia).toHaveBeenCalledTimes(10);
    const hash = await sha256Hex(`${env.SAL_IP}${ip}`);
    expect(await conteoDe(`boletos:${hash}:${Math.floor(Date.now() / HORA)}`)).toBe(10);
  });

  it('2. límite diario de boletos: 20 por IP; el 21 → 429', async () => {
    const t0 = Date.UTC(2032, 2, 3, 1, 0, 0);
    for (let i = 0; i < 10; i++) await limitarIp(env.DB, 'boletos', 'ipBoletos', t0);
    for (let i = 0; i < 10; i++) await limitarIp(env.DB, 'boletos', 'ipBoletos', t0 + HORA);
    const e = await capturar(limitarIp(env.DB, 'boletos', 'ipBoletos', t0 + 2 * HORA));
    expect(e?.estado).toBe(429);
    expect(e?.reintentarEn).toBe(21 * 3600);
  });

  it('2. con Turnstile y sin SAL_IP → 500 interno (falla cerrada, sin llamar a siteverify)', async () => {
    const espia = simularSiteverify(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await pedirCon({ ...TURNSTILE, SAL_IP: '' }, '/boletos', { method: 'POST', headers: { 'X-Turnstile-Token': 't' } });
    expect(r.status).toBe(500);
    expect(await codigo(r)).toBe('interno');
    expect(error).toHaveBeenCalledWith('boleto_sin_sal');
    expect(espia).not.toHaveBeenCalled();
    // Tampoco se aceptan boletos en /fotos: firmados con la sal vacía serían falsificables.
    const falso = (await emitirBoleto(await llaveBoleto(''))).boleto;
    const f = await pedirCon({ ...TURNSTILE, SAL_IP: '' }, '/fotos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Boleto': falso },
      body: CIFRADA(),
    });
    expect(f.status).toBe(500);
  });

  it('sin Turnstile y sin SAL_IP (desarrollo) se emite con la sal vacía y solo avisa', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await pedirCon({ SAL_IP: '' }, '/boletos', { method: 'POST' });
    expect(r.status).toBe(201);
  });
});

describe('3. verificarBoleto (unitario)', () => {
  it('un boleto recién emitido es válido y devuelve su contenido', async () => {
    const llave = await llaveBoleto('sal-a');
    const t0 = Date.UTC(2032, 0, 1, 12, 0, 0, 500);
    const { boleto, expiraEn, fotos } = await emitirBoleto(llave, t0);
    const b = await verificarBoleto(boleto, llave, t0);
    expect(b).toEqual({ v: 1, n: expect.stringMatching(/^[A-Za-z0-9]{16}$/), exp: Math.floor(t0 / 1000) + 3600, f: 3 });
    expect(expiraEn).toBe(new Date(b.exp * 1000).toISOString());
    expect(fotos).toBe(LIMITES.fotosPorBoleto);
    // La llave se cachea por isolate con la sal como clave.
    expect(llaveBoleto('sal-a')).toBe(llaveBoleto('sal-a'));
    expect(llaveBoleto('sal-b')).not.toBe(llaveBoleto('sal-a'));
  });

  it('alterados, otro prefijo, demasiado largos, otra sal o f = 4 → boleto_invalido', async () => {
    const llave = await llaveBoleto('sal-a');
    const t0 = Date.now();
    const { boleto } = await emitirBoleto(llave, t0);
    const [, p, f] = boleto.split('.') as [string, string, string];
    const contenido = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    const otroExp = btoa(JSON.stringify({ ...contenido, exp: contenido.exp + 3600 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const malos: [string, string][] = [
      ['P alterado (otro exp)', `b1.${otroExp}.${f}`],
      ['P con un carácter cambiado', `b1.${cambiar(p, 5)}.${f}`],
      ['F alterado', `b1.${p}.${cambiar(f, 0)}`],
      // El último carácter de F lleva 2 bits de relleno: una variante no canónica también se rechaza.
      ['F no canónico', `b1.${p}.${f.slice(0, -1)}${ALFABETO[ALFABETO.indexOf(f.at(-1)!) + 1]}`],
      ['prefijo b2.', `b2.${p}.${f}`],
      ['más de 200 caracteres', `b1.${p}${'A'.repeat(200)}.${f}`],
      ['sin firma', `b1.${p}`],
      ['vacío', ''],
      ['firmado con otra SAL_IP', (await emitirBoleto(await llaveBoleto('otra-sal'), t0)).boleto],
      ['f = 4 bien firmado', await firmarBoleto(llave, { v: 1, n: 'A'.repeat(16), exp: contenido.exp, f: 4 })],
      ['f = 0 bien firmado', await firmarBoleto(llave, { v: 1, n: 'A'.repeat(16), exp: contenido.exp, f: 0 })],
      ['v = 2 bien firmado', await firmarBoleto(llave, { v: 2, n: 'A'.repeat(16), exp: contenido.exp, f: 3 })],
      ['nonce corto bien firmado', await firmarBoleto(llave, { v: 1, n: 'A'.repeat(15), exp: contenido.exp, f: 3 })],
      ['exp no entero bien firmado', await firmarBoleto(llave, { v: 1, n: 'A'.repeat(16), exp: contenido.exp + 0.5, f: 3 })],
    ];
    for (const [nombre, texto] of malos) {
      const e = await capturar(verificarBoleto(texto, llave, t0));
      expect(e?.codigo, nombre).toBe('boleto_invalido');
      expect(e?.estado, nombre).toBe(401);
    }
  });

  it('vencido (reloj simulado) → boleto_vencido; un segundo antes, válido', async () => {
    const llave = await llaveBoleto('sal-a');
    const t0 = Date.UTC(2032, 0, 1, 12, 0, 0);
    const { boleto } = await emitirBoleto(llave, t0);
    expect(await capturar(verificarBoleto(boleto, llave, t0 + 60 * MIN - 1000))).toBeNull();
    const e = await capturar(verificarBoleto(boleto, llave, t0 + 60 * MIN));
    expect(e?.estado).toBe(401);
    expect(e?.codigo).toBe('boleto_vencido');
  });

  it('la llave también se deriva de una sal vacía (desarrollo)', async () => {
    const llave = await llaveBoleto('');
    const { boleto } = await emitirBoleto(llave);
    expect((await verificarBoleto(boleto, llave)).f).toBe(3);
  });
});

describe('4–8. POST /fotos con boleto', () => {
  it('4. sin X-Boleto → 401 boleto_ausente; lo rechazado en los pasos 1–2 no toca `limites`', async () => {
    const ip = nuevaIp();
    const boleto = await obtenerBoleto(ip);
    const vencido = (await emitirBoleto(await llaveBoleto(env.SAL_IP), Date.now() - 2 * HORA)).boleto;
    const antes = await fotoLimites();

    const sinBoleto = await subirFoto(CIFRADA(), 'application/octet-stream', { boleto: null, ip });
    expect(sinBoleto.status).toBe(401);
    expect(await codigo(sinBoleto)).toBe('boleto_ausente');

    const casos: [string | null, Uint8Array, string, number, string][] = [
      ['b1.basura', CIFRADA(), 'application/octet-stream', 401, 'boleto_invalido'],
      [vencido, CIFRADA(), 'application/octet-stream', 401, 'boleto_vencido'],
      [boleto, CIFRADA(), 'image/png', 415, 'tipo_no_soportado'],
      [boleto, JPEG(), 'application/octet-stream', 415, 'tipo_no_soportado'],
      [boleto, CIFRADA(LIMITES.fotoCifradaBytes + 1), 'application/octet-stream', 413, 'archivo_muy_grande'],
    ];
    for (const [b, bytes, tipo, estado, cod] of casos) {
      const r = await subirFoto(bytes, tipo, { boleto: b, ip });
      expect(r.status).toBe(estado);
      expect(await codigo(r)).toBe(cod);
    }
    expect(await fotoLimites()).toBe(antes);
    // El boleto sigue entero: sus 3 fotos pasan.
    for (let i = 0; i < 3; i++) expect((await subirFoto(CIFRADA(), undefined, { boleto, ip })).status).toBe(201);
  });

  it('5. un boleto vale 3 fotos; la 4.ª con el mismo boleto desde otra IP → 403 boleto_agotado', async () => {
    const boleto = await obtenerBoleto();
    for (let i = 0; i < 3; i++) expect((await subirFoto(CIFRADA(), undefined, { boleto, ip: nuevaIp() })).status).toBe(201);
    const r = await subirFoto(CIFRADA(), undefined, { boleto, ip: nuevaIp() });
    expect(r.status).toBe(403);
    expect(await codigo(r)).toBe('boleto_agotado');
  });

  it('6. una IP sube 3 fotos al día: la 4.ª con un boleto nuevo → 429; ese boleto desde otra IP → 201', async () => {
    const ip = nuevaIp();
    const a = await obtenerBoleto(ip);
    for (let i = 0; i < 3; i++) expect((await subirFoto(CIFRADA(), undefined, { boleto: a, ip })).status).toBe(201);
    const b = await obtenerBoleto(ip);
    const r = await subirFoto(CIFRADA(), undefined, { boleto: b, ip });
    expect(r.status).toBe(429);
    expect(await codigo(r)).toBe('demasiadas_solicitudes');
    const segundos = Number(r.headers.get('Retry-After'));
    expect(segundos).toBeGreaterThan(0);
    expect(segundos).toBeLessThanOrEqual(86_400); // hasta las 00:00 UTC
    expect((await subirFoto(CIFRADA(), undefined, { boleto: b, ip: nuevaIp() })).status).toBe(201);
  });

  it('7. contador condicional: en el máximo no escribe (rows_written = 0) ni supera el máximo', async () => {
    const clave = `prueba:condicional:${nuevaIp()}`;
    expect(await sumarSiCabe(env.DB, clave, Date.now() + HORA, 2)).toMatchObject({ conteo: 1 });
    expect(await sumarSiCabe(env.DB, clave, Date.now() + HORA, 2)).toMatchObject({ conteo: 2 });
    for (let i = 0; i < 3; i++) {
      expect(await sumarSiCabe(env.DB, clave, Date.now() + HORA, 2)).toEqual({ conteo: null, escritas: 0 });
    }
    expect(await conteoDe(clave)).toBe(2);
  });

  it('7. HTTP: con el contador en su máximo, 429 / 403 dejan el conteo igual', async () => {
    // Cupo diario de la IP en 3 → 429 y sigue en 3.
    const ip = nuevaIp();
    const hash = await sha256Hex(`${env.SAL_IP}${ip}`);
    const claveDia = `fotos:dia:${hash}:${Math.floor(Date.now() / DIA)}`;
    await env.DB.prepare('INSERT INTO limites (clave, conteo, expira_en) VALUES (?, 3, ?)').bind(claveDia, Date.now() + DIA).run();
    for (let i = 0; i < 2; i++) expect((await subirFoto(CIFRADA(), undefined, { ip })).status).toBe(429);
    expect(await conteoDe(claveDia)).toBe(3);

    // Boleto con sus 3 usos gastados → 403 y sigue en 3.
    const boleto = await obtenerBoleto();
    const claveBoleto = `boleto:${nonceDe(boleto)}`;
    for (let i = 0; i < 3; i++) expect((await subirFoto(CIFRADA(), undefined, { boleto })).status).toBe(201);
    for (let i = 0; i < 2; i++) expect((await subirFoto(CIFRADA(), undefined, { boleto })).status).toBe(403);
    expect(await conteoDe(claveBoleto)).toBe(3);
    // El contador del boleto vence con el boleto.
    const fila = await env.DB.prepare('SELECT expira_en FROM limites WHERE clave = ?').bind(claveBoleto).first<{ expira_en: number }>();
    const { exp } = JSON.parse(atob(boleto.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    expect(fila!.expira_en).toBe(exp * 1000);
  });

  it('8. el tope global de 500 fotos sigue funcionando → 503 capacidad_agotada, sin pasar de 500', async () => {
    const ahora = Date.now();
    const claveGlobal = `fotos:global:${Math.floor(ahora / DIA)}`;
    const tope = TOPES_GLOBALES.fotos!.maximo;
    expect(tope).toBe(500);
    await env.DB.prepare('INSERT OR REPLACE INTO limites (clave, conteo, expira_en) VALUES (?, ?, ?)')
      .bind(claveGlobal, tope, ahora + DIA)
      .run();
    const r = await subirFoto();
    // Si el test cruza la medianoche UTC justo aquí, el contador del día nuevo empieza en 1 → 201.
    expect([503, 201]).toContain(r.status);
    if (r.status === 503) {
      expect(await codigo(r)).toBe('capacidad_agotada');
      expect(await conteoDe(claveGlobal)).toBe(tope);
    }
    await env.DB.prepare("DELETE FROM limites WHERE clave LIKE 'fotos:global:%'").run();
  });
});

describe('9. POST /propuestas con boleto', () => {
  const crearCon = (extra: Record<string, string>, boleto: string | null, cuerpo = propuestaValida()) =>
    pedirCon(extra, '/propuestas', json(cuerpo, { headers: boleto ? { 'X-Boleto': boleto } : {} }));

  it('con Turnstile: boleto válido sin token → 201 (sin siteverify); la 2.ª con el mismo boleto → 403 boleto_agotado', async () => {
    const espia = simularSiteverify(true);
    const boleto = await obtenerBoleto();
    expect((await crearCon(TURNSTILE, boleto)).status).toBe(201);
    const r = await crearCon(TURNSTILE, boleto);
    expect(r.status).toBe(403);
    expect(await codigo(r)).toBe('boleto_agotado');
    expect(espia).not.toHaveBeenCalled();
  });

  it('el cupo de propuesta es aparte: un boleto que ya subió 3 fotos crea la propuesta con ellas', async () => {
    const boleto = await obtenerBoleto();
    const fotos: string[] = [];
    for (let i = 0; i < 3; i++) fotos.push(((await (await subirFoto(CIFRADA(), undefined, { boleto })).json()) as { id: string }).id);
    expect((await crearCon(TURNSTILE, boleto, propuestaValida({ fotos }))).status).toBe(201);
  });

  it('con Turnstile: boleto vencido o inválido → 401; sin boleto ni token → 403 verificacion_bot', async () => {
    simularSiteverify(true);
    const vencido = (await emitirBoleto(await llaveBoleto(env.SAL_IP), Date.now() - 61 * MIN)).boleto;
    const r1 = await crearCon(TURNSTILE, vencido);
    expect(r1.status).toBe(401);
    expect(await codigo(r1)).toBe('boleto_vencido');
    const r2 = await crearCon(TURNSTILE, 'b1.basura');
    expect(r2.status).toBe(401);
    expect(await codigo(r2)).toBe('boleto_invalido');
    const r3 = await crearCon(TURNSTILE, null);
    expect(r3.status).toBe(403);
    expect(await codigo(r3)).toBe('verificacion_bot');
  });

  it('con Turnstile y sin boleto, un token válido sigue funcionando (frontend viejo en caché)', async () => {
    const espia = simularSiteverify(true);
    const r = await pedirCon(TURNSTILE, '/propuestas', json(propuestaValida(), { headers: { 'X-Turnstile-Token': 'tok' } }));
    expect(r.status).toBe(201);
    expect(espia).toHaveBeenCalledTimes(1);
  });

  it('un 422 con boleto no consume `boleto-prop`: después, una propuesta válida con el mismo boleto → 201', async () => {
    const boleto = await obtenerBoleto();
    const r = await crearCon(TURNSTILE, boleto, propuestaValida({ fotos: ['f_AAAAAAAAAAAAAAAA'] }));
    expect(r.status).toBe(422);
    expect(await codigo(r)).toBe('foto_invalida');
    expect((await crearCon(TURNSTILE, boleto, propuestaValida({ fotos: ['x'] }))).status).toBe(422);
    expect(await conteoDe(`boleto-prop:${nonceDe(boleto)}`)).toBeNull();
    expect((await crearCon(TURNSTILE, boleto)).status).toBe(201);
    expect(await conteoDe(`boleto-prop:${nonceDe(boleto)}`)).toBe(1);
  });

  it('sin Turnstile, X-Boleto se ignora: basura → 201 y un boleto real no se consume', async () => {
    expect((await crearCon({}, 'b1.basura')).status).toBe(201);
    const boleto = await obtenerBoleto();
    expect((await crearCon({}, boleto)).status).toBe(201);
    expect((await crearCon({}, boleto)).status).toBe(201);
    expect(await conteoDe(`boleto-prop:${nonceDe(boleto)}`)).toBeNull();
  });
});

describe('10. 3 fotos por propuesta al crear; la lectura no cambia', () => {
  it('4 fotos → 422 validacion (campo fotos); 3 → 201', async () => {
    const ids = Array.from({ length: 4 }, (_, i) => `f_BBBBBBBBBBBBBB${String(i).padStart(2, '0')}`);
    const r = await pedir('/propuestas', json(propuestaValida({ fotos: ids })));
    expect(r.status).toBe(422);
    const e = ((await r.json()) as { error: { codigo: string; detalles: { campo: string }[] } }).error;
    expect(e.codigo).toBe('validacion');
    expect(e.detalles.map((d) => d.campo)).toContain('fotos');

    const boleto = await obtenerBoleto();
    const fotos: string[] = [];
    for (let i = 0; i < 3; i++) fotos.push(((await (await subirFoto(CIFRADA(), undefined, { boleto })).json()) as { id: string }).id);
    expect((await pedir('/propuestas', json(propuestaValida({ fotos })))).status).toBe(201);
  });

  it('una propuesta v2 anterior con 10 fotos (insertada en D1) se sigue leyendo completa', async () => {
    const id = `V2${String(Date.now()).slice(-10)}`;
    const fotos = Array.from({ length: 10 }, (_, i) => `f_CCCCCCCCCCCCCC${String(i).padStart(2, '0')}`);
    const ahora = Date.now();
    await env.DB.prepare(
      'INSERT INTO propuestas (id, clave_hash, datos, ntfy_tema, usuario_id, creada_en, expira_en) VALUES (?, ?, ?, NULL, NULL, ?, ?)',
    )
      .bind(id, await sha256Hex('x'), JSON.stringify({ v: 2, cifrado: CIFRADO(), fotos }), ahora, ahora + DIA)
      .run();
    const r = await pedir(`/propuestas/${id}`);
    expect(r.status).toBe(200);
    const b = (await r.json()) as { fotos: { id: string }[] };
    expect(b.fotos.map((f) => f.id)).toEqual(fotos);
  });
});

describe('12. limpieza de boletos', () => {
  it('limpiar() borra los `boleto:*` y `boleto-prop:*` vencidos y deja los vigentes', async () => {
    const llave = await llaveBoleto(env.SAL_IP);
    const antes = Date.now() - 2 * HORA;
    const viejo = await verificarBoleto((await emitirBoleto(llave, antes)).boleto, llave, antes);
    const vigente = await verificarBoleto((await emitirBoleto(llave)).boleto, llave);
    for (const b of [viejo, vigente]) {
      await consumirBoleto(env.DB, 'boleto', b);
      await consumirBoleto(env.DB, 'boleto-prop', b);
    }
    // El cupo de propuesta es de 1.
    expect((await capturar(consumirBoleto(env.DB, 'boleto-prop', vigente)))?.codigo).toBe('boleto_agotado');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    await limpiar(env);
    expect(await conteoDe(`boleto:${viejo.n}`)).toBeNull();
    expect(await conteoDe(`boleto-prop:${viejo.n}`)).toBeNull();
    expect(await conteoDe(`boleto:${vigente.n}`)).toBe(1);
    expect(await conteoDe(`boleto-prop:${vigente.n}`)).toBe(1);
  });
});

describe('H6 (revisión v2.2): con el cupo diario por IP lleno no se escribe en D1', () => {
  /** Llena el contador diario de la acción para la IP, directo en D1, y devuelve el Retry-After esperado. */
  async function llenarCupoDiario(accion: 'boletos' | 'propuestas', ip: string, maximo: number) {
    const ahora = Date.now();
    const dia = Math.floor(ahora / DIA);
    const hash = await sha256Hex(`${env.SAL_IP}${ip}`);
    await env.DB.prepare('INSERT INTO limites (clave, conteo, expira_en) VALUES (?1, ?2, ?3)')
      .bind(`${accion}:dia:${hash}:${dia}`, maximo, (dia + 1) * DIA)
      .run();
    return Math.ceil(((dia + 1) * DIA - ahora) / 1000);
  }

  for (const accion of ['boletos', 'propuestas'] as const) {
    it(`${accion}: N solicitudes más → 429 con Retry-After hasta las 00:00 UTC y la tabla limites no cambia`, async () => {
      const ip = nuevaIp();
      const esperado = await llenarCupoDiario(accion, ip, REGLAS_IP_DIARIAS[accion]!.maximo);
      const antes = await fotoLimites();
      const espia = simularSiteverify(true);
      for (let i = 0; i < 15; i++) {
        const r =
          accion === 'boletos'
            ? await pedirCon(TURNSTILE, '/boletos', { method: 'POST', ip, headers: { 'X-Turnstile-Token': 't' } })
            : await pedirCon(TURNSTILE, '/propuestas', json(propuestaValida(), { ip, headers: { 'X-Turnstile-Token': 't' } }));
        expect(r.status).toBe(429);
        expect(await codigo(r)).toBe('demasiadas_solicitudes');
        const retry = Number(r.headers.get('Retry-After'));
        expect(Math.abs(retry - esperado)).toBeLessThanOrEqual(5);
      }
      expect(espia).not.toHaveBeenCalled();
      // Ni el contador horario ni el diario se tocaron: 0 escrituras en `limites`.
      expect(await fotoLimites()).toBe(antes);
    });
  }

  it('el SELECT previo no escribe (rows_written 0) y con cupo libre todo sigue igual', async () => {
    const t0 = Date.UTC(2032, 4, 5, 10, 0, 0);
    for (let i = 0; i < 10; i++) await limitarIp(env.DB, 'propuestas', 'ipH6', t0);
    for (let i = 0; i < 10; i++) await limitarIp(env.DB, 'propuestas', 'ipH6', t0 + HORA);
    const antes = await fotoLimites();
    const lectura = await env.DB.prepare('SELECT conteo FROM limites WHERE clave = ?1')
      .bind(`propuestas:dia:ipH6:${Math.floor(t0 / DIA)}`)
      .run();
    expect(lectura.meta.rows_written ?? 0).toBe(0);
    const e = await capturar(limitarIp(env.DB, 'propuestas', 'ipH6', t0 + 2 * HORA));
    expect(e?.estado).toBe(429);
    expect(e?.reintentarEn).toBe(12 * 3600);
    // La regla horaria de la tercera hora ni siquiera se creó.
    expect(await conteoDe(`propuestas:ipH6:${Math.floor((t0 + 2 * HORA) / HORA)}`)).toBeNull();
    expect(await fotoLimites()).toBe(antes);
  });
});

describe('H8 (revisión v2.2): hostname de siteverify', () => {
  it('hostname de ORIGENES_PERMITIDOS → 201; hostname ajeno → 403 verificacion_bot', async () => {
    simularSiteverify(true, 'ejemplo.github.io');
    expect((await pedirCon(TURNSTILE, '/boletos', { method: 'POST', headers: { 'X-Turnstile-Token': 't' } })).status).toBe(201);
    expect((await pedirCon(TURNSTILE, '/propuestas', json(propuestaValida(), { headers: { 'X-Turnstile-Token': 't' } }))).status).toBe(201);
    vi.restoreAllMocks();
    simularSiteverify(true, 'sitio-ajeno.example');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const r of [
      await pedirCon(TURNSTILE, '/boletos', { method: 'POST', headers: { 'X-Turnstile-Token': 't' } }),
      await pedirCon(TURNSTILE, '/propuestas', json(propuestaValida(), { headers: { 'X-Turnstile-Token': 't' } })),
    ]) {
      expect(r.status).toBe(403);
      expect(await codigo(r)).toBe('verificacion_bot');
    }
  });

  it('localhost se acepta con PERMITIR_LOCALHOST="1" y se rechaza sin la variable', async () => {
    simularSiteverify(true, 'localhost');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const conLocal = await pedirCon({ ...TURNSTILE, PERMITIR_LOCALHOST: '1' }, '/boletos', { method: 'POST', headers: { 'X-Turnstile-Token': 't' } });
    expect(conLocal.status).toBe(201);
    const sinLocal = await pedirCon(TURNSTILE, '/boletos', { method: 'POST', headers: { 'X-Turnstile-Token': 't' } });
    expect(sinLocal.status).toBe(403);
    expect(await codigo(sinLocal)).toBe('verificacion_bot');
  });

  it('con el secreto de prueba de Cloudflare se acepta "example.com"; con otro secreto, no', async () => {
    simularSiteverify(true, 'example.com');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prueba = { TURNSTILE_SECRETO: '1x0000000000000000000000000000000AA' };
    expect((await pedirCon(prueba, '/boletos', { method: 'POST', headers: { 'X-Turnstile-Token': 'XXXX.DUMMY.TOKEN.XXXX' } })).status).toBe(201);
    expect((await pedirCon(TURNSTILE, '/boletos', { method: 'POST', headers: { 'X-Turnstile-Token': 't' } })).status).toBe(403);
  });
});
