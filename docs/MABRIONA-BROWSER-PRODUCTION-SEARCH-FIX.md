# MABRIONA Browser — Corrección crítica de Search en producción

Fecha: 2026-08-25. Reporte final, siguiendo el orden pedido: auditar → reproducir en el `.app` real → encontrar la causa → corregir → probar → empaquetar → instalar → volver a probar → documentar → commit → push.

## 1. Causa exacta del problema

**La Brave API key nunca viajaba con el `.app` distribuido.** Existe una sola línea de código (`registry.getBraveApiKey()` en `main.js`, dentro del handler `search:query`) que decide si MABRIONA Search funciona o no — y esa key solo llegaba a existir porque, durante el desarrollo, alguien la escribió a mano en el archivo local de datos de esta máquina. Un usuario que descarga el `.app` real desde GitHub Releases arranca con un `userData` completamente vacío: sin esa key, `search:query` devuelve `{ configured: false }` para absolutamente cualquier búsqueda — página de resultados vacía, sin Web, sin Entity Focus, sin nada.

Todo el resto de la arquitectura (`Renderer → Preload → IPC → Main → Brave Search API → normalizeResults → MABRIONA Search UI`) ya funcionaba perfecto — el problema no era de código roto, era de **una credencial que nunca se empaquetaba**.

## 2. Archivos afectados

- `profiles.js` — nueva función `readBundledApiKey()` (con ruta inyectable, para poder testearla sin tocar el archivo real de la credencial) que carga una key empaquetada junto al código, solo si el registro todavía no tiene una configurada (nunca pisa una key ya puesta por migración o por el usuario).
- `brave-api-key.local.json` (nuevo, **nunca en git** — ver `.gitignore`) — la credencial real, se coloca a mano en la máquina que hace el build oficial.
- `.gitignore` — entrada nueva para ese archivo.
- `package.json` — se agregó `"brave-api-key.local.json"` a `build.files`, para que `electron-builder` lo empaquete dentro de `app.asar` (así llega al `.app` distribuido sin pasar nunca por el repo público).
- `test/profiles.test.js` — 4 tests nuevos para `readBundledApiKey()`.
- `test/production-search.mjs` (nuevo, permanente) — el test de producción obligatorio: lanza el `.app` REALMENTE empaquetado con un `--user-data-dir` 100% nuevo (nunca los datos de esta máquina) y verifica que la búsqueda funciona sola, sin configuración manual.

## 3. Por qué funcionaba en desarrollo y fallaba en producción

Todos los tests y capturas de fases anteriores se corrieron contra el `userData` real de esta máquina de desarrollo — que ya tenía la key puesta a mano desde hacía días. Ningún test anterior arrancaba con un `userData` verdaderamente vacío apuntando al `.app` empaquetado real, así que el problema nunca se manifestó hasta esta fase, que reprodujo exactamente el escenario de "usuario nuevo descarga el `.app`" con `--user-data-dir` apuntando a una carpeta recién creada.

## 4. Verificación de Brave API

Sigue exactamente igual que antes: la key vive solo en el proceso principal (`main.js`/`profiles.js`), nunca se expone al renderer, nunca se imprime en logs, nunca aparece en pantalla. Lo único que cambió es **de dónde sale** esa key cuando el registro todavía no tiene una — antes: de ningún lado (bug); ahora: de un archivo empaquetado junto al código, fuera del repo público.

**Advertencia real que hay que tener en cuenta**: el `.app` distribuido es un `app.asar` sin cifrar — cualquier persona técnica que lo descargue puede desempaquetarlo y leer esa credencial. Esto es una limitación real de cualquier app de escritorio con una API key embebida (no es exclusivo de MABRIONA), y la mitigación real no es "esconderla mejor" sino controlar el uso desde el lado de Brave: poner un límite de gasto/cuota en esa cuenta y estar dispuesto a rotar la key si se detecta abuso. No se implementó nada de eso en esta fase porque es una decisión de cuenta/negocio, no de código — se las señalo para que la evalúes.

