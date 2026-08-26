'use strict'
/* global mabrionaBrowser */

const tabstrip = document.getElementById('tabstrip')
const newTabBtn = document.getElementById('btn-new-tab')
const address = document.getElementById('address')
const btnBack = document.getElementById('btn-back')
const btnForward = document.getElementById('btn-forward')
const btnReload = document.getElementById('btn-reload')
const btnFav = document.getElementById('btn-fav')
const shieldsCount = document.getElementById('shields-count')
document.body.classList.add(`platform-${mabrionaBrowser.platform}`)

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
  document.getElementById('icon-reload').classList.toggle('hidden', !!activeTab?.loading)
  document.getElementById('icon-stop').classList.toggle('hidden', !activeTab?.loading)
  shieldsCount.textContent = String(activeTab?.blockedCount ?? 0)
  document.body.classList.toggle('private-mode', !!activeTab?.isPrivate)
  if (!document.getElementById('panel-more').classList.contains('hidden')) refreshZoomLevel()

  if (activeTab) {
    mabrionaBrowser.isFavorite(activeTab.url).then((isFav) => {
      btnFav.classList.toggle('active', isFav)
    })
  }
}

/** Solo una página real (http/https) tiene sentido compartir o traducir — la pestaña nueva propia
 * de MABRIONA o la página de resultados interna no son "un sitio" que compartir. */
function isShareableUrl(url) {
  return !!url && /^https?:\/\//i.test(url)
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
  btnFav.classList.toggle('active', !isFav)
  refreshAllFavoritesUI()
})
async function captureScreenshotAction(button) {
  if (!activeTab) return
  button.disabled = true
  const original = button.textContent
  const result = await mabrionaBrowser.captureScreenshot(activeTab.id)
  button.textContent = result.ok ? '✅ Capturado' : '⚠️ Error'
  button.title = result.ok ? `Guardada en ${result.path}` : `No se pudo capturar — ${result.error}`
  setTimeout(() => { button.textContent = original; button.disabled = false }, 1200)
}

// ---------------- Paneles (historial / favoritos / descargas / shields / compartir / traducir) ----------------

const panels = ['history', 'favorites', 'downloads', 'shields', 'settings', 'more', 'profile', 'extensions', 'share', 'translate']
// Solo estos paneles tienen su propio ícono siempre visible en la barra — se "prenden" (misma
// idea que los botones de mando de DJ IA) mientras su panel está abierto.
const PANEL_TRIGGER_BTN = { more: 'btn-more', profile: 'btn-profile', share: 'btn-share', translate: 'btn-translate' }
function closeAllPanels() {
  for (const name of panels) document.getElementById(`panel-${name}`).classList.add('hidden')
  for (const btnId of Object.values(PANEL_TRIGGER_BTN)) document.getElementById(btnId).classList.remove('active')
}
function togglePanel(name) {
  const el = document.getElementById(`panel-${name}`)
  const wasHidden = el.classList.contains('hidden')
  closeAllPanels()
  if (wasHidden) {
    el.classList.remove('hidden')
    const btnId = PANEL_TRIGGER_BTN[name]
    if (btnId) document.getElementById(btnId).classList.add('active')
  }
}

// Solo quedan como ícono siempre visible en la barra: atrás/adelante/recargar, favorito, compartir,
// traducir, perfil, y "Más opciones" con todo lo demás adentro — a pedido explícito, para no
// abrumar con íconos que casi no se usan a diario.
document.getElementById('btn-more').addEventListener('click', () => { togglePanel('more'); refreshZoomLevel() })
document.getElementById('btn-profile').addEventListener('click', () => { togglePanel('profile'); refreshProfilePanel() })
document.querySelectorAll('.panel-close').forEach((btn) => btn.addEventListener('click', (e) => {
  const name = e.target.dataset.close
  document.getElementById(`panel-${name}`).classList.add('hidden')
  const btnId = PANEL_TRIGGER_BTN[name]
  if (btnId) document.getElementById(btnId).classList.remove('active')
}))

