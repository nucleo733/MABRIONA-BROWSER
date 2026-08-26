# MABRIONA Browser — Importación de datos al primer uso

Fecha: 2026-08-26. Real, local, sin mocks — verificado con datos reales de Chrome, Brave y Firefox en esta misma máquina, dentro del `.app` empaquetado real (no solo en desarrollo).

## Qué hace

Al abrir MABRIONA por primera vez (o desde Configuración → "Importar datos del navegador…", cuando quieras), un asistente real:

1. Escanea de verdad qué navegadores Chromium (Chrome, Brave, Edge) y Firefox están instalados en la máquina, con datos reales para importar.
2. Muestra cada perfil real encontrado (ej. "Google Chrome — Profile 1").
3. Deja elegir qué importar: Favoritos, Historial, o los dos.
4. Importa, mezclando con lo que MABRIONA ya tenía — nunca duplica, nunca borra nada existente.
5. Muestra el resultado real (cuántos favoritos/entradas se importaron).

"Omitir por ahora" en cualquier paso deja seguir usando MABRIONA normalmente, sin importar nada.

## Navegadores compatibles

Verificado con datos reales de esta máquina:

- **Google Chrome** — sí (JSON de Bookmarks + SQLite de History, todos los perfiles reales: Default, Profile 1, Profile 2...).
- **Brave** — sí (mismo formato que Chrome, es Chromium).
- **Microsoft Edge** — sí (mismo formato, no se pudo probar con datos reales en esta máquina por no estar instalado, pero la detección usa exactamente el mismo mecanismo que Chrome/Brave).
- **Firefox** — sí (SQLite `places.sqlite`, perfiles vía `profiles.ini`).
- **Safari** — no. Safari no expone sus datos en un formato de archivo documentado y estable como los anteriores — importar de Safari requeriría una integración distinta (posible extensión futura de Safari, o acceso a través de macOS), fuera de alcance de esta fase.

## Datos importados

- **Favoritos** — título, URL, fecha de creación real, y la **carpeta real de origen** (ej. "Barra de favoritos/Trabajo") — se preserva la estructura de carpetas del navegador de origen, aunque MABRIONA todavía no tiene una UI de carpetas propia (el dato queda guardado, listo para cuando exista esa función).
- **Historial** — URL, título, fecha/hora real de la última visita. Se mezcla con el historial que ya había: si la misma URL existe en los dos lados, se queda con la visita más reciente real, nunca inventa ni pierde datos.

## Qué NO se importa (a propósito)

- **Contraseñas** — nunca. El gestor de contraseñas de MABRIONA es una fase aparte, todavía no existe. No se copian, no se intenta descifrar ningún almacén protegido.
- **Cookies / sesiones autenticadas** — nunca en esta fase. Copiar una sesión ya autenticada de otro navegador es una decisión de seguridad real que no se tomó sin una arquitectura dedicada.
- **Safari** — ver arriba.

## Privacidad y seguridad

- Todo pasa **localmente**, en el proceso principal de Electron — nada se sube a ningún servidor, nada sale de la computadora.
- El archivo de origen (History/places.sqlite) se **copia primero** a una carpeta temporal antes de leerlo (por si el navegador de origen lo tiene abierto/bloqueado) y se borra esa copia apenas termina — no queda ningún archivo temporal con datos ajenos.
- Los permisos usados son los mismos de siempre — `contextIsolation`/`sandbox` sin tocar, el IPC nuevo (`import:*`, `onboarding:*`) solo expone operaciones puntuales, no acceso libre al sistema de archivos desde el renderer.

## Duplicados

Un favorito cuya URL ya existe en MABRIONA **nunca se duplica ni se pisa** — se deja tal cual estaba. El historial se mezcla por URL, quedándose con la visita más reciente real entre lo que ya había y lo importado.

## Volver a importar después

Configuración → "Importar datos del navegador…" abre el mismo asistente en cualquier momento, no solo la primera vez.

## Arquitectura

- `browserImport.js` (nuevo) — toda la lógica real: detección de navegadores instalados, lectura de Bookmarks (JSON de Chromium) e History (SQLite de Chromium, vía `sql.js`), lectura de `places.sqlite` de Firefox (bookmarks + historial en el mismo archivo, reconstruyendo la ruta real de carpeta desde `moz_bookmarks.parent`).
- Nueva dependencia real de producción: **`sql.js`** (SQLite compilado a WebAssembly) — se eligió en vez de un binding nativo (`better-sqlite3`) porque Electron 31 empaqueta Node 20.18.0 internamente (confirmado), que no tiene `node:sqlite`, y un binding nativo necesitaría recompilarse por plataforma/arquitectura (`electron-rebuild`) — `sql.js` no necesita nada de eso, es JS + WebAssembly puro, y se empaqueta igual de simple que cualquier otra dependencia. Verificado que su `.wasm` real queda incluido en el `.app` empaquetado y funciona ahí (no solo en desarrollo).
- `store.js` — cada perfil guarda su propia bandera `hasCompletedOnboarding` y sus métodos reales `importFavorites`/`importHistoryEntries` (mezcla real, sin duplicar, una sola escritura a disco por importación, no una por item).
- **Migración segura**: un archivo real que ya existía antes de este sistema (sin el campo `hasCompletedOnboarding`) se migra automáticamente a `true` — a alguien que ya usaba MABRIONA nunca se le muestra el asistente como si fuera nuevo.
- Modo Privado y Modo Invitado nunca ven el asistente — no tendría sentido en una sesión que se descarta sola.

## Limitaciones reales

- Los timestamps de Chrome (formato WebKit, microsegundos desde 1601) y de Firefox (PRTime, microsegundos desde 1970) se convierten con la fórmula real de cada formato — verificado contra fechas reales conocidas.
- El historial de Chrome que se importa depende de cuántas URLs reales tengan `last_visit_time` no nulo en la base de ese perfil — algunos perfiles con poca actividad reciente pueden traer pocas entradas, eso es real, no un bug.
- No se soporta todavía importar de un navegador instalado en una ruta no estándar (fuera de las rutas reales conocidas por sistema operativo).

## Tests

- `test/browserImport.test.js` (8 tests unitarios): timestamps reales, árbol de bookmarks de Chromium con carpetas anidadas (sin duplicar el nombre de la raíz — bug real encontrado y corregido durante esta fase), `profiles.ini` real de Firefox, reconstrucción real de carpeta desde `moz_bookmarks`, exclusión de URLs internas (`about:`, `place:`).
- `test/store.test.js` — 7 tests nuevos: onboarding (nuevo/persistente/migración de archivo previo), `importFavorites`/`importHistoryEntries` (sin duplicar, mezcla real).
- Regresión completa: 140/140 unit tests, sin romper nada existente (perfiles, extensiones, Search, Shields, etc.).
- Probado de punta a punta, con datos 100% reales de esta máquina, tanto en desarrollo como en el `.app` empaquetado real: 10 fuentes reales detectadas (7 perfiles de Chrome, 2 de Brave, 1 de Firefox), 281 favoritos reales importados de un solo perfil de Chrome, historial real importado y mezclado, carpetas reales preservadas, asistente no vuelve a aparecer tras completarlo/omitirlo, usuario que ya tenía MABRIONA nunca lo ve.
