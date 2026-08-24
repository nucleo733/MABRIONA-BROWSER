# MABRIONA Search — Etapa 2: FAQ + Entity Focus avanzado

Fecha: 2026-08-24. No se tocó nada del core del navegador ni se reemplazó Brave Search, `normalizeResults()`, el IPC existente ni la CSP — solo se extendió `search/braveSearch.js`, el handler `search:query` de `main.js`, y `renderer/results.*`.

## 1. Auditoría (antes de tocar código)

Se hizo una llamada real a la API de Brave (no se asumió nada de documentación) con varias búsquedas de distinto tipo — persona, empresa, lugar, aplicación, producto sin categoría — para ver la forma exacta de los datos:

- **FAQ es real y ya venía en la respuesta**, sin usar: `data.faq.results[]`, cada uno con `question`, `answer` (HTML), `title`, `url`, `meta_url.hostname`. No todas las búsquedas la traen (ej. "apple inc" no tiene FAQ; "romeo santos" trae 3; "what is javascript" trae 9).
- **Se encontró un bug real en producción** en `normalizeInfobox`: Wikipedia intercala filas separadoras de sección dentro de `attributes` (ej. `["<span><strong>Height</strong></span>", null]`). El código de la Etapa 1 no las filtraba, y `String(null)` las convertía en un atributo real de valor literal `"null"` — exactamente el tipo de placeholder falso que esta etapa prohíbe. Se reprodujo con "eiffel tower" y "tesla model 3" antes de corregirlo.
- **`category` es un dato real y variable**: `person`, `company`, `place`, `application`, `programming`, y a veces ausente (productos como "iphone 15"). Confirma que Entity Focus debe adaptarse, no forzar una plantilla.
- **`box.url`** (el link a la fuente real, casi siempre Wikipedia) ya se normalizaba en Etapa 1 pero **nunca se mostraba** en la interfaz — un vacío real frente al requisito de conservar procedencia.

## 2. Qué se implementó

- **`normalizeFaq(data)`** en `braveSearch.js`: extrae pregunta/respuesta/fuente reales. Devuelve `[]` si Brave no trae FAQ para esa búsqueda — nunca redacta una pregunta.
- **Corrección del bug de atributos falsos**: `normalizeInfobox` ahora descarta cualquier fila donde el valor sea `null` o esté vacío.
- **`main.js`**: `search:query` agrega `faq` a la respuesta, usando la misma llamada a Brave que ya se hacía — cero llamadas de red nuevas.
- **Entity Focus reestructurado** en jerarquía real (secciones con encabezado, cada una se omite si no hay dato): Identidad → Atributos → Presencia web → **Fuente** (nuevo: enlace real a la página de origen, ej. "Fuente: en.wikipedia.org →").
- **Categoría traducida al español** de MABRIONA (`person` → "Persona", `company` → "Empresa", etc.) — es formato del dato real, no invención; si Brave manda una categoría no mapeada, se muestra tal cual.
- **Componente MABRIONA FAQ**: acordeón propio (expandir/contraer con `aria-expanded`, sin librerías), cada pregunta con su fuente real cuando existe. Se ubica en la vista "Todo", entre Entity Focus y Video — solo aparece si `faq.length > 0`.

## 3. Datos reales utilizados (ningún campo inventado)

| Campo | Origen | Uso |
|---|---|---|
| `faq.results[].question/answer` | Brave (misma respuesta) | Preguntas/respuestas de MABRIONA FAQ |
| `faq.results[].url` / `meta_url.hostname` | Brave | Enlace y texto de fuente en cada pregunta |
| `infobox.results[0].url` | Brave (Etapa 1, sin mostrar) | Enlace "Fuente" del Entity Focus |
| `infobox.results[0].category` | Brave | Etiqueta de identidad traducida |

## 4. Estado REAL / PARCIAL / PENDIENTE

| Función | Estado |
|---|---|
| MABRIONA FAQ (acordeón, fuente real) | **REAL** |
| Entity Focus — jerarquía Identidad/Atributos/Presencia web/Fuente | **REAL** |
| Corrección de atributos con valor falso "null" | **REAL** (bug corregido, con test de regresión) |
| Entity Focus adaptativo por tipo de entidad | **REAL** — ya no fuerza secciones vacías; validado con persona, empresa, lugar y aplicación (categorías reales distintas confirmadas por API) |
| Spectrum (Todo/Web/Video) | **REAL**, sin cambios de Etapa 1 |
| Video Grid | **REAL**, sin cambios de Etapa 1 |
| Context Orbit | **No iniciado** (ver sección 6) |
| MABRIONA AI, Imágenes, Noticias, Mapas, Compras, Música propia | **PENDIENTE**, sin cambios — sin fuente real disponible |

## 5. Riesgos

- La FAQ no aparece en toda búsqueda (correcto, depende de Brave). El test e2e usa `skip()` para esa aserción específica cuando no llega en la corrida, igual que Entity Focus desde Etapa 1.
- Las respuestas de FAQ vienen en inglés cuando la fuente original lo está (ej. "romeo santos" trae respuestas de sitios en inglés) — es el dato real tal cual Brave lo entrega; MABRIONA no traduce contenido de terceros para no alterar su significado.

## 6. Context Orbit — evaluación (sin implementar)

Por instrucción explícita de esta etapa, no se construyó Context Orbit. Evaluación real de los datos disponibles hoy:

- Entity Focus trae `profiles[]` (enlaces a Wikipedia/redes/sitios oficiales) — son enlaces planos, **no relaciones tipadas** (no dice "es hermano de", "trabajó en", etc.), así que no alcanzan para un diagrama relacional honesto.
- FAQ y Video no aportan datos relacionales adicionales, solo contenido plano.
- **Conclusión**: Context Orbit necesitaría una fuente de datos distinta (un grafo de entidades real) que hoy no existe. Construirlo ahora sobre lo que hay sería inventar relaciones — se mantiene fuera de esta etapa.

## 7. Tests

- **Unit**: 4 tests nuevos (`normalizeFaq` ×3, regresión del bug de atributos ×1). Total: **47/47** (antes 43/43).
- **E2E**: 3 verificaciones nuevas sobre "romeo santos" (búsqueda real): FAQ integrada con 3 preguntas reales, expandir una pregunta muestra la respuesta real, Entity Focus conserva el enlace de fuente. La pestaña Web ahora también verifica que oculta la FAQ además de Entity Focus. Resultado: **31 PASS / 0 FAIL / 2 SKIP** (mismos 2 skips documentados de fases anteriores, no relacionados).

## 8. Build

`electron-builder --mac dir` reconstruido sin errores, `test/packaged-app.mjs` en PASS, app reinstalada y corriendo en `/Applications/MABRIONA Browser.app` (PID confirmado con `ps aux`).

## 9. Capturas

Dos capturas reales tomadas con la función de captura de pantalla del propio navegador, búsqueda "romeo santos": (1) Identidad + Atributos limpios (sin el bug de "null") + Presencia web; (2) Fuente real de Wikipedia + MABRIONA FAQ con una pregunta expandida mostrando su respuesta y fuente (ticketmaster.com) + Video grid.

## 10. Próxima etapa

Sugerido, sin iniciar: integrar `faq` a nivel de fuente/traducción cuando aplique, evaluar si Entity Focus necesita paginar atributos cuando hay muchos (ej. "Apple Inc." trae más de 8), y revisar si conviene una fuente de datos de grafo real antes de retomar Context Orbit.
