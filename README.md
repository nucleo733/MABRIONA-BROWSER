# MABRIONA Browser

El navegador web propio de MABRIONA Corporation. Motor Chromium real
(vía Electron), no un iframe ni una simulación — pestañas, historial,
favoritos, descargas, privacidad y **MABRIONA SHIELDS** (bloqueo de
anuncios/rastreadores de terceros).

Proyecto independiente y separado del resto de MABRIONA — vive en su
propio repo. Cuando esté listo, se integrará a **MABRIONA STUDIO / DJ
IA** (Plato 1 / Plato 2) como una fase aparte; hasta entonces no toca
ni depende de esos repos.

## Arquitectura

- `main.js` — proceso principal de Electron: crea la ventana, una
  `BrowserView` real por pestaña (Chromium real, no un mock), maneja
  descargas reales (`session.will-download`), e instala MABRIONA
  SHIELDS sobre `session.webRequest`.
- `preload.js` — puente IPC seguro (`contextIsolation` + `sandbox`
  activados, sin `nodeIntegration`) hacia el chrome de la UI.
- `renderer/` — la interfaz del navegador en sí: tira de pestañas,
  barra de direcciones, botones de navegación, y los paneles de
  historial/favoritos/descargas/shields.
- `shields/blocklist.js` — lista real de dominios de publicidad/rastreo
  conocidos + la función que decide si un pedido de red se bloquea.
  **A propósito no incluye youtube.com/googlevideo.com** — los
  anuncios del reproductor de YouTube viajan por el mismo canal que el
  video real; bloquearlos rompería el video. Ver
  `MABRIONA-STUDIO/docs/FASE-YOUTUBE-REPRODUCCION-SIN-INTERRUPCIONES.md`
  para el porqué eso no se implementa en ningún producto de MABRIONA.
- `address-resolver.js` — decide si lo que escribiste en la barra es
  una URL o una búsqueda (DuckDuckGo — sin API key, sin rastrear).
- `store.js` — persistencia real (historial/favoritos/descargas/config
  de shields) en un JSON en `userData`, sobrevive reinicios.

## Correr en desarrollo

```
npm install
npm start
```

**Nota de entorno**: si `ELECTRON_RUN_AS_NODE=1` está seteado en tu
shell (pasa en algunos entornos de desarrollo en contenedor), Electron
arranca como Node puro sin ventana en vez de como app real. Sacá esa
variable antes de correr `npm start`/los tests. Una app empaquetada de
verdad (`npm run dist`) nunca tiene esa variable.

## Tests

- `npm test` — unidad, lógica pura sin Electron (`shields/blocklist.js`,
  `address-resolver.js`, `search/braveSearch.js`): 21 tests, node:test.
- `node test/smoke.mjs` — extremo a extremo real: lanza la app de
  verdad con Playwright (`_electron`), crea/cierra pestañas, navega a
  sitios reales, busca desde la home y desde la página de resultados
  propia, agrega favoritos, abre el panel de MABRIONA SHIELDS. 15
  verificaciones, todas reales.
  - Limitación conocida: los screenshots de Playwright no muestran el
    contenido de la página (la `BrowserView` es una capa nativa
    separada del DOM que Playwright fotografía) — sí se ve el chrome
    del navegador (pestañas/barra/botones) perfectamente. Esto es una
    limitación de la herramienta de testing, no un bug de la app — las
    aserciones de navegación (URL, título, cantidad de pestañas) sí
    confirman que la página real cargó.
- `node test/packaged-app.mjs` — corre la app YA EMPAQUETADA
  (`dist/mac/MABRIONA Browser.app`, no el código fuente) y confirma
  que arranca sin crashear. **Correr esto siempre después de
  `electron-builder` y antes de reinstalar en `/Applications`** — el
  smoke test normal lanza `electron .` desde el repo, que no detecta
  un `package.json` → `build.files` incompleto (pasó de verdad: un
  archivo nuevo quedó afuera del empaquetado y la app instalada no
  abría, aunque todo el resto de los tests estaba en verde).

## MABRIONA SHIELDS

Bloqueador de anuncios/rastreadores de terceros — la misma función que
trae cualquier navegador real (Brave, Firefox ETP, Safari ITP, uBlock
Origin). Bloquea pedidos de red hacia dominios conocidos de
publicidad/rastreo en cualquier sitio, activable/desactivable desde el
panel del escudo (🛡️ en la barra de herramientas).

## Roadmap

- ✅ Fase 1 (esta): navegador real standalone — pestañas, navegación,
  historial, favoritos, descargas, MABRIONA SHIELDS, tests reales.
- ⏳ Integración con DJ IA (MABRIONA STUDIO): pendiente, fase aparte,
  a definir cuando esta base esté aprobada.
