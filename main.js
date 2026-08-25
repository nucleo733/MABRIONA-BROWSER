'use strict'

const { app, BrowserWindow, BrowserView, ipcMain, session, shell, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { createStore } = require('./store')
const { isBlockedHost } = require('./shields/blocklist')
const { resolveAddressInput, HOME_URL } = require('./address-resolver')
const {
  buildRequest,
  buildImagesRequest,
  normalizeResults,
  normalizeInfobox,
  normalizeVideos,
  normalizeFaq,
  normalizeNews,
  normalizeLocations,
  normalizeImages,
} = require('./search/braveSearch')
const { detectTool } = require('./search/tools')
const { resolveSpectrum } = require('./search/spectrumResolver')

const TOOLBAR_HEIGHT = 118
const PRIVATE_PARTITION = 'mabriona-private' // sin "persist:" → en memoria, Electron la descarta al cerrar la app

const store = createStore(path.join(app.getPath('userData'), 'mabriona-browser-data.json'))

// Red de seguridad: un error inesperado en un solo callback (ej. una pestaña cerrándose en un
// mal momento) no debe tumbar toda la ventana del navegador — se registra y sigue.
process.on('uncaughtException', (err) => {
  console.error('[MABRIONA Browser] error no manejado:', err)
})

/** @type {Map<number, { window: BrowserWindow, activeTabId: number | null }>} */
const windows = new Map()
let nextWindowId = 1
/** @type {Map<number, { view: BrowserView, id: number, windowId: number, title: string, url: string, blockedCount: number, isPrivate: boolean }>} */
const tabs = new Map()
let nextTabId = 1

function windowIdForSender(event) {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return null
  for (const [id, state] of windows) if (state.window === win) return id
  return null
}

function sendToWindow(windowId, channel, payload) {
  const state = windows.get(windowId)
  if (state && !state.window.isDestroyed()) state.window.webContents.send(channel, payload)
}

function serializeTab(tab, activeTabId) {
  const wc = tab.view && tab.view.webContents
  // El webContents puede no estar listo todavía (arranque) o ya estar destruido (pestaña
  // cerrándose justo en este instante) — nunca crashear la app entera por una foto de estado.
  if (!wc || wc.isDestroyed()) {
    return { id: tab.id, title: tab.title || 'Nueva pestaña', url: tab.url, loading: false, canGoBack: false, canGoForward: false, blockedCount: tab.blockedCount, isActive: tab.id === activeTabId, isPrivate: tab.isPrivate }
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
    isPrivate: tab.isPrivate,
  }
}

function broadcastTabs(windowId) {
  const state = windows.get(windowId)
  if (!state) return
  const windowTabs = Array.from(tabs.values()).filter((t) => t.windowId === windowId)
  sendToWindow(windowId, 'tabs:state', windowTabs.map((t) => serializeTab(t, state.activeTabId)))
}

function layoutActiveView(windowId) {
  const state = windows.get(windowId)
  if (!state) return
  const active = state.activeTabId != null ? tabs.get(state.activeTabId) : null
  if (!active) return
  const [w, h] = state.window.getContentSize()
  active.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: Math.max(0, h - TOOLBAR_HEIGHT) })
}

// Recuperación de sesión real: se guarda (con un pequeño debounce, para no escribir en disco en
// cada tecla) la lista de URLs reales abiertas — nunca pestañas privadas, esas no dejan rastro a
// propósito — y se reabren la próxima vez que arranca la app.
let saveSessionTimer = null
function saveSessionSoon() {
  clearTimeout(saveSessionTimer)
  saveSessionTimer = setTimeout(() => {
    const urls = Array.from(tabs.values())
      .filter((t) => !t.isPrivate && t.url && t.url !== HOME_URL && t.url !== 'about:blank')
      .map((t) => t.url)
    store.setLastSession(urls)
  }, 800)
}

