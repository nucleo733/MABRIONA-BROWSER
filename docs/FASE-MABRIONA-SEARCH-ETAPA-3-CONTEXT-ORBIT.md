# MABRIONA Search — Etapa 3: Context Orbit

Fecha: 2026-08-24. No se tocó Brave Search, `normalizeResults()`, el IPC de Etapa 1/2, la CSP, ni Entity Focus/FAQ/Spectrum ya construidos — Context Orbit es una capa nueva (`search/contextGraph.js`) que se lee de los mismos datos ya normalizados.

## Decisión

# IMPLEMENTADO

Con evidencia real suficiente (ver auditoría abajo), no con datos inventados: cada nodo que aparece en pantalla tiene un campo real de Brave detrás y un enlace que abre contenido real.

## 1. Auditoría de datos (Paso 1, antes de escribir código de producción)

Se hicieron llamadas reales a la API con más de 15 búsquedas distintas (persona, empresa, lugar, aplicación, producto, negocio local, tema de actualidad, tema de discusión) para ver qué bloques trae Brave y con qué estructura exacta.

| Dato | Existe | Estructurado | Relacionable con la entidad | Fuente |
|---|---|---|---|---|
| `infobox` (entidad) | Sí, algunas búsquedas | Sí | Es el centro del grafo | Ya normalizado (Etapa 1) |
| `infobox.attributes[].value` con `<a href>` | Sí, cuando el atributo referencia otra página (ej. Founders, Key people) | Sí — HTML real con enlaces reales | **Sí, la más fuerte de todas**: Wikipedia enlaza explícitamente a otra entidad real | Nueva — `extractRelatedEntities()` |
| `infobox.profiles[]` | Sí | Sí (name/url/img) | Sí — explícito, es la propia entidad declarando su presencia | Ya normalizado (Etapa 1) |
| `infobox.url` (fuente) | Sí, casi siempre que hay infobox | Sí | Sí — explícito | Ya normalizado (Etapa 1) |
| `faq` | Sí, algunas búsquedas | Sí | Solo por co-ocurrencia con la misma búsqueda que reconoció la entidad | Ya normalizado (Etapa 2) |
| `videos` | Sí, la mayoría de búsquedas | Sí | Solo por co-ocurrencia | Ya normalizado (Etapa 1) |
| `news` | Sí, solo búsquedas de actualidad ("taylor swift", "breaking news today") | Sí (title/url/hostname/fecha) | Solo por co-ocurrencia | Nueva — `normalizeNews()` |
| `discussions` | Sí, solo temas amplios/de foro (Reddit) | Sí (title/url/forum_name) | Solo por co-ocurrencia | Nueva — `normalizeDiscussions()` |
| `locations` | Sí, solo negocios locales ("starbucks nueva york") | Sí (dirección, horario, rating, coordenadas) | **No demostrable**: en las +15 búsquedas auditadas, `locations` nunca apareció junto con `infobox` — son mutuamente excluyentes en esta API | Auditado, no usado |
| `mixed` | Sí, siempre | Sí (orden sugerido por Brave) | No aporta relaciones nuevas, solo dice en qué orden mostrar bloques que ya se tienen | Auditado, no usado — Etapa 3 diseña su propia jerarquía visual, no copia el orden de Brave |

## 2. Relaciones reales (A–E)

**A. Relaciones que ya podíamos obtener:** ninguna — Etapa 2 normalizaba `profiles`/`sourceUrl` pero nunca los conectaba entre sí como grafo.

**B. Relaciones que se pueden derivar de forma segura:** las 6 de la tabla marcadas "Sí" en la columna "Relacionable" — todas con un campo real detrás, nunca una suposición semántica externa.

**C. Relaciones que NO se pueden demostrar:** entidad ↔ lugar cercano (sin co-ocurrencia real de `infobox`+`locations`), entidad ↔ género/tema (ej. "Romeo Santos" ↔ "Bachata" como concepto — el atributo "Genres" es texto plano, no un enlace, así que no hay URL real que verificar), cualquier relación que exigiera conocimiento externo del modelo en vez de un campo verificable.

**D. Relaciones que necesitarían otra fuente:** un grafo de conocimiento real (tipo Wikidata) daría relaciones tipadas explícitas persona↔organización↔lugar con mejor cobertura que parsear enlaces de Wikipedia a mano. No se contrató nada — se documenta como posible mejora futura, no se decide ahora (regla de esta etapa: no comprar APIs todavía).

**E. Qué forma parte de Context Orbit hoy:** fuente (`source`), perfiles (`profile_of`), entidades enlazadas dentro de atributos (relación = la etiqueta real del atributo, ej. "Founders", "Key people"), y — con confianza menor — FAQ/video/noticias/discusiones cuando coinciden con una entidad ya reconocida.

## 3. Arquitectura del Context Graph

`search/contextGraph.js` — módulo puro, sin red, sin Electron, testeable con `node --test`:

