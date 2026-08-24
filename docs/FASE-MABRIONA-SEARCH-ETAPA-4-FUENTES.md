# MABRIONA Search — Etapa 4: Expansión de fuentes reales

Fecha: 2026-08-24. No se tocó Brave Search, `normalizeResults()`, el IPC de Etapas 1-3, Entity Focus, FAQ, Context Orbit ni la arquitectura existente (`Query → Search Service → Brave → Normalization → Context Graph → UI`) — esta etapa la extiende, no crea una segunda.

## Decisión

# B) Implementar solamente las categorías con datos suficientes

Images, News y Places/Locations: **IMPLEMENTADAS**, con evidencia real verificada contra la cuenta actual. Shopping, Music y People (más allá del infobox): **PENDIENTES** — no por falta de tiempo, sino porque no existe capacidad real en esta API, verificado con llamadas reales, no con documentación.

## 1. Auditoría real (Paso 1) — qué tiene la cuenta actual

Se probó, con la key ya configurada, cada endpoint/parámetro contra la API real (no contra la documentación):

| Prueba | Resultado real |
|---|---|
| `GET /res/v1/images/search` | **200**, JSON real (`type`, `query`, `results`, `extra`) |
| `GET /res/v1/news/search` | **200**, JSON real |
| `GET /res/v1/videos/search` | **200** (ya cubierto desde Etapa 1 vía el bloque embebido, sin necesidad de este endpoint aparte) |
| `GET /res/v1/suggest/search` | **400** `OPTION_NOT_IN_PLAN` — no disponible en esta cuenta |
| `GET /res/v1/spellcheck/search` | **400** `OPTION_NOT_IN_PLAN` — no disponible en esta cuenta |
| `result_filter=images` en el endpoint unificado | **422** — `images` no es un valor válido del enum |
| `result_filter=shopping` en el endpoint unificado | **422** — `shopping` no es un valor válido del enum. Enum real completo: `discussions, faq, infobox, news, query, videos, web, summarizer, locations, rich` |
| Endpoints adivinados `/locations/search`, `/places/search`, `/music/search`, `/people/search`, `/shopping/search` | **200 pero `content-type: text/html`** — es la página de marketing de Brave (fallback genérico), no una API real. Ninguno de estos endpoints existe |
| Cabeceras de límite (`x-ratelimit-*`) en una llamada real | `x-ratelimit-policy: 50;w=1, 0;w=2678400` — 50 solicitudes por segundo observadas; el segundo valor (ventana mensual) se documenta tal cual, sin asumir su significado exacto |

## 2. Matriz de capacidades

| Capacidad | Disponible | Respuesta real | Datos útiles | Implementable | Observación |
|---|---|---|---|---|---|
| **Images** | Sí — endpoint dedicado autorizado | `title`, `url`, `source`, `thumbnail{src,width,height}`, `properties{url,width,height}`, `meta_url` | Miniatura real (proxeada por Brave, mismo dominio ya permitido en CSP), título, fuente, dimensiones | **Sí** | 50 resultados reales en la prueba con "romeo santos". Requiere llamada aparte (no viene en el endpoint unificado) |
| **News** | Sí — embebido en la respuesta ya usada, sin llamada aparte | `title`, `url`, `description`, `age`, `page_age`, `meta_url.hostname`, `thumbnail` | Suficientes para una tarjeta real con fecha de frescura | **Sí** | Se confirmó que el bloque embebido trae exactamente los mismos campos que el endpoint dedicado — se usa el embebido, cero llamadas nuevas |
| **Places/Locations** | Sí — embebido en la misma respuesta, sin llamada aparte | nombre, dirección real, teléfono, rating, reseñas, horario de hoy, foto | Suficientes para una tarjeta real de negocio local | **Sí** | Confirmado mutuamente excluyente con `infobox` (ver Etapa 3): nunca coexisten, así que es categoría propia de Spectrum, no un dato de Entity Focus |
| **Shopping** | **No** | — | — | **No** | No es un valor válido de `result_filter`, y no existe endpoint dedicado (las rutas adivinadas devuelven HTML de marketing, no JSON). Sin evidencia de que Brave ofrezca esta categoría en ningún nivel |
| **Music** (categoría propia) | **No** | — | — | **No** | Sin endpoint, sin parámetro. La música que aparece hoy es solo dentro de Web/Video, sin categoría separada |
| **People** (más allá del infobox) | **No** | — | — | **No** | Sin endpoint. El único dato de personas sigue siendo el infobox, ya cubierto desde Etapa 2 |