// Panel "Más opciones" — todo lo que antes eran íconos sueltos en la barra vive acá ahora.
document.getElementById('more-screenshot').addEventListener('click', () => captureScreenshotAction(document.getElementById('more-screenshot')))
document.getElementById('more-shields').addEventListener('click', () => { togglePanel('shields'); refreshShieldsPanel() })
document.getElementById('more-history').addEventListener('click', () => { togglePanel('history'); refreshHistoryPanel() })
document.getElementById('more-downloads').addEventListener('click', () => { togglePanel('downloads'); refreshDownloadsPanel() })
document.getElementById('more-favorites').addEventListener('click', () => { togglePanel('favorites'); refreshFavoritesPanel() })
document.getElementById('more-extensions').addEventListener('click', () => { togglePanel('extensions'); refreshExtensionsPanel() })
document.getElementById('more-settings').addEventListener('click', () => { togglePanel('settings'); refreshSettingsPanel() })

// Ventanas reales (Electron nativo) y pestaña privada real (sesión en memoria, ver main.js).
document.getElementById('menu-new-window').addEventListener('click', () => { mabrionaBrowser.newWindow(); togglePanel('more') })
document.getElementById('menu-new-private').addEventListener('click', () => { mabrionaBrowser.createPrivateTab(); togglePanel('more') })

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
  await loadFavoritesData()
  renderFavoritesPanelList()
}
function renderFavoritesPanelList() {
  const ul = document.getElementById('favorites-list')
  ul.innerHTML = ''
  const folders = childFolders(null)
  const favorites = childFavorites(null)
  if (folders.length === 0 && favorites.length === 0) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = 'Sin favoritos todavía'
    ul.appendChild(li)
    return
  }
  for (const folder of folders) {
    const li = document.createElement('li')
    li.className = 'fav-panel-group-label'
    li.textContent = `📁 ${folder.name}`
    li.addEventListener('click', () => { togglePanel('favorites'); openBookmarksManager(folder.id) })
    ul.appendChild(li)
  }
  for (const item of favorites) {
    const li = document.createElement('li')
    li.innerHTML = `<span class="item-title">${escapeHtml(item.title || item.url)}</span><span class="item-url">${escapeHtml(item.url)}</span>`
    li.addEventListener('click', () => { if (activeTab) mabrionaBrowser.navigate(activeTab.id, item.url) })
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); openFavoriteContextMenu(e.clientX, e.clientY, item) })
    ul.appendChild(li)
  }
}
document.getElementById('favorites-open-manager').addEventListener('click', () => { togglePanel('favorites'); openBookmarksManager(null) })
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

// ---------------- Compartir real: copiar link + código QR (100% local) ----------------

document.getElementById('btn-share').addEventListener('click', async () => {
  togglePanel('share')
  if (document.getElementById('panel-share').classList.contains('hidden')) return
  const shareable = isShareableUrl(activeTab?.url)
  document.getElementById('share-controls').classList.toggle('hidden', !shareable)
  document.getElementById('share-not-shareable').classList.toggle('hidden', shareable)
  if (!shareable) return
  document.getElementById('share-url-note').textContent = activeTab.url
  document.getElementById('share-copy').textContent = '🔗 Copiar link'
  const qrDataUrl = await mabrionaBrowser.generateQrCode(activeTab.url)
  document.getElementById('share-qr-img').src = qrDataUrl || ''
})
document.getElementById('share-copy').addEventListener('click', async () => {
  if (!isShareableUrl(activeTab?.url)) return
  await mabrionaBrowser.copyText(activeTab.url)
  const btn = document.getElementById('share-copy')
  btn.textContent = '✅ Copiado'
  setTimeout(() => { btn.textContent = '🔗 Copiar link' }, 1200)
})

// ---------------- Traducir real (DeepL) — nodo de texto por nodo de texto, sin tocar scripts ----------------

let translateLanguagesLoaded = false
async function ensureTranslateLanguages() {
  if (translateLanguagesLoaded) return
  const languages = await mabrionaBrowser.getTranslateLanguages()
  const select = document.getElementById('translate-lang')
  select.innerHTML = ''
  for (const lang of languages) {
    const option = document.createElement('option')
    option.value = lang.code
    option.textContent = lang.name
    if (lang.code === 'ES') option.selected = true
    select.appendChild(option)
  }
  translateLanguagesLoaded = true
}

