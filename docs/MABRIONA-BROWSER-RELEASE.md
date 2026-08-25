# MABRIONA Browser — Distribución pública 1.0.0

Fecha: 2026-08-25. Primera versión pensada para descarga pública real desde `https://www.mabriona.com/browser`, respaldada por un GitHub Release real en `nucleo733/MABRIONA-BROWSER`.

## 1. Versión

`1.0.0` — consistente en `package.json`, el tag de git, el GitHub Release, el JSON-LD de la landing y el texto visible de la página.

## 2. Plataformas

| Plataforma | Estado | Cómo se construyó |
|---|---|---|
| macOS Apple Silicon (arm64) | **REAL** — compilado nativo | `electron-builder --mac zip`, Electron oficial arm64 |
| macOS Intel (x64) | **REAL** — compilado y verificado end-to-end (launch + búsqueda real) | `electron-builder --mac zip` |
| Linux x64 (AppImage) | **REAL** — compilado, correcto tamaño/formato | `electron-builder --linux AppImage`, sin herramientas extra desde Mac |
| Linux (.deb) | **DESCARTADO** — el binario `fpm` que usa electron-builder produjo un archivo corrupto en este entorno (96 bytes, formato `ar` de macOS en vez de un `.deb` real) — mismo problema de incompatibilidad de binarios visto con `gh`/`brew` en esta máquina. Se prefirió no distribuirlo roto antes que fingir que funciona. | — |
| Windows x64 | **PENDIENTE** — el target NSIS de electron-builder necesita Wine (o una máquina Windows real) para compilar cross-platform; no hay Wine instalable en este entorno (Homebrew también está roto acá: `Bad CPU type in executable`). Mismo criterio ya establecido para MABRIONA DJ IA y MABRIONA CIELO — la landing dice "Próximamente", no un link roto ni un instalador desactualizado. | — |

## 3. Firma de código y notarización

**PENDIENTE — REQUIERE CREDENCIAL/CERTIFICADO DEL PROPIETARIO.** No existe ningún certificado Apple Developer ID ni credenciales de notarización en este entorno (`security find-identity` → 0 identidades válidas). No se inventó ni se simuló ninguna firma. Consecuencia real para quien lo descarga: macOS (Gatekeeper) va a avisar "desarrollador no identificado" la primera vez que se abre — clic derecho → Abrir.

## 4. Auto-actualización

**NO IMPLEMENTADA esta fase, a propósito.** Un mecanismo real de auto-actualización (Squirrel.Mac vía `electron-updater`) depende de que los builds estén firmados — sin eso, la verificación de integridad de las actualizaciones no es confiable y el propio `electron-updater` puede fallar en macOS. Implementar un "botón de Actualizar" sin esa base habría sido exactamente el botón falso que se pidió explícitamente no construir. Queda documentado como dependiente de la Fase 3 (firma), no como un pendiente aislado.

## 5. Checksums (SHA-256) — versión 1.0.0

```
43b04847f6371f62d82be8d2ab79ed038ffd99d08fe74170c7c638fb14bddeef  MABRIONA-Browser-1.0.0-arm64-mac.zip
56b44f99b1722892b54f9d804b77a68a7623c50532571e1a7bd3860fa2826e65  MABRIONA-Browser-1.0.0-mac.zip
59044812895a6ed66119d89b1dbadd4ba4df8112268cf9c32fff48afb9f60166  MABRIONA-Browser-1.0.0.AppImage
```

## 6. GitHub Release

`https://github.com/nucleo733/MABRIONA-BROWSER/releases/tag/v1.0.0` — release real, público, con los tres instaladores adjuntos. Cada URL de descarga se verificó de verdad (HTTP 200, `content-length` exacto igual al tamaño del archivo local) antes de conectarla a la landing.

## 7. Página de descarga

