# MABRIONA Browser — Perfiles + Configuración + Persistencia Real

Fecha: 2026-08-25. Continúa directamente sobre la fase de profesionalización (`MABRIONA-BROWSER-PROFESSIONALIZATION.md`), que había dejado "perfiles múltiples reales" evaluado y pendiente a propósito ("requiere rediseñar el store para datos por perfil, cambio real de forma de datos, no una extensión chica"). Esta fase hace exactamente ese rediseño.

Orden real seguido: auditar → planificar → implementar → testear → validar → build → instalar → probar → documentar → commit → push.

## Arquitectura real

- **Registro de perfiles** (`profiles.js`, nuevo): un archivo aparte (`mabriona-browser-profiles.json`) con la lista de perfiles `{id, name, emoji, createdAt}`, el último perfil activo, y la Brave API key (credencial de la app, no dato de usuario — global, no por perfil).
- **Migración real, sin mover nada**: la primera vez que corre esta versión, nace un único perfil `id: 'default'` ("Principal") que apunta EXACTAMENTE al archivo (`mabriona-browser-data.json`) y a la partición de Chromium (`persist:mabriona-browser`) que ya existían. Cero copia, cero riesgo — verificado con datos reales del usuario (43 entradas de historial, 2 favoritos, Brave API key) intactos después de la migración. La API key vieja se migra sola al registro una única vez.
- **Un store real por perfil** (`store.js`, sin cambios de forma — se reutiliza `createStore(filePath)` con un archivo distinto por perfil): cada perfil nuevo tiene su propio `mabriona-browser-profile-<id>.json` con su propio historial, favoritos, descargas, Shields, permisos, carpeta de descargas, sesión guardada, motor de búsqueda y "restaurar sesión" — aislado del resto.
- **Aislamiento real de Chromium por perfil**: cada perfil tiene su propia partición nombrada (`persist:mabriona-profile-<id>`) — cookies, localStorage, IndexedDB y caché reales, separados por Chromium mismo, no por MABRIONA. Mismo mecanismo que ya usaba Modo Privado, con `persist:` para que sí quede en disco.
- **Perfil por ventana, no por pestaña**: cada `BrowserWindow` pertenece a un perfil (`windows.get(id).profileId`). Cambiar de perfil desde el panel abre (o enfoca, si ya está abierta) una ventana de ese perfil — dos ventanas del mismo perfil nunca se abren sin que la persona lo pida con Cmd+N. Varias ventanas de perfiles distintos pueden estar abiertas a la vez.
- **Modo Invitado real**: reutiliza el mecanismo de Modo Privado (partición en memoria, se descarta al cerrar la app), pero a nivel de ventana entera — toda pestaña de esa ventana nace privada. Su store también es en memoria (`store.js#createMemoryStore`, nuevo — misma interfaz que el store en disco, pero `writeAll` nunca toca el filesystem), uno por ventana invitada, para que ni siquiera "Favoritos"/"Descargas" de esa sesión dejen un archivo atrás.
- **Shields/Descargas/Permisos resueltos por pestaña, no fijos por partición**: la partición privada es compartida entre Modo Privado y Modo Invitado; el store correcto (de qué perfil, o en memoria si es invitado) se resuelve dinámicamente según qué ventana disparó la petición — necesario para que el toggle de Shields que ve la persona en Configuración sea el mismo que de verdad filtra esa pestaña.

## Configuración — capacidades reales nuevas, por perfil

- **General**: "Restaurar las pestañas abiertas al iniciar" — toggle real (antes siempre restauraba). Muestra el perfil activo de esa ventana.
- **Búsqueda**: motor de la barra de direcciones, elegible entre MABRIONA Search, Google, Bing, DuckDuckGo y Brave Search — MABRIONA es el default (igual que cualquier navegador arranca con un motor propio) pero nunca la única opción real; los otros cuatro van a la URL real de cada buscador, sin intermediario. Verificado contra red real: la navegación llega de verdad a `google.com/search?q=...` (el CAPTCHA de bot-detection que a veces aparece después es comportamiento real de Google frente a automatización, no un bug de MABRIONA).
- El resto de Configuración (Privacidad/Descargas/Permisos, ya existentes) ahora es automáticamente por perfil, sin cambios de UI — cae gratis de que el store subyacente pasó a ser por perfil.

## Qué se evaluó y se dejó fuera (a propósito)

