# Proyecto Noviazgo — Aplicación Web

> Este archivo guarda el contexto del proyecto entre sesiones con Claude.
> Claude debe leerlo al iniciar cada sesión y actualizarlo al final con lo trabajado.
>
> **Contrato técnico de integración frontend/backend:** [`docs/arquitectura.md`](docs/arquitectura.md).
> Ahí están el modelo de datos, la API, los eventos, los límites, el modo mock y la propiedad de cada archivo.
> Si este archivo y el contrato no coinciden en un detalle técnico, manda el contrato. Solo lo cambia el agente `arquitecto`.

## Agentes del proyecto (`.claude/agents/`)

| Agente | Responsabilidad | Archivos que le pertenecen |
|--------|-----------------|----------------------------|
| `arquitecto` | Decisiones técnicas, contrato de integración, planificación, revisión y reestructuración | `CLAUDE.md`, `docs/`, `js/limites.js`, `.claude/agents/`, `README.md`, `.gitignore`, `.nojekyll` |
| `frontend` | UX/UI, las tres páginas, plantillas, fotos en el navegador y el adaptador `js/api.js` con su modo mock | `*.html`, `css/**`, `js/**` (excepto `js/limites.js`), `assets/**` |
| `backend` | El Worker de Cloudflare: API, D1, R2, límites de tasa, limpieza y avisos ntfy; a futuro, login con Google | `api/**` |
| `cyberbot` | Ciberseguridad: audita secretos, XSS, CORS, auth, fotos, límites, privacidad y dependencias; propone correcciones al dueño de cada archivo | `docs/seguridad.md` |

## Descripción del proyecto

Vamos a crear una aplicacion web que se pueda alojar en github pages, para cuando la genete quiera pedirle a alguien que sea su novia, esposa, etc.

El punto "Divertido" es que la persona que lo reciva no tendra la opcion de decir no ya que haremos que el voton de no de mueva de forma aleatoria a alguna parte de la pantalla cuando el cursor este sobre el, en el caso de mobile o alguna pantalla touch cuando le de clic el boton "huira".

### Funcionalidades

1. **Generador (`index.html`):** quien hace la pregunta escribe su nombre, el de la otra persona y el tipo de pregunta (novia/novio, esposa/esposo, cita, otro) y elige una plantilla. Después arma los **pasos** (de 1 a 5, cada uno con palabras bonitas y de 0 a 3 fotos), ajusta la pregunta y elige las **opciones de celebración** que va a ofrecer. Al terminar obtiene:
   - Un **enlace para la pareja**: `pregunta.html?id=<id>#c=<llave>`.
   - Un **enlace privado de seguimiento**: `respuestas.html?id=<id>#k=<claveAdmin>&c=<llave>`.
   - La llave `c` cifra todo de extremo a extremo y nunca llega al servidor (ver "Registro y privacidad").
   - Un aviso push opcional con ntfy.
2. **Experiencia de la pareja (`pregunta.html`), en este orden:**
   1. **Pasos:** palabras bonitas con fotos y un botón **Siguiente** (y **Atrás**). Puede haber varias pantallas de este tipo.
   2. **Pregunta:** "¿Quieres ser mi …?" con los botones **Sí** y **No**.
   3. **Celebración:** si responde Sí, elige dónde celebrar entre las opciones que puso quien envía (La BTK, un helado, paseo en el parque, el cine… y opciones personalizadas), con una nota opcional.
   4. **Final:** mensaje y animación de celebración (corazones o confeti propios).
3. **Botón "No" que huye:**
   - En escritorio, al pasar el cursor por encima (`pointerenter`), salta a una posición aleatoria dentro de la pantalla.
   - En móvil o pantallas táctiles, salta en cuanto se intenta tocar (`pointerdown`, antes de que cuente el clic).
   - Nunca se sale del área visible ni queda encima del botón "Sí".
   - El "No" nunca dispara una respuesta, ni siquiera navegando con teclado: con el foco también huye.
   - Extras: el "Sí" crece cada vez que el "No" huye, y el texto del "No" cambia ("¿Segur@?", "Piénsalo bien"…).
