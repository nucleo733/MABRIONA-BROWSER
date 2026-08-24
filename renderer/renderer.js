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

let currentTabs = []
let activeTab = null

function render(tabsState) {
  currentTabs = tabsState
  activeTab = tabsState.find((t) => t.isActive) || null

  tabstrip.querySelectorAll('.tab').forEach((el) => el.remove())
  for (const tab of tabsState) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.isActive ? ' active' : '')
    el.setAttribute('role', 'tab')
    el.setAttribute('aria-selected', String(tab.isActive))
    el.innerHTML = `<span class="tab-title">${escapeHtml(tab.title)}</span><span class="tab-close" data-close-tab="${tab.id}">✕</span>`
    el.addEventListener('click', (e) => {
      if (e.target.dataset.closeTab) return
      mabrionaBrowser.switchTab(tab.id)
    })
    tabstrip.insertBefore(el, newTabBtn)
  }
  tabstrip.querySelectorAll('[data-close-tab]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      mabrionaBrowser.closeTab(Number(e.target.dataset.closeTab))
    })
  })

  if (activeTab && document.activeElement !== address) {
    const isHome = activeTab.url === 'about:blank' || activeTab.url.endsWith('/renderer/newtab.html')
    address.value = isHome ? '' : activeTab.url
  }
  btnBack.disabled = !activeTab?.canGoBack
  btnForward.disabled = !activeTab?.canGoForward
  btnReload.textContent = activeTab?.loading ? '✕' : '⟳'
  shieldsCount.textContent = String(activeTab?.blockedCount ?? 0)

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

// ---------------- Paneles (historial / favoritos / descargas / shields) ----------------

const panels = ['history', 'favorites', 'downloads', 'shields']
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
document.querySelectorAll('.panel-close').forEach((btn) => btn.addEventListener('click', (e) => {
  document.getElementById(`panel-${e.target.dataset.close}`).classList.add('hidden')
}))
document.querySelector('[data-clear="history"]').addEventListener('click', async () => {
  await mabrionaBrowser.clearHistory()
  refreshHistoryPanel()
})

function renderList(ulId, items, emptyLabel, onClick) {
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
    ul.appendChild(li)
  }
}

async function refreshHistoryPanel() {
  const history = await mabrionaBrowser.listHistory()
  renderList('history-list', history, 'Sin historial todavía', (item) => {
    if (activeTab) mabrionaBrowser.navigate(activeTab.id, item.url)
  })
}
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

mabrionaBrowser.onTabsState(render)
mabrionaBrowser.onDownloadsState(() => {
  if (!document.getElementById('panel-downloads').classList.contains('hidden')) refreshDownloadsPanel()
})
mabrionaBrowser.getTabsState().then(render)
