# Contrato de arquitectura e integración — Noviazgo v1

> **Dueño:** agente `arquitecto`. Versión del contrato: **2.2** (2026-10-18). Historial: 1.1 (2026-10-07, revisión de integración, §12), 2 (2026-10-11, cifrado de extremo a extremo, §13), 2.1 (2026-10-18, límites de tasa endurecidos y CORS sin localhost en producción, §14; no cambia el contrato HTTP), 2.2 (2026-10-18, boleto de subida tras Turnstile, 3 fotos por propuesta y 3 por IP al día, §15; **sí** cambia el contrato HTTP; implementación B7 + F7 revisada y desviaciones aceptadas en §15.12). Si §15 contradice una sección anterior, manda §15.
> Este documento es el acuerdo entre los agentes `frontend` y `backend`, que trabajan en paralelo.
> Ninguno de los dos lo modifica por su cuenta: si algo no se puede cumplir, se propone el cambio al arquitecto,
> se actualiza aquí y se registra en `CLAUDE.md`.

---

## 0. Resumen en una pantalla

| Tema | Decisión |
|------|----------|
| Frontend | Igual que antes: HTML + CSS + JS puro (ES Modules), sin build, en **GitHub Pages** (raíz del repo). |
| Backend | **Un solo Cloudflare Worker** (`api/`) con **Hono + Zod**, base de datos **D1** y fotos en **R2**. Plan gratuito ($0). |
| Fotos | Se comprimen en el navegador (WebP o JPEG, máx. 1280 px, ≤ 500 KB) y se suben al Worker, que las guarda en R2. Expiran con la propuesta. v2.2: máximo 3 por propuesta y 3 por IP al día, con un boleto de subida obtenido tras Turnstile (§15). |
| Dónde vive la propuesta | En D1. El enlace es corto: `pregunta.html?id=<id>` (12 caracteres). Se elimina el formato `?d=` (aún no había enlaces publicados). |
| Respuesta para quien envía | Los eventos se guardan en D1 (persisten 30 días, sin el límite de 12 h). `respuestas.html` los consulta por **sondeo cada 5 s**, autenticado con una **clave de administración secreta** (sin registro). |
| Registro | **Nadie se registra en v1.** Quien recibe nunca ve un muro de registro. Quien envía queda identificado por su clave secreta (un "enlace capacidad"). El login con Google queda para una fase futura y opcional, solo para quien envía. |
| ntfy.sh | Pasa a ser **opcional y del lado del servidor**: si quien envía activa "avisos push", el Worker reenvía los eventos importantes a un tema secreto de ntfy. El navegador ya no habla con ntfy. |
| Desarrollo sin backend | `js/api.js` tiene un **modo `mock`** (localStorage) con la misma interfaz que el modo `api`. La URL base vive solo en `js/config.js`. |

---

## 1. Decisiones y su justificación

### D1. Fotos: Cloudflare Worker + R2 (elegida)

Opciones evaluadas:

| Opción | A favor | En contra | Veredicto |
|--------|---------|-----------|-----------|
| **Worker + R2** | 10 GB y egreso gratis; el Worker valida tipo, tamaño y cuota antes de guardar; la misma pieza sirve para propuestas y respuestas; expiración por cron + regla de ciclo de vida de R2. | R2 pide registrar un método de pago para activarse (es verificación; con el uso de esta app el costo es $0). | **Elegida** |
| Supabase Storage (clave anon + RLS) | Auth con Google incluida; panel cómodo. | Subida anónima con la clave pública = cualquiera puede llenar el bucket (RLS no limita tamaño por IP ni tasa); el proyecto gratuito **se pausa tras 1 semana sin actividad** (los enlaces dejarían de funcionar); 1 GB de almacenamiento. | Descartada |
| Hosts de terceros (Imgur, ImgBB, Cloudinary sin firmar) | Nada que desplegar. | La clave de API quedaría expuesta en el JS; términos de uso y retención ajenos; no podemos borrar al expirar; algunos bloquean el hotlinking. | Descartada |
| Fotos en D1 como BLOB | Evita activar R2. | D1 gratis = 500 MB por base; mezcla datos y binarios; cada imagen cuesta lecturas de fila. | Solo como plan B si el usuario se niega a registrar el método de pago (ver §11). |

Reglas de las fotos (las cumplen los dos lados):

- **Compresión en el navegador** (`js/fotos.js`): `createImageBitmap` → `<canvas>` con lado mayor ≤ **1280 px** → `canvas.toBlob('image/webp', 0.8)`.
  - **Safari no codifica WebP en canvas** y devuelve PNG en silencio: si `blob.type !== 'image/webp'`, se reintenta con `'image/jpeg', 0.82`.
  - Si el resultado sigue pesando más de 500 KB, se baja la calidad (0.7, 0.6) y después el ancho (1024 px).
  - Volver a codificar **elimina los metadatos EXIF** (incluida la ubicación GPS). Es obligatorio: nunca se sube el archivo original.
  - HEIC: en iOS el navegador lo decodifica y se convierte; en navegadores que no puedan decodificarlo se muestra "Formato no compatible, prueba con JPG o PNG".
- **Validación en el servidor:** solo `image/webp` o `image/jpeg`, comprobando los **bytes mágicos** (`RIFF....WEBP` / `FF D8 FF`), no solo la cabecera `Content-Type`. Máximo 500 KB.
- **Abuso:** boleto de subida emitido tras Turnstile (v2.2, §15), como máximo 3 fotos por IP al día (§5.5), tope global diario de subidas, fotos huérfanas (no asociadas a una propuesta) borradas a las 24 h y tope de **3 fotos por propuesta** (v2.2; era 10).
- **Expiración:** las fotos se borran junto con la propuesta (30 días). Respaldo: regla de ciclo de vida en el bucket que borra `fotos/` a los 35 días.
- **Degradación:** las fotos son opcionales. Sin fotos, el paso muestra solo el texto con la decoración de la plantilla. Si una foto no carga (`error` en `<img>`), se oculta su contenedor y el paso sigue funcionando. Si la subida falla en el generador, se avisa y se puede continuar sin esa foto.

### D2. La propuesta vive en el backend con un ID corto

- Con varios pasos de texto, opciones de celebración y fotos, los datos ya no caben bien en la URL: un enlace de 2 KB o más se corta o se ve feo en WhatsApp, y las fotos tienen que vivir en algún servidor de todas formas.
- Enlace para la pareja: `pregunta.html?id=<id>`, donde `id` son 12 caracteres base62 aleatorios (≈ 71 bits, no adivinable).
- **Se elimina `?d=` y `js/url-datos.js`.** No hay enlaces publicados todavía, así que no se rompe nada. Mantener dos formatos duplicaría las pruebas sin ningún beneficio real.
- Consecuencia aceptada: `pregunta.html` depende de que el Worker responda. Workers tiene una disponibilidad muy alta, y si falla se muestra una pantalla amable de "No pudimos cargar tu sorpresa, inténtalo en un momento" con botón **Reintentar**.

### D3. La respuesta se guarda en D1, sin registro; ntfy es opcional

- Ya que existe un backend para las fotos, guardar ahí los eventos no cuesta infraestructura extra y elimina el límite de 12 h de ntfy.sh.
- **Sin registro:** al crear la propuesta, el Worker devuelve una `claveAdmin` (32 caracteres aleatorios) y guarda solo su hash SHA-256. Quien envía recibe el enlace privado `respuestas.html?id=<id>#k=<claveAdmin>`.
  - La clave va en el **fragmento (`#`)**: el navegador no la envía a GitHub Pages ni la pone en el `Referer`.
  - El generador también guarda `{ id, claveAdmin, para, creadaEn }` en `localStorage` (`noviazgo:mis-propuestas`) para mostrar "Mis propuestas" en esa misma PC.
- **Quien recibe nunca se registra.** Un muro de registro arruinaría la sorpresa y nadie lo completaría desde WhatsApp.
- **Tiempo real por sondeo** (`GET .../eventos?desde=<cursor>` cada 5 s mientras la pestaña está visible). SSE en Workers exige mantener conexiones abiertas o usar Durable Objects; para un panel que abre una sola persona, el sondeo es más simple y suficiente.
- **ntfy.sh, opcional:** si se marca "Recibir notificación en el celular", el Worker genera un tema secreto (≥ 24 caracteres) y, con `ctx.waitUntil`, publica `abierto`, `si` y `celebracion_elegida` (no `intento_no`, para no saturar). Si ntfy falla, no afecta en nada.
- **Login con Google:** fase futura y opcional, solo para quien envía (historial en varios dispositivos). La columna `usuario_id` ya queda prevista en el esquema. Para activarlo, primero habrá que servir el frontend y la API desde el mismo sitio (Workers Assets o un dominio propio), porque una cookie de sesión de `workers.dev` es de terceros vista desde `github.io` y los navegadores la bloquean.

### D4. Stack del Worker

- **Hono** (router mínimo, ~14 KB) + **Zod** (validación declarativa del modelo de §3). Se justifican porque reemplazan cientos de líneas propias de enrutamiento, CORS y validación.
- **Sin ORM:** son 4 tablas, así que se usa `env.DB.prepare(...).bind(...)` (consultas parametrizadas) y migraciones SQL con `wrangler d1 migrations`. Drizzle no aporta lo suficiente a este tamaño.
- TypeScript compilado por Wrangler (esbuild). El **frontend sigue sin paso de build**: el `package.json` vive solo dentro de `api/`.
- Pruebas: Vitest con `@cloudflare/vitest-pool-workers`.

---

## 2. Flujo de pantallas

### 2.1 `index.html` — Generador

1. **Datos básicos:** tu nombre (`de`), su nombre (`para`) y el tipo (`novia`, `novio`, `esposa`, `esposo`, `cita`, `otro`). Con `otro` se escribe la pregunta libre.
2. **Plantilla:** galería con vista previa (`role="radiogroup"`).
3. **Pasos (1 a 5):** cada paso tiene un texto ("palabras bonitas") y fotos: **como máximo 3 en total por propuesta** (v2.2), repartidas como se quiera entre los pasos. Se pueden agregar, quitar y reordenar con botones (sin arrastrar, por accesibilidad). Las fotos se comprimen y se suben **en cuanto se eligen**, con una barra de progreso, para que al final solo se cree la propuesta. Antes de la primera subida se pide un boleto de subida (Turnstile, §15.6). El editor muestra "Fotos: n de 3" y avisa al llegar al límite.
4. **Pregunta:** se rellena sola según el tipo ("¿Quieres ser mi novia?") y se puede editar.
5. **Celebración:** casillas con las opciones predefinidas de `js/celebraciones.js` (La BTK, Un helado, Paseo en el parque, El cine, Cenar juntos, Picnic) y "Agregar opción personalizada" (texto + emoji opcional). Con 0 opciones se omite la pantalla de elección.
6. **Avisos push (opcional):** casilla "Notificarme en el celular con ntfy".
7. **Vista previa:** abre `pregunta.html?preview=1` en otra pestaña. La propuesta se lee de `sessionStorage` (`noviazgo:preview`), se marca como vista previa y **no envía eventos**.
8. **Crear enlace** → `api.crearPropuesta()` → se muestran:
   - El enlace para la pareja, con los botones **Copiar** y **Compartir** (`navigator.share`).
   - El enlace privado de seguimiento, con un aviso claro: "No lo compartas: con él se ven las respuestas".
   - El tema de ntfy, si se activó, con el enlace `https://ntfy.sh/<tema>` y una indicación para suscribirse en la app.
9. **Mis propuestas** (desde `localStorage`): una lista con enlaces a sus paneles de respuestas.

Todos los enlaces se construyen con `new URL('pregunta.html', location.href)`, que es una ruta relativa y funciona bajo `/<repo>/`.

### 2.2 `pregunta.html` — Lo que vive la pareja

Es una sola página con una máquina de estados (`js/pregunta.js`). Cada pantalla es un `<section>` y solo una está visible a la vez. Al cambiar de pantalla, el foco se mueve al encabezado de la nueva y se anuncia con `aria-live`.

```
cargando ──error──▶ error (Reintentar)
   │
   ▼
paso[0] ─Siguiente▶ paso[1] … ─Siguiente▶ pregunta (Sí / No que huye)
   ▲  ◀─Atrás──┘                               │ Sí
                                               ▼
                         ┌─ hay opciones ─▶ celebracion (elegir lugar + nota opcional) ─Enviar▶ final
                         └─ 0 opciones ───────────────────────────────────────────────────────▶ final
```

- **cargando:** `api.obtenerPropuesta(id)`. Si falta el `id` o la respuesta es 404 o 410, se muestra "Este enlace no existe o ya expiró".
- **paso[i]:** el texto con `textContent` y las fotos con `loading="lazy"`, `decoding="async"` y `alt` (el que escribió quien envía, o "Foto de un recuerdo" si no hay). Se precargan las fotos del siguiente paso.
- **pregunta:** el botón "No" huye según las reglas de `arquitecto.md`. El "Sí" crece. Los intentos se agrupan para los eventos.
- **celebracion:** un `<fieldset>` con `role="radiogroup"` y un `<textarea>` "¿Algo más?" opcional (≤ 140 caracteres). Hasta que no se elige una opción, el botón **Enviar** se queda deshabilitado.
- **final:** el mensaje de la plantilla, el efecto de partículas (sin partículas si `prefers-reduced-motion`) y "Le avisamos a <de>". La respuesta queda guardada en `localStorage` (`noviazgo:respondida:<id>`): si se vuelve a abrir el enlace, se va directo a **final** con un botón "Ver de nuevo".

