// Validación con Zod del modelo v1 (docs/arquitectura.md §3 y §4).
// Los límites vienen de la fuente única compartida con el frontend.
import { z } from 'zod';
import { es } from 'zod/locales';
import { LIMITES, PATRONES, TIPOS, TIPOS_EVENTO, VERSION_PROPUESTA } from '../../js/limites.js';
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

const foto = z.object({
  id: z.string().regex(PATRONES.idFoto, 'Id de foto inválido.'),
  alt: texto(0, LIMITES.altFoto.max).optional().default(''),
});

const paso = z.object({
  texto: texto(LIMITES.textoPaso.min, LIMITES.textoPaso.max, true),
  fotos: z.array(foto).max(LIMITES.fotosPorPaso.max, `Máximo ${LIMITES.fotosPorPaso.max} fotos por paso.`).default([]),
});

const opcion = z.object({
  id: z.string().regex(PATRONES.idOpcion, 'Id de opción inválido.'),
  etiqueta: texto(LIMITES.etiquetaOpcion.min, LIMITES.etiquetaOpcion.max),
  emoji: texto(0, LIMITES.emojiOpcion.max).optional(),
});

const celebracion = z.object({
  titulo: texto(LIMITES.tituloCelebracion.min, LIMITES.tituloCelebracion.max),
  opciones: z
    .array(opcion)
    .max(LIMITES.opcionesCelebracion.max, `Máximo ${LIMITES.opcionesCelebracion.max} opciones.`)
    .default([]),
});

export const esquemaPropuesta = z
  .object({
    v: z.literal(VERSION_PROPUESTA, { error: `La versión debe ser ${VERSION_PROPUESTA}.` }),
    plantilla: z.string().regex(PATRONES.idPlantilla, 'Id de plantilla inválido.'),
    tipo: z.enum(TIPOS as unknown as [string, ...string[]], { error: 'Tipo de pregunta inválido.' }),
    de: texto(LIMITES.nombre.min, LIMITES.nombre.max),
    para: texto(LIMITES.nombre.min, LIMITES.nombre.max),
    pasos: z
      .array(paso)
      .min(LIMITES.pasos.min, `Debe haber al menos ${LIMITES.pasos.min} paso.`)
      .max(LIMITES.pasos.max, `Máximo ${LIMITES.pasos.max} pasos.`),
    pregunta: texto(LIMITES.pregunta.min, LIMITES.pregunta.max),
    celebracion: celebracion.optional(),
    mensajeFinal: texto(0, LIMITES.mensajeFinal.max, true).optional().default(''),
    avisos: z.object({ push: z.boolean().default(false) }).optional().default({ push: false }),
  })
  .superRefine((p, ctx) => {
    const ids = p.pasos.flatMap((s) => s.fotos.map((f) => f.id));
    if (ids.length > LIMITES.fotosTotales.max) {
      ctx.addIssue({ code: 'custom', path: ['pasos'], message: `Máximo ${LIMITES.fotosTotales.max} fotos en total.` });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['pasos'], message: 'Una foto no puede repetirse.' });
    }
    const opciones = p.celebracion?.opciones ?? [];
    const vistos = new Set<string>();
    opciones.forEach((o, i) => {
      if (vistos.has(o.id)) {
        ctx.addIssue({ code: 'custom', path: ['celebracion', 'opciones', i, 'id'], message: 'Id de opción repetido.' });
      }
      vistos.add(o.id);
    });
  });

export type Propuesta = z.output<typeof esquemaPropuesta>;
/** Lo que se guarda en `propuestas.datos` (§3.1 sin `avisos`). */
export type DatosPropuesta = Omit<Propuesta, 'avisos'>;

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
    z.object({ tipo: z.literal(T_ABIERTO), sesion }),
    z.object({
      tipo: z.literal(T_INTENTO_NO),
      sesion,
      conteo: z
        .number({ error: 'Debe ser un número.' })
        .int('Debe ser un entero.')
        .min(LIMITES.conteoIntentoNo.min)
        .max(LIMITES.conteoIntentoNo.max),
    }),
    z.object({ tipo: z.literal(T_SI), sesion }),
    z.object({
      tipo: z.literal(T_CELEBRACION),
      sesion,
      opcionId: z.string().regex(PATRONES.idOpcion, 'Id de opción inválido.'),
      nota: texto(0, LIMITES.nota.max, true).optional(),
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
  if (declarado > max) throw new ErrorApi(413, 'archivo_muy_grande', 'Los datos son demasiado grandes (máximo 16 KB).');
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > max) throw new ErrorApi(413, 'archivo_muy_grande', 'Los datos son demasiado grandes (máximo 16 KB).');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new ErrorApi(400, 'json_invalido');
  }
}
