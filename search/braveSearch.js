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
// Imágenes NO viene en la respuesta del endpoint de arriba (se probó `result_filter=images` contra
// la cuenta real y la API lo rechaza: "Invalid filter value(s): images" — el enum válido de
// result_filter es discussions/faq/infobox/news/query/videos/web/summarizer/locations/rich). Brave
// expone imágenes solo por un endpoint aparte, confirmado real (200, JSON) contra esta cuenta.
const IMAGES_ENDPOINT = 'https://api.search.brave.com/res/v1/images/search'

// Valores reales verificados contra la API (una consulta de prueba con freshness=pd/pw/pm/py
// devuelve listas de resultados genuinamente distintas entre sí y del caso sin filtro — no es un
// parámetro decorativo). Brave ignora en silencio un valor que no reconoce (no da error 422 como
// con result_filter), así que este set es la única fuente de verdad — nunca se manda lo que
// escriba el usuario directo a la API.
const VALID_FRESHNESS = new Set(['pd', 'pw', 'pm', 'py'])

function buildRequest(query, apiKey, options = {}) {
  let url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}`
  if (options.freshness && VALID_FRESHNESS.has(options.freshness)) {
    url += `&freshness=${options.freshness}`
  }
  return {
    url,
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  }
}

function buildImagesRequest(query, apiKey) {
  const url = `${IMAGES_ENDPOINT}?q=${encodeURIComponent(query)}`
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

/**
 * Noticias reales — Brave las trae solo cuando la consulta es de actualidad ("taylor swift",
 * "breaking news today"), no en la mayoría de búsquedas. Viene en la MISMA respuesta que ya se pide
 * para Web/Entity Focus/FAQ/Video — sin llamada de red aparte. Desde Etapa 4 es también una
 * categoría propia de Spectrum (antes solo alimentaba Context Orbit).
 */
function normalizeNews(data) {
  const results = data?.news?.results
  if (!Array.isArray(results)) return []
  return results
    .filter((n) => n && n.url && n.title)
    .map((n) => ({
      title: String(n.title),
      url: String(n.url),
      description: typeof n.description === 'string' ? n.description : '',
      age: typeof n.age === 'string' ? n.age : null,
      source: typeof n?.meta_url?.hostname === 'string' ? n.meta_url.hostname : null,
      thumbnail: n.thumbnail && typeof n.thumbnail.src === 'string' ? n.thumbnail.src : null,
    }))
}

/**
 * Lugares reales (negocios locales: "starbucks madrid", "museo del prado horario") — vienen en la
 * MISMA respuesta unificada, sin llamada aparte. Auditoría de Etapa 3/4: nunca coexiste con
 * `infobox` en esta API (son mutuamente excluyentes: una consulta es "entidad de conocimiento" o
 * "negocio local"), así que esto es una categoría propia de Spectrum, no un dato que se cuelgue de
 * Entity Focus. No incluye mapa (no hay proveedor de mapas contratado) — solo los datos reales que
 * Brave devuelve por lugar.
 */
function normalizeLocations(data) {
  const results = data?.locations?.results
  if (!Array.isArray(results)) return []
  return results
    .filter((l) => l && l.url && l.title)
    .map((l) => {
      const today = l?.opening_hours?.current_day?.[0]
      return {
        title: String(l.title),
        url: String(l.url),
        address: typeof l?.postal_address?.displayAddress === 'string' ? l.postal_address.displayAddress : null,
        phone: typeof l?.contact?.telephone === 'string' ? l.contact.telephone : null,
        rating: typeof l?.rating?.ratingValue === 'number' ? l.rating.ratingValue : null,
        ratingCount: typeof l?.rating?.reviewCount === 'number' ? l.rating.reviewCount : null,
        todayHours: today && today.opens && today.closes ? `${today.opens} – ${today.closes}` : null,
        thumbnail: l.thumbnail && typeof l.thumbnail.src === 'string' ? l.thumbnail.src : null,
      }
    })
}

/**
 * Imágenes reales — a diferencia de News/Locations, Brave NO las incluye en la respuesta unificada
 * (ver nota de `IMAGES_ENDPOINT` arriba): esta función normaliza la respuesta de ese endpoint
 * aparte, pedida solo cuando el usuario abre la pestaña Imágenes (ver `main.js` — `search:images`).
 * Nota: el nivel superior de este endpoint es distinto al de `web/search` — los resultados están en
 * `data.results`, no en `data.web.results`.
 */
function normalizeImages(data) {
  const results = data?.results
  if (!Array.isArray(results)) return []
  return results
    .filter((img) => img && img.url && img.title && img?.thumbnail?.src)
    .map((img) => ({
      title: String(img.title),
      url: String(img.url),
      source: typeof img.source === 'string' ? img.source : null,
      thumbnail: String(img.thumbnail.src),
      width: typeof img?.properties?.width === 'number' ? img.properties.width : null,
      height: typeof img?.properties?.height === 'number' ? img.properties.height : null,
    }))
}

/** Discusiones reales (mayormente Reddit) que Brave trae para algunas búsquedas de actualidad/tema
 * amplio. Mismo criterio que normalizeNews: solo se normaliza para Context Orbit, no se convierte
 * en una función/pestaña propia todavía. */
function normalizeDiscussions(data) {
  const results = data?.discussions?.results
  if (!Array.isArray(results)) return []
  return results
    .filter((d) => d && d.url && d.title)
    .map((d) => ({
      title: String(d.title),
      url: String(d.url),
      forum: typeof d?.data?.forum_name === 'string' ? d.data.forum_name : null,
    }))
}

module.exports = {
  buildRequest,
  buildImagesRequest,
  VALID_FRESHNESS,
  normalizeResults,
  normalizeInfobox,
  normalizeVideos,
  normalizeFaq,
  normalizeNews,
  normalizeDiscussions,
  normalizeLocations,
  normalizeImages,
  BRAVE_ENDPOINT,
  IMAGES_ENDPOINT,
}
