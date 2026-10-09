// Botón "No" que huye (F3).
// - Escritorio (hover): huye en pointerenter.
// - Táctil: huye en pointerdown, con preventDefault para que el toque nunca cuente como clic.
// - Teclado: huye al recibir el foco; Enter/Espacio (click) también se anulan.
// - Nunca se sale del área visible (visualViewport + zona segura) ni queda encima del "Sí".
// - Se mueve solo con transform. El hueco original se conserva con un marcador para que el "Sí" no salte.

const MARGEN = 12;          // px de aire con el borde de la pantalla
const SEPARACION_SI = 20;   // px mínimos con el botón "Sí"
const INTENTOS = 40;

const tieneHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Rectángulo visible y seguro (visualViewport ∩ safe-area) en coordenadas de layout. */
function areaSegura() {
  const vv = window.visualViewport;
  let izq = vv ? vv.offsetLeft : 0;
  let arr = vv ? vv.offsetTop : 0;
  let der = izq + (vv ? vv.width : window.innerWidth);
  let aba = arr + (vv ? vv.height : window.innerHeight);
  const sonda = document.getElementById('zona-segura');
  if (sonda) {
    const r = sonda.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      izq = Math.max(izq, r.left);
      arr = Math.max(arr, r.top);
      der = Math.min(der, r.right);
      aba = Math.min(aba, r.bottom);
    }
  }
  return { izq: izq + MARGEN, arr: arr + MARGEN, der: der - MARGEN, aba: aba - MARGEN };
}

const seSolapan = (a, b) =>
  a.izq < b.der && a.der > b.izq && a.arr < b.aba && a.aba > b.arr;

/**
 * @param {HTMLButtonElement} botonNo
 * @param {HTMLButtonElement} botonSi
 * @param {{textos: string[], alHuir?: (conteo: number) => void}} opciones
 */
export function activarBotonNo(botonNo, botonSi, { textos = [], alHuir } = {}) {
  let conteo = 0;
  let suelto = false;
  let x = 0;
  let y = 0;
  let ultimaHuida = 0;
  let marcador = null;

  function soltar() {
    // Pasa a position: fixed en su posición actual, dejando un marcador del mismo tamaño.
    const r = botonNo.getBoundingClientRect();
    marcador = document.createElement('span');
    marcador.className = 'marcador-no';
    marcador.setAttribute('aria-hidden', 'true');
    marcador.style.width = `${r.width}px`;
    marcador.style.height = `${r.height}px`;
    botonNo.before(marcador);
    x = r.left;
    y = r.top;
    botonNo.classList.add('boton-no-suelto');
    botonNo.style.transform = `translate(${x}px, ${y}px)`;
    // Forzamos el estilo para que la primera huida sí se anime.
    void botonNo.offsetWidth;
    suelto = true;
  }

  function rectSi() {
    const r = botonSi.getBoundingClientRect();
    return {
      izq: r.left - SEPARACION_SI, arr: r.top - SEPARACION_SI,
      der: r.right + SEPARACION_SI, aba: r.bottom + SEPARACION_SI,
    };
  }

  function calcularDestino(puntero) {
    const area = areaSegura();
    const ancho = botonNo.offsetWidth;
    const alto = botonNo.offsetHeight;
    const maxX = Math.max(area.izq, area.der - ancho);
    const maxY = Math.max(area.arr, area.aba - alto);
    const si = rectSi();
    const lejania = Math.max(ancho, alto) * 1.6;
    let mejor = null;
    let mejorPuntaje = -Infinity;

    for (let i = 0; i < INTENTOS; i += 1) {
      const cx = area.izq + Math.random() * (maxX - area.izq);
      const cy = area.arr + Math.random() * (maxY - area.arr);
      const caja = { izq: cx, arr: cy, der: cx + ancho, aba: cy + alto };
      if (seSolapan(caja, si)) continue;
      const centroX = cx + ancho / 2;
      const centroY = cy + alto / 2;
      const ref = puntero ?? { x: x + ancho / 2, y: y + alto / 2 };
      const distancia = Math.hypot(centroX - ref.x, centroY - ref.y);
      if (distancia >= lejania) return { x: cx, y: cy };
      if (distancia > mejorPuntaje) { mejorPuntaje = distancia; mejor = { x: cx, y: cy }; }
    }
    if (mejor) return mejor;

    // Pantalla diminuta: la esquina libre más lejana al "Sí".
    const esquinas = [
      { x: area.izq, y: area.arr }, { x: maxX, y: area.arr },
      { x: area.izq, y: maxY }, { x: maxX, y: maxY },
    ];
    const centroSi = { x: (si.izq + si.der) / 2, y: (si.arr + si.aba) / 2 };
    return esquinas.sort((a, b) =>
      Math.hypot(b.x - centroSi.x, b.y - centroSi.y) - Math.hypot(a.x - centroSi.x, a.y - centroSi.y))[0];
  }

  function mover(destino) {
    x = destino.x;
    y = destino.y;
    botonNo.style.transform = `translate(${x}px, ${y}px)`;
  }

  function huir(puntero) {
    const ahora = performance.now();
    // Un mismo gesto puede disparar pointerenter + pointerdown + focus: cuenta una sola vez.
    if (ahora - ultimaHuida < 120) return;
    ultimaHuida = ahora;
    if (!suelto) soltar();
    conteo += 1;
    if (textos.length) botonNo.textContent = textos[(conteo - 1) % textos.length];
    mover(calcularDestino(puntero));
    botonNo.classList.remove('boton-no-rebote');
    void botonNo.offsetWidth;
    botonNo.classList.add('boton-no-rebote');
    alHuir?.(conteo);
  }

  const punto = (e) => ({ x: e.clientX, y: e.clientY });

  botonNo.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse' || (e.pointerType === 'pen' && tieneHover())) huir(punto(e));
  });
  botonNo.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    huir(punto(e));
  });
  botonNo.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  botonNo.addEventListener('focus', () => huir(null));
  botonNo.addEventListener('click', (e) => {
    // El "No" jamás responde: ni con clic, ni con Enter, ni con Espacio.
    e.preventDefault();
    e.stopImmediatePropagation();
    ultimaHuida = 0;
    huir(null);
  });
  botonNo.addEventListener('contextmenu', (e) => e.preventDefault());

  function reacomodar() {
    if (!suelto) return;
    const area = areaSegura();
    const ancho = botonNo.offsetWidth;
    const alto = botonNo.offsetHeight;
    const dentro = x >= area.izq && y >= area.arr && x + ancho <= area.der && y + alto <= area.aba;
    const caja = { izq: x, arr: y, der: x + ancho, aba: y + alto };
    if (!dentro || seSolapan(caja, rectSi())) mover(calcularDestino(null));
  }

  let pendiente = 0;
  const alCambiar = () => {
    cancelAnimationFrame(pendiente);
    pendiente = requestAnimationFrame(reacomodar);
  };
  window.addEventListener('resize', alCambiar);
  window.addEventListener('orientationchange', alCambiar);
  window.visualViewport?.addEventListener('resize', alCambiar);
  window.visualViewport?.addEventListener('scroll', alCambiar);

  return {
    /** Llamar cuando el "Sí" cambia de tamaño, por si ahora lo tapa. */
    reacomodar: alCambiar,
    /** Devuelve el botón a su lugar (al salir de la pantalla de la pregunta). */
    restablecer() {
      if (!suelto) return;
      suelto = false;
      botonNo.classList.remove('boton-no-suelto', 'boton-no-rebote');
      botonNo.style.transform = '';
      marcador?.remove();
      marcador = null;
    },
  };
}