- `extractRelatedEntities(attributes)`: recorre `infobox.attributes[].value` (HTML real, no se le vuelve a pedir nada a Brave) con una expresión regular sobre `<a href="...">Nombre</a>`, deduplicando por URL.
- `buildContextGraph({ infobox, faq, videos, news, discussions })`: arma `{ center, edges }`. Cada `edge` tiene `source`, `target { id, label, url, type }`, `type` (el verbo de la relación), `evidence` (string legible, de dónde sale), `confidence` (`'high'` o `'medium'`, nunca `'low'`), `origin` (qué campo de Brave). Devuelve `null` si no hay `infobox`, o si hay `infobox` pero cero relaciones reales — la ausencia nunca se disfraza de componente vacío.
- Límites reales para que el diagrama sea legible, no una telaraña: máx. 4 perfiles, 4 entidades relacionadas, 2 FAQ, 2 video, 2 noticias, 2 discusiones, y un tope total de 8 nodos (prioriza automáticamente lo de confianza `high` porque se agrega primero).
- `main.js`: el handler `search:query` ya tenía toda la respuesta de Brave en memoria — `buildContextGraph()` se llama con lo que ya se normalizó, **cero llamadas de red nuevas**. `news`/`discussions` se normalizan solo para alimentar el grafo, no se exponen como secciones propias del IPC (siguen sin ser una categoría de Spectrum).

## 4. UI — Context Orbit

`renderContextOrbit()` en `renderer/results.js`: diagrama orbital propio (no es un mapa mental genérico ni una red de círculos decorativa):

- El núcleo (`.orbit-core`) es la entidad, en el centro.
- Cada nodo se posiciona con trigonometría real (`50 + 50·cos/sin(ángulo)`) según la cantidad real de relaciones — 2 relaciones dan 2 nodos, 8 dan 8, nunca un número fijo.
- Cada nodo es un `<a href>` real: hover/foco muestra nombre + tipo + relación (tooltip real, sin datos falsos) y clic navega al contenido original — no hay navegación simulada.
- Volt se usa exclusivamente en hover/foco (punto y anillo). El resto del tiempo los nodos son puntos neutros — se verificó visualmente que no se convierte en "un navegador verde".
- Sin imágenes de terceros en los nodos (deliberado: evita tener que abrir la CSP a una lista abierta de dominios de miniaturas/favicons de destinos arbitrarios).
- Se ubica entre Entity Focus y FAQ en la composición de "Todo" — no reemplaza ni compite con Spectrum, que sigue igual (Todo/Web/Video).

## 5. REAL / PARCIAL / PENDIENTE

| Función | Estado |
|---|---|
| Context Orbit — diagrama con relaciones reales evidenciadas | **REAL** |
| Relación fuente / perfiles / entidades enlazadas (confianza high) | **REAL** |
| Relación FAQ/video/noticias/discusiones co-evidenciadas (confianza medium) | **REAL**, con confianza explícitamente menor |
| Ausencia de Orbit cuando no hay relaciones reales | **REAL** (probado con test dedicado) |
| Entidad ↔ lugar cercano | **PENDIENTE** — sin evidencia real de co-ocurrencia con `infobox` |
| Grafo de conocimiento externo (Wikidata u otra fuente) | **PENDIENTE** — necesitaría una fuente nueva, no evaluada para contratar todavía |
| News/Discussions como sección/pestaña propia de MABRIONA Search | **PENDIENTE**, sin cambios — hoy solo se usan como nodos de contexto, no como categoría completa (cobertura/límites del plan sin auditar para ese uso) |

## 6. Riesgos

- Algunas entidades (ej. una entrada de infobox de tipo "programming" sin `attributes` con enlaces) pueden no generar ningún Context Orbit — es correcto, no un bug.
- Los nombres de relación mostrados en el tooltip (ej. "Founders", "Key people") vienen tal cual los etiqueta Wikipedia/Brave, en inglés cuando la fuente lo está — no se traducen para no alterar el significado exacto del campo real.

## 7. Tests

- **Unit** (`test/contextGraph.test.js`, nuevo): 12 tests — ausencia sin infobox, ausencia sin relaciones, relación `source`, `profile_of`, extracción real de enlaces (caso real de Apple Inc.), forma de atributos sin romper, ningún edge con confianza `low`, FAQ/video/noticias/discusiones siempre `medium`, deduplicación por URL, límite total de 8 nodos con muchas relaciones disponibles, ninguna relación disponible no rompe. Total del repo: **59/59** (antes 47/47).
- **E2E** (`test/smoke.mjs`): 4 verificaciones nuevas sobre "romeo santos" (búsqueda real): Orbit con nodos reales, el núcleo coincide con Entity Focus, cada nodo es un enlace real a contenido original, el tooltip explica la relación. La pestaña Web ahora también verifica que oculta Context Orbit. Resultado: **35 PASS / 0 FAIL / 2 SKIP** (mismos 2 skips documentados de fases anteriores).

## 8. Performance

Cero llamadas de red adicionales — `buildContextGraph()` opera sobre la misma respuesta de Brave que ya se pedía para Spectrum/Entity Focus/FAQ. Confirmado leyendo `main.js`: una sola `fetch()` por búsqueda, igual que en Etapa 1 y 2.

## 9. Seguridad

API key server-side sin cambios, IPC sin nuevos canales (todo viaja dentro de la respuesta existente de `search:query`), CSP sin cambios (los nodos de Orbit son enlaces de texto, no imágenes de terceros), `contextIsolation`/`sandbox` sin cambios. Los `href` de los nodos se asignan como propiedad DOM (`node.href = ...`), nunca vía `innerHTML`, consistente con el resto de la app.

## 10. Build

`electron-builder --mac dir` reconstruido sin errores, `test/packaged-app.mjs` en PASS, app reinstalada y verificada corriendo en `/Applications/MABRIONA Browser.app`.

## 11. Capturas

Dos capturas reales con la función de captura del propio navegador, búsqueda "romeo santos": (1) el diagrama completo con 8 nodos reales conectados al núcleo "Romeo Santos", integrado sobre MABRIONA FAQ; (2) un nodo enfocado mostrando el tooltip real ("en.wikipedia.org / FUENTE / source") con el anillo Volt de foco.