### 2.3 `respuestas.html` — Panel de quien envía

- Lee `id` de la query y `k` del fragmento. Si falta alguno, muestra cómo recuperar el enlace desde "Mis propuestas".
- Sondeo: `api.obtenerEventos(id, k, cursor)` cada **5 s** con la pestaña visible; se pausa con `visibilitychange` oculto y se reanuda al volver. Ante errores de red espera 5 → 10 → 20 → 60 s. Con `401` se detiene y muestra "Clave inválida".
- **Sondeo adaptativo** (v1.1): pasa a **15 s** tras 10 min sin eventos nuevos y a **60 s** cuando ya hay celebración elegida. Al volver a la pestaña consulta de inmediato y vuelve a 5 s. Motivo: un panel abierto todo el día a 5 s son ~17 000 solicitudes y ~17 000 escrituras de D1 (límite de tasa) al día, el 17 % de la cuota gratuita.
- Muestra el **resumen** arriba (Abierto ✓, Intentos de "No": n, Dijo que Sí a las hh:mm y Eligió "La BTK" + su nota) y una **línea de tiempo** debajo. Todo con `textContent`.
- Incluye un botón **Borrar propuesta** (con confirmación), que llama a `DELETE`.
- Lleva `<meta name="referrer" content="no-referrer">` y `<meta name="robots" content="noindex">`.

---

## 3. Modelo de datos de la propuesta (v1)

> **v2 (2026-10-11):** el contenido de §3.1 ya no viaja en claro. El navegador lo valida con estas mismas reglas, lo cifra (AES-GCM 256) y solo manda el sobre `{ v: 2, cifrado, fotos, avisos }`. El modelo de abajo sigue siendo el **contenido** (sin `v` ni `avisos`) que se cifra. Ver §13.

### 3.1 Lo que envía el generador (`POST /propuestas`)

```json
{
  "v": 1,
  "plantilla": "romantica",
  "tipo": "novia",
  "de": "Gilberto",
  "para": "Ana",
  "pasos": [
    { "texto": "Desde que te conocí…", "fotos": [ { "id": "f_8Kd93jXq2LmP0aZx", "alt": "Nuestra primera cita" } ] },
    { "texto": "Cada día contigo…", "fotos": [] }
  ],
  "pregunta": "¿Quieres ser mi novia?",
  "celebracion": {
    "titulo": "¿Dónde lo celebramos?",
    "opciones": [
      { "id": "btk",    "etiqueta": "La BTK",            "emoji": "🍔" },
      { "id": "helado", "etiqueta": "Un helado",         "emoji": "🍦" },
      { "id": "c1",     "etiqueta": "Karaoke en el centro", "emoji": "🎤" }
    ]
  },
  "mensajeFinal": "¡Sabía que dirías que sí!",
  "avisos": { "push": false }
}
```

### 3.2 Lo que devuelve `GET /propuestas/:id` (público)

Es igual, pero sin `avisos`. Además, cada foto se resuelve en una URL y se agregan `id`, `creadaEn` y `expiraEn`:

```json
{
  "v": 1, "id": "aB3dE5fG7hJ9", "plantilla": "romantica", "tipo": "novia",
  "de": "Gilberto", "para": "Ana",
  "pasos": [ { "texto": "…", "fotos": [ { "id": "f_8Kd93jXq2LmP0aZx", "url": "https://noviazgo-api.<sub>.workers.dev/api/v1/fotos/f_8Kd93jXq2LmP0aZx", "alt": "Nuestra primera cita" } ] } ],
  "pregunta": "¿Quieres ser mi novia?",
  "celebracion": { "titulo": "…", "opciones": [ … ] },
  "mensajeFinal": "…",
  "creadaEn": "2026-10-07T18:00:00.000Z",
  "expiraEn": "2026-11-06T18:00:00.000Z"
}
```

### 3.3 Límites (fuente única: `js/limites.js`)

`js/limites.js` es un módulo ES sin dependencias. El frontend lo importa directamente y el Worker lo importa con `import { LIMITES } from '../../js/limites.js'`. Si eso diera problemas al empaquetar, el backend lo copia y agrega un test que compara ambas copias.

| Campo | Regla |
|-------|-------|
| `v` | Exactamente `1` |
| `plantilla` | `^[a-z0-9-]{1,30}$`. El servidor **no** valida contra el catálogo: si el id no existe, el frontend usa la plantilla por defecto (`romantica`). |
| `tipo` | `novia` · `novio` · `esposa` · `esposo` · `cita` · `otro` |
| `de`, `para` | 1–40 caracteres tras `trim()` |
| `pasos` | 1–5 elementos |
| `pasos[].texto` | 1–280 caracteres |
| `pasos[].fotos` | 0–3 elementos; **≤ 3 fotos en total** por propuesta (v2.2; era 10). Solo al crear: al leer una propuesta anterior con más fotos no se recorta el total |
| `fotos[].id` | `^f_[A-Za-z0-9]{16}$`; debe existir, no estar asociada a otra propuesta y no estar expirada |
| `fotos[].alt` | 0–100 caracteres |
| `pregunta` | 1–120 caracteres |
| `celebracion` | Opcional. `titulo` 1–60 caracteres; `opciones` 0–8 elementos |
| `opciones[].id` | `^[a-z0-9-]{1,20}$`, único dentro de la propuesta. Las predefinidas usan su slug; las personalizadas, `c1`…`c8`. |
| `opciones[].etiqueta` | 1–40 caracteres |
| `opciones[].emoji` | Opcional, 0–8 caracteres |
| `mensajeFinal` | 0–200 caracteres |
| Cuerpo JSON completo | ≤ 32 KB (v2; era 16 KB) |
| Foto | Se comprime a `image/webp` o `image/jpeg`, ≤ 500 KB (512 000 bytes), lado mayor ≤ 1280 px. **v2:** se sube cifrada como `application/octet-stream`, ≤ 512 029 bytes (`fotoCifradaBytes`) |
| Vida de la propuesta | 30 días desde su creación (`DIAS_EXPIRACION = 30`) |
| Foto huérfana | Se borra a las 24 h |
| Eventos por propuesta | ≤ 300 en total; `si` 1 (los siguientes se ignoran); `celebracion_elegida` ≤ 10 |
| `nota` | 0–140 caracteres |

**Cómo se cuentan los caracteres (v1.1):** en **code points** en ambos lados. El frontend usa `largo()` de `js/utilidades.js` (`[...texto].length`) y el Worker usa Zod ≥ 4.6, que en `.min/.max` de strings cuenta code points (lo fija un test en `api/test/propuestas.test.ts`: 280 emojis se aceptan y 281 no). El atributo HTML `maxlength` cuenta unidades UTF-16, así que en el navegador puede ser más estricto con emojis; eso es aceptable porque nunca deja enviar algo que el servidor rechace.

Además, **una misma foto no puede aparecer dos veces** en la propuesta (422 `validacion`, también en `js/validacion.js` y en el mock).

Todos los textos se normalizan con `trim()` y se rechazan los caracteres de control (salvo `\n` en `texto`, `mensajeFinal` y `nota`). El Worker convierte `\r\n` en `\n` antes de validar; el frontend, además, convierte un `\r` suelto. El frontend **siempre** los pinta con `textContent`. En `texto` los saltos de línea se respetan con CSS (`white-space: pre-line`), nunca con `<br>` generado.

---

## 4. Eventos de respuesta

Los envía `pregunta.html` (módulo `js/eventos.js`) a través de `api.enviarEvento()`. **Dispara y olvida:** nunca se usa `await` en la interfaz, no se lanzan excepciones y no se envían en modo vista previa.

Campos comunes del cuerpo: `tipo` y `sesion`, un ID aleatorio de 16 caracteres generado al cargar la página, que permite distinguir aperturas. **La hora la pone el servidor** (`creadoEn`); no se confía en el reloj del cliente.

| `tipo` | Cuándo | Payload adicional | `keepalive` | Push ntfy |
|--------|--------|-------------------|-------------|-----------|
| `abierto` | Una vez por carga de la página, después de obtener la propuesta | — | no | sí: "Ana abrió tu enlace" |
| `intento_no` | Agrupado: como máximo uno cada **3 s** con los intentos acumulados desde el último envío, más un envío final en `pagehide` | `conteo` (entero 1–1000) | sí en `pagehide` | no |
| `si` | Al pulsar Sí | — | **sí** | sí: "¡Ana dijo que SÍ! 💖" |
| `celebracion_elegida` | Al enviar el formulario de celebración | v2: `cifrado` (opción + nota cifradas). v1: `opcionId` (debe existir en la propuesta), `nota` (opcional) | **sí** | v2: "Ya eligió dónde celebrar 🎉" (sin nombre ni opción). v1: "Ana eligió celebrar en: La BTK" |

Ejemplo de cuerpo:

```json
{ "tipo": "celebracion_elegida", "sesion": "Qw8e7r6t5y4u3i2o", "opcionId": "btk", "nota": "¡Pero tú invitas!" }
```

**Sin preflight de CORS:** los eventos se envían con `Content-Type: text/plain;charset=UTF-8` (con el JSON en el cuerpo) y sin cabeceras personalizadas. Así es una *simple request*: no hay `OPTIONS`, llega más rápido y `keepalive` funciona en todos los navegadores, ya que algunos no permitían preflight con `keepalive`. El Worker parsea el cuerpo como JSON sin importar el `Content-Type`.

---

## 5. Contrato de la API (Worker)

> **v2 (2026-10-11):** fotos, propuestas, eventos de celebración y panel cambian por el cifrado de extremo a extremo; además hay HTTPS obligatorio, cabeceras nuevas y Turnstile opcional. Lo que diga §13 manda sobre esta sección.
> **v2.2 (2026-10-18):** nuevo `POST /boletos`; `POST /fotos` exige `X-Boleto`; `POST /propuestas` acepta `X-Boleto` en lugar del token de Turnstile; códigos `boleto_*`. Lo que diga §15 manda sobre esta sección y sobre §13.

- **Base:** `https://noviazgo-api.<subdominio>.workers.dev/api/v1`. En desarrollo: `http://localhost:8787/api/v1` (`wrangler dev`).
- **Formato:** JSON en UTF-8, salvo la subida de fotos (binario) y la descarga de fotos.
- **Errores:** siempre `{ "error": { "codigo": "<codigo>", "mensaje": "<texto en español para mostrar>" } }`.

### 5.1 Endpoints

| Método y ruta | Auth | Request | Respuesta OK |
|---------------|------|---------|--------------|
| `GET /salud` | — | — | `200 { "ok": true, "version": 2 }` |
| `POST /boletos` (v2.2) | Turnstile (si está activo) | Sin cuerpo; cabecera `X-Turnstile-Token` | `201 { "boleto": "b1.…", "expiraEn": "<ISO, +60 min>", "fotos": 3 }` (§15.1) |
| `POST /fotos` | **Boleto** (v2.2, `X-Boleto`) | Cuerpo binario; v2: `application/octet-stream` cifrado (§13.2) | `201 { "id": "f_…", "url": "…/fotos/f_…", "expiraEn": "<ISO, +24 h mientras sea huérfana>" }` |
| `GET /fotos/:id` | — | — | `200` con la imagen. Cabeceras: `Content-Type` guardado, `Cache-Control: private, max-age=86400` (v1.1: sin cachés compartidas), `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin` |
| `POST /propuestas` | Turnstile o boleto (si Turnstile está activo; v2.2, §15.4) | JSON de §3.1 (v2: sobre de §13.2) | `201 { "id": "aB3dE5fG7hJ9", "claveAdmin": "<32 caracteres>", "expiraEn": "<ISO>", "ntfyTema": "<tema>" \| null }` |
| `GET /propuestas/:id` | — | — | `200` con el JSON de §3.2. `Cache-Control: no-store` |
| `DELETE /propuestas/:id` | Admin | — | `204` (borra la propuesta, sus fotos en R2 y sus eventos). Funciona aunque la propuesta ya haya expirado y el cron aún no la borre. |
| `POST /propuestas/:id/eventos` | — | JSON de §4 (cuerpo `text/plain` o `application/json`) | `202 { "ok": true }`; si es un `si` repetido: `200 { "ok": true, "duplicado": true }` |
| `GET /propuestas/:id/eventos?desde=<cursor>` | Admin | `desde` opcional (entero; `0` o ausente = todo) | `200` (ver §5.2) |

**Auth admin:** cabecera `Authorization: Bearer <claveAdmin>`. El Worker calcula `SHA-256(claveAdmin)` y lo compara en tiempo constante con `clave_hash`. Responde `404 no_encontrado` si la propuesta no existe y `401 no_autorizado` si existe pero la clave falta o es incorrecta (los IDs no son adivinables, así que distinguir ambos casos no filtra nada útil).

### 5.2 Respuesta de `GET /propuestas/:id/eventos`

```json
{
  "eventos": [
    { "id": 41, "tipo": "abierto", "sesion": "Qw8e…", "creadoEn": "2026-10-07T19:02:11.000Z" },
    { "id": 42, "tipo": "intento_no", "conteo": 4, "sesion": "Qw8e…", "creadoEn": "…" },
    { "id": 43, "tipo": "si", "sesion": "Qw8e…", "creadoEn": "…" },
    { "id": 44, "tipo": "celebracion_elegida", "opcionId": "btk", "etiqueta": "La BTK", "nota": "¡Pero tú invitas!", "sesion": "Qw8e…", "creadoEn": "…" }
  ],
  "cursor": 44,
  "resumen": {
    "abierto": true, "vecesAbierto": 2, "primeraApertura": "…",
    "intentosNo": 4,
    "si": true, "siEn": "…",
    "celebracion": { "opcionId": "btk", "etiqueta": "La BTK", "nota": "¡Pero tú invitas!", "en": "…" }
  },
  "para": "Ana",
  "expiraEn": "…",
  "ntfyTema": null
}
```

