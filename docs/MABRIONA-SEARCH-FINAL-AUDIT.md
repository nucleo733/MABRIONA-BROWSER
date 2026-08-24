# MABRIONA Search — Auditoría Final y Cierre de Producción

Fecha: 2026-08-24. Repositorio: `nucleo733/MABRIONA-BROWSER`.

Esta es la fase de cierre de MABRIONA Search (Etapas 1-4 ya completadas). No se reescribió ni se duplicó nada existente — se auditó todo el código real, se corrigieron los problemas reales encontrados, se implementó un filtro real adicional (frescura), y se dejó documentada, sin inventar nada, cada función que depende de infraestructura que esta cuenta no tiene.

---

## RESUMEN EJECUTIVO

- **Auditado**: los 6 módulos de `search/`, `main.js`, todo `renderer/results.*`, seguridad, accesibilidad, estados de error, y — por segunda vez, con evidencia fresca — la disponibilidad real de AI/Shopping/Music/People en la cuenta actual de Brave.
- **Bug real corregido**: un error/límite de cuenta/caída de red se mostraba como "no encontré nada" (engañoso). Ahora hay un estado de error distinguible con reintento.
- **Función real nueva**: filtro de frescura (día/semana/mes/año) — verificado con llamadas reales que sí cambia el orden de los resultados, no es decorativo.
- **Accesibilidad real corregida**: Spectrum ahora usa el patrón ARIA `tablist`/`tab` con navegación por flechas; la grilla de Imágenes ahora tiene `alt` real (antes vacío) porque ahí la imagen es el contenido, no decoración.
- **MABRIONA AI, Shopping, Music, People (más allá del infobox)**: confirmado de nuevo, con llamadas reales de hoy, que esta cuenta no tiene esa capacidad. No se simuló nada.
- **69/69 unit tests** (antes 66), **45 PASS / 0 FAIL / 2 SKIP E2E** (antes 42), 0 mensajes de consola (error o warning) durante una sesión real de búsqueda.
- **0 mocks, 0 datos hardcodeados en producción** (confirmado leyendo cada archivo de `search/` y `renderer/results.*` línea por línea).

---

## MATRIZ DE ESTADO

| Función | Estado | Real/Mock | Fuente | Tests | Riesgo | Qué falta | Decisión |
|---|---|---|---|---|---|---|---|
| Web | REAL | Real | Brave (misma llamada) | Sí | Bajo | — | Preservado |
| Images | REAL | Real | Brave, endpoint dedicado, perezoso | Sí | Bajo (gasta 1 llamada extra solo si se abre) | — | Preservado (Etapa 4) |
| Video | REAL | Real | Brave (misma llamada) | Sí | Bajo | — | Preservado |
| News | REAL | Real | Brave (misma llamada) | Sí | Bajo | — | Preservado |
| Places | REAL | Real | Brave (misma llamada) | Sí | Bajo | Sin mapa (sin proveedor contratado, a propósito) | Preservado |
| FAQ | REAL | Real | Brave (misma llamada) | Sí | Bajo | — | Preservado |
| Entity Focus | REAL | Real | Brave/Wikipedia | Sí | Bajo | — | Preservado |
| Context Graph | REAL | Real | Derivado de datos ya normalizados | Sí | Bajo | — | Preservado |
| Context Orbit | REAL | Real | Derivado de Context Graph | Sí | Bajo | — | Preservado |
| **Filtro de frescura (Tools)** | **REAL — nuevo esta fase** | Real | Brave (`freshness`, verificado que cambia resultados) | Sí (unit + E2E) | Bajo | País/idioma reales en la API pero no expuestos (sin necesidad de UX clara todavía) | Implementado |
| MABRIONA AI | PENDIENTE — REQUIERE INFRAESTRUCTURA REAL | — | — | — | — | Plan superior de Brave (`summarizer`: `OPTION_NOT_IN_PLAN`, confirmado hoy) | No implementado, no simulado |
| Shopping | PENDIENTE — REQUIERE INFRAESTRUCTURA REAL | — | — | — | — | Brave no tiene esta categoría en ningún nivel (sin `result_filter` válido, sin endpoint) | No implementado, no simulado |
| Music (categoría propia) | PENDIENTE — REQUIERE INFRAESTRUCTURA REAL | — | — | — | — | Igual que arriba | No implementado, no simulado |
| People (más allá del infobox) | PENDIENTE — REQUIERE INFRAESTRUCTURA REAL | — | — | — | — | Igual que arriba | No implementado, no simulado |
| **Estado de error real** | **REAL — corregido esta fase** | Real | `main.js` ya distinguía error/red, la UI no lo mostraba | Sí (E2E, con un 422 real por query demasiado larga) | Bajo | — | Corregido (era un bug) |
| Estados de búsqueda (loading/empty) | REAL | Real | — | Sí | Bajo | Sin estado "offline" separado del de red (ver abajo) | Preservado |
| Privacidad | REAL | Real | — | — | Bajo | — | Ver sección 8 |
| Seguridad | REAL | Real | — | — | Bajo | — | Ver sección 9 |
| Accesibilidad | REAL — mejorada esta fase | Real | — | Manual (ver sección 10) | Bajo-Medio | Sin pruebas automatizadas de lector de pantalla | Corregido lo encontrado |
| Performance | REAL | Real | — | — | Bajo | Sin cache (evaluado, ver sección 11) | Documentado |

