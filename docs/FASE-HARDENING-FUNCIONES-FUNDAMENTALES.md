# MABRIONA Browser — Fase: Hardening + Funciones Fundamentales

Fecha: 2026-08-24. Repo: `nucleo733/MABRIONA-BROWSER`. Auditoría de referencia: `docs/AUDITORIA-MABRIONA-BROWSER.md` (commit `b7fb815`). Baseline confirmado antes de empezar: 36 verificaciones reales en verde (21 unit + 14 e2e + 1 empaquetado — la auditoría había dicho 39, error de conteo corregido acá).

## 1. IMPLEMENTADO

| Prioridad | Qué se agregó | Archivos principales |
|---|---|---|
| 1 — CSP | Se endureció la CSP de las 3 páginas propias (`object-src 'none'`, `base-uri 'none'`, `form-action` explícito). Se probó `frame-ancestors` y se sacó: ese directive no funciona vía `<meta>`, dejarlo hubiera sido declarar una protección inexistente. | `renderer/index.html`, `renderer/newtab.html`, `renderer/results.html` |
| 2 — Historial | Borrado puntual de una entrada, sin afectar el resto ni requerir "Vaciar" todo. | `store.js`, `main.js`, `preload.js`, `renderer/renderer.js` |
| 3 — Permisos por sitio | `session.setPermissionRequestHandler` real para cámara/micrófono — banner real en el chrome, decisión persistida por origen, todo lo demás denegado por defecto. | `main.js`, `store.js`, `preload.js`, `renderer/index.html`, `renderer/renderer.js`, `renderer/style.css` |
| 4 — Find in Page | `webContents.findInPage()` real de Chromium — barra flotante, Cmd/Ctrl+F, siguiente/anterior, contador, cierre. | `main.js`, `preload.js`, `renderer/*` |
| 5 — Settings | Panel nuevo con 3 secciones, todas conectadas a capacidades reales: borrar datos de navegación (conecta un handler que ya existía sin UI), carpeta de descargas configurable (diálogo nativo real), gestión de permisos por sitio (ver/olvidar). | `main.js`, `store.js`, `preload.js`, `renderer/*` |
| 6 — Empaquetado | Ver sección 5 de este informe. | `package.json`, `dist/` |

## 2. CONSERVADO (no se tocó)

- Motor de navegación (BrowserView/Chromium real), pestañas, navegación, favoritos, descargas, MABRIONA SHIELDS, búsqueda con Brave, captura de pantalla — sin cambios de comportamiento.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — ya estaban correctos, se verificó y no se modificaron.
- Identidad visual aprobada (logo, paleta, tipografía, layout del chrome) — cero cambios de diseño en esta fase.
- Ningún archivo se borró, ningún componente se duplicó (`grep` de `V2`/`New*` sobre el repo: cero resultados).

## 3. TESTS

- **Antes de empezar (baseline real, no el número de la auditoría):** 21 unit + 14 e2e + 1 empaquetado = 36.
- **Al terminar:** 38 unit + 24 e2e + 1 empaquetado = **63 verificaciones reales**, 0 fallas, 2 skips documentados (no fingidos):
  - `getUserMedia` no dispara el permission handler dentro de 10s en este entorno sandboxeado (sin hardware de cámara/mic detectable).
  - `webContents.findInPage()` no dispara `found-in-page` en este entorno (confirmado llamando la API directo, sin pasar por código de MABRIONA — probablemente falta de compositor/GPU real).
  - Los dos casos están cubiertos por unit tests deterministas de la lógica real (persistencia/decisión), que no dependen de hardware ni de timing.
- Todos los tests previos a la fase siguen pasando — cero regresiones.

## 4. SEGURIDAD