- `eventos` contiene solo los que tienen `id > desde`, en orden ascendente y con un máximo de 100 por respuesta. Si hay más, el cliente repite la consulta con el nuevo `cursor`.
- `resumen` siempre se calcula sobre **todos** los eventos (la última `celebracion_elegida` es la que cuenta), así el panel no tiene que acumular nada.
- `etiqueta` se resuelve en el servidor a partir de la propuesta guardada.
- `nota` es `null` (no `""`) cuando la persona no escribió nada, tanto en `eventos` como en `resumen.celebracion`. El mock hace lo mismo.

### 5.3 Códigos de error

| HTTP | `codigo` | Cuándo |
|------|----------|--------|
| 400 | `json_invalido` | El cuerpo no es JSON válido |
| 401 | `no_autorizado` | Falta la clave admin o es incorrecta |
| 404 | `no_encontrado` | Propuesta o foto inexistente |
| 410 | `expirada` | La propuesta existe pero ya expiró (antes de que el cron la borre) |
| 409 | `limite_eventos` | Se alcanzó el tope de eventos de la propuesta |
| 413 | `archivo_muy_grande` | Foto cifrada > 512 029 bytes o JSON > 32 KB |
| 415 | `tipo_no_soportado` | v2: la foto no llega como `application/octet-stream` cifrada (versión 1, ≥ 30 bytes) o es una imagen en claro |
| 403 | `verificacion_bot` | v2: Turnstile activo y el token falta o no es válido (`POST /boletos`; `POST /propuestas` sin `X-Boleto`) |
| 401 | `boleto_ausente` | v2.2: `POST /fotos` sin cabecera `X-Boleto` (§15.5) |
| 401 | `boleto_invalido` | v2.2: boleto mal formado, firma incorrecta o versión desconocida |
| 401 | `boleto_vencido` | v2.2: boleto con la firma correcta pero vencido |
| 403 | `boleto_agotado` | v2.2: el boleto ya gastó sus 3 fotos (`POST /fotos`) o su única propuesta (`POST /propuestas`) |
| 403 | `https_requerido` | v2: solicitud no GET por `http://` fuera de localhost |
| 422 | `validacion` | Falla Zod. Se agrega `detalles: [{ "campo": "pasos.0.texto", "mensaje": "…" }]` |
| 422 | `foto_invalida` | Un `fotos[].id` no existe, ya está asociado o expiró |
| 429 | `demasiadas_solicitudes` | Límite de tasa. Incluye la cabecera `Retry-After` (segundos) |
| 503 | `capacidad_agotada` | Se alcanzó el tope global diario de fotos o de propuestas |
| 500 | `interno` | Error inesperado (sin detalles internos) |

### 5.4 CORS

- La variable `ORIGENES_PERMITIDOS` (en `wrangler.jsonc`) contiene una lista separada por comas, p. ej. `https://<usuario>.github.io`.
- **v2.1:** `^http://(localhost|127\.0\.0\.1)(:\d+)?$` solo se acepta si la variable `PERMITIR_LOCALHOST="1"` está definida, y eso ocurre **únicamente en `api/.dev.vars`** (desarrollo con `wrangler dev`; ya viene en `.dev.vars.example`). En producción no se define, ni en `wrangler.jsonc` ni como secreto, así que el Worker desplegado solo acepta `ORIGENES_PERMITIDOS`. Consecuencia: ya no se puede usar la API de producción desde un frontend en localhost; para probar en local se usa `wrangler dev` o el modo mock. (Antes de la 2.1, localhost se aceptaba siempre; auditoría 2026-10-18, H3.)
- Respuesta: `Access-Control-Allow-Origin: <origen exacto>` + `Vary: Origin`. Métodos: `GET, POST, DELETE, OPTIONS`. Cabeceras permitidas: `Content-Type, Authorization`. `Access-Control-Max-Age: 86400`. **Nunca** `Allow-Credentials`.
- Un origen no permitido recibe la respuesta sin cabeceras CORS, y el navegador la bloquea.
- v2: `GET /fotos/:id` **sí** usa CORS: el frontend la descarga con `fetch`, la descifra y la muestra como `blob:`. Todas las respuestas llevan `Cross-Origin-Resource-Policy: same-origin`, así que otros sitios no pueden incrustarlas.
- v2: cabeceras permitidas `Content-Type, Authorization, X-Turnstile-Token`.
- **v2.2:** cabeceras permitidas `Content-Type, Authorization, X-Turnstile-Token, X-Boleto` (en ese orden; lo fija un test). No hace falta `Access-Control-Expose-Headers`: el boleto viaja en el cuerpo JSON.

### 5.5 Límites de tasa y cuotas

Se cuentan por **hash de IP** (`SHA-256(SAL_IP + IP normalizada)`; la IP en claro nunca se guarda), con ventana fija en la tabla `limites` de D1. **Normalización (v2.1):** la IP sale de `CF-Connecting-IP`; las IPv4 se usan tal cual, las IPv4 mapeadas en IPv6 (`::ffff:a.b.c.d`) cuentan como su IPv4 y las IPv6 se agrupan por su prefijo **/64** (un cliente suele controlar un /64 entero). Un valor que no se pueda interpretar se usa tal cual, sin agruparlo con nadie.

| Acción | Límite |
|--------|--------|
| `POST /boletos` (v2.2) | 10 por hora y 20 por día por IP (429). Sin tope global (no guarda nada) |
| `POST /fotos` | **v2.2: 3 fotos aceptadas por día** por IP (429), sin regla horaria; 3 por boleto (403 `boleto_agotado`); **500 por día en total** (tope global → 503). Antes: 30/h y 60/día |
| `POST /propuestas` | 10 por hora y **20 por día** por IP (429); 1 por boleto (v2.2); 300 por día en total (503) |
| `POST /eventos` | 60 por minuto por IP (además del tope por propuesta) |
| `GET /propuestas/:id/eventos` | 30 por minuto por IP (con 5 s de sondeo se usan 12) |
| `GET /propuestas/:id` | 120 por minuto por IP |

Los topes globales protegen el plan gratuito de Cloudflare (R2: 10 GB, 1 M operaciones de escritura al mes; D1: 100 k escrituras al día; Workers: 100 k solicitudes al día).

**v2.2:** el orden de `POST /fotos`, `POST /propuestas` y `POST /boletos` y el costo vigentes están en §15.3–§15.5 y §15.10; los dos párrafos siguientes describen la 2.1. Además, **todos** los contadores pasan a incremento condicional (§15.3): una solicitud que ya está por encima del límite no escribe en D1.

**Orden de comprobación en `POST /fotos` y `POST /propuestas` (v2.1):** límite por IP, horario y diario (429) → Turnstile (solo propuestas, 403) → validación de tipo, tamaño, esquema y fotos (415/413/422) → tope global (503). El tope global solo lo gastan las solicitudes válidas, para que nadie pueda agotarlo con solicitudes sin token o con basura (auditoría 2026-10-18, H1/H2). El límite por IP va primero para que nadie haga que el Worker llame a siteverify sin freno; las solicitudes rechazadas sí gastan el cupo de su propia IP.

**Dónde viven los valores:** los límites de tasa son exclusivos del Worker (`REGLAS_IP`, `REGLAS_IP_DIARIAS` y `TOPES_GLOBALES` en `api/src/limite-tasa.ts`); esta tabla es su referencia. No van a `js/limites.js` porque el frontend no los usa (solo reacciona al 429/503) y `js/limites.js` es para reglas que ambos lados validan.

**Costo en escrituras (v2.1):** cada solicitud limitada hace 1 escritura en D1. `POST /fotos` y `POST /propuestas` hacen hasta 3 (límite horario, diario y tope global) cuando tienen éxito, y 2 cuando se rechazan después del límite por IP. Las solicitudes exitosas de estas dos rutas quedan acotadas por los topes globales: (500 + 300) × 3 ≈ 2 400 escrituras de límite al día, el 2,4 % de la cuota gratuita de D1. Las rechazadas dependen de cuántas IP use quien abuse (cada IP gasta como máximo su cupo horario/diario). El sondeo adaptativo de §2.3 lo reduce. Mejora pendiente (B6): mover los límites por IP de alta frecuencia (`eventos`, `panel`, `leer`) al binding `ratelimits` de Workers (ventanas de 10 o 60 s, sin escrituras en D1) y dejar en D1 solo `fotos` y `propuestas` (ventanas de 1 h y topes globales). Antes hay que confirmar que el binding está disponible en el plan gratuito de la cuenta.

### 5.6 Expiración y limpieza

- Un **Cron Trigger** diario (`0 4 * * *`):
  - Borra las propuestas con `expira_en < ahora`, junto con sus eventos y sus fotos (en D1 y R2).
  - Borra las fotos huérfanas de más de 24 h.
  - Borra las filas viejas de `limites`.
- Regla de ciclo de vida en R2: borrar el prefijo `fotos/` a los 35 días (respaldo por si falla el cron).
- `GET` de una propuesta expirada que aún no se borró → `410`.

### 5.7 Esquema D1 (`api/migrations/0001_inicial.sql`)

```sql
CREATE TABLE propuestas (
  id          TEXT PRIMARY KEY,           -- 12 base62
  clave_hash  TEXT NOT NULL,              -- SHA-256 hex de claveAdmin
  datos       TEXT NOT NULL,              -- JSON validado de §3.1 (sin avisos)
  ntfy_tema   TEXT,                       -- NULL si no hay push
  usuario_id  TEXT,                       -- futuro (login Google); NULL en v1
  creada_en   INTEGER NOT NULL,           -- epoch ms
  expira_en   INTEGER NOT NULL
);
CREATE INDEX idx_propuestas_expira ON propuestas(expira_en);

CREATE TABLE fotos (
  id            TEXT PRIMARY KEY,         -- f_ + 16 base62
  propuesta_id  TEXT REFERENCES propuestas(id) ON DELETE CASCADE,
  r2_clave      TEXT NOT NULL,            -- fotos/<id>
  tipo_mime     TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  ip_hash       TEXT NOT NULL,
  creada_en     INTEGER NOT NULL
);
CREATE INDEX idx_fotos_propuesta ON fotos(propuesta_id);
CREATE INDEX idx_fotos_huerfanas ON fotos(creada_en) WHERE propuesta_id IS NULL;

CREATE TABLE eventos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,  -- sirve de cursor
  propuesta_id  TEXT NOT NULL REFERENCES propuestas(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL CHECK (tipo IN ('abierto','intento_no','si','celebracion_elegida')),
  datos         TEXT,                     -- JSON: conteo / opcionId / nota
  sesion        TEXT NOT NULL,
  creado_en     INTEGER NOT NULL
);
CREATE INDEX idx_eventos_propuesta ON eventos(propuesta_id, id);
CREATE UNIQUE INDEX uq_eventos_si ON eventos(propuesta_id) WHERE tipo = 'si';

CREATE TABLE limites (
  clave       TEXT PRIMARY KEY,           -- accion:ip_hash:ventana | accion:global:ventana | boleto:<nonce> | boleto-prop:<nonce> (v2.2)
  conteo      INTEGER NOT NULL,
  expira_en   INTEGER NOT NULL
);
CREATE INDEX idx_limites_expira ON limites(expira_en);   -- v1.1: para el borrado del cron
```

Las fotos se borran de R2 explícitamente: el `ON DELETE CASCADE` solo limpia filas de D1.

### 5.8 Seguridad del Worker

- Cabeceras en todas las respuestas JSON: `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `Cache-Control: no-store` (excepto las fotos).
- IDs y claves con `crypto.getRandomValues` (rechazo de sesgo al mapear a base62).
- Logs sin IP, sin claves y sin textos de la propuesta.
- Secretos: `SAL_IP` con `wrangler secret put`. En local van en `api/.dev.vars`, que está en `.gitignore`; el repo solo incluye `api/.dev.vars.example`.
- Si falta `SAL_IP`, el Worker funciona y solo registra un aviso (para no romper el desarrollo). **En producción es obligatoria:** sin sal, el hash de una IPv4 se puede revertir por fuerza bruta. Se comprueba con `npx wrangler secret list` (§9, paso 6).
- `PERMITIR_LOCALHOST="1"` (v2.1) solo en `api/.dev.vars`: habilita localhost en CORS (§5.4). Nunca en `wrangler.jsonc` ni como secreto de producción.
- Variables en `wrangler.jsonc`: `ORIGENES_PERMITIDOS` y `NTFY_BASE` (v1.1; `https://ntfy.sh` por defecto, vacío = avisos desactivados; los tests lo dejan vacío para no salir a internet). `compatibility_date`: `2026-08-01`.
- Los mensajes genéricos de Zod salen en español (`z.config(es())`).
- **v2:** todos los objetos de Zod son `.strict()` (un campo de más → 422), HTTPS obligatorio, cabeceras `Content-Security-Policy`, `X-Frame-Options`, `Cross-Origin-Resource-Policy` y `Strict-Transport-Security`, y Turnstile opcional con el secreto `TURNSTILE_SECRETO` (§13).
- **v2.2:** la llave HMAC de los boletos se **deriva de `SAL_IP` con HKDF** (§15.2); no hay secreto nuevo. Con Turnstile activo y sin `SAL_IP`, `POST /boletos` responde 500 `interno` (falla cerrada).

