'use strict'

const { app, BrowserWindow, BrowserView, ipcMain, session, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { createStore } = require('./store')
const { isBlockedHost } = require('./shields/blocklist')
const { resolveAddressInput, HOME_URL } = require('./address-resolver')
const { buildRequest, normalizeResults } = require('./search/braveSearch')

const TOOLBAR_HEIGHT = 118

const store = createStore(path.join(app.getPath('userData'), 'mabriona-browser-data.json'))

// Red de seguridad: un error inesperado en un solo callback (ej. una pestaña cerrándose en un
// mal momento) no debe tumbar toda la ventana del navegador — se registra y sigue.
process.on('uncaughtException', (err) => {
  console.error('[MABRIONA Browser] error no manejado:', err)
})

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {Map<number, { view: BrowserView, id: number, title: string, url: string, blockedCount: number }>} */
const tabs = new Map()
let activeTabId = null
let nextTabId = 1

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function serializeTab(tab) {
  const wc = tab.view && tab.view.webContents
  // El webContents puede no estar listo todavía (arranque) o ya estar destruido (pestaña
  // cerrándose justo en este instante) — nunca crashear la app entera por una foto de estado.
  if (!wc || wc.isDestroyed()) {
    return { id: tab.id, title: tab.title || 'Nueva pestaña', url: tab.url, loading: false, canGoBack: false, canGoForward: false, blockedCount: tab.blockedCount, isActive: tab.id === activeTabId }
  }
  return {
    id: tab.id,
    title: tab.title || 'Nueva pestaña',
    url: tab.url,
    loading: wc.isLoading(),
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    blockedCount: tab.blockedCount,
    isActive: tab.id === activeTabId,
  }
}

function broadcastTabs() {
  sendToRenderer('tabs:state', Array.from(tabs.values()).map(serializeTab))
}

function layoutActiveView() {
  if (!mainWindow) return
  const active = activeTabId != null ? tabs.get(activeTabId) : null
  if (!active) return
  const [w, h] = mainWindow.getContentSize()
  active.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: Math.max(0, h - TOOLBAR_HEIGHT) })
}

function createTab(initialUrl) {
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: 'persist:mabriona-browser',
      // Solo expone `window.mabrionaSearch.query(...)` (ver search-preload.js) — la página de
      // resultados propia lo usa para pedir resultados sin tocar ninguna API key directamente.
      // Inofensivo en cualquier otro sitio: contextBridge no le da nada a la página, la key nunca
      // sale del proceso principal.
      preload: path.join(__dirname, 'search-preload.js'),
    },
  })
  const id = nextTabId++
  const tab = { view, id, title: 'Nueva pestaña', url: initialUrl, blockedCount: 0 }
  tabs.set(id, tab)

  const wc = view.webContents
  wc.on('did-start-loading', broadcastTabs)
  wc.on('did-stop-loading', () => {
    broadcastTabs()
    if (tab.id === activeTabId) {
      const url = wc.getURL()
      if (url && url !== 'about:blank' && url !== HOME_URL) {
        store.addHistoryEntry({ url, title: tab.title, visitedAt: Date.now() })
      }
    }
  })
  wc.on('did-navigate', (_e, url) => { tab.url = url; broadcastTabs() })
  wc.on('did-navigate-in-page', (_e, url) => { tab.url = url; broadcastTabs() })
  wc.on('page-title-updated', (_e, title) => { tab.title = title; broadcastTabs() })
  wc.on('found-in-page', (_e, result) => {
    sendToRenderer('find:result', { tabId: tab.id, activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches })
  })

  wc.setWindowOpenHandler(({ url }) => {
    createAndSwitchTab(url)
    return { action: 'deny' }
  })

  view.webContents.loadURL(initialUrl)
  return tab
}

function switchToTab(id) {
  const tab = tabs.get(id)
  if (!tab || !mainWindow) return
  const current = activeTabId != null ? tabs.get(activeTabId) : null
  if (current) mainWindow.removeBrowserView(current.view)
  activeTabId = id
  mainWindow.addBrowserView(tab.view)
  layoutActiveView()
  broadcastTabs()
}

function createAndSwitchTab(url) {
  const tab = createTab(url || HOME_URL)
  switchToTab(tab.id)
  return tab.id
}

function closeTab(id) {
  const tab = tabs.get(id)
  if (!tab) return
  const wasActive = id === activeTabId
  if (mainWindow) mainWindow.removeBrowserView(tab.view)
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  tabs.delete(id)
  if (wasActive) {
    const remaining = Array.from(tabs.keys())
    if (remaining.length > 0) switchToTab(remaining[remaining.length - 1])
    else { activeTabId = null; createAndSwitchTab(HOME_URL) }
  }
  broadcastTabs()
}

