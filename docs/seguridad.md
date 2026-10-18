# Seguridad — Noviazgo

> Propiedad del agente `cyberbot` (`.claude/agents/cyberbot.md`). Registro de auditorías, controles y riesgos aceptados.
> El contrato técnico vigente está en [`arquitectura.md`](arquitectura.md) (§13: cifrado de extremo a extremo y endurecimiento).

## Modelo de amenazas (resumen)

| Activo | Quién lo quiere | Defensa principal |
|--------|-----------------|-------------------|
| Textos y fotos de la propuesta | Cualquiera con acceso a la nube (D1/R2), al Worker o a sus logs | Cifrado de extremo a extremo (AES-GCM 256) y llave solo en el fragmento `#c=` |
| Panel de respuestas | Quien adivine o robe el enlace privado | `claveAdmin` de 190 bits en `#k=`; el servidor solo guarda su SHA-256 y lo compara en tiempo constante |
| Cuota del plan gratuito ("denial of wallet") | Bots y abuso | Límites por hash de IP (IPv6 por `/64`), topes globales diarios, contadores condicionales, boleto de subida HMAC tras Turnstile (v2.2), limpieza de huérfanas a las 24 h |
| Privacidad de quien recibe | Rastreo y metadatos | IP solo como hash con sal, fotos sin EXIF, `no-referrer`, expiración a 30 días |
| Integridad de la página | XSS e inyección | Solo `textContent`, CSP estricta, URLs de foto validadas y esquemas Zod `.strict()` |

## Auditoría 2026-10-11 — los 20 controles pedidos

Alcance: frontend (`*.html`, `js/`), Worker (`api/src`), configuración (`wrangler.jsonc`, `.gitignore`), historial de git y dependencias.
Verificación: 93 tests del Worker y `tsc` limpio. Integración con los módulos reales del navegador contra `wrangler dev --local`: 26 comprobaciones en modo api, 20 en modo mock y recorridos completos de `index.html`, `pregunta.html` (incluidas una propuesta v1 heredada y enlaces sin llave o con la llave cortada) y `respuestas.html` (con y sin llave).

