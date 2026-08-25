# MABRIONA Browser — Extensiones reales de Chrome

Fecha: 2026-08-25. Pedido explícito del usuario: poder agregar extensiones de Google Chrome, "y de cualquier navegador". Confirmado técnicamente real: MABRIONA es Chromium de verdad (vía Electron), así que el mismo formato de extensión que usan Chrome, Edge, Brave y Opera funciona acá tal cual — no hay nada que simular.

## Cómo funciona (real, `session.loadExtension` — API oficial de Electron)

Verificado con una extensión mínima real: `session.loadExtension()` carga la extensión, Chromium le asigna un ID real, y su content script corre de verdad sobre una página real (confirmado modificando el DOM de `example.com` y leyendo el resultado desde afuera).

Cada perfil tiene sus propias extensiones (igual que el resto de su configuración — historial, favoritos, motor de búsqueda). Modo Privado y Modo Invitado **no** cargan extensiones, a propósito — mismo default que el modo Incógnito de Chrome real.

## Tres formas reales de agregar una extensión

1. **Cargar desde una carpeta** — para una extensión que ya tenés descomprimida (modo desarrollador, como "Cargar descomprimida" en Chrome). Se usa la carpeta original tal cual, sin copiarla — si el usuario la mueve o la borra, la extensión deja de cargar en el próximo arranque (mismo comportamiento que Chrome real en modo desarrollador).
2. **Importar desde Chrome / Edge / Brave / Chromium ya instalados** — se escanean de verdad las carpetas donde esos navegadores guardan sus extensiones (mismo formato en disco, ya descomprimido) en macOS, Windows y Linux, y se copian a la carpeta propia de MABRIONA (para no depender de que el otro navegador no las borre o actualice después). Probado con el Chrome real de la máquina de desarrollo: encontró **26 extensiones reales** instaladas.
3. **Instalar por ID o link de la Chrome Web Store** — descarga el `.crx` real desde el endpoint público de actualización de Google (`clients2.google.com/service/update2/crx`, el mismo que usa Chrome internamente para buscar actualizaciones), lo desempaqueta (un `.crx` es un `.zip` real con un encabezado de firma antes — CRX2 o CRX3, ambos soportados) y lo instala. Probado con una extensión real y compleja (**uBlock Origin real, v1.74.0**, descargada, desempaquetada e instalada con éxito).

## Qué NO es esto (honestidad explícita)

**No es el botón "Agregar a Chrome" de la tienda.** Ese botón depende de `chrome.webstorePrivate`, una API interna de Google que solo existe en builds oficiales de Chrome — Electron no la expone y no hay forma legítima de replicarla. El resultado real de instalar por ID/link es exactamente el mismo (la extensión real, funcionando de verdad) — solo cambia cómo se inicia la instalación (pegar el ID/link en vez de un botón dentro de la página de la tienda).

## Seguridad y privacidad

- Ningún permiso especial nuevo — las extensiones corren con los mismos permisos que ya tenía la sesión del perfil (`contextIsolation`/`sandbox` sin tocar).
- Nada se descarga ni se instala sin que la persona lo pida explícitamente (los tres caminos son siempre una acción real del usuario).
- Importar/instalar copia archivos reales al disco, dentro de la carpeta de datos de MABRIONA (`userData/extensions/<perfil>/`) — nunca fuera de ahí.
- Quitar una extensión importada o instalada por la tienda borra su copia real del disco. Una extensión "sin empaquetar" nunca se borra del disco al quitarla — esa carpeta es del usuario, no de MABRIONA.

## Archivos

- `extensions.js` (nuevo) — toda la lógica real: cargar sin empaquetar, escanear otros navegadores, descargar/desempaquetar `.crx`, copiar/borrar.
- `store.js` — cada perfil guarda su lista real de extensiones (`recordId`, `origin`, `path`, `name`, `version`, `enabled`, `chromeExtensionId`).
- `main.js` — IPC real (`extensions:*`), carga las extensiones habilitadas del perfil al arrancar su sesión.
- `renderer/index.html` + `renderer.js` + `style.css` — panel real (🧩), con las tres formas de agregar y la lista con activar/desactivar/quitar.
- Nueva dependencia real de producción: `extract-zip` (para desempaquetar el `.crx`/carpetas importadas) — verificado que se empaqueta correctamente en el `.app` real y que las devDependencies (`electron`, `electron-builder`, `playwright`) NO se cuelan.

## Tests

- `test/extensions.test.js` (nuevo, 17 tests unitarios): parseo de ID/link de la Chrome Web Store, desempaquetado real de CRX2/CRX3 (con buffers reales construidos a mano, no simulados), validación de manifest.json, copiado real de carpetas, resolución de nombres localizados (`__MSG_...__`), reglas de borrado seguro.
- `test/extensions-e2e.mjs` (nuevo, 6/6 PASS): flujo completo por UI real — instalar, ver en el panel, desactivar, escanear otros navegadores (encontró 26 reales), quitar.
- `test/extensions-webstore.mjs` (nuevo, 3/3 PASS, depende de red real): instalar uBlock Origin real desde la Chrome Web Store por ID y por link completo.
- Regresión completa: 118/118 unit tests, 63/63 smoke (0 fail, 3 skip documentados de siempre), 13/13 release checklist contra el `.app` empaquetado real.

## Limitaciones reales, documentadas

- Sin UI para gestionar permisos individuales de cada extensión (Chrome sí lo tiene) — no se construyó por alcance, no por imposibilidad técnica.
- Manifest V3 en Electron 31 tiene soporte real pero no 100% completo frente a Chrome real (algunas APIs de `chrome.*` más nuevas pueden faltar) — extensiones MV2 y la mayoría de MV3 comunes funcionan (confirmado con uBlock Origin real, MV2).
- El escaneo de "otros navegadores" busca en las rutas reales conocidas de Chrome/Edge/Brave/Chromium en macOS/Windows/Linux — si alguien instaló su navegador en una ruta no estándar, no lo va a encontrar (no se inventa una ruta).