document.getElementById('btn-translate').addEventListener('click', async () => {
  togglePanel('translate')
  if (document.getElementById('panel-translate').classList.contains('hidden')) return
  document.getElementById('translate-status').textContent = ''
  document.getElementById('translate-restore').classList.add('hidden')
  const shareable = isShareableUrl(activeTab?.url)
  document.getElementById('translate-not-shareable').classList.toggle('hidden', shareable)
  document.getElementById('translate-not-configured').classList.add('hidden')
  document.getElementById('translate-controls').classList.toggle('hidden', !shareable)
  if (!shareable) return
  await ensureTranslateLanguages()
  const configured = await mabrionaBrowser.getTranslateConfigured()
  document.getElementById('translate-not-configured').classList.toggle('hidden', configured)
  document.getElementById('translate-controls').classList.toggle('hidden', !configured)
})
document.getElementById('translate-go').addEventListener('click', async () => {
  if (!isShareableUrl(activeTab?.url)) return
  const btn = document.getElementById('translate-go')
  const statusEl = document.getElementById('translate-status')
  const targetLang = document.getElementById('translate-lang').value
  btn.disabled = true
  statusEl.textContent = 'Traduciendo…'
  const result = await mabrionaBrowser.translatePage(targetLang)
  btn.disabled = false
  if (!result.configured) {
    statusEl.textContent = 'El traductor no está configurado en esta instalación.'
  } else if (result.error) {
    statusEl.textContent = `No se pudo traducir: ${result.error}`
  } else if (result.translatedCount === 0) {
    statusEl.textContent = 'No encontramos texto real para traducir en esta página.'
  } else {
    statusEl.textContent = `Traducido (${result.translatedCount} fragmentos de texto real)${result.truncated ? ' — la página es muy larga, se tradujo una parte' : ''}.`
    document.getElementById('translate-restore').classList.remove('hidden')
  }
})
document.getElementById('translate-restore').addEventListener('click', () => {
  if (!activeTab) return
  mabrionaBrowser.reload(activeTab.id)
  togglePanel('translate')
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
  refreshAllFavoritesUI()
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

// ---------------- Reemplazo real de window.prompt() — Electron no lo implementa (excepción real
// verificada: "prompt() is and will not be supported"). alert()/confirm() sí funcionan (dialogo
// nativo real) y se siguen usando tal cual en el resto del archivo. ----------------

function showTextPrompt(label, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('text-prompt-overlay')
    const input = document.getElementById('text-prompt-input')
    const okBtn = document.getElementById('text-prompt-ok')
    const cancelBtn = document.getElementById('text-prompt-cancel')
    document.getElementById('text-prompt-label').textContent = label
    input.value = defaultValue
    overlay.classList.remove('hidden')
    input.focus()
    input.select()
    function cleanup(result) {
      overlay.classList.add('hidden')
      okBtn.removeEventListener('click', onOk)
      cancelBtn.removeEventListener('click', onCancel)
      input.removeEventListener('keydown', onKeydown)
      resolve(result)
    }
    function onOk() { cleanup(input.value) }
    function onCancel() { cleanup(null) }
    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); onOk() }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    okBtn.addEventListener('click', onOk)
    cancelBtn.addEventListener('click', onCancel)
    input.addEventListener('keydown', onKeydown)
  })
}

// ---------------- Favoritos: barra real + gestor profesional (carpetas reales por id) ----------------

let foldersCache = []
let favoritesCache = []

function favSortValue(item) { return typeof item.order === 'number' ? item.order : Number.MAX_SAFE_INTEGER }
function sortItems(items) {
  return [...items].sort((a, b) => favSortValue(a) - favSortValue(b) || String(a.name || a.title || '').localeCompare(String(b.name || b.title || '')))
}
function childFolders(parentId) { return sortItems(foldersCache.filter((f) => (f.parentId || null) === (parentId || null))) }
function childFavorites(folderId) { return sortItems(favoritesCache.filter((f) => (f.folderId || null) === (folderId || null))) }
function folderById(id) { return foldersCache.find((f) => f.id === id) || null }

async function loadFavoritesData() {
  ;[foldersCache, favoritesCache] = await Promise.all([mabrionaBrowser.listFolders(), mabrionaBrowser.listFavorites()])
}