---

## 6. Adaptador del frontend: `js/config.js` y `js/api.js`

### 6.1 `js/config.js` (el único lugar con URLs)

```js
const ES_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

export const API_BASE = ES_LOCAL
  ? 'http://localhost:8787/api/v1'
  : 'https://noviazgo-api.TU-SUBDOMINIO.workers.dev/api/v1'; // ← el usuario la pega tras el primer deploy

// 'mock' | 'api'. Prioridad: localStorage['noviazgo:modo'] > reglas por defecto.
// Por defecto: 'mock' en localhost o si API_BASE sigue con el marcador; 'api' en otro caso.
export const MODO = (() => {
  const forzado = localStorage.getItem('noviazgo:modo');
  if (forzado === 'mock' || forzado === 'api') return forzado;
  if (ES_LOCAL || API_BASE.includes('TU-SUBDOMINIO')) return 'mock';
  return 'api';
})();

export const SONDEO_MS = 5000;
```

- **Frontend solo:** `python3 -m http.server 8000`. Arranca en `mock` sin hacer nada.
- **Frontend + backend local:** en la consola, `localStorage.setItem('noviazgo:modo','api')`, y en otra terminal, `cd api && npx wrangler dev`.
- **Producción:** en `*.github.io` el modo es `api` siempre que la URL esté configurada. Si no lo está, cae en `mock` y la página muestra un aviso visible: "Modo demostración: los enlaces solo funcionan en este navegador".

### 6.2 Interfaz de `js/api.js` (idéntica en ambos modos)

> **v2:** la interfaz cambió para recibir la llave de cifrado; la versión vigente está en §13.4, con los cambios de v2.2 en §15.7.

```js
export async function subirFoto(blob, { alProgresar } = {}) // → { id, url, expiraEn }; alProgresar(0..1)
export async function crearPropuesta(propuesta)             // → { id, claveAdmin, expiraEn, ntfyTema }
export async function obtenerPropuesta(id)                  // → propuesta §3.2
export function       enviarEvento(id, evento, { keepalive } = {}) // → void; NUNCA lanza
export async function obtenerEventos(id, claveAdmin, desde) // → respuesta §5.2
export async function borrarPropuesta(id, claveAdmin)       // → void
export class ErrorApi extends Error { codigo; estado; detalles }
```

- Todas las funciones `async` lanzan `ErrorApi` con el `codigo` de §5.3. Los errores de red se reportan como `codigo: 'sin_conexion'` y `estado: 0`.
- Los `fetch` llevan `AbortSignal.timeout(15000)`. **`subirFoto` usa `XMLHttpRequest`** (v1.1) porque `fetch` no informa el progreso de subida; lleva `xhr.timeout = 60000` y el mismo formato de errores.
- `js/api.js` elige la implementación según `MODO` y reexporta la de `js/api-mock.js` o la real.
- **`js/api-mock.js`** reproduce el contrato con `localStorage`:
  - `noviazgo:mock:propuestas`, `noviazgo:mock:fotos` (fotos como data URL) y `noviazgo:mock:eventos`.
  - Aplica los mismos límites de `js/limites.js` y genera los mismos errores (`QuotaExceededError` → `capacidad_agotada`).
  - Simula una latencia de 300 ms.
  - Así, `pregunta.html` en una pestaña y `respuestas.html` en otra **del mismo navegador** funcionan juntas.
- Las URLs de foto recibidas se aceptan solo si empiezan por `API_BASE + '/fotos/'` (o `data:image/webp|jpeg;base64,` en mock). Cualquier otra se descarta antes de asignarla a `img.src` (`urlFotoValida()` en `js/validacion.js`).
- `js/validacion.js` (v1.1) reproduce en el navegador las reglas de §3.3. La usan el generador y el mock, y devuelve `detalles` con el mismo formato que el 422.
- El mock guarda las fotos como data URL en `localStorage`: caben unas 7 antes de llegar a la cuota (≈ 5 MB). Al pasarse responde `503 capacidad_agotada`. Es aceptable porque el mock es solo para desarrollo.
- **Vista previa:** el generador abre `pregunta.html?preview=1` con `window.open` **sin `noopener`**, porque con `noopener` la pestaña nueva no hereda el `sessionStorage` donde está la propuesta. Es seguro: la pestaña abierta es del mismo origen y de este mismo sitio.

---

## 7. Estructura de archivos y propiedad

```
Noviazgo/
├── CLAUDE.md                      [arquitecto]
├── README.md                      [arquitecto]
├── .gitignore                     [arquitecto]  (api/node_modules, api/.dev.vars, api/.wrangler)
├── .nojekyll                      [arquitecto]  (Pages sirve tal cual, sin Jekyll)
├── docs/
│   ├── arquitectura.md            [arquitecto]  ← este contrato
│   └── seguridad.md               [cyberbot]    modelo de amenazas y auditorías
├── .claude/agents/*.md            [arquitecto]
│
├── index.html                     [frontend]  generador
├── pregunta.html                  [frontend]  pasos → pregunta → celebración → final
├── respuestas.html                [frontend]  panel de quien envía
├── css/
│   ├── styles.css                 [frontend]
│   └── plantillas/<id>.css        [frontend]
├── js/
│   ├── config.js                  [frontend]  API_BASE y MODO (la URL de producción la pega el usuario)
│   ├── limites.js                 [arquitecto] límites compartidos (frontend y backend solo lo leen)
│   ├── api.js                     [frontend]  adaptador: elige mock o api; cifra y descifra (v2)
│   ├── cifrado.js                 [frontend]  AES-GCM con WebCrypto, llave en #c= (v2)
│   ├── api-mock.js                [frontend]  implementación con localStorage
│   ├── boleto.js                  [frontend]  v2.2: widget de Turnstile bajo demanda + boleto de subida en memoria (§15.7)
│   ├── generador.js               [frontend]  formulario y creación del enlace
│   ├── editor-pasos.js            [frontend]  agregar, quitar y reordenar pasos y fotos
│   ├── fotos.js                   [frontend]  compresión WebP/JPEG y subida con progreso
│   ├── celebraciones.js           [frontend]  catálogo de opciones predefinidas
│   ├── plantillas.js              [frontend]  registro de plantillas
│   ├── pregunta.js                [frontend]  máquina de estados de pregunta.html
│   ├── boton-no.js                [frontend]  botón que huye
│   ├── particulas.js              [frontend]  motor de partículas ligero
│   ├── eventos.js                 [frontend]  envía eventos (agrupa "No", keepalive)
│   ├── respuestas.js              [frontend]  sondeo y panel
│   ├── utilidades.js              [frontend]  ids aleatorios, helpers de DOM con textContent, largo() en code points
│   └── validacion.js              [frontend]  reglas de §3.3 en el navegador + urlFotoValida()
├── assets/                        [frontend]  favicon.svg, og-imagen.png (1200×630)
│
└── api/                           [backend]   Cloudflare Worker (GitHub Pages lo publica como texto, pero no contiene secretos)
    ├── package.json               (hono, zod; dev: wrangler, vitest, @cloudflare/vitest-pool-workers, typescript)
    ├── wrangler.jsonc             (D1 "DB", R2 "FOTOS", vars ORIGENES_PERMITIDOS, cron)
    ├── tsconfig.json
    ├── .dev.vars.example, .gitignore, README.md
    ├── vitest.config.ts, worker-configuration.d.ts (generado con `npm run types`)
    ├── migrations/0001_inicial.sql
    ├── src/
    │   ├── index.ts               (app Hono + scheduled)
    │   ├── tipos.ts               (AppEnv, prefijo /api/v1, constantes de tiempo)
    │   ├── comun.ts               (carga de propuestas, auth admin, URL de fotos)
    │   ├── cors.ts
    │   ├── errores.ts
    │   ├── esquemas.ts            (Zod, importa js/limites.js)
    │   ├── limite-tasa.ts
    │   ├── ids.ts
    │   ├── rutas/fotos.ts
    │   ├── rutas/propuestas.ts
    │   ├── rutas/eventos.ts
    │   ├── ntfy.ts
    │   ├── turnstile.ts           (v2: verificación anti-bots opcional)
    │   ├── boleto.ts              (v2.2: emitir, verificar y consumir boletos HMAC)
    │   ├── rutas/boletos.ts       (v2.2: POST /boletos)
    │   └── limpieza.ts            (cron)
    └── test/                      (base, propuestas, fotos, eventos, limites-limpieza + ayuda.ts)
```

Reglas para trabajar en paralelo:

- `frontend` **no toca** `api/`. `backend` **no toca** nada fuera de `api/`.
- `docs/arquitectura.md` y `js/limites.js` solo los cambia el arquitecto. Si un agente necesita un cambio, lo pide.
- `cyberbot` audita todo el proyecto, pero solo escribe `docs/seguridad.md`. Sus correcciones las aplica el agente dueño de cada archivo.
- El punto de integración es **este documento**: el frontend programa contra `api-mock.js` siguiendo §5 y §6, y el backend implementa §5. Si los dos cumplen el contrato, cambiar `MODO` a `api` debe funcionar sin tocar nada más.

---

## 8. Plan de trabajo (paralelo)

| # | Agente | Paso | Cómo se prueba |
|---|--------|------|----------------|
| F1 | frontend | Base: `styles.css`, `config.js`, `api.js` + `api-mock.js`, `utilidades.js` | En la consola: `crearPropuesta` → `obtenerPropuesta` devuelve lo mismo |
| F2 | frontend | `pregunta.html` con la máquina de estados y un JSON fijo en el mock | Recorrer pasos → pregunta → Sí → celebración → final con mouse, teclado y en el modo móvil de DevTools |
| F3 | frontend | `boton-no.js` | Intentar tocar "No" 10 veces en móvil y pasar el cursor 10 veces en escritorio: nunca se activa, nunca sale de la pantalla ni tapa el "Sí" |
| F4 | frontend | Generador + `fotos.js` | Subir una foto de 5 MB en JPG y una HEIC en iPhone: resultado ≤ 500 KB, sin EXIF (comprobar con `exiftool`) |
| F5 | frontend | `eventos.js` + `respuestas.html` en mock | Pestaña A en pregunta y pestaña B en respuestas: el resumen se actualiza en ≤ 5 s |
| F6 | frontend | Plantillas y galería | Cada plantilla a 375 px y en escritorio, con y sin `prefers-reduced-motion` |
| B1 | backend | Esqueleto Hono, CORS, errores, `/salud` | `curl -i -H 'Origin: http://localhost:8000' localhost:8787/api/v1/salud` |
| B2 | backend | Migración D1 + `POST/GET /propuestas` + Zod | Tests de validación con cada límite de §3.3 |
| B3 | backend | `POST/GET /fotos` en R2 + bytes mágicos | Subir un PNG renombrado como WebP → 415 |
| B4 | backend | Eventos + resumen + dedupe de `si` + push ntfy | Enviar `si` dos veces → una sola fila |
| B5 | backend | Límite de tasa, topes globales, cron de limpieza | Test con un reloj simulado; `wrangler dev --test-scheduled` |
| B6 | backend | (Pendiente) límites por IP de `eventos`/`panel`/`leer` con el binding `ratelimits`; D1 solo para `fotos`/`propuestas` (§5.5) | Tests con el binding simulado; ninguna escritura en `limites` al sondear |
| B7 | backend | (v2.2) `POST /boletos`, boleto en `POST /fotos` y `POST /propuestas`, 3 fotos por IP al día, contadores condicionales (§15). **Hecho el 2026-10-18** (desviaciones en §15.12) | Tests de §15.9 en `api/test/boletos.test.ts`: 135 tests en verde y `tsc` limpio |
| F7 | frontend | (v2.2) `js/boleto.js`, Turnstile bajo demanda, `X-Boleto`, reintento único, límite de 3 fotos en el editor y mock (§15.6–§15.8). **Hecho el 2026-10-18** (desviaciones en §15.12) | Comprobaciones de §15.9 con jsdom en mock y en api contra `wrangler dev`. Falta la parte de navegador real (I3) |
| I1 | ambos | Integración: `MODO=api` contra `wrangler dev` (**hecha el 2026-10-07**, §12) | El flujo completo de F2 a F5 sin cambios de código |
| I3 | ambos | (v2.2) Integración de B7 + F7 contra `wrangler dev` con la clave de prueba de Turnstile. Hecha con jsdom; **pendiente en un navegador real** con el widget de verdad | Lista de §15.9 "Integración" y consola sin violaciones de CSP (jsdom no aplica la CSP) |
| I2 | usuario | Deploy y prueba en móvil real desde WhatsApp | Lista de verificación de §10 |

---

## 9. Lo que el usuario debe crear o configurar a mano

