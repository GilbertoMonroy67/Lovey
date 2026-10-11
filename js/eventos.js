// Envío de eventos de respuesta (contrato §4). Dispara y olvida: nunca usa await en la interfaz,
// nunca lanza y no envía nada en modo vista previa.

import { LIMITES } from './limites.js';
import { cifrarEleccion, enviarEvento } from './api.js';
import { idAleatorio } from './utilidades.js';

/**
 * @param {string} idPropuesta
 * @param {{vistaPrevia?: boolean, clave?: string|null}} [opciones] `clave`: llave de cifrado de la
 *   propuesta (v2). Con ella la elección de celebración viaja cifrada; null en propuestas v1.
 */
export function crearEmisor(idPropuesta, { vistaPrevia = false, clave = null } = {}) {
  const sesion = idAleatorio(16);
  const activo = !vistaPrevia && Boolean(idPropuesta);
  let pendientes = 0;
  let ultimoEnvio = 0;
  let temporizador = 0;

  function enviar(evento, keepalive = false) {
    if (!activo) return;
    try {
      enviarEvento(idPropuesta, { ...evento, sesion }, { keepalive });
    } catch {
      /* nunca rompe la página */
    }
  }

  function vaciarIntentos(keepalive = false) {
    clearTimeout(temporizador);
    temporizador = 0;
    while (pendientes > 0) {
      const conteo = Math.min(pendientes, LIMITES.conteoIntentoNo.max);
      pendientes -= conteo;
      enviar({ tipo: 'intento_no', conteo }, keepalive);
    }
    ultimoEnvio = Date.now();
  }

  function alOcultar() {
    if (pendientes > 0) vaciarIntentos(true);
  }
  if (activo) {
    window.addEventListener('pagehide', alOcultar);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') alOcultar();
    });
  }

  return {
    abierto() {
      enviar({ tipo: 'abierto' });
    },
    /** Acumula un intento; se envía como máximo uno cada 3 s con el conteo agrupado. */
    intentoNo() {
      if (!activo) return;
      pendientes += 1;
      if (temporizador) return;
      const espera = Math.max(0, ultimoEnvio + LIMITES.intervaloIntentoNoMs - Date.now());
      if (espera === 0) vaciarIntentos();
      else temporizador = setTimeout(() => vaciarIntentos(), espera);
    },
    si() {
      if (pendientes > 0) vaciarIntentos(true);
      enviar({ tipo: 'si' }, true);
    },
    celebracion(opcionId, nota) {
      if (!activo) return;
      if (!clave) {
        const evento = { tipo: 'celebracion_elegida', opcionId };
        if (nota) evento.nota = nota;
        enviar(evento, true);
        return;
      }
      // El servidor solo recibe la elección cifrada (opción + nota).
      const eleccion = nota ? { opcionId, nota } : { opcionId };
      cifrarEleccion(clave, eleccion)
        .then((cifrado) => enviar({ tipo: 'celebracion_elegida', cifrado }, true))
        .catch(() => { /* dispara y olvida */ });
    },
  };
}
