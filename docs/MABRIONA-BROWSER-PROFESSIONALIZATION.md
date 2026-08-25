# MABRIONA Browser — Fase de profesionalización total

Fecha: 2026-08-25. Extiende la arquitectura existente (Tabs/History/Favorites/Downloads/Shields/Search) — nada de lo ya construido se reescribió; el cambio más grande (generalizar el estado de pestañas para soportar múltiples ventanas reales) se hizo preservando exactamente el mismo comportamiento observable de antes, verificado con la suite completa antes y después.

## Resumen ejecutivo

- **Auditoría primero**: se leyó línea por línea `main.js`, `renderer/index.html`, `renderer/renderer.js`, `store.js`, `renderer/style.css` antes de tocar nada.
- **Huecos reales encontrados** (nunca existieron — no es que se rompieron): sin Zoom, sin Nueva Ventana, sin Modo Privado, sin recuperación de sesión, sin duplicar pestaña, permisos solo cubrían cámara/mic, la barra no se reorganizaba en ventanas angostas, sin filtro en Historial, sin señal de "Fuente oficial" en Search.
- **Todo lo anterior se implementó real** esta fase — ver matriz abajo.
- **Perfiles múltiples completos** (historial/cookies/config separados por perfil) y **MABRIONA Account**: evaluados y dejados PENDIENTES a propósito — ver sección 9.
- **94/94 unit tests**, **62 PASS / 0 FAIL / 3 SKIP** en el smoke principal, **2/2 PASS** en un test dedicado de recuperación de sesión real (cierra y reabre la app de verdad). Build reconstruido, reinstalado, verificado con capturas reales.

## Matriz de estado

| Función | Estado | Real/Mock | Tests | Riesgo |
|---|---|---|---|---|
| Tabs (crear/cerrar/cambiar/navegar) | REAL | Real | Sí | Bajo |
| **Duplicar pestaña** | **REAL — nuevo** | Real | Sí (e2e) | Bajo |
| **Ventanas múltiples** | **REAL — nuevo** | Real (BrowserWindow independiente) | Sí (e2e, por id real) | Medio (refactor grande, mitigado con regresión completa) |
| History (ver/abrir/eliminar uno/vaciar) | REAL | Real | Sí | Bajo |
| **Filtro de Historial** | **REAL — nuevo** | Real (client-side) | Sí (e2e) | Bajo |
| Favoritos | REAL | Real | Sí | Bajo |
| Downloads | REAL | Real | Sí | Bajo |
| MABRIONA SHIELDS | REAL | Real | Sí | Bajo |
| Permisos (cámara/mic) | REAL | Real | Sí | Bajo |
| **Permisos (ubicación/notificaciones)** | **REAL — nuevo** | Real | Cubierto por el mismo mecanismo ya testeado | Bajo |
| Find in Page | REAL | Real | Sí (con 1 límite de entorno documentado) | Bajo |
| Settings (privacidad/descargas/permisos) | REAL | Real | Sí | Bajo |
| **Zoom** | **REAL — nuevo** | Real (`webContents.setZoomFactor`) | Sí (e2e, factor real verificado) | Bajo |
| **Modo Privado** | **REAL — nuevo** | Real (sesión en memoria) | Sí (e2e) | Medio (ver sección 5, límites honestos) |
| **Recuperación de sesión** | **REAL — nuevo** | Real | Sí (test dedicado, cierra/reabre la app real) | Bajo |
| **Resistencia a que una pestaña se caiga** | **REAL — nuevo** | Real (`render-process-gone`) | Verificado por revisión de código, no e2e (ver sección 8) | Bajo |
| **Barra responsive** | **REAL — nuevo** | Real (CSS + menú "Más" real) | Sí (e2e a 800×700) | Bajo |
| **Fuente oficial en Search** | **REAL — nuevo** | Real (coincidencia exacta de dominio con `website_url`, dato ya real de Etapa anterior) | Verificado con captura real | Bajo |
| MABRIONA Search completo (Etapas 1-4 + Spectrum) | REAL, sin cambios | Real | Sí | Bajo |
| Perfiles múltiples aislados | PENDIENTE | — | — | — |
| MABRIONA Account | NO CONSTRUIDO (a propósito) | — | — | — |
| Auto-update | PENDIENTE | — | — | — |
| Firma/notarización de builds | PENDIENTE | — | — | — |

