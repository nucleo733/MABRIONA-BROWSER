'use strict'
/* global mabrionaBrowser */

const tabstrip = document.getElementById('tabstrip')
const newTabBtn = document.getElementById('btn-new-tab')
const address = document.getElementById('address')
const btnBack = document.getElementById('btn-back')
const btnForward = document.getElementById('btn-forward')
const btnReload = document.getElementById('btn-reload')
const btnFav = document.getElementById('btn-fav')
const btnScreenshot = document.getElementById('btn-screenshot')
const shieldsCount = document.getElementById('shields-count')

let currentTabs = []
let activeTab = null

/** Barra de direcciones limpia para las páginas propias de MABRIONA — nunca la ruta interna
 * cruda del archivo (`.../app.asar/renderer/results.html?q=...`), eso no se ve como navegación real. */
function displayAddress(url) {
  if (url === 'about:blank' || url.endsWith('/renderer/newtab.html')) return ''
  if (url.includes('/renderer/results.html')) {
    try {
      return new URL(url).searchParams.get('q') || ''
    } catch {
      return url
    }
  }
  return url
}

let lastActiveTabId = null
function render(tabsState) {
  currentTabs = tabsState
  activeTab = tabsState.find((t) => t.isActive) || null
  if (activeTab && activeTab.id !== lastActiveTabId && lastActiveTabId !== null) closeFindbar()
  lastActiveTabId = activeTab ? activeTab.id : null

  tabstrip.querySelectorAll('.tab').forEach((el) => el.remove())
  for (const tab of tabsState) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.isActive ? ' active' : '') + (tab.isPrivate ? ' private' : '')
    el.setAttribute('role', 'tab')
    el.setAttribute('aria-selected', String(tab.isActive))
    const privateMark = tab.isPrivate ? '<span class="tab-private-mark" title="Pestaña privada">🕶️</span>' : ''
    el.innerHTML = `${privateMark}<span class="tab-title">${escapeHtml(tab.title)}</span><span class="tab-duplicate" data-duplicate-tab="${tab.id}" title="Duplicar pestaña">⧉</span><span class="tab-close" data-close-tab="${tab.id}">✕</span>`
    el.addEventListener('click', (e) => {
      if (e.target.dataset.closeTab || e.target.dataset.duplicateTab) return
      mabrionaBrowser.switchTab(tab.id)
    })
    tabstrip.insertBefore(el, newTabBtn)
  }
  tabstrip.querySelectorAll('[data-duplicate-tab]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      mabrionaBrowser.duplicateTab(Number(e.target.dataset.duplicateTab))
    })
  })
  tabstrip.querySelectorAll('[data-close-tab]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      mabrionaBrowser.closeTab(Number(e.target.dataset.closeTab))
    })
  })

  if (activeTab && document.activeElement !== address) {
    address.value = displayAddress(activeTab.url)
  }
  btnBack.disabled = !activeTab?.canGoBack
  btnForward.disabled = !activeTab?.canGoForward
  btnReload.textContent = activeTab?.loading ? '✕' : '⟳'
  shieldsCount.textContent = String(activeTab?.blockedCount ?? 0)
  document.body.classList.toggle('private-mode', !!activeTab?.isPrivate)
  if (!document.getElementById('panel-menu').classList.contains('hidden')) refreshZoomLevel()

  if (activeTab) {
    mabrionaBrowser.isFavorite(activeTab.url).then((isFav) => {
      btnFav.textContent = isFav ? '★' : '☆'
    })
  }
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

newTabBtn.addEventListener('click', () => mabrionaBrowser.createTab())
address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && activeTab) mabrionaBrowser.navigate(activeTab.id, address.value)
})
btnBack.addEventListener('click', () => activeTab && mabrionaBrowser.back(activeTab.id))
btnForward.addEventListener('click', () => activeTab && mabrionaBrowser.forward(activeTab.id))
btnReload.addEventListener('click', () => {
  if (!activeTab) return
  if (activeTab.loading) mabrionaBrowser.stop(activeTab.id)
  else mabrionaBrowser.reload(activeTab.id)
})
btnFav.addEventListener('click', async () => {
  if (!activeTab) return
  const isFav = await mabrionaBrowser.isFavorite(activeTab.url)
  if (isFav) await mabrionaBrowser.removeFavorite(activeTab.url)
  else await mabrionaBrowser.addFavorite({ url: activeTab.url, title: activeTab.title, addedAt: Date.now() })
  btnFav.textContent = isFav ? '☆' : '★'
  refreshFavoritesPanel()
})
btnScreenshot.addEventListener('click', async () => {
  if (!activeTab) return
  btnScreenshot.disabled = true
  const original = btnScreenshot.textContent
  const result = await mabrionaBrowser.captureScreenshot(activeTab.id)
  btnScreenshot.textContent = result.ok ? '✅' : '⚠️'
  btnScreenshot.title = result.ok ? `Guardada en ${result.path}` : `No se pudo capturar — ${result.error}`
  setTimeout(() => { btnScreenshot.textContent = original; btnScreenshot.disabled = false }, 1200)
})