## 3. Images

Implementado como pestaña **perezosa**: no se pide en cada búsqueda (gastaría cupo sin necesidad la mayoría de las veces que el usuario nunca la abre) — se llama a `/res/v1/images/search` solo cuando el usuario hace click en "Imágenes" (`search:images`, IPC nuevo en `main.js`, expuesto vía `search-preload.js`). El resultado se cachea en memoria para esa sesión de resultados (no se vuelve a pedir si el usuario cambia de pestaña y vuelve).

Diseño: grilla `.images-grid` propia (no es el mosaico de Google Images) — tarjetas de cristal oscuro con miniatura, título y fuente. Las miniaturas usan siempre el proxy de Brave (`imgs.search.brave.com`, mismo dominio ya permitido en la CSP desde Etapa 1) — nunca se carga una imagen de un dominio de terceros directamente, así que no hizo falta tocar la CSP. Cada tarjeta enlaza a la página fuente real (nunca a la imagen cruda de un tercero).

**Regla de ausencia real**: como MABRIONA no puede saber si hay imágenes hasta pedirlas, la pestaña "Imágenes" se ofrece de entrada (evidencia empírica: prácticamente toda búsqueda real trae resultados), pero si la respuesta real llega vacía para una consulta puntual, la pestaña se retira sola del Spectrum y se vuelve a "Todo" — nunca se deja una pestaña mostrando un grid vacío.

## 4. News (MABRIONA News)

Implementado usando el bloque `news` que ya venía en la respuesta que Etapa 1-3 ya pedían — **cero llamadas nuevas**. `normalizeNews()` se extendió (no se reescribió) con `description`, `age` y `thumbnail`, que ya estaban en el dato real y antes se descartaban.

Diseño: lista `.news-list` propia — tarjeta con miniatura, título, descripción recortada, fuente y antigüedad ("3 hours ago", dato real de Brave, no se traduce ni se recalcula). Aparece como pestaña "Noticias" solo si `news.length > 0`, y como avance de 3 noticias dentro de "Todo" cuando corresponde.

## 5. Places (MABRIONA Places)

`normalizeLocations()` nuevo, sobre el bloque `locations` ya presente en la misma respuesta — sin llamada aparte. Diseño: lista `.places-list` — nombre, dirección real, rating+reseñas cuando existen, horario de **hoy** (no la semana completa, para no sobrecargar la tarjeta), enlace real a la página del lugar. **No hay mapa**: no se contrató ningún proveedor de mapas, y no se simula uno — es una lista de datos reales, consistente con la prohibición explícita de esta etapa.

## 6. Spectrum, Entity Focus y Context Orbit — integración

- **Spectrum**: dinámico como siempre — `Noticias`/`Lugares` solo aparecen con datos reales; `Imágenes` se autorregula (ver arriba). Ninguna pestaña se muestra vacía.
- **Entity Focus**: sin cambios — Places nunca coexiste con `infobox` (confirmado de nuevo en esta auditoría), así que no había ninguna integración real posible ahí sin inventar una relación.
- **Context Orbit**: sin cambios de arquitectura — ya usaba `news` como nodo de confianza `medium` desde Etapa 3; ahora ese mismo dato, más rico, también alimenta la pestaña Noticias. No se agregaron nodos de Images/Places al grafo: no hay evidencia de relación estructurada de esos datos con la entidad (mismo criterio estricto de Etapa 3 — co-ocurrencia sola no basta para más nodos, y ya se está en el límite razonable de 8 nodos totales).

## 7. Performance

- News y Places: **cero llamadas nuevas** — mismo `fetch()` que ya existía.
- Images: **una llamada nueva, pero perezosa** — solo ocurre si el usuario abre esa pestaña, nunca en cada búsqueda.
- Si Images falla (red, error, plan): `images = []`, se retira la pestaña, el resto de MABRIONA Search sigue funcionando normal (verificado con manejo de errores explícito en el handler).

