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
 * Desde Etapa 4: Noticias y Lugares vienen en la misma respuesta de
 * arriba (sin llamada aparte). Imágenes es la única categoría que
 * necesita su propio pedido a Brave — se hace perezoso, solo si el
 * usuario abre esa pestaña (ver `search:images` en preload/main.js).
 * Categorías sin evidencia real en esta API (Compras, Música como
 * categoría propia, People más allá del infobox, MABRIONA AI): a
 * propósito NO se simulan — ver docs/FASE-MABRIONA-SEARCH-ETAPA-4-FUENTES.md.
 *
 * Sin respaldo a ningún otro proveedor: si Brave no está configurada
 * (`configured: false`, no debería pasar en el .app distribuido — la
 * key viene empaquetada, ver profiles.js) o falla, se muestra el
 * estado de error real correspondiente — nunca se manda la consulta a
 * otro tercero por atrás sin que la persona lo haya elegido ella misma
 * (eso solo pasa si elige explícitamente un motor externo en
 * Configuración → Búsqueda).
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
  // Wikipedia arma algunos atributos (ej. "Spouses", fechas de matrimonio/divorcio) con un módulo
  // interno cuyo render queda roto en la fuente real de Brave: deja el literal `"}]]}'>` pegado al
  // texto, ej. `(married</span>"}]]}'>m. 1994)`. No es una etiqueta (no empieza con `<`), así que
  // el strip de tags de abajo no lo toca — se ve consistente en múltiples entidades reales
  // (Michael Jackson, Barack Obama, Elon Musk, Taylor Swift), así que se limpia puntualmente acá en
  // vez de dejarlo como basura visible.
  const withoutTemplateLeak = String(text).replaceAll('"}]]}\'>', '')
  const withoutTags = withoutTemplateLeak.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const textarea = document.createElement('textarea')
  textarea.innerHTML = withoutTags
  return textarea.value
}

function renderEmpty(query, container) {
  container.appendChild(el('p', 'empty', 'MABRIONA no encontró resultados para esta búsqueda.'))
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
  } else if (response.errorKind === 'not_configured') {
    message = 'MABRIONA Search no está configurada en este build.'
  }
  card.appendChild(el('p', 'search-error-title', message))
  const retry = el('button', 'search-error-retry', 'Reintentar')
  retry.type = 'button'
  retry.addEventListener('click', () => search(query, freshness))
  card.appendChild(retry)
  container.appendChild(card)
}

// ---------------- Entity Focus ----------------

/** Estrellas reales renderizadas a partir de una nota real sobre una escala real (ej. 8.7/10,
 * 4.7/5) — se normaliza a 5 estrellas para mostrarlas, pero el número real siempre queda visible al
 * lado, nunca se le esconde la escala original al usuario. */