// ---------------- Paneles (historial / favoritos / descargas / shields) ----------------

const panels = ['history', 'favorites', 'downloads', 'shields', 'settings', 'more', 'menu']
function closeAllPanels() {
  for (const name of panels) document.getElementById(`panel-${name}`).classList.add('hidden')
}
function togglePanel(name) {
  const el = document.getElementById(`panel-${name}`)
  const wasHidden = el.classList.contains('hidden')
  closeAllPanels()
  if (wasHidden) el.classList.remove('hidden')
}

document.getElementById('btn-history').addEventListener('click', () => { togglePanel('history'); refreshHistoryPanel() })
document.getElementById('btn-favorites').addEventListener('click', () => { togglePanel('favorites'); refreshFavoritesPanel() })
document.getElementById('btn-downloads').addEventListener('click', () => { togglePanel('downloads'); refreshDownloadsPanel() })
document.getElementById('btn-shields').addEventListener('click', () => { togglePanel('shields'); refreshShieldsPanel() })
document.getElementById('btn-settings').addEventListener('click', () => { togglePanel('settings'); refreshSettingsPanel() })
document.getElementById('btn-more').addEventListener('click', () => togglePanel('more'))
document.getElementById('btn-menu').addEventListener('click', () => { togglePanel('menu'); refreshZoomLevel() })
document.querySelectorAll('.panel-close').forEach((btn) => btn.addEventListener('click', (e) => {
  document.getElementById(`panel-${e.target.dataset.close}`).classList.add('hidden')
}))

// Panel "Más" (responsive — solo visible en ventanas angostas, ver style.css): son las mismas
// acciones reales de siempre, no una copia — cada botón dispara el botón real correspondiente.
document.getElementById('more-screenshot').addEventListener('click', () => { togglePanel('more'); btnScreenshot.click() })
document.getElementById('more-shields').addEventListener('click', () => { togglePanel('more'); document.getElementById('btn-shields').click() })
document.getElementById('more-history').addEventListener('click', () => { togglePanel('more'); document.getElementById('btn-history').click() })
document.getElementById('more-downloads').addEventListener('click', () => { togglePanel('more'); document.getElementById('btn-downloads').click() })
document.getElementById('more-favorites').addEventListener('click', () => { togglePanel('more'); document.getElementById('btn-favorites').click() })

// Ventanas reales (Electron nativo) y pestaña privada real (sesión en memoria, ver main.js).
document.getElementById('menu-new-window').addEventListener('click', () => mabrionaBrowser.newWindow())
document.getElementById('menu-new-private').addEventListener('click', () => { mabrionaBrowser.createPrivateTab(); togglePanel('menu') })

// Zoom real — Electron nativo (setZoomFactor), no un transform de CSS.
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
async function refreshZoomLevel() {
  if (!activeTab) return
  const factor = await mabrionaBrowser.getZoom(activeTab.id)
  document.getElementById('zoom-level').textContent = `${Math.round(factor * 100)}%`
}
async function applyZoom(factor) {
  if (!activeTab) return
  const applied = await mabrionaBrowser.setZoom(activeTab.id, factor)
  document.getElementById('zoom-level').textContent = `${Math.round(applied * 100)}%`
}
document.getElementById('zoom-in').addEventListener('click', async () => {
  if (!activeTab) return
  const current = await mabrionaBrowser.getZoom(activeTab.id)
  applyZoom(Math.min(ZOOM_MAX, current + ZOOM_STEP))
})
document.getElementById('zoom-out').addEventListener('click', async () => {
  if (!activeTab) return
  const current = await mabrionaBrowser.getZoom(activeTab.id)
  applyZoom(Math.max(ZOOM_MIN, current - ZOOM_STEP))
})
document.getElementById('zoom-reset').addEventListener('click', () => applyZoom(1))
document.querySelector('[data-clear="history"]').addEventListener('click', async () => {
  await mabrionaBrowser.clearHistory()
  refreshHistoryPanel()
})