function installShields() {
  const sess = session.fromPartition('persist:mabriona-browser')
  sess.webRequest.onBeforeRequest((details, callback) => {
    if (!store.getShieldsEnabled()) { callback({ cancel: false }); return }
    let hostname = null
    try { hostname = new URL(details.url).hostname } catch { /* URL rara — dejar pasar */ }
    const blocked = isBlockedHost(hostname)
    if (blocked) {
      const owner = Array.from(tabs.values()).find((t) => t.view.webContents.id === details.webContentsId)
      if (owner) { owner.blockedCount += 1; broadcastTabs() }
    }
    callback({ cancel: blocked })
  })
}

/** Carpeta real de descargas — la que eligió el usuario en Settings, o el Downloads del sistema si no eligió ninguna. */
function currentDownloadsDir() {
  return store.getDownloadsDir() || app.getPath('downloads')
}

function installDownloads() {
  const sess = session.fromPartition('persist:mabriona-browser')
  sess.on('will-download', (_event, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const savePath = path.join(currentDownloadsDir(), item.getFilename())
    item.setSavePath(savePath)
    store.addDownload({ id, filename: item.getFilename(), path: savePath, url: item.getURL(), state: 'progressing', startedAt: Date.now() })
    sendToRenderer('downloads:state', store.listDownloads())

    item.on('updated', (_e, state) => {
      store.updateDownload(id, { state })
      sendToRenderer('downloads:state', store.listDownloads())
    })
    item.once('done', (_e, state) => {
      store.updateDownload(id, { state, finishedAt: Date.now() })
      sendToRenderer('downloads:state', store.listDownloads())
    })
  })
}

/** Callbacks pendientes de permiso, esperando la decisión real del usuario desde el chrome. */
const pendingPermissionRequests = new Map()
let nextPermissionRequestId = 1

/**
 * Permisos por sitio (cámara/micrófono) — arquitectura real:
 * sitio pide getUserMedia → Electron dispara este handler → si ya hay
 * una decisión guardada para ese origen se resuelve solo; si no, se le
 * pregunta al usuario desde el chrome (permissions:request) y se
 * persiste la respuesta para la próxima vez. Todo lo que no sea
 * cámara/micrófono se deniega por defecto (seguro, sin excepciones
 * todavía en esta fase).
 */
function installPermissions() {
  const sess = session.fromPartition('persist:mabriona-browser')
  sess.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== 'media') { callback(false); return }
    const mediaTypes = details.mediaTypes || []
    const kinds = []
    if (mediaTypes.includes('video')) kinds.push('camera')
    if (mediaTypes.includes('audio')) kinds.push('microphone')
    if (kinds.length === 0) { callback(false); return }

    let origin
    try { origin = new URL(details.requestingUrl).origin } catch { callback(false); return }

    const stored = kinds.map((k) => store.getPermission(origin, k))
    if (stored.every((d) => d === 'allow')) { callback(true); return }
    if (stored.some((d) => d === 'deny')) { callback(false); return }

    // Ninguna decisión guardada todavía — preguntarle al usuario de verdad, no asumir.
    const requestId = nextPermissionRequestId++
    pendingPermissionRequests.set(requestId, { callback, origin, kinds })
    sendToRenderer('permissions:request', { requestId, origin, kinds })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'MABRIONA Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.on('resize', layoutActiveView)
  mainWindow.on('closed', () => { mainWindow = null })

  createAndSwitchTab(HOME_URL)
}