4. **Fotos:** se comprimen en el navegador (WebP, o JPEG en Safari, máximo 1280 px y 500 KB, sin EXIF), **se cifran** y se suben al Worker, que las guarda en R2 sin poder verlas. Expiran junto con la propuesta (30 días). Son opcionales: si no hay o fallan, el paso muestra solo el texto.
5. **Plantillas:** se eligen en el generador entre varias plantillas visuales (romántica, minimalista, carta vintage, noche estrellada, retro 8-bit, kawaii, propuesta de matrimonio…) con vista previa. Cada plantilla es un archivo CSS en `css/plantillas/` y se registra en `js/plantillas.js`. Su id se guarda en la propuesta (campo `plantilla`).
6. **Ver la respuesta (`respuestas.html`):** quien envía ve en la PC, sin registrarse, que se **abrió** el enlace, los **intentos de No**, que dijo **Sí** y **qué celebración eligió** (con su nota). Los eventos se guardan en el backend durante 30 días y el panel los consulta cada 5 s. "Mis propuestas" se recuerda en el `localStorage` de esa PC.
7. **Avisos push (opcional):** si quien envía lo activa, el Worker reenvía a un tema secreto de ntfy.sh los eventos "abrió", "dijo que sí" y "eligió celebración". Para recibirlos hay que suscribirse a ese tema en la app de ntfy.

### Registro y privacidad

- **Nadie se registra en v1.** Quien recibe nunca ve un muro de registro. Quien envía queda identificado por una clave secreta (`claveAdmin`) que va en el fragmento `#` del enlace de seguimiento. El servidor solo guarda su hash.
- El login con Google para quien envía (historial en varios dispositivos) queda como fase futura y opcional.
- **Cifrado de extremo a extremo (desde 2026-10-11):** nombres, textos, opciones, nota y fotos se cifran en el navegador (AES-GCM 256, `js/cifrado.js`). En D1 y R2 solo hay datos ilegibles. La llave viaja en el fragmento `#c=` de los enlaces: quien tiene el enlace ve la sorpresa y nadie más, ni el servidor.
- Se guardan durante 30 días, cifrados, y el servidor solo ve los eventos (abrió, intentos de No, sí). La IP se guarda únicamente como hash con sal para limitar la tasa de solicitudes.
- Controles de seguridad y riesgos aceptados: `docs/seguridad.md` (agente `cyberbot`).

## Stack tecnológico

Criterio: **la menor infraestructura posible sin perder calidad**.

- **Frontend:** HTML5 + CSS3 + JavaScript puro (ES Modules), sin framework y sin paso de build, publicado en **GitHub Pages** (rama `main`, carpeta raíz). Lo que se escribe es lo que se publica.
- **Backend:** **un solo Cloudflare Worker** en `api/`, escrito en TypeScript (compilado por Wrangler) con **Hono** (router) y **Zod** (validación). No usa ORM: consultas parametrizadas de D1 y migraciones SQL.
- **Base de datos:** **Cloudflare D1** (SQLite) con las tablas `propuestas`, `fotos`, `eventos` y `limites`.
- **Archivos:** **Cloudflare R2**, bucket `noviazgo-fotos`. Para activarlo hay que registrar un método de pago; dentro del plan gratuito el costo es $0.
- **Tiempo real:** sondeo cada 5 s desde `respuestas.html`. ntfy.sh queda solo como reenvío push opcional desde el Worker.
- **Desarrollo sin backend:** `js/api.js` tiene un modo `mock` (`js/api-mock.js`, con localStorage) que cumple el mismo contrato. La URL de la API vive solo en `js/config.js`.
- **Dependencias:**
  - Frontend: ninguna.
  - Backend: `hono` y `zod` en producción; `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers` y `typescript` en desarrollo. Todo dentro de `api/package.json`.
- **Calidad:** HTML semántico, diseño mobile-first, respeto a `prefers-reduced-motion`, metaetiquetas Open Graph, cero errores en la consola y prueba manual en Chrome, Firefox y Safari (escritorio y móvil).

## Estructura del proyecto

