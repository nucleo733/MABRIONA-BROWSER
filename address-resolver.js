'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Pestaña nueva/inicial — página propia con el estilo de MABRIONA en vez de
// mostrar la home de DuckDuckGo (con su propia marca/promociones). La
// búsqueda sigue yendo a DuckDuckGo (sin API key, sin rastrear).
const HOME_URL = pathToFileURL(path.join(__dirname, 'renderer', 'newtab.html')).toString()

/**
 * Resuelve lo que el usuario escribió en la barra de direcciones: URL
 * real (si ya tiene esquema, o parece un dominio) o una búsqueda por
 * DuckDuckGo — no requiere API key y no rastrea al usuario, coherente
 * con MABRIONA SHIELDS.
 */
function resolveAddressInput(input) {
  const trimmed = (input || '').trim()
  if (!trimmed) return HOME_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  const looksLikeDomain = /^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed) && !trimmed.includes(' ')
  if (looksLikeDomain) return `https://${trimmed}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`
}

module.exports = { resolveAddressInput, HOME_URL }
