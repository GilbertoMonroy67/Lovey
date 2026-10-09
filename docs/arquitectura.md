# Contrato de arquitectura e integración — Noviazgo v1

> **Dueño:** agente `arquitecto`. Versión del contrato: **1.1** (2026-10-07, tras la revisión final de integración; ver §12).
> Este documento es el acuerdo entre los agentes `frontend` y `backend`, que trabajan en paralelo.
> Ninguno de los dos lo modifica por su cuenta: si algo no se puede cumplir, se propone el cambio al arquitecto,
> se actualiza aquí y se registra en `CLAUDE.md`.

---

## 0. Resumen en una pantalla

| Tema | Decisión |
|------|----------|
| Frontend | Igual que antes: HTML + CSS + JS puro (ES Modules), sin build, en **GitHub Pages** (raíz del repo). |
| Backend | **Un solo Cloudflare Worker** (`api/`) con **Hono + Zod**, base de datos **D1** y fotos en **R2**. Plan gratuito ($0). |
| Fotos | Se comprimen en el navegador (WebP o JPEG, máx. 1280 px, ≤ 500 KB) y se suben al Worker, que las guarda en R2. Expiran con la propuesta. |
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
- **Abuso:** límite por IP (§5.5), tope global diario de subidas, fotos huérfanas (no asociadas a una propuesta) borradas a las 24 h y tope de 10 fotos por propuesta.
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
3. **Pasos (1 a 5):** cada paso tiene un texto ("palabras bonitas") y de 0 a 3 fotos. Se pueden agregar, quitar y reordenar con botones (sin arrastrar, por accesibilidad). Las fotos se comprimen y se suben **en cuanto se eligen**, con una barra de progreso, para que al final solo se cree la propuesta.
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
| `pasos[].fotos` | 0–3 elementos; **≤ 10 fotos en total** por propuesta |
| `fotos[].id` | `^f_[A-Za-z0-9]{16}$`; debe existir, no estar asociada a otra propuesta y no estar expirada |
| `fotos[].alt` | 0–100 caracteres |
| `pregunta` | 1–120 caracteres |
| `celebracion` | Opcional. `titulo` 1–60 caracteres; `opciones` 0–8 elementos |
| `opciones[].id` | `^[a-z0-9-]{1,20}$`, único dentro de la propuesta. Las predefinidas usan su slug; las personalizadas, `c1`…`c8`. |
| `opciones[].etiqueta` | 1–40 caracteres |
| `opciones[].emoji` | Opcional, 0–8 caracteres |
| `mensajeFinal` | 0–200 caracteres |
| Cuerpo JSON completo | ≤ 16 KB |
| Foto | `image/webp` o `image/jpeg`, ≤ 500 KB (512 000 bytes), lado mayor ≤ 1280 px (recomendado; el servidor solo exige el tamaño en bytes) |
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
| `celebracion_elegida` | Al enviar el formulario de celebración | `opcionId` (debe existir en la propuesta), `nota` (opcional) | **sí** | sí: "Ana eligió celebrar en: La BTK" |

Ejemplo de cuerpo:

```json
{ "tipo": "celebracion_elegida", "sesion": "Qw8e7r6t5y4u3i2o", "opcionId": "btk", "nota": "¡Pero tú invitas!" }
```

**Sin preflight de CORS:** los eventos se envían con `Content-Type: text/plain;charset=UTF-8` (con el JSON en el cuerpo) y sin cabeceras personalizadas. Así es una *simple request*: no hay `OPTIONS`, llega más rápido y `keepalive` funciona en todos los navegadores, ya que algunos no permitían preflight con `keepalive`. El Worker parsea el cuerpo como JSON sin importar el `Content-Type`.

---

## 5. Contrato de la API (Worker)

- **Base:** `https://noviazgo-api.<subdominio>.workers.dev/api/v1`. En desarrollo: `http://localhost:8787/api/v1` (`wrangler dev`).
- **Formato:** JSON en UTF-8, salvo la subida de fotos (binario) y la descarga de fotos.
- **Errores:** siempre `{ "error": { "codigo": "<codigo>", "mensaje": "<texto en español para mostrar>" } }`.

