'use strict'

const { app, BrowserWindow, BrowserView, ipcMain, session, shell } = require('electron')
const path = require('node:path')
const { createStore } = require('./store')
const { isBlockedHost } = require('./shields/blocklist')
const { resolveAddressInput, HOME_URL } = require('./address-resolver')

const TOOLBAR_HEIGHT = 118

const store = createStore(path.join(app.getPath('userData'), 'mabriona-browser-data.json'))

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
  const wc = tab.view.webContents
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
      if (url && url !== 'about:blank') {
        store.addHistoryEntry({ url, title: tab.title, visitedAt: Date.now() })
      }
    }
  })
  wc.on('did-navigate', (_e, url) => { tab.url = url; broadcastTabs() })
  wc.on('did-navigate-in-page', (_e, url) => { tab.url = url; broadcastTabs() })
  wc.on('page-title-updated', (_e, title) => { tab.title = title; broadcastTabs() })

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
  tab.view.webContents.close()
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

function installDownloads() {
  const sess = session.fromPartition('persist:mabriona-browser')
  sess.on('will-download', (_event, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const savePath = path.join(app.getPath('downloads'), item.getFilename())
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
ipcMain.handle('tabs:get-state', () => Array.from(tabs.values()).map(serializeTab))

ipcMain.handle('history:list', () => store.getState().history)
ipcMain.handle('history:clear', () => store.clearHistory())

ipcMain.handle('favorites:list', () => store.listFavorites())
ipcMain.handle('favorites:add', (_e, fav) => store.addFavorite(fav))
ipcMain.handle('favorites:remove', (_e, url) => store.removeFavorite(url))
ipcMain.handle('favorites:is', (_e, url) => store.isFavorite(url))

ipcMain.handle('downloads:list', () => store.listDownloads())
ipcMain.handle('downloads:open', (_e, filePath) => shell.openPath(filePath))
ipcMain.handle('downloads:show', (_e, filePath) => shell.showItemInFolder(filePath))

ipcMain.handle('shields:get-enabled', () => store.getShieldsEnabled())
ipcMain.handle('shields:set-enabled', (_e, enabled) => store.setShieldsEnabled(enabled))

ipcMain.handle('privacy:clear-data', async () => {
  const sess = session.fromPartition('persist:mabriona-browser')
  await sess.clearStorageData()
  await sess.clearCache()
  return true
})
