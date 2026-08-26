'use strict'

/**
 * DeepL real — traduce texto real, sin inventar nada si la API falla. Mismo patrón que
 * `search/braveSearch.js`: construir el pedido acá (testeable sin red), la llamada real vive en
 * main.js.
 */

// Lista real de idiomas destino que soporta la API de DeepL (v2/translate, `target_lang`), con
// nombre en español para la UI de MABRIONA — "todos los idiomas" reales que DeepL soporta hoy,
// no un subconjunto elegido a mano.
const LANGUAGES = [
  { code: 'BG', name: 'Búlgaro' },
  { code: 'CS', name: 'Checo' },
  { code: 'DA', name: 'Danés' },
  { code: 'DE', name: 'Alemán' },
  { code: 'EL', name: 'Griego' },
  { code: 'EN-GB', name: 'Inglés (Reino Unido)' },
  { code: 'EN-US', name: 'Inglés (Estados Unidos)' },
  { code: 'ES', name: 'Español' },
  { code: 'ET', name: 'Estonio' },
  { code: 'FI', name: 'Finlandés' },
  { code: 'FR', name: 'Francés' },
  { code: 'HU', name: 'Húngaro' },
  { code: 'ID', name: 'Indonesio' },
  { code: 'IT', name: 'Italiano' },
  { code: 'JA', name: 'Japonés' },
  { code: 'KO', name: 'Coreano' },
  { code: 'LT', name: 'Lituano' },
  { code: 'LV', name: 'Letón' },
  { code: 'NB', name: 'Noruego' },
  { code: 'NL', name: 'Neerlandés' },
  { code: 'PL', name: 'Polaco' },
  { code: 'PT-BR', name: 'Portugués (Brasil)' },
  { code: 'PT-PT', name: 'Portugués (Portugal)' },
  { code: 'RO', name: 'Rumano' },
  { code: 'RU', name: 'Ruso' },
  { code: 'SK', name: 'Eslovaco' },
  { code: 'SL', name: 'Esloveno' },
  { code: 'SV', name: 'Sueco' },
  { code: 'TR', name: 'Turco' },
  { code: 'UK', name: 'Ucraniano' },
  { code: 'ZH', name: 'Chino' },
]

// Las keys gratuitas de DeepL terminan siempre en ":fx" — es la forma real, documentada, de
// distinguir qué base de la API usar (el plan pago usa un host distinto, y llamar al equivocado
// devuelve 403 real, no una simple advertencia).
function apiBaseFor(apiKey) {
  return apiKey && apiKey.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
}

/** Hasta 50 textos por pedido real (límite práctico documentado de DeepL) — el llamador es quien trocea. */
function buildTranslateRequest(texts, targetLang, apiKey) {
  const url = `${apiBaseFor(apiKey)}/v2/translate`
  return {
    url,
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: texts, target_lang: targetLang }),
  }
}

function normalizeTranslateResponse(data) {
  if (!data || !Array.isArray(data.translations)) return null
  return data.translations.map((t) => t.text)
}

module.exports = { LANGUAGES, apiBaseFor, buildTranslateRequest, normalizeTranslateResponse }