1. **GitHub:** crear el repositorio, hacer `git push` y activar Pages (Settings → Pages → *Deploy from a branch* → `main` / `(root)`). Anotar `https://<usuario>.github.io/<repo>/`.
2. **Cloudflare:** crear una cuenta gratuita.
3. **R2:** activarlo en el panel (**pide registrar un método de pago**; dentro del plan gratuito el costo es $0) y crear el bucket `noviazgo-fotos`. Agregar una regla de ciclo de vida: borrar el prefijo `fotos/` a los 35 días. Recomendado: configurar una alerta de facturación.
4. **Wrangler:** `cd api && npm install && npx wrangler login`. Para desarrollo local: `cp .dev.vars.example .dev.vars` (trae `PERMITIR_LOCALHOST="1"`, necesario para que el frontend en `localhost` use `wrangler dev` en modo api; v2.1, §5.4).
5. **D1:** `npx wrangler d1 create noviazgo` y pegar el `database_id` en `api/wrangler.jsonc`. Después, `npx wrangler d1 migrations apply noviazgo --remote`.
6. **Secretos y variables:** `npx wrangler secret put SAL_IP` (**obligatorio**; cualquier texto aleatorio largo, p. ej. `openssl rand -hex 32`) y poner `ORIGENES_PERMITIDOS=https://<usuario>.github.io` en `wrangler.jsonc` (sin `/<repo>` ni barra final: el origen no incluye la ruta). Comprobar con `npx wrangler secret list`, que **no** debe incluir `PERMITIR_LOCALHOST` (v2.1: en producción no se define).
7. **Deploy:** `npx wrangler deploy`. Copiar la URL `https://noviazgo-api.<subdominio>.workers.dev` en `API_BASE` de `js/config.js` (con `/api/v1` al final, reemplazando `TU-SUBDOMINIO`).
8. **Vista previa del enlace (Open Graph):** WhatsApp y Facebook exigen una URL **absoluta** en `og:image`. En `index.html` y `pregunta.html` cambiar `content="assets/og-imagen.png"` por `content="https://<usuario>.github.io/<repo>/assets/og-imagen.png"`. Después, `git push`.
9. **Opcional:** instalar la app de ntfy en el celular para recibir los avisos push.
9b. **Opcional (v2), protección contra bots:** en el panel de Cloudflare → Turnstile → *Add widget* con el hostname `gilbertomonroy67.github.io` (y `localhost` para pruebas), modo *Managed*. Pegar la *site key* en `TURNSTILE_SITIO` de `js/config.js` y guardar la *secret key* con `cd api && npx wrangler secret put TURNSTILE_SECRETO`. Activar el secreto y la site key **en el mismo deploy**: con secreto y sin site key nadie podría crear propuestas. **v2.2:** los boletos de subida no necesitan ningún secreto nuevo (su llave se deriva de `SAL_IP`, §15.2); solo hay que confirmar con `npx wrangler secret list` que `SAL_IP` existe.
10. **Futuro (no en v1):** proyecto en Google Cloud Console con un cliente OAuth y URIs de redirección, si se activa el login con Google.

## 10. Verificación de extremo a extremo (antes de dar v1 por terminada)

- [ ] En `https://<usuario>.github.io/<repo>/` el generador crea una propuesta con 3 pasos y 3 fotos (v2.2: el máximo), y no deja elegir una cuarta.
- [ ] El enlace abierto desde WhatsApp en Android e iPhone carga las fotos y el "No" no se puede tocar.
- [ ] `respuestas.html` en la PC muestra en ≤ 5 s: abierto → intentos de No → Sí → la celebración elegida con su nota.
- [ ] Cerrar la pestaña justo después de pulsar Sí: el evento llega igual (`keepalive`).
- [ ] Con el Worker apagado (o con una `API_BASE` incorrecta), `pregunta.html` muestra la pantalla de error con Reintentar, sin errores sin capturar en la consola.
- [ ] Subir una foto desde un origen no permitido → bloqueada por CORS.
- [ ] Cero errores en la consola en Chrome, Firefox y Safari.
- [ ] La vista previa del enlace en WhatsApp muestra la imagen (requiere el paso 8 de §9).
- [ ] `curl -s https://<usuario>.github.io/<repo>/api/.dev.vars` responde 404 (el secreto local no se publicó).

## 11. Plan B documentado (solo si el usuario no quiere activar R2)

Guardar las fotos como BLOB en una tabla `fotos_binario` de D1 (≤ 500 KB por fila, dentro del límite de 2 MB). El contrato HTTP **no cambia** (`POST/GET /fotos`), solo cambia `api/src/rutas/fotos.ts`. Capacidad aproximada: unas 2 000 fotos activas con el límite de 500 MB por base. El frontend no se entera del cambio.

## 12. Revisión final de integración (2026-10-07) — desviaciones aceptadas

Resultado de la prueba **I1** (`js/api.js` en modo `api` contra `wrangler dev --local`, con jsdom): subir foto → crear propuesta → GET → eventos `abierto`/`intento_no`/`si`/`celebracion_elegida` desde `pregunta.html` real → panel con clave → DELETE, más CORS con `http://localhost:<puerto>`, con `https://usuario.github.io` y con un origen ajeno. Todo coincide con este contrato.

| Tema | Decisión |
|------|----------|
| `compatibility_date` `2026-08-01` | Aceptada. |
| Índice `idx_limites_expira` | Aceptado (§5.7). |
| Variable `NTFY_BASE` | Aceptada (§5.8). |
| `\r\n` → `\n` en el Worker | Aceptada (§3.3). |
| Foto repetida en una propuesta → 422 | Aceptada; agregada también a `js/validacion.js` (§3.3). |
| DELETE de propuestas expiradas | Aceptado; el mock se alineó (§5.1). |
| `nota: null` sin nota | Aceptado; el mock se alineó (§5.2). |
| `SAL_IP` faltante = solo aviso | Aceptado para desarrollo; obligatorio en producción (§5.8, §9). |
| Zod en español | Aceptado. |
| `subirFoto` con XHR para el progreso | Aceptado (§6.2). |
| Longitud de textos | Code points en ambos lados (§3.3). |
| `og:image` relativa | Se mantiene relativa en el repo; el usuario la vuelve absoluta al publicar (§9, paso 8). |
| Fotos del mock en `localStorage` | Aceptado (≈ 7 fotos; §6.2). |
| Vista previa sin `noopener` | Aceptada (§6.2). |
| Fotos con `max-age=86400` tras borrar | Aceptado el riesgo: los Workers no se cachean en el CDN, así que solo queda la copia del navegador de quien ya las vio. Se cambia a `private` para excluir proxies (§5.1). |
| Límite de tasa en D1 | Se mantiene en v1 con sondeo adaptativo (§2.3); la migración al binding `ratelimits` queda como pendiente B6 (§5.5). |
| `npm audit` (5 avisos altos en `undici`) | Aceptado: solo afecta a dependencias de desarrollo (`wrangler`/`miniflare`) que corren en la máquina local; no se usa `npm audit fix --force` (rompería versiones). Se revisa al actualizar `wrangler`. |
| Fuentes de Google Fonts por plantilla | Aceptadas: son solo CSS, no bloquean la carga (espera máx. 2,5 s) y tienen fuentes del sistema de respaldo. Si se agrega una CSP, hay que incluir `fonts.googleapis.com` y `fonts.gstatic.com`. |

## 13. Contrato v2 (2026-10-11): cifrado de extremo a extremo y endurecimiento

Pedido del usuario: que los datos sensibles y las fotos no se vean en la nube, solo a través del enlace generado. Revisión de seguridad completa en `docs/seguridad.md` (agente `cyberbot`).

### 13.1 Cifrado

- `js/cifrado.js`: AES-GCM de 256 bits con WebCrypto, sin dependencias. Formato `[versión 1][IV 12 bytes][texto cifrado + etiqueta 16 bytes]`, en base64url sin relleno cuando va en JSON.
- Datos asociados (AAD) por uso: `noviazgo/v2/propuesta`, `noviazgo/v2/foto` y `noviazgo/v2/evento`. Un bloque cifrado no se puede reutilizar en otro lugar.
- **La llave** (32 bytes → 43 caracteres base64url) la genera el generador al cargar y viaja **solo en el fragmento**: `pregunta.html?id=<id>#c=<llave>` y `respuestas.html?id=<id>#k=<claveAdmin>&c=<llave>`. Los navegadores nunca mandan el fragmento al servidor ni en el `Referer`.
- **Qué queda cifrado:** nombres, tipo, plantilla, textos de los pasos, `alt` de las fotos, pregunta, celebración (título y opciones), mensaje final, los **bytes de cada foto** y la elección de celebración con su nota.
- **Qué ve el servidor:** el id, el hash de `claveAdmin`, la lista de ids de fotos, el tema ntfy, los tipos y horas de los eventos (abierto, intentos de No, sí) y metadatos de tamaño.
- Si alguien pierde la llave, nadie, ni siquiera el servidor, puede recuperar el contenido. "Mis propuestas" (`localStorage`) guarda `claveCifrado` junto a `claveAdmin`.

### 13.2 API v2

| Ruta | Cambio |
|------|--------|
| `POST /fotos` | Solo `Content-Type: application/octet-stream`, ≤ `fotoCifradaBytes` (512 029). Debe empezar con el byte de versión `1`, medir ≥ 30 bytes y **no** parecer un JPEG/WebP en claro. Se guarda con `tipo_mime = application/octet-stream`. v2.2: exige `X-Boleto` (§15.3). |
| `GET /fotos/:id` | `application/octet-stream` + `Content-Disposition: attachment`. El frontend la baja con `fetch` (CORS), la descifra y detecta JPEG/WebP por bytes mágicos. |
| `POST /propuestas` | Cuerpo `{ "v": 2, "cifrado": "<base64url 40–30 000>", "fotos": ["f_…"] (≤ 3 desde v2.2; era 10; sin repetir), "avisos": { "push": bool } }`, `.strict()`. Con Turnstile activo exige la cabecera `X-Turnstile-Token` o, desde v2.2, `X-Boleto` (§15.4). Respuesta igual que v1. |
| `GET /propuestas/:id` | v2: `{ v: 2, id, cifrado, fotos: [{ id, url }], creadaEn, expiraEn }`. v1 (heredadas): igual que §3.2. |
| `POST /propuestas/:id/eventos` | `celebracion_elegida` v2: `{ tipo, sesion, cifrado }` (≤ 1 200 caracteres), sin `opcionId` ni `nota`. En propuestas v1 sigue `opcionId` + `nota`. Todos los esquemas `.strict()`. |
| `GET /propuestas/:id/eventos` | v2: `para: null`; `cifrado` (contenido de la propuesta) **solo cuando `desde` es 0**; los eventos y `resumen.celebracion` de celebración llevan `{ cifrado }` en lugar de `opcionId`/`etiqueta`/`nota`. |
| ntfy | v2: avisos genéricos sin nombre ni opción ("Abrieron tu enlace 👀", "¡Dijo que SÍ! 💖", "Ya eligió dónde celebrar 🎉"). |

**Validación:** el servidor ya no puede validar textos ni el contenido de las fotos. Solo valida forma y tamaño. Las reglas de §3.3 se aplican en `js/validacion.js` antes de cifrar, y `pregunta.js` vuelve a normalizar y truncar al descifrar. Todo se sigue pintando con `textContent`.

**Compatibilidad:** las propuestas v1 creadas antes del 2026-10-11 se siguen leyendo en claro hasta que expiren (30 días). Ya no se pueden crear propuestas v1.

### 13.3 Endurecimiento

- **HTTPS obligatorio en el Worker:** por `http://` fuera de localhost, `GET`/`HEAD` → `301` a `https://`, y el resto → `403 https_requerido`. HSTS de 2 años en las respuestas HTTPS. GitHub Pages ya redirige a HTTPS.
- **Cabeceras de la API:** `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security`, además de las de §5.8.
- **CSP del frontend** por `<meta>` en las tres páginas: `default-src 'self'`, scripts solo propios (más `challenges.cloudflare.com` en `index.html` para Turnstile), estilos propios + Google Fonts, `img-src 'self' blob:`, `connect-src` solo a la API (producción y `localhost:8787`), `object-src 'none'`, `base-uri 'none'` y `form-action 'self'`. **Si cambia la URL de la API, hay que actualizarla también en las tres CSP.** `frame-ancestors` no funciona por `<meta>` y Pages no permite cabeceras: el clickjacking queda como riesgo aceptado (ver `docs/seguridad.md`).
- `<meta name="referrer" content="no-referrer">` en las tres páginas.
- **Turnstile (opcional, desactivado por defecto):** `TURNSTILE_SITIO` en `js/config.js` y el secreto `TURNSTILE_SECRETO` en el Worker. Falla cerrado si siteverify no responde (§9, paso 9b). v2.2: protege `POST /boletos` (y `POST /propuestas` si no llega un boleto); las fotos quedan protegidas por el boleto (§15).

### 13.4 Interfaz vigente de `js/api.js`

```js
export function       generarClave()                                   // → llave base64url (43)
export async function subirFoto(blob, { clave, alProgresar })          // cifra y sube → { id, url, expiraEn }
export async function crearPropuesta(propuesta, { clave, turnstile })  // valida (§3.3), cifra → { id, claveAdmin, expiraEn, ntfyTema }
export async function obtenerPropuesta(id, clave)                      // → §3.2 en claro + cifrada: bool; ErrorApi llave_faltante | llave_invalida
export async function cargarFoto(url, clave | null)                    // → URL blob: ya descifrada (null = foto v1 en claro)
export async function cifrarEleccion(clave, { opcionId, nota })        // → texto cifrado para celebracion_elegida
export function       enviarEvento(id, evento, { keepalive })          // NUNCA lanza
export async function obtenerEventos(id, claveAdmin, desde, clave)     // → §5.2 ya descifrado + llaveFaltante
export async function borrarPropuesta(id, claveAdmin)
```

El mock (`js/api-mock.js`) guarda lo mismo que el Worker (el sobre y las fotos cifradas) y aplica las mismas reglas de forma.

## 14. Contrato v2.1 (2026-10-18): correcciones de la auditoría H1/H2/H3