- CSP endurecida y verificada en vivo (no solo en el archivo fuente) en las 3 páginas propias.
- Permisos por sitio: cámara/micrófono requieren decisión explícita del usuario; todo lo demás (ubicación, notificaciones, USB, Bluetooth, MIDI, etc.) se deniega por defecto sin excepción — no se implementó nada de eso todavía, y negarlo por defecto es lo seguro.
- Ningún IPC nuevo ejecuta código arbitrario: cada handler hace una sola cosa fija (`history:remove` borra por URL, `permissions:respond` solo resuelve un callback pendiente conocido, `settings:choose-downloads-dir` abre el diálogo nativo del sistema, nunca un path arbitrario que venga del renderer).
- La API key de Brave sigue sin exponerse nunca al renderer (sin cambios respecto a la fase anterior).

## 5. PACKAGING — estado real por plataforma

| Plataforma | Formato | Build | Firmado | Instalado | Ejecutado/verificado |
|---|---|---|---|---|---|
| macOS | `.app` (dir, sin firmar) | ✅ Real | ❌ No (sin certificado Developer ID) | ✅ Sí, en esta Mac | ✅ Sí — 63 verificaciones reales |
| macOS | `.dmg` | ❌ Falla | — | — | El paso de personalización del DMG (fondo/ícono vía Finder+AppleScript) necesita una sesión gráfica real que este entorno sandboxeado no tiene (`spawn Unknown system error -86`). Debería funcionar en una Mac normal fuera de este sandbox — no verificado. |
| Windows | `.exe` (NSIS, instalador) | ✅ Real (84MB, PE32 válido) | ❌ No firmado | ❌ No | ❌ No — no hay máquina Windows disponible en este entorno para instalarlo/ejecutarlo. Se compiló, nada más. |
| Linux | `.AppImage` + `.snap` | ✅ Real (107MB/91MB, ELF válido) | — (AppImage no requiere firma) | ❌ No | ❌ No — no hay máquina Linux disponible acá. Se compiló, nada más. |

**Ninguna plataforma se declara "lista para producción".** macOS es la única instalada y ejecutada de verdad. Windows y Linux tienen builds reales y válidos (no simulados, no vacíos) pero sin ejecución verificada — eso queda pendiente para cuando haya una máquina real de esa plataforma para probarlos.

## 6. ESTADO REAL/MOCK

Ninguna función nueva de esta fase es mock. Cada una se verificó de una de estas dos formas:
1. Con un test end-to-end real (CSP, historial, Settings), o
2. Con la API real y documentada de Electron/Chromium ejecutándose correctamente hasta donde el entorno de pruebas lo permite, con el límite específico del entorno documentado como SKIP en vez de forzado a pasar (permisos, find in page).

## 7. PROBLEMAS ENCONTRADOS

- La auditoría anterior tenía dos imprecisiones, corregidas en esta fase: contó 39 verificaciones cuando eran 36, y dijo que `index.html` no tenía CSP cuando sí tenía (aunque menos endurecida).
- `frame-ancestors` en un `<meta>` no tiene efecto — se intentó, se detectó el warning real del navegador, y se sacó en vez de dejarlo como protección fantasma.
- Dos bugs de timing en los tests mismos (no en la app) se encontraron y corrigieron durante esta fase: un toggle de panel que se cerraba solo al "reabrirlo", y una espera fija demasiado corta para una búsqueda real por red.

## 8. PRÓXIMA FASE (propuesta, sin empezarla)

Pendiente de aprobación, en este orden sugerido:
1. **Búsqueda** — pedidos ya recibidos durante esta fase (pestañas tipo Google: All/Images/Videos/News; panel de perfil con datos/imágenes de una persona/entidad) — requiere decidir fuente de datos (Brave no tiene Knowledge Graph propio) y evitar clonar la interfaz exacta de Google.
2. Modo privado + múltiples ventanas + menú contextual.
3. Perfiles + importación desde otros navegadores + accesibilidad auditada formalmente.
4. Firma de código real (macOS + Windows) y prueba de ejecución en una máquina Windows/Linux real.
5. Integración con MABRIONA Account (cuando exista) + sincronización.