## 5. Verificación de MABRIONA Search

Confirmado en el `.app` real, con `userData` 100% nuevo:
- Spectrum real (Todo/Web/Videos/Imágenes/Noticias/Lugares/Cortos según la consulta).
- Entity Focus real con foto, descripción, sitio oficial.
- FAQ, Videos, Noticias, Lugares — todo con datos reales.
- La interfaz nunca menciona "Brave" en ningún texto visible (verificado programáticamente).
- Ninguna búsqueda queda pegada en "Buscando…".

## 6. Verificación de Profiles

Sin rehacer nada de la fase anterior. Verificado en el `.app` real con `userData` nuevo: Perfil Principal, un perfil nuevo creado en caliente, y Modo Invitado — los tres pueden buscar correctamente (la key es global, no por perfil, así que ningún perfil necesita configuración propia).

## 7. Verificación de motores de búsqueda

Sin cambios de esta fase — motor MABRIONA Search sigue siendo el default y sigue sin redirigir nunca a `search.brave.com`; los 4 motores externos (Google/Bing/DuckDuckGo/Brave) siguen siendo elección explícita del usuario en Configuración.

## 8. Resultados de tests unitarios

**101/101 PASS** (97 previos + 4 nuevos de `readBundledApiKey`), 0 FAIL.

## 9. Resultados E2E

- `test/production-search.mjs` (nuevo): **9/9 PASS** — contra el `.app` empaquetado real, `userData` 100% nuevo.
- `test/smoke.mjs`: **61 PASS / 0 FAIL / 3 SKIP** (mismos 3 SKIP documentados de siempre, sin regresión).
- `test/profile-isolation.mjs`: **6/6 PASS**.
- `test/profiles-settings.mjs`: **12/12 PASS**.
- `test/session-recovery.mjs`: **2/2 PASS**.

## 10. Resultado del build

`npm run dist` — el `.app` se genera correctamente (`dist/mac/MABRIONA Browser.app`); el paso de armar el `.dmg` sigue fallando en este entorno por falta de `python` en el PATH (limitación del entorno, no del código, ya documentada en fases anteriores) — no bloquea la verificación real, que se hizo contra el `.app` ya generado.

## 11. Resultado del `.app` instalado

Instalado en `/Applications/MABRIONA Browser.app`, verificado con el árbol de procesos real (principal + GPU + red + renderers) y con búsquedas reales confirmadas end-to-end.

## 12. Búsquedas reales probadas

Contra el `.app` real, con `userData` nuevo: romeo santos, apple, google, brave, mabriona, youtube, starbucks madrid, javascript, inteligencia artificial, clima santo domingo, una consulta sin sentido, y una URL directa (`https://www.google.com`, navega directo, no como búsqueda). Todas devuelven resultados reales y completos.

## 13. Capturas

En `screenshots/`: `prod-01-newtab.png`, `prod-02-romeo-santos.png` (FAQ+Videos+Entity Focus), `prod-03-apple.png`, `prod-04-starbucks-madrid.png` (Lugares con valoraciones reales), `prod-05-sin-resultados.png` (consulta sin sentido — Brave devuelve coincidencias sueltas reales, comportamiento normal de cualquier buscador), `prod-07-imagenes.png`. Todas capturadas con `webContents.capturePage()` sobre el `BrowserView` real (un `screenshot()` de Playwright sobre la ventana no alcanza a capturar esa capa nativa — limitación conocida, no del producto).

## 14. Commit

Pendiente de confirmar en este mismo mensaje — ver historial de git tras este reporte.

## 15. Push

Pendiente de confirmar en este mismo mensaje.

## 16. Criterio de éxito

Un usuario que descargue MABRIONA Browser hoy, lo abra, escriba cualquier cosa en la barra y presione Enter va a ver una búsqueda completa de MABRIONA Search — sin configurar nada, sin ver Brave, sin página vacía. Verificado contra el `.app` real, no solo en desarrollo.