Origen: auditoría de `cyberbot` del 2026-10-18 (`docs/seguridad.md`). Lo implementó `backend` solo en `api/**` (109 tests en verde, `tsc` limpio). **El contrato HTTP no cambia:** mismos endpoints, cuerpos y códigos (429, 403, 415/413/422, 503); el frontend y el mock no cambian.

| Hallazgo | Cambio | Dónde |
|----------|--------|-------|
| H1 (media): el tope global de propuestas se gastaba antes de Turnstile | `limitar()` se separa en `limitarIp()` y `consumirTopeGlobal()`. Orden: IP → Turnstile → validación → tope global | §5.5, `api/src/limite-tasa.ts`, `api/src/rutas/propuestas.ts` |
| H2 (media): `POST /fotos` agotable con basura; IPv6 contada por dirección | Tope global después de validar; IPv6 por /64 e IPv4 mapeada como IPv4; límites diarios por IP (fotos 60, propuestas 20) | §5.5, `api/src/rutas/fotos.ts` |
| H3 (informativa): localhost aceptado siempre en CORS | Solo con `PERMITIR_LOCALHOST="1"` en `.dev.vars` | §5.4, §5.8, §9 |

**Decisiones del arquitecto:**
- Los límites diarios por IP se quedan en `api/src/limite-tasa.ts` (`REGLAS_IP_DIARIAS`), no en `js/limites.js`: el frontend no los usa. §5.5 es la referencia. Backend no tiene que cambiar ningún import.
- La exención de HTTPS para `localhost` de §13.3 se mantiene: depende del `Host` de la solicitud, que en `workers.dev` nunca es localhost, así que no afecta a producción.
- ~~**Turnstile en `POST /fotos`: no se implementa por ahora (riesgo aceptado, se revisa si hay abuso).**~~ **Reemplazada el 2026-10-18 por la v2.2 (§15):** el usuario decidió cerrar H4 con el boleto de subida. Motivos originales, como referencia:
  1. Los tokens de Turnstile son de un solo uso; con hasta 10 fotos por propuesta habría que resolver el widget hasta 10 veces o inventar un "boleto de subida" firmado (HMAC con un secreto nuevo), lo que cambia el contrato HTTP, `js/api.js`, el mock y el Worker.
  2. Con los cambios de la 2.1, agotar el tope de fotos (500/día) exige al menos 9 IPv4 o /64 distintos durante un día entero, y el atacante no gana nada: las fotos son opcionales (la propuesta se puede crear igual sin ellas), no se expone ningún dato y el bloqueo dura hasta el día siguiente.
  3. Las propuestas, que son lo esencial, sí siguen protegidas por Turnstile.
  - **Si se detecta abuso** (503 `capacidad_agotada` en fotos en los registros de métricas o quejas): implementar el boleto. Al pasar Turnstile, `POST /propuestas/boleto` (o la respuesta de un `POST` previo) entrega un boleto HMAC válido 30 min para N fotos, y `POST /fotos` lo exige en una cabecera. Eso requiere contrato v2.2. **Hecho en §15.**

## 15. Contrato v2.2 (2026-10-18): boleto de subida, 3 fotos por propuesta y 3 por IP al día

Origen: hallazgo H4 de `cyberbot` (`docs/seguridad.md`, "Revisión de las correcciones"). `POST /fotos` no tenía protección contra bots y unas 9 IP o /64 bastaban para agotar el tope global de 500 fotos al día. El usuario eligió el **boleto de subida firmado**, que se entrega tras pasar Turnstile, y pidió además **como máximo 3 fotos por IP al día**. En consecuencia, **una propuesta lleva como máximo 3 fotos en total** (`LIMITES.fotosTotales.max = 3` en `js/limites.js`).

**Esta versión sí cambia el contrato HTTP.** El Worker y el frontend se despliegan juntos (§15.11). No hay migración de D1 ni secreto nuevo.

### 15.1 `POST /api/v1/boletos`

| | |
|---|---|
| Request | Sin cuerpo (si llega, no se lee). Cabecera `X-Turnstile-Token: <token>` cuando Turnstile está activo. |
| Orden | `limitarIp('boletos')` (10/h y 20/día por IP → 429) → `exigirHumano()` (solo con `TURNSTILE_SECRETO`; 403 `verificacion_bot`) → emitir. El límite por IP va antes de siteverify, como en la 2.1. Sin tope global, porque un boleto no guarda nada. |
| Respuesta | `201 { "boleto": "b1.<P>.<F>", "expiraEn": "<ISO>", "fotos": 3 }`, con `Cache-Control: no-store` (el de siempre). |
| Turnstile desactivado (local, tests, mock) | Se emite sin verificar nada. El boleto se sigue exigiendo en `POST /fotos`: hay un solo camino de código y los tests lo recorren. |
| Sin `SAL_IP` | Con Turnstile activo responde 500 `interno` y registra `console.error('boleto_sin_sal')` (falla cerrada: sin sal la llave sería pública). Sin Turnstile (desarrollo) usa la sal vacía, igual que `hashIp()`, y solo avisa. Se comprueba **antes** de `limitarIp`, y lo mismo vale para `POST /fotos` y para `POST /propuestas` con `X-Boleto` (`llaveDelEntorno()`, §15.12). |

**Formato del boleto:** `b1.<P>.<F>` (≤ 200 caracteres en total).

- `P` es el JSON UTF-8 compacto `{"v":1,"n":"<nonce>","exp":<epoch en segundos>,"f":<cupo>}`, en base64url sin relleno, con las claves en ese orden.
  - `n`: 16 caracteres base62 de `crypto.getRandomValues` (`base62(16)` de `ids.ts`, ≈ 95 bits).
  - `exp`: `floor(ahora / 1000) + LIMITES.minutosBoleto * 60`, es decir, **60 minutos**.
  - `f`: `LIMITES.fotosPorBoleto` (3).
- `F` es `base64url(HMAC-SHA256(llave, ASCII("b1." + P)))`, 43 caracteres. La firma cubre también el prefijo de versión.
- **Por qué 60 minutos:** las fotos se suben al elegirlas y la propuesta se crea al final. 60 min cubren una edición normal, y si vence, el frontend renueva sin que se note (§15.6). Un boleto robado vale como mucho 3 fotos y 1 propuesta durante 1 h.
- **No se ata a la IP**, por decisión del arquitecto. Motivos:
  1. Los celulares cambian de IP a mitad de la edición (wifi → datos) y cada cambio exigiría resolver Turnstile otra vez.
  2. Atarlo no aporta: el abuso ya está acotado por el nonce (3 fotos y 1 propuesta por boleto, se use desde donde se use) y por el cupo diario por IP de cada subida.
  3. Así el boleto tampoco lleva ningún dato derivado de la IP.

**Verificación (`verificarBoleto(texto, llave, ahora)` en `api/src/boleto.ts`), en este orden:**

1. **Forma:** debe cumplir `^b1\.[A-Za-z0-9_-]{40,120}\.[A-Za-z0-9_-]{43}$` y medir ≤ 200 caracteres. Además `F` debe estar en base64url **canónico** (32 bytes y bits de relleno del último carácter en cero), para que un boleto no se pueda escribir de varias maneras. Si no → 401 `boleto_invalido`.
2. **Firma:** con `crypto.subtle.verify('HMAC', llave, firma, datos)`, que compara en tiempo constante. **Nunca** se recalcula la firma para compararla con `===` ni carácter por carácter. Si falla → `boleto_invalido`.
3. **Contenido:** solo con la firma ya válida se decodifica `P` y se parsea el JSON. Se exige `v === 1`, `n` con `^[A-Za-z0-9]{16}$`, `exp` entero y `f` entero entre 1 y `LIMITES.fotosPorBoleto`. Si algo falla → `boleto_invalido`.
4. **Vigencia:** si `exp * 1000 <= ahora` → 401 `boleto_vencido`. Solo cuenta el reloj del servidor, sin tolerancia.

La verificación no lee D1. El consumo (§15.3, §15.4) es un paso aparte.

### 15.2 Llave del HMAC: derivada de `SAL_IP` con HKDF (sin secreto nuevo)

```
base  = importKey('raw', UTF-8(SAL_IP), 'HKDF', false, ['deriveKey'])
llave = deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: UTF-8('noviazgo'), info: UTF-8('noviazgo/v2.2/boleto-hmac') },
                  base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign', 'verify'])
```

- La llave se cachea por isolate, con el valor de `SAL_IP` como clave del caché.
- **Por qué no `BOLETO_SECRETO`:**
  1. `SAL_IP` ya es obligatoria en producción y ya existe. Derivar la llave no agrega nada que configurar ni un paso que se pueda olvidar en el deploy. Un secreto nuevo que faltara dejaría las fotos rotas o, peor, firmadas con una llave vacía.
  2. HKDF con un `info` propio separa los dominios: conocer la llave de los boletos no revela la sal y viceversa.
  3. Las dos viven en el mismo lugar (secretos del Worker), así que un secreto aparte no reduce lo que queda expuesto si se filtra.
- **Rotación:** solo si se sospecha una filtración, sin calendario fijo. Se hace con `npx wrangler secret put SAL_IP`, que publica una versión nueva al instante. Efectos:
  - Los boletos vigentes pasan a `boleto_invalido` (como mucho 60 min de boletos) y el frontend obtiene otro y reintenta una vez.
  - Los contadores por IP de la ventana actual empiezan de cero, una sola vez, lo cual es aceptable.
  - `fotos.ip_hash` deja de ser comparable con los hashes nuevos, pero no se usa para nada más.
- Si algún día hiciera falta rotar la llave de los boletos por separado, la salida es un `BOLETO_SECRETO` opcional que reemplace la derivación. **No se implementa ahora.**

### 15.3 `POST /fotos` (exige boleto)

Cabecera `X-Boleto: <boleto>`. Se eligió en lugar de `Authorization: Boleto …` porque `Authorization` ya es el Bearer de la `claveAdmin` y mezclar esquemas complica `verificarAdmin`. `X-Boleto` se agrega a `Access-Control-Allow-Headers` (§5.4). La subida ya tenía preflight por `Content-Type: application/octet-stream`.

**Orden:**

1. Falta `X-Boleto` → 401 `boleto_ausente`. Si `verificarBoleto` falla → 401 `boleto_invalido` o `boleto_vencido`. *(No toca D1.)*
2. `Content-Type`, `Content-Length`, bytes y forma del cifrado → 415 o 413. *(No toca D1.)*
3. **Consumir un uso del boleto:** contador `boleto:<n>`, máximo `f` (3), `expira_en = exp * 1000`. Si está agotado → 403 `boleto_agotado`.
4. **Cupo diario por IP:** contador `fotos:dia:<ipHash>:<ventana>`, máximo **3 por día UTC** → 429 con `Retry-After` hasta las 00:00 UTC. Se elimina la regla horaria de fotos (con 3 al día sobra).
5. **Tope global:** `fotos:global:<ventana>`, **500 por día** (sin cambio) → 503 `capacidad_agotada`.
6. R2 `put` + `INSERT` en `fotos` (sin cambio).

**Por qué el límite por IP ya no va primero en esta ruta:** en la 2.1 iba primero para que nadie hiciera llamar a siteverify sin freno ni gastara el tope global. Aquí los pasos 1 y 2 no tocan D1 ni a terceros (son CPU). Poner los contadores después hace que las solicitudes rechazadas cuesten **cero escrituras** y que la basura no gaste las 3 fotos diarias de nadie. El uso del boleto va antes que la IP porque el boleto es el recurso que le cuesta al atacante (un Turnstile por cada 3 fotos). Si un paso posterior falla (429, 503 o un error de R2), **no se devuelven** los usos ya gastados: es raro y devolverlos agregaría escrituras y carreras. Es el riesgo aceptado H7 (§15.10).

**El tope global se mantiene en 500 al día.** Ahora agotarlo exige ≥ 167 IP o /64 (3 cada uno) **y** ≥ 167 Turnstile resueltos. Almacenamiento en el peor caso: 500 × 512 KB × 30 días ≈ 7,5 GB, dentro de los 10 GB de R2.

**Contadores condicionales (v2.2, todos los de `limites`, también los de eventos, panel y lectura):** `incrementar()` pasa a recibir el máximo y a usar

```sql
INSERT INTO limites (clave, conteo, expira_en) VALUES (?1, 1, ?2)
ON CONFLICT(clave) DO UPDATE SET conteo = conteo + 1 WHERE conteo < ?3
RETURNING conteo
```

- Sin fila devuelta = límite alcanzado. En ese caso la sentencia no modifica filas (`meta.rows_written === 0`), así que insistir por encima del límite ya no escribe en D1.
- El valor guardado nunca supera el máximo.
- Los tests que precargan `conteo = máximo` siguen valiendo.
- `reintentarEn` se calcula igual que antes.

### 15.4 `POST /propuestas` (acepta el boleto)

Los tokens de Turnstile son de un solo uso. Por eso el frontend crea la propuesta con el **mismo boleto** que usó para las fotos y no resuelve el widget dos veces.

**Orden** (es el de la 2.1, con el consumo del boleto entre la validación y el tope global):

1. `limitarIp('propuestas')` (10/h y 20/día) → 429.
2. **Verificación humana**, solo si existe `TURNSTILE_SECRETO`:
   - Si llega `X-Boleto`: `verificarBoleto` → 401 `boleto_invalido` o `boleto_vencido`. **No** se llama a siteverify y `X-Turnstile-Token` se ignora.
   - Si no llega: `exigirHumano()` como hoy → 403 `verificacion_bot`. Esto queda por compatibilidad con un frontend viejo en caché durante el deploy.
   - Sin `TURNSTILE_SECRETO` no se exige nada y `X-Boleto` se ignora: ni se verifica ni se consume.