```
Noviazgo/
├── CLAUDE.md                      [arquitecto]
├── README.md                      [arquitecto]
├── .gitignore / .nojekyll         [arquitecto]
├── docs/arquitectura.md           [arquitecto] contrato de integración
├── docs/seguridad.md              [cyberbot] modelo de amenazas y auditorías (se crea en la primera auditoría)
├── .claude/agents/                [arquitecto] arquitecto.md, frontend.md, backend.md, cyberbot.md
├── index.html                     [frontend] generador
├── pregunta.html                  [frontend] pasos → pregunta → celebración → final
├── respuestas.html                [frontend] panel de quien envía
├── css/
│   ├── styles.css                 [frontend] base común
│   └── plantillas/<id>.css        [frontend] una por plantilla ([data-plantilla="<id>"])
├── js/
│   ├── config.js                  [frontend] API_BASE y MODO ('mock' | 'api')
│   ├── limites.js                 [arquitecto] límites compartidos con el Worker
│   ├── api.js / api-mock.js       [frontend] adaptador de la API (cifra y descifra) y su simulación
│   ├── cifrado.js                 [frontend] AES-GCM con WebCrypto; llave en #c=
│   ├── generador.js               [frontend]
│   ├── editor-pasos.js            [frontend]
│   ├── fotos.js                   [frontend] compresión y subida
│   ├── celebraciones.js           [frontend] opciones predefinidas
│   ├── plantillas.js              [frontend]
│   ├── pregunta.js                [frontend] máquina de estados
│   ├── boton-no.js                [frontend]
│   ├── particulas.js              [frontend]
│   ├── eventos.js                 [frontend] envío de eventos (agrupa "No", keepalive)
│   ├── respuestas.js              [frontend] sondeo adaptativo y panel
│   ├── utilidades.js              [frontend] DOM con textContent, largo() en code points, enlaces
│   └── validacion.js              [frontend] reglas del contrato §3.3 + urlFotoValida()
├── assets/                        [frontend] favicon.svg, og-imagen.png (1200×630)
└── api/                           [backend] Cloudflare Worker
    ├── package.json, package-lock.json, wrangler.jsonc, tsconfig.json, vitest.config.ts
    ├── worker-configuration.d.ts (npm run types), .dev.vars.example, .gitignore, README.md
    ├── migrations/0001_inicial.sql
    ├── src/ (index.ts, tipos.ts, comun.ts, cors.ts, errores.ts, esquemas.ts, limite-tasa.ts, ids.ts, ntfy.ts, turnstile.ts, limpieza.ts, rutas/{fotos,propuestas,eventos}.ts)
    └── test/ (base, propuestas, fotos, eventos, limites-limpieza .test.ts + ayuda.ts, configurar.ts, env.d.ts)
```

GitHub Pages publica también la carpeta `api/` como archivos estáticos. No pasa nada: no contiene secretos (`.dev.vars` está en `.gitignore`) y nadie la enlaza.

## Comandos útiles

```bash
python3 -m http.server 8000             # frontend en http://localhost:8000 (modo mock automático)
npx serve .                             # alternativa con Node
cd api && npm install                   # dependencias del Worker
cd api && npx wrangler dev              # API local en http://localhost:8787/api/v1
cd api && npx wrangler d1 migrations apply noviazgo --local    # migraciones en local
cd api && npx wrangler d1 migrations apply noviazgo --remote   # migraciones en producción
cd api && npx vitest                    # tests del Worker
cd api && npx wrangler deploy           # publicar la API
git push origin main                    # publicar el frontend (GitHub Pages)
```

Para usar el frontend local contra `wrangler dev`, ejecuta en la consola del navegador `localStorage.setItem('noviazgo:modo','api')`. Para volver al modo mock, usa `'mock'`.

**Configuración manual (una sola vez):** está en `docs/arquitectura.md` §9. Incluye GitHub Pages, la cuenta de Cloudflare, R2 con su regla de ciclo de vida, `wrangler d1 create`, el secreto `SAL_IP`, `ORIGENES_PERMITIDOS`, el deploy y pegar la URL en `js/config.js`.

## Decisiones tomadas