function renderRatingStars(value, best) {
  const normalized = Math.max(0, Math.min(5, (value / best) * 5))
  const full = Math.round(normalized)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

function renderEntityFocus(box) {
  const card = el('div', 'entity-focus')

  // Identidad — con foto real cuando Brave la trae (Michael Jackson, The Matrix, etc.), nunca un
  // placeholder gris: si no hay `box.image`, esta fila es solo texto, igual que antes.
  const header = el('div', 'entity-header')
  if (box.image) {
    const photoWrap = el('div', 'entity-photo')
    const img = document.createElement('img')
    img.src = box.image
    img.alt = box.title
    photoWrap.appendChild(img)
    header.appendChild(photoWrap)
  }
  const identity = el('div', 'entity-identity')
  identity.appendChild(el('h2', null, box.title))
  const desc = box.longDescription || box.description
  if (desc) identity.appendChild(el('p', 'entity-desc', stripHtml(desc).slice(0, 400)))
  if (box.websiteUrl) {
    let host = box.websiteUrl
    try { host = new URL(box.websiteUrl).hostname } catch { /* URL rara, mostrar tal cual */ }
    const site = el('a', 'entity-website')
    site.href = box.websiteUrl
    site.textContent = `Sitio oficial: ${host} →`
    identity.appendChild(site)
  }
  header.appendChild(identity)
  card.appendChild(header)

  // Valoraciones reales (apps/películas/productos) — con fuente y cantidad de reseñas siempre
  // visibles, nunca un promedio sin decir de dónde sale.
  if (box.ratings.length > 0) {
    card.appendChild(el('p', 'section-heading', 'Valoraciones'))
    const row = el('div', 'entity-ratings')
    for (const rating of box.ratings) {
      const item = el('a', 'entity-rating')
      item.href = rating.sourceUrl || '#'
      item.appendChild(el('span', 'entity-rating-stars', renderRatingStars(rating.value, rating.best)))
      const scoreText = rating.reviewCount != null
        ? `${rating.value}/${rating.best} · ${rating.sourceName} (${rating.reviewCount.toLocaleString('es')})`
        : `${rating.value}/${rating.best} · ${rating.sourceName}`
      item.appendChild(el('span', 'entity-rating-score', scoreText))
      row.appendChild(item)
    }
    card.appendChild(row)
  }

  // Atributos — solo los que de verdad tienen un valor (ver normalizeInfobox: las filas
  // separadoras de sección de la tabla original ya vienen descartadas).
  if (box.attributes.length > 0) {
    card.appendChild(el('p', 'section-heading', 'Atributos'))
    const grid = el('div', 'entity-attrs')
    for (const attr of box.attributes.slice(0, 16)) {
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

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

/**
 * Fuente oficial en Web — nunca una heurística inventada: solo se marca "oficial" un resultado
 * cuando su dominio coincide exactamente con `website_url`, el campo que la propia Brave ya
 * identificó como sitio oficial de la entidad (ver Entity Focus). Si no hay `officialHostname` (la
 * mayoría de búsquedas, sin entidad reconocida o sin sitio oficial real), esto no hace nada.
 */
function renderWebList(results, container, limit, officialHostname) {
  let ordered = results
  if (officialHostname) {
    const officialIndex = results.findIndex((r) => hostnameOf(r.url) === officialHostname)
    if (officialIndex > 0) ordered = [results[officialIndex], ...results.slice(0, officialIndex), ...results.slice(officialIndex + 1)]
  }
  const list = el('div', 'result-list')
  for (const r of ordered.slice(0, limit || ordered.length)) {
    const isOfficial = officialHostname && hostnameOf(r.url) === officialHostname
    const card = el('div', isOfficial ? 'card card-official' : 'card')
    const link = el('a', 'result-title')
    link.href = r.url
    link.textContent = stripHtml(r.title)
    card.appendChild(link)
    if (isOfficial) card.appendChild(el('span', 'result-official-badge', 'Fuente oficial'))
    card.appendChild(el('p', 'result-url', r.url))
    if (r.description) card.appendChild(el('p', 'result-desc', stripHtml(r.description)))
    list.appendChild(card)
  }
  container.appendChild(list)
}

// ---------------- Video ----------------

function renderVideoGrid(videos, container, limit, gridClass) {
  const grid = el('div', gridClass || 'video-grid')
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

// ---------------- MABRIONA Tools (calculadora / conversión / hora) ----------------

/** Formatea un número real sin arrastrar el ruido de coma flotante (ej. 2.2675999999999997). */
function formatToolNumber(n) {
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 10000) / 10000)
}

const UNIT_DISPLAY_LABELS = {
  km: 'km', m: 'm', cm: 'cm', mm: 'mm', mi: 'millas', yd: 'yardas', ft: 'pies', in: 'pulgadas',
  kg: 'kg', g: 'g', mg: 'mg', lb: 'lb', oz: 'oz',
  c: '°C', f: '°F', k: 'K',
}

/** Resultado calculado 100% por MABRIONA (`search/tools.js`, proceso principal) — nunca pedido a
 * Brave ni a ningún tercero: aritmética real, conversión con factores reales, o la hora real del
 * sistema en el momento de la búsqueda. */
function renderToolResult(tool, container) {
  const card = el('div', 'tool-card')
  if (tool.type === 'calculator') {
    card.appendChild(el('p', 'tool-expression', tool.expression))
    card.appendChild(el('p', 'tool-result', formatToolNumber(tool.result)))
  } else if (tool.type === 'conversion') {
    const fromLabel = UNIT_DISPLAY_LABELS[tool.from] || tool.from
    const toLabel = UNIT_DISPLAY_LABELS[tool.to] || tool.to
    card.appendChild(el('p', 'tool-expression', `${formatToolNumber(tool.value)} ${fromLabel} equivale a`))
    card.appendChild(el('p', 'tool-result', `${formatToolNumber(tool.result)} ${toLabel}`))
  } else if (tool.type === 'datetime') {
    const date = new Date(tool.now)
    const formatted = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'medium' }).format(date)
    card.appendChild(el('p', 'tool-result', formatted.charAt(0).toUpperCase() + formatted.slice(1)))
  }
  container.appendChild(card)
}

// ---------------- Spectrum (pestañas propias) ----------------

function renderSpectrumView(tabId, data, container) {
  container.replaceChildren()
  const shortVideos = data.videos.filter((v) => v.isShortForm)
  const longVideos = data.videos.filter((v) => !v.isShortForm)
  const officialHostname = data.infobox && data.infobox.websiteUrl ? hostnameOf(data.infobox.websiteUrl) : null

  if (tabId === 'web') {
    renderWebList(data.web, container, null, officialHostname)
    return
  }
  if (tabId === 'video') {
    renderVideoGrid(longVideos, container)
    return
  }
  if (tabId === 'shorts') {
    renderVideoGrid(shortVideos, container, null, 'shorts-grid')
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
  if (tabId === 'tools') {
    if (data.tool) renderToolResult(data.tool, container)
    return
  }
  // "Todo" — experiencia normal de buscador: resultados como columna principal, información de la
  // entidad como columna secundaria al lado (nunca un diagrama ni un "universo") — se apila abajo
  // en ventanas angostas, ver .results-columns en results.css. La respuesta más directa posible
  // (una herramienta real, si la consulta es exactamente eso) va arriba de todo, a todo el ancho.
  if (data.tool) renderToolResult(data.tool, container)

  const columns = el('div', 'results-columns')
  const main = el('div', 'results-main')
  if (data.locations.length > 0) {
    main.appendChild(el('p', 'section-heading', 'Lugares'))
    renderLocationsList(data.locations, main, 6)
  }
  if (data.faq && data.faq.length > 0) renderFaq(data.faq, main)
  if (data.news.length > 0) {
    main.appendChild(el('p', 'section-heading', 'Noticias'))
    renderNewsList(data.news, main, 6)
  }
  if (shortVideos.length > 0) {
    main.appendChild(el('p', 'section-heading', 'Cortos'))
    renderVideoGrid(shortVideos, main, 8, 'shorts-grid')
  }
  if (longVideos.length > 0) {
    main.appendChild(el('p', 'section-heading', 'Videos'))
    renderVideoGrid(longVideos, main, 8)
  }
  if (data.web.length > 0) {
    main.appendChild(el('p', 'section-heading', 'Web'))
    renderWebList(data.web, main, 15, officialHostname)
  }
  columns.appendChild(main)

  if (data.infobox) {
    const side = el('aside', 'results-side')
    side.appendChild(renderEntityFocus(data.infobox))
    columns.appendChild(side)
  }

  container.appendChild(columns)
}

/** Menú "Más" — categorías reales que existen para esta búsqueda pero no entraron en el espacio
 * principal (ver `search/spectrumResolver.js`, máximo de pestañas visibles). Nunca lista una
 * categoría sin datos: si `overflow` viene vacío, el botón ni se muestra. */
function mountOverflowMenu(overflowTabs, activeId, onSelect) {
  if (overflowTabs.length === 0) return null
  const wrap = el('div', 'spectrum-more')
  const trigger = el('button', 'spectrum-tab spectrum-more-trigger', 'Más ▾')
  trigger.type = 'button'
  trigger.setAttribute('aria-haspopup', 'true')
  trigger.setAttribute('aria-expanded', 'false')
  const isOverflowActive = overflowTabs.some((t) => t.id === activeId)
  trigger.classList.toggle('active', isOverflowActive)

  const menu = el('div', 'spectrum-more-menu')
  menu.hidden = true
  for (const tab of overflowTabs) {
    const item = el('button', 'spectrum-more-item', tab.label)
    item.type = 'button'
    item.setAttribute('role', 'tab')
    if (tab.id === activeId) item.classList.add('active')
    item.addEventListener('click', () => {
      menu.hidden = true
      trigger.setAttribute('aria-expanded', 'false')
      onSelect(tab.id)
    })
    menu.appendChild(item)
  }

  trigger.addEventListener('click', () => {
    const willShow = menu.hidden
    menu.hidden = !willShow
    trigger.setAttribute('aria-expanded', String(willShow))
  })
  document.addEventListener('click', (ev) => {
    if (!wrap.contains(ev.target)) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false') }
  })

  wrap.appendChild(trigger)
  wrap.appendChild(menu)
  return wrap
}

function mountSpectrum(data, container, query, freshness) {
  const spectrum = data.spectrum || { tabs: [{ id: 'todo', label: 'Todo' }], overflow: [] }
  const spectrumEl = document.getElementById('spectrum')
  spectrumEl.replaceChildren()
  spectrumEl.classList.remove('hidden')
  let tabs = spectrum.tabs
  let overflow = spectrum.overflow
  let active = 'todo'
  let imagesCache = null

  async function draw() {
    const buttons = Array.from(spectrumEl.querySelectorAll('.spectrum-tab:not(.spectrum-more-trigger)'))
    buttons.forEach((btn) => {
      const isActive = btn.dataset.tab === active
      btn.classList.toggle('active', isActive)
      btn.setAttribute('aria-selected', String(isActive))
    })
    renderOverflowButton()

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
      tabs = tabs.filter((t) => t.id !== 'images')
      rebuildTabButtons()
      active = 'todo'
      draw()
      return
    }
    container.replaceChildren()
    renderImagesGrid(images, container)
  }

  function renderOverflowButton() {
    const existing = spectrumEl.querySelector('.spectrum-more')
    if (existing) existing.remove()
    const toolsEl = spectrumEl.querySelector('.spectrum-tools')
    const menu = mountOverflowMenu(overflow, active, (id) => { active = id; draw() })
    if (menu) spectrumEl.insertBefore(menu, toolsEl)
  }

  function rebuildTabButtons() {
    spectrumEl.querySelectorAll('.spectrum-tab:not(.spectrum-more-trigger)').forEach((btn) => btn.remove())
    const toolsEl = spectrumEl.querySelector('.spectrum-tools')
    tabs.forEach((tab, i) => {
      const btn = el('button', 'spectrum-tab', tab.label)
      btn.type = 'button'
      btn.dataset.tab = tab.id
      // Tema Cristal Líquido: cada categoría enciende con su propia luz, no todas cian —
      // rotación fija de 7 colores (ver --hue-0..6 en results.css), no una elección semántica
      // real por categoría (Web/Videos/Imágenes no "significan" nada distinto entre sí).
      btn.dataset.hue = String(i % 7)
      btn.setAttribute('role', 'tab')
      btn.setAttribute('aria-controls', 'results')
      btn.addEventListener('click', () => { active = tab.id; draw() })
      // Patrón estándar de teclado para role="tab": flechas mueven el foco Y activan la pestaña
      // (activación automática) — Tab/Enter ya funcionaban solos por ser un <button> real.
      btn.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return
        ev.preventDefault()
        const all = Array.from(spectrumEl.querySelectorAll('.spectrum-tab'))
        const currentIndex = all.indexOf(ev.currentTarget)
        const delta = ev.key === 'ArrowRight' ? 1 : -1
        const next = all[(currentIndex + delta + all.length) % all.length]
        next.focus()
        if (next.dataset.tab) { active = next.dataset.tab; draw() }
      })
      spectrumEl.insertBefore(btn, toolsEl)
    })
  }

  const toolsWrap = mountTools(freshness || '', (newFreshness) => {
    const url = new URL(location.href)
    if (newFreshness) url.searchParams.set('fresh', newFreshness)
    else url.searchParams.delete('fresh')
    history.replaceState(null, '', url)
    search(query, newFreshness)
  })
  spectrumEl.appendChild(toolsWrap)
  rebuildTabButtons()
  renderOverflowButton()
  draw()
}

