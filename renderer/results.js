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
 * llamada, sin pedir nada extra. Cuando además existen relaciones REALES
 * y verificables (enlaces explícitos dentro del infobox, perfiles,
 * fuente, contenido co-devuelto para la misma entidad reconocida), se
 * arma Context Orbit — ver `search/contextGraph.js` para las reglas de
 * evidencia/confianza que sostienen cada nodo. Se arma todo con el
 * diseño propio de MABRIONA (Spectrum + Entity Focus + FAQ + Context
 * Orbit) — nada de esto es HTML de Brave, es JSON que MABRIONA renderiza
 * con su propia identidad visual.
 *
 * Desde Etapa 4: Noticias y Lugares vienen en la misma respuesta de
 * arriba (sin llamada aparte). Imágenes es la única categoría que
 * necesita su propio pedido a Brave — se hace perezoso, solo si el
 * usuario abre esa pestaña (ver `search:images` en preload/main.js).
 * Categorías sin evidencia real en esta API (Compras, Música como
 * categoría propia, People más allá del infobox, MABRIONA AI): a
 * propósito NO se simulan — ver docs/FASE-MABRIONA-SEARCH-ETAPA-4-FUENTES.md.
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

/** Estado de error real y distinguible — antes, cualquier falla (sin conexión, límite de cuenta,
 * error HTTP) caía en el mismo mensaje genérico de "no encontré nada", que era engañoso: parecía
 * que la búsqueda no tenía resultados, no que algo falló. `errorKind` viene de `main.js`, que ya
 * distingue red/límite/HTTP con datos reales (cabeceras/status de la respuesta). */
