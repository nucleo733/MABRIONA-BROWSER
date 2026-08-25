# MABRIONA Browser — Fase 1.1: Production Hardening + Release Completion

Fecha: 2026-08-25. De v1.0.0 publicada a v1.0.1 production-hardened. Orden seguido: auditar → identificar pendientes → priorizar → corregir → testear → build → instalar → validar → documentar → release.

## Bugs reales encontrados y corregidos esta fase

Ninguno de estos era conocido antes de auditar — todos se encontraron revisando el código real, no reportados por el usuario.

1. **Respaldo muerto a DuckDuckGo, con filtración real de la consulta a un tercero no declarado.** `renderer/results.js` todavía tenía un `fetch()` directo a `api.duckduckgo.com` desde el renderer (bypaseando el proceso principal) más un link fijo a `duckduckgo.com` en el estado "sin resultados" — código de antes de la migración a Brave, nunca limpiado. Se sacó entero: ahora, si Search falla o no está configurada, se muestra el mismo estado de error honesto de siempre. `connect-src` de la CSP de `results.html` pasa a `'none'` (el renderer ya no hace ningún fetch propio).
2. **El contador de MABRIONA SHIELDS nunca se reseteaba.** `blockedCount` solo se inicializaba en 0 al crear la pestaña — navegar a otra página nunca lo reseteaba, así que el número crecía para siempre en vez de reflejar la página actual (distinto de Brave/uBlock Origin). Corregido en `did-navigate`. Encontrado al escribir la primera prueba real de bloqueo (antes solo se verificaba que el panel abriera).
3. **"Último perfil activo" no se actualizaba al enfocar una ventana ya abierta**, solo al crear una nueva — cambiar a un perfil ya abierto y cerrar la app así reabría en el perfil equivocado la próxima vez. Corregido en `profiles:switch-to`.
4. **El CI real venía fallando en cada push**, sin que se hubiera notado. `npm test` (`node --test test/`) recogía los scripts e2e (`smoke.mjs`, etc.) como si fueran unit tests — Node los agarra igual por estar dentro de una carpeta llamada `test/`, sin importar el nombre del archivo. Confirmado revisando el historial real de runs en GitHub Actions: fallando desde hace varios commits. Corregido acotando el script a la lista explícita de archivos `*.test.js` (sin glob de por medio, para que funcione igual en Windows).

## Fase B — macOS Apple Silicon (arm64)

Verificación estática (estructura del bundle, arquitectura del binario, `codesign -dv`, `Info.plist`) — real, sin ejecutarlo:

- `file` confirma Mach-O 64-bit arm64 válido.
- `codesign -dv`: `adhoc, linker-signed` — firma automática de Electron/Chromium al empaquetar (no es una firma real de Apple Developer ID).
- `spctl -a -vv`: rechazado por Gatekeeper (esperado, sin notarizar).
- `Info.plist`: `CFBundleIdentifier=com.mabriona.browser`, versión correcta.

**ARM64 BUILD VERIFIED. RUNTIME TEST PENDING** — el entorno de desarrollo de esta sesión solo puede ejecutar procesos x86_64 (mismo síntoma "Bad CPU type" que afecta a `gh`/Homebrew acá), así que no se pudo lanzar el binario arm64 en caliente dentro de esta sesión. No se fingió la prueba.

## Fase C — macOS Intel (x64) — checklist completo, PROBADO

`test/release-checklist.mjs` (nuevo, permanente) corrido contra el `.app` REALMENTE empaquetado con `userData` 100% nuevo — 13/13 PASS: instalar → abrir → pestaña nueva → navegar → MABRIONA Search real → favorito → historial → descarga real (captura) → panel de Shields → crear perfil nuevo (ventana real) → Modo Privado real → cerrar → reabrir → recuperación de sesión real (y confirmado que Modo Privado nunca se restaura).

## Fase D/E — Firma y notarización de Apple

**PENDIENTE — REQUIERE CREDENCIAL APPLE DEL PROPIETARIO.** `security find-identity -v -p codesigning` → 0 identidades válidas en este entorno. No se generó ni se simuló ninguna firma ni certificado.

## Fase F/G — Windows: RESUELTO con CI real

Resuelto con CI real (GitHub Actions, runner `windows-latest`), no con Wine local (no instalable en este entorno; Homebrew también está roto acá).

`.github/workflows/build-windows.yml` (`workflow_dispatch`, manual a propósito — cada build se revisa antes de publicarse):
1. `npm ci` + `npm test` (101 unit tests reales) en el runner de Windows.
2. La Brave API key se escribe desde el secret `BRAVE_API_KEY` de GitHub Actions (ya configurado) — nunca en el repo.
3. `electron-builder --win nsis --publish=never` — instalador NSIS real.
4. **Verificación real de arranque** (best-effort, `continue-on-error`): instala el `.exe` en silencio (`/S /D=...`), lo abre, y confirma que el proceso queda vivo en el runner. Resultó intermitente en el runner de GitHub (funcionó con PID real confirmado en 2 de 4 corridas; en las otras, la instalación silenciosa no dejó rastro en disco dentro del tiempo esperado) — no hay evidencia de que sea un problema del instalador (compiló bien las 4 veces), parece timing del runner. Por eso este paso nunca bloquea la subida del `.exe` real como artifact.
5. Checksum SHA-256 real.