// ---------------- Orquestación ----------------

async function search(query, freshness) {
  const container = document.getElementById('results')
  document.getElementById('spectrum').classList.add('hidden')
  // Cargando/vacío/error son estados sin contenido de verdad — se centran en toda la pantalla
  // (ver .state-centered en results.css) para que nunca se vean como una tarjeta chica flotando
  // arriba con el resto de la página negra y vacía.
  container.classList.add('state-centered')
  container.replaceChildren(el('p', 'loading', 'Buscando…'))
  if (!query) {
    container.replaceChildren(el('p', 'empty', 'Escribe algo para buscar.'))
    return
  }

  // No hay ningún respaldo a un tercero acá — si `window.mabrionaSearch` faltara (el preload no
  // cargó) o `.query()` tirara una excepción real (no un error HTTP normal, ese ya viene adentro
  // de `response` y se maneja abajo), se muestra el mismo estado de error honesto de siempre, con
  // Reintentar — nunca se manda la consulta a otro proveedor sin que la persona lo haya elegido.
  try {
    const response = await window.mabrionaSearch.query(query, freshness)
    if (!response.configured) {
      container.replaceChildren()
      renderSearchError({ errorKind: 'not_configured' }, query, freshness, container)
      return
    }
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
      (response.locations && response.locations.length > 0) ||
      response.tool
    container.replaceChildren()
    if (hasAnything) {
      container.classList.remove('state-centered')
      mountSpectrum(response, container, query, freshness)
    } else {
      renderEmpty(query, container)
    }
  } catch {
    container.replaceChildren()
    renderSearchError({ errorKind: 'network' }, query, freshness, container)
  }
}

const initialQuery = qs('q')
const initialFreshness = qs('fresh')
document.getElementById('q').value = initialQuery
search(initialQuery, initialFreshness)