function createTab(initialUrl, windowId, options = {}) {
  const isPrivate = !!options.private
  if (isPrivate) ensurePrivateSession()
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Modo Privado real: partición sin "persist:" = sesión en memoria. Electron la descarta
      // entera al cerrar la app — no queda un archivo en disco con cookies/almacenamiento de esa
      // sesión. No es anonimato frente a la red (tu proveedor de internet y los sitios que
      // visitás igual te ven) — solo separa lo que el navegador guarda localmente.
      partition: isPrivate ? PRIVATE_PARTITION : 'persist:mabriona-browser',
      // Solo expone `window.mabrionaSearch.query(...)` (ver search-preload.js) — la página de
      // resultados propia lo usa para pedir resultados sin tocar ninguna API key directamente.
      // Inofensivo en cualquier otro sitio: contextBridge no le da nada a la página, la key nunca
      // sale del proceso principal.
      preload: path.join(__dirname, 'search-preload.js'),
    },
  })
  const id = nextTabId++
  const tab = { view, id, windowId, title: 'Nueva pestaña', url: initialUrl, blockedCount: 0, isPrivate }
  tabs.set(id, tab)

  const wc = view.webContents
  wc.on('did-start-loading', () => broadcastTabs(windowId))
  wc.on('did-stop-loading', () => {
    broadcastTabs(windowId)
    const state = windows.get(windowId)
    if (state && tab.id === state.activeTabId) {
      const url = wc.getURL()
      if (url && url !== 'about:blank' && url !== HOME_URL && !tab.isPrivate) {
        store.addHistoryEntry({ url, title: tab.title, visitedAt: Date.now() })
      }
    }
    saveSessionSoon()
  })
  wc.on('did-navigate', (_e, url) => { tab.url = url; broadcastTabs(windowId); saveSessionSoon() })
  wc.on('did-navigate-in-page', (_e, url) => { tab.url = url; broadcastTabs(windowId) })
  wc.on('page-title-updated', (_e, title) => { tab.title = title; broadcastTabs(windowId) })
  wc.on('found-in-page', (_e, result) => {
    sendToWindow(windowId, 'find:result', { tabId: tab.id, activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches })
  })
  // El renderer de una pestaña puede morir sin tumbar la app entera (memoria, un crash real de
  // Chromium en un sitio) — se avisa en el chrome real (título visible) y se intenta recargar la
  // misma URL, en vez de dejar la pestaña congelada mostrando la última imagen para siempre.
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    console.error(`[MABRIONA Browser] la pestaña ${tab.id} se cayó (${details.reason}) — recargando`)
    tab.title = 'Página no disponible — recargando…'
    broadcastTabs(windowId)
    if (!wc.isDestroyed()) wc.loadURL(tab.url).catch(() => {})
  })

  wc.setWindowOpenHandler(({ url }) => {
    createAndSwitchTab(url, windowId, { private: isPrivate })
    return { action: 'deny' }
  })

  view.webContents.loadURL(initialUrl)
  return tab
}

function switchToTab(id) {
  const tab = tabs.get(id)
  if (!tab) return
  const state = windows.get(tab.windowId)
  if (!state) return
  const current = state.activeTabId != null ? tabs.get(state.activeTabId) : null
  if (current) state.window.removeBrowserView(current.view)
  state.activeTabId = id
  state.window.addBrowserView(tab.view)
  layoutActiveView(tab.windowId)
  broadcastTabs(tab.windowId)
}

function createAndSwitchTab(url, windowId, options = {}) {
  const tab = createTab(url || HOME_URL, windowId, options)
  switchToTab(tab.id)
  return tab.id
}

function closeTab(id) {
  const tab = tabs.get(id)
  if (!tab) return
  const windowId = tab.windowId
  const state = windows.get(windowId)
  const wasActive = !!state && id === state.activeTabId
  if (state) state.window.removeBrowserView(tab.view)
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  tabs.delete(id)
  saveSessionSoon()
  if (!state) return
  if (wasActive) {
    const remaining = Array.from(tabs.values()).filter((t) => t.windowId === windowId)
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1].id)
      return
    }
    state.activeTabId = null
    // Una ventana secundaria sin pestañas se cierra sola (comportamiento estándar de navegador);
    // la ventana principal siempre queda con al menos una pestaña real.
    if (windows.size > 1) { state.window.close(); return }
    createAndSwitchTab(HOME_URL, windowId)
    return
  }
  broadcastTabs(windowId)
}