| # | Control | Estado | Detalle |
|---|---------|--------|---------|
| 1 | Ocultar las API keys | ✅ Ya cumplía | El frontend no tiene llaves. La URL de la API es pública por diseño. La *site key* de Turnstile es pública por diseño; la *secret key* va solo en `wrangler secret`. |
| 2 | Eliminar los secretos de git | ✅ Verificado | `git log --all -p` revisado: sin tokens, llaves privadas ni `.dev.vars`. `SAL_IP` nunca estuvo en un archivo. `.gitignore` cubre `.env*`, `.dev.vars*`, `*.pem`, `*.key` y `.wrangler/`. No hubo que reescribir el historial. |
| 3 | Key pública para DB | ➖ No aplica | Es un concepto de Supabase/Firebase. D1 **no** se expone al navegador: solo el Worker lo consulta con su binding. No existe ninguna llave de base de datos en el cliente. |
| 4 | Row Level Security | ➖ No aplica (equivalente cumplido) | SQLite/D1 no tiene RLS. El equivalente está en el Worker: cada consulta filtra por `propuesta_id` y el panel y `DELETE` exigen la `claveAdmin` de **esa** propuesta. |
| 5 | Cifrar datos sensibles y fotos | ✅ **Implementado** | AES-GCM 256 en el navegador (`js/cifrado.js`). Textos, nombres, opciones, nota y bytes de cada foto se cifran antes de subir. D1 y R2 solo guardan texto cifrado. La llave viaja en `#c=` y nunca llega al servidor. Probado: el GET crudo, el panel crudo y el objeto de R2 no contienen nada en claro, y el Worker rechaza fotos sin cifrar. |
| 6 | Forzar la autenticación | ✅ Ya cumplía | El panel y `DELETE` exigen `Authorization: Bearer <claveAdmin>`, y sin ella responden 401. Sin registro por decisión del proyecto (quien recibe nunca ve un login). |
| 7 | Restringir el acceso a registros | ✅ Ya cumplía | IDs de 71 bits aleatorios (no enumerables). El `GET` público no expone el hash de la clave, el tema de ntfy, IPs ni eventos. Desde v2 tampoco hay contenido en claro. |
| 8 | Bloquear la manipulación de campos | ✅ **Implementado** | Todos los esquemas Zod son `.strict()`: mandar `id`, `claveAdmin`, `expiraEn`, `ntfyTema` o cualquier campo extra → 422. El servidor arma explícitamente lo que guarda. Con tests. |
| 9 | Proteger las cookies de sesión | ➖ No aplica | La app no usa cookies ni sesiones (CORS sin credenciales y `credentials: 'omit'` en `fetch`). Se retomará con el login de Google, que exige `HttpOnly; Secure; SameSite`. |
| 10 | Hashear contraseñas | ✅ Ya cumplía (no hay contraseñas) | La única credencial es la `claveAdmin` (32 caracteres base62 ≈ 190 bits), guardada como SHA-256. Con esa entropía no hace falta un hash lento (bcrypt/argon2), que solo es necesario para contraseñas humanas débiles. |
| 11 | Rate limiting | ✅ Ya cumplía | Por hash de IP con sal: fotos 30/h, propuestas 10/h, eventos 60/min, panel 30/min, lectura 120/min. Topes globales diarios: 500 fotos y 300 propuestas. Pendiente B6 (binding `ratelimits`) solo por costo, no por seguridad. |
| 12 | Protección contra bots | ✅ **Implementado y activo (2026-10-11)** | Cloudflare Turnstile en `POST /propuestas`, en modo *Managed* y gratuito. Falla cerrado si siteverify no responde. Se activa con `TURNSTILE_SITIO` + `TURNSTILE_SECRETO` (`arquitectura.md` §9, paso 9b). |
| 13 | Parametrizar queries | ✅ Ya cumplía | Todo el SQL usa `prepare().bind()`. Las listas `IN (...)` generan solo marcadores `?n`, nunca concatenan valores. |
| 14 | Validar inputs | ✅ Reforzado | Servidor: Zod `.strict()` sobre el sobre, ids por regex, tamaños, base64url y bytes. Navegador: §3.3 completo antes de cifrar (el servidor ya no puede leer los textos). |
| 15 | Sanitizar contenido | ✅ Reforzado | Nunca `innerHTML`/`eval`; todo con `textContent`. Al descifrar, `pregunta.js` vuelve a normalizar y truncar. CSP nueva sin scripts en línea. Las fotos se muestran solo como `blob:` de JPEG/WebP detectados por bytes mágicos. |
| 16 | Restringir archivos | ✅ **Implementado** | Solo `application/octet-stream` cifrado (versión 1, ≥ 30 bytes y ≤ 512 029 bytes). Las imágenes en claro se rechazan. Se sirven como `attachment` con `nosniff`, CSP `sandbox` y CORP `same-origin`: no sirven como hosting de imágenes ni para inyectar HTML. |
| 17 | Devolver solo los datos necesarios | ✅ **Mejorado** | El `GET` v2 devuelve solo `{ v, id, cifrado, fotos[{id,url}], fechas }`. El panel ya no manda el nombre y envía el contenido cifrado solo en la primera consulta. Con test sobre las claves exactas. |
| 18 | Security headers | ✅ **Implementado** | API: CSP `default-src 'none'; frame-ancestors 'none'; sandbox`, `X-Frame-Options: DENY`, CORP `same-origin`, HSTS, `nosniff`, `no-referrer` y `no-store`. Frontend: CSP por `<meta>` y `no-referrer` en las 3 páginas. |
| 19 | Forzar HTTPS | ✅ **Implementado** | El Worker antes respondía 200 por `http://` (verificado con `curl`). Ahora `GET` → 301 a https, el resto → 403, y HSTS. GitHub Pages ya redirige (301). La URL de la API en `config.js` es `https://`. |
| 20 | Escanear dependencias | ✅ Revisado | `npm audit --omit=dev`: **0 vulnerabilidades en producción** (hono, zod). Se actualizaron wrangler (4.149) y zod (4.6.6). Quedan avisos altos en `sharp`/`undici` dentro de `miniflare` (solo desarrollo, ver riesgos). Frontend sin dependencias. |

## Auditoría 2026-10-18: búsqueda de una vulnerabilidad explotable

**Alcance:** todo `api/src/**`, `js/**` y las tres páginas HTML. También se revisaron la configuración (`wrangler.jsonc`, `.gitignore`, `git ls-files`) y los commits desde el 2026-10-11: no hay código nuevo, solo cambios en `wrangler.jsonc` y en documentación.

