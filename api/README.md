# noviazgo-api

Cloudflare Worker de Noviazgo: **Hono + Zod** en TypeScript, propuestas y eventos en **D1** y fotos en **R2**.
El contrato completo (endpoints, errores, límites y CORS) está en [`../docs/arquitectura.md`](../docs/arquitectura.md) §5.
Los límites de validación se importan de [`../js/limites.js`](../js/limites.js), que es la fuente única compartida con el frontend.

## Estructura

```
api/
├── wrangler.jsonc            bindings DB (D1) y FOTOS (R2), vars, cron diario
├── migrations/0001_inicial.sql
├── src/
│   ├── index.ts              app Hono (fetch) + scheduled (cron)
│   ├── cors.ts               CORS con origen exacto, sin credenciales
│   ├── errores.ts            ErrorApi + manejador central { error: { codigo, mensaje } }
│   ├── esquemas.ts           Zod .strict() (sobre cifrado v2 y eventos) + lectura de JSON con tope de 32 KB
│   ├── limite-tasa.ts        ventana fija por hash de IP (IPv6 por /64), límite horario y diario + topes globales
│   ├── ids.ts                ids base62 sin sesgo, SHA-256, comparación en tiempo constante
│   ├── comun.ts              carga de propuestas, auth admin, URL de fotos
│   ├── ntfy.ts               reenvío push opcional (nunca rompe la respuesta)
│   ├── turnstile.ts          verificación anti-bots opcional (TURNSTILE_SECRETO)
│   ├── boleto.ts             boleto de subida firmado (HMAC con llave derivada de SAL_IP por HKDF)
│   ├── limpieza.ts           borrado de expirados, fotos huérfanas y contadores
│   └── rutas/                boletos.ts, fotos.ts, propuestas.ts, eventos.ts
└── test/                     Vitest dentro del runtime de Workers (@cloudflare/vitest-pool-workers)
```

## Endpoints (`/api/v1`)

| Método y ruta | Auth | Respuesta |
|---------------|------|-----------|
| `GET /salud` | — | `200 { ok, version }` |
| `POST /boletos` (sin cuerpo) | `X-Turnstile-Token` si Turnstile está activo | `201 { boleto, expiraEn, fotos }` |
| `POST /fotos` (`application/octet-stream` cifrado, ≤ 512 029 bytes) | `X-Boleto` (siempre) | `201 { id, url, expiraEn }` |
| `GET /fotos/:id` | — | `200` bytes cifrados (`attachment`) |
| `POST /propuestas` (`{ v: 2, cifrado, fotos ≤ 3, avisos }`) | Si Turnstile está activo: `X-Boleto` o `X-Turnstile-Token` | `201 { id, claveAdmin, expiraEn, ntfyTema }` |
| `GET /propuestas/:id` | — | `200 { v, id, cifrado, fotos, creadaEn, expiraEn }` (v1 heredadas: en claro) |
| `DELETE /propuestas/:id` | `Bearer claveAdmin` | `204` |
| `POST /propuestas/:id/eventos` (`text/plain` o JSON) | — | `202 { ok }` o `200 { ok, duplicado }` |
| `GET /propuestas/:id/eventos?desde=<cursor>` | `Bearer claveAdmin` | `200 { eventos, cursor, resumen, para, expiraEn, ntfyTema }` |

## Instalación y desarrollo local

Requisitos: Node 20 o superior.

```bash
cd api
npm install
cp .dev.vars.example .dev.vars          # cambia SAL_IP; trae PERMITIR_LOCALHOST="1" para el frontend local
npm run db:migrate:local                # crea las tablas en el D1 local (.wrangler/)
npm run dev                             # http://localhost:8787/api/v1
```

Prueba rápida:

```bash
curl -i -H 'Origin: http://localhost:8000' http://localhost:8787/api/v1/salud
```

> `http://localhost` y `http://127.0.0.1` solo son orígenes CORS válidos si `PERMITIR_LOCALHOST="1"` (solo en `.dev.vars`).
> En producción esa variable **no se define**, así que el Worker desplegado solo acepta `ORIGENES_PERMITIDOS`.
>
> El Worker solo sirve la API bajo `/api/v1/`. Abrir `http://localhost:8787/` responde `404 no_encontrado`, y eso es normal.
> La app (las páginas HTML) se sirve aparte, desde la raíz del proyecto, con `python3 -m http.server 8000`.

En local, R2 y D1 los simula Miniflare dentro de `.wrangler/` (ignorado por git). Para usar el frontend contra esta API,
ejecuta en la consola del navegador `localStorage.setItem('noviazgo:modo','api')`.

Subir una foto (v2.2): primero se pide un boleto y luego se manda en `X-Boleto`. Sin `TURNSTILE_SECRETO` en `.dev.vars`
el boleto se emite sin verificar nada, pero `POST /fotos` lo exige igual.

```bash
B=$(curl -s -X POST http://localhost:8787/api/v1/boletos | sed -E 's/.*"boleto":"([^"]+)".*/\1/')
printf '\001%063d' 0 | curl -i -X POST -H "X-Boleto: $B" -H 'Content-Type: application/octet-stream' \
  --data-binary @- http://localhost:8787/api/v1/fotos
```

Probar la limpieza programada:

```bash
npm run dev
curl "http://localhost:8787/cdn-cgi/local/scheduled"
```

## Tests y tipos

```bash
npm test            # Vitest en el runtime de Workers (D1 y R2 en memoria, sin salidas a internet)
npm run typecheck   # tsc --noEmit
npm run types       # regenera worker-configuration.d.ts si cambias wrangler.jsonc
```