## 8. Seguridad

Sin cambios: API key server-side (el nuevo handler `search:images` sigue el mismo patrón que `search:query`), IPC nuevo pero del mismo tipo (`ipcMain.handle`/`ipcRenderer.invoke`), CSP sin modificar (las imágenes usan un dominio ya permitido), `contextIsolation`/`sandbox` intactos.

## 9. Pruebas reales realizadas

Se probaron más de 10 búsquedas reales para armar la matriz y verificar el comportamiento: "romeo santos" (persona, Images), "apple inc" (empresa, sin News), "taylor swift" (persona con News+Discussions+FAQ+infobox simultáneos), "starbucks madrid"/"starbucks nueva york" (Places, sin infobox), "javascript"/"museo del prado madrid" (infobox+FAQ+Video sin Places), "cnn news"/"breaking news today"/"noticias de hoy" (News sin infobox), "tesla model 3"/"iphone 15" (sin categoría reconocida), "mejor laptop reddit" (Discussions).

## 10. REAL / PARCIAL / PENDIENTE

| Función | Estado |
|---|---|
| MABRIONA Images (pestaña perezosa, grid propio) | **REAL** |
| MABRIONA News (pestaña + avance en Todo + nodo de Context Orbit ya existente) | **REAL** |
| MABRIONA Places (pestaña + avance en Todo) | **REAL** |
| Retiro automático de la pestaña Imágenes cuando no hay datos | **REAL** |
| Shopping | **PENDIENTE** — sin capacidad real en esta API, confirmado |
| Music (categoría propia) | **PENDIENTE** — sin capacidad real en esta API, confirmado |
| People (más allá del infobox) | **PENDIENTE** — sin capacidad real en esta API, confirmado |
| Suggest / autocompletado | **PENDIENTE** — no relacionado a las 6 categorías pedidas, pero confirmado fuera del plan actual (`OPTION_NOT_IN_PLAN`) |

## 11. Tests

- **Unit**: 7 nuevos en `test/braveSearch.test.js` (`buildImagesRequest`, `normalizeNews` extendido ×2, `normalizeLocations` ×2, `normalizeImages` ×2). Total del repo: **66/66** (antes 59/59).
- **E2E** (`test/smoke.mjs`): verificaciones nuevas con datos reales — Imágenes carga al abrir la pestaña (49 imágenes reales para "romeo santos", miniatura del proxy de Brave, enlace real a la fuente), Noticias reales para "taylor swift" (10 tarjetas, enlace real), Lugares reales para "starbucks madrid" (dirección real de Madrid). Resultado: **42 PASS / 0 FAIL / 2 SKIP** (mismos 2 skips documentados de fases anteriores).

## 12. Build

`electron-builder --mac dir` reconstruido sin errores, `test/packaged-app.mjs` en PASS, app reinstalada y verificada corriendo en `/Applications/MABRIONA Browser.app`.

## 13. Capturas

Tres capturas reales con la función de captura del propio navegador: (1) pestaña Imágenes para "romeo santos" — grilla con fotos reales de conciertos, fuentes gettyimages.com/hola.com/concertarchives.org; (2) pestaña Noticias para "taylor swift" — 4+ tarjetas reales con fuente y antigüedad real; (3) pestaña Lugares para "starbucks madrid" — 4 sucursales reales con dirección, horario de hoy y rating reales.

## 14. Problemas encontrados

Ninguna regresión. El único ajuste de diseño no trivial fue decidir cómo tratar la pestaña Imágenes al no poder confirmar sus datos sin una llamada aparte — resuelto con carga perezosa + auto-retiro si llega vacía, documentado explícitamente arriba para que la decisión quede trazable.

## 15. Próxima etapa

Sugerido, sin iniciar: evaluar si conviene pedir Images en paralelo a la búsqueda principal quando el usuario tiende a abrir esa pestaña casi siempre (dato de uso que hoy no se mide), e integrar `faq` restante de News (extra_snippets) si aporta valor real a la tarjeta. Shopping/Music/People siguen bloqueadas por falta de fuente, no por falta de tiempo — necesitarían contratar una API nueva, decisión que esta etapa no tomó a propósito.