### 5.1 Endpoints

| Método y ruta | Auth | Request | Respuesta OK |
|---------------|------|---------|--------------|
| `GET /salud` | — | — | `200 { "ok": true, "version": 1 }` |
| `POST /fotos` | — | Cuerpo binario; `Content-Type: image/webp` o `image/jpeg` | `201 { "id": "f_…", "url": "…/fotos/f_…", "expiraEn": "<ISO, +24 h mientras sea huérfana>" }` |
| `GET /fotos/:id` | — | — | `200` con la imagen. Cabeceras: `Content-Type` guardado, `Cache-Control: private, max-age=86400` (v1.1: sin cachés compartidas), `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin` |
| `POST /propuestas` | — | JSON de §3.1 | `201 { "id": "aB3dE5fG7hJ9", "claveAdmin": "<32 caracteres>", "expiraEn": "<ISO>", "ntfyTema": "<tema>" \| null }` |
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
| 413 | `archivo_muy_grande` | Foto > 500 KB o JSON > 16 KB |
| 415 | `tipo_no_soportado` | La foto no es WebP o JPEG (por los bytes mágicos) |
| 422 | `validacion` | Falla Zod. Se agrega `detalles: [{ "campo": "pasos.0.texto", "mensaje": "…" }]` |
| 422 | `foto_invalida` | Un `fotos[].id` no existe, ya está asociado o expiró |
| 429 | `demasiadas_solicitudes` | Límite de tasa. Incluye la cabecera `Retry-After` (segundos) |
| 503 | `capacidad_agotada` | Se alcanzó el tope global diario de fotos o de propuestas |
| 500 | `interno` | Error inesperado (sin detalles internos) |

### 5.4 CORS

- La variable `ORIGENES_PERMITIDOS` (en `wrangler.jsonc`) contiene una lista separada por comas, p. ej. `https://<usuario>.github.io`.
- Además, siempre se aceptan `^http://(localhost|127\.0\.0\.1)(:\d+)?$`, para desarrollar contra producción si hace falta. No hay cookies ni credenciales, así que esto no abre ningún riesgo de sesión.
- Respuesta: `Access-Control-Allow-Origin: <origen exacto>` + `Vary: Origin`. Métodos: `GET, POST, DELETE, OPTIONS`. Cabeceras permitidas: `Content-Type, Authorization`. `Access-Control-Max-Age: 86400`. **Nunca** `Allow-Credentials`.
- Un origen no permitido recibe la respuesta sin cabeceras CORS, y el navegador la bloquea.
- `GET /fotos/:id` no necesita CORS (se usa en `<img>`).

### 5.5 Límites de tasa y cuotas

Se cuentan por **hash de IP** (`SHA-256(SAL_IP + CF-Connecting-IP)`; la IP en claro nunca se guarda), con ventana fija en la tabla `limites` de D1:

| Acción | Límite |
|--------|--------|
| `POST /fotos` | 30 por hora por IP; **500 por día en total** (tope global → 503) |
| `POST /propuestas` | 10 por hora por IP; 300 por día en total |
| `POST /eventos` | 60 por minuto por IP (además del tope por propuesta) |
| `GET /propuestas/:id/eventos` | 30 por minuto por IP (con 5 s de sondeo se usan 12) |
| `GET /propuestas/:id` | 120 por minuto por IP |

Los topes globales protegen el plan gratuito de Cloudflare (R2: 10 GB, 1 M operaciones de escritura al mes; D1: 100 k escrituras al día; Workers: 100 k solicitudes al día).