app.whenReady().then(() => {
  installShields()
  installDownloads()
  installPermissions()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ===================== IPC =====================

ipcMain.handle('tabs:create', (_e, url) => createAndSwitchTab(url))
ipcMain.handle('tabs:close', (_e, id) => closeTab(id))
ipcMain.handle('tabs:switch', (_e, id) => switchToTab(id))
ipcMain.handle('tabs:navigate', (_e, { id, input }) => {
  const tab = tabs.get(id)
  if (!tab) return
  tab.view.webContents.loadURL(resolveAddressInput(input))
})
ipcMain.handle('tabs:back', (_e, id) => tabs.get(id)?.view.webContents.goBack())
ipcMain.handle('tabs:forward', (_e, id) => tabs.get(id)?.view.webContents.goForward())
ipcMain.handle('tabs:reload', (_e, id) => tabs.get(id)?.view.webContents.reload())
ipcMain.handle('tabs:stop', (_e, id) => tabs.get(id)?.view.webContents.stop())

// Find in Page — capacidad real de Chromium (webContents.findInPage), no una simulación sobre el
// DOM: funciona contra cualquier página real, con el mismo contador de coincidencias que usa
// Chrome/Safari.
ipcMain.handle('find:start', (_e, { id, text, forward = true, findNext = false }) => {
  const tab = tabs.get(id)
  if (!tab || !text) return
  tab.view.webContents.findInPage(text, { forward, findNext, matchCase: false })
})
ipcMain.handle('find:stop', (_e, id) => tabs.get(id)?.view.webContents.stopFindInPage('clearSelection'))
ipcMain.handle('tabs:get-state', () => Array.from(tabs.values()).map(serializeTab))

ipcMain.handle('history:list', () => store.getState().history)
ipcMain.handle('history:clear', () => store.clearHistory())
ipcMain.handle('history:remove', (_e, url) => store.removeHistoryEntry(url))

ipcMain.handle('favorites:list', () => store.listFavorites())
ipcMain.handle('favorites:add', (_e, fav) => store.addFavorite(fav))
ipcMain.handle('favorites:remove', (_e, url) => store.removeFavorite(url))
ipcMain.handle('favorites:is', (_e, url) => store.isFavorite(url))

ipcMain.handle('downloads:list', () => store.listDownloads())
ipcMain.handle('downloads:open', (_e, filePath) => shell.openPath(filePath))
ipcMain.handle('downloads:show', (_e, filePath) => shell.showItemInFolder(filePath))

// Captura de pantalla real de la pestaña activa (Electron `capturePage`, no un mock) — se guarda
// como PNG real en Descargas y aparece en el mismo panel de Descargas que ya existe (sin duplicar
// UI para esto).
ipcMain.handle('tabs:screenshot', async (_e, id) => {
  const tab = tabs.get(id)
  if (!tab || tab.view.webContents.isDestroyed()) return { ok: false, error: 'la pestaña ya no existe' }
  try {
    const image = await tab.view.webContents.capturePage()
    const filename = `mabriona-browser-captura-${Date.now()}.png`
    const savePath = path.join(currentDownloadsDir(), filename)
    fs.writeFileSync(savePath, image.toPNG())
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    store.addDownload({ id: entryId, filename, path: savePath, url: tab.url, state: 'completed', startedAt: now, finishedAt: now })
    sendToRenderer('downloads:state', store.listDownloads())
    return { ok: true, path: savePath }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('shields:get-enabled', () => store.getShieldsEnabled())
ipcMain.handle('shields:set-enabled', (_e, enabled) => store.setShieldsEnabled(enabled))

// El usuario ya decidió (Allow/Deny) sobre un pedido de cámara/micrófono real, mostrado en el
// chrome — se persiste por origen y se resuelve el callback que Electron estaba esperando.
ipcMain.handle('permissions:respond', (_e, { requestId, allow }) => {
  const pending = pendingPermissionRequests.get(requestId)
  if (!pending) return false
  pendingPermissionRequests.delete(requestId)
  for (const kind of pending.kinds) store.setPermission(pending.origin, kind, allow ? 'allow' : 'deny')
  pending.callback(allow)
  return true
})
ipcMain.handle('permissions:list', () => store.listPermissions())
ipcMain.handle('permissions:set', (_e, { origin, kind, decision }) => store.setPermission(origin, kind, decision))
ipcMain.handle('permissions:clear', (_e, { origin, kind }) => store.clearPermission(origin, kind))

// Settings — Descargas: diálogo real de macOS (dialog.showOpenDialog), no un input de texto libre.
ipcMain.handle('settings:get-downloads-dir', () => currentDownloadsDir())
ipcMain.handle('settings:choose-downloads-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return currentDownloadsDir()
  store.setDownloadsDir(result.filePaths[0])
  return currentDownloadsDir()
})

// Búsqueda propia de MABRIONA (Brave Search API por atrás, resultados mostrados 100% con el
// diseño de MABRIONA) — la key vive solo acá, nunca llega a la página. Si todavía no hay key
// configurada, se avisa así de claro (nunca fingir un resultado ni romper la página).
ipcMain.handle('search:query', async (_e, text) => {
  const apiKey = store.getBraveApiKey()
  if (!apiKey) return { configured: false, results: [] }
  try {
    const { url, headers } = buildRequest(text, apiKey)
    const res = await fetch(url, { headers })
    if (!res.ok) return { configured: true, error: `error ${res.status}`, results: [] }
    const data = await res.json()
    return { configured: true, results: normalizeResults(data) }
  } catch (err) {
    return { configured: true, error: String(err), results: [] }
  }
})

ipcMain.handle('privacy:clear-data', async () => {
  const sess = session.fromPartition('persist:mabriona-browser')
  await sess.clearStorageData()
  await sess.clearCache()
  return true
})