`https://www.mabriona.com/browser` (repo `nucleo733/MABRIONA-STUDIO`, `app/public/browser/index.html`, HTML estático servido vía rewrite de Vercel — mismo patrón que `/dj-ia` y `/cielo`). Detecta el sistema operativo del visitante y resalta la tarjeta correspondiente; siempre deja ver las otras plataformas. La tarjeta de Windows queda deshabilitada visualmente ("Próximamente"), sin enlace roto. Verificado en vivo tras el deploy: los tres links de descarga en la página real apuntan exactamente a los assets del release v1.0.0.

## 8. Seguridad de la distribución

- La Brave API key sigue empaquetada dentro del `.app` (ver `docs/MABRIONA-BROWSER-PRODUCTION-SEARCH-FIX.md`, fase anterior) — nunca en el repo público, nunca en los logs, nunca en la UI. El archivo con la credencial real (`brave-api-key.local.json`) está en `.gitignore` y se confirmó que no aparece en ningún commit de esta fase.
- Los archivos distribuidos son exactamente lo que produce `electron-builder` a partir de `build.files` (`main.js`, `preload.js`, `store.js`, `profiles.js`, `address-resolver.js`, `renderer/`, `shields/`, `search/`, la key empaquetada) — no incluyen `node_modules` de desarrollo, código de tests, ni el repo fuente.
- Riesgo real, ya señalado en la fase anterior y vigente: el `.app` no está cifrado — alguien técnico podría desempaquetar el `app.asar` y extraer la key. La mitigación real es un límite de gasto/cuota en la cuenta de Brave, no ocultarla mejor — sigue siendo una decisión de cuenta, no de código.

## 9. Test de usuario nuevo (Fase 19/30 — obligatorio)

`test/production-search.mjs` corrido contra el `.app` 1.0.0 real (target `dir`, x64) con un `--user-data-dir` recién creado — **9/9 PASS**: la app abre, MABRIONA Search funciona sin ninguna configuración manual, funciona igual en el perfil Principal, en un perfil nuevo creado en caliente, y en Modo Invitado.

## 10. Regresión

- **101/101 unit tests** — sin cambios de lógica esta fase (solo `package.json`), se re-confirmó igual.
- `test/production-search.mjs`: 9/9 PASS (ver arriba).
- Suites e2e de fases anteriores (`smoke.mjs`, `profile-isolation.mjs`, `profiles-settings.mjs`, `session-recovery.mjs`) no requerían re-ejecución esta fase porque no se tocó ningún archivo de código de la app (`main.js`, `renderer/`, `search/`, `profiles.js`, `store.js` quedaron intactos) — solo configuración de empaquetado.

## 11. Limitación real de esta sesión de desarrollo

El binario arm64 se compiló correctamente (Mach-O arm64 válido, tamaño correcto, Electron oficial arm64 real) pero **no se pudo ejecutar dentro de este entorno de desarrollo** para probarlo en caliente — el propio entorno solo puede correr procesos x86_64 (`Bad CPU type in executable` al intentar lanzarlo, el mismo síntoma que ya afectaba a `gh` y a Homebrew en esta máquina). El build x64 sí se probó de punta a punta, incluida una búsqueda real con datos completamente nuevos. El primer lanzamiento real del build arm64 va a ser en la propia Mac Apple Silicon del usuario.

## 12. Qué falta para "listo para producción" en el sentido más estricto

- Certificado Apple Developer ID real (firma + notarización de macOS).
- Un entorno con Wine (o una máquina Windows real) para compilar y probar Windows.
- Auto-actualización real, una vez exista la firma.
- Probar los instaladores en una máquina Linux real (hoy: build válido, no probado en ejecución real).
- Verificar el build arm64 corriendo en una Mac Apple Silicon real (hoy: verificado por formato de archivo, no por ejecución, debido a la limitación del punto 11).

Nada de esto se fingió ni se simuló — cada pendiente está documentado con su causa real, siguiendo el mismo criterio que ya se usó al declarar Windows/Linux "sin probar en máquina real" en el release 0.1.0.