| Fecha | Decisión | Motivo |
|-------|----------|--------|
| 2026-10-06 | Usar `CLAUDE.md` como bitácora de contexto entre sesiones | Mantener continuidad del proyecto |
| 2026-10-06 | HTML + CSS + JS puro, sin framework ni build | GitHub Pages es estático; la app es pequeña y no lo necesita |
| 2026-10-06 | ~~Sin backend ni base de datos; los datos van en la URL (Base64 URL-safe)~~ | **Reemplazada el 2026-10-07** (fotos y respuesta persistente) |
| 2026-10-06 | Usar Pointer Events (`pointerenter` / `pointerdown`) para el botón "No" | Un solo código para mouse, touch y lápiz |
| 2026-10-06 | ~~Ver la respuesta desde la PC con ntfy.sh (canal secreto + SSE en `respuestas.html`)~~ | **Reemplazada el 2026-10-07**: ntfy queda solo como push opcional |
| 2026-10-06 | Crear el agente `arquitecto` | Centralizar decisiones técnicas, planificación y reestructuración |
| 2026-10-06 | Crear los agentes `frontend` (UX/UI y plantillas) y `backend` | Especializar el diseño visual y el servidor sin mezclarlos |
| 2026-10-06 | Plantillas = un CSS por plantilla con variables bajo `[data-plantilla]` + registro en `js/plantillas.js` | Agregar plantillas sin tocar la lógica ni el layout base |
| 2026-10-06 | Stack sugerido para backend: Cloudflare Workers + Hono + D1 (+ Google OAuth a futuro) | Bajo costo y poca infraestructura |
| 2026-10-07 | Contrato de integración en `docs/arquitectura.md`, propiedad exclusiva del arquitecto | Frontend y backend trabajan en paralelo contra un acuerdo único |
| 2026-10-07 | Activar el backend ahora: un Cloudflare Worker (Hono + Zod) con D1 y R2 en `api/` | Las fotos no caben en la URL y la respuesta debe persistir más de 12 h; $0 en plan gratuito |
| 2026-10-07 | Fotos en R2, comprimidas en el navegador (WebP/JPEG, ≤ 1280 px, ≤ 500 KB, sin EXIF) y validadas por bytes mágicos | Supabase pausa proyectos inactivos y su subida anónima es difícil de limitar; los hosts de terceros exponen claves y no permiten borrar |
| 2026-10-07 | Plan B si no se activa R2: fotos como BLOB en D1, con el mismo contrato HTTP | Evitar el registro del método de pago sin tocar el frontend |
| 2026-10-07 | La propuesta se guarda en D1; el enlace es `pregunta.html?id=<12 base62>`. Se elimina `?d=` y `url-datos.js` | Los enlaces largos se rompen en WhatsApp; aún no había enlaces publicados |
| 2026-10-07 | Sin registro: quien envía usa una `claveAdmin` secreta en el fragmento `#k=`; el servidor guarda solo su hash | Cero fricción; quien recibe nunca ve un muro de registro. Google OAuth queda como fase futura opcional |
| 2026-10-07 | Eventos (`abierto`, `intento_no`, `si`, `celebracion_elegida`) guardados en D1 y consultados por sondeo cada 5 s | Persistencia de 30 días; más simple que SSE o Durable Objects para un solo espectador |
| 2026-10-07 | Eventos enviados como `text/plain` (sin preflight CORS), con `keepalive` en `si` y `celebracion_elegida` | Que lleguen aunque se cierre la pestaña, en todos los navegadores |
| 2026-10-07 | ntfy.sh solo como push opcional, reenviado por el Worker | El navegador deja de depender de un tercero; avisos al celular sin costo |
| 2026-10-07 | Sin ORM (D1 con `prepare().bind()` + migraciones SQL); Hono y Zod como únicas dependencias de producción | Con 4 tablas, Drizzle no compensa |
| 2026-10-07 | `js/config.js` (URL única) + `js/api.js` con modo `mock` en localStorage | Desarrollar y probar el frontend sin backend desplegado |
| 2026-10-07 | Límites compartidos en `js/limites.js`, importado por el frontend y por el Worker | Una sola fuente de verdad para la validación |
| 2026-10-07 | Expiración de 30 días; cron diario de limpieza + regla de ciclo de vida de R2 a 35 días; límites de tasa por hash de IP y topes globales diarios | Contener el abuso y mantenerse en el plan gratuito |
| 2026-10-07 | Revisión final: contrato v1.1 (`docs/arquitectura.md` §12) con las desviaciones aceptadas de ambos agentes | La integración real (I1) confirmó que frontend y Worker cumplen el contrato |
| 2026-10-07 | Longitud de textos en **code points** en ambos lados (`largo()` y Zod ≥ 4.6), fijado con un test | Evitar que un texto con emojis pase en el navegador y falle en el servidor |
| 2026-10-07 | Sondeo adaptativo en `respuestas.html`: 5 s, 15 s tras 10 min sin eventos, 60 s con celebración elegida | Un panel abierto todo el día gastaba ~17 % de la cuota diaria de Workers y de D1 |
| 2026-10-07 | Límites de tasa siguen en D1 en v1; migrar `eventos`/`panel`/`leer` al binding `ratelimits` (pendiente B6) | Quitar escrituras de D1 en el sondeo sin arriesgar el deploy antes de confirmar el plan gratuito |
| 2026-10-07 | Fotos con `Cache-Control: private, max-age=86400` | Son fotos personales: el navegador puede cachearlas, los proxies no; tras borrar solo queda la copia de quien ya las vio |
| 2026-10-07 | `subirFoto` con XHR (progreso); vista previa sin `noopener` (hereda `sessionStorage`); mock con fotos en `localStorage` (≈ 7) | Mejor UX al subir; la vista previa no funciona con `noopener`; el mock es solo para desarrollo |
| 2026-10-07 | `og:image` relativa en el repo; el usuario la vuelve absoluta al publicar (§9, paso 8) | WhatsApp exige una URL absoluta y el dominio solo se conoce al publicar (no hay build) |
| 2026-10-07 | `SAL_IP` obligatoria en producción (el Worker solo avisa si falta) | Sin sal, el hash de una IPv4 se revierte por fuerza bruta |
| 2026-10-07 | Avisos de `npm audit` (undici, solo desarrollo) aceptados; Google Fonts por plantilla aceptadas | No afectan producción; las fuentes no bloquean la carga y tienen respaldo |
| 2026-10-09 | Repositorio `GilbertoMonroy67/Lovey`; frontend en `https://gilbertomonroy67.github.io/Lovey/` | Elegido por el usuario |
| 2026-10-09 | API en producción: `https://noviazgo-api.gilbertoalejandromonroymorales.workers.dev/api/v1`; `ORIGENES_PERMITIDOS = https://gilbertomonroy67.github.io` | Solo la página del usuario puede llamar a la API desde el navegador |
| 2026-10-11 | **Contrato v2: cifrado de extremo a extremo** (AES-GCM 256 en el navegador, llave en `#c=`). El servidor guarda el sobre `{ v: 2, cifrado, fotos }` y fotos `application/octet-stream`; las v1 se siguen leyendo hasta expirar | Pedido del usuario: que los datos y las fotos no se vean en la nube, solo con el enlace |
| 2026-10-11 | La validación de textos pasa a ser solo del navegador (`js/validacion.js`); el Worker valida forma y tamaño. Se elimina el test de code points del Worker | El servidor ya no puede leer el contenido; `pregunta.js` vuelve a sanear al descifrar |
| 2026-10-11 | Avisos ntfy genéricos en v2 (sin nombre ni opción) | El Worker no conoce el contenido |
| 2026-10-11 | Endurecimiento: Zod `.strict()`, HTTPS obligatorio (301/403) + HSTS, CSP/XFO/CORP en la API, CSP `<meta>` y `no-referrer` en las tres páginas, cuerpo JSON ≤ 32 KB | Controles 8, 14–19 de la auditoría de `cyberbot` |
| 2026-10-11 | Turnstile opcional en `POST /propuestas` (desactivado hasta configurar `TURNSTILE_SITIO` + `TURNSTILE_SECRETO`) | Protección contra bots gratuita, sin muro para quien recibe |
| 2026-10-11 | Crear el agente `cyberbot` (ciberseguridad), auditor sin propiedad de código: solo escribe `docs/seguridad.md` | Revisar la seguridad antes de cada deploy sin mezclarla con el trabajo de `frontend` y `backend` |
| 2026-10-09 | `.gitignore` endurecido (`.env*`, `.dev.vars*`, `*.pem`, `*.key`, `.wrangler/`, `.claude/settings.local.json`…) | Requisito del usuario: nunca subir llaves ni credenciales |

