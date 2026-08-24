'use strict'

/**
 * MABRIONA Search.
 *
 * Fuente principal (con key configurada): Brave Search API, pedida
 * desde el proceso principal — la key nunca llega a esta página. La
 * misma respuesta ya trae, de verdad (no simulado): resultados web,
 * a veces un panel de entidad (Entity Focus, cuando Brave reconoce a
 * quién/qué se busca — persona, lugar, cosa), a veces videos y a
 * veces preguntas frecuentes reales (MABRIONA FAQ) — todo en la misma
 * llamada, sin pedir nada extra. Se arma todo con el diseño propio de
 * MABRIONA (Spectrum + Entity Focus + FAQ) — nada de esto es HTML de
 * Brave, es JSON que MABRIONA renderiza con su propia identidad visual.
 *
 * Categorías que Google tiene y esta API no trae hoy (Imágenes,
 * Noticias, Mapas, Compras, Música como categoría propia, MABRIONA
 * AI): a propósito NO se simulan acá — Spectrum solo muestra pestañas
 * para lo que realmente hay datos.
 *
 * Fuente de respaldo (sin key configurada todavía): la API oficial de
 * Respuestas Instantáneas de DuckDuckGo (gratis, sin key) — solo
 * definiciones/resúmenes de temas conocidos.
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

/** Brave devuelve HTML crudo en algunos campos (<strong>, <br>, <a>, entidades &#x27;) — texto
 * plano siempre, nunca innerHTML con contenido de un tercero (decodificar por textarea.value es
 * seguro, no ejecuta nada). */
