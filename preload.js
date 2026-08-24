'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mabrionaBrowser', {
  createTab: (url) => ipcRenderer.invoke('tabs:create', url),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  switchTab: (id) => ipcRenderer.invoke('tabs:switch', id),
  navigate: (id, input) => ipcRenderer.invoke('tabs:navigate', { id, input }),
  back: (id) => ipcRenderer.invoke('tabs:back', id),
  forward: (id) => ipcRenderer.invoke('tabs:forward', id),
  reload: (id) => ipcRenderer.invoke('tabs:reload', id),
  stop: (id) => ipcRenderer.invoke('tabs:stop', id),
  getTabsState: () => ipcRenderer.invoke('tabs:get-state'),
  onTabsState: (cb) => ipcRenderer.on('tabs:state', (_e, tabsState) => cb(tabsState)),

  listHistory: () => ipcRenderer.invoke('history:list'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  removeHistoryEntry: (url) => ipcRenderer.invoke('history:remove', url),

  listFavorites: () => ipcRenderer.invoke('favorites:list'),
  addFavorite: (fav) => ipcRenderer.invoke('favorites:add', fav),
  removeFavorite: (url) => ipcRenderer.invoke('favorites:remove', url),
  isFavorite: (url) => ipcRenderer.invoke('favorites:is', url),

  captureScreenshot: (id) => ipcRenderer.invoke('tabs:screenshot', id),

  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  openDownload: (filePath) => ipcRenderer.invoke('downloads:open', filePath),
  showDownload: (filePath) => ipcRenderer.invoke('downloads:show', filePath),
  onDownloadsState: (cb) => ipcRenderer.on('downloads:state', (_e, downloads) => cb(downloads)),

  getShieldsEnabled: () => ipcRenderer.invoke('shields:get-enabled'),
  setShieldsEnabled: (enabled) => ipcRenderer.invoke('shields:set-enabled', enabled),

  clearPrivacyData: () => ipcRenderer.invoke('privacy:clear-data'),

  onPermissionRequest: (cb) => ipcRenderer.on('permissions:request', (_e, req) => cb(req)),
  respondPermission: (requestId, allow) => ipcRenderer.invoke('permissions:respond', { requestId, allow }),
  listPermissions: () => ipcRenderer.invoke('permissions:list'),
  setPermission: (origin, kind, decision) => ipcRenderer.invoke('permissions:set', { origin, kind, decision }),
})
