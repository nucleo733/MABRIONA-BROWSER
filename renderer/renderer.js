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

const panels = ['history', 'favorites', 'downloads', 'shields', 'settings', 'more', 'menu', 'profile', 'extensions']
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
document.getElementById('btn-profile').addEventListener('click', () => { togglePanel('profile'); refreshProfilePanel() })
document.getElementById('more-profile').addEventListener('click', () => { togglePanel('more'); document.getElementById('btn-profile').click() })
document.getElementById('btn-extensions').addEventListener('click', () => { togglePanel('extensions'); refreshExtensionsPanel() })
document.getElementById('more-extensions').addEventListener('click', () => { togglePanel('more'); document.getElementById('btn-extensions').click() })
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

// ---------------- Perfiles — cambiar de perfil abre/enfoca una ventana real de ese perfil ----------------

async function refreshProfileButton() {
  const p = await mabrionaBrowser.getActiveProfile()
  document.getElementById('profile-emoji').textContent = p ? p.emoji : '👤'
}

async function refreshProfilePanel() {
  const [profiles, active] = await Promise.all([mabrionaBrowser.listProfiles(), mabrionaBrowser.getActiveProfile()])
  document.getElementById('profile-active-note').textContent = active
    ? `Perfil activo en esta ventana: ${active.emoji} ${active.name}${active.isGuest ? ' — nada de esto se guarda' : ''}`
    : ''

  const ul = document.getElementById('profile-list')
  ul.innerHTML = ''
  for (const p of profiles) {
    const li = document.createElement('li')
    const isActive = active && !active.isGuest && p.id === active.id
    li.innerHTML = `<span class="item-title">${p.emoji} ${escapeHtml(p.name)}</span><span class="item-url">${isActive ? 'Activo en esta ventana' : 'Cambiar →'}</span>`
    if (!isActive) {
      li.addEventListener('click', async () => {
        await mabrionaBrowser.switchToProfile(p.id)
        togglePanel('profile')
      })
    }
    const canDelete = await mabrionaBrowser.canDeleteProfile(p.id)
    if (canDelete) {
      const del = document.createElement('button')
      del.className = 'item-delete'
      del.type = 'button'
      del.title = 'Borrar este perfil (borra sus datos de verdad, no se puede deshacer)'
      del.textContent = '✕'
      del.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm(`¿Borrar el perfil "${p.name}"? Se borra su historial, favoritos, cookies y todo lo demás. No se puede deshacer.`)) return
        const result = await mabrionaBrowser.deleteProfile(p.id)
        if (!result.ok) { alert(result.reason); return }
        refreshProfilePanel()
      })
      li.appendChild(del)
    }
    ul.appendChild(li)
  }
}

document.getElementById('profile-guest').addEventListener('click', () => { mabrionaBrowser.newGuestWindow(); togglePanel('profile') })
document.getElementById('profile-create').addEventListener('click', async () => {
  const input = document.getElementById('profile-new-name')
  const errorEl = document.getElementById('profile-create-error')
  const name = input.value.trim()
  errorEl.classList.add('hidden')
  if (!name) { errorEl.textContent = 'Ponele un nombre al perfil.'; errorEl.classList.remove('hidden'); return }
  const profile = await mabrionaBrowser.createProfile(name)
  input.value = ''
  await mabrionaBrowser.switchToProfile(profile.id)
  togglePanel('profile')
})

// ---------------- Extensiones — reales, mismo formato que Chrome/Edge/Brave ----------------

const ORIGIN_LABEL = { unpacked: 'Sin empaquetar', imported: 'Importada', webstore: 'Chrome Web Store' }