## Despliegue (lo hace el usuario, una sola vez)

1. Cuenta gratuita de Cloudflare. Activa **R2** (pide un método de pago; el uso de esta app cabe en el plan gratuito)
   y crea el bucket `noviazgo-fotos`. Agrega la regla de ciclo de vida que borra el prefijo `fotos/` a los 35 días.
2. `npx wrangler login`
3. `npx wrangler d1 create noviazgo` y pega el `database_id` en `wrangler.jsonc`.
4. `npm run db:migrate:remote`
5. `npx wrangler secret put SAL_IP` (texto aleatorio largo, por ejemplo `openssl rand -base64 32`).
6. Cambia `ORIGENES_PERMITIDOS` en `wrangler.jsonc` por tu origen de GitHub Pages (`https://<usuario>.github.io`, sin ruta).
7. `npm run deploy` y copia la URL `https://noviazgo-api.<subdominio>.workers.dev/api/v1` en `API_BASE` de `js/config.js`.

Migraciones: se crean como `migrations/000N_descripcion.sql`, se aplican primero con `--local` y luego con `--remote`.
**Nunca** se edita una migración ya aplicada.

Revertir: `npx wrangler rollback` vuelve a la versión anterior del Worker. Los datos de D1 se pueden restaurar con
Time Travel (`npx wrangler d1 time-travel restore noviazgo --timestamp=<ISO>`).

## Seguridad

- Sin secretos en el repositorio: `SAL_IP` va en `wrangler secret` y, en local, en `.dev.vars` (ignorado por git).
- La `claveAdmin` solo existe en el enlace de quien envía; en D1 se guarda su SHA-256 y se compara en tiempo constante.
- La IP nunca se guarda en claro: se usa `SHA-256(SAL_IP + IP)` para los límites de tasa. Las IPv6 se agrupan por su `/64`
  (las IPv4 mapeadas `::ffff:a.b.c.d` cuentan como la IPv4).
- Límites por IP: `fotos` 3/día (sin regla horaria); `propuestas` 10/h y 20/día; `boletos` 10/h y 20/día (429). Los topes
  globales diarios (503) se gastan **al final**, solo con solicitudes que ya pasaron Turnstile (o el boleto) y las
  validaciones (auditoría 2026-10-18, H1/H2). Todos los contadores son condicionales: por encima del máximo no escriben en D1.
- **Boleto de subida (v2.2, `docs/arquitectura.md` §15, cierra H4).** `POST /boletos` lo entrega tras Turnstile:
  `b1.<P>.<F>`, válido 60 min para 3 fotos y 1 propuesta, sin atarse a la IP.
  - La firma es HMAC-SHA256 con una llave **derivada de `SAL_IP` con HKDF**: **no hace falta ningún secreto nuevo**.
    Rotar `SAL_IP` (`npx wrangler secret put SAL_IP`) invalida los boletos vigentes; el frontend pide otro y reintenta.
  - Se verifica con `crypto.subtle.verify` (tiempo constante) sin leer D1. Los usos se cuentan en `limites`
    (`boleto:<nonce>` hasta 3 y `boleto-prop:<nonce>` 1) y el cron los borra al vencer.
  - Orden en `POST /fotos`: boleto (401) → forma (415/413) → uso del boleto (403) → 3 por IP al día (429) → tope global (503) → R2.
    Lo rechazado antes de los contadores no escribe en D1.
  - Con Turnstile activo y sin `SAL_IP`, `/boletos` y `/fotos` responden 500 (falla cerrada: la llave sería pública).
- **v2: cifrado de extremo a extremo.** El Worker nunca ve textos ni fotos en claro: recibe un sobre `{ v: 2, cifrado, fotos }` y fotos `application/octet-stream`. Rechaza imágenes en claro (JPEG/WebP por bytes mágicos) y sobres mal formados. Detalle en `docs/arquitectura.md` §13.
- HTTPS obligatorio (301/403 por `http://`, salvo localhost), HSTS, CSP `sandbox`, `X-Frame-Options: DENY` y CORP `same-origin`.
- Esquemas Zod `.strict()`: cualquier campo extra (por ejemplo `claveAdmin` o `expiraEn`) → 422.
- Los logs no incluyen IP, claves ni textos de las propuestas.

## Nota de diseño: login con Google (futuro, no implementado)

- Solo para quien envía y siempre opcional; quien recibe nunca inicia sesión.
- Requisito previo: servir el frontend y la API desde el mismo sitio (Workers Assets o dominio propio), porque una cookie
  de `workers.dev` es de terceros vista desde `github.io`.
- Flujo: OIDC Authorization Code + PKCE en el servidor, con `state` y `nonce`. Se valida el ID token (JWKS de Google, `iss`,
  `aud`, `exp`, `nonce`) y se identifica al usuario por `sub`. Scopes: `openid email profile`. Librería sugerida: **Arctic**
  (solo el cliente OAuth, sin dependencias pesadas), con sesiones propias en D1.
- Esquema: nuevas tablas `usuarios` (id, google_sub único, email, nombre, creado_en) y `sesiones` (id = hash del token,
  usuario_id, expira_en) en una migración nueva. La columna `propuestas.usuario_id` ya existe.
- Sesión: cookie `HttpOnly; Secure; SameSite=Lax`, con rotación. Al iniciar sesión, las propuestas de "Mis propuestas"
  (localStorage) se pueden reclamar enviando su `claveAdmin`.
- Ofrecer borrar la cuenta y todos sus datos.
