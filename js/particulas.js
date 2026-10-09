// Motor de partículas ligero y compartido por todas las plantillas.
// - Solo anima transform y opacity (Web Animations API) → 60 fps sin tocar el layout.
// - Dura entre 2 y 4 s y se limpia solo. Sin bucles infinitos.
// - Con prefers-reduced-motion no hace nada.

import { prefiereMenosMovimiento } from './utilidades.js';

const azar = (min, max) => min + Math.random() * (max - min);
const elegir = (lista) => lista[Math.floor(Math.random() * lista.length)];
const FORMAS = new Set(['■', '●', '▲']);

function crearParticula(simbolo, colores) {
  const el = document.createElement('span');
  el.className = 'particula';
  el.setAttribute('aria-hidden', 'true');
  if (FORMAS.has(simbolo) && colores?.length) {
    // Forma geométrica de color (confeti), sin depender de fuentes de emoji.
    el.classList.add(`particula-${simbolo === '■' ? 'cuadro' : simbolo === '●' ? 'circulo' : 'triangulo'}`);
    el.style.setProperty('--color-particula', elegir(colores));
  } else {
    el.textContent = simbolo;
  }
  el.style.fontSize = `${azar(16, 34).toFixed(0)}px`;
  return el;
}

/**
 * Lanza un efecto de celebración.
 * @param {{modo: 'explosion'|'lluvia', simbolos: string[], colores?: string[], cantidad: number}} efecto
 * @param {{origen?: {x: number, y: number}}} [opciones] origen en px de la explosión (por defecto, el centro)
 */
export function lanzarParticulas(efecto, { origen } = {}) {
  if (!efecto || prefiereMenosMovimiento() || typeof Element.prototype.animate !== 'function') return;

  const ancho = window.innerWidth;
  const alto = window.innerHeight;
  // Menos partículas en pantallas pequeñas.
  const cantidad = Math.round(efecto.cantidad * (ancho < 500 ? 0.65 : 1));
  const capa = document.createElement('div');
  capa.className = 'capa-particulas';
  capa.setAttribute('aria-hidden', 'true');
  document.body.append(capa);

  const ox = origen?.x ?? ancho / 2;
  const oy = origen?.y ?? alto / 2;
  const animaciones = [];

  for (let i = 0; i < cantidad; i += 1) {
    const el = crearParticula(elegir(efecto.simbolos), efecto.colores);
    capa.append(el);
    const giro = azar(-540, 540);
    const duracion = azar(2000, 3600);
    let cuadros;

    if (efecto.modo === 'lluvia') {
      const x = azar(0, ancho);
      const deriva = azar(-80, 80);
      cuadros = [
        { transform: `translate(${x}px, -40px) rotate(0deg)`, opacity: 0 },
        { opacity: 1, offset: 0.1 },
        { transform: `translate(${x + deriva}px, ${alto * 0.55}px) rotate(${giro / 2}deg)`, offset: 0.55 },
        { transform: `translate(${x - deriva / 2}px, ${alto + 40}px) rotate(${giro}deg)`, opacity: 0.2 },
      ];
    } else {
      const angulo = azar(0, Math.PI * 2);
      const fuerza = azar(0.25, 0.55) * Math.min(ancho, 900);
      const dx = Math.cos(angulo) * fuerza;
      const dy = Math.sin(angulo) * fuerza - azar(60, 180);
      cuadros = [
        { transform: `translate(${ox}px, ${oy}px) scale(0.3) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${ox + dx * 0.8}px, ${oy + dy * 0.8}px) scale(1) rotate(${giro / 3}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${ox + dx}px, ${oy + dy + alto * 0.45}px) scale(0.9) rotate(${giro}deg)`, opacity: 0 },
      ];
    }

    const animacion = el.animate(cuadros, {
      duration: duracion,
      delay: azar(0, efecto.modo === 'lluvia' ? 900 : 180),
      easing: efecto.modo === 'lluvia' ? 'linear' : 'cubic-bezier(.15,.7,.4,1)',
      fill: 'both',
    });
    animaciones.push(animacion.finished.catch(() => {}));
  }

  Promise.all(animaciones).then(() => capa.remove());
}