---

## 1. MABRIONA AI

Se repitió la auditoría desde cero, con llamadas reales de hoy (no se reutilizó lo que decía Etapa 4):

- `GET /res/v1/summarizer/search` → **400 `OPTION_NOT_IN_PLAN`**.
- `web/search?...&summary=1&result_filter=summarizer,...` → 200, pero el bloque `summarizer` nunca aparece en la respuesta (no hay key de resumen que pedir después).
- Mismo resultado que `suggest`/`spellcheck`: son funciones de un plan de Brave que esta cuenta no tiene contratado.

**Decisión: MABRIONA AI — PENDIENTE DE INFRAESTRUCTURA REAL.**

Qué faltaría exactamente: un plan de Brave Search API que incluya "Summarizer" (o un proveedor de LLM aparte, contratado explícitamente), con su propio coste y términos de uso. No se contrató nada — decisión que corresponde al usuario.

## 2. Shopping / Music / People

Confirmado de nuevo hoy: `result_filter` no acepta `shopping`; no existe `/res/v1/shopping/search`, `/res/v1/music/search` ni `/res/v1/people/search` reales — las rutas devuelven la página de marketing de Brave (`content-type: text/html`), no una API. Sin cambios respecto a Etapa 4: siguen **PENDIENTES por falta de capacidad real**, no por falta de tiempo.

## 3. Filtro de frescura (Tools) — nuevo, real

Verificado con múltiples llamadas reales que `freshness=pd/pw/pm/py` reordena genuinamente los resultados (no es un parámetro que la API ignore). Implementado como un `<select>` real dentro de Spectrum: al cambiar, vuelve a pedir la búsqueda con ese filtro y lo refleja en la URL (`?fresh=pd`) para que sea compartible/recargable. País/idioma (`country`, `search_lang`) también son reales y funcionales (verificado: `country=ES` vs `country=US` da resultados distintos), pero no se expusieron todavía — no hay una señal confiable de qué país quiere el usuario sin inventar una, así que se documenta como disponible-pero-no-expuesto en vez de forzar un control sin necesidad clara.

## 4. Estado de error real — bug corregido

**Antes**: si Brave devolvía un error (límite de cuenta, key inválida, sin conexión), `main.js` ya distinguía el motivo (`error`, ahora también `errorKind`), pero `renderer/results.js` nunca leía ese campo — cualquier error terminaba mostrando "MABRIONA no encontró una respuesta directa para esto", idéntico al caso de una búsqueda sin resultados. Un usuario no podía distinguir "no hay resultados" de "algo falló".

