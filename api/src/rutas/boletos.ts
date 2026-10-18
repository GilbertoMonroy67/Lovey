// POST /boletos (contrato v2.2, docs/arquitectura.md §15.1): entrega un boleto de subida tras Turnstile.
import { Hono } from 'hono';
import { emitirBoleto, llaveDelEntorno } from '../boleto';
import { hashIp, limitarIp } from '../limite-tasa';
import { configTurnstile, exigirHumano } from '../turnstile';
import type { AppEnv } from '../tipos';

export const rutasBoletos = new Hono<AppEnv>();

rutasBoletos.post('/', async (c) => {
  const ahora = Date.now();
  // Sin sal y con Turnstile activo: falla cerrada antes de gastar nada (500 `interno`).
  const llave = await llaveDelEntorno(c.env);
  // El cuerpo no se lee. Límite por IP (10/h, 20/día) antes de siteverify; sin tope global (no se guarda nada).
  await limitarIp(c.env.DB, 'boletos', await hashIp(c.req.raw, c.env.SAL_IP), ahora);
  await exigirHumano(c.req.raw, c.env.TURNSTILE_SECRETO, configTurnstile(c.env));
  return c.json(await emitirBoleto(llave, ahora), 201);
});
