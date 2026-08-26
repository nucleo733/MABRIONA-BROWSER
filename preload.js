'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mabrionaBrowser', {
  // Valor real, no un IPC — sirve para que el chrome deje espacio real para los botones de
  // semáforo nativos de macOS (titleBarStyle: 'hidden', ver main.js) sin tapar el logo.
  platform: process.platform,

  createTab: (url) => ipcRenderer.invoke('tabs:create', url),
  createPrivateTab: () => ipcRenderer.invoke('tabs:new-private'),
  duplicateTab: (id) => ipcRenderer.invoke('tabs:duplicate', id),
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
  renameFavorite: (url, title) => ipcRenderer.invoke('favorites:rename', url, title),
  updateFavoriteUrl: (oldUrl, newUrl) => ipcRenderer.invoke('favorites:update-url', oldUrl, newUrl),
  moveFavorite: (url, folderId) => ipcRenderer.invoke('favorites:move', url, folderId),
  reorderFavorite: (url, order) => ipcRenderer.invoke('favorites:reorder', url, order),

  listFolders: () => ipcRenderer.invoke('folders:list'),
  createFolder: (name, parentId) => ipcRenderer.invoke('folders:create', name, parentId),
  renameFolder: (id, name) => ipcRenderer.invoke('folders:rename', id, name),
  moveFolder: (id, newParentId) => ipcRenderer.invoke('folders:move', id, newParentId),
  reorderFolder: (id, order) => ipcRenderer.invoke('folders:reorder', id, order),
  deleteFolder: (id) => ipcRenderer.invoke('folders:delete', id),

  captureScreenshot: (id) => ipcRenderer.invoke('tabs:screenshot', id),

  copyText: (text) => ipcRenderer.invoke('utils:copy-text', text),
  generateQrCode: (text) => ipcRenderer.invoke('utils:generate-qr', text),

  getTranslateLanguages: () => ipcRenderer.invoke('translate:get-languages'),
  getTranslateConfigured: () => ipcRenderer.invoke('translate:get-configured'),
  translatePage: (targetLang) => ipcRenderer.invoke('translate:page', targetLang),

  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  openDownload: (filePath) => ipcRenderer.invoke('downloads:open', filePath),
  showDownload: (filePath) => ipcRenderer.invoke('downloads:show', filePath),
  onDownloadsState: (cb) => ipcRenderer.on('downloads:state', (_e, downloads) => cb(downloads)),

  getShieldsEnabled: () => ipcRenderer.invoke('shields:get-enabled'),
  setShieldsEnabled: (enabled) => ipcRenderer.invoke('shields:set-enabled', enabled),

  clearPrivacyData: () => ipcRenderer.invoke('privacy:clear-data'),

  findInPage: (id, text, opts) => ipcRenderer.invoke('find:start', { id, text, ...opts }),
  stopFind: (id) => ipcRenderer.invoke('find:stop', id),
  onFindResult: (cb) => ipcRenderer.on('find:result', (_e, result) => cb(result)),

  onPermissionRequest: (cb) => ipcRenderer.on('permissions:request', (_e, req) => cb(req)),
  respondPermission: (requestId, allow) => ipcRenderer.invoke('permissions:respond', { requestId, allow }),
  listPermissions: () => ipcRenderer.invoke('permissions:list'),
  setPermission: (origin, kind, decision) => ipcRenderer.invoke('permissions:set', { origin, kind, decision }),
  clearPermission: (origin, kind) => ipcRenderer.invoke('permissions:clear', { origin, kind }),

  getDownloadsDir: () => ipcRenderer.invoke('settings:get-downloads-dir'),
  chooseDownloadsDir: () => ipcRenderer.invoke('settings:choose-downloads-dir'),

  getZoom: (id) => ipcRenderer.invoke('zoom:get', id),
  setZoom: (id, factor) => ipcRenderer.invoke('zoom:set', { id, factor }),

  newWindow: (initialUrl) => ipcRenderer.invoke('windows:new', initialUrl),
  newGuestWindow: () => ipcRenderer.invoke('windows:new-guest'),

  getSearchEngine: () => ipcRenderer.invoke('settings:get-search-engine'),
  setSearchEngine: (engine) => ipcRenderer.invoke('settings:set-search-engine', engine),
  getRestoreSession: () => ipcRenderer.invoke('settings:get-restore-session'),
  setRestoreSession: (enabled) => ipcRenderer.invoke('settings:set-restore-session', enabled),

  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  getActiveProfile: () => ipcRenderer.invoke('profiles:get-active'),
  createProfile: (name, emoji) => ipcRenderer.invoke('profiles:create', { name, emoji }),
  renameProfile: (id, name) => ipcRenderer.invoke('profiles:rename', { id, name }),
  canDeleteProfile: (id) => ipcRenderer.invoke('profiles:can-delete', id),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  switchToProfile: (id) => ipcRenderer.invoke('profiles:switch-to', id),

  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  loadUnpackedExtension: () => ipcRenderer.invoke('extensions:load-unpacked'),
  scanOtherBrowsersForExtensions: () => ipcRenderer.invoke('extensions:scan-other-browsers'),
  importExtension: (sourcePath) => ipcRenderer.invoke('extensions:import', sourcePath),
  installExtensionFromWebStore: (idOrUrl) => ipcRenderer.invoke('extensions:install-from-webstore', idOrUrl),
  setExtensionEnabled: (recordId, enabled) => ipcRenderer.invoke('extensions:set-enabled', { recordId, enabled }),
  removeExtension: (recordId) => ipcRenderer.invoke('extensions:remove', recordId),

  getOnboardingStatus: () => ipcRenderer.invoke('onboarding:get-status'),
  setOnboardingCompleted: () => ipcRenderer.invoke('onboarding:set-completed'),
  scanImportSources: () => ipcRenderer.invoke('import:scan-sources'),
  runImport: (source, importBookmarks, importHistory) => ipcRenderer.invoke('import:run', { source, importBookmarks, importHistory }),
})
