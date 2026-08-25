# MABRIONA Search — Spectrum completo y relevante

Fecha: 2026-08-24. Extiende la arquitectura existente (`Query → Search Service → Brave → Normalization → Context Graph → UI`) — no se creó SearchV2 ni se duplicó ningún normalizador/servicio/llamada. Lo que ya funcionaba (Web, Images, Video, News, Places, FAQ, Entity Focus, Context Orbit, filtro de frescura, manejo de errores, accesibilidad) no se tocó salvo para integrarlo al nuevo sistema de relevancia.

## Qué se implementó

1. **Category Resolver real** (`search/spectrumResolver.js`, nuevo, puro y testeable sin Electron): decide qué pestañas de Spectrum mostrar y en qué orden, a partir de señales reales (cantidad de resultados por fuente) — nunca de una lista de consultas hardcodeadas. Se ejecuta en `main.js` (mismo lugar que Context Graph) y viaja ya resuelto al renderer.
2. **Short Videos ("Cortos")**: auditado antes de implementar. Evidencia real encontrada (sin asumir "video corto = duración corta"): el bloque de video que ya se pedía trae contenido real de TikTok y YouTube Shorts, identificable por su propia URL (`tiktok.com`, `youtube.com/shorts/...`) — cero llamadas nuevas. `isShortFormVideo()` nuevo en `braveSearch.js`.
3. **MABRIONA Tools** (`search/tools.js`, nuevo): calculadora real (parser recursivo-descendente propio, sin `eval`), conversión de unidades real (factores físicos reales: longitud, peso; fórmula real de temperatura, no un factor lineal), y hora/fecha real del sistema. Cero dependencia de Brave ni de ningún proveedor externo — es cómputo 100% de MABRIONA.
4. **Menú "Más"**: categorías reales que exceden el espacio principal (máximo 5 pestañas visibles además de "Todo") se agrupan en un desplegable real, nunca se ocultan silenciosamente.
5. **Video → Videos**: renombrado visual únicamente (mismo dato, misma arquitectura).

## Auditoría re-confirmada (mismo resultado que la fase de cierre anterior)

- `summarizer`: `OPTION_NOT_IN_PLAN` — **MABRIONA AI sigue PENDIENTE**.
- `result_filter=shopping`: 422 inválido; `/music/search`, `/people/search`, `/shopping/search`: `content-type: text/html` (página de marketing, no API real) — **Shopping/Music/People siguen PENDIENTES**, sin capacidad real, nada simulado.

## Sistema de relevancia (sin hardcodear consultas)

`resolveSpectrum({ web, videos, news, locations, tool })` puntúa cada categoría real con reglas explicables:

| Señal real | Efecto |
|---|---|
| `tool` presente (calculadora/conversión/hora) | Máxima prioridad — es la respuesta más directa posible |
| `locations.length > 0` | Alta prioridad — Places nunca coexiste con infobox (Etapa 3/4), su sola presencia es una señal fuerte de intención local |
| `news.length >= 3` | Prioridad alta (sube por encima de Web) — 3+ noticias reales es evidencia real de que la consulta es de actualidad, no una palabra clave |
| `news.length` 1-2 | Prioridad media (queda detrás de Web) |
| `web.length > 0` | Prioridad alta, casi siempre presente — sigue siendo el núcleo |
| Short videos reales (TikTok/Shorts) | Categoría "Cortos" separada de "Videos" por evidencia de URL |
| Imágenes | Prioridad media fija (única categoría "ciega" — Brave no la incluye en la respuesta principal, se autorregula del lado del cliente si la carga perezosa llega vacía) |

Verificado con datos reales en esta misma corrida: "taylor swift" → `Todo, Noticias, Web, Videos, Imágenes` (Noticias subió); "starbucks madrid" → `Todo, Lugares, Web, Cortos, Videos, Imágenes` (Lugares subió, y sí había Cortos reales de Starbucks).

## "Todo" — composición con jerarquía (sin duplicar el mismo resultado)

Orden real: Herramienta (si la consulta es exactamente eso) → Entity Focus → Context Orbit → Lugares (avance de 3) → FAQ → Noticias (avance de 3) → Cortos (avance de 4) → Videos (avance de 4) → Web (avance de 8). Cada sección se omite por completo si no hay dato real — nunca un encabezado sin contenido debajo.

## REAL / PARCIAL / PENDIENTE

| Categoría | Estado |
|---|---|
| Web, Images, Videos, News, Places, FAQ, Entity Focus, Context Orbit | REAL (preservado, sin cambios de lógica) |
| Cortos (Short Videos) | **REAL — nuevo**, evidencia por URL real |
| Herramientas (calculadora/conversión/hora) | **REAL — nuevo**, cómputo local, sin dependencia externa |
| Category Resolver / orden dinámico de Spectrum | **REAL — nuevo** |
| Menú "Más" | **REAL — nuevo** |
| MABRIONA AI | PENDIENTE — sin infraestructura real (re-confirmado hoy) |
| Shopping | PENDIENTE — sin fuente real (re-confirmado hoy) |
| Music (categoría propia) | PENDIENTE — sin fuente real (re-confirmado hoy) |
| People (más allá del infobox) | PENDIENTE — sin fuente real (re-confirmado hoy) |

## Seguridad y performance

Sin llamadas nuevas para Cortos (mismo bloque de video ya pedido), sin llamadas para Tools (cálculo local en el proceso principal), sin llamadas nuevas para el resolver (opera sobre datos ya normalizados). CSP/contextIsolation/sandbox sin cambios.

## Accesibilidad

Mantenido el patrón `role="tablist"`/`"tab"` + navegación por flechas de la fase anterior, extendido a los botones reconstruidos dinámicamente (`rebuildTabButtons`) y al menú "Más" (`aria-haspopup`, `aria-expanded`, items con `role="tab"`).

## Tests

- **Unit**: **91/91** (antes 69) — 22 nuevos: `isShortFormVideo`/`normalizeVideos` (3), `search/tools.js` completo (11), `search/spectrumResolver.js` completo (9, cubre persona/lugar/noticia/video/consulta general/sin resultados/una sola categoría/muchas categorías con overflow/sin duplicados).
- **E2E**: **50 PASS / 0 FAIL / 3 SKIP** (antes 45) — 6 nuevos: calculadora real ("23 * 47" = 1081), conversión real ("10 km to miles" = 6.2137 millas), orden de relevancia real (Noticias/Lugares suben por encima de Web con datos reales), Cortos real, menú "Más" (con `skip()` cuando esa corrida no generó suficiente overflow — no determinístico, documentado). Los 2 skips previos siguen siendo los mismos de siempre.

## Build, instalación y capturas

`electron-builder --mac dir` reconstruido, `test/packaged-app.mjs` en PASS, reinstalado y verificado en `/Applications/MABRIONA Browser.app`. Tres capturas reales: calculadora ("23 * 47 = 1081" con pestaña Herramientas), conversión de unidades ("10 km equivale a 6.2137 millas" con Cortos reales sobre el mismo tema debajo), y la pestaña Cortos activa mostrando videos reales de Starbucks Madrid.

## Próxima etapa (sugerida, sin iniciar)

Si se contrata un plan de Brave con Summarizer: MABRIONA AI podría integrarse al Category Resolver con la máxima prioridad ya reservada conceptualmente. Evaluar exponer país/idioma como filtro real cuando exista una señal de UX clara.