function stripHtml(text) {
  const withoutTags = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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

// ---------------- Entity Focus ----------------

/** Traducción del `category` real que manda Brave (persona/empresa/lugar/app/...) al lenguaje
 * propio de MABRIONA. Solo formatea la etiqueta — nunca inventa una categoría que no vino en el
 * dato: si Brave manda un valor que no está en este mapa, se muestra el valor real tal cual. */
const CATEGORY_LABELS = {
  person: 'Persona',
  company: 'Empresa',
  place: 'Lugar',
  application: 'Aplicación',
  programming: 'Tecnología',
}

function friendlyCategory(category) {
  if (!category) return null
  return CATEGORY_LABELS[category] || category.charAt(0).toUpperCase() + category.slice(1)
}

function renderEntityFocus(box) {
  const card = el('div', 'entity-focus')

  // Identidad
  const category = friendlyCategory(box.category)
  if (category) card.appendChild(el('span', 'entity-category', category))
  card.appendChild(el('h2', null, box.title))
  const desc = box.longDescription || box.description
  if (desc) card.appendChild(el('p', 'entity-desc', stripHtml(desc).slice(0, 400)))

  // Atributos — solo los que de verdad tienen un valor (ver normalizeInfobox: las filas
  // separadoras de sección de la tabla original ya vienen descartadas).
  if (box.attributes.length > 0) {
    card.appendChild(el('p', 'section-heading', 'Atributos'))
    const grid = el('div', 'entity-attrs')
    for (const attr of box.attributes.slice(0, 8)) {
      const item = el('div', 'entity-attr')
      item.appendChild(el('span', 'label', attr.label))
      item.appendChild(el('span', 'value', stripHtml(attr.value)))
      grid.appendChild(item)
    }
    card.appendChild(grid)
  }

  // Presencia web — perfiles/sitios reales que Brave asoció a esta entidad.
  if (box.profiles.length > 0) {
    card.appendChild(el('p', 'section-heading', 'Presencia web'))
    const row = el('div', 'entity-profiles')
    for (const profile of box.profiles) {
      const link = el('a', 'entity-profile')
      link.href = profile.url
      if (profile.icon) {
        const img = document.createElement('img')
        img.src = profile.icon
        img.alt = ''
        link.appendChild(img)
      }
      link.appendChild(document.createTextNode(profile.name))
      row.appendChild(link)
    }
    card.appendChild(row)
  }

  // Fuente — de dónde viene realmente esta información (nunca se le atribuye a MABRIONA).
  if (box.sourceUrl) {
    let host = box.sourceUrl
    try { host = new URL(box.sourceUrl).hostname } catch { /* URL rara, mostrar tal cual */ }
    const source = el('a', 'entity-source')
    source.href = box.sourceUrl
    source.textContent = `Fuente: ${host} →`
    card.appendChild(source)
  }

  return card
}

// ---------------- Web ----------------

function renderWebList(results, container, limit) {
  const list = el('div', 'result-list')
  for (const r of results.slice(0, limit || results.length)) {
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

// ---------------- Video ----------------

function renderVideoGrid(videos, container, limit) {
  const grid = el('div', 'video-grid')
  for (const v of videos.slice(0, limit || videos.length)) {
    const card = el('a', 'video-card')
    card.href = v.url
    const thumb = el('div', 'video-thumb')
    if (v.thumbnail) {
      const img = document.createElement('img')
      img.src = v.thumbnail
      img.alt = ''
      thumb.appendChild(img)
    }
    if (v.duration) thumb.appendChild(el('span', 'video-duration', v.duration))
    card.appendChild(thumb)
    card.appendChild(el('div', 'video-title', stripHtml(v.title)))
    if (v.source) card.appendChild(el('div', 'video-source', v.source))
    grid.appendChild(card)
  }
  container.appendChild(grid)
}

// ---------------- MABRIONA FAQ ----------------

/** Acordeón real (expandir/contraer, sin librería) sobre preguntas reales que Brave trae en la
 * misma respuesta — cuando no vienen (la mayoría de búsquedas de una sola palabra, por ejemplo),
 * esta función nunca se llama: no existe una FAQ genérica de respaldo. */
function renderFaq(items, container) {
  const section = el('div', 'mabriona-faq')
  section.appendChild(el('p', 'section-heading', 'Preguntas frecuentes'))
  const list = el('div', 'faq-list')
  for (const item of items) {
    const row = el('div', 'faq-item')
    const button = el('button', 'faq-question')
    button.type = 'button'
    button.setAttribute('aria-expanded', 'false')
    button.appendChild(el('span', 'faq-question-text', stripHtml(item.question)))
    button.appendChild(el('span', 'faq-caret', '▾'))

    const answerBox = el('div', 'faq-answer')
    answerBox.hidden = true
    answerBox.appendChild(el('p', null, stripHtml(item.answer)))
    if (item.sourceUrl) {
      const link = el('a', 'faq-source')
      link.href = item.sourceUrl
      link.textContent = `Fuente: ${item.sourceHost || item.sourceTitle || 'ver más'} →`
      answerBox.appendChild(link)
    }

    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true'
      button.setAttribute('aria-expanded', String(!expanded))
      answerBox.hidden = expanded
    })

    row.appendChild(button)
    row.appendChild(answerBox)
    list.appendChild(row)
  }
  section.appendChild(list)
  container.appendChild(section)
}

// ---------------- Spectrum (pestañas propias) ----------------

function buildSpectrum(data) {
  const tabs = [{ id: 'todo', label: 'Todo' }]
  if (data.web.length > 0) tabs.push({ id: 'web', label: 'Web' })
  if (data.videos.length > 0) tabs.push({ id: 'video', label: 'Video' })
  return tabs
}

function renderSpectrumView(tabId, data, container) {
  container.replaceChildren()
  if (tabId === 'web') {
    renderWebList(data.web, container)
    return
  }
  if (tabId === 'video') {
    renderVideoGrid(data.videos, container)
    return
  }
  // "Todo" — composición con jerarquía: entidad primero, después FAQ (si existe), después una
  // muestra de video, después web. Cada sección se omite por completo si no hay dato real.
  if (data.infobox) container.appendChild(renderEntityFocus(data.infobox))
  if (data.faq && data.faq.length > 0) renderFaq(data.faq, container)
  if (data.videos.length > 0) {
    container.appendChild(el('p', 'section-heading', 'Video'))
    renderVideoGrid(data.videos, container, 4)
  }
  if (data.web.length > 0) {
    container.appendChild(el('p', 'section-heading', 'Web'))
    renderWebList(data.web, container, 8)
  }
}

function mountSpectrum(data, container) {
  const tabs = buildSpectrum(data)
  const spectrumEl = document.getElementById('spectrum')
  spectrumEl.replaceChildren()
  spectrumEl.classList.remove('hidden')
  let active = 'todo'
  function draw() {
    spectrumEl.querySelectorAll('.spectrum-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === active)
    })
    renderSpectrumView(active, data, container)
  }
  for (const tab of tabs) {
    const btn = el('button', 'spectrum-tab', tab.label)
    btn.type = 'button'
    btn.dataset.tab = tab.id
    btn.addEventListener('click', () => { active = tab.id; draw() })
    spectrumEl.appendChild(btn)
  }
  draw()
}

// ---------------- Respaldo: Respuestas Instantáneas de DuckDuckGo (sin key todavía) ----------------

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

// ---------------- Orquestación ----------------

async function search(query) {
  const container = document.getElementById('results')
  document.getElementById('spectrum').classList.add('hidden')
  container.replaceChildren(el('p', 'loading', 'Buscando…'))
  if (!query) {
    container.replaceChildren(el('p', 'empty', 'Escribe algo para buscar.'))
    return
  }

  if (window.mabrionaSearch) {
    try {
      const response = await window.mabrionaSearch.query(query)
      if (response.configured) {
        const hasAnything = response.infobox || response.web.length > 0 || response.videos.length > 0 || (response.faq && response.faq.length > 0)
        if (hasAnything) mountSpectrum(response, container)
        else { container.replaceChildren(); renderEmpty(query, container) }
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
