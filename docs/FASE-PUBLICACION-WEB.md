# MABRIONA Browser — Fase: Publicación web oficial + descarga pública

Fecha: 2026-08-24. No se tocó nada del navegador en sí (código de `main.js`, `renderer/`, `store.js`, `shields/`, `search/` sin cambios funcionales — solo se quitó una ruta personal de un comentario, ver auditoría de seguridad abajo).

## WEB
**https://mabriona-studio.vercel.app/browser** — página real, propia, estática (`app/public/browser/index.html` en el repo `MABRIONA-STUDIO`), servida directo por Vercel (no depende del SPA de React). Verificada en vivo: `200 OK`, `<title>` correcto.

También accesible desde la Home de MABRIONA STUDIO (card "MABRIONA Browser" → botón "Descargar" → lleva a `/browser`).

## SEO
- `<title>`, meta description, canonical, Open Graph, Twitter Card: reales, en la página.
- JSON-LD `SoftwareApplication` (Schema.org) — sin ratings/reviews/estadísticas inventadas, precio real (gratis, "0" USD).
- `robots.txt` — real, público, permite indexar, referencia el sitemap. Verificado en vivo (`200`, contenido correcto).
- `sitemap.xml` — real, con las dos URLs que realmente existen (`/` y `/browser`) — no se inventaron rutas que no resuelven.
- **Indexación en Google: no verificada ni forzada.** No hay credenciales de Google Search Console — la web queda técnicamente lista (sitemap + robots + meta tags), pero que Google la indexe y aparezca en resultados de búsqueda depende de Google, lleva tiempo, y no se puede confirmar ni forzar desde acá.

## BUILD
- **macOS**: Intel x64 (dir sin firmar → zip). NO es build nativa de Apple Silicon — corre en Apple Silicon vía Rosetta 2, corregido explícitamente en la web y en el release (se había escrito "Apple Silicon/Intel" por error en un primer borrador, detectado y corregido antes de que quedara publicado así permanentemente).
- **Windows**: x64, NSIS, real.
- **Linux**: x64, AppImage + snap, reales.

## INSTALLERS
4 archivos reales, subidos y verificados:

| Archivo | Tamaño real | SHA-256 |
|---|---|---|
| `MABRIONA-Browser-0.1.0-mac.zip` | 102,226,091 bytes (97.5 MB) | `737dbe78...d4ab3bb` |
| `MABRIONA Browser Setup 0.1.0.exe` | 84,216,649 bytes (80.3 MB) | `3e36c4ca...4ca6f1387` |
| `MABRIONA Browser-0.1.0.AppImage` | 107,334,485 bytes (102.4 MB) | `3e8bf8b8...482a01` |
| `mabriona-browser_0.1.0_amd64.snap` | 90,947,584 bytes (86.7 MB) | `53b5d096...78142fc` |

## RELEASE
**https://github.com/nucleo733/MABRIONA-BROWSER/releases/tag/v0.1.0** — real, pública (el repo se hizo público en esta misma sesión, auditado antes de publicarlo), con los 4 instaladores, checksums y notas honestas de qué falta.

## DOWNLOAD
Los 3 botones de `/browser` apuntan directo a las URLs reales de descarga de esos assets (no a la página de releases — al archivo). Verificado: descargar el `.zip` de macOS desde el link público y calcular su SHA-256 da exactamente `737dbe78...d4ab3bb` — coincide byte a byte con el original.

## SIGNING
**Ninguna plataforma está firmada.** macOS sin Developer ID/notarización, Windows sin certificado de firma de código. Esto está declarado explícitamente en la web y en las release notes — nunca se afirmó lo contrario.

## MACOS
No notarizada. Gatekeeper va a mostrar "desarrollador no identificado" al primer abrir — se necesita clic derecho → Abrir, o habilitarlo en Ajustes de Privacidad y Seguridad. Documentado en la web.

## WINDOWS
Sin firma — SmartScreen probablemente va a avisar. Documentado en la web y el release. **No se probó la instalación/ejecución real en una máquina Windows** (no hay una disponible en este entorno) — el build es real y válido (PE32 verificado), pero eso es lo único confirmado.

## LINUX
AppImage (no requiere instalación, `chmod +x` y ejecutar) y snap. **No se probó la ejecución real en una máquina Linux** — mismo motivo que Windows. Build real y válido (ELF verificado).

## CHECKSUMS
Ver tabla en "INSTALLERS" arriba — SHA-256 reales, calculados con `shasum -a 256`, publicados en la web y en el release, y re-verificados descargando el archivo real desde el link público.

## AUTO UPDATE
**PENDIENTE.** No se implementó ninguna infraestructura de actualización automática — no hay servidor de feed, no hay `electron-updater` configurado. Cada versión nueva hay que descargarla a mano. Declarado así explícitamente, nunca como "real".

## CI/CD
**Parcial.** Se agregó un workflow real de GitHub Actions (`.github/workflows/tests.yml`) que corre los 38 unit tests en cada push/PR — corre de verdad, sin secretos, sin firma. El pipeline completo de build multiplataforma + release automático en un tag **no se construyó** (requeriría certificados de firma reales por plataforma, que no existen) — queda **PENDIENTE**, builds y releases siguen siendo manuales.

## TESTS
- Unit: 38/38 ✅
- End-to-end (Playwright + Electron real): 24/24 ✅, 2 skips documentados de fases anteriores (hardware de cámara/GPU no disponible en este entorno de pruebas — no relacionado con esta fase)
- Empaquetado: 1/1 ✅ (la app instalada arranca y sigue viva)
- **Regresión completa: sin fallas nuevas.** El único fallo visto durante esta fase fue el mismo flake de red intermitente ya conocido de fases anteriores (timing de la búsqueda con Brave), no relacionado con la publicación.

## PUBLICACIÓN
**Confirmado, con una limitación honesta:**

✅ Un usuario externo puede completar: **Web → Descargar → Instalar → Abrir** — verificado de punta a punta en macOS (checksum real coincide, la app instalada arranca).

⚠️ Windows y Linux: el tramo **Web → Descargar** está 100% verificado (archivos reales, checksums correctos, sin login). El tramo **Instalar → Abrir** no se pudo verificar en este entorno por falta de una máquina de esa plataforma — se declara así, no como "listo".

⚠️ El paso **"Buscar en Google → encontrar la página oficial"** no se puede confirmar ni forzar — la web está técnicamente preparada (SEO, sitemap, robots), pero la indexación real de Google depende de Google y de tiempo, no de este trabajo.