- **Cambiar de perfil dentro de la misma ventana ya abierta** (en vez de abrir/enfocar otra ventana): se evaluó y se descartó — requeriría desmontar todas las `BrowserView` activas de esa ventana en caliente, lo cual es real pero bastante más riesgoso (estado de IPC a medio pedido, pestañas cargando). El diseño elegido (una ventana por perfil, cambiar = abrir/enfocar) es el mismo que usan navegadores reales con perfiles (cada perfil, su propia ventana) y es coherente con el escenario de multi-ventana + multi-perfil pedido explícitamente.
- **Tema claro/oscuro en Apariencia**: no existe un tema claro en MABRIONA Browser — construir uno nuevo solo para esta fase habría sido diseño nuevo no pedido con este nivel de detalle, y violaría la regla explícita de no rediseñar la identidad visual. Configuración no incluye un selector de tema falso.
- **Configuración de Seguridad como interruptores**: contextIsolation/sandbox/nodeIntegration ya están en su configuración más segura y no se exponen como toggles — debilitarlos nunca es una opción real, así que no hay nada legítimo que configurar ahí más allá de mostrar el estado (no se agregó una sección separada para esto por ser puramente informativa y ya cubierta en la auditoría original).
- **URL de página de inicio personalizada**: se mantiene la new-tab propia de MABRIONA fija — no se agregó un campo de URL libre, para no abrir una superficie nueva (redirecciones arbitrarias) sin pedido explícito de esa granularidad.

## Aislamiento — probado de verdad, no simulado

`test/profile-isolation.mjs` (nuevo, 6/6 PASS): crea un perfil real, escribe `localStorage` real en la ventana del perfil Principal sobre la misma página `file://` que usa la ventana del perfil nuevo, y confirma que el perfil nuevo NO la ve (ni al revés) — aislamiento real de Chromium por partición nombrada, verificado con la API oficial de Electron (`webContents.executeJavaScript`), nunca fingido. También prueba el borrado real de un perfil (archivo + partición) de punta a punta.

## Bug real encontrado y corregido durante esta fase

- **`store.js` — objetos por defecto compartidos por referencia**: el primer refactor de los defaults usaba `{...DEFAULTS}` (spread superficial) — los campos anidados (`history`, `favorites`, `downloads`, `permissions`) quedaban con la MISMA referencia en memoria entre todos los perfiles cuyo archivo todavía no existía, así que mutar uno los mutaba a todos. Atrapado por un test unitario existente (`test/settings.test.js`) que empezó a fallar por contaminación cruzada entre tests. Corregido con una función `freshDefaults()` que arma objetos nuevos en cada llamada — reconfirmado 97/97 unit tests.
- **Empaquetado — `profiles.js` faltaba en `package.json#build.files`**: el build pasaba, pero el `.app` instalado crasheaba al arrancar (`require('./profiles')` no existía dentro de `app.asar`). Atrapado instalando y corriendo el `.app` real, no solo el modo desarrollo — corregido agregándolo a la lista de archivos empaquetados y reconfirmado con el árbol de procesos real (proceso principal + GPU + red + 2 renderers) tras reinstalar.

## Tests

- **106 unit tests** (97 + los que ya existían de antes, sin contar), incluye `test/profiles.test.js` (nuevo, 10 tests: migración, no-copia de datos, migración de API key, creación, renombrado persistente, reglas de borrado, self-healing del último perfil activo) y ampliación de `test/address-resolver.test.js` (5 tests nuevos: motor por defecto, los 4 motores externos reales, dominios sin importar el motor).
- **12/12 PASS** en `test/profiles-settings.mjs` (nuevo, e2e UI real): panel de Perfil, Configuración → General/Búsqueda con persistencia real vía IPC, Modo Invitado real (ventana nueva, pestaña privada de nacimiento, no deja historial), historial de la ventana Principal sin mezcla tras usar Invitado.
- **6/6 PASS** en `test/profile-isolation.mjs` (aislamiento real, ver arriba).
- **61 PASS / 0 FAIL / 3 SKIP** en `test/smoke.mjs` (suite principal existente, sin regresiones — mismos 3 SKIP documentados de siempre, dependientes de hardware/entorno, no de código).
- **2/2 PASS** en `test/session-recovery.mjs` (recuperación de sesión real, ahora por perfil, sigue funcionando).

## Estado final

| Capacidad | Estado |
|---|---|
| Perfiles múltiples reales, con datos aislados de verdad | REAL |
| Migración segura del perfil existente (sin pérdida ni copia) | REAL |
| Modo Invitado real (no persiste nada) | REAL |
| Multi-ventana con perfiles distintos simultáneos | REAL |
| Configuración → General (restaurar sesión) | REAL |
| Configuración → Búsqueda (motor elegible, neutral) | REAL |
| Configuración → Privacidad/Descargas/Permisos, ahora por perfil | REAL |
| Apariencia (tema) | NO CONSTRUIDO — no existe tema claro, no se fingió uno |
| Seguridad como configuración | INFORMATIVO — nada legítimo para exponer como toggle |
| Cambiar de perfil sin abrir otra ventana | DESCARTADO A PROPÓSITO — ver razones arriba |