3. `leerJson` + Zod (`fotos` ≤ 3) + fotos válidas → 400, 413 o 422.
4. Si se usó boleto, **consumir su única propuesta:** contador `boleto-prop:<n>`, máximo 1, `expira_en = exp * 1000` → 403 `boleto_agotado`.
5. `consumirTopeGlobal('propuestas')` → 503.
6. `INSERT`, como hoy.

- **Por qué se consume una vez:** si el boleto sirviera para varias propuestas, uno resuelto y repartido entre 300 IP agotaría el tope global de propuestas con un solo Turnstile, es decir, volvería H1.
- **Por qué se consume después de validar:** un 422 (por ejemplo, una foto huérfana que ya expiró) no obliga a resolver Turnstile otra vez para reintentar.
- El cupo de propuesta es independiente del de fotos: un boleto que ya subió 3 fotos sigue sirviendo para crear la propuesta.
- **Sin fotos funciona igual:** el frontend pide un boleto al pulsar "Crear enlace" y lo manda en `X-Boleto`.

### 15.5 Errores nuevos y reacción del frontend

Todos tienen la forma de siempre: `{ "error": { "codigo", "mensaje" } }` (§5.3).

| HTTP | `codigo` | Mensaje del Worker (sugerido) | Reacción del frontend |
|------|----------|-------------------------------|-----------------------|
| 401 | `boleto_ausente` | "Falta la verificación de seguridad para subir fotos." | Descartar el boleto, pedir uno nuevo (Turnstile) y **reintentar una vez** la misma operación |
| 401 | `boleto_invalido` | "La verificación de seguridad no es válida. Vuelve a intentarlo." | Igual |
| 401 | `boleto_vencido` | "La verificación de seguridad venció. Vuelve a intentarlo." | Igual |
| 403 | `boleto_agotado` | "Esta verificación ya se usó por completo." | Igual (si después llega un 429, se muestra el de abajo) |
| 429 | `demasiadas_solicitudes` en `POST /fotos` | (el actual) | Sin reintento. La foto pasa a error con "Ya subiste 3 fotos hoy desde esta conexión. Puedes crear la propuesta con las que tienes o intentarlo mañana." |
| 403 | `verificacion_bot` en `POST /boletos` | (el actual) | Reiniciar el widget y mostrar el mensaje. Sin reintento automático (se reintenta al elegir otra foto o al volver a pulsar Crear) |

Si el reintento único vuelve a fallar con un código `boleto_*` o con `verificacion_bot`, se muestra el error (la foto queda en error con "Quitar", o se muestra el resumen de errores del generador). Nunca hay bucles. `Retry-After` no es legible desde el navegador (no está en la lista segura de CORS), así que los mensajes no prometen una hora.

### 15.6 Flujo del frontend

- **Turnstile bajo demanda** (activo si `TURNSTILE_SITIO` está configurada y `MODO === 'api'`):
  - El script se sigue cargando al abrir el generador, para que esté listo.
  - El widget se renderiza con `execution: 'execute'` y `appearance: 'interaction-only'`, y el token se pide con `turnstile.execute(widget)` solo cuando hace falta un boleto. La promesa se resuelve en el `callback`, se rechaza con `error-callback` y tiene un *timeout* de 60 s.
  - Tras cada uso se llama a `turnstile.reset(widget)`, porque cada token sirve una vez.
  - Si Cloudflare pide interacción (`before-interactive-callback`), el contenedor se muestra **en el viewport**, por ejemplo como un panel fijo abajo con el texto "Verificación de seguridad", y se oculta en `after-interactive-callback`. Hoy está junto al botón Crear, donde no se vería al elegir fotos en el paso 3.
  - No cambia la CSP: `challenges.cloudflare.com` ya está en `script-src` y `frame-src`.
- **Cuándo se pide el boleto (perezoso):**
  - Al elegir la primera foto: `obtenerBoleto` arranca **en paralelo** con la compresión y la subida espera a los dos.
  - Al pulsar "Crear enlace", si no hay boleto vigente.
  - Una sola solicitud en vuelo: tres fotos elegidas a la vez comparten la misma promesa.
- **Vigencia:** el boleto se guarda **solo en memoria**, nunca en `localStorage` ni en `sessionStorage`. Se considera vencido 2 min antes de `expiraEn`.
  - Si vence a mitad de la edición, las fotos ya subidas siguen valiendo (son huérfanas durante 24 h y no dependen del boleto). La siguiente subida o la creación piden otro boleto sin avisar, salvo que Turnstile pida interacción.
  - Si el servidor responde `boleto_vencido` igual (por ejemplo, por diferencias de reloj), aplica el reintento único de §15.5.
- **Reutilización para crear la propuesta:** se usa el mismo boleto si sigue vigente, aunque ya haya gastado sus 3 fotos, porque el cupo de propuesta es aparte. Tras crear con éxito, el boleto se descarta ("Crear otra" recarga la página). Si `crearPropuesta` devuelve `boleto_agotado` u otro `boleto_*`, se pide uno nuevo y se reintenta una vez.
- **Con Turnstile desactivado en modo api:** igual se pide el boleto (sin token) y se manda en `X-Boleto`.
- **Límite de 3 fotos en el editor (`js/editor-pasos.js`):**
  - Un contador global visible, "Fotos: n de 3", con `aria-live="polite"`. Cuenta las fotos en proceso, subiendo y listas, no las que fallaron.
  - Al llegar a 3 se deshabilitan **todas** las entradas de archivo y se avisa, visible y con `anunciar()`: "Llegaste al máximo de 3 fotos por propuesta."
  - Si se eligen más de las que caben: "Solo se agregaron n foto(s): máximo 3 por propuesta."
  - Texto de ayuda: "Hasta 3 fotos en toda la propuesta. Cada foto que subes cuenta para el límite de 3 al día desde tu conexión, aunque después la quites."
  - Se mantiene `fotosPorPaso` (3), que con el total de 3 ya no restringe nada.
- **Al leer** (`pregunta.js`, `respuestas.js`, vista previa) **no** se aplica `fotosTotales`. Solo se sigue recortando por paso con `fotosPorPaso`, como hoy, para que las propuestas v2 anteriores con más de 3 fotos se sigan viendo.

### 15.7 Interfaz de `js/api.js` y módulo nuevo `js/boleto.js`

```js
// js/api.js (cambios respecto de §13.4)
export async function obtenerBoleto({ turnstile } = {})                // POST /boletos → { boleto, expiraEn, fotos }
export async function subirFoto(blob, { clave, boleto, alProgresar })  // XHR con cabecera X-Boleto
export async function crearPropuesta(propuesta, { clave, boleto, turnstile }) // X-Boleto si hay boleto; si no, X-Turnstile-Token
export const CODIGOS_BOLETO                                             // ['boleto_ausente','boleto_invalido','boleto_vencido','boleto_agotado']

// js/boleto.js (nuevo, frontend): único dueño de Turnstile y del boleto
export function iniciarVerificacion(contenedor)   // prepara Turnstile (si aplica); no pide nada todavía
export function prepararBoleto()                  // (§15.12) boleto vigente o la solicitud en vuelo; para pedirlo en paralelo con la compresión
export async function conBoleto(operacion)        // operacion(boleto) → resultado; renueva y reintenta UNA vez ante CODIGOS_BOLETO
export function olvidarBoleto()                   // descarta el boleto en memoria (tras crear la propuesta)
```

Los errores que salen de `obtenerBoleto` (vía `prepararBoleto`/`conBoleto`) llevan `error.origen = 'boleto'`, para que un 429 de `/boletos` no se confunda con el cupo diario de `/fotos` (§15.12).

- `js/api.js` trata el boleto como **texto opaco**: no lo decodifica ni lo valida. Solo usa `expiraEn` de la respuesta.
- Todo el código de Turnstile sale de `js/generador.js` y pasa a `js/boleto.js`. El generador ya no comprueba "espera a que termine la verificación".

### 15.8 Mock (`js/api-mock.js`)

Simula el Worker **con Turnstile activo**, sin siteverify, para recorrer el mismo camino del frontend:

- **`obtenerBoleto()`:** 300 ms de latencia; ignora el token. Devuelve un boleto con la misma forma `b1.<P>.<F>`: `P` es el JSON de §15.1 en base64url y `F` son 43 caracteres aleatorios. Lo registra en `noviazgo:mock:boletos` como `{ [n]: { exp, fotos: 0, propuesta: false } }`.
- **`subirFoto(blob, { boleto })`:** mismo orden que §15.3.
  - Sin boleto → `boleto_ausente`. Con un nonce desconocido o una forma mala → `boleto_invalido`. Vencido → `boleto_vencido`.
  - Después la forma del cifrado (415/413), los usos (`boleto_agotado`) y el **cupo diario del navegador**: `noviazgo:mock:cupo-fotos = { dia: 'AAAA-MM-DD' (UTC), n }`, máximo 3 → 429 `demasiadas_solicitudes`. Se reinicia borrando la clave.
- **`crearPropuesta(sobre, { boleto, turnstile })`:** sin boleto ni token → 403 `verificacion_bot`. Con boleto: lo verifica, valida el sobre (`fotos` ≤ 3), consume su propuesta (`boleto_agotado` la segunda vez) y crea.
- **Fallos inyectables para probar los reintentos:** `localStorage['noviazgo:mock:fallo']` acepta `boleto_invalido`, `boleto_vencido`, `boleto_agotado`, `demasiadas_solicitudes` o `verificacion_bot`. La siguiente llamada que pueda producir ese error lo produce y la clave se borra (un solo disparo).

### 15.9 Tests mínimos

**Backend** (`api/test/boletos.test.ts`, nuevo, más ajustes en los existentes):

1. `POST /boletos` sin Turnstile → 201, el boleto cumple la regex de §15.1, `expiraEn` ≈ ahora + 60 min y `fotos` = 3.
2. Con `TURNSTILE_SECRETO`:
   - Sin token → 403 `verificacion_bot`.
   - Con siteverify simulado (sin salir a internet) en éxito → 201.
   - La solicitud 11 de la hora → 429 **sin** llamar a siteverify.
   - Sin `SAL_IP` → 500 `interno`.
3. `verificarBoleto`, unitario. Dan `boleto_invalido`:
   - `P` alterado (otro `exp`) o `F` alterado.
   - Prefijo `b2.`.
   - Más de 200 caracteres.
   - Firmado con otra `SAL_IP`.
   - `f = 4` bien firmado.

   Un boleto vencido (reloj simulado) da `boleto_vencido`.
4. `POST /fotos` sin `X-Boleto` → 401 `boleto_ausente`. Las solicitudes rechazadas en los pasos 1–2 (sin boleto, boleto inválido, 415, 413) **no crean ni modifican** filas de `limites` (contar antes y después).
5. Un boleto: 3 fotos → 201 × 3; la 4.ª con el mismo boleto desde **otra** IP → 403 `boleto_agotado`.
6. Una IP: 3 fotos con el boleto A; la 4.ª con un boleto B nuevo → 429 con `Retry-After`. El boleto B desde otra IP → 201.
7. Contadores condicionales: con un contador en su máximo, las solicitudes siguientes dan 429, 503 o 403, el `conteo` guardado sigue igual al máximo y `meta.rows_written` es 0.
8. El tope global de 500 sigue funcionando → 503 (adaptar el test actual).
9. `POST /propuestas` con Turnstile activo:
   - Con boleto válido y sin token → 201. La segunda propuesta con el mismo boleto → 403 `boleto_agotado`.
   - Con boleto vencido → 401. Sin boleto ni token → 403 `verificacion_bot`.
   - Un 422 con boleto **no** consume `boleto-prop`: una propuesta válida después, con el mismo boleto → 201.
   - Sin Turnstile, `X-Boleto` basura se ignora → 201.
10. Una propuesta con 4 fotos → 422 `validacion` (campo `fotos`); con 3 → 201. Una propuesta v2 insertada directamente en D1 con 10 fotos → el `GET` devuelve las 10 (la lectura sigue intacta).
11. El preflight CORS devuelve `Access-Control-Allow-Headers: Content-Type, Authorization, X-Turnstile-Token, X-Boleto` (actualizar `base.test.ts`).
12. `limpiar()` borra los `boleto:*` y `boleto-prop:*` vencidos.
13. Ajustes:
    - El ayudante `subirFoto` de `test/ayuda.ts` pide y manda un boleto.
    - El caso `'11 fotos'` pasa a `'4 fotos'`.
    - Los tests de la auditoría que usaban la foto 61 o 60 fotos por IP pasan a la 4.ª foto y a 3 por IP.

Siguen en verde `npx vitest run` y `npx tsc --noEmit`.

**Frontend** (Node + jsdom desde el scratchpad, sin dependencias en el repo; luego en el navegador):

