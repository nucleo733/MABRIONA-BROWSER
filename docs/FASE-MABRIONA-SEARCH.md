# MABRIONA Search — Etapas 1-3

Fecha: 2026-08-24. No se tocó el core del navegador (pestañas, historial, favoritos, descargas, Shields, permisos, Find in Page, Settings) — solo la experiencia de búsqueda (`renderer/results.*`, `search/braveSearch.js`, `main.js` únicamente en el handler `search:query`).

## 1. Arquitectura encontrada

La búsqueda ya usaba Brave Search API real (fase anterior). Auditando la respuesta cruda de la API (no solo lo que ya se leía), aparecieron **campos reales que no se estaban usando**:

- `infobox` — panel de entidad (persona/lugar/cosa), fuente Wikipedia — exactamente lo que pedía "Entity Focus".
- `videos` — resultados de video reales (mayormente YouTube) con miniatura, duración, fuente.
- `faq` — preguntas frecuentes con fuente (no se usó todavía, queda para una etapa futura).
- `mixed` — orden sugerido de Brave para intercalar secciones (no se siguió literal, se diseñó jerarquía propia).

**No existen** en esta API: imágenes como categoría propia, noticias, mapas, compras, música como categoría separada, personas más allá del infobox, lugares. Confirmado con una llamada real, no por documentación.

## 2. Qué se reutilizó

- El motor completo de búsqueda (key server-side, IPC, CSP, form real sin JS) — sin tocar.
- `search/braveSearch.js` — se **extendió** (2 funciones nuevas: `normalizeInfobox`, `normalizeVideos`), no se reescribió `normalizeResults`.
- El respaldo de Respuestas Instantáneas de DuckDuckGo (sin key configurada) — intacto.

## 3. Propuesta visual (Design System)

Oscuro + cristal, volt como señal (no relleno): superficies `rgba(255,255,255,0.035–0.055)` con `backdrop-filter: blur()`, bordes de 1px casi invisibles, dos glows radiales muy sutiles en vez de un fondo negro plano. Pestaña activa de Spectrum: texto volt + fondo apenas más claro — nunca un bloque volt sólido llenando la pantalla.

**Prueba de identidad (sección 36 del pedido)**: se comparó visualmente contra Google — no hay fila blanca de pestañas, no hay tarjetas con sombra tipo Material, no hay azul de links. Se ve como una superficie de cristal oscura con textos y chips, no como "Google oscuro con verde".

## 4. Componentes construidos

- **Spectrum**: pestañas dinámicas — solo aparecen las que tienen datos reales para esa búsqueda (`Todo` siempre, `Web` si hay resultados, `Video` si hay videos). Nunca se muestra una pestaña de algo que no existe.
- **Entity Focus**: categoría, título, descripción, hasta 8 atributos (Nacimiento, Ocupación, Géneros, etc.), chips de perfiles oficiales con favicon real.
- **Video grid**: miniatura real, duración, fuente — clic abre la URL real (YouTube u otra), MABRIONA no aloja ni reproduce el video.
- **Vista "Todo"**: Entity Focus + una muestra de 4 videos + primeros 8 resultados web — con jerarquía, no una fila infinita de tarjetas iguales.
- **Vista "Web"**: lista completa, sin Entity Focus ni video.
- **Vista "Video"**: grilla completa.

## 5. Estado REAL / PARCIAL / PENDIENTE

| Función | Estado |
|---|---|
| Spectrum (Todo/Web/Video) | **REAL** |
| Entity Focus | **REAL** (cuando Brave lo trae — no todas las búsquedas tienen entidad reconocida, y eso está bien: no se inventa una) |
| Video | **REAL** |
| FAQ | **PENDIENTE** (dato real disponible en la misma respuesta, no integrado todavía) |
| Imágenes | **PENDIENTE** — sin dato real disponible en este plan de Brave |
| Noticias | **PENDIENTE** — sin dato real disponible |
| Mapas | **PENDIENTE** — sin proveedor cartográfico integrado |
| Música (categoría propia) | **PENDIENTE** — hoy la música aparece mezclada en Web/Video, no separada |
| Personas (más allá de Entity Focus) | **PENDIENTE** |
| Lugares | **PENDIENTE** |
| Compras | **PENDIENTE** — sin proveedor |
| MABRIONA AI | **PENDIENTE** — sin backend, a propósito no simulado |
| Context Orbit | **No iniciado** — se evaluó y se dejó para una etapa posterior (es una pieza de UI grande aparte, sin datos relacionales adicionales a los perfiles que ya muestra Entity Focus) |

## 6. Riesgos

- Ninguna búsqueda va a mostrar TODAS las pestañas siempre — depende de qué trae Brave para esa consulta puntual (esto es correcto, no un bug).
- El plan de Brave contratado no incluye imágenes/noticias — si se necesitan, hay que evaluar un plan superior o un proveedor aparte, con el mismo criterio de "nunca simular".

## 7. Tests

- 11 unit tests nuevos en `search/braveSearch.js` (`normalizeInfobox`, `normalizeVideos`) — cubren entidad real, ausencia de entidad (nunca inventa una), formas raras que no rompen, videos reales y descartados.
- 6 verificaciones end-to-end nuevas: Spectrum con pestañas reales, Entity Focus con datos reales de una búsqueda real ("romeo santos"), grilla de video real, cambio de pestaña a Web muestra solo resultados web.
- **Total: 43 unit + 28 e2e + 1 empaquetado = 72 verificaciones reales**, 0 fallas, 2 skips documentados de fases anteriores (no relacionados con Search).

## 8. Capturas

Ver el navegador instalado — captura real tomada con la función de captura de pantalla del propio MABRIONA Browser durante esta fase (Entity Focus + Video grid de "Romeo Santos" con datos 100% reales).
