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

module.exports = { buildRequest, normalizeResults, BRAVE_ENDPOINT }