## Pendientes / Próximos pasos

- [x] Definir el propósito y funcionalidades de la aplicación
- [x] Elegir el stack tecnológico
- [x] Contrato de integración frontend/backend (`docs/arquitectura.md`)
- [x] Inicializar git y crear el repositorio en GitHub (`GilbertoMonroy67/Lovey`, 2026-10-09)
- [x] Crear `.gitignore`, `.nojekyll` y `js/limites.js` (arquitecto)
- [x] `README.md` (arquitecto)
- [x] F1: base del frontend + `config.js` + `api.js` / `api-mock.js` (frontend)
- [x] F2: `pregunta.html` con la máquina de estados pasos → pregunta → celebración → final (frontend)
- [x] F3: botón "No" que huye (escritorio + táctil + teclado) (frontend)
- [x] F4: generador con editor de pasos, fotos comprimidas y opciones de celebración (frontend)
- [x] F5: `eventos.js` + `respuestas.html` con sondeo (frontend)
- [x] F6: sistema de plantillas + catálogo inicial (7) + galería con vista previa (frontend)
- [x] B1–B5: Worker (esqueleto/CORS, propuestas, fotos R2, eventos + ntfy, límites de tasa + cron) (backend)
- [x] Cuenta de Cloudflare, activar R2, crear D1, `SAL_IP`, deploy y pegar la URL en `js/config.js` (2026-10-09)
- [x] I1: integración `MODO=api` contra `wrangler dev` (2026-10-07, ver `docs/arquitectura.md` §12)
- [x] Metaetiquetas Open Graph e imagen de vista previa (1200×630)
- [x] Volver absoluta la URL de `og:image` en `index.html` y `pregunta.html` (2026-10-09)
- [ ] B6: límites por IP de alta frecuencia con el binding `ratelimits` (backend; antes confirmar que está en el plan gratuito)
- [ ] Prueba manual en navegadores reales: botón "No" en táctil (iPhone y Android), teclado, `prefers-reduced-motion` y compresión de fotos HEIC/EXIF (usuario/frontend)
- [x] CSP por `<meta>` en las tres páginas (2026-10-11)
- [x] Primera auditoría de `cyberbot` con los 20 controles y `docs/seguridad.md` (2026-10-11)
- [x] Deploy v2 del Worker y del frontend, verificado en producción (2026-10-11)
- [x] Turnstile activo: site key pública en `js/config.js` y `TURNSTILE_SECRETO` solo en el Worker; verificado con 403 sin token (2026-10-11)
- [ ] 2026-11-10: quitar el soporte de lectura de propuestas v1
- [ ] Activar GitHub Pages y probar en móvil real (lista de `docs/arquitectura.md` §10)
- [ ] (Futuro) Login con Google opcional para quien envía (historial en varios dispositivos) (backend). Requiere antes servir el frontend y la API desde el mismo sitio (Workers Assets o un dominio propio), porque las cookies de `workers.dev` no funcionan desde `github.io`.