function renderList(ulId, items, emptyLabel, onClick, onDelete) {
  const ul = document.getElementById(ulId)
  ul.innerHTML = ''
  if (items.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = emptyLabel
    ul.appendChild(li)
    return
  }
  for (const item of items) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="item-title">${escapeHtml(item.title || item.url)}</span><span class="item-url">${escapeHtml(item.url)}</span>`
    li.addEventListener('click', () => onClick(item))
    if (onDelete) {
      const del = document.createElement('button')
      del.className = 'item-delete'
      del.type = 'button'
      del.textContent = '✕'
      del.title = 'Eliminar esta entrada'
      del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(item) })
      li.appendChild(del)
    }
    ul.appendChild(li)
  }
}

let historyCache = []
async function refreshHistoryPanel() {
  historyCache = await mabrionaBrowser.listHistory()
  document.getElementById('history-search').value = ''
  renderHistoryList(historyCache)
}
function renderHistoryList(items) {
  renderList(
    'history-list',
    items,
    'Sin historial todavía',
    (item) => { if (activeTab) mabrionaBrowser.navigate(activeTab.id, item.url) },
    async (item) => { await mabrionaBrowser.removeHistoryEntry(item.url); refreshHistoryPanel() },
  )
}
document.getElementById('history-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase()
  if (!q) { renderHistoryList(historyCache); return }
  renderHistoryList(historyCache.filter((h) => (h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q)))
})
async function refreshFavoritesPanel() {
  const favorites = await mabrionaBrowser.listFavorites()
  renderList('favorites-list', favorites, 'Sin favoritos todavía', (item) => {
    if (activeTab) mabrionaBrowser.navigate(activeTab.id, item.url)
  })
}
async function refreshDownloadsPanel() {
  const downloads = await mabrionaBrowser.listDownloads()
  renderList('downloads-list', downloads.map((d) => ({ title: d.filename, url: d.state })), 'Sin descargas todavía', (item) => {
    const match = downloads.find((d) => d.filename === item.title)
    if (match) mabrionaBrowser.showDownload(match.path)
  })
}
async function refreshShieldsPanel() {
  const enabled = await mabrionaBrowser.getShieldsEnabled()
  document.getElementById('shields-toggle-input').checked = enabled
}
document.getElementById('shields-toggle-input').addEventListener('change', (e) => {
  mabrionaBrowser.setShieldsEnabled(e.target.checked)
})

// ---------------- Settings — solo capacidades reales, nada de switches decorativos ----------------

async function refreshSettingsPanel() {
  const dir = await mabrionaBrowser.getDownloadsDir()
  document.getElementById('settings-downloads-path').textContent = `Carpeta actual: ${dir}`
  await refreshSettingsPermissions()
}

async function refreshSettingsPermissions() {
  const all = await mabrionaBrowser.listPermissions()
  const ul = document.getElementById('settings-permissions-list')
  ul.innerHTML = ''
  const rows = []
  for (const [origin, kinds] of Object.entries(all)) {
    for (const [kind, decision] of Object.entries(kinds)) rows.push({ origin, kind, decision })
  }
  if (rows.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'Ningún sitio pidió permisos todavía'
    ul.appendChild(li)
    return
  }
  const kindLabel = { camera: 'Cámara', microphone: 'Micrófono', location: 'Ubicación', notifications: 'Notificaciones' }
  for (const row of rows) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="item-title">${escapeHtml(row.origin)} — ${kindLabel[row.kind] || row.kind}</span><span class="item-url">${row.decision === 'allow' ? 'Permitido' : 'Bloqueado'}</span>`
    const toggle = document.createElement('button')
    toggle.className = 'item-delete'
    toggle.type = 'button'
    toggle.title = 'Olvidar esta decisión (va a volver a preguntar)'
    toggle.textContent = '✕'
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation()
      await mabrionaBrowser.clearPermission(row.origin, row.kind)
      refreshSettingsPermissions()
    })
    li.appendChild(toggle)
    ul.appendChild(li)
  }
}

document.getElementById('settings-clear-data').addEventListener('click', async () => {
  const btn = document.getElementById('settings-clear-data')
  btn.disabled = true
  const original = btn.textContent
  await mabrionaBrowser.clearPrivacyData()
  btn.textContent = 'Listo ✓'
  setTimeout(() => { btn.textContent = original; btn.disabled = false }, 1200)
})
document.getElementById('settings-choose-downloads').addEventListener('click', async () => {
  const dir = await mabrionaBrowser.chooseDownloadsDir()
  document.getElementById('settings-downloads-path').textContent = `Carpeta actual: ${dir}`
})