**Sin hallazgos (revisado de nuevo):**
- XSS: no hay `innerHTML`, `eval` ni manejadores en línea, y `href`/`src` solo reciben URLs propias o `blob:`.
- `urlFotoValida()`, `#k=`/`#c=` y CSP.
- Comparación de la `claveAdmin` en tiempo constante y autorización del panel y del `DELETE`.
- SQL parametrizado, Zod `.strict()`, CORS con origen exacto, ids sin sesgo, cabeceras de las fotos, ntfy y respuestas públicas.

**Prueba:** copia del Worker en el scratchpad (sin tocar `api/`), con `TURNSTILE_SECRETO` falso y `vitest`.

| # | Severidad | Hallazgo | Dueño | Estado |
|---|-----------|----------|-------|--------|
| H1 | **Media** (confirmado) | `POST /propuestas` consume el tope global diario **antes** de verificar Turnstile (`api/src/rutas/propuestas.ts:18-19`). Con 300 solicitudes sin token, todas responden 403, pero el contador `propuestas:global` llega a 300 y cualquier usuario legítimo recibe 503 `capacidad_agotada` hasta el día siguiente. Basta con 30 IP (10 por hora cada una), y un solo `/64` de IPv6 da miles de direcciones. Turnstile no protege el tope que debía proteger. | backend | **Corregido (pendiente de deploy)**, ver revisión abajo |
| H2 | **Media** (confirmado) | `POST /fotos` no tiene protección contra bots y su tope global es de 500 al día. Con 500 subidas de 30 bytes basura (byte 0 = 1), hechas desde 17 IP, la subida de fotos queda bloqueada para todos durante el día. Lo agrava que el límite por IP se aplica a la dirección IPv6 completa (`api/src/limite-tasa.ts:35`) y no a su `/64`. | backend (+ arquitecto por §5.5) | **Corregido con el boleto v2.2 (pendiente de deploy)**, ver "Revisión del contrato v2.2" |
| H3 | Informativa | El Worker de producción acepta siempre `http://localhost:*` como origen CORS (`api/src/cors.ts:5,9`). No hay impacto real porque la autorización depende del Bearer y no de CORS, pero sobra en producción. | backend | **Corregido (pendiente de deploy)** |

**Corrección propuesta para H1 y H2:**
1. Separar `limitar()` en `limitarIp()` y `consumirTopeGlobal()`.
2. En `POST /propuestas`, aplicar el orden límite por IP → Turnstile → Zod → fotos → tope global.
3. Normalizar las direcciones IPv6 a su `/64` antes de calcular el hash.
4. Añadir un tope diario por IP: `fotos` 60 y `propuestas` 20.

**Verificación:** un test en el que 300 solicitudes sin token no muevan `propuestas:global` y una IP nueva con token válido no reciba 503, más un test de que dos IPv6 del mismo `/64` comparten contador.

### Revisión de las correcciones (2026-10-18, sin commit ni deploy)

**Alcance:** `git diff -- api/` (limite-tasa, cors, rutas de fotos y propuestas, tipos, tests, `wrangler.jsonc`, `.dev.vars.example`). No se probó contra producción.

**Pruebas:**
- `npx vitest run`: 109/109 en verde (incluye `api/test/auditoria-2026-10-18.test.ts`).
- `npx tsc --noEmit`: limpio.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- PoC original re-ejecutada sobre una copia del código nuevo en el scratchpad, con Turnstile activo:
  - H1: 300 POST sin token → 300 × 403 y `propuestas:global` = 0. Una IP nueva crea su propuesta (201).
  - H1 desde un solo `/64`: 10 × 403 y 290 × 429.
  - H2 original (500 fotos basura desde 17 direcciones de un `/64`): 30 × 201 y 470 × 429. La víctima sube su foto (201).