## Bitácora de sesiones

### Sesión 1 — 2026-10-06
- Se creó el directorio del proyecto (vacío) y este archivo `CLAUDE.md`.
- Se definió la idea: una página para pedirle a alguien que sea tu pareja, con un botón "No" que huye.
- Se eligió el stack de infraestructura mínima: HTML/CSS/JS puro en GitHub Pages, sin backend ni base de datos.
- Se documentaron las funcionalidades, la estructura de carpetas y los comandos.
- Se creó el agente `arquitecto` en `.claude/agents/arquitecto.md`.
- Se agregó la funcionalidad de ver la respuesta desde la PC usando ntfy.sh (sin backend propio).
- Se crearon los agentes `frontend` (UX/UI + plantillas) y `backend` (API, BD, Google OAuth para la fase futura).
- Se definió el sistema de plantillas seleccionables.

### Sesión 2 — 2026-10-07
- Requisitos nuevos:
  - Pasos con palabras bonitas y fotos antes de la pregunta.
  - Pantalla de celebración en la que la pareja elige dónde celebrar, entre opciones definidas por quien envía.
  - Quien envía debe ver la apertura, el Sí y la celebración elegida.
- El arquitecto escribió el contrato `docs/arquitectura.md`: decisiones, modelo de datos v1, API, eventos, límites, flujo de pantallas, propiedad de archivos, modo mock, plan paralelo y configuración manual.
- Se activó un backend mínimo (Cloudflare Worker + D1 + R2) y se reemplazaron las decisiones de "sin backend" y "ntfy como canal principal".
- Se actualizaron las reglas de los agentes `arquitecto`, `frontend` y `backend` para que sean coherentes con el contrato.
- (Antes de implementar) Siguiente paso: `frontend` (F1–F6) y `backend` (B1–B5) en paralelo.
- `frontend` completó F1–F6 en modo mock:
  - Páginas: `index.html` (generador), `pregunta.html` (pasos → pregunta → celebración → final) y `respuestas.html` (panel con sondeo).
  - Módulos JS: `config`, `api` y `api-mock`, `utilidades`, `validacion`, `fotos`, `editor-pasos`, `celebraciones`, `plantillas`, `particulas`, `boton-no`, `eventos`, `pregunta`, `generador` y `respuestas`.
  - Plantillas en `css/plantillas/`: `romantica` (por defecto), `noche`, `vintage`, `kawaii`, `minimalista`, `retro` y `propuesta`.
  - Recursos en `assets/`: `favicon.svg` y `og-imagen.png` (1200×630, 23 KB, sin revelar la sorpresa).