## 1. Ventanas múltiples — el cambio de arquitectura más grande

El estado de pestañas (`tabs`, `activeTabId`) era un singleton global asumiendo una sola ventana. Se generalizó a `Map<windowId, {window, activeTabId}>` + `tabs` con un campo `windowId`, sin cambiar ninguna función pública ni romper ningún IPC existente — cada handler que antes asumía "la" ventana ahora resuelve `windowId` real desde `BrowserWindow.fromWebContents(event.sender)`. Verificado exhaustivamente: los **94 unit tests y 62 verificaciones e2e existentes siguen pasando exactamente igual** después del refactor, más las nuevas específicas de multi-ventana (una `BrowserWindow` real, identificada por su `id` real de Electron, no adivinada por posición).

Cmd/Ctrl+N abre ventana nueva; Cmd/Ctrl+T pestaña nueva; Cmd/Ctrl+Shift+N pestaña privada nueva; Cmd/Ctrl+W cierra la pestaña activa.

## 2. Zoom

`webContents.setZoomFactor()` real (no CSS transform) — reescala el layout de verdad. Controles +/−/Restablecer en el menú "Ventanas y Zoom", atajos Cmd/Ctrl +/−/0. Verificado en vivo: 100% → 120% real, `getZoomFactor()` confirmado desde el proceso principal.

## 3. Duplicar pestaña

Ícono ⧉ en cada pestaña — abre una pestaña nueva con la misma URL (y el mismo estado privado/normal). Real, mínimo, sin tocar la arquitectura de tabs existente.

## 4. Permisos ampliados

El mismo mecanismo real que ya manejaba cámara/micrófono (banner → decisión del usuario → persistencia por origen) ahora también cubre `geolocation` y `notifications` — mismo flujo, sin duplicar código.

## 5. Modo Privado — honesto sobre sus límites

Partición `mabriona-private` sin `persist:` → sesión **en memoria**, Electron la descarta entera al cerrar la app (no queda archivo en disco con cookies/almacenamiento de esa sesión). Compartida entre pestañas privadas de la misma ejecución (como el incógnito real de cualquier navegador), pero se pierde por completo al reiniciar la app.

**Lo que el Modo Privado NO promete** (mostrado explícitamente en la UI, no solo en este documento): no te vuelve anónimo frente a tu proveedor de internet ni frente a los sitios que visitás. Los archivos que descargues desde una pestaña privada sí quedan en disco, igual que en cualquier navegador real — es una decisión consciente, no un descuido.

MABRIONA SHIELDS y los permisos también se instalan en la sesión privada (las decisiones de permiso de una pestaña privada se guardan solo en memoria, nunca tocan el store persistente).

## 6. Recuperación de sesión real

Se guarda (con debounce de 800ms) la lista de URLs reales abiertas — **nunca de pestañas privadas, a propósito**. Al reabrir la app, esas pestañas se restauran. Verificado con un test dedicado que cierra la app de verdad y la vuelve a abrir (`test/session-recovery.mjs`): la URL real sobrevive, sin duplicar pestañas.

## 7. Barra responsive

A menos de 880px de ancho, los botones secundarios (captura, Shields, Historial, Descargas, Favoritos) se agrupan en un botón real "⋯" con un panel que ofrece las mismas acciones — nunca desaparecen sin alternativa, nunca se superponen. Ventana mínima fijada en 760×480 para evitar un estado roto. Verificado con una captura real a 800×700.

## 8. Resistencia a que una pestaña se caiga

