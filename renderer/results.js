'use strict'

/**
 * Resultados propios de MABRIONA.
 *
 * Fuente principal (cuando hay una API key configurada): Brave Search
 * API, pedida desde el proceso principal (`window.mabrionaSearch.query`,
 * ver `search-preload.js`/`main.js`) — la key nunca llega a esta
 * página. Es búsqueda real de toda la web, licenciada justo para que
 * un producto la muestre con su propio diseño: acá se arma 100% con
 * la cara de MABRIONA, sin ningún logo/nombre de Brave.
 *
 * Fuente de respaldo (sin key configurada todavía): la API oficial de
 * Respuestas Instantáneas de DuckDuckGo (gratis, sin key) — solo
 * definiciones/resúmenes de temas conocidos, no un índice general.
 * Cuando ninguna de las dos tiene algo útil, se lo decimos así, con un
 * link real y explícito para ver más (nunca automático, nunca
 * disfrazado — mismo criterio que con los anuncios de YouTube).
 */

function qs(name) {
  return new URLSearchParams(location.search).get(name) || ''
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/** Brave devuelve snippets con <strong> marcando la coincidencia y entidades HTML (&#x27; etc.) —
 * se sacan las etiquetas y se decodifican las entidades a texto plano (nunca innerHTML con
 * contenido de un tercero — decodificar por textarea.value es seguro, no ejecuta nada). */
function stripHtml(text) {
  const withoutTags = String(text).replace(/<[^>]*>/g, '')
  const textarea = document.createElement('textarea')
  textarea.innerHTML = withoutTags
  return textarea.value
}

function renderEmpty(query, container) {
  container.appendChild(el('p', 'empty', 'MABRIONA no encontró una respuesta directa para esto.'))
  const note = el('p', 'note', 'Para la mayoría de búsquedas comunes puede no traer nada todavía.')
  container.appendChild(note)
  const link = el('a', 'fallback-link')
  link.href = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
  link.textContent = 'Buscar en la web →'
  container.appendChild(link)
}

function renderBraveResults(results, container) {
  const list = el('div', 'result-list')
  for (const r of results) {
    const card = el('div', 'card')
    const link = el('a', 'result-title')
    link.href = r.url
    link.textContent = stripHtml(r.title)
    card.appendChild(link)
    card.appendChild(el('p', 'result-url', r.url))
    if (r.description) card.appendChild(el('p', 'result-desc', stripHtml(r.description)))
    list.appendChild(card)
  }
  container.appendChild(list)
}

function renderInstantAnswer(data, query, container) {
  let any = false

  if (data.Heading || data.AbstractText) {
    const card = el('div', 'card')
    if (data.Heading) card.appendChild(el('h2', null, data.Heading))
    if (data.AbstractText) card.appendChild(el('p', null, stripHtml(data.AbstractText)))
    if (data.AbstractURL) {
      const link = el('a', 'source-link')
      link.href = data.AbstractURL
      link.textContent = data.AbstractSource ? `Fuente: ${data.AbstractSource}` : 'Ver más'
      card.appendChild(link)
    }
    container.appendChild(card)
    any = true
  }

  if (data.Answer) {
    const card = el('div', 'card')
    card.appendChild(el('p', 'answer', stripHtml(data.Answer)))
    container.appendChild(card)
    any = true
  }

  if (data.Definition) {
    const card = el('div', 'card')
    card.appendChild(el('p', null, stripHtml(data.Definition)))
    if (data.DefinitionURL) {
      const link = el('a', 'source-link')
      link.href = data.DefinitionURL
      link.textContent = data.DefinitionSource ? `Fuente: ${data.DefinitionSource}` : 'Ver más'
      card.appendChild(link)
    }
    container.appendChild(card)
    any = true
  }

  const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : []
  const flatTopics = topics.flatMap((t) => (Array.isArray(t.Topics) ? t.Topics : [t])).filter((t) => t.Text && t.FirstURL)
  if (flatTopics.length > 0) {
    const list = el('ul', 'related')
    for (const t of flatTopics.slice(0, 10)) {
      const li = el('li')
      const link = el('a')
      link.href = t.FirstURL
      link.textContent = t.Text
      li.appendChild(link)
      list.appendChild(li)
    }
    container.appendChild(list)
    any = true
  }

  return any
}

async function searchInstantAnswer(query, container) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url)
    const data = await res.json()
    const any = renderInstantAnswer(data, query, container)
    if (!any) renderEmpty(query, container)
  } catch {
    renderEmpty(query, container)
  }
}

async function search(query) {
  const container = document.getElementById('results')
  container.replaceChildren(el('p', 'loading', 'Buscando…'))
  if (!query) {
    container.replaceChildren(el('p', 'empty', 'Escribe algo para buscar.'))
    return
  }

  // Preferí siempre la búsqueda real (Brave) cuando ya hay una key configurada.
  if (window.mabrionaSearch) {
    try {
      const response = await window.mabrionaSearch.query(query)
      if (response.configured) {
        container.replaceChildren()
        if (response.results.length > 0) renderBraveResults(response.results, container)
        else renderEmpty(query, container)
        return
      }
    } catch {
      // sigue al respaldo de abajo
    }
  }

  container.replaceChildren()
  await searchInstantAnswer(query, container)
}

const initialQuery = qs('q')
document.getElementById('q').value = initialQuery
search(initialQuery)
