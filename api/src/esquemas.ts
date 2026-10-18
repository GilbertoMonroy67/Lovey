// Validación con Zod del modelo v1 (docs/arquitectura.md §3 y §4).
// Los límites vienen de la fuente única compartida con el frontend.
import { z } from 'zod';
import { es } from 'zod/locales';
import { LIMITES, PATRONES, TIPOS_EVENTO, VERSION_PROPUESTA } from '../../js/limites.js';
import { ErrorApi, type DetalleError } from './errores';

// Mensajes genéricos de Zod en español (los específicos se definen en cada regla).
z.config(es());

// Caracteres de control: se rechazan todos; en textos multilínea se permite \n (y \r\n se normaliza a \n).
const CONTROL = /[\u0000-\u001F\u007F]/;
const CONTROL_SALVO_SALTO = /[\u0000-\u0009\u000B-\u001F\u007F]/;

function texto(min: number, max: number, multilinea = false) {
  return z
    .string({ error: 'Debe ser texto.' })
    .transform((s) => (multilinea ? s.replace(/\r\n/g, '\n') : s).trim())
    .pipe(
      z
        .string()
        .min(min, min === 1 ? 'No puede estar vacío.' : `Debe tener al menos ${min} caracteres.`)
        .max(max, `Debe tener como máximo ${max} caracteres.`)
        .refine((s) => !(multilinea ? CONTROL_SALVO_SALTO : CONTROL).test(s), 'Contiene caracteres no permitidos.'),
    );
}

const idFoto = z.string().regex(PATRONES.idFoto, 'Id de foto inválido.');

/** Texto cifrado en base64url (el servidor no puede leerlo: solo valida su forma y su tamaño). */
const cifrado = (max: number) =>
  z
    .string({ error: 'Debe ser texto cifrado.' })
    .min(40, 'El contenido cifrado está incompleto.')
    .max(max, 'El contenido cifrado es demasiado grande.')
    .regex(PATRONES.cifrado, 'El contenido cifrado no es válido.');

/**
 * Sobre de la propuesta v2 (docs/arquitectura.md §3). El contenido (nombres, textos, pregunta,
 * celebración) llega cifrado de extremo a extremo; el servidor solo necesita las fotos para
 * asociarlas y borrarlas. `.strict()` rechaza cualquier campo extra (manipulación de campos).
 */
export const esquemaPropuesta = z
  .object({
    v: z.literal(VERSION_PROPUESTA, { error: `La versión debe ser ${VERSION_PROPUESTA}.` }),
    cifrado: cifrado(LIMITES.cifradoPropuesta),
    // v2.2: máximo 3 fotos al crear. Las v2 anteriores con más fotos se siguen leyendo: la lectura
    // (GET /propuestas/:id) no pasa por este esquema.
    fotos: z.array(idFoto).max(LIMITES.fotosTotales.max, `Máximo ${LIMITES.fotosTotales.max} fotos en total.`).default([]),
    avisos: z.object({ push: z.boolean().default(false) }).strict().optional().default({ push: false }),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (new Set(p.fotos).size !== p.fotos.length) {
      ctx.addIssue({ code: 'custom', path: ['fotos'], message: 'Una foto no puede repetirse.' });
    }
  });

export type Propuesta = z.output<typeof esquemaPropuesta>;
/** Lo que se guarda en `propuestas.datos` para una propuesta v2 (sin `avisos`). */
export type DatosPropuestaV2 = Omit<Propuesta, 'avisos'>;

/** Propuestas v1 (anteriores al cifrado): solo se leen hasta que expiren. */
export interface DatosPropuestaV1 {
  v: 1;
  plantilla: string;
  tipo: string;
  de: string;
  para: string;
  pasos: { texto: string; fotos: { id: string; alt: string }[] }[];
  pregunta: string;
  celebracion?: { titulo: string; opciones: { id: string; etiqueta: string; emoji?: string }[] };
  mensajeFinal: string;
}

export type DatosPropuesta = DatosPropuestaV1 | DatosPropuestaV2;

export const esCifrada = (d: DatosPropuesta): d is DatosPropuestaV2 => d.v === VERSION_PROPUESTA;

const sesion = z.string().regex(PATRONES.sesion, 'Sesión inválida.');
const [T_ABIERTO, T_INTENTO_NO, T_SI, T_CELEBRACION] = TIPOS_EVENTO as unknown as [
  'abierto',
  'intento_no',
  'si',
  'celebracion_elegida',
];

export const esquemaEvento = z.discriminatedUnion(
  'tipo',
  [
    z.object({ tipo: z.literal(T_ABIERTO), sesion }).strict(),
    z
      .object({
        tipo: z.literal(T_INTENTO_NO),
        sesion,
        conteo: z
          .number({ error: 'Debe ser un número.' })
          .int('Debe ser un entero.')
          .min(LIMITES.conteoIntentoNo.min)
          .max(LIMITES.conteoIntentoNo.max),
      })
      .strict(),
    z.object({ tipo: z.literal(T_SI), sesion }).strict(),
    // v2: la opción elegida y la nota llegan cifradas en `cifrado`. v1: `opcionId` y `nota` en claro.
    z
      .object({
        tipo: z.literal(T_CELEBRACION),
        sesion,
        cifrado: cifrado(LIMITES.cifradoEvento).optional(),
        opcionId: z.string().regex(PATRONES.idOpcion, 'Id de opción inválido.').optional(),
        nota: texto(0, LIMITES.nota.max, true).optional(),
      })
      .strict()
      .refine((e) => Boolean(e.cifrado) !== Boolean(e.opcionId), {
        message: 'Envía la elección cifrada o el id de la opción, no ambos.',
        path: ['cifrado'],
      }),
  ],
  { error: 'Tipo de evento inválido.' },
);

export type Evento = z.output<typeof esquemaEvento>;

/** Valida con Zod y traduce los errores a 422 `validacion` con `detalles`. */
export function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.output<T> {
  const r = esquema.safeParse(datos);
  if (r.success) return r.data;
  const detalles: DetalleError[] = r.error.issues.slice(0, 20).map((i) => ({
    campo: i.path.map(String).join('.') || '(raíz)',
    mensaje: i.message,
  }));
  throw new ErrorApi(422, 'validacion', undefined, detalles);
}

/** Lee el cuerpo como texto (sin importar el Content-Type), aplica el tope de bytes y lo parsea como JSON. */
export async function leerJson(req: Request): Promise<unknown> {
  const max = LIMITES.cuerpoJsonBytes;
  const declarado = Number(req.headers.get('Content-Length') ?? '0');
  if (declarado > max) throw new ErrorApi(413, 'archivo_muy_grande', 'Los datos son demasiado grandes (máximo 32 KB).');
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > max) throw new ErrorApi(413, 'archivo_muy_grande', 'Los datos son demasiado grandes (máximo 32 KB).');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new ErrorApi(400, 'json_invalido');
  }
}