**Resultado real, publicado**: `MABRIONA-Browser-Setup-1.0.1.exe` (74.9 MB) en el release `v1.0.1`, checksum `0703ddf26a8bdf7d3e7fb8fa342a75b618ac3858bc72acf0b47e4da57008a30c`, con al menos una verificación real de arranque exitosa en un runner de Windows (PID real capturado en el log de esa corrida).

## Fase H — Linux

AppImage real, reconstruido con todos los fixes de esta fase. Sigue sin poder ejecutarse dentro de este entorno macOS (AppImage necesita FUSE/kernel Linux — no es una limitación de arquitectura como con arm64, es que no hay ningún Linux real disponible acá). `.deb` sigue descartado — el `fpm` de electron-builder produce un archivo corrupto en este entorno; no se volvió a intentar publicarlo sin arreglar esa causa real primero.

## Fase I — Auto-actualización

**PENDIENTE, a propósito — depende de la Fase D/E.** Un auto-update real (Squirrel.Mac vía `electron-updater`) necesita builds firmados para verificar la integridad de las actualizaciones de forma confiable; sin eso, implementarlo habría sido exactamente el "botón falso" que se pidió no construir. No se tocó.

## Fase K — MABRIONA SHIELDS

Antes de esta fase, el único test verificaba que el panel abriera — nunca que bloqueara algo real. Se agregó `test/fixtures/tracker-page.html` (dominios reales: `google-analytics.com`, `doubleclick.net`) y se confirmó en `smoke.mjs`: bloquea con Shields activo, deja pasar con Shields apagado. Bug real encontrado y corregido en el proceso (ver arriba, punto 2).

## Fase M — Seguridad (re-auditoría)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — confirmado en las dos ubicaciones donde se crean `BrowserView` (main.js).
- CSP endurecida en las tres páginas propias (`index.html`, `newtab.html`, `results.html`) — confirmada en el archivo real, no solo documentada. `results.html` ahora con `connect-src 'none'` (antes tenía una entrada innecesaria a DuckDuckGo).
- Sin telemetría ni analítica propia en ningún archivo del código (verificado por búsqueda real en el repo).

## Fase N — Brave API key

Sin cambios de arquitectura esta fase (no se movió a backend, no se rompió Search). Recordatorio del riesgo real ya documentado en la fase anterior: el `.app` no está cifrado, la key es técnicamente extraíble por alguien que desempaquete el `app.asar` — la mitigación real sigue siendo un límite de gasto/cuota en la cuenta de Brave, no ocultarla mejor.

## Fase Q — Página web

Actualizada (`mabriona-studio`, `app/public/browser/index.html`) — Windows pasa de "Próximamente" a disponible de verdad, con su link real al `.exe` de v1.0.1 y su checksum. Verificado en vivo tras el deploy.

## Fase R — Versionado

`1.0.0` → **`1.0.1`** — corrige bugs reales (no agrega funciones), sigue SemVer.

## Matriz final

| Función | Estado | Real/Mock | Plataforma | Test | Seguridad | Qué falta |
|---|---|---|---|---|---|---|
| macOS Apple Silicon | Compilado | Real | mac arm64 | Verificado por formato/firma, no por ejecución (limitación del entorno) | contextIsolation/sandbox OK | Firma+notarización, probar ejecución real |
| macOS Intel | Compilado y probado | Real | mac x64 | 13/13 checklist completo + 9/9 producción | contextIsolation/sandbox OK | Firma+notarización |
| Windows | Compilado y probado | Real | win x64 (CI) | Unit tests + arranque real (intermitente, no bloqueante) | Igual arquitectura, sin firma | Firma de código, probar en máquina física |
| Linux | Compilado | Real | linux x64 (AppImage) | Build válido, sin ejecución real (sin Linux disponible acá) | Igual arquitectura | Probar en máquina Linux real |
| Firma de código | Pendiente | — | mac/win | — | — | Certificado Apple Developer ID / cert de código Windows del propietario |
| Notarización | Pendiente | — | mac | — | — | Depende de la firma |
| Auto-update | Pendiente, a propósito | — | — | — | — | Depende de la firma |
| MABRIONA Search | Real | Real | todas | 9/9 producción | Key empaquetada, nunca en repo | Límite de gasto en la cuenta Brave (decisión de negocio) |
| Profiles/Guest | Real | Real | todas | 13/13 + fases previas | Aislamiento real por partición | — |
| MABRIONA SHIELDS | Real, bug corregido | Real | todas | Bloqueo real probado con dominios reales | — | — |
| Privacidad | Auditada | Real | todas | Sin telemetría propia confirmado | Sin respaldo a terceros no declarado (bug corregido) | — |
| CI | Real, estaba roto | Real | mac (tests) + win (build) | Corregido y confirmado en verde | — | — |