**Costo en escrituras (v1.1):** cada solicitud limitada hace 1 escritura en D1 (2 con tope global). El sondeo adaptativo de §2.3 lo reduce. Mejora pendiente (B6): mover los límites por IP de alta frecuencia (`eventos`, `panel`, `leer`) al binding `ratelimits` de Workers (ventanas de 10 o 60 s, sin escrituras en D1) y dejar en D1 solo `fotos` y `propuestas` (ventanas de 1 h y topes globales). Antes hay que confirmar que el binding está disponible en el plan gratuito de la cuenta.

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
  clave       TEXT PRIMARY KEY,           -- accion:ip_hash:ventana
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
- Variables en `wrangler.jsonc`: `ORIGENES_PERMITIDOS` y `NTFY_BASE` (v1.1; `https://ntfy.sh` por defecto, vacío = avisos desactivados; los tests lo dejan vacío para no salir a internet). `compatibility_date`: `2026-08-01`.
- Los mensajes genéricos de Zod salen en español (`z.config(es())`).

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
│   └── arquitectura.md            [arquitecto]  ← este contrato
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
│   ├── api.js                     [frontend]  adaptador: elige mock o api
│   ├── api-mock.js                [frontend]  implementación con localStorage
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
    │   └── limpieza.ts            (cron)
    └── test/                      (base, propuestas, fotos, eventos, limites-limpieza + ayuda.ts)
```

Reglas para trabajar en paralelo:

- `frontend` **no toca** `api/`. `backend` **no toca** nada fuera de `api/`.
- `docs/arquitectura.md` y `js/limites.js` solo los cambia el arquitecto. Si un agente necesita un cambio, lo pide.
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
| I1 | ambos | Integración: `MODO=api` contra `wrangler dev` (**hecha el 2026-10-07**, §12) | El flujo completo de F2 a F5 sin cambios de código |
| I2 | usuario | Deploy y prueba en móvil real desde WhatsApp | Lista de verificación de §10 |

---

## 9. Lo que el usuario debe crear o configurar a mano

1. **GitHub:** crear el repositorio, hacer `git push` y activar Pages (Settings → Pages → *Deploy from a branch* → `main` / `(root)`). Anotar `https://<usuario>.github.io/<repo>/`.
2. **Cloudflare:** crear una cuenta gratuita.
3. **R2:** activarlo en el panel (**pide registrar un método de pago**; dentro del plan gratuito el costo es $0) y crear el bucket `noviazgo-fotos`. Agregar una regla de ciclo de vida: borrar el prefijo `fotos/` a los 35 días. Recomendado: configurar una alerta de facturación.
4. **Wrangler:** `cd api && npm install && npx wrangler login`.
5. **D1:** `npx wrangler d1 create noviazgo` y pegar el `database_id` en `api/wrangler.jsonc`. Después, `npx wrangler d1 migrations apply noviazgo --remote`.
6. **Secretos y variables:** `npx wrangler secret put SAL_IP` (**obligatorio**; cualquier texto aleatorio largo, p. ej. `openssl rand -hex 32`) y poner `ORIGENES_PERMITIDOS=https://<usuario>.github.io` en `wrangler.jsonc` (sin `/<repo>` ni barra final: el origen no incluye la ruta). Comprobar con `npx wrangler secret list`.
7. **Deploy:** `npx wrangler deploy`. Copiar la URL `https://noviazgo-api.<subdominio>.workers.dev` en `API_BASE` de `js/config.js` (con `/api/v1` al final, reemplazando `TU-SUBDOMINIO`).
8. **Vista previa del enlace (Open Graph):** WhatsApp y Facebook exigen una URL **absoluta** en `og:image`. En `index.html` y `pregunta.html` cambiar `content="assets/og-imagen.png"` por `content="https://<usuario>.github.io/<repo>/assets/og-imagen.png"`. Después, `git push`.
9. **Opcional:** instalar la app de ntfy en el celular para recibir los avisos push.
10. **Futuro (no en v1):** proyecto en Google Cloud Console con un cliente OAuth y URIs de redirección, si se activa el login con Google.

## 10. Verificación de extremo a extremo (antes de dar v1 por terminada)

- [ ] En `https://<usuario>.github.io/<repo>/` el generador crea una propuesta con 3 pasos y 4 fotos.
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
