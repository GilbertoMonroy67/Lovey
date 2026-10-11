import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type CodigoError =
  | 'json_invalido'
  | 'no_autorizado'
  | 'no_encontrado'
  | 'expirada'
  | 'limite_eventos'
  | 'archivo_muy_grande'
  | 'tipo_no_soportado'
  | 'validacion'
  | 'foto_invalida'
  | 'demasiadas_solicitudes'
  | 'capacidad_agotada'
  | 'verificacion_bot'
  | 'https_requerido'
  | 'interno';

export interface DetalleError {
  campo: string;
  mensaje: string;
}

const MENSAJES: Record<CodigoError, string> = {
  json_invalido: 'El cuerpo de la solicitud no es JSON válido.',
  no_autorizado: 'La clave de administración falta o es incorrecta.',
  no_encontrado: 'No encontramos lo que buscas.',
  expirada: 'Esta propuesta ya expiró.',
  limite_eventos: 'Esta propuesta ya no acepta más eventos.',
  archivo_muy_grande: 'El contenido es demasiado grande.',
  tipo_no_soportado: 'Formato no compatible: la foto debe llegar cifrada desde la app.',
  validacion: 'Algunos datos no son válidos.',
  foto_invalida: 'Una de las fotos no existe, ya se usó o expiró. Vuelve a subirla.',
  demasiadas_solicitudes: 'Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.',
  capacidad_agotada: 'Hoy se alcanzó el límite del servicio. Inténtalo mañana.',
  verificacion_bot: 'No pudimos verificar que eres una persona. Recarga la página e inténtalo de nuevo.',
  https_requerido: 'Esta API solo acepta conexiones seguras (HTTPS).',
  interno: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
};

/** Error de negocio que se traduce a `{ error: { codigo, mensaje } }` con su estado HTTP. */
export class ErrorApi extends Error {
  constructor(
    readonly estado: ContentfulStatusCode,
    readonly codigo: CodigoError,
    mensaje?: string,
    readonly detalles?: DetalleError[],
    readonly reintentarEn?: number,
  ) {
    super(mensaje ?? MENSAJES[codigo]);
    this.name = 'ErrorApi';
  }
}

export function respuestaError(c: Context, err: ErrorApi): Response {
  const cuerpo: { error: { codigo: CodigoError; mensaje: string; detalles?: DetalleError[] } } = {
    error: { codigo: err.codigo, mensaje: err.message },
  };
  if (err.detalles?.length) cuerpo.error.detalles = err.detalles;
  if (err.reintentarEn !== undefined) c.header('Retry-After', String(err.reintentarEn));
  return c.json(cuerpo, err.estado);
}

/** Manejador central: los errores inesperados se registran sin datos personales y se responden como `interno`. */
export function manejarError(err: Error, c: Context): Response {
  if (err instanceof ErrorApi) return respuestaError(c, err);
  console.error('error_interno', { ruta: c.req.routePath, metodo: c.req.method, tipo: err.name, mensaje: err.message });
  return respuestaError(c, new ErrorApi(500, 'interno'));
}