async function refreshAllFavoritesUI() {
  await loadFavoritesData()
  renderFavoritesBar()
  if (!document.getElementById('panel-favorites').classList.contains('hidden')) renderFavoritesPanelList()
  if (!document.getElementById('bookmarks-manager-overlay').classList.contains('hidden')) renderBookmarksManager()
}

// ---- Arrastrar y soltar real (HTML5 DnD) — reutilizado por la barra, el desplegable y el gestor ----

function readDragPayload(e) {
  try { return JSON.parse(e.dataTransfer.getData('application/json')) } catch { return null }
}
function makeDraggable(el, payload) {
  el.draggable = true
  el.addEventListener('dragstart', (e) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/json', JSON.stringify(payload))
    el.classList.add('dragging')
  })
  el.addEventListener('dragend', () => el.classList.remove('dragging'))
}
/** Soltar acá = mover el favorito/carpeta arrastrado ADENTRO de `targetFolderId` (o al nivel
 * superior si es null). Se usa en carpetas y en fondos de contenedor. */
function makeDropTargetMoveInto(el, targetFolderId) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drag-over') })
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'))
  el.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    el.classList.remove('drag-over')
    await moveDraggedTo(readDragPayload(e), targetFolderId)
  })
}
/** Soltar acá = reordenar el arrastrado junto a `targetId` dentro de la MISMA lista real de
 * hermanos (mismo tipo, mismo padre) que devuelve `siblingsProvider()`. */
function makeDropTargetReorder(el, siblingsProvider, targetId) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drag-over') })
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'))
  el.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    el.classList.remove('drag-over')
    await reorderAfterDrop(readDragPayload(e), siblingsProvider(), targetId)
  })
}
async function moveDraggedTo(payload, targetFolderId) {
  if (!payload) return
  if (payload.type === 'favorite') await mabrionaBrowser.moveFavorite(payload.id, targetFolderId)
  else if (payload.type === 'folder' && payload.id !== targetFolderId) await mabrionaBrowser.moveFolder(payload.id, targetFolderId)
  await refreshAllFavoritesUI()
}
async function reorderAfterDrop(payload, siblingsBeforeMove, targetId) {
  if (!payload) return
  const matchId = (it) => (payload.type === 'favorite' ? it.url : it.id)
  const draggedItem = siblingsBeforeMove.find((it) => matchId(it) === payload.id)
  if (!draggedItem) return // el arrastrado no es del mismo tipo/lista real que el destino — no hacer nada
  const list = siblingsBeforeMove.filter((it) => matchId(it) !== payload.id)
  const targetIndex = list.findIndex((it) => matchId(it) === targetId)
  list.splice(targetIndex === -1 ? list.length : targetIndex, 0, draggedItem)
  for (let i = 0; i < list.length; i++) {
    if (payload.type === 'favorite') await mabrionaBrowser.reorderFavorite(list[i].url, i)
    else await mabrionaBrowser.reorderFolder(list[i].id, i)
  }
  await refreshAllFavoritesUI()
}

// ---- Menú contextual real (clic derecho) — favoritos y carpetas, en la barra y en el gestor ----

const contextMenuEl = document.getElementById('context-menu')
function closeContextMenu() { contextMenuEl.classList.add('hidden'); contextMenuEl.innerHTML = '' }
function openContextMenuAt(x, y, buildFn) {
  contextMenuEl.innerHTML = ''
  buildFn(contextMenuEl)
  contextMenuEl.classList.remove('hidden')
  const rect = contextMenuEl.getBoundingClientRect()
  const maxX = window.innerWidth - rect.width - 8
  const maxY = window.innerHeight - rect.height - 8
  contextMenuEl.style.left = `${Math.max(8, Math.min(x, maxX))}px`
  contextMenuEl.style.top = `${Math.max(8, Math.min(y, maxY))}px`
}
function addMenuButton(parent, label, onClick, opts = {}) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  if (opts.danger) btn.classList.add('danger')
  btn.addEventListener('click', (e) => { e.stopPropagation(); closeContextMenu(); onClick() })
  parent.appendChild(btn)
  return btn
}
function addMenuDivider(parent) { parent.appendChild(document.createElement('hr')) }
document.addEventListener('click', (e) => { if (!contextMenuEl.contains(e.target)) closeContextMenu() })
document.addEventListener('contextmenu', (e) => { if (!e.defaultPrevented) closeContextMenu() })
window.addEventListener('blur', closeContextMenu)
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu() }, true)