- `js/validacion.js` (nuevo, del frontend): valida el modelo §3.3 en el navegador y comprueba las URLs de las fotos. Lo usan el generador, `api-mock.js` y `pregunta.js`.
- `subirFoto(blob, { alProgresar })` acepta un segundo parámetro opcional para la barra de progreso (en modo `api` usa XHR). No cambia el contrato.
- Verificado:
  - `node --check` en todos los `.js`.
  - Cada archivo referenciado responde 200 en `http.server`.
  - Pruebas en jsdom (desde el scratchpad, sin dependencias en el repo) del flujo completo de las tres páginas en mock, sin errores de consola.
  - Contraste AA de cada plantilla.
- Pendiente: `og:image` debe ser una URL absoluta (`https://<usuario>.github.io/<repo>/assets/og-imagen.png`) cuando se conozca el dominio, porque WhatsApp no resuelve rutas relativas.
- Pendiente: probar en navegador real (móvil y escritorio, con y sin `prefers-reduced-motion`) y la compresión de fotos HEIC/JPG grandes con `exiftool`.
- Backend (B1–B5) implementado en `api/`: Worker Hono + Zod con D1 y R2, migración `0001_inicial.sql`, fotos validadas por bytes mágicos, propuestas, eventos con resumen y dedupe del `si`, panel protegido por `claveAdmin` (hash SHA-256), CORS, límites de tasa por hash de IP con topes globales, cron de limpieza y reenvío opcional a ntfy. Importa `js/limites.js` directamente.
- Tests del Worker: 86 en verde (Vitest + `@cloudflare/vitest-pool-workers`) y `tsc --noEmit` sin errores. Probado con `curl` contra `wrangler dev --local`. Guía en `api/README.md`, incluida la nota de diseño del login con Google (no implementado).
- Revisión final del arquitecto (integración y compatibilidad con GitHub Pages):
  - I1 real: `wrangler dev --local` + `python3 -m http.server`; `js/api.js` en modo `api` con jsdom (20 comprobaciones) y `pregunta.html` completo contra el Worker (23 comprobaciones). CORS verificado con localhost, `https://usuario.github.io` y un origen ajeno.
  - Sin `innerHTML`, sin rutas absolutas y con un solo punto de red (`js/api.js`). La clave solo viaja en `#k=` y en `Authorization`. El botón "No" cumple las reglas.
  - La duda de los emojis no era un bug: Zod 4.6 ya cuenta code points, igual que `largo()`. Se fijó con un test.
  - Correcciones: el mock se alineó con el Worker (`nota: null`, `etiqueta: null`, DELETE de expiradas); `js/validacion.js` rechaza fotos repetidas; `respuestas.js` tiene sondeo adaptativo y respaldo de etiqueta; las fotos usan `Cache-Control: private`. Quedan 87 tests en verde y `tsc` limpio.
  - Contrato v1.1 (§12 con las desviaciones aceptadas, B6 nuevo y §9 con `SAL_IP` obligatoria y `og:image` absoluta), `README.md` de la raíz y este archivo actualizados.
- Siguiente paso: el usuario inicializa git, hace la configuración manual de `docs/arquitectura.md` §9 y prueba en móvil real (§10).

### Sesión 3 — 2026-10-09
- Se instaló el plugin oficial de Cloudflare para Claude Code (skills + MCP) con el binario de WSL, porque el disco C: de Windows está al 100 %.
- Despliegue en Cloudflare (cuenta del usuario, plan gratuito):
  - D1 `noviazgo` (id `ebb98293-1c9e-449e-806d-389010d2a4b2`, región WNAM) con la migración `0001_inicial.sql` aplicada en remoto.
  - R2 `noviazgo-fotos` con la regla de ciclo de vida `borrar-fotos-35-dias` (prefijo `fotos/`).
  - Worker `noviazgo-api` desplegado con el cron diario `0 4 * * *`.
  - Secreto `SAL_IP` generado con `openssl` y enviado directo a `wrangler secret put` (no existe en ningún archivo).