1. Mock: 3 fotos en pasos distintos → **una sola** llamada a `obtenerBoleto` y 3 subidas. Las entradas de archivo quedan deshabilitadas y el aviso "Llegaste al máximo de 3 fotos por propuesta." se ve y se anuncia.
2. Elegir 4 fotos a la vez en un paso vacío → se agregan 3, con el aviso.
3. `noviazgo:mock:fallo = boleto_vencido` → se pide un segundo boleto y la foto termina `lista`. Con el fallo inyectado dos veces seguidas → la foto queda en error y no hay un tercer intento.
4. `demasiadas_solicitudes` → mensaje "Ya subiste 3 fotos hoy…" y sin reintento.
5. Crear sin fotos → 1 `obtenerBoleto` + `crearPropuesta` con boleto. Crear tras subir 3 fotos con el boleto vigente → **no** se pide otro. Con el boleto a < 2 min de vencer → se pide otro.
6. `validarPropuesta` con 4 fotos repartidas → detalle en `pasos`.
7. `pregunta.html` (mock) con una propuesta v2 de 6 fotos (2 por paso) → se muestran las 6.
8. Modo api contra `wrangler dev`: en la red se ven una sola solicitud `/boletos`, `X-Boleto` en `/fotos` y `/propuestas`, y ningún `X-Turnstile-Token` hacia `/propuestas`. La consola queda sin errores ni violaciones de CSP.

**Integración (I3):** `wrangler dev` con `TURNSTILE_SECRETO=1x0000000000000000000000000000000AA` (clave de prueba de Cloudflare que siempre pasa) y el frontend en modo api. En local conviene que `js/config.js` use la *site key* de prueba `1x00000000000000000000AA` cuando `ES_LOCAL` (decisión del frontend). Hay que recorrer: 3 fotos → crear → abrir el enlace → ver las fotos. Después, una 4.ª subida desde la misma IP → 429.

### 15.10 Costo y riesgos residuales

**Escrituras en D1 (filas de `limites`):**

| Ruta | 2.1 | 2.2 |
|------|-----|-----|
| `POST /boletos` | — | 2 (hora + día por IP). 0 una vez agotado el límite |
| `POST /fotos` exitosa | 3 (+1 `INSERT`) | 3: boleto, día por IP y global (+1 `INSERT`) |
| `POST /fotos` rechazada (sin boleto, inválida, 415, 413) | 2 | **0** |
| `POST /fotos` por encima de un límite | 1–3 | **0** (condicional) |
| `POST /propuestas` exitosa | 3 | 4 (hora, día, `boleto-prop` y global) |

Techo diario con uso legítimo:

| Concepto | Cálculo | Escrituras |
|----------|---------|------------|
| Fotos | 500 × 3 | 1 500 |
| Propuestas | 300 × 4 | 1 200 |
| Boletos | ≈ 600 × 2 | ≈ 1 200 |
| **Total** | | **≈ 3 900 al día, el 3,9 % de la cuota gratuita (100 k)** |

El abuso con solicitudes rechazadas por los contadores deja de costar escrituras, **con la corrección H6** (`docs/seguridad.md`):

- **Antes de H6 (medido por `cyberbot`): 260 escrituras por sujeto al día** en `/boletos`, y lo mismo en `/propuestas`. `limitarIp()` incrementaba la regla por hora **antes** de consultar la diaria, así que, con el cupo diario agotado, cada sujeto seguía escribiendo 10 filas por hora durante todo el día. La cifra "unas 30" que decía este apartado era incorrecta.
- **Con H6 (backend):** `limitarIp()` lee primero el contador diario (`SELECT`, 0 escrituras) y responde 429 sin escribir si ya está en su máximo. El techo vuelve a ser el previsto: **unas 40 escrituras por sujeto al día** en cada ruta (las 20 solicitudes admitidas × 2 contadores, hora y día). Por encima de eso, 0 escrituras. Puede pasarse por 1 o 2 en una carrera entre solicitudes simultáneas, y se acepta.
- Un atacante con un /48 multiplica esa cifra por la cantidad de /64 que use. Es el mismo riesgo de los eventos (60 por minuto por sujeto), que queda pendiente de B6.

Las lecturas no cambian de forma apreciable: verificar un boleto no lee D1. Workers suma 1 solicitud por propuesta y siteverify sigue acotado por el límite de `/boletos`.

**Riesgos residuales:**

- **H4 → baja.**
  - Antes, agotar las 500 fotos diarias exigía 9 IP o /64 y ningún reto. Ahora exige ≥ 167 IP o /64 (3 fotos cada una) **y** ≥ 167 Turnstile resueltos (3 fotos por boleto) dentro del mismo día UTC.
  - Un servicio de resolución de retos lo hace posible por pocos dólares: se acepta. El impacto no cambia (solo las fotos; las propuestas siguen funcionando).
  - Turnstile es ahora la defensa principal (H8): sin `TURNSTILE_SECRETO`, `/boletos` entrega boletos sin reto y H4 se reabre. Por eso el checklist de §15.11 lo exige.
  - **Palanca si se ve un ataque a las fotos** (muchos 503 `capacidad_agotada` en `/fotos`): bajar `LIMITES.fotosPorBoleto` de 3 a **1** en `js/limites.js`. Agotar las 500 fotos pasa a exigir **500 Turnstile resueltos al día en lugar de 167**. Lo cambia solo el arquitecto y requiere desplegar el Worker y el frontend juntos (§15.11). El frontend ya renueva el boleto al recibir `boleto_agotado` (§15.5), pero con 1 foto por boleto cada foto puede pedir un reto. La opción de fondo sigue siendo contar el tope global por bytes (opción 1 de `cyberbot`).
- **H5 → sin cambio, aceptado.** Las ventanas se reinician a las 00:00 UTC. Los boletos duran 60 min, así que solo se pueden acumular los de la última hora, y aun así cada subida gasta el cupo de su IP del día nuevo.
- **Nuevo: IP compartida (CGNAT de operadoras móviles, redes de escuela u oficina).** El cupo de 3 fotos al día por IPv4 es compartido: dos personas detrás de la misma IP pública se lo quitan entre sí. Las IPv6 móviles (un /64 por equipo) no se ven afectadas. Se acepta por decisión del usuario. Señal de alarma: quejas o muchos 429 en `/fotos`. Mitigación: subir el cupo diario (6–9) y dejar que el boleto haga el trabajo.
- **H7 (informativa) → aceptado: los rechazos tardíos y los reemplazos gastan cupo.**
  - En `POST /fotos`, un 429 (cupo diario) gasta el uso del boleto, y un 503 (tope global) gasta el uso del boleto **y** el cupo diario de la IP, porque esos contadores se consumen antes (§15.3, pasos 3–5). Tampoco se devuelven si falla R2.
  - Durante un ataque H4, cada intento legítimo quema su cupo, que de todos modos ya no serviría ese día.
  - Quitar una foto y subir otra cuenta como una subida más (lo explica el texto de ayuda del editor). Una propuesta con fotos reemplazadas puede chocar con el 429 el mismo día.
  - Motivo: devolver usos agregaría escrituras y carreras. Se revisa junto con el cupo de CGNAT.
- **Boleto robado** (por una extensión o un XSS, mitigado por la CSP): vale como mucho 3 fotos y 1 propuesta durante 60 min.
- **Filtración de `SAL_IP`:** además de revertir los hashes de IP, permitiría falsificar boletos. Lo que queda expuesto es el mismo secreto de antes. Se rota según §15.2.

### 15.11 Despliegue

- Sin migración de D1 y **sin secreto nuevo**: la llave sale de `SAL_IP`, que ya existe.
- **Antes de publicar, `npx wrangler secret list` (H8):**
  - Debe mostrar **`SAL_IP` y `TURNSTILE_SECRETO`**. Si falta `TURNSTILE_SECRETO`, `/boletos` entrega boletos sin reto y H4 se reabre. Si falta `SAL_IP`, las rutas con boleto responden 500 (B7.1).
  - **No** debe mostrar `PERMITIR_LOCALHOST` (v2.1: solo existe en `api/.dev.vars`).
- **siteverify comprueba el `hostname` (H8, backend):** un token de Turnstile solo es válido si el `hostname` que devuelve Cloudflare coincide con el host de alguno de los `ORIGENES_PERMITIDOS`. Además se acepta `localhost` (y `127.0.0.1`) solo con `PERMITIR_LOCALHOST="1"`, y `example.com` solo con los secretos de prueba de Cloudflare (`1x0000000000000000000000000000000AA` y similares), que es lo que devuelve siteverify en ese caso. Si el host no coincide → 403 `verificacion_bot`. Consecuencia: si se cambia el dominio del frontend, hay que actualizar `ORIGENES_PERMITIDOS` (y la lista de dominios de la site key), o Turnstile fallará.
- El Worker y el frontend se publican **juntos**:
  1. `npx vitest run` y `npx tsc --noEmit` en verde.
  2. `npx wrangler deploy`.
  3. `git push` del frontend, de inmediato.
- Entre los dos pasos, y mientras dure la caché de GitHub Pages (`max-age=600`, unos 10 min), el frontend viejo recibe 401 `boleto_ausente` al subir fotos. Las fotos son opcionales y las propuestas se siguen creando con `X-Turnstile-Token`. Se acepta.
- La v2.1, que tampoco está desplegada, sale en el mismo deploy.
- **Verificación en producción:**
  - `POST /fotos` sin boleto → 401.
  - `POST /boletos` sin token → 403 `verificacion_bot` (confirma que `TURNSTILE_SECRETO` está activo).
  - El generador en Pages crea una propuesta con 3 fotos y la 4.ª entrada queda deshabilitada.
  - `http://localhost:8000` no recibe CORS (2.1).

### 15.12 Revisión de B7 + F7 (2026-10-18): desviaciones aceptadas

El arquitecto revisó el diff completo de `api/**` y del frontend. `npx vitest run` (135 tests en 7 archivos) y `npx tsc --noEmit` pasan, y todos los módulos de `js/` se analizan como ES Modules sin errores. Se aceptan **todas** las desviaciones, sin correcciones pendientes de ninguno de los dos agentes.

**Backend (B7):**

| # | Desviación | Decisión y motivo |
|---|------------|-------------------|
| B7.1 | Con Turnstile activo y sin `SAL_IP`, `POST /fotos` y `POST /propuestas` con `X-Boleto` también responden 500 `interno` (`boleto_sin_sal`), no solo `/boletos`. Vive en `llaveDelEntorno()` | **Aceptada.** Es la misma regla de "falla cerrada" de §15.1 aplicada a la verificación: con la sal vacía cualquiera podría firmar boletos y saltarse el cupo |
| B7.2 | En `POST /boletos`, la comprobación de la sal va **antes** de `limitarIp` | **Aceptada.** Con el Worker mal configurado se responde 500 sin gastar escrituras de D1 ni el cupo de nadie |
| B7.3 | `verificarBoleto` rechaza una `F` en base64url no canónica (bits de relleno distintos de cero) | **Aceptada** e incorporada a §15.1, paso 1. Un boleto tiene una sola forma escrita; no cambia nada para el frontend, que trata el boleto como texto opaco |
| B7.4 | Internos: `incrementar()` devuelve `{ permitido, reintentarEn }`; nuevas `sumarSiCabe()` (contador condicional genérico, también usado por `consumirBoleto`) y `consumirCupoDiarioIp()` | **Aceptada.** No cambia el contrato HTTP; el SQL es el de §15.3 |

**Frontend (F7):**

| # | Desviación | Decisión y motivo |
|---|------------|-------------------|
| F7.1 | `js/boleto.js` exporta también `prepararBoleto()` | **Aceptada** e incorporada a §15.7. Es lo que permite pedir el boleto en paralelo con la compresión (§15.6) |
| F7.2 | Los errores de `obtenerBoleto` llevan `error.origen = 'boleto'` | **Aceptada** e incorporada a §15.7. Sin esa marca, un 429 de `/boletos` mostraría "Ya subiste 3 fotos hoy…", que sería falso |
| F7.3 | Mock: cada boleto guardado lleva su `firma` (para detectar boletos alterados) y el fallo inyectado `demasiadas_solicitudes` solo afecta a `subirFoto` | **Aceptada.** Ajusta §15.8: en el Worker, el 429 que interesa probar (cupo diario) solo existe en `/fotos` |
| F7.4 | `#turnstile` sale del `<form>` y pasa a ser `<section class="panel-verificacion">` fijo abajo, después de `<main>`; invisible (recortado, no `display: none`, para que el iframe cargue) hasta `before-interactive-callback` | **Aceptada.** Es lo que pedía §15.6 ("en el viewport"). La CSP no cambia |
| F7.5 | `js/config.js` usa la *site key* de prueba `1x00000000000000000000AA` cuando `ES_LOCAL` | **Aceptada.** Ya estaba sugerida en §15.9 "Integración". La site key de prueba es pública y solo pasa en localhost; producción sigue con la real |

**Pendiente (no bloquea la aceptación, sí el deploy):**

1. **I3 en un navegador real** (Chrome, y si se puede Firefox y Safari) con el widget de verdad: `wrangler dev` con `TURNSTILE_SECRETO=1x0000000000000000000000000000000AA` y el frontend en modo api. Recorrer §15.9 "Integración" y revisar que la consola no tenga **violaciones de CSP** (jsdom no aplica la CSP, así que esto no está probado).
2. **Deploy conjunto v2.1 + v2.2** según §15.11 (`npx wrangler deploy` y enseguida `git push`), **solo con autorización del usuario**.
3. ~~Revisión de seguridad de la v2.2 por `cyberbot`~~ **Hecha (2026-10-18):** lista para el deploy conjunto, H4 mitigado a baja y tres hallazgos nuevos (`docs/seguridad.md`, "Revisión del contrato v2.2"): H6 (escrituras de `limitarIp()`, en corrección por backend; cifra corregida en §15.10), H7 (aceptado, §15.10) y H8 (checklist de §15.11; comprobación del `hostname` en corrección por backend). Las correcciones de H6 y H8 deben estar en verde antes de I3.