**Ahora**: `search()` revisa `response.error` antes de calcular `hasAnything`. Tres mensajes reales según `errorKind`:
- `rate_limited` (HTTP 429): "MABRIONA alcanzó el límite de búsquedas por ahora. Probá de nuevo en unos segundos."
- `network` (falla de `fetch`, sin conexión): "No se pudo conectar — revisá tu conexión a internet."
- `http_error` (cualquier otro, ej. 422): mensaje genérico honesto + botón **Reintentar** real (vuelve a llamar `search()` con la misma consulta).

Verificado en vivo con un error real (422, query de 500 caracteres — Brave rechaza queries de más de cierta longitud) — sin tocar la API key real ni ningún dato persistente del usuario.

**Offline real vs. error de red**: ambos hoy producen el mismo `errorKind: 'network'` (el mismo mensaje "no se pudo conectar"), porque `fetch()` en el proceso principal falla de la misma manera para "sin DNS/sin red" que para "el servidor no respondió" — no hay forma de distinguirlos de manera confiable desde dentro de la app sin agregar una comprobación de conectividad aparte (`navigator.onLine` del lado del renderer, o un ping a otro host). Se documenta como una distinción posible pero no implementada, no como algo roto.

## 5. Web / Images / Video / News / Places / FAQ / Entity Focus / Context Orbit — auditados, sin regresiones

Se releyó cada archivo completo (`search/braveSearch.js`, `search/contextGraph.js`, `main.js`, `renderer/results.js/css/html`). No se encontró código duplicado, ninguna función reescrita innecesariamente, ningún placeholder de desarrollo. Los únicos cambios a estos módulos en esta fase fueron el fix de error (arriba) y agregar `alt` real a las imágenes (accesibilidad, abajo) — ninguna lógica de datos existente se tocó.

## 6. Spectrum

Sigue dinámico: una pestaña solo aparece con datos reales, con la única excepción documentada desde Etapa 4 (Imágenes se ofrece de entrada y se retira sola si la carga perezosa llega vacía). Ahora además con semántica ARIA real (`role="tablist"`/`"tab"`, `aria-selected`, navegación con flechas) — ver sección 10.

## 7. Search states

| Estado | Implementado |
|---|---|
| INITIAL | Sí — página en blanco con el buscador antes de escribir |
| LOADING | Sí — "Buscando…" / "Buscando imágenes…" |
| SUCCESS | Sí — Spectrum con datos reales |
| PARTIAL | Sí — Spectrum solo muestra las pestañas con datos; secciones vacías nunca se renderizan |
| EMPTY | Sí — mensaje real + enlace de respaldo a DuckDuckGo |
| ERROR | **Sí — nuevo esta fase**, con mensaje distinguible + reintento |
| OFFLINE | Parcial — hoy comparte mensaje con "error de red" (ver sección 4) |
| RATE LIMITED | **Sí — nuevo esta fase**, mensaje específico para HTTP 429 |

## 8. Privacidad

Sin cambios de arquitectura. Confirmado (lectura de código): la consulta de búsqueda solo viaja del renderer al proceso principal (IPC) y de ahí a Brave — nunca se guarda la consulta en el store persistente de MABRIONA Browser (historial de navegación sí guarda URLs visitadas, incluida `results.html?q=...`, que es el comportamiento normal de cualquier navegador con su propio historial — no es un envío a un tercero adicional). No se agregó ningún nuevo punto de recolección de datos en esta fase.

## 9. Seguridad