**Veredicto por hallazgo:**
- **H1, corregido.** En `POST /propuestas`, antes de `consumirTopeGlobal()` solo hay rechazos que no gastan el tope: límite por IP, Turnstile, JSON, Zod y fotos. Después solo quedan fallos de D1 y la carrera de fotos, que es rara. El límite por IP sigue antes de siteverify.
- **H2, mitigado pero no cerrado.** En `POST /fotos`, los 415 y 413 ya no gastan el tope. Pero 30 bytes basura con el byte 0 = 1 tienen forma válida de foto cifrada y **sí** lo gastan. El reorden no evita la PoC original: la frenan el `/64` y el tope diario por IP. Lo que queda abierto pasa a H4.
- **H3, corregido.** `PERMITIR_LOCALHOST` no está en `wrangler.jsonc` ni en `env`, y no hay `keep_vars`. Solo vale `"1"` exacto. Solo existe en `api/.dev.vars`, que está ignorado y `wrangler deploy` no sube. Los tests corren como producción (`PERMITIR_LOCALHOST: ''`).
- **`normalizarIp`, sin evasión.** Probadas: mayúsculas, ceros a la izquierda, `::` en cualquier posición, corchetes, espacios, zona `%`, IPv4 incrustada y `::ffff:` en notación punto y en hex. Todas dan el mismo `/64` (o la IPv4 en el caso mapeado). Las entradas inválidas no lanzan excepción, se usan tal cual y no caen en el cubo de una IP real. En producción `CF-Connecting-IP` lo escribe Cloudflare: el cliente no puede falsearlo.
- **Contadores, bien.** La clave es `accion:dia:<hash>:<ventana UTC>` y no la controla el cliente. No choca con la horaria ni con `global`. La limpieza solo borra ventanas vencidas. `conteo` es un entero de 64 bits de SQLite, así que no se desborda.

**Hallazgos nuevos:**

| # | Severidad | Hallazgo | Dueño | Estado |
|---|-----------|----------|-------|--------|
| H4 | **Baja-media** (confirmado) | Resto de H2: `POST /fotos` sigue sin protección contra bots y el tope global (500) se agota con 9 sujetos × 60 subidas de 30 bytes basura. Un sujeto es una IPv4 o un `/64`, y un VPS común da un `/48` (65 536 `/64`). Confirmado en el scratchpad: 500 aceptadas, luego 503 para la víctima. Impacto: nadie sube fotos hasta las 00:00 UTC (las 18:00 en México, plena hora de uso). Las propuestas sin fotos siguen funcionando. | backend + arquitecto | **Mitigado a baja con el boleto v2.2 (pendiente de deploy); residual aceptado** |
| H5 | Informativa | Las ventanas diarias (por IP y global) se reinician juntas a las 00:00 UTC. Un atacante puede gastar el día nuevo de golpe justo al reinicio. Las entradas sin sentido (`::`, `::1`, `::%`) caen en `0000:...::/64`. Cloudflare nunca las envía, así que no tiene impacto. | backend | Aceptado (sin cambio) |

**Opciones para H4** (decide el arquitecto, de menor a mayor costo):
1. Contar el tope global de fotos por **bytes** (por ejemplo ≈ 250 MB al día) en vez de por número. Agotarlo exigiría subir de verdad unos 500 × 512 KB.
2. Que la foto huérfana no gaste el tope global al subirse. El tope se cobra al asociarla en `POST /propuestas`, que ya pasó Turnstile. El tope de huérfanas aparte puede ser más holgado, porque el cron las borra en 24 h.
3. B6 (`ratelimits`) más estricto o un ticket corto emitido tras Turnstile para `/fotos` (más complejidad).

El usuario eligió la opción 3 (boleto) más 3 fotos por IP al día: contrato v2.2, `arquitectura.md` §15.

### Revisión del contrato v2.2: boleto de subida (2026-10-18, sin commit ni deploy)

**Alcance:** `git diff` y archivos nuevos de B7 y F7: `api/src/boleto.ts`, `api/src/rutas/boletos.ts`, `limite-tasa.ts`, rutas de fotos y propuestas, `cors.ts`, `errores.ts`, `esquemas.ts`, `api/test/boletos.test.ts`, `js/boleto.js`, `js/api.js`, `js/editor-pasos.js`, `js/generador.js`, `js/config.js`, `index.html` y `css/styles.css`. No se probó contra producción.

