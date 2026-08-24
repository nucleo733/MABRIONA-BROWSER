'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Pestaña nueva/inicial — página propia con el estilo de MABRIONA en vez de
// mostrar la home de DuckDuckGo (con su propia marca/promociones).
const HOME_URL = pathToFileURL(path.join(__dirname, 'renderer', 'newtab.html')).toString()

// Resultados de búsqueda — página propia con el estilo de MABRIONA (usa la
// API oficial de Respuestas Instantáneas de DuckDuckGo por atrás, sin
// mostrar su marca). Ver `renderer/results.js` para el porqué y las
// limitaciones reales (no es un buscador general).
const RESULTS_URL = pathToFileURL(path.join(__dirname, 'renderer', 'results.html')).toString()

/**
 * Resuelve lo que el usuario escribió en la barra de direcciones: URL
 * real (si ya tiene esquema, o parece un dominio) o la página de
 * resultados propia de MABRIONA.
 */
function resolveAddressInput(input) {
  const trimmed = (input || '').trim()
  if (!trimmed) return HOME_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  const looksLikeDomain = /^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed) && !trimmed.includes(' ')
  if (looksLikeDomain) return `https://${trimmed}`
  return `${RESULTS_URL}?q=${encodeURIComponent(trimmed)}`
}

module.exports = { resolveAddressInput, HOME_URL, RESULTS_URL }