- `js/config.js` apunta a la API de producción; `og:image` es absoluta (`https://gilbertomonroy67.github.io/Lovey/assets/og-imagen.png`).
- Prueba de punta a punta en producción: 11/11 (foto en R2, propuesta en D1, `si`, `celebracion_elegida`, panel 200/401, DELETE en cascada con 404 posterior). Los datos de prueba se borraron.
- Revisión de seguridad: ningún secreto en archivos versionables; la sesión de Wrangler vive en `~/.config/.wrangler/`, fuera del repo.
- Git: repo `git@github.com:GilbertoMonroy67/Lovey.git`, rama `main`. Commits firmados con el correo privado `128734942+GilbertoMonroy67@users.noreply.github.com` (configurado solo en este repo). Push por SSH.
- Antes del primer push se revisaron los 68 archivos: `api/.dev.vars`, `api/.wrangler/` y `node_modules/` quedan fuera; sin llaves en el contenido.
- GitHub Pages activo en **https://gilbertomonroy67.github.io/Lovey/**: todas las páginas y recursos responden 200, `api/.dev.vars` responde 404 y la API acepta el origen de Pages (CORS).
- Siguiente paso: prueba manual en celulares reales (`docs/arquitectura.md` §10) y B6 (límites con `ratelimits`).

### Sesión 4 — 2026-10-11
- Se creó el agente `cyberbot` (`.claude/agents/cyberbot.md`), responsable de la ciberseguridad. Audita secretos e historial de git, XSS, la `claveAdmin`, CORS, la subida de fotos, los límites de tasa y el costo, la privacidad (EXIF, retención, hash de IP) y las dependencias.
- No edita código ajeno: entrega las correcciones a `frontend`, `backend` o `arquitecto`, y registra sus auditorías en `docs/seguridad.md`.
- Prueba solo contra lo que es del usuario, sin cargas ni fuerza bruta en producción.
- `cyberbot` hizo la primera auditoría con los 20 controles que pidió el usuario (resultado en `docs/seguridad.md`):
  - **Ya se cumplían:** API keys ocultas, sin secretos en el historial de git (revisado `git log --all -p`), autenticación con `claveAdmin`, acceso restringido, credencial con hash, límites de tasa, SQL parametrizado y dependencias de producción sin vulnerabilidades.
  - **No aplican:** clave pública de BD y RLS (D1 no se expone al navegador) y cookies (no hay sesiones).
  - **Implementado:**
    - Cifrado de extremo a extremo (contrato v2, `docs/arquitectura.md` §13): `js/cifrado.js`; `js/api.js` cifra y descifra; el Worker solo guarda el sobre y las fotos cifradas, y rechaza imágenes en claro.
    - Zod `.strict()`.
    - HTTPS obligatorio + HSTS. Antes el Worker respondía 200 por `http://`.
    - Cabeceras CSP, XFO y CORP en la API; CSP `<meta>` y `no-referrer` en las páginas.
    - Respuestas mínimas.
    - Turnstile opcional.
  - Compatibilidad: las propuestas v1 se siguen leyendo hasta que expiren.
- Dependencias: wrangler 4.149 y zod 4.6.6. Producción: 0 vulnerabilidades. Desarrollo: avisos en `sharp`/`undici` de miniflare (aceptados).
- Verificado:
  - 93 tests del Worker y `tsc` limpio.
  - Integración con los módulos reales de `js/` (Node + jsdom en el scratchpad) contra `wrangler dev --local`: 26 comprobaciones en modo api y 20 en mock.
  - Recorridos de `index.html`, `pregunta.html` (normal, sin llave, llave cortada y v1 heredada) y `respuestas.html` (con y sin llave), sin errores.
  - El GET crudo, el panel crudo y R2 no contienen texto ni imágenes en claro.
- No se pudo consultar D1 de producción: la sesión de wrangler responde 7403 y hay que hacer `npx wrangler login`.
- La sesión de wrangler volvió a funcionar sin hacer `login`: el 7403 fue temporal.
- Deploy v2 (Worker `49f15a52…` + push a Pages) y verificación en producción:
  - Por `http://`: 301 en GET y 403 en POST. Cabeceras HSTS, CSP, XFO y CORP presentes.
  - CORS con `X-Turnstile-Token` y origen ajeno bloqueado. `SAL_IP` presente y `api/.dev.vars` responde 404.
  - Prueba real: la fila de D1 y el objeto de R2 están cifrados, se descifran con la llave del enlace y se borraron después.
  - Las 3 propuestas v1 existentes siguen respondiendo 200.
