# Noviazgo 💌

Una página para pedirle a alguien que sea tu pareja (novia, novio, esposa, esposo o una cita), con palabras bonitas, fotos y una pregunta a la que **no se puede decir que no**: el botón «No» huye del cursor, del dedo y hasta del teclado.

- **`index.html`, el generador:** escribes los nombres, eliges una plantilla, armas de 1 a 5 pasos con texto y fotos, ajustas la pregunta y eliges las opciones para celebrar. Obtienes dos enlaces: uno para tu pareja y uno privado para ver sus respuestas.
- **`pregunta.html`, lo que vive tu pareja:** recorre los pasos, ve la pregunta (el «No» huye y el «Sí» crece), elige dónde celebrar y llega a una pantalla final con animación.
- **`respuestas.html`, tu panel privado:** ves en vivo si abrió el enlace, cuántas veces intentó decir «No», si dijo que Sí y qué celebración eligió. Opcionalmente recibes avisos en el celular con ntfy.

Nadie se registra. Los datos (nombres, textos, fotos y eventos) se borran solos a los 30 días.

## Cómo está hecho

| Parte | Tecnología |
|-------|------------|
| Frontend | HTML + CSS + JavaScript puro (ES Modules), sin framework y sin paso de build, en **GitHub Pages** |
| Backend | Un **Cloudflare Worker** en `api/` (TypeScript, Hono y Zod) con **D1** (datos) y **R2** (fotos), en el plan gratuito |

- El contrato técnico entre las dos partes está en [`docs/arquitectura.md`](docs/arquitectura.md).
- El contexto del proyecto y las decisiones tomadas están en [`CLAUDE.md`](CLAUDE.md).
- Los detalles del Worker están en [`api/README.md`](api/README.md).

## Probarlo en tu computadora

### Solo el frontend (modo demostración, sin backend)

```bash
python3 -m http.server 8000      # o: npx serve .
```

Abre `http://localhost:8000`. En `localhost` la app usa automáticamente el **modo mock**: guarda todo en el `localStorage` de tu navegador. Puedes abrir `pregunta.html` en una pestaña y `respuestas.html` en otra del mismo navegador para ver el flujo completo.

### Frontend + Worker local

```bash
cd api
npm install
cp .dev.vars.example .dev.vars                                  # cambia SAL_IP por un texto aleatorio
npx wrangler d1 migrations apply noviazgo --local
npx wrangler dev                                                # API en http://localhost:8787/api/v1
```

En otra terminal, levanta el frontend como en la sección anterior. Después, en la consola del navegador:

```js
localStorage.setItem('noviazgo:modo', 'api')   // para volver a la demostración: 'mock'
```

### Tests del Worker

```bash
cd api
npx vitest run       # tests dentro del runtime de Workers
npx tsc --noEmit     # comprobación de tipos
```

## Publicar

En resumen (la guía completa, paso a paso, está en [`docs/arquitectura.md` §9](docs/arquitectura.md#9-lo-que-el-usuario-debe-crear-o-configurar-a-mano)):

1. **GitHub Pages:** sube el repositorio y activa Pages desde la rama `main`, carpeta raíz. El sitio queda en `https://<usuario>.github.io/<repo>/`. Todas las rutas son relativas, así que funciona bajo `/<repo>/`.
2. **Cloudflare:** crea una cuenta, activa R2 (pide un método de pago, pero el costo es $0 dentro del plan gratuito), crea el bucket `noviazgo-fotos` y la base D1 `noviazgo`, y aplica las migraciones con `--remote`.
3. **Secretos y orígenes:** ejecuta `npx wrangler secret put SAL_IP` (obligatorio) y pon `ORIGENES_PERMITIDOS` con `https://<usuario>.github.io` en `api/wrangler.jsonc`.
4. **Deploy:** ejecuta `cd api && npx wrangler deploy` y pega la URL del Worker (terminada en `/api/v1`) en `API_BASE` de `js/config.js`.
5. **Vista previa en WhatsApp:** cambia `og:image` en `index.html` y `pregunta.html` por la URL absoluta de `assets/og-imagen.png`.
6. Haz `git push` y revisa la lista de verificación de [`docs/arquitectura.md` §10](docs/arquitectura.md#10-verificación-de-extremo-a-extremo-antes-de-dar-v1-por-terminada) en un celular real.

Mientras `API_BASE` tenga el marcador `TU-SUBDOMINIO`, el sitio publicado funciona en modo demostración y lo avisa en pantalla.

## Privacidad

- **Cifrado de extremo a extremo:** nombres, textos, opciones, la nota y las fotos se cifran en el navegador (AES-GCM 256) antes de subirlos. En la nube (D1 y R2) solo hay datos ilegibles. La llave va en el fragmento `#c=…` de los enlaces y nunca llega al servidor, así que solo quien tiene el enlace puede ver la sorpresa.
- La clave del panel privado viaja en el fragmento `#k=…` del enlace. Nunca llega a GitHub y el servidor solo guarda su hash.
- Las fotos se comprimen en el navegador y se les quitan los metadatos (incluida la ubicación GPS) antes de subirlas.
- La IP solo se usa, como hash con sal, para limitar abusos.
- Todo expira a los 30 días, y quien envía puede borrar su propuesta antes desde el panel.
- Controles de seguridad, auditorías y riesgos aceptados: [`docs/seguridad.md`](docs/seguridad.md).
