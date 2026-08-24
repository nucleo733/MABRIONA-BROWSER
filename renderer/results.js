'use strict'

/**
 * Resultados propios de MABRIONA — usa la API oficial de Respuestas
 * Instantáneas de DuckDuckGo (gratis, sin key, documentada para este
 * uso: https://duckduckgo.com/api). NO es scraping de su página de
 * resultados y NO es un índice general de la web — solo responde con
 * datos de temas/entidades conocidas (definiciones, resúmenes). Para
 * la mayoría de búsquedas comunes puede no traer nada — cuando pasa
 * eso se lo decimos así, con un link claro y explícito para ver los
 * resultados reales en DuckDuckGo si el usuario lo quiere (nunca
 * automático, nunca disfrazado).
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

function renderEmpty(query, container) {
  container.appendChild(el('p', 'empty', 'MABRIONA no encontró una respuesta directa para esto.'))
  const note = el('p', 'note', 'La búsqueda propia de MABRIONA busca definiciones/resúmenes de temas conocidos, no toda la web — para la mayoría de búsquedas comunes no va a traer nada.')
  container.appendChild(note)
  // El texto no nombra a ningún tercero (voz propia de MABRIONA) — el destino real del link sí es
  // un sitio externo de verdad, y una vez ahí muestra SU identidad real, eso no se puede disfrazar
  // sin engañar sobre en qué sitio estás parado (mismo criterio que con los anuncios de YouTube).
  const link = el('a', 'fallback-link')
  link.href = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
  link.textContent = 'Buscar en la web →'
  container.appendChild(link)
}

function renderResults(data, query, container) {
  let any = false

  if (data.Heading || data.AbstractText) {
    const card = el('div', 'card')
    if (data.Heading) card.appendChild(el('h2', null, data.Heading))
    if (data.AbstractText) card.appendChild(el('p', null, data.AbstractText))
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
    card.appendChild(el('p', 'answer', data.Answer))
    container.appendChild(card)
    any = true
  }

  if (data.Definition) {
    const card = el('div', 'card')
    card.appendChild(el('p', null, data.Definition))
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

  if (!any) renderEmpty(query, container)
}

async function search(query) {
  const container = document.getElementById('results')
  container.replaceChildren(el('p', 'loading', 'Buscando…'))
  if (!query) {
    container.replaceChildren(el('p', 'empty', 'Escribí algo para buscar.'))
    return
  }
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url)
    const data = await res.json()
    container.replaceChildren()
    renderResults(data, query, container)
  } catch {
    container.replaceChildren()
    renderEmpty(query, container)
  }
}

const initialQuery = qs('q')
document.getElementById('q').value = initialQuery
search(initialQuery)