async function refreshExtensionsPanel() {
  const extensions = await mabrionaBrowser.listExtensions()
  const ul = document.getElementById('extensions-list')
  ul.innerHTML = ''
  if (extensions.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'Sin extensiones instaladas en este perfil todavía'
    ul.appendChild(li)
  }
  for (const ext of extensions) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="item-title">${escapeHtml(ext.name)} <span class="ext-version">v${escapeHtml(ext.version)}</span></span><span class="item-url">${ORIGIN_LABEL[ext.origin] || ext.origin}${ext.enabled ? '' : ' — desactivada'}</span>`
    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.className = 'ext-toggle'
    toggle.checked = !!ext.enabled
    toggle.title = ext.enabled ? 'Desactivar' : 'Activar'
    toggle.addEventListener('click', (e) => e.stopPropagation())
    toggle.addEventListener('change', async () => {
      await mabrionaBrowser.setExtensionEnabled(ext.recordId, toggle.checked)
      refreshExtensionsPanel()
    })
    li.appendChild(toggle)
    const del = document.createElement('button')
    del.className = 'item-delete'
    del.type = 'button'
    del.title = 'Quitar esta extensión'
    del.textContent = '✕'
    del.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`¿Quitar "${ext.name}"? No se puede deshacer.`)) return
      await mabrionaBrowser.removeExtension(ext.recordId)
      refreshExtensionsPanel()
    })
    li.appendChild(del)
    ul.appendChild(li)
  }
}

document.getElementById('ext-load-unpacked').addEventListener('click', async () => {
  const result = await mabrionaBrowser.loadUnpackedExtension()
  if (result.canceled) return
  if (!result.ok) { alert(`No se pudo cargar la extensión: ${result.error}`); return }
  refreshExtensionsPanel()
})

document.getElementById('ext-scan-browsers').addEventListener('click', async () => {
  const resultsList = document.getElementById('ext-scan-results')
  const btn = document.getElementById('ext-scan-browsers')
  btn.disabled = true
  const found = await mabrionaBrowser.scanOtherBrowsersForExtensions()
  btn.disabled = false
  resultsList.innerHTML = ''
  resultsList.classList.remove('hidden')
  if (found.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'No se encontró ningún navegador Chromium con extensiones instaladas en esta máquina'
    resultsList.appendChild(li)
    return
  }
  for (const item of found) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="item-title">${escapeHtml(item.name)} <span class="ext-version">v${escapeHtml(item.version)}</span></span><span class="item-url">${escapeHtml(item.browser)} — ${escapeHtml(item.profile)}</span>`
    li.addEventListener('click', async () => {
      const result = await mabrionaBrowser.importExtension(item.sourcePath)
      if (!result.ok) { alert(`No se pudo importar: ${result.error}`); return }
      resultsList.classList.add('hidden')
      refreshExtensionsPanel()
    })
    resultsList.appendChild(li)
  }
})

document.getElementById('ext-webstore-install').addEventListener('click', async () => {
  const input = document.getElementById('ext-webstore-input')
  const errorEl = document.getElementById('ext-webstore-error')
  const btn = document.getElementById('ext-webstore-install')
  errorEl.classList.add('hidden')
  if (!input.value.trim()) return
  btn.disabled = true
  const original = btn.textContent
  btn.textContent = 'Instalando…'
  const result = await mabrionaBrowser.installExtensionFromWebStore(input.value.trim())
  btn.disabled = false
  btn.textContent = original
  if (!result.ok) { errorEl.textContent = result.error; errorEl.classList.remove('hidden'); return }
  input.value = ''
  refreshExtensionsPanel()
})

// ---------------- Settings — solo capacidades reales, nada de switches decorativos ----------------

async function refreshSettingsPanel() {
  const dir = await mabrionaBrowser.getDownloadsDir()
  document.getElementById('settings-downloads-path').textContent = `Carpeta actual: ${dir}`
  const active = await mabrionaBrowser.getActiveProfile()
  document.getElementById('settings-active-profile').textContent = active ? `Perfil: ${active.emoji} ${active.name}` : ''
  document.getElementById('settings-restore-session').checked = await mabrionaBrowser.getRestoreSession()
  document.getElementById('settings-search-engine').value = await mabrionaBrowser.getSearchEngine()
  await refreshSettingsPermissions()
}
document.getElementById('settings-restore-session').addEventListener('change', (e) => {
  mabrionaBrowser.setRestoreSession(e.target.checked)
})
document.getElementById('settings-search-engine').addEventListener('change', (e) => {
  mabrionaBrowser.setSearchEngine(e.target.value)
})

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

// ---------------- Importar datos del navegador — real y local ----------------

let importIsFirstRun = false
let selectedImportSource = null

function showOnboardingStep(stepId) {
  document.querySelectorAll('.onboarding-step').forEach((el) => el.classList.add('hidden'))
  document.getElementById(stepId).classList.remove('hidden')
}