mabrionaBrowser.onTabsState(render)
mabrionaBrowser.onDownloadsState(() => {
  if (!document.getElementById('panel-downloads').classList.contains('hidden')) refreshDownloadsPanel()
})
mabrionaBrowser.getTabsState().then(render)

// Permisos por sitio (cámara/micrófono) — pedido real de un sitio real, el usuario decide de
// verdad; nunca se asume "permitir" ni "bloquear" sin que la persona lo haya tocado.
const KIND_LABEL = { camera: 'la cámara', microphone: 'el micrófono', location: 'tu ubicación', notifications: 'mostrarte notificaciones' }
const permissionQueue = []
let permissionShowing = null
const permissionBanner = document.getElementById('permission-banner')
const permissionText = document.getElementById('permission-text')

function showNextPermissionRequest() {
  if (permissionShowing || permissionQueue.length === 0) return
  permissionShowing = permissionQueue.shift()
  const labels = permissionShowing.kinds.map((k) => KIND_LABEL[k] || k).join(' y ')
  permissionText.textContent = `${permissionShowing.origin} solicita acceso a ${labels}.`
  permissionBanner.classList.remove('hidden')
}

function resolvePermission(allow) {
  if (!permissionShowing) return
  mabrionaBrowser.respondPermission(permissionShowing.requestId, allow)
  permissionShowing = null
  permissionBanner.classList.add('hidden')
  showNextPermissionRequest()
}

document.getElementById('permission-allow').addEventListener('click', () => resolvePermission(true))
document.getElementById('permission-deny').addEventListener('click', () => resolvePermission(false))

mabrionaBrowser.onPermissionRequest((req) => {
  permissionQueue.push(req)
  showNextPermissionRequest()
})

// Find in Page — capacidad real de Chromium (webContents.findInPage), funciona contra el
// contenido real de cualquier pestaña, con el mismo contador que Chrome/Safari.
const findbar = document.getElementById('findbar')
const findInput = document.getElementById('find-input')
const findCount = document.getElementById('find-count')

function openFindbar() {
  if (!activeTab) return
  findbar.classList.remove('hidden')
  findInput.focus()
  findInput.select()
}
function closeFindbar() {
  findbar.classList.add('hidden')
  findCount.textContent = '0/0'
  if (activeTab) mabrionaBrowser.stopFind(activeTab.id)
}
function runFind(forward, findNext) {
  if (!activeTab || !findInput.value) return
  mabrionaBrowser.findInPage(activeTab.id, findInput.value, { forward, findNext })
}

findInput.addEventListener('input', () => runFind(true, false))
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runFind(!e.shiftKey, true)
  else if (e.key === 'Escape') closeFindbar()
})
document.getElementById('find-next').addEventListener('click', () => runFind(true, true))
document.getElementById('find-prev').addEventListener('click', () => runFind(false, true))
document.getElementById('find-close').addEventListener('click', closeFindbar)

window.addEventListener('keydown', (e) => {
  const cmdOrCtrl = e.metaKey || e.ctrlKey
  const key = e.key.toLowerCase()
  if (cmdOrCtrl && key === 'f') { e.preventDefault(); openFindbar() }
  else if (e.key === 'Escape' && !findbar.classList.contains('hidden')) closeFindbar()
  else if (cmdOrCtrl && e.shiftKey && key === 'n') { e.preventDefault(); mabrionaBrowser.createPrivateTab() }
  else if (cmdOrCtrl && key === 'n') { e.preventDefault(); mabrionaBrowser.newWindow() }
  else if (cmdOrCtrl && key === 't') { e.preventDefault(); mabrionaBrowser.createTab() }
  else if (cmdOrCtrl && key === 'w' && activeTab) { e.preventDefault(); mabrionaBrowser.closeTab(activeTab.id) }
  else if (cmdOrCtrl && (key === '=' || key === '+')) { e.preventDefault(); document.getElementById('zoom-in').click() }
  else if (cmdOrCtrl && key === '-') { e.preventDefault(); document.getElementById('zoom-out').click() }
  else if (cmdOrCtrl && key === '0') { e.preventDefault(); document.getElementById('zoom-reset').click() }
})

mabrionaBrowser.onFindResult(({ tabId, activeMatchOrdinal, matches }) => {
  if (!activeTab || tabId !== activeTab.id) return
  findCount.textContent = `${matches === 0 ? 0 : activeMatchOrdinal}/${matches}`
})