function flattenFoldersForPicker(excludeId) {
  const result = []
  function walk(parentId, depth) {
    for (const f of childFolders(parentId)) {
      if (f.id !== excludeId) result.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
}
function openMoveToMenu(x, y, { excludeFolderId, onPick }) {
  openContextMenuAt(x, y, (menu) => {
    const label = document.createElement('div')
    label.className = 'cm-label'
    label.textContent = 'Mover a'
    menu.appendChild(label)
    addMenuButton(menu, '🔖 Nivel superior', () => onPick(null))
    const list = flattenFoldersForPicker(excludeFolderId)
    if (list.length > 0) addMenuDivider(menu)
    for (const { folder, depth } of list) addMenuButton(menu, `${'　'.repeat(depth)}📁 ${folder.name}`, () => onPick(folder.id))
  })
}

async function editFavoritePrompt(fav) {
  const newTitle = await showTextPrompt('Título del favorito', fav.title || '')
  if (newTitle === null) return
  if (newTitle.trim() && newTitle.trim() !== fav.title) await mabrionaBrowser.renameFavorite(fav.url, newTitle.trim())
  const newUrl = await showTextPrompt('URL del favorito', fav.url)
  if (newUrl !== null && newUrl.trim() && newUrl.trim() !== fav.url) {
    const ok = await mabrionaBrowser.updateFavoriteUrl(fav.url, newUrl.trim())
    if (!ok) alert('Esa URL no es válida, o ya la usa otro favorito.')
  }
  await refreshAllFavoritesUI()
}

function openFavoriteContextMenu(x, y, fav) {
  openContextMenuAt(x, y, (menu) => {
    addMenuButton(menu, '↗ Abrir', () => { if (activeTab) mabrionaBrowser.navigate(activeTab.id, fav.url) })
    addMenuButton(menu, '＋ Abrir en nueva pestaña', () => mabrionaBrowser.createTab(fav.url))
    addMenuButton(menu, '🪟 Abrir en nueva ventana', () => mabrionaBrowser.newWindow(fav.url))
    addMenuDivider(menu)
    addMenuButton(menu, '✎ Editar', () => editFavoritePrompt(fav))
    addMenuButton(menu, '➜ Mover a…', () => {
      openMoveToMenu(x, y, { onPick: async (folderId) => { await mabrionaBrowser.moveFavorite(fav.url, folderId); await refreshAllFavoritesUI() } })
    })
    addMenuDivider(menu)
    addMenuButton(menu, '🗑 Eliminar', async () => {
      if (!confirm(`¿Eliminar "${fav.title || fav.url}" de favoritos?`)) return
      await mabrionaBrowser.removeFavorite(fav.url)
      await refreshAllFavoritesUI()
    }, { danger: true })
  })
}

function openAllInFolder(folderId) {
  const favs = childFavorites(folderId)
  if (favs.length === 0) return
  if (favs.length > 8 && !confirm(`¿Abrir ${favs.length} pestañas nuevas?`)) return
  for (const fav of favs) mabrionaBrowser.createTab(fav.url)
}

function openFolderContextMenu(x, y, folder) {
  openContextMenuAt(x, y, (menu) => {
    addMenuButton(menu, '↗ Abrir todos', () => openAllInFolder(folder.id))
    addMenuDivider(menu)
    addMenuButton(menu, '📁 Nueva subcarpeta', async () => {
      const name = await showTextPrompt('Nombre de la subcarpeta', '')
      if (!name || !name.trim()) return
      await mabrionaBrowser.createFolder(name.trim(), folder.id)
      await refreshAllFavoritesUI()
    })
    addMenuButton(menu, '✎ Renombrar', async () => {
      const name = await showTextPrompt('Nuevo nombre de la carpeta', folder.name)
      if (!name || !name.trim()) return
      await mabrionaBrowser.renameFolder(folder.id, name.trim())
      await refreshAllFavoritesUI()
    })
    addMenuButton(menu, '➜ Mover a…', () => {
      openMoveToMenu(x, y, {
        excludeFolderId: folder.id,
        onPick: async (targetId) => {
          const ok = await mabrionaBrowser.moveFolder(folder.id, targetId)
          if (!ok) alert('No se puede mover una carpeta adentro de sí misma o de una de sus propias subcarpetas.')
          await refreshAllFavoritesUI()
        },
      })
    })
    addMenuDivider(menu)
    addMenuButton(menu, '🗑 Eliminar', async () => {
      if (!confirm(`¿Eliminar la carpeta "${folder.name}"? Lo que tenga adentro sube al nivel de arriba — no se borra nada más.`)) return
      await mabrionaBrowser.deleteFolder(folder.id)
      await refreshAllFavoritesUI()
    }, { danger: true })
  })
}

// ---- Barra de favoritos real, en la barra de herramientas ----

function closeAllFavDropdowns(exceptEl) {
  document.querySelectorAll('.fav-bar-dropdown').forEach((el) => { if (el !== exceptEl) el.classList.add('hidden') })
}
document.addEventListener('click', () => closeAllFavDropdowns())

function buildFavBarNode(kind, item, { nested } = {}) {
  if (kind === 'favorite') {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = nested ? 'fbd-item' : 'fav-bar-item'
    btn.innerHTML = `<span>🔖 ${escapeHtml(item.title || item.url)}</span>`
    btn.title = item.url
    btn.addEventListener('click', () => {
      closeAllFavDropdowns()
      if (activeTab) mabrionaBrowser.navigate(activeTab.id, item.url)
    })
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openFavoriteContextMenu(e.clientX, e.clientY, item) })
    makeDraggable(btn, { type: 'favorite', id: item.url })
    makeDropTargetReorder(btn, () => childFavorites(item.folderId || null), item.url)
    return btn
  }
  const wrap = document.createElement('div')
  wrap.className = nested ? 'fbd-folder' : 'fav-bar-folder'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = nested ? 'fbd-folder-btn' : 'fav-bar-folder-btn'
  btn.innerHTML = `<span>📁 ${escapeHtml(item.name)}</span>`
  btn.title = item.name
  const dropdown = document.createElement('div')
  dropdown.className = 'fav-bar-dropdown hidden'
  const subFolders = childFolders(item.id)
  const subFavorites = childFavorites(item.id)
  if (subFolders.length === 0 && subFavorites.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'fbd-empty'
    empty.textContent = 'Vacía'
    dropdown.appendChild(empty)
  } else {
    for (const f of subFolders) dropdown.appendChild(buildFavBarNode('folder', f, { nested: true }))
    for (const fav of subFavorites) dropdown.appendChild(buildFavBarNode('favorite', fav, { nested: true }))
  }
  makeDropTargetMoveInto(dropdown, item.id)
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const willOpen = dropdown.classList.contains('hidden')
    closeAllFavDropdowns(willOpen ? dropdown : null)
    dropdown.classList.toggle('hidden', !willOpen)
  })
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openFolderContextMenu(e.clientX, e.clientY, item) })
  makeDraggable(btn, { type: 'folder', id: item.id })
  makeDropTargetMoveInto(btn, item.id)
  wrap.appendChild(btn)
  wrap.appendChild(dropdown)
  return wrap
}