function installShieldsFor(sess) {
  sess.webRequest.onBeforeRequest((details, callback) => {
    if (!store.getShieldsEnabled()) { callback({ cancel: false }); return }
    let hostname = null
    try { hostname = new URL(details.url).hostname } catch { /* URL rara — dejar pasar */ }
    const blocked = isBlockedHost(hostname)
    if (blocked) {
      const owner = Array.from(tabs.values()).find((t) => t.view.webContents.id === details.webContentsId)
      if (owner) { owner.blockedCount += 1; broadcastTabs(owner.windowId) }
    }
    callback({ cancel: blocked })
  })
}

/** Carpeta real de descargas — la que eligió el usuario en Settings, o el Downloads del sistema si no eligió ninguna. */
function currentDownloadsDir() {
  return store.getDownloadsDir() || app.getPath('downloads')
}

function installDownloadsFor(sess) {
  sess.on('will-download', (_event, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const savePath = path.join(currentDownloadsDir(), item.getFilename())
    item.setSavePath(savePath)
    store.addDownload({ id, filename: item.getFilename(), path: savePath, url: item.getURL(), state: 'progressing', startedAt: Date.now() })
    broadcastDownloads()

    item.on('updated', (_e, state) => {
      store.updateDownload(id, { state })
      broadcastDownloads()
    })
    item.once('done', (_e, state) => {
      store.updateDownload(id, { state, finishedAt: Date.now() })
      broadcastDownloads()
    })
  })
}

function broadcastDownloads() {
  for (const windowId of windows.keys()) sendToWindow(windowId, 'downloads:state', store.listDownloads())
}

/** Callbacks pendientes de permiso, esperando la decisión real del usuario desde el chrome. */
const pendingPermissionRequests = new Map()
let nextPermissionRequestId = 1
/** Decisiones de pestañas privadas — a propósito NUNCA tocan el store persistente en disco. */
const inMemoryPrivatePermissions = new Map()

/**
 * Permisos por sitio — arquitectura real: el sitio pide algo (cámara/mic, ubicación,
 * notificaciones) → Electron dispara este handler → si ya hay una decisión guardada para ese
 * origen se resuelve solo; si no, se le pregunta al usuario desde el chrome
 * (permissions:request) y se persiste la respuesta para la próxima vez. Todo lo que no sea uno de
 * estos tres tipos se deniega por defecto. `persistent=false` (pestañas privadas) guarda la
 * decisión solo en memoria, nunca en el store en disco.
 */
function installPermissionsFor(sess, persistent) {
  sess.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let kinds = []
    if (permission === 'media') {
      const mediaTypes = details.mediaTypes || []
      if (mediaTypes.includes('video')) kinds.push('camera')
      if (mediaTypes.includes('audio')) kinds.push('microphone')
    } else if (permission === 'geolocation') {
      kinds = ['location']
    } else if (permission === 'notifications') {
      kinds = ['notifications']
    }
    if (kinds.length === 0) { callback(false); return }

    let origin
    try { origin = new URL(details.requestingUrl || webContents.getURL()).origin } catch { callback(false); return }

    const getDecision = (o, k) => (persistent ? store.getPermission(o, k) : inMemoryPrivatePermissions.get(o)?.[k] || null)
    const setDecision = (o, k, d) => {
      if (persistent) { store.setPermission(o, k, d); return }
      inMemoryPrivatePermissions.set(o, { ...inMemoryPrivatePermissions.get(o), [k]: d })
    }

    const stored = kinds.map((k) => getDecision(origin, k))
    if (stored.every((d) => d === 'allow')) { callback(true); return }
    if (stored.some((d) => d === 'deny')) { callback(false); return }

    const owner = Array.from(tabs.values()).find((t) => t.view.webContents.id === webContents.id)
    const windowId = owner ? owner.windowId : Array.from(windows.keys())[0]

    // Ninguna decisión guardada todavía — preguntarle al usuario de verdad, no asumir.
    const requestId = nextPermissionRequestId++
    pendingPermissionRequests.set(requestId, { callback, origin, kinds, setDecision })
    sendToWindow(windowId, 'permissions:request', { requestId, origin, kinds })
  })
}

