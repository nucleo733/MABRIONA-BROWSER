'use strict'

/**
 * Category Resolver de Spectrum — decide qué pestañas mostrar y en qué orden, a partir de señales
 * reales (cantidad de resultados por fuente, presencia de datos) — nunca de una lista de consultas
 * hardcodeadas (regla explícita de esta etapa). "Todo" se arma aparte (ver `renderer/results.js`,
 * solo cuando ya se decidió mostrar Spectrum); esto solo resuelve las pestañas de categoría.
 *
 * Reglas de puntaje (todas explicables, ninguna mágica):
 * - Herramientas (calculadora/conversión/hora) es la respuesta más directa posible → máxima prioridad.
 * - Lugares implica intención local fuerte (nunca coexiste con infobox, ver Etapa 3/4) → alta.
 * - Noticias sube de "media" a "alta" cuando hay 3+ resultados reales — señal real de que la
 *   consulta es de actualidad, no una palabra clave hardcodeada.
 * - Web es el núcleo, casi siempre presente → alta pero no la más alta (Tools/Places, cuando
 *   existen, son respuestas más directas para esa consulta puntual).
 * - Cortos (Short Videos) vs Video: se separan por evidencia real de URL (ver
 *   `braveSearch.js#isShortFormVideo`), nunca por adivinar duración.
 * - Imágenes es la única categoría "ciega" (Etapa 4: Brave no la incluye en la respuesta principal,
 *   así que no hay dato real para puntuarla acá) — entra con prioridad media fija; el cliente la
 *   retira sola si la carga perezosa llega vacía para esa búsqueda puntual.
 */

const MAX_VISIBLE_TABS = 5 // sin contar "Todo" — el resto entra en "Más"

function resolveSpectrum({ web = [], videos = [], news = [], locations = [], tool = null } = {}) {
  const shortVideos = videos.filter((v) => v.isShortForm)
  const longVideos = videos.filter((v) => !v.isShortForm)

  const candidates = []
  if (tool) candidates.push({ id: 'tools', label: 'Herramientas', score: 20 })
  if (locations.length > 0) candidates.push({ id: 'places', label: 'Lugares', score: 14 })
  if (news.length > 0) candidates.push({ id: 'news', label: 'Noticias', score: news.length >= 3 ? 13 : 6 })
  if (web.length > 0) candidates.push({ id: 'web', label: 'Web', score: 10 })
  if (shortVideos.length > 0) candidates.push({ id: 'shorts', label: 'Cortos', score: 8 })
  if (longVideos.length > 0) candidates.push({ id: 'video', label: 'Videos', score: 7 })
  candidates.push({ id: 'images', label: 'Imágenes', score: 5 })

  candidates.sort((a, b) => b.score - a.score)

  const hasAnyRealCandidate = candidates.some((c) => c.id !== 'images')
  if (!hasAnyRealCandidate) return { tabs: [], overflow: [] }

  const visible = candidates.slice(0, MAX_VISIBLE_TABS)
  const overflow = candidates.slice(MAX_VISIBLE_TABS)

  return {
    tabs: [{ id: 'todo', label: 'Todo' }, ...visible.map(({ id, label }) => ({ id, label }))],
    overflow: overflow.map(({ id, label }) => ({ id, label })),
  }
}

module.exports = { resolveSpectrum, MAX_VISIBLE_TABS }