Sin cambios ni necesidad de cambios: `contextIsolation`/`sandbox`/`nodeIntegration:false` intactos en `main.js` (tabs) y `preload.js`/`search-preload.js` (bridges mínimos). La key de Brave sigue sin salir nunca del proceso principal — el nuevo parámetro `freshness` viaja como texto simple por el mismo canal IPC ya existente y se valida contra una lista blanca (`VALID_FRESHNESS`) antes de llegar a la URL real, así que no hay manera de inyectar un parámetro arbitrario a la API aunque alguien manipulara el mensaje IPC. CSP sin modificar — no se agregó ningún dominio nuevo (todas las miniaturas nuevas de Etapa 4/5 ya usaban `imgs.search.brave.com`, permitido desde Etapa 1).

## 10. Accesibilidad — auditada y corregida

**Encontrado y corregido:**
- Spectrum (`#spectrum`) no tenía semántica de pestañas: ahora `role="tablist"` en el `<nav>`, `role="tab"` + `aria-selected` en cada botón, `aria-controls="results"`, y navegación con flechas ←/→ (activación automática, patrón estándar ARIA de tabs). `#results` ahora es `role="tabpanel"` con `aria-live="polite"` (los lectores de pantalla anuncian cuando cambia el contenido — búsqueda nueva, error, etc.).
- Grilla de Imágenes: las miniaturas tenían `alt=""` — correcto para thumbnails decorativos (Video/News/Places, donde el título ya está en texto visible al lado), pero incorrecto en Imágenes, donde la imagen ES el contenido. Ahora usa el título real como `alt`.

**Ya estaba bien (verificado, no se tocó):**
- FAQ: acordeón con `<button>` real + `aria-expanded`, navegable por teclado sin cambios.
- Context Orbit: cada nodo es un `<a>` real; el texto del tooltip está dentro del propio enlace, así que un lector de pantalla ya anuncia nombre + tipo + relación al enfocar el nodo (comprobado leyendo el DOM que genera `renderContextOrbit`), con anillo de foco visible en Volt.
- Botones/enlaces en general: todos son elementos nativos (`<button>`, `<a>`), no `<div>` con `onclick` — accesibles por teclado por defecto.

**No verificado en esta fase** (limitación honesta, no fingida): no se corrió un lector de pantalla real (VoiceOver) sobre la app — la verificación fue por inspección de DOM/ARIA generado, no por una prueba de usuario asistido. Contraste de color no se midió con una herramienta automatizada (el diseño usa texto claro sobre fondo oscuro con relaciones de contraste generosas a simple vista, pero no hay un número verificado).

## 11. Performance

- Confirmado (lectura de `main.js`): `search:query` sigue haciendo **una sola llamada** a Brave por búsqueda (igual que Etapas 1-4). El filtro de frescura no agrega una llamada extra: reemplaza la búsqueda, no la duplica.
- Imágenes: perezosa, cacheada en memoria durante esa sesión de resultados (no se repite si el usuario cambia de pestaña y vuelve).
- **Cache entre búsquedas distintas**: no existe, evaluado deliberadamente y no implementado. Razón: el beneficio es incierto (una página de resultados de navegador rara vez repite la misma consulta exacta en la misma sesión salvo con el botón "Reintentar", que sí debe pedir datos frescos) frente al costo real de mantener estado (invalidación, uso de memoria, y el riesgo de mostrarle al usuario un resultado desactualizado sin que lo pida). Documentado como decisión, no como pendiente.
- 0 mensajes de consola (verificado con un listener real de `console-message` durante una sesión completa: búsqueda con entidad + FAQ + Orbit + apertura de Imágenes).

## 12. Tests

- **Unit**: **69/69** (antes 66/66 — 3 nuevos: `buildRequest` con freshness válido, sin freshness, con freshness inválido descartado).
- **E2E**: **45 PASS / 0 FAIL / 2 SKIP** (antes 42 — 3 nuevos: filtro de frescura cambia la URL/resultados de verdad, estado de error real con un 422 genuino, mensaje + botón Reintentar). Los 2 skips son los mismos de siempre (documentados desde fases anteriores, no relacionados).

## 13. Build e instalación

