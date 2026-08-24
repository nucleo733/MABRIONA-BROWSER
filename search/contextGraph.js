'use strict'

/**
 * Context Graph — el modelo de datos detrás de Context Orbit.
 *
 * No hace ninguna llamada de red propia: arma un grafo de relaciones REALES a partir de lo que
 * `search/braveSearch.js` ya normalizó de UNA sola respuesta de Brave. Cada relación (edge) debe
 * poder señalar exactamente de qué campo real salió (`origin`) y por qué se considera una relación
 * (`evidence`) — nunca se inventa una arista.
 *
 * Auditoría que sostiene este diseño (ver docs/FASE-MABRIONA-SEARCH-ETAPA-3-CONTEXT-ORBIT.md):
 * - `infobox.attributes[].value` a veces trae HTML con <a href> reales hacia OTRAS páginas de
 *   Wikipedia (ej. Apple Inc. → "Founders" enlaza a Steve Jobs, Steve Wozniak) — la única relación
 *   entidad-a-entidad genuinamente estructurada que existe en esta API. Confianza: high.
 * - `infobox.profiles[]` — presencia web explícita de la entidad (perfil oficial/red social).
 *   Confianza: high.
 * - `infobox.sourceUrl` — de dónde sale la entidad (casi siempre Wikipedia). Confianza: high.
 * - `faq`/`videos`/noticias/discusiones que Brave devolvió en la MISMA respuesta que ya reconoció
 *   una entidad real (`infobox` presente) — evidencia real de que Brave asoció ese contenido a esta
 *   búsqueda puntual, pero sin un campo explícito que diga "esto es sobre la entidad X" (a
 *   diferencia de `profiles`/`attributes`). Confianza: medium — nunca more que eso, y solo se usan
 *   cuando `infobox` existe (si no hay entidad reconocida, no hay con qué relacionarlos).
 * - `locations`: NUNCA apareció junto a `infobox` en ninguna búsqueda de auditoría (son mutuamente
 *   excluyentes en esta API — una consulta es "entidad de conocimiento" O "negocio local", no
 *   ambas). Sin evidencia real de esa relación, no se usa acá.
 */

const PROFILES_CAP = 4
const RELATED_ENTITY_CAP = 4
const FAQ_CAP = 2
const VIDEO_CAP = 2
const NEWS_CAP = 2
const DISCUSSION_CAP = 2
const TOTAL_EDGES_CAP = 8

/** Enlaces reales <a href="...">Nombre</a> dentro de los valores (HTML crudo) de los atributos del
 * infobox — la única fuente real de relaciones "esta entidad conecta con esta otra entidad". */
function extractRelatedEntities(attributes) {
  const linkPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  const seen = new Set()
  const out = []
  for (const attr of attributes) {
    if (typeof attr.value !== 'string') continue
    linkPattern.lastIndex = 0
    let match
    while ((match = linkPattern.exec(attr.value))) {
      const url = match[1]
      const name = match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      if (!url || !name || seen.has(url)) continue
      seen.add(url)
      out.push({ url, name, relationLabel: attr.label })
    }
  }
  return out
}

/**
 * Arma el Context Graph de una entidad. Devuelve `null` cuando no hay entidad reconocida (sin
 * infobox no hay centro del grafo) o cuando, aun habiendo entidad, no se encontró ninguna relación
 * real que mostrar — la ausencia de Orbit es una respuesta válida, nunca un componente vacío.
 */
function buildContextGraph({ infobox, faq = [], videos = [], news = [], discussions = [] }) {
  if (!infobox || !infobox.title) return null

  const center = { id: infobox.title, label: infobox.title }
  const edges = []
  const seenTargets = new Set()

  function addEdge(edge) {
    if (seenTargets.has(edge.target.id)) return
    seenTargets.add(edge.target.id)
    edges.push(edge)
  }

  if (infobox.sourceUrl) {
    let sourceLabel = infobox.sourceUrl
    try { sourceLabel = new URL(infobox.sourceUrl).hostname } catch { /* URL rara, usar tal cual */ }
    addEdge({
      source: center.id,
      target: { id: infobox.sourceUrl, label: sourceLabel, url: infobox.sourceUrl, type: 'SOURCE' },
      type: 'source',
      evidence: 'Enlace explícito de la entidad a su fuente original',
      confidence: 'high',
      origin: 'infobox.url',
    })
  }

  for (const profile of infobox.profiles.slice(0, PROFILES_CAP)) {
    addEdge({
      source: center.id,
      target: { id: profile.url, label: profile.name, url: profile.url, type: 'WEBSITE' },
      type: 'profile_of',
      evidence: `Perfil real listado por la propia entidad (${profile.name})`,
      confidence: 'high',
      origin: 'infobox.profiles',
    })
  }

  const related = extractRelatedEntities(infobox.attributes).slice(0, RELATED_ENTITY_CAP)
  for (const rel of related) {
    addEdge({
      source: center.id,
      target: { id: rel.url, label: rel.name, url: rel.url, type: 'ENTITY' },
      type: rel.relationLabel,
      evidence: `Enlace real dentro del atributo "${rel.relationLabel}" de la entidad`,
      confidence: 'high',
      origin: 'infobox.attributes',
    })
  }

  for (const item of faq.slice(0, FAQ_CAP)) {
    if (!item.sourceUrl) continue
    addEdge({
      source: center.id,
      target: { id: item.sourceUrl, label: item.question, url: item.sourceUrl, type: 'FAQ' },
      type: 'answer_source',
      evidence: 'Pregunta real devuelta por Brave para la misma búsqueda que reconoció esta entidad',
      confidence: 'medium',
      origin: 'faq',
    })
  }

  for (const video of videos.slice(0, VIDEO_CAP)) {
    addEdge({
      source: center.id,
      target: { id: video.url, label: video.title, url: video.url, type: 'VIDEO' },
      type: 'related_video',
      evidence: 'Video real devuelto por Brave para la misma búsqueda que reconoció esta entidad',
      confidence: 'medium',
      origin: 'videos',
    })
  }

  for (const item of news.slice(0, NEWS_CAP)) {
    addEdge({
      source: center.id,
      target: { id: item.url, label: item.title, url: item.url, type: 'NEWS' },
      type: 'related_news',
      evidence: 'Noticia real devuelta por Brave para la misma búsqueda que reconoció esta entidad',
      confidence: 'medium',
      origin: 'news',
    })
  }

  for (const item of discussions.slice(0, DISCUSSION_CAP)) {
    addEdge({
      source: center.id,
      target: { id: item.url, label: item.title, url: item.url, type: 'DISCUSSION' },
      type: 'related_discussion',
      evidence: 'Discusión real devuelta por Brave para la misma búsqueda que reconoció esta entidad',
      confidence: 'medium',
      origin: 'discussions',
    })
  }

  const capped = edges.slice(0, TOTAL_EDGES_CAP)
  if (capped.length === 0) return null
  return { center, edges: capped }
}

module.exports = { buildContextGraph, extractRelatedEntities }