**Pruebas:**
- `npx vitest run`: 135/135 en verde. `npx tsc --noEmit`: limpio. `npm audit --omit=dev`: 0 vulnerabilidades.
- PoC adaptada en una copia del Worker en el scratchpad (`residual22.test.ts`), con Turnstile activo y siteverify simulado:
  - **PoC vieja de H4** (9 sujetos × 60 fotos basura, renovando el boleto al agotarse): solo 27 aceptadas (3 por sujeto) y el resto 403 o 429. La víctima sube su foto (201).
  - **Costo nuevo de H4:** la víctima recibe 503 después de **167 sujetos y 167 resoluciones de Turnstile** (500 fotos).
  - **Carrera:** un boleto usado en paralelo desde 10 IP da exactamente 3 × 201 y 7 × 403. El contador queda en 3.
  - **H1 con boleto:** un boleto usado en 300 propuestas desde 57 IP (30 de ellas en paralelo) da 1 × 201 y 299 × 403 `boleto_agotado`. `propuestas:global` = 1 y hay una sola llamada a siteverify.
  - **Rechazos de `/fotos` sin escrituras:** sin boleto, con `f`, `exp` o `n` alterados, firmado con la sal vacía o con otra sal, 415 y 413. Todos dan 401, 415 o 413, y `limites` queda idéntica.
  - **Sin `SAL_IP`** (`''` o sin definir) con Turnstile: `/boletos`, `/fotos` y `/propuestas` con un boleto firmado con la sal vacía responden 500, sin llamar a siteverify. `/boletos` y `/fotos` no escriben nada. Con la sal real, ese mismo boleto da 401.
  - **siteverify forzado:** con 40 intentos por sujeto se llama a siteverify como mucho 10 veces por hora en `/boletos` y 10 en `/propuestas`.
  - **IP compartida:** con 3 fotos de A, la 4.ª subida (de B, o de A tras quitar una) da 429 y además gasta un uso del boleto de B.

**Veredicto por punto:**
- **Boleto no falsificable.** La llave sale de HKDF-SHA256 con `info` propio, no es extraíble y se cachea por sal. La firma se comprueba con `crypto.subtle.verify` antes de parsear `P` y cubre `b1.` + `P`. La firma exige 32 bytes en codificación canónica. `f` se acota a 1–3 y `n` a 16 base62. La vigencia solo usa el reloj del servidor. Cualquier cambio en `f`, `exp` o el nonce invalida la firma.
- **Sin sal no hay camino abierto.** `llaveDelEntorno()` (`api/src/boleto.ts:72-83`) lanza 500 si falta `SAL_IP` y existe `TURNSTILE_SECRETO`. Las tres rutas la llaman antes de aceptar un boleto. La llave de la sal vacía solo existe sin Turnstile, y en ese caso `/boletos` regala boletos de todos modos (ver H8).
- **Sin reutilización ni carreras.** `sumarSiCabe()` es un único `INSERT … ON CONFLICT DO UPDATE … WHERE conteo < ?3 RETURNING`, atómico en D1. Los contadores `boleto:<n>` y `boleto-prop:<n>` vencen en `exp`, y la limpieza (`expira_en <= ahora`) es coherente con `exp * 1000 <= ahora` ⇒ vencido. No se puede reutilizar un boleto tras borrar su contador.
- **El boleto no se filtra.** No va en URLs, `localStorage` ni `sessionStorage`: vive en memoria en `js/boleto.js`. El mock guarda nonces de boletos falsos en `localStorage`, pero solo en desarrollo. Ningún `console.*` lo imprime, `manejarError` no lo incluye y los logs de invocación están apagados.
- **Orden y costo.** En `/fotos`, todo rechazo previo al consumo es CPU pura, con 0 escrituras. Un 429 o un 503 posterior gasta el uso del boleto y el cupo de la IP, como dice §15.3 (aceptado, H7). En `/propuestas` y `/boletos`, el límite por IP va antes de siteverify a propósito, así que un 403 o un 422 sí escriben los contadores por IP (no el tope global ni el boleto). La cifra de escrituras de §15.10 está mal (H6).
- **H1 sigue cerrado.** Cada boleto da una sola propuesta (`boleto-prop`, máximo 1, consumido después de Zod y de las fotos y antes del tope global). Sin boleto vuelve a `exigirHumano()`, y los tokens de Turnstile son de un solo uso.
- **Frontend.** No hay `innerHTML` nuevo: todo pasa por `crear()` y `textContent`. La CSP no cambia (`challenges.cloudflare.com` ya estaba en `script-src` y `frame-src`). El reintento único es correcto: `conBoleto()` solo reintenta ante `CODIGOS_BOLETO`, descarta solo el boleto fallido y las fotos concurrentes comparten `enVuelo`, así que se resuelve un solo Turnstile. No hay bucle. La site key de prueba solo se usa con `ES_LOCAL` y fallaría contra el secreto real.
- **Clickjacking del panel de Turnstile:** no es útil. Si alguien enmarca `index.html`, el boleto queda en la memoria del marco, que el atacante no puede leer entre orígenes. Resolver el reto solo beneficia a la víctima. El riesgo sigue cubierto por el aceptado "Clickjacking en GitHub Pages".
- **H4 queda en baja.** Con IPv6, un `/48` de VPS da 65 536 sujetos, así que la barrera real son las **167 resoluciones de Turnstile** al día (unos centavos o pocos dólares en un servicio de resolución). Antes bastaban 9 sujetos y ningún reto. El impacto no cambia: solo las fotos hasta las 00:00 UTC. Si se observa el ataque, la palanca más efectiva es `fotosPorBoleto = 1`, que sube la barrera a 500 Turnstile. Contar el tope por bytes ayuda poco, porque subir 250 MB desde un VPS es barato.

