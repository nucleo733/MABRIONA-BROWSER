'use strict'

// Accesos directos reales — sitios más visitados de verdad, calculados del historial real (ver
// `newtab:top-sites` en main.js). Sin favicons todavía (no hay caché local de íconos reales) — una
// ficha con la inicial del dominio, honesto en vez de inventar un ícono genérico para cada sitio.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

async function renderTopSites() {
  const container = document.getElementById('top-sites')
  const sites = await window.mabrionaNewTab.getTopSites()
  if (!sites || sites.length === 0) return
  container.innerHTML = sites.map((site) => {
    const host = hostnameOf(site.url)
    const letter = host.charAt(0).toUpperCase() || '?'
    return `<a class="top-site" href="${escapeHtml(site.url)}" title="${escapeHtml(site.title)}">
      <span class="top-site-icon">${escapeHtml(letter)}</span>
      <span class="top-site-label">${escapeHtml(host)}</span>
    </a>`
  }).join('')
}

renderTopSites()