`electron-builder --mac dir` reconstruido sin errores, `test/packaged-app.mjs` en PASS, app reinstalada en `/Applications/MABRIONA Browser.app` y confirmada corriendo (PID verificado con `ps aux`).

## 14. Pruebas reales realizadas en esta fase

"romeo santos" (persona, Images/Orbit/FAQ), "noticias" (freshness real con resultados distintos), "taylor swift" (News), "starbucks madrid" (Places), consulta de 500 caracteres (error real 422), y las de Etapas 1-4 ya cubiertas por la suite completa que se volvió a correr entera.

## 15. Capturas

Tres capturas reales nuevas con la función de captura del propio navegador: (1) el control "Cualquier momento ▾" integrado a la derecha de Spectrum; (2) el estado de error real con mensaje distinguible y botón Reintentar, sin ninguna pestaña de Spectrum (correcto — no hay datos que categorizar).

## 16. Problemas encontrados vs. corregidos

| Problema | Corregido |
|---|---|
| Error/límite/red se mostraba como "sin resultados" | Sí |
| Imágenes sin `alt` (contenido, no decoración) | Sí |
| Spectrum sin semántica de pestañas ARIA | Sí |
| Ausencia de un filtro real verificable | Sí (frescura) |

Ningún problema quedó a medio corregir. Ningún test en rojo.

## 17. Dependencias externas pendientes (honesto, no inventado)

Para avanzar MABRIONA AI/Shopping/Music/People más allá del infobox, se necesitaría contratar explícitamente:
- Un plan de Brave Search API con Summarizer habilitado (o un proveedor de LLM aparte) — para AI.
- Una fuente de datos de comercio/shopping real (Brave no la tiene en ningún plan) — para Shopping.
- Una fuente de datos musical estructurada (Brave no la tiene) — para Music.
- Ninguna decisión de compra se tomó automáticamente, según la regla explícita de esta fase.

## 18. Definición de terminado — checklist real

- [x] Auditoría
- [x] Web
- [x] Images
- [x] Video
- [x] News
- [x] Places
- [x] FAQ
- [x] Entity Focus
- [x] Context Orbit
- [ ] AI — sin infraestructura real, documentado
- [ ] Shopping — sin fuente real, documentado
- [ ] Music — sin fuente real, documentado
- [ ] People (más allá del infobox) — sin fuente real, documentado
- [x] Tools (frescura)
- [x] Loading / Empty / Error / Partial
- [~] Offline — comparte mensaje con error de red, documentado
- [x] Accessibility (lo encontrado, corregido; sin prueba de lector de pantalla real)
- [~] Responsive — diseño con unidades relativas/grid en todos los componentes nuevos, sin captura en múltiples resoluciones esta fase
- [x] Performance (medido: 1 llamada por búsqueda, 0 duplicadas, 0 mensajes de consola)
- [x] Security (sin cambios necesarios, freshness validado contra lista blanca)
- [x] Unit tests (69/69)
- [x] E2E (45 PASS/0 FAIL/2 SKIP)
- [x] Build
- [x] Instalación
- [x] Pruebas reales

**MABRIONA Search está production-ready para todo lo que tiene fuente de datos real** (Web, Images, Video, News, Places, FAQ, Entity Focus, Context Orbit, filtro de frescura). AI/Shopping/Music/People más allá del infobox quedan explícitamente fuera, no por deuda técnica sino por ausencia de una fuente de datos contratada — ninguno de los dos se simuló.

## 19. Próxima etapa (sugerida, sin iniciar)

Si se decide contratar el plan de Summarizer de Brave: diseñar MABRIONA AI sobre la arquitectura ya existente (`Query → Search Service → Brave → Normalization → Context Graph → UI`), citando siempre fuentes reales. Si no: evaluar exponer país/idioma como filtro real (dato ya verificado como funcional) cuando exista una señal de UX clara para hacerlo. Medir con datos reales de uso si conviene precargar Imágenes en paralelo para las búsquedas donde el usuario casi siempre la abre.