**Hallazgos nuevos:**

| # | Severidad | Hallazgo | Dueño | Estado |
|---|-----------|----------|-------|--------|
| H6 | Baja (confirmado) | En `limitarIp()` (`api/src/limite-tasa.ts:172-179`) la regla corta (hora) se incrementa **antes** de consultar la diaria. Con el cupo diario agotado, cada sujeto sigue escribiendo 10 filas por hora: medido, **260 escrituras por sujeto al día** en `/boletos` (igual en `/propuestas`). §15.10 dice "unas 30". No es nuevo en esencia (eventos permite 60/min por sujeto, pendiente B6), pero la cifra del contrato es incorrecta y un `/48` multiplica el costo. **Corrección:** antes de incrementar la regla corta, leer el contador diario (`SELECT conteo FROM limites WHERE clave = ?`, 0 escrituras) y lanzar 429 si ya está en su máximo. Verificar: con el diario en 20, 15 solicitudes en otra hora no cambian `SUM(conteo)`. | backend (código) + arquitecto (§15.10) | Abierto |
| H7 | Informativa | En `/fotos`, un 429 o un 503 posteriores gastan el uso del boleto y el cupo diario de la IP (`api/src/rutas/fotos.ts:60-63`). Durante un ataque H4, cada intento legítimo quema su cupo (ya inútil ese día). Quitar una foto y subir otra cuenta como una subida más. Está documentado en §15.3 y en el texto de ayuda del editor. | backend | Aceptado |
| H8 | Informativa | **Turnstile pasa a ser la defensa principal de H4.** Si se borra `TURNSTILE_SECRETO`, `/boletos` emite boletos sin reto y H4 vuelve a costar 167 `/64` de un solo `/48`, sin ningún reto (y sin `SAL_IP` los boletos se firman con una llave pública). Además, siteverify no comprueba `hostname` ni `action` en la respuesta (`api/src/turnstile.ts:23-24`). Esto es defensa en profundidad: la site key ya está limitada al dominio de Pages. Sin `SAL_IP`, `/propuestas` escribe sus 2 contadores por IP antes del 500 (insignificante). **Corrección:** en el checklist de deploy, `npx wrangler secret list` debe mostrar `SAL_IP` **y** `TURNSTILE_SECRETO`. Opcionalmente, exigir `datos.hostname === 'gilbertomonroy67.github.io'` en siteverify. | arquitecto (checklist §15.11) + backend (opcional) | Abierto (checklist) |

## Riesgos aceptados