function renderFavoritesBar() {
  const container = document.getElementById('favorites-bar-items')
  container.innerHTML = ''
  for (const f of childFolders(null)) container.appendChild(buildFavBarNode('folder', f))
  for (const fav of childFavorites(null)) container.appendChild(buildFavBarNode('favorite', fav))
}
makeDropTargetMoveInto(document.getElementById('favorites-bar'), null)
document.getElementById('btn-manage-favorites').addEventListener('click', (e) => { e.stopPropagation(); openBookmarksManager(null) })

// ---- Gestor profesional de favoritos — pantalla completa, carpetas reales ----

let bmCurrentFolderId = null
let bmSearch = ''
let bmSortMode = 'manual'

function openBookmarksManager(initialFolderId) {
  bmCurrentFolderId = initialFolderId || null
  bmSearch = ''
  document.getElementById('bm-search').value = ''
  document.getElementById('bm-sort').value = bmSortMode
  closeAllPanels()
  closeContextMenu()
  document.getElementById('bookmarks-manager-overlay').classList.remove('hidden')
  loadFavoritesData().then(renderBookmarksManager)
}
function closeBookmarksManager() {
  document.getElementById('bookmarks-manager-overlay').classList.add('hidden')
}
document.getElementById('bm-close').addEventListener('click', closeBookmarksManager)

