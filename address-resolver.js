'use strict'

const HOME_URL = 'https://duckduckgo.com/'

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
