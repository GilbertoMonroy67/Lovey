// Reenvío opcional de avisos push a ntfy.sh (docs/arquitectura.md §4 y D3).
// Nunca lanza: si ntfy falla, la respuesta al cliente no se ve afectada.
export interface AvisoNtfy {
  titulo: string;
  mensaje: string;
  etiquetas?: string[];
}

export function construirAviso(
  tipo: string,
  para: string,
  etiquetaCelebracion?: string | null,
): AvisoNtfy | null {
  switch (tipo) {
    case 'abierto':
      return { titulo: 'Noviazgo', mensaje: `${para} abrió tu enlace`, etiquetas: ['eyes'] };
    case 'si':
      return { titulo: 'Noviazgo', mensaje: `¡${para} dijo que SÍ! 💖`, etiquetas: ['tada'] };
    case 'celebracion_elegida':
      return {
        titulo: 'Noviazgo',
        mensaje: `${para} eligió celebrar en: ${etiquetaCelebracion ?? 'una opción'}`,
        etiquetas: ['partying_face'],
      };
    default:
      return null; // intento_no no se reenvía para no saturar
  }
}

/** Publica con la API JSON de ntfy (permite UTF-8 en título y mensaje, a diferencia de las cabeceras). */
export async function publicarNtfy(
  base: string | undefined,
  tema: string,
  aviso: AvisoNtfy,
  hacerFetch: typeof fetch = fetch,
): Promise<boolean> {
  if (!base) return false;
  try {
    const r = await hacerFetch(base.replace(/\/+$/, '') + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: tema, title: aviso.titulo, message: aviso.mensaje, tags: aviso.etiquetas ?? [] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.warn('ntfy_fallo', { estado: r.status });
    return r.ok;
  } catch (e) {
    console.warn('ntfy_fallo', { tipo: (e as Error).name });
    return false;
  }
}