| Riesgo | Motivo | Revisar cuando |
|--------|--------|----------------|
| Quien tiene el enlace de la pareja puede leer la propuesta | Es el modelo: el enlace **es** la llave. Si se reenvía, el nuevo destinatario también puede leerla. | — |
| Si se pierde la llave (`#c=`), el contenido es irrecuperable | Es el precio de que el servidor no pueda leer nada. Se guarda en "Mis propuestas" de esa PC. | Si se agrega el login de Google (podría guardarse cifrada) |
| El servidor ve metadatos (cuándo abrió, intentos de No, si dijo sí, tamaños) | Son necesarios para el panel y los límites. No revelan nombres ni contenido. | — |
| El servidor no puede validar textos ni el contenido de las fotos | Consecuencia del cifrado. El tamaño está acotado y el cliente valida y vuelve a sanear al mostrar. | — |
| Clickjacking en las páginas de GitHub Pages | Pages no permite `frame-ancestors` ni `X-Frame-Options`. Las páginas no tienen acciones peligrosas sin la clave del fragmento, que un atacante no conoce. | Si se migra a Workers Assets o a un dominio propio (ahí se agrega la cabecera) |
| `localStorage` guarda `claveAdmin` y `claveCifrado` en "Mis propuestas" | Comodidad en la PC de quien envía. Un XSS podría leerlas, pero la CSP y `textContent` lo mitigan. Riesgo en equipos compartidos. | — |
| `sharp`/`undici` en `miniflare` (5 avisos altos, solo desarrollo) | Solo corren en la máquina local con `wrangler dev`/`vitest`. `npm audit fix --force` bajaría versiones y rompería el entorno. | En cada actualización de `wrangler` |
| CSP con `localhost:8787` en `connect-src` | Necesario para desarrollar en modo api. Solo permite que **nuestros** scripts se conecten a un puerto local. | — |
| H4 residual: agotar las 500 fotos diarias con 167 Turnstile resueltos (servicio de resolución) y 167 IP o `/64` | Cuesta pocos dólares, pero el impacto se limita a las fotos hasta las 00:00 UTC y las propuestas siguen funcionando. Decisión del usuario y del arquitecto (§15.10). | Si aparecen 503 `capacidad_agotada` en `/fotos`: bajar `fotosPorBoleto` a 1 |
| IP compartida (CGNAT móvil, escuela u oficina): 3 fotos al día por IPv4 para todos los que están detrás | Decisión del usuario. Las IPv6 móviles (un `/64` por equipo) no se ven afectadas. | Si hay quejas o muchos 429 en `/fotos`: subir el cupo diario a 6–9 y dejar que el boleto haga el trabajo |
| Reemplazar una foto gasta cupo (H7) | Devolver usos agregaría escrituras y carreras. El editor lo explica en el texto de ayuda. | Junto con la revisión del cupo de CGNAT |
| H5: las ventanas diarias se reinician juntas a las 00:00 UTC | Con boletos de 60 min solo se acumulan los de la última hora, y cada subida gasta el cupo del día nuevo de su IP. | — |
| Boleto robado (extensión o XSS) | Vale como mucho 3 fotos y 1 propuesta durante 60 min. La CSP y `textContent` mitigan el XSS. | — |
| Propuestas v1 (sin cifrar) en D1 hasta su expiración | Compatibilidad con enlaces ya enviados. Expiran solas a los 30 días. | 2026-11-10: se puede borrar el soporte v1 |

## Pendientes de seguridad

- [x] Widget de Turnstile creado; site key (pública) en `js/config.js` (2026-10-11).
- [x] Secret key guardada solo en el Worker (`TURNSTILE_SECRETO`), sin pasar por el repo ni por el chat. Verificado en producción: sin token o con un token falso → 403 `verificacion_bot`.
- [x] Deploy v2 del Worker y del frontend (2026-10-11).
- [x] Verificado en producción:
  - HTTP da 301 (GET) y 403 (POST), con las cabeceras nuevas presentes.
  - CORS correcto.
  - Propuesta de prueba: D1 y R2 cifrados, se descifra con el enlace y se borró.
  - Las 3 propuestas v1 siguen abriéndose.
- [ ] Prueba manual en navegadores reales (Chrome, Firefox, Safari, iOS y Android): consola sin errores de CSP, fotos descifradas y Turnstile si está activo.
- [ ] 2026-11-10: quitar el soporte de lectura de propuestas v1.
- [ ] H1/H2/H3 (2026-10-18): corregidos en `api/` (109 tests en verde); **falta el deploy** y comprobar en producción que `http://localhost` ya no recibe CORS. El arquitecto pasa los topes diarios por IP a §5.5.
- [x] H4 (2026-10-18): decidido el boleto v2.2 (§15), implementado (135 tests en verde) y revisado. Residual en baja, aceptado.
- [ ] Deploy conjunto v2.1 + v2.2 (§15.11). Verificar en producción: `POST /fotos` sin boleto → 401, `wrangler secret list` con `SAL_IP` y `TURNSTILE_SECRETO` (H8), y consola sin violaciones de CSP con el panel de Turnstile.
- [ ] H6: pre-chequeo de solo lectura del cupo diario en `limitarIp()` (backend) y corregir la cifra de escrituras de §15.10 (arquitecto).
- [ ] H8 (opcional): comprobar `hostname` en la respuesta de siteverify (backend).