let privateSessionReady = false
function ensurePrivateSession() {
  if (privateSessionReady) return
  privateSessionReady = true
  const sess = session.fromPartition(PRIVATE_PARTITION)
  installShieldsFor(sess)
  installPermissionsFor(sess, false)
  installDownloadsFor(sess) // los archivos descargados SÍ quedan en disco aunque la pestaña sea privada — igual que en cualquier navegador real
}

function createWindow(options = {}) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    title: 'MABRIONA Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const windowId = nextWindowId++
  windows.set(windowId, { window: win, activeTabId: null })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.on('resize', () => layoutActiveView(windowId))
  win.on('closed', () => {
    for (const tab of Array.from(tabs.values())) {
      if (tab.windowId !== windowId) continue
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
      tabs.delete(tab.id)
    }
    windows.delete(windowId)
  })

  const restoreUrls = options.restoreSession ? store.getLastSession() : []
  if (restoreUrls.length > 0) {
    for (const url of restoreUrls) createAndSwitchTab(url, windowId)
  } else {
    createAndSwitchTab(HOME_URL, windowId)
  }
  return windowId
}

app.whenReady().then(() => {
  installShieldsFor(session.fromPartition('persist:mabriona-browser'))
  installDownloadsFor(session.fromPartition('persist:mabriona-browser'))
  installPermissionsFor(session.fromPartition('persist:mabriona-browser'), true)
  createWindow({ restoreSession: true })

  app.on('activate', () => {
    if (windows.size === 0) createWindow({ restoreSession: true })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ===================== IPC =====================

ipcMain.handle('tabs:create', (e, url) => createAndSwitchTab(url, windowIdForSender(e)))
ipcMain.handle('tabs:new-private', (e) => createAndSwitchTab(HOME_URL, windowIdForSender(e), { private: true }))
ipcMain.handle('tabs:duplicate', (_e, id) => {
  const tab = tabs.get(id)
  if (!tab) return null
  return createAndSwitchTab(tab.url, tab.windowId, { private: tab.isPrivate })
})
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
ipcMain.handle('tabs:get-state', (e) => {
  const windowId = windowIdForSender(e)
  const state = windows.get(windowId)
  if (!state) return []
  return Array.from(tabs.values()).filter((t) => t.windowId === windowId).map((t) => serializeTab(t, state.activeTabId))
})

// Zoom real — Electron nativo (webContents.setZoomFactor), no un transform de CSS: reescala el
// layout de verdad, igual que Cmd+/Cmd-/Cmd0 en cualquier navegador real.
ipcMain.handle('zoom:get', (_e, id) => tabs.get(id)?.view.webContents.getZoomFactor() ?? 1)
ipcMain.handle('zoom:set', (_e, { id, factor }) => {
  const tab = tabs.get(id)
  if (!tab || tab.view.webContents.isDestroyed()) return 1
  const clamped = Math.max(0.5, Math.min(3, factor))
  tab.view.webContents.setZoomFactor(clamped)
  return clamped
})

// Ventanas reales — Electron nativo (nueva BrowserWindow independiente), no una simulación.
ipcMain.handle('windows:new', () => { createWindow(); return true })

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
    broadcastDownloads()
    return { ok: true, path: savePath }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('shields:get-enabled', () => store.getShieldsEnabled())
ipcMain.handle('shields:set-enabled', (_e, enabled) => store.setShieldsEnabled(enabled))

// El usuario ya decidió (Allow/Deny) sobre un pedido real (cámara/mic, ubicación, notificaciones),
// mostrado en el chrome — se persiste (o se guarda solo en memoria, en pestañas privadas) y se
// resuelve el callback que Electron estaba esperando.
ipcMain.handle('permissions:respond', (_e, { requestId, allow }) => {
  const pending = pendingPermissionRequests.get(requestId)
  if (!pending) return false
  pendingPermissionRequests.delete(requestId)
  for (const kind of pending.kinds) pending.setDecision(pending.origin, kind, allow ? 'allow' : 'deny')
  pending.callback(allow)
  return true
})
ipcMain.handle('permissions:list', () => store.listPermissions())
ipcMain.handle('permissions:set', (_e, { origin, kind, decision }) => store.setPermission(origin, kind, decision))
ipcMain.handle('permissions:clear', (_e, { origin, kind }) => store.clearPermission(origin, kind))

// Settings — Descargas: diálogo real de macOS (dialog.showOpenDialog), no un input de texto libre.
ipcMain.handle('settings:get-downloads-dir', () => currentDownloadsDir())
ipcMain.handle('settings:choose-downloads-dir', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return currentDownloadsDir()
  store.setDownloadsDir(result.filePaths[0])
  return currentDownloadsDir()
})

// Búsqueda propia de MABRIONA (Brave Search API por atrás, resultados mostrados 100% con el
// diseño de MABRIONA) — la key vive solo acá, nunca llega a la página. Si todavía no hay key
// configurada, se avisa así de claro (nunca fingir un resultado ni romper la página).
const SEARCH_EMPTY = {
  configured: false,
  web: [],
  infobox: null,
  videos: [],
  faq: [],
  news: [],
  locations: [],
  tool: null,
  spectrum: { tabs: [], overflow: [] },
}

ipcMain.handle('search:query', async (_e, { text, freshness } = {}) => {
  // MABRIONA Tools no depende de Brave ni de red — es cálculo real local (calculadora, conversión
  // de unidades, hora/fecha del sistema). Se evalúa siempre, incluso si Brave falla después: una
  // herramienta que funciona no debe quedar bloqueada por un problema de la búsqueda web.
  const tool = detectTool(text)
  const apiKey = store.getBraveApiKey()
  if (!apiKey) return { ...SEARCH_EMPTY, tool }
  try {
    const { url, headers } = buildRequest(text, apiKey, { freshness })
    const res = await fetch(url, { headers })
    if (!res.ok) {
      // 429 real (límite de la cuenta, confirmado con cabeceras x-ratelimit-* en Etapa 4) es un caso
      // distinto de un error genérico — la UI necesita poder decir "esperá un momento" en vez de
      // "no encontramos nada", que sería engañoso.
      const errorKind = res.status === 429 ? 'rate_limited' : 'http_error'
      return { ...SEARCH_EMPTY, configured: true, error: `error ${res.status}`, errorKind, tool }
    }
    const data = await res.json()
    // Todo sale de esta misma respuesta — Brave ya la trae completa, no se hace ninguna llamada
    // extra para FAQ, News ni Locations (misma regla desde Etapa 1: sin red extra para "llenar" la
    // UI). Imágenes es la única excepción real: Brave no la incluye acá (ver `search:images` —
    // confirmado contra la cuenta real que necesita su propio endpoint).
    const infobox = normalizeInfobox(data)
    const faq = normalizeFaq(data)
    const videos = normalizeVideos(data)
    const news = normalizeNews(data)
    const locations = normalizeLocations(data)
    const web = normalizeResults(data)
    return {
      configured: true,
      web,
      infobox,
      videos,
      faq,
      news,
      locations,
      tool,
      spectrum: resolveSpectrum({ web, videos, news, locations, tool }),
    }
  } catch (err) {
    // fetch() lanza acá cuando no hay conexión real (DNS, red caída) — distinto de un error HTTP.
    return { ...SEARCH_EMPTY, configured: true, error: String(err), errorKind: 'network', tool }
  }
})

// Imágenes reales — llamada perezosa y aparte, solo cuando el usuario abre la pestaña Imágenes
// (ver renderer/results.js). No se pide en cada búsqueda: la mayoría de búsquedas nunca abren esa
// pestaña, así que pedirla siempre sería gastar cupo de la cuenta sin necesidad.
ipcMain.handle('search:images', async (_e, text) => {
  const apiKey = store.getBraveApiKey()
  if (!apiKey) return { configured: false, images: [] }
  try {
    const { url, headers } = buildImagesRequest(text, apiKey)
    const res = await fetch(url, { headers })
    if (!res.ok) return { configured: true, error: `error ${res.status}`, images: [] }
    const data = await res.json()
    return { configured: true, images: normalizeImages(data) }
  } catch (err) {
    return { configured: true, error: String(err), images: [] }
  }
})

ipcMain.handle('privacy:clear-data', async () => {
  const sess = session.fromPartition('persist:mabriona-browser')
  await sess.clearStorageData()
  await sess.clearCache()
  return true
})
