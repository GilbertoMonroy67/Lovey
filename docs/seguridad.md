# Seguridad — Noviazgo

> Propiedad del agente `cyberbot` (`.claude/agents/cyberbot.md`). Registro de auditorías, controles y riesgos aceptados.
> El contrato técnico vigente está en [`arquitectura.md`](arquitectura.md) (§13: cifrado de extremo a extremo y endurecimiento).

## Modelo de amenazas (resumen)

| Activo | Quién lo quiere | Defensa principal |
|--------|-----------------|-------------------|
| Textos y fotos de la propuesta | Cualquiera con acceso a la nube (D1/R2), al Worker o a sus logs | Cifrado de extremo a extremo (AES-GCM 256) y llave solo en el fragmento `#c=` |
| Panel de respuestas | Quien adivine o robe el enlace privado | `claveAdmin` de 190 bits en `#k=`; el servidor solo guarda su SHA-256 y lo compara en tiempo constante |
| Cuota del plan gratuito ("denial of wallet") | Bots y abuso | Límites por hash de IP, topes globales diarios, limpieza de huérfanas a las 24 h y Turnstile opcional |
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
