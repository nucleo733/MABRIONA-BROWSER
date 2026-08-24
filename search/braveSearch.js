'use strict'

/**
 * Búsqueda propia de MABRIONA sobre la Brave Search API — lógica pura
 * (armar la URL/headers, normalizar la respuesta), sin `fetch` acá
 * para poder probarla sin red. El fetch real vive en `main.js`
 * (proceso principal, la API key nunca llega al renderer/página).
 *
 * Por qué esto SÍ es legítimo (a diferencia de scrapear la página de
 * resultados de un buscador): la Brave Search API está pensada y
 * licenciada justo para que otros productos construyan su propia
 * experiencia de búsqueda sobre los datos — devuelve JSON (título,
 * url, descripción), no una página con su marca. MABRIONA arma la
 * lista de resultados 100% con su propio diseño; el logo de Brave no
 * existe en ningún lado de este flujo.
 */

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

function buildRequest(query, apiKey) {
  const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}`
  return {
    url,
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  }
}

/** Traduce la forma real de la respuesta de Brave a algo simple y estable para la UI de MABRIONA. */
function normalizeResults(data) {
  const webResults = data?.web?.results
  if (!Array.isArray(webResults)) return []
  return webResults
    .filter((r) => r && r.url && r.title)
    .map((r) => ({
      title: String(r.title),
      url: String(r.url),
      description: typeof r.description === 'string' ? r.description : '',
    }))
}

/**
 * Entity Focus — el panel de entidad (persona/lugar/cosa reconocida) que Brave arma a partir de
 * fuentes como Wikipedia, cuando la búsqueda tiene una entidad clara. Es dato real de la API, no
 * un Knowledge Panel simulado — si Brave no lo manda, esta función devuelve `null` y MABRIONA
 * Search simplemente no muestra Entity Focus para esa búsqueda (nunca inventa uno).
 */
function normalizeInfobox(data) {
  const box = data?.infobox?.results?.[0]
  if (!box || !box.title) return null
  return {
    title: String(box.title),
    category: typeof box.category === 'string' ? box.category : null,
    description: typeof box.description === 'string' ? box.description : '',
    longDescription: typeof box.long_desc === 'string' ? box.long_desc : '',
    sourceUrl: typeof box.url === 'string' ? box.url : null,
    // Brave (vía Wikipedia) intercala filas separadoras de sección dentro de `attributes` — llegan
    // con `value: null` (ej. ["<span><strong>Height</strong></span>", null]). No son un dato, son
    // maquetación de la tabla original: si se dejaban pasar, `String(null)` los mostraba como un
    // atributo real de valor literal "null". Se descartan, nunca se inventa un valor para ellas.
    attributes: Array.isArray(box.attributes)
      ? box.attributes
          .filter((a) => Array.isArray(a) && a.length === 2 && a[0] != null && a[1] != null && String(a[1]).trim() !== '')
          .map(([label, value]) => ({ label: String(label), value: String(value) }))
      : [],
    profiles: Array.isArray(box.profiles)
      ? box.profiles
          .filter((p) => p && p.name && p.url)
          .map((p) => ({ name: String(p.name), url: String(p.url), icon: typeof p.img === 'string' ? p.img : null }))
      : [],
  }
}

/**
 * FAQ real — Brave ya trae, para algunas búsquedas (no todas), preguntas frecuentes sacadas de
 * fuentes reales con su propia URL. Si `data.faq` no viene (ej. "apple inc" no trae FAQ), se
 * devuelve `[]` y MABRIONA Search simplemente no muestra la sección — nunca se redacta una
 * pregunta propia para rellenar el espacio.
 */
function normalizeFaq(data) {
  const results = data?.faq?.results
  if (!Array.isArray(results)) return []
  return results
    .filter((f) => f && f.question && f.answer)
    .map((f) => ({
      question: String(f.question),
      answer: String(f.answer),
      sourceTitle: typeof f.title === 'string' ? f.title : null,
      sourceUrl: typeof f.url === 'string' ? f.url : null,
      sourceHost: typeof f?.meta_url?.hostname === 'string' ? f.meta_url.hostname : null,
    }))
}

/** Videos reales (mayormente YouTube) que Brave ya trae en la misma respuesta — sin API aparte. */
function normalizeVideos(data) {
  const results = data?.videos?.results
  if (!Array.isArray(results)) return []
  return results
    .filter((v) => v && v.url && v.title)
    .map((v) => ({
      title: String(v.title),
      url: String(v.url),
      thumbnail: v.thumbnail && typeof v.thumbnail.src === 'string' ? v.thumbnail.src : null,
      duration: v.video && typeof v.video.duration === 'string' ? v.video.duration : null,
      source: v.video && typeof v.video.publisher === 'string' ? v.video.publisher : null,
    }))
}

module.exports = { buildRequest, normalizeResults, normalizeInfobox, normalizeVideos, normalizeFaq, BRAVE_ENDPOINT }