function renderBookmarksManager() {
  renderBmTree()
  renderBmBreadcrumb()
  renderBmItems()
}

function buildTreeLevel(container, parentId) {
  for (const folder of childFolders(parentId)) {
    const node = document.createElement('div')
    node.className = 'bm-tree-node'
    const row = document.createElement('div')
    row.className = 'bm-tree-row' + (bmCurrentFolderId === folder.id ? ' active' : '')
    row.textContent = `📁 ${folder.name}`
    row.title = folder.name
    row.addEventListener('click', () => { bmCurrentFolderId = folder.id; renderBookmarksManager() })
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openFolderContextMenu(e.clientX, e.clientY, folder) })
    makeDraggable(row, { type: 'folder', id: folder.id })
    makeDropTargetMoveInto(row, folder.id)
    node.appendChild(row)
    const childrenWrap = document.createElement('div')
    childrenWrap.className = 'bm-tree-children'
    node.appendChild(childrenWrap)
    buildTreeLevel(childrenWrap, folder.id)
    container.appendChild(node)
  }
}
function renderBmTree() {
  const root = document.getElementById('bm-tree')
  root.innerHTML = ''
  const rootRow = document.createElement('div')
  rootRow.className = 'bm-tree-row' + (bmCurrentFolderId === null ? ' active' : '')
  rootRow.textContent = '🔖 Favoritos'
  rootRow.addEventListener('click', () => { bmCurrentFolderId = null; renderBookmarksManager() })
  makeDropTargetMoveInto(rootRow, null)
  root.appendChild(rootRow)
  const childrenWrap = document.createElement('div')
  root.appendChild(childrenWrap)
  buildTreeLevel(childrenWrap, null)
}

function renderBmBreadcrumb() {
  const el = document.getElementById('bm-breadcrumb')
  el.innerHTML = ''
  const chain = []
  let current = bmCurrentFolderId ? folderById(bmCurrentFolderId) : null
  while (current) { chain.unshift(current); current = current.parentId ? folderById(current.parentId) : null }
  const rootBtn = document.createElement('button')
  rootBtn.type = 'button'
  rootBtn.textContent = 'Favoritos'
  rootBtn.addEventListener('click', () => { bmCurrentFolderId = null; renderBookmarksManager() })
  el.appendChild(rootBtn)
  for (const folder of chain) {
    const sep = document.createElement('span')
    sep.textContent = ' / '
    el.appendChild(sep)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = folder.name
    btn.addEventListener('click', () => { bmCurrentFolderId = folder.id; renderBookmarksManager() })
    el.appendChild(btn)
  }
}

function folderPathLabel(folderId) {
  const parts = []
  let current = folderId ? folderById(folderId) : null
  while (current) { parts.unshift(current.name); current = current.parentId ? folderById(current.parentId) : null }
  return parts.length ? parts.join('/') : 'Favoritos'
}

function applySortMode(items, isFolder) {
  if (bmSortMode !== 'name') return items // orden manual real — ya viene ordenado por el campo `order`
  return [...items].sort((a, b) => String(isFolder ? a.name : (a.title || a.url)).localeCompare(String(isFolder ? b.name : (b.title || b.url))))
}

