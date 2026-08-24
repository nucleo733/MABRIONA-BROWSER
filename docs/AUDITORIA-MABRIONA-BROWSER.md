# AUDITORÍA — MABRIONA Browser

Fecha: 2026-08-24. Repo: `nucleo733/MABRIONA-BROWSER`, commit `7d18b14`. Alcance: exclusivamente este repo — no toca MABRIONA Studio/Social/Music/Artist/AI/DJ.

## ESTADO GENERAL

MABRIONA Browser es un **navegador real de escritorio, no una simulación**: motor Chromium real vía Electron (`BrowserView` por pestaña, no iframes), con seguridad configurada correctamente desde el día uno (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` en la ventana y en cada pestaña). Es un proyecto joven (~1,364 líneas de código propio, sin contar `node_modules`), construido en una sola sesión intensiva el 2026-08-23/24, todavía lejos del alcance completo de un navegador de producción tipo Chrome/Edge — pero lo que existe funciona de verdad y está probado, no aparenta funcionar.

No hay nada roto ni mock disfrazado de real en lo que existe hoy — el gap principal es **cobertura** (secciones enteras del navegador moderno directamente no están construidas todavía), no calidad de lo construido.

## ARQUITECTURA ACTUAL

```
Electron (proceso principal, main.js)
  ├── BrowserWindow (chrome: pestañas + barra, renderer/index.html)
  │     └── preload.js → window.mabrionaBrowser (IPC, contextBridge)
  └── BrowserView × N (una por pestaña — Chromium real)
        └── search-preload.js → window.mabrionaSearch (solo para resultados)

store.js — persistencia real en JSON (userData), no localStorage
shields/blocklist.js — lista de dominios + matcher, aplicado vía session.webRequest
search/braveSearch.js — lógica pura de la Brave Search API (key vive solo en main.js)
```

Patrón de seguridad consistente: la única superficie expuesta al contenido web es `contextBridge`, con dos bridges de alcance mínimo (`mabrionaBrowser` para el chrome, `mabrionaSearch` — una sola función — para cualquier pestaña). Ningún IPC handler ejecuta código arbitrario del renderer sin pasar por una función fija del lado del main process.

## LO QUE YA ESTÁ BIEN (no tocar)

| Función | Estado | Real/Mock | Tests |
|---|---|---|---|
| Motor de navegación (BrowserView, Chromium real) | Completo | Real | ✅ e2e |
| Seguridad Electron base (contextIsolation/sandbox/nodeIntegration) | Completo | Real | Verificado en main.js, sin excepciones |
| Pestañas: crear/cerrar/cambiar | Completo | Real | ✅ e2e |
| Navegación: back/forward/reload/stop | Completo | Real | ✅ e2e (back/forward), reload/stop sin test directo |
| Barra de direcciones: URL vs búsqueda | Completo | Real | ✅ unit (7 casos) |
| Historial | Completo | Real (JSON persistente) | Cubierto indirectamente vía navegación |
| Favoritos | Completo | Real (JSON persistente) | ✅ e2e |
| Descargas | Completo | Real (`session.will-download`, progreso real) | Sin test directo de una descarga real |
| MABRIONA SHIELDS | Completo para su alcance actual | Real (bloqueo real por dominio vía `webRequest`) | ✅ unit (10 casos) |
| Búsqueda propia (Brave real + respaldo DuckDuckGo) | Completo | Real (key server-side, nunca en el renderer) | ✅ unit (6) + e2e |
| Captura de pantalla | Completo | Real (`capturePage()`, PNG en disco) | ✅ e2e |
| Persistencia (pestañas/historial/favoritos/shields/key) | Completo | Real (JSON en userData) | Cubierto indirectamente |
| Página de inicio y resultados propios (sin marca de terceros) | Completo | Real | ✅ e2e |

## LO QUE NO DEBE TOCARSE

- La arquitectura Electron + BrowserView en sí (no hay razón técnica para migrar a `WebContentsView` u otra cosa todavía).
- Los flags de seguridad (`contextIsolation`/`sandbox`/`nodeIntegration`) — ya están en el valor correcto.
- El patrón de `contextBridge` de dos bridges mínimos — es exactamente el patrón recomendado por Electron.
- El diseño visual aprobado (logo, paleta, tipografía del chrome; fondo blanco de la página de resultados) — aprobado explícitamente por la Dirección el 2026-08-24, no rediseñar sin pedido explícito.
- `shields/blocklist.js` y `search/braveSearch.js` — lógica pura, ya testeada, sin necesidad de cambios.

## LO QUE ESTÁ INCOMPLETO (completar, no rehacer)

- **Descargas**: el motor es real, pero no hay UI para elegir carpeta de destino (siempre usa `app.getPath('downloads')`) ni reintento manual desde el panel.
- **Historial**: hay `history:list`/`history:clear`, pero no hay borrado de una entrada puntual ni de un rango de fechas.
- **Favoritos**: es una lista plana — no hay carpetas/subcarpetas ni barra de favoritos visible.
- **Empaquetado**: solo se generó `dir` (macOS, sin firmar) — nunca se probó `dmg` (falla en este entorno sandboxeado por falta de sesión gráfica para el paso de Finder/AppleScript, pero debería funcionar en una Mac real) ni ningún target de Windows/Linux.

## LO QUE ES MOCK

**Ninguno detectado.** Cada botón que existe en la UI tiene una implementación real detrás (verificado línea por línea en esta auditoría) — no hay un solo caso de "botón que aparenta funcionar" en lo que está construido.

## LO QUE ESTÁ ROTO

**Nada activo ahora mismo.** Se corrigieron durante esta misma sesión: un crash real de arranque (`serializeTab` leía `webContents` antes de tiempo) y un bug real de empaquetado (`build.files` no incluía todos los archivos nuevos, la app instalada no abría) — ambos con commit propio y una verificación nueva (`test/packaged-app.mjs`) para que no se repita esa clase de bug.

## RIESGOS DE SEGURIDAD

- **Sin CSP explícita en `renderer/index.html`** (el chrome del navegador) — sí la tienen `newtab.html`/`results.html`. Es de bajo riesgo (el chrome no renderiza contenido de terceros), pero es una inconsistencia que vale corregir.
- **Sin manejo de certificados inválidos** (`certificate-error`) — hoy Chromium usa su comportamiento por defecto, no hay una pantalla propia de "conexión no privada" con la decisión explícita del usuario.
- **Sin política de permisos por sitio** (cámara/micrófono/ubicación/notificaciones) — Electron deniega todo por defecto al no haber un handler de `setPermissionRequestHandler`, lo cual es seguro pero significa que ningún sitio que necesite cámara/mic va a funcionar (ni con permiso del usuario).
- **`window-all-closed`/`activate`**: comportamiento estándar de Electron, no auditado a fondo en esta pasada — bajo riesgo, patrón boilerplate conocido.

## RIESGOS DE RENDIMIENTO

- Ninguno medido todavía de forma sistemática (no se hizo profiling de RAM/CPU con muchas pestañas abiertas). Con pocas pestañas (probado hasta 2 simultáneas) el comportamiento es normal.
- Cada pestaña es una `BrowserView` completa (proceso Chromium propio) — es el modelo correcto de Chrome/Brave, pero significa que memoria escala linealmente con pestañas abiertas; no hay descarga/suspensión de pestañas en background todavía.

## FUNCIONES FALTANTES (del navegador moderno esperado)

No implementadas todavía, ninguna es mock — simplemente no existen:

- Múltiples ventanas (hoy: una sola `BrowserWindow`)
- Modo privado/incógnito (sin aislamiento de sesión separado)
- Perfiles de usuario (múltiples cuentas/identidades locales)
- Configuración/Settings (no hay ninguna pantalla de ajustes)
- Permisos por sitio (cámara, micrófono, ubicación, notificaciones)
- Find in Page (buscar dentro de la página actual)
- Zoom de página
- DevTools accesibles desde la UI (Chromium los tiene, pero no hay atajo/menú para abrirlos)
- Picture-in-Picture como acción explícita del navegador
- Menú contextual (clic derecho) propio
- Restauración de sesión tras un crash real (hoy solo persiste URL/título de cada pestaña, no el estado de scroll/formularios)
- Auto-actualización (Sparkle/electron-updater u equivalente)
- Empaquetado firmado y para Windows/Linux
- Importación de favoritos/historial desde otro navegador
- Accesibilidad auditada formalmente (teclado/screen reader) — probablemente funciona por herencia de Chromium, pero no se verificó explícitamente
- Internacionalización (hoy todo el texto propio está hardcodeado en español)
- Sincronización con MABRIONA Account (no existe MABRIONA Account todavía, así que esto es fase futura por diseño)

## DUPLICACIONES ENCONTRADAS

**Ninguna.** Un solo archivo por responsabilidad, sin `BrowserV2`/`NewTabs`/variantes paralelas.

## TESTS EXISTENTES

- `test/address-resolver.test.js` — 7 casos, lógica pura
- `test/blocklist.test.js` — 10 casos, lógica pura
- `test/braveSearch.test.js` — 6 casos, lógica pura
- `test/smoke.mjs` — 15 verificaciones end-to-end reales (Electron + Playwright real, no mock): arranque, pestañas, búsqueda propia end-to-end, captura de pantalla real, favoritos, shields
- `test/packaged-app.mjs` — confirma que el `.app` ya empaquetado arranca sin crashear (agarra bugs de empaquetado que el resto no puede ver)

Total: 23 unit + 15 e2e + 1 chequeo de empaquetado = **39 verificaciones reales**, todas en verde a la fecha de esta auditoría.

## TESTS FALTANTES

- Descargas: ninguna prueba automatizada de una descarga real de punta a punta
- Historial: sin test dedicado (solo se ejercita indirectamente)
- Seguridad: sin test que verifique explícitamente que una pestaña no puede acceder a Node/`require` (asumido por config, no verificado en CI)
- Regresión visual: no hay comparación de capturas antes/después

## PRIORIDADES (para la próxima fase)

1. **CSP explícita en `renderer/index.html`** — consistencia de seguridad, cambio chico y seguro.
2. **Historial: borrar entrada puntual** — folta chica, alto valor de uso diario.
3. **Permisos por sitio (cámara/mic/notificaciones)** — sin esto, sitios reales (videollamadas, etc.) no van a funcionar nunca dentro de MABRIONA Browser.
4. **Find in Page** — función básica esperada de cualquier navegador, falta total hoy.
5. **Settings** — hoy no hay ningún lugar para que el usuario configure nada (ni el buscador, ni Shields, más allá del panel actual).
6. **Empaquetado real firmado + Windows/Linux** — necesario antes de distribuir a alguien que no sea esta Mac.

## ROADMAP PROPUESTO

- **Fase 2**: Settings + permisos por sitio + Find in Page + CSP del chrome (lo más faltante y más usado a diario)
- **Fase 3**: Modo privado + múltiples ventanas + menú contextual
- **Fase 4**: Perfiles + importación desde otros navegadores + accesibilidad auditada
- **Fase 5**: Empaquetado de producción (firma, Windows/Linux, auto-actualización)
- **Fase 6**: Integración con MABRIONA Account (cuando exista) + sincronización

## PRÓXIMA FASE

Ninguna todavía — esta auditoría es informativa. Se espera confirmación de la Dirección sobre el orden de prioridades antes de tocar código.