function renderSearchError(response, query, freshness, container) {
  const card = el('div', 'search-error')
  let message = 'MABRIONA no pudo completar esta búsqueda ahora mismo.'
  if (response.errorKind === 'rate_limited') {
    message = 'MABRIONA alcanzó el límite de búsquedas por ahora. Probá de nuevo en unos segundos.'
  } else if (response.errorKind === 'network') {
    message = 'No se pudo conectar — revisá tu conexión a internet.'
  }
  card.appendChild(el('p', 'search-error-title', message))
  const retry = el('button', 'search-error-retry', 'Reintentar')
  retry.type = 'button'
  retry.addEventListener('click', () => search(query, freshness))
  card.appendChild(retry)
  container.appendChild(card)
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

// ---------------- Noticias ----------------

function renderNewsList(items, container, limit) {
  const list = el('div', 'news-list')
  for (const n of items.slice(0, limit || items.length)) {
    const card = el('a', 'news-card')
    card.href = n.url
    if (n.thumbnail) {
      const thumb = el('div', 'news-thumb')
      const img = document.createElement('img')
      img.src = n.thumbnail
      img.alt = ''
      thumb.appendChild(img)
      card.appendChild(thumb)
    }
    const body = el('div', 'news-body')
    body.appendChild(el('div', 'news-title', stripHtml(n.title)))
    if (n.description) body.appendChild(el('p', 'news-desc', stripHtml(n.description).slice(0, 160)))
    const meta = el('div', 'news-meta')
    if (n.source) meta.appendChild(el('span', 'news-source', n.source))
    if (n.age) meta.appendChild(el('span', 'news-age', n.age))
    if (meta.childNodes.length > 0) body.appendChild(meta)
    card.appendChild(body)
    list.appendChild(card)
  }
  container.appendChild(list)
}

// ---------------- Lugares ----------------

function renderLocationsList(items, container, limit) {
  const list = el('div', 'places-list')
  for (const p of items.slice(0, limit || items.length)) {
    const card = el('a', 'place-card')
    card.href = p.url
    if (p.thumbnail) {
      const thumb = el('div', 'place-thumb')
      const img = document.createElement('img')
      img.src = p.thumbnail
      img.alt = ''
      thumb.appendChild(img)
      card.appendChild(thumb)
    }
    const body = el('div', 'place-body')
    body.appendChild(el('div', 'place-title', p.title))
    if (p.address) body.appendChild(el('p', 'place-address', p.address))
    const meta = el('div', 'place-meta')
    if (p.rating != null) {
      const label = p.ratingCount ? `★ ${p.rating.toFixed(1)} (${p.ratingCount})` : `★ ${p.rating.toFixed(1)}`
      meta.appendChild(el('span', 'place-rating', label))
    }
    if (p.todayHours) meta.appendChild(el('span', 'place-hours', `Hoy: ${p.todayHours}`))
    if (meta.childNodes.length > 0) body.appendChild(meta)
    card.appendChild(body)
    list.appendChild(card)
  }
  container.appendChild(list)
}

// ---------------- Imágenes ----------------

/** A diferencia de Web/Video/News/Places, MABRIONA no sabe si hay imágenes reales para esta
 * búsqueda hasta pedirlas (ver `mountSpectrum` — llamada perezosa vía `search:images`, solo cuando
 * el usuario abre esta pestaña). Los thumbnails vienen proxeados por Brave desde
 * imgs.search.brave.com (mismo dominio ya permitido por la CSP desde Etapa 1) — nunca se carga una
 * imagen de un dominio de terceros directamente. */
function renderImagesGrid(images, container) {
  const grid = el('div', 'images-grid')
  for (const img of images) {
    const card = el('a', 'image-card')
    card.href = img.url
    const thumb = document.createElement('img')
    thumb.src = img.thumbnail
    // A diferencia de los thumbnails de Video/News/Places (decorativos — el título ya está en texto
    // visible al lado), acá la imagen ES el contenido principal de la tarjeta: necesita alt real.
    thumb.alt = stripHtml(img.title)
    thumb.loading = 'lazy'
    card.appendChild(thumb)
    const caption = el('div', 'image-caption')
    caption.appendChild(el('span', 'image-title', stripHtml(img.title)))
    if (img.source) caption.appendChild(el('span', 'image-source', img.source))
    card.appendChild(caption)
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

// ---------------- Context Orbit ----------------

const ORBIT_TYPE_LABELS = {
  ENTITY: 'Entidad relacionada',
  SOURCE: 'Fuente',
  WEBSITE: 'Sitio',
  FAQ: 'Pregunta',
  VIDEO: 'Video',
  NEWS: 'Noticia',
  DISCUSSION: 'Discusión',
}

/** Diagrama orbital propio — no es decoración: la cantidad de nodos y sus posiciones se calculan a
 * partir de las relaciones reales del Context Graph (`main.js` → `search/contextGraph.js`). Cada
 * nodo es un enlace real: al hacer click navega al contenido original, nunca a una simulación. Sin
 * imágenes externas a propósito (evita depender de dominios de terceros no cubiertos por la CSP). */
function renderContextOrbit(graph, container) {
  const section = el('div', 'context-orbit-section')
  section.appendChild(el('p', 'section-heading', 'Context Orbit'))

  const stage = el('div', 'context-orbit')
  const core = el('div', 'orbit-core')
  core.appendChild(el('span', null, graph.center.label))
  stage.appendChild(core)

  const total = graph.edges.length
  graph.edges.forEach((edge, index) => {
    const angleDeg = (360 / total) * index - 90
    const angleRad = (angleDeg * Math.PI) / 180
    const x = 50 + 50 * Math.cos(angleRad)
    const y = 50 + 50 * Math.sin(angleRad)

    const line = el('div', 'orbit-line')
    line.style.transform = `rotate(${angleDeg}deg)`
    stage.appendChild(line)

    const node = el('a', `orbit-node orbit-node--${edge.confidence}`)
    node.href = edge.target.url
    node.style.left = `${x}%`
    node.style.top = `${y}%`
    node.appendChild(el('span', 'orbit-node-dot'))

    const tooltip = el('span', 'orbit-tooltip')
    tooltip.appendChild(el('strong', null, edge.target.label))
    tooltip.appendChild(el('em', null, ORBIT_TYPE_LABELS[edge.target.type] || edge.target.type))
    tooltip.appendChild(el('span', 'orbit-tooltip-relation', edge.type))
    node.appendChild(tooltip)

    stage.appendChild(node)
  })

  section.appendChild(stage)
  container.appendChild(section)
}

// ---------------- Herramientas (filtros reales) ----------------

/** Único filtro real disponible hoy: frescura por fecha (`freshness` real de Brave, verificado con
 * llamadas reales — día/semana/mes/año devuelven listas de resultados genuinamente distintas, no es
 * un control decorativo). País/idioma también son reales en la API pero no se exponen todavía: sin
 * una necesidad de UX clara (¿de qué país busca el usuario? no hay señal confiable sin inventar una
 * ubicación), así que se documentan como disponibles-pero-no-expuestos en vez de forzar un control. */
const FRESHNESS_OPTIONS = [
  { value: '', label: 'Cualquier momento' },
  { value: 'pd', label: 'Último día' },
  { value: 'pw', label: 'Última semana' },
  { value: 'pm', label: 'Último mes' },
  { value: 'py', label: 'Último año' },
]

function mountTools(currentFreshness, onChange) {
  const wrap = el('div', 'spectrum-tools')
  const select = document.createElement('select')
  select.className = 'freshness-select'
  select.setAttribute('aria-label', 'Filtrar por frescura de los resultados')
  for (const opt of FRESHNESS_OPTIONS) {
    const option = document.createElement('option')
    option.value = opt.value
    option.textContent = opt.label
    if (opt.value === currentFreshness) option.selected = true
    select.appendChild(option)
  }
  select.addEventListener('change', () => onChange(select.value))
  wrap.appendChild(select)
  return wrap
}

// ---------------- Spectrum (pestañas propias) ----------------

function buildSpectrum(data) {
  const tabs = [{ id: 'todo', label: 'Todo' }]
  if (data.web.length > 0) tabs.push({ id: 'web', label: 'Web' })
  if (data.videos.length > 0) tabs.push({ id: 'video', label: 'Video' })
  if (data.news.length > 0) tabs.push({ id: 'news', label: 'Noticias' })
  if (data.locations.length > 0) tabs.push({ id: 'places', label: 'Lugares' })
  // Imágenes es la única categoría que MABRIONA no puede confirmar sin pedirla — Brave no la
  // incluye en la misma respuesta (auditoría Etapa 4). Se ofrece la pestaña porque en la práctica
  // casi toda búsqueda real trae imágenes, pero si al abrirla no hay ninguna, la pestaña se retira
  // sola (ver `mountSpectrum`) — nunca se deja mostrando una categoría vacía.
  tabs.push({ id: 'images', label: 'Imágenes' })
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
  if (tabId === 'news') {
    renderNewsList(data.news, container)
    return
  }
  if (tabId === 'places') {
    renderLocationsList(data.locations, container)
    return
  }
  // "Todo" — composición con jerarquía: entidad primero, Context Orbit (relaciones reales, si
  // existen), lugares (cuando la búsqueda es de un negocio local), FAQ, una muestra de noticias, una
  // muestra de video, y web al final. Cada sección se omite por completo si no hay dato real.
  if (data.infobox) container.appendChild(renderEntityFocus(data.infobox))
  if (data.contextGraph) renderContextOrbit(data.contextGraph, container)
  if (data.locations.length > 0) {
    container.appendChild(el('p', 'section-heading', 'Lugares'))
    renderLocationsList(data.locations, container, 3)
  }
  if (data.faq && data.faq.length > 0) renderFaq(data.faq, container)
  if (data.news.length > 0) {
    container.appendChild(el('p', 'section-heading', 'Noticias'))
    renderNewsList(data.news, container, 3)
  }
  if (data.videos.length > 0) {
    container.appendChild(el('p', 'section-heading', 'Video'))
    renderVideoGrid(data.videos, container, 4)
  }
  if (data.web.length > 0) {
    container.appendChild(el('p', 'section-heading', 'Web'))
    renderWebList(data.web, container, 8)
  }
}

function mountSpectrum(data, container, query, freshness) {
  const tabs = buildSpectrum(data)
  const spectrumEl = document.getElementById('spectrum')
  spectrumEl.replaceChildren()
  spectrumEl.classList.remove('hidden')
  let active = 'todo'
  let imagesCache = null

  async function draw() {
    const buttons = Array.from(spectrumEl.querySelectorAll('.spectrum-tab'))
    buttons.forEach((btn) => {
      const isActive = btn.dataset.tab === active
      btn.classList.toggle('active', isActive)
      btn.setAttribute('aria-selected', String(isActive))
    })

    if (active !== 'images') {
      renderSpectrumView(active, data, container)
      return
    }

    if (imagesCache !== null) {
      if (imagesCache.length === 0) { active = 'todo'; draw(); return }
      container.replaceChildren()
      renderImagesGrid(imagesCache, container)
      return
    }

    container.replaceChildren(el('p', 'loading', 'Buscando imágenes…'))
    let images = []
    try {
      const response = window.mabrionaSearch ? await window.mabrionaSearch.images(qs('q')) : { images: [] }
      images = response.images || []
    } catch {
      images = []
    }
    imagesCache = images
    if (active !== 'images') return // el usuario cambió de pestaña mientras cargaba
    if (images.length === 0) {
      const btn = spectrumEl.querySelector('[data-tab="images"]')
      if (btn) btn.remove()
      active = 'todo'
      draw()
      return
    }
    container.replaceChildren()
    renderImagesGrid(images, container)
  }

  for (const tab of tabs) {
    const btn = el('button', 'spectrum-tab', tab.label)
    btn.type = 'button'
    btn.dataset.tab = tab.id
    btn.setAttribute('role', 'tab')
    btn.setAttribute('aria-controls', 'results')
    btn.addEventListener('click', () => { active = tab.id; draw() })
    // Patrón estándar de teclado para role="tab": flechas mueven el foco Y activan la pestaña
    // (activación automática) — Tab/Enter ya funcionaban solos por ser un <button> real.
    btn.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return
      ev.preventDefault()
      const buttons = Array.from(spectrumEl.querySelectorAll('.spectrum-tab'))
      const currentIndex = buttons.indexOf(ev.currentTarget)
      const delta = ev.key === 'ArrowRight' ? 1 : -1
      const next = buttons[(currentIndex + delta + buttons.length) % buttons.length]
      next.focus()
      active = next.dataset.tab
      draw()
    })
    spectrumEl.appendChild(btn)
  }
  spectrumEl.appendChild(mountTools(freshness || '', (newFreshness) => {
    const url = new URL(location.href)
    if (newFreshness) url.searchParams.set('fresh', newFreshness)
    else url.searchParams.delete('fresh')
    history.replaceState(null, '', url)
    search(query, newFreshness)
  }))
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

async function search(query, freshness) {
  const container = document.getElementById('results')
  document.getElementById('spectrum').classList.add('hidden')
  container.replaceChildren(el('p', 'loading', 'Buscando…'))
  if (!query) {
    container.replaceChildren(el('p', 'empty', 'Escribe algo para buscar.'))
    return
  }

  if (window.mabrionaSearch) {
    try {
      const response = await window.mabrionaSearch.query(query, freshness)
      if (response.configured) {
        if (response.error) {
          container.replaceChildren()
          renderSearchError(response, query, freshness, container)
          return
        }
        const hasAnything =
          response.infobox ||
          response.web.length > 0 ||
          response.videos.length > 0 ||
          (response.faq && response.faq.length > 0) ||
          (response.news && response.news.length > 0) ||
          (response.locations && response.locations.length > 0)
        if (hasAnything) mountSpectrum(response, container, query, freshness)
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
const initialFreshness = qs('fresh')
document.getElementById('q').value = initialQuery
search(initialQuery, initialFreshness)