Nuevo handler `render-process-gone` por pestaña: si el proceso de una pestaña muere (memoria, crash real de Chromium), se recarga automáticamente esa pestaña en vez de dejarla congelada — y el resto de la app sigue funcionando. **No se pudo verificar con un test automatizado**: no hay una forma segura y determinística de forzar un crash real de renderer sin usar APIs de bajo nivel arriesgadas. Se dejó documentado como verificado solo por revisión de código, honestamente, en vez de fingir una prueba.

## 9. Perfiles múltiples — evaluado, dejado PENDIENTE a propósito

Se evaluó implementar perfiles completos (historial/cookies/favoritos/configuración separados). Es técnicamente viable (Electron soporta particiones con nombre arbitrario, el mismo mecanismo ya usado para Modo Privado), pero requiere: un store con datos por perfil (no uno solo compartido), una UI de selección/creación de perfil, y migrar cada handler de historial/favoritos/permisos/descargas para que sea consciente del perfil activo — un cambio de forma de datos real, no una extensión chica. Implementarlo a medias (ej. cambiar solo un nombre visual sin aislar datos de verdad) sería exactamente el tipo de función falsa que esta fase prohíbe explícitamente. Queda documentado como el paso siguiente real, no simulado ni improvisado.

**MABRIONA Account**: no se construyó nada, según la instrucción explícita — el navegador sigue funcionando 100% sin cuenta.

## 10. Fuente oficial en Search

Se usa el dato real ya existente (`website_url`, agregado a Entity Focus en la fase anterior) para: (a) ya se mostraba como "Sitio oficial" en Entity Focus, y (b) ahora también se cruza contra los resultados Web reales — si el dominio de un resultado coincide **exactamente** con `website_url`, se lo marca "FUENTE OFICIAL" y se lo sube al primer lugar. Nunca se marca oficial por contener el nombre de la entidad — solo por coincidencia real de dominio con el campo que la propia Brave ya identificó. Verificado en vivo: "michael jackson" → `michaeljackson.com` queda primero y marcado.

## Seguridad

Sin cambios en lo que ya estaba bien: `contextIsolation`/`sandbox`/`nodeIntegration:false` intactos en toda ventana y pestaña (incluida la privada). El Modo Privado usa el mismo patrón de preload mínimo. Ningún IPC nuevo expone Node.js a una página web.

## Tests

- **Unit**: 94/94 (sin cambios de número respecto a la fase anterior — el refactor de ventanas no es unit-testeable directamente porque requiere Electron real, se cubrió con e2e).
- **E2E principal** (`test/smoke.mjs`): 62 PASS / 0 FAIL / 3 SKIP (antes 54 — 8 verificaciones nuevas: Zoom, Duplicar, Modo Privado, Nueva Ventana, filtro de Historial, barra responsive ×2, más las ya existentes re-verificadas después del refactor).
- **E2E de recuperación de sesión** (`test/session-recovery.mjs`, nuevo): 2/2 PASS, cierra y reabre la app real.
- **Empaquetado**: `test/packaged-app.mjs` en PASS.

## Problema real encontrado y corregido durante esta fase

La recuperación de sesión, al restaurar automáticamente las URLs de la última vez que se cerró la app, rompía el propio smoke test (que asume que arranca con una pestaña en blanco) cuando quedaba una sesión real de una exploración manual anterior. Se corrigió limpiando esa clave del store real antes de cada corrida del test — sin tocar historial ni favoritos, y sin cambiar el comportamiento real para el usuario.

## Build, instalación y capturas

`electron-builder --mac dir` reconstruido, `test/packaged-app.mjs` en PASS, reinstalado en `/Applications/MABRIONA Browser.app` y confirmado corriendo. Capturas reales tomadas del binario empaquetado: menú "Ventanas y Zoom" con Modo Privado activo (tinte púrpura) y zoom real al 120%; barra responsive a 800×700 con el panel "Más" real; "Fuente oficial" marcada en un resultado web real.

## Próxima etapa (sugerida, sin iniciar)

Perfiles múltiples completos (con el store rediseñado para datos por perfil). Firma/notarización real de los builds de macOS/Windows para que Gatekeeper/SmartScreen no avisen. Auto-update real si se decide invertir en la infraestructura.