function buildBmFolderRow(folder) {
  const li = document.createElement('li')
  li.className = 'bm-item'
  li.innerHTML = `<span class="bm-item-icon">📁</span><span class="bm-item-text"><span class="bm-item-title">${escapeHtml(folder.name)}</span></span>`
  li.addEventListener('click', () => { bmCurrentFolderId = folder.id; renderBookmarksManager() })
  li.addEventListener('contextmenu', (e) => { e.preventDefault(); openFolderContextMenu(e.clientX, e.clientY, folder) })
  const more = document.createElement('button')
  more.className = 'bm-item-more'
  more.type = 'button'
  more.textContent = '⋯'
  more.title = 'Más opciones'
  more.addEventListener('click', (e) => { e.stopPropagation(); openFolderContextMenu(e.clientX, e.clientY, folder) })
  li.appendChild(more)
  makeDraggable(li, { type: 'folder', id: folder.id })
  makeDropTargetMoveInto(li, folder.id)
  return li
}
function buildBmFavoriteRow(fav, { showPath } = {}) {
  const li = document.createElement('li')
  li.className = 'bm-item'
  const pathLabel = showPath ? folderPathLabel(fav.folderId) : null
  const urlLine = pathLabel ? `${pathLabel} · ${fav.url}` : fav.url
  li.innerHTML = `<span class="bm-item-icon">🔖</span><span class="bm-item-text"><span class="bm-item-title">${escapeHtml(fav.title || fav.url)}</span><span class="bm-item-url">${escapeHtml(urlLine)}</span></span>`
  li.addEventListener('click', () => { if (activeTab) mabrionaBrowser.navigate(activeTab.id, fav.url); closeBookmarksManager() })
  li.addEventListener('contextmenu', (e) => { e.preventDefault(); openFavoriteContextMenu(e.clientX, e.clientY, fav) })
  const more = document.createElement('button')
  more.className = 'bm-item-more'
  more.type = 'button'
  more.textContent = '⋯'
  more.title = 'Más opciones'
  more.addEventListener('click', (e) => { e.stopPropagation(); openFavoriteContextMenu(e.clientX, e.clientY, fav) })
  li.appendChild(more)
  makeDraggable(li, { type: 'favorite', id: fav.url })
  makeDropTargetReorder(li, () => childFavorites(fav.folderId || null), fav.url)
  return li
}

function renderBmItems() {
  const ul = document.getElementById('bm-items')
  ul.innerHTML = ''
  const query = bmSearch.trim().toLowerCase()

  if (query) {
    const matches = favoritesCache.filter((f) => (f.title || '').toLowerCase().includes(query) || f.url.toLowerCase().includes(query))
    if (matches.length === 0) { ul.innerHTML = '<li class="bm-empty">Sin resultados</li>'; return }
    for (const fav of applySortMode(matches, false)) ul.appendChild(buildBmFavoriteRow(fav, { showPath: true }))
    return
  }

  const folders = applySortMode(childFolders(bmCurrentFolderId), true)
  const favorites = applySortMode(childFavorites(bmCurrentFolderId), false)
  if (folders.length === 0 && favorites.length === 0) { ul.innerHTML = '<li class="bm-empty">Esta carpeta está vacía</li>'; return }
  for (const folder of folders) ul.appendChild(buildBmFolderRow(folder))
  for (const fav of favorites) ul.appendChild(buildBmFavoriteRow(fav))
}

// Fondo de la lista de items del gestor — soltar acá mueve al nivel actualmente abierto
// (bmCurrentFolderId cambia con la navegación, por eso se lee en vivo y no se fija al registrar).
const bmItemsEl = document.getElementById('bm-items')
bmItemsEl.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' })
bmItemsEl.addEventListener('drop', async (e) => { e.preventDefault(); await moveDraggedTo(readDragPayload(e), bmCurrentFolderId) })

document.getElementById('bm-search').addEventListener('input', (e) => { bmSearch = e.target.value; renderBmItems() })
document.getElementById('bm-sort').addEventListener('change', (e) => { bmSortMode = e.target.value; renderBmItems() })
document.getElementById('bm-new-folder').addEventListener('click', async () => {
  const name = await showTextPrompt('Nombre de la carpeta nueva', '')
  if (!name || !name.trim()) return
  await mabrionaBrowser.createFolder(name.trim(), bmCurrentFolderId)
  await loadFavoritesData()
  renderBookmarksManager()
})

refreshAllFavoritesUI()

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
  else if (e.key === 'Escape' && !document.getElementById('bookmarks-manager-overlay').classList.contains('hidden')) closeBookmarksManager()
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