async function openOnboarding(firstRun) {
  importIsFirstRun = firstRun
  selectedImportSource = null
  closeAllPanels()
  document.getElementById('onboarding-overlay').classList.remove('hidden')
  showOnboardingStep('onboarding-step-welcome')

  const sourcesEl = document.getElementById('onboarding-sources')
  const noSourcesEl = document.getElementById('onboarding-no-sources')
  sourcesEl.innerHTML = ''
  noSourcesEl.classList.add('hidden')

  const sources = await mabrionaBrowser.scanImportSources()
  if (sources.length === 0) {
    noSourcesEl.classList.remove('hidden')
    return
  }
  for (const source of sources) {
    const detail = source.engine === 'chromium'
      ? [source.bookmarksPath ? 'Favoritos' : null, source.historyPath ? 'Historial' : null].filter(Boolean).join(' + ')
      : 'Favoritos + Historial'
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'onboarding-source-card'
    card.innerHTML = `<span><span class="os-name">${escapeHtml(source.browser)}</span><br /><span class="os-detail">${escapeHtml(source.profile)} — ${escapeHtml(detail)}</span></span><span>→</span>`
    card.addEventListener('click', () => {
      selectedImportSource = source
      document.getElementById('onboarding-source-label').textContent = `${source.browser} — ${source.profile}`
      const hasBookmarks = source.engine === 'firefox' || !!source.bookmarksPath
      const hasHistory = source.engine === 'firefox' || !!source.historyPath
      const bookmarksCheck = document.getElementById('onboarding-check-bookmarks')
      const historyCheck = document.getElementById('onboarding-check-history')
      bookmarksCheck.checked = hasBookmarks
      bookmarksCheck.disabled = !hasBookmarks
      historyCheck.checked = hasHistory
      historyCheck.disabled = !hasHistory
      showOnboardingStep('onboarding-step-data')
    })
    sourcesEl.appendChild(card)
  }
}

async function finishOnboarding() {
  if (importIsFirstRun) await mabrionaBrowser.setOnboardingCompleted()
  document.getElementById('onboarding-overlay').classList.add('hidden')
}

document.getElementById('onboarding-skip-1').addEventListener('click', finishOnboarding)
document.getElementById('onboarding-skip-2').addEventListener('click', finishOnboarding)
document.getElementById('onboarding-finish').addEventListener('click', finishOnboarding)
document.getElementById('onboarding-back').addEventListener('click', () => showOnboardingStep('onboarding-step-welcome'))

document.getElementById('onboarding-start-import').addEventListener('click', async () => {
  if (!selectedImportSource) return
  const importBookmarks = document.getElementById('onboarding-check-bookmarks').checked
  const importHistory = document.getElementById('onboarding-check-history').checked
  showOnboardingStep('onboarding-step-progress')
  const result = await mabrionaBrowser.runImport(selectedImportSource, importBookmarks, importHistory)
  const resultEl = document.getElementById('onboarding-result')
  if (result.error) {
    resultEl.textContent = `No se pudo importar: ${result.error}`
  } else {
    const parts = []
    if (importBookmarks) parts.push(`${result.favoritesImported} favorito${result.favoritesImported === 1 ? '' : 's'} nuevo${result.favoritesImported === 1 ? '' : 's'}`)
    if (importHistory) parts.push(`${result.historyImported} entrada${result.historyImported === 1 ? '' : 's'} de historial en total`)
    resultEl.textContent = parts.length > 0 ? `Importado: ${parts.join(' · ')}.` : 'No importaste nada — podés hacerlo cuando quieras desde Configuración.'
  }
  showOnboardingStep('onboarding-step-done')
})

document.getElementById('settings-import-data').addEventListener('click', () => openOnboarding(false))

mabrionaBrowser.getOnboardingStatus().then((status) => { if (status.show) openOnboarding(true) })

mabrionaBrowser.onTabsState(render)
mabrionaBrowser.onDownloadsState(() => {
  if (!document.getElementById('panel-downloads').classList.contains('hidden')) refreshDownloadsPanel()
})
mabrionaBrowser.getTabsState().then(render)
refreshProfileButton()

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
