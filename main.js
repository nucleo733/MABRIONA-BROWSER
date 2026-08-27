'use strict'

const { app, BrowserWindow, BrowserView, ipcMain, session, shell, dialog, clipboard, safeStorage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { createStore, createMemoryStore } = require('./store')
const { createProfileRegistry } = require('./profiles')
const extensionsLib = require('./extensions')
const browserImportLib = require('./browserImport')
const { isBlockedHost } = require('./shields/blocklist')
const { resolveAddressInput, HOME_URL } = require('./address-resolver')
const {
  buildRequest,
  buildImagesRequest,
  VALID_FRESHNESS,
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
const { startDjiaBridge, pickAndOpenExternalCallback } = require('./bridge/djiaBridge')
const QRCode = require('qrcode')
const { LANGUAGES: TRANSLATE_LANGUAGES, buildTranslateRequest, normalizeTranslateResponse } = require('./translate/deeplTranslate')

// Integración oficial MABRIONA DJ AI (web, sin app de escritorio) —
// `mabriona-browser://pick?q=...&back=...`, ver
// `docs/INTEGRACION-DJ-AI.md`, sección "Web".
const DJIA_PROTOCOL = 'mabriona-browser'
function handleDjiaProtocolUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return
  }
  // `mabriona-browser://pick?...` — distintos SO parsean "pick" como
  // host o como el primer segmento de path; se acepta cualquiera de
  // los dos para no depender de esa diferencia.
  const isPick = parsed.hostname === 'pick' || parsed.pathname.replace(/^\/+/, '') === 'pick'
  if (!isPick) return
  const query = parsed.searchParams.get('q')
  const back = parsed.searchParams.get('back')
  if (!query || !back) return
  pickAndOpenExternalCallback({
    query,
    backUrl: back,
    createAndSwitchTab,
    getTab: (id) => tabs.get(id),
    getOrCreateTargetWindowId: () => {
      const existing = windows.keys().next()
      return existing.done ? createWindow({ restoreSession: false }) : existing.value
    },
    shellOpenExternal: (url) => shell.openExternal(url),
  })
}

const TOOLBAR_HEIGHT = 118
const PRIVATE_PARTITION = 'mabriona-private' // sin "persist:" → en memoria, Electron la descarta al cerrar la app
// Proxy real server-side compartido (Search y Traducir) — ver Fase 21 y Fase 1.4.3: ninguna key
// real de MABRIONA viaja empaquetada dentro del `.app`/`.exe` distribuido, vive solo acá.
const MABRIONA_PROXY_BASE = 'https://www.mabriona.com/api'

const legacyDataFile = path.join(app.getPath('userData'), 'mabriona-browser-data.json')
const registry = createProfileRegistry(path.join(app.getPath('userData'), 'mabriona-browser-profiles.json'), legacyDataFile)

// Un store real por perfil (historial/favoritos/descargas/shields/permisos/config — ver store.js),
// creado la primera vez que ese perfil se usa y reutilizado después. El perfil 'default' apunta al
// mismo archivo de siempre — nada se migra ni se copia.
const storesByProfile = new Map()
function storeFor(profileId) {
  if (!storesByProfile.has(profileId)) {
    storesByProfile.set(profileId, createStore(registry.dataFilePathFor(app.getPath('userData'), profileId)))
  }
  return storesByProfile.get(profileId)
}

// Red de seguridad: un error inesperado en un solo callback (ej. una pestaña cerrándose en un
// mal momento) no debe tumbar toda la ventana del navegador — se registra y sigue.
process.on('uncaughtException', (err) => {
  console.error('[MABRIONA Browser] error no manejado:', err)
})

/** @type {Map<number, { window: BrowserWindow, activeTabId: number | null, profileId: string, isGuest: boolean }>} */
const windows = new Map()
let nextWindowId = 1
/** @type {Map<number, { view: BrowserView, id: number, windowId: number, title: string, url: string, blockedCount: number, isPrivate: boolean }>} */
const tabs = new Map()
let nextTabId = 1

// Una ventana de Modo Invitado por ventana (no compartido entre varias ventanas invitadas
// abiertas a la vez) — se crea al abrir la ventana, se descarta solo al cerrarla.
const guestStoresByWindow = new Map()

function storeForWindow(windowId) {
  const state = windows.get(windowId)
  if (state && state.isGuest) {
    if (!guestStoresByWindow.has(windowId)) guestStoresByWindow.set(windowId, createMemoryStore())
    return guestStoresByWindow.get(windowId)
  }
  return storeFor(state ? state.profileId : 'default')
}
function storeForTab(tabId) {
  const tab = tabs.get(tabId)
  return tab ? storeForWindow(tab.windowId) : storeFor('default')
}

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
    return { id: tab.id, title: tab.title || 'Nueva pestaña', url: tab.url, loading: false, canGoBack: false, canGoForward: false, blockedCount: tab.blockedCount, isActive: tab.id === activeTabId, isPrivate: tab.isPrivate, groupId: tab.groupId || null }
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
    groupId: tab.groupId || null,
  }
}

function broadcastTabs(windowId) {
  const state = windows.get(windowId)
  if (!state) return
  const windowTabs = Array.from(tabs.values()).filter((t) => t.windowId === windowId)
  sendToWindow(windowId, 'tabs:state', windowTabs.map((t) => serializeTab(t, state.activeTabId)))
}

// Los paneles/overlays del chrome (Compartir/Más/Traducir/menú contextual/Gestor de favoritos/etc.)
// son HTML propio, pero el BrowserView de la pestaña activa es una capa nativa aparte que Electron
// dibuja SIEMPRE por encima — ningún z-index de CSS la tapa. Si el BrowserView ocupa el ancho
// completo mientras un overlay está abierto, la página real queda arriba y el overlay queda
// invisible detrás. `state.viewReserve` llega desde el renderer (ver OVERLAY_RESERVE en
// renderer.js): `false` (nada abierto), un número de px a restarle desde la derecha (paneles chicos
// anclados, la página sigue visible a la izquierda), o `'full'` (modales grandes/centrados — el
// BrowserView se oculta del todo, no hay ancho fijo que alcance para algo que puede estar en
// cualquier posición).
function layoutActiveView(windowId) {
  const state = windows.get(windowId)
  if (!state) return
  const active = state.activeTabId != null ? tabs.get(state.activeTabId) : null
  if (!active) return
  const [w, h] = state.window.getContentSize()
  const reserve = state.viewReserve
  const reservedPx = reserve === 'full' ? w : (typeof reserve === 'number' ? reserve : 0)
  active.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: Math.max(0, w - reservedPx), height: Math.max(0, h - TOOLBAR_HEIGHT) })
}

function activeTabForWindow(windowId) {
  const state = windows.get(windowId)
  if (!state || state.activeTabId == null) return null
  return tabs.get(state.activeTabId) || null
}

// Grupos de pestañas reales — por ventana (no se guardan en disco, igual que las pestañas mismas:
// se recrean con la sesión real la próxima vez que hace falta, ver recuperación de sesión).
const tabGroups = new Map() // windowId -> [{ id, name, color, collapsed }]
function groupsForWindow(windowId) {
  if (!tabGroups.has(windowId)) tabGroups.set(windowId, [])
  return tabGroups.get(windowId)
}
function broadcastGroups(windowId) {
  sendToWindow(windowId, 'tabs:groups-state', groupsForWindow(windowId))
}
function removeGroupIfEmpty(windowId, groupId) {
  const stillHasTabs = Array.from(tabs.values()).some((t) => t.windowId === windowId && t.groupId === groupId)
  if (stillHasTabs) return
  const groups = groupsForWindow(windowId)
  const idx = groups.findIndex((g) => g.id === groupId)
  if (idx !== -1) { groups.splice(idx, 1); broadcastGroups(windowId) }
}

/** Para mensajes que llegan del webContents de una pestaña (una BrowserView, ver
 * search-preload.js) en vez del chrome — `windowIdForSender` no sirve ahí (BrowserWindow.
 * fromWebContents no resuelve una BrowserView), así que se busca directo cuál pestaña es. */
function windowIdForSenderFromBrowserView(webContents) {
  const tab = Array.from(tabs.values()).find((t) => t.view.webContents.id === webContents.id)
  return tab ? tab.windowId : null
}

// Accesos directos reales de la Nueva Pestaña — no hay ningún conteo de visitas guardado aparte
// (el historial ya deduplica por URL exacta), así que se agrupa el historial real por origen: la
// cantidad de páginas distintas visitadas de un mismo sitio es una señal real de qué tan seguido
// se usa, sin inventar ningún dato que no exista.
function computeTopSites(profileStore, limit = 8) {
  const byOrigin = new Map()
  for (const entry of profileStore.getState().history) {
    let origin
    try { origin = new URL(entry.url).origin } catch { continue }
    if (!origin.startsWith('http')) continue
    const existing = byOrigin.get(origin)
    if (existing) {
      existing.count++
      if ((entry.visitedAt || 0) > existing.lastVisitedAt) { existing.lastVisitedAt = entry.visitedAt || 0; existing.title = entry.title || existing.title; existing.url = entry.url }
    } else {
      byOrigin.set(origin, { origin, url: entry.url, title: entry.title || origin, count: 1, lastVisitedAt: entry.visitedAt || 0 })
    }
  }
  return Array.from(byOrigin.values())
    .sort((a, b) => b.count - a.count || b.lastVisitedAt - a.lastVisitedAt)
    .slice(0, limit)
    .map(({ origin, url, title }) => ({ origin, url, title }))
}

// Recuperación de sesión real: se guarda (con un pequeño debounce, para no escribir en disco en
// cada tecla) la lista de URLs reales abiertas — nunca pestañas privadas, esas no dejan rastro a
// propósito — y se reabren la próxima vez que arranca la app.
let saveSessionTimer = null
function saveSessionSoon(windowId) {
  clearTimeout(saveSessionTimer)
  saveSessionTimer = setTimeout(() => {
    // Por ventana: cada perfil guarda su propia sesión — abrir la ventana del Perfil B no debe
    // pisar la sesión guardada del Perfil A.
    const byWindow = new Map()
    for (const t of tabs.values()) {
      if (t.isPrivate || !t.url || t.url === HOME_URL || t.url === 'about:blank') continue
      if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, [])
      byWindow.get(t.windowId).push(t.url)
    }
    for (const [wId, urls] of byWindow) storeForWindow(wId).setLastSession(urls)
    // Una ventana que se quedó sin pestañas reales (todas privadas o ninguna) limpia su sesión
    // guardada — si no, la próxima vez reabriría URLs viejas que el usuario ya cerró.
    if (windowId != null && !byWindow.has(windowId)) storeForWindow(windowId).setLastSession([])
  }, 800)
}

function createTab(initialUrl, windowId, options = {}) {
  const winState = windows.get(windowId)
  const isGuestWindow = !!(winState && winState.isGuest)
  const isPrivate = !!options.private || isGuestWindow
  const partition = isPrivate ? PRIVATE_PARTITION : registry.partitionFor(winState ? winState.profileId : 'default')
  if (isPrivate) ensurePrivateSession()
  else ensureProfileSession(winState ? winState.profileId : 'default')
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Modo Privado real: partición sin "persist:" = sesión en memoria. Electron la descarta
      // entera al cerrar la app — no queda un archivo en disco con cookies/almacenamiento de esa
      // sesión. No es anonimato frente a la red (tu proveedor de internet y los sitios que
      // visitás igual te ven) — solo separa lo que el navegador guarda localmente. Modo Invitado
      // reutiliza exactamente este mismo mecanismo, para toda pestaña de esa ventana.
      partition,
      // Solo expone `window.mabrionaSearch.query(...)` (ver search-preload.js) — la página de
      // resultados propia lo usa para pedir resultados sin tocar ninguna API key directamente.
      // Inofensivo en cualquier otro sitio: contextBridge no le da nada a la página, la key nunca
      // sale del proceso principal.
      preload: path.join(__dirname, 'search-preload.js'),
      // Visor real de PDF de Chromium (PDFium, ya viene adentro de Electron) — sin esto, cualquier
      // PDF se trataba como una descarga en vez de mostrarse adentro de la pestaña, como en
      // Chrome/Brave real.
      plugins: true,
    },
  })
  const id = nextTabId++
  const tab = { view, id, windowId, title: 'Nueva pestaña', url: initialUrl, blockedCount: 0, isPrivate, groupId: null }
  tabs.set(id, tab)

  const wc = view.webContents
  wc.on('did-start-loading', () => broadcastTabs(windowId))
  wc.on('did-stop-loading', () => {
    broadcastTabs(windowId)
    const state = windows.get(windowId)
    if (state && tab.id === state.activeTabId) {
      const url = wc.getURL()
      if (url && url !== 'about:blank' && url !== HOME_URL && !tab.isPrivate) {
        storeForWindow(windowId).addHistoryEntry({ url, title: tab.title, visitedAt: Date.now() })
      }
    }
    saveSessionSoon(windowId)
  })
  // El contador de Shields refleja la página actual (igual que Brave/uBlock Origin) — una
  // navegación real a otra página empieza de cero, si no el número solo crecería para siempre y
  // dejaría de significar nada. `did-navigate-in-page` (anchors/rutas de una SPA, misma página) no
  // cuenta como navegación nueva a propósito.
  wc.on('did-navigate', (_e, url) => { tab.url = url; tab.blockedCount = 0; broadcastTabs(windowId); saveSessionSoon(windowId) })
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

  // DevTools/Imprimir tienen que funcionar aunque el foco esté adentro de la página (el caso más
  // común — inspeccionar algo de la página real), no solo cuando el foco está en el chrome propio
  // (barra de direcciones). `before-input-event` es el evento real de Electron para esto, se
  // dispara ANTES que la página lo vea, así que no hace falta que el sitio coopere ni lo sepa.
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const cmdOrCtrl = input.meta || input.control
    if (key === 'f12' || (cmdOrCtrl && input.alt && key === 'i')) {
      event.preventDefault()
      wc.toggleDevTools()
    } else if (cmdOrCtrl && key === 'p') {
      event.preventDefault()
      wc.print({}, (ok, err) => { if (!ok && err) console.error('[MABRIONA Browser] no se pudo imprimir:', err) })
    }
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
  const oldGroupId = tab.groupId
  if (state) state.window.removeBrowserView(tab.view)
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  tabs.delete(id)
  saveSessionSoon(windowId)
  // Un grupo sin ninguna pestaña real adentro no queda como fantasma en la barra.
  if (oldGroupId) removeGroupIfEmpty(windowId, oldGroupId)
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

// Resuelto por pestaña (no fijo por partición): una pestaña privada puede estar abierta en la
// ventana de cualquier perfil, y el toggle de Shields que ve esa persona en Configuración es el
// de SU perfil activo — tiene que ser el mismo que de verdad filtra esa pestaña.
function installShieldsFor(sess) {
  sess.webRequest.onBeforeRequest((details, callback) => {
    const owner = Array.from(tabs.values()).find((t) => t.view.webContents.id === details.webContentsId)
    const profileStore = storeForWindow(owner ? owner.windowId : null)
    if (!profileStore.getShieldsEnabled()) { callback({ cancel: false }); return }
    let hostname = null
    try { hostname = new URL(details.url).hostname } catch { /* URL rara — dejar pasar */ }
    const blocked = isBlockedHost(hostname)
    if (blocked && owner) { owner.blockedCount += 1; broadcastTabs(owner.windowId) }
    callback({ cancel: blocked })
  })
}

/** Carpeta real de descargas — la que eligió el usuario en Settings (por perfil), o el Downloads del sistema si no eligió ninguna. */
function currentDownloadsDir(profileStore) {
  return profileStore.getDownloadsDir() || app.getPath('downloads')
}

// La partición privada (Modo Privado + Modo Invitado) es una sola, compartida — a diferencia de
// las particiones de perfil (una por perfil, un store fijo), acá el store real se resuelve pestaña
// por pestaña según quién disparó la descarga, para que quede anotada en el perfil correcto.
function installDownloadsFor(sess, fixedStore) {
  sess.on('will-download', (_event, item, webContents) => {
    const owner = webContents ? Array.from(tabs.values()).find((t) => t.view.webContents.id === webContents.id) : null
    const profileStore = fixedStore || storeForWindow(owner ? owner.windowId : null)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const savePath = path.join(currentDownloadsDir(profileStore), item.getFilename())
    item.setSavePath(savePath)
    profileStore.addDownload({ id, filename: item.getFilename(), path: savePath, url: item.getURL(), state: 'progressing', startedAt: Date.now() })
    broadcastDownloadsForStore(profileStore)

    item.on('updated', (_e, state) => {
      profileStore.updateDownload(id, { state })
      broadcastDownloadsForStore(profileStore)
    })
    item.once('done', (_e, state) => {
      profileStore.updateDownload(id, { state, finishedAt: Date.now() })
      broadcastDownloadsForStore(profileStore)
    })
  })
}

/** Solo se avisa a las ventanas que realmente son de ese perfil — las descargas de un perfil no deben aparecer en el panel de otro. */
function broadcastDownloadsForStore(profileStore) {
  for (const windowId of windows.keys()) {
    if (storeForWindow(windowId) !== profileStore) continue
    sendToWindow(windowId, 'downloads:state', profileStore.listDownloads())
  }
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
function installPermissionsFor(sess, persistent, profileStore) {
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
    } else if (permission === 'clipboard-read') {
      kinds = ['clipboard']
    } else if (permission === 'midi' || permission === 'midiSysex') {
      kinds = ['midi']
    }
    if (kinds.length === 0) { callback(false); return }

    let origin
    try { origin = new URL(details.requestingUrl || webContents.getURL()).origin } catch { callback(false); return }

    const getDecision = (o, k) => (persistent ? profileStore.getPermission(o, k) : inMemoryPrivatePermissions.get(o)?.[k] || null)
    const setDecision = (o, k, d) => {
      if (persistent) { profileStore.setPermission(o, k, d); return }
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
  installDownloadsFor(sess) // los archivos descargados SÍ quedan en disco aunque la pestaña sea privada — igual que en cualquier navegador real; el store se resuelve por pestaña (ver installDownloadsFor)
}

// Cada perfil real tiene su propia partición persistente de Chromium (cookies/localStorage/
// IndexedDB/caché) — aislamiento real, no simulado, el mismo mecanismo nativo que ya usaba Modo
// Privado, solo que con `persist:` para que sí quede guardado en disco entre arranques.
const profileSessionsReady = new Set()
function ensureProfileSession(profileId) {
  if (profileSessionsReady.has(profileId)) return
  profileSessionsReady.add(profileId)
  const profileStore = storeFor(profileId)
  const sess = session.fromPartition(registry.partitionFor(profileId))
  installShieldsFor(sess)
  installDownloadsFor(sess, profileStore)
  installPermissionsFor(sess, true, profileStore)
  loadEnabledExtensionsInto(sess, profileStore)
  applySpellcheckLanguages(sess, profileStore)
}

// Solo se aplican idiomas que Chromium de verdad tiene instalados en esta máquina
// (`session.availableSpellCheckerLanguages`, lista real) — un idioma guardado que ya no está
// disponible (se cambió de sistema operativo, por ejemplo) se descarta en silencio en vez de
// tirar un error real al arrancar.
function applySpellcheckLanguages(sess, profileStore) {
  const available = new Set(sess.availableSpellCheckerLanguages)
  const wanted = profileStore.getSpellcheckLanguages().filter((l) => available.has(l))
  sess.setSpellCheckerLanguages(wanted)
}

// Extensiones reales de Chrome (session.loadExtension, API oficial de Electron) — se cargan al
// arrancar la sesión del perfil, igual que Chrome carga las suyas al abrir. Modo Privado/Invitado
// a propósito NO cargan extensiones (mismo default que el Incógnito de Chrome real).
function loadEnabledExtensionsInto(sess, profileStore) {
  for (const record of profileStore.listExtensions()) {
    if (!record.enabled) continue
    sess.loadExtension(record.path, { allowFileAccess: true }).catch((err) => {
      console.error(`[MABRIONA Browser] no se pudo cargar la extensión "${record.name}" (${record.path}):`, err.message)
    })
  }
}

function createWindow(options = {}) {
  const isGuest = !!options.guest
  const profileId = isGuest ? 'guest' : (options.profileId || registry.getLastActiveProfileId())
  if (!isGuest) {
    ensureProfileSession(profileId)
    registry.setLastActiveProfileId(profileId)
  }
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    title: 'MABRIONA Browser',
    backgroundColor: '#060606',
    // La franja blanca real que se veía arriba de todo era la barra de título nativa del sistema
    // operativo — nunca se le había dicho a Electron que la ocultara, aunque el brandbar propio
    // (con su logo y `-webkit-app-region: drag`) ya estaba diseñado para reemplazarla entera.
    // `hidden` en macOS deja los botones de semáforo reales pero saca el resto de la barra nativa.
    // En Windows/Linux `titleBarStyle` no tiene efecto — ahí se sigue usando el marco nativo tal
    // cual, para no romper minimizar/cerrar sin construir controles propios de reemplazo.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 11 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const windowId = nextWindowId++
  windows.set(windowId, { window: win, activeTabId: null, profileId, isGuest, viewReserve: false })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.on('resize', () => layoutActiveView(windowId))
  win.on('closed', () => {
    for (const tab of Array.from(tabs.values())) {
      if (tab.windowId !== windowId) continue
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
      tabs.delete(tab.id)
    }
    windows.delete(windowId)
    guestStoresByWindow.delete(windowId)
  })

  // Modo Invitado nunca restaura ni guarda sesión — no deja rastro, a propósito (mismo criterio
  // que Modo Privado).
  const profileStore = storeFor(profileId)
  const restoreUrls = (!isGuest && options.restoreSession && profileStore.getRestoreSessionOnStartup())
    ? profileStore.getLastSession()
    : []
  if (restoreUrls.length > 0) {
    for (const url of restoreUrls) createAndSwitchTab(url, windowId)
  } else {
    createAndSwitchTab(options.initialUrl || HOME_URL, windowId, { private: isGuest })
  }
  return windowId
}

/** Ventana ya abierta con este perfil, si hay una — para no abrir dos ventanas del mismo perfil sin necesidad al "cambiar" desde el panel. */
function findWindowForProfile(profileId) {
  for (const [windowId, state] of windows) if (!state.isGuest && state.profileId === profileId) return windowId
  return null
}

// Registro real del protocolo `mabriona-browser://` (integración web de
// MABRIONA DJ AI, sin app de escritorio) — `setAsDefaultProtocolClient`
// es lo que de verdad asocia el esquema con esta app a nivel del
// sistema operativo real (no un valor cosmético).
if (!app.isDefaultProtocolClient(DJIA_PROTOCOL)) app.setAsDefaultProtocolClient(DJIA_PROTOCOL)

// macOS entrega la URL vía `open-url` sin necesitar single-instance-lock.
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDjiaProtocolUrl(url)
})

// Windows/Linux entregan la URL como argumento de una segunda
// invocación real del ejecutable — necesita un lock de instancia
// única real (si no, cada clic en el link abriría un proceso nuevo en
// vez de reusar el navegador ya abierto). Se limita a estas dos
// plataformas para no cambiar el comportamiento real ya probado en
// macOS (multi-instancia no es un caso de uso real de esta
// integración en Mac, que usa `open-url`).
if (process.platform !== 'darwin') {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', (_event, argv) => {
      const urlArg = argv.find((a) => a.startsWith(`${DJIA_PROTOCOL}://`))
      if (urlArg) handleDjiaProtocolUrl(urlArg)
      const [, state] = windows.entries().next().value || []
      if (state && !state.window.isDestroyed()) {
        if (state.window.isMinimized()) state.window.restore()
        state.window.focus()
      }
    })
  }
}

app.whenReady().then(() => {
  createWindow({ restoreSession: true })

  // Arranque en frío vía protocolo real en Windows/Linux (el usuario
  // no tenía el navegador abierto todavía) — el propio `process.argv`
  // de este primer proceso ya trae la URL real.
  if (process.platform !== 'darwin') {
    const coldStartUrl = process.argv.find((a) => a.startsWith(`${DJIA_PROTOCOL}://`))
    if (coldStartUrl) handleDjiaProtocolUrl(coldStartUrl)
  }

  app.on('activate', () => {
    if (windows.size === 0) createWindow({ restoreSession: true })
  })

  // Integración oficial con MABRIONA DJ AI — este navegador es el
  // único que DJ AI usa para buscar/elegir videos reales de YouTube
  // (ver `bridge/djiaBridge.js` y `docs/INTEGRACION-DJ-AI.md`).
  djiaBridge = startDjiaBridge({
    userDataPath: app.getPath('userData'),
    createAndSwitchTab,
    getTab: (id) => tabs.get(id),
    getOrCreateTargetWindowId: () => {
      const existing = windows.keys().next()
      return existing.done ? createWindow({ restoreSession: false }) : existing.value
    },
  })
})

let djiaBridge = null
app.on('before-quit', () => {
  if (djiaBridge) djiaBridge.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ===================== IPC =====================

ipcMain.on('view:panel-open', (e, reserve) => {
  const windowId = windowIdForSender(e)
  const state = windows.get(windowId)
  if (!state) return
  state.viewReserve = reserve
  layoutActiveView(windowId)
})

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
  tab.view.webContents.loadURL(resolveAddressInput(input, storeForTab(id).getSearchEngine()))
})
ipcMain.handle('tabs:back', (_e, id) => tabs.get(id)?.view.webContents.goBack())
ipcMain.handle('tabs:forward', (_e, id) => tabs.get(id)?.view.webContents.goForward())
ipcMain.handle('tabs:reload', (_e, id) => tabs.get(id)?.view.webContents.reload())
ipcMain.handle('tabs:stop', (_e, id) => tabs.get(id)?.view.webContents.stop())

ipcMain.handle('tabs:list-groups', (e) => groupsForWindow(windowIdForSender(e)))
ipcMain.handle('tabs:create-group', (_e, { tabId, name, color }) => {
  const tab = tabs.get(tabId)
  if (!tab) return { ok: false }
  const groups = groupsForWindow(tab.windowId)
  const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  groups.push({ id, name: name || 'Grupo', color: color || '#d4ff00', collapsed: false })
  const oldGroupId = tab.groupId
  tab.groupId = id
  if (oldGroupId) removeGroupIfEmpty(tab.windowId, oldGroupId)
  broadcastGroups(tab.windowId)
  broadcastTabs(tab.windowId)
  return { ok: true, groupId: id }
})
ipcMain.handle('tabs:add-to-group', (_e, { tabId, groupId }) => {
  const tab = tabs.get(tabId)
  if (!tab) return
  const oldGroupId = tab.groupId
  tab.groupId = groupId
  broadcastTabs(tab.windowId)
  if (oldGroupId && oldGroupId !== groupId) removeGroupIfEmpty(tab.windowId, oldGroupId)
})
ipcMain.handle('tabs:remove-from-group', (_e, tabId) => {
  const tab = tabs.get(tabId)
  if (!tab) return
  const oldGroupId = tab.groupId
  tab.groupId = null
  broadcastTabs(tab.windowId)
  if (oldGroupId) removeGroupIfEmpty(tab.windowId, oldGroupId)
})
ipcMain.handle('tabs:toggle-group-collapse', (e, groupId) => {
  const windowId = windowIdForSender(e)
  const group = groupsForWindow(windowId).find((g) => g.id === groupId)
  if (!group) return
  group.collapsed = !group.collapsed
  broadcastGroups(windowId)
})
ipcMain.handle('tabs:toggle-devtools', (e) => {
  const tab = activeTabForWindow(windowIdForSender(e))
  if (tab) tab.view.webContents.toggleDevTools()
})
ipcMain.handle('tabs:print', (e) => {
  const tab = activeTabForWindow(windowIdForSender(e))
  if (!tab) return
  tab.view.webContents.print({}, (ok, err) => { if (!ok && err) console.error('[MABRIONA Browser] no se pudo imprimir:', err) })
})

// Modo lectura real — extrae el artículo real de la página (heurística real: el contenedor con
// más texto real en párrafos, no una lista fija de sitios conocidos) y reemplaza el DOM de esa
// pestaña por una vista limpia. "Salir" recarga la URL real — no hay estado que journalear, la
// página original nunca se pierde.
function readerExtractScript() {
  function extract() {
    const candidates = Array.from(document.querySelectorAll('article, main, [role="main"], body'))
    let best = null
    let bestScore = 0
    for (const el of candidates) {
      const paragraphs = Array.from(el.querySelectorAll('p'))
      const score = paragraphs.reduce((sum, p) => sum + (p.textContent || '').trim().length, 0)
      if (score > bestScore) { bestScore = score; best = el }
    }
    if (!best || bestScore < 200) return null
    const title = (document.querySelector('h1')?.textContent || document.title || '').trim()
    const paragraphs = Array.from(best.querySelectorAll('p'))
      .map((p) => p.textContent.trim())
      .filter((t) => t.length > 20)
    return { title, paragraphs }
  }
  return extract()
}

ipcMain.handle('tabs:toggle-reader', async (e) => {
  const tab = activeTabForWindow(windowIdForSender(e))
  if (!tab) return { ok: false }
  const wc = tab.view.webContents
  if (tab.readerActive) {
    tab.readerActive = false
    wc.loadURL(tab.url).catch(() => {})
    return { ok: true, active: false }
  }
  let article
  try {
    article = await wc.executeJavaScript(`(${readerExtractScript.toString()})()`)
  } catch {
    return { ok: false, error: 'no se pudo leer la página real' }
  }
  if (!article) return { ok: false, error: 'esta página no parece tener un artículo real para leer — poco texto real en párrafos' }
  const escapeHtmlServer = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const bodyHtml = `
    <div id="mabriona-reader" style="max-width:680px;margin:0 auto;padding:64px 24px 96px;font-family:Georgia,'Times New Roman',serif;color:#f2f2f2;line-height:1.7;font-size:18px;background:#0a0a0a;min-height:100vh;">
      <h1 style="font-family:-apple-system,sans-serif;font-size:32px;font-weight:800;margin-bottom:28px;color:#fff;">${escapeHtmlServer(article.title)}</h1>
      ${article.paragraphs.map((p) => `<p style="margin:0 0 20px;">${escapeHtmlServer(p)}</p>`).join('')}
    </div>`
  try {
    await wc.executeJavaScript(`document.documentElement.innerHTML = ${JSON.stringify(`<head><meta charset="utf-8"></head><body style="margin:0;background:#0a0a0a;">${bodyHtml}</body>`)}`)
  } catch {
    return { ok: false, error: 'no se pudo mostrar la vista de lectura' }
  }
  tab.readerActive = true
  return { ok: true, active: true }
})

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
// Hereda el perfil de la ventana desde la que se pidió — Cmd+N abre otra ventana del mismo
// perfil, no cambia a "el último usado" por sorpresa.
ipcMain.handle('windows:new', (e, initialUrl) => {
  const cur = windows.get(windowIdForSender(e))
  createWindow({ profileId: cur ? cur.profileId : undefined, initialUrl: initialUrl || undefined })
  return true
})
// Modo Invitado real — ventana nueva, sesión en memoria compartida con Modo Privado (nunca toca
// disco), sin restaurar ni guardar sesión.
ipcMain.handle('windows:new-guest', () => { createWindow({ guest: true }); return true })

ipcMain.handle('history:list', (e) => storeForWindow(windowIdForSender(e)).getState().history)

// Verificación real del lado seguro: el sender de esta llamada es el webContents de la propia
// pestaña (una BrowserView, no la ventana de chrome), así que `windowIdForSender` no sirve acá —
// se busca directamente cuál pestaña es. Solo responde con datos reales si esa pestaña está
// realmente mostrando `newtab.html` en este momento — cualquier otro sitio que intente llamar a
// este mismo puente (expuesto sin querer en todas las pestañas, ver search-preload.js) recibe una
// lista vacía, nunca el historial real de la persona.
ipcMain.handle('newtab:top-sites', (e) => {
  const tab = Array.from(tabs.values()).find((t) => t.view.webContents.id === e.sender.id)
  if (!tab || tab.isPrivate || e.sender.getURL() !== HOME_URL) return []
  return computeTopSites(storeForWindow(tab.windowId))
})
ipcMain.handle('history:clear', (e) => storeForWindow(windowIdForSender(e)).clearHistory())
ipcMain.handle('history:remove', (e, url) => storeForWindow(windowIdForSender(e)).removeHistoryEntry(url))

ipcMain.handle('favorites:list', (e) => storeForWindow(windowIdForSender(e)).listFavorites())
ipcMain.handle('favorites:add', (e, fav) => storeForWindow(windowIdForSender(e)).addFavorite(fav))
ipcMain.handle('favorites:remove', (e, url) => storeForWindow(windowIdForSender(e)).removeFavorite(url))
ipcMain.handle('favorites:is', (e, url) => storeForWindow(windowIdForSender(e)).isFavorite(url))
ipcMain.handle('favorites:rename', (e, url, title) => storeForWindow(windowIdForSender(e)).renameFavorite(url, title))
ipcMain.handle('favorites:update-url', (e, oldUrl, newUrl) => storeForWindow(windowIdForSender(e)).updateFavoriteUrl(oldUrl, newUrl))
ipcMain.handle('favorites:move', (e, url, folderId) => storeForWindow(windowIdForSender(e)).moveFavorite(url, folderId))
ipcMain.handle('favorites:reorder', (e, url, order) => storeForWindow(windowIdForSender(e)).reorderFavorite(url, order))

ipcMain.handle('folders:list', (e) => storeForWindow(windowIdForSender(e)).listFolders())
ipcMain.handle('folders:create', (e, name, parentId) => storeForWindow(windowIdForSender(e)).createFolder(name, parentId))
ipcMain.handle('folders:rename', (e, id, name) => storeForWindow(windowIdForSender(e)).renameFolder(id, name))
ipcMain.handle('folders:move', (e, id, newParentId) => storeForWindow(windowIdForSender(e)).moveFolder(id, newParentId))
ipcMain.handle('folders:reorder', (e, id, order) => storeForWindow(windowIdForSender(e)).reorderFolder(id, order))
ipcMain.handle('folders:delete', (e, id) => storeForWindow(windowIdForSender(e)).deleteFolder(id))

// ===================== Compartir real: copiar link + código QR (100% local, sin red) =====================
// Electron no tiene un panel de "compartir" nativo del sistema (verificado: `shell` no expone esa
// función, ni en Mac ni en Windows/Linux) — esto es lo real que sí se puede dar: copiar la URL al
// portapapeles real del sistema operativo, y un código QR generado 100% en esta máquina (sin
// mandar la URL a ningún servicio externo) para escanear con el celular.
ipcMain.handle('utils:copy-text', (_e, text) => { clipboard.writeText(text); return true })
ipcMain.handle('utils:generate-qr', async (_e, text) => {
  try {
    return await QRCode.toDataURL(text, { margin: 1, width: 240 })
  } catch {
    return null
  }
})

// ===================== Traductor real (DeepL) =====================
// Fase 1.4.3: mismo criterio real que Search (Fase 21) — la key real de DeepL de MABRIONA nunca
// viaja empaquetada dentro del `.app`/`.exe` distribuido. Sin una key propia configurada
// (`registry.getDeeplApiKey()`), se llama al proxy real `mabriona.com/api/browser-translate` (la
// key de MABRIONA vive solo ahí, server-side). Si la persona configuró su PROPIA key, esa sigue
// yendo directo a DeepL con su propia cuenta — nunca se manda una key ajena al proxy de MABRIONA.
// Traduce nodo de texto real por nodo de texto real (no el HTML entero) para no arriesgar
// corromper <script>/<style> ni romper el layout de la página.
const TRANSLATE_MAX_NODES = 500 // tope real por página — cuida la cuota mensual real de la cuenta
const TRANSLATE_CHUNK_SIZE = 50 // máximo real de textos por pedido de traducción

function extractTranslatableTextScript() {
  return `(function() {
    window.__mabrionaTranslateNodes = [];
    const skipTags = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','TITLE']);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        let el = node.parentElement;
        while (el) {
          if (skipTags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
          el = el.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    const texts = [];
    while ((n = walker.nextNode())) {
      window.__mabrionaTranslateNodes.push(n);
      texts.push(n.nodeValue);
      if (texts.length >= ${TRANSLATE_MAX_NODES}) break;
    }
    return texts;
  })()`
}

ipcMain.handle('translate:get-languages', () => TRANSLATE_LANGUAGES)

ipcMain.handle('translate:page', async (e, targetLang) => {
  const ownApiKey = registry.getDeeplApiKey()
  const state = windows.get(windowIdForSender(e))
  const tab = state && state.activeTabId != null ? tabs.get(state.activeTabId) : null
  if (!tab) return { configured: true, error: 'no hay una pestaña activa real' }
  const wc = tab.view.webContents

  let originalTexts
  try {
    originalTexts = await wc.executeJavaScript(extractTranslatableTextScript())
  } catch (err) {
    return { configured: true, error: String(err) }
  }
  if (!originalTexts || originalTexts.length === 0) return { configured: true, translatedCount: 0 }

  const translated = []
  for (let i = 0; i < originalTexts.length; i += TRANSLATE_CHUNK_SIZE) {
    const chunk = originalTexts.slice(i, i + TRANSLATE_CHUNK_SIZE)
    try {
      const { url, headers, body } = ownApiKey
        ? buildTranslateRequest(chunk, targetLang, ownApiKey)
        : {
            url: `${MABRIONA_PROXY_BASE}/browser-translate`,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk, target_lang: targetLang }),
          }
      const res = await fetch(url, { method: 'POST', headers, body })
      if (!res.ok) return { configured: true, error: `error ${res.status} ${ownApiKey ? 'de DeepL' : 'del traductor de MABRIONA'}` }
      const data = await res.json()
      const chunkTranslated = normalizeTranslateResponse(data)
      if (!chunkTranslated) return { configured: true, error: 'respuesta inesperada del traductor' }
      translated.push(...chunkTranslated)
    } catch (err) {
      return { configured: true, error: String(err) }
    }
  }

  const applyScript = `(function(translated) {
    const nodes = window.__mabrionaTranslateNodes || [];
    for (let i = 0; i < nodes.length && i < translated.length; i++) nodes[i].nodeValue = translated[i];
    delete window.__mabrionaTranslateNodes;
    return nodes.length;
  })(${JSON.stringify(translated)})`
  const appliedCount = await wc.executeJavaScript(applyScript)
  return { configured: true, translatedCount: appliedCount, truncated: originalTexts.length >= TRANSLATE_MAX_NODES }
})

ipcMain.handle('downloads:list', (e) => storeForWindow(windowIdForSender(e)).listDownloads())
ipcMain.handle('downloads:open', (_e, filePath) => shell.openPath(filePath))
ipcMain.handle('downloads:show', (_e, filePath) => shell.showItemInFolder(filePath))

// Captura de pantalla real de la pestaña activa (Electron `capturePage`, no un mock) — se guarda
// como PNG real en Descargas y aparece en el mismo panel de Descargas que ya existe (sin duplicar
// UI para esto).
ipcMain.handle('tabs:screenshot', async (_e, id) => {
  const tab = tabs.get(id)
  if (!tab || tab.view.webContents.isDestroyed()) return { ok: false, error: 'la pestaña ya no existe' }
  const profileStore = storeForWindow(tab.windowId)
  try {
    const image = await tab.view.webContents.capturePage()
    const filename = `mabriona-browser-captura-${Date.now()}.png`
    const savePath = path.join(currentDownloadsDir(profileStore), filename)
    fs.writeFileSync(savePath, image.toPNG())
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    profileStore.addDownload({ id: entryId, filename, path: savePath, url: tab.url, state: 'completed', startedAt: now, finishedAt: now })
    broadcastDownloadsForStore(profileStore)
    return { ok: true, path: savePath }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('shields:get-enabled', (e) => storeForWindow(windowIdForSender(e)).getShieldsEnabled())
ipcMain.handle('shields:set-enabled', (e, enabled) => storeForWindow(windowIdForSender(e)).setShieldsEnabled(enabled))

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
ipcMain.handle('permissions:list', (e) => storeForWindow(windowIdForSender(e)).listPermissions())
ipcMain.handle('permissions:set', (e, { origin, kind, decision }) => storeForWindow(windowIdForSender(e)).setPermission(origin, kind, decision))
ipcMain.handle('permissions:clear', (e, { origin, kind }) => storeForWindow(windowIdForSender(e)).clearPermission(origin, kind))

// Settings — Descargas: diálogo real de macOS (dialog.showOpenDialog), no un input de texto libre.
ipcMain.handle('settings:get-downloads-dir', (e) => currentDownloadsDir(storeForWindow(windowIdForSender(e))))
ipcMain.handle('settings:choose-downloads-dir', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const profileStore = storeForWindow(windowIdForSender(e))
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return currentDownloadsDir(profileStore)
  profileStore.setDownloadsDir(result.filePaths[0])
  return currentDownloadsDir(profileStore)
})

// Settings — General/Búsqueda, por perfil (cada perfil real tiene su propia elección, igual que
// su propia carpeta de descargas o sus propios permisos).
ipcMain.handle('settings:get-search-engine', (e) => storeForWindow(windowIdForSender(e)).getSearchEngine())
ipcMain.handle('settings:set-search-engine', (e, engine) => storeForWindow(windowIdForSender(e)).setSearchEngine(engine))

ipcMain.handle('settings:get-spellcheck-languages', (e) => {
  const { profileStore, sess } = profileStoreAndSessionFor(windowIdForSender(e))
  return { available: sess.availableSpellCheckerLanguages, selected: profileStore.getSpellcheckLanguages() }
})
ipcMain.handle('settings:set-spellcheck-languages', (e, langs) => {
  const windowId = windowIdForSender(e)
  const { profileStore, sess } = profileStoreAndSessionFor(windowId)
  profileStore.setSpellcheckLanguages(langs)
  applySpellcheckLanguages(sess, profileStore)
  return { ok: true }
})
ipcMain.handle('settings:get-restore-session', (e) => storeForWindow(windowIdForSender(e)).getRestoreSessionOnStartup())
ipcMain.handle('settings:set-restore-session', (e, enabled) => storeForWindow(windowIdForSender(e)).setRestoreSessionOnStartup(enabled))

// ===================== Perfiles =====================

ipcMain.handle('profiles:list', () => registry.list())
ipcMain.handle('profiles:get-active', (e) => {
  const state = windows.get(windowIdForSender(e))
  if (!state) return null
  if (state.isGuest) return { id: 'guest', name: 'Invitado', emoji: '🕶️', isGuest: true }
  return { ...registry.get(state.profileId), isGuest: false }
})
ipcMain.handle('profiles:create', (_e, { name, emoji }) => registry.create(name, emoji))
ipcMain.handle('profiles:rename', (_e, { id, name }) => registry.rename(id, name))
ipcMain.handle('profiles:can-delete', (_e, id) => registry.canDelete(id))
ipcMain.handle('profiles:delete', (_e, id) => {
  if (!registry.canDelete(id)) return { ok: false, reason: 'no se puede borrar este perfil' }
  if (findWindowForProfile(id) != null) return { ok: false, reason: 'ese perfil está abierto en una ventana ahora mismo — cerrala primero' }
  const removed = registry.remove(id)
  if (!removed) return { ok: false, reason: 'no se pudo borrar' }
  // Borrado real de datos: el archivo de ese perfil y todo lo que Chromium guardó en su partición
  // (cookies/localStorage/IndexedDB/caché) — no queda ni rastro en disco, no solo se lo saca de la lista.
  storesByProfile.delete(id)
  try { fs.unlinkSync(registry.dataFilePathFor(app.getPath('userData'), id)) } catch { /* ya no existía */ }
  session.fromPartition(registry.partitionFor(id)).clearStorageData().catch(() => {})
  profileSessionsReady.delete(id)
  return { ok: true }
})
// Cambiar de perfil: si ya hay una ventana abierta con ese perfil, se enfoca esa (no se abren dos
// ventanas del mismo perfil sin que la persona lo pida con Cmd+N); si no, se abre una nueva.
ipcMain.handle('profiles:switch-to', (_e, profileId) => {
  const existing = findWindowForProfile(profileId)
  if (existing != null) {
    windows.get(existing).window.focus()
    // "Último perfil activo" tiene que reflejar de verdad al que la persona está usando, no solo
    // al que se creó más recientemente — si no, la próxima vez que abra la app arrancaría en el
    // perfil equivocado aunque haya vuelto a enfocar Principal antes de cerrar.
    registry.setLastActiveProfileId(profileId)
    return existing
  }
  return createWindow({ profileId, restoreSession: true })
})

// ===================== Extensiones reales de Chrome =====================
// MABRIONA es Chromium (Electron) — el mismo formato de extensión (manifest.json + código) que
// usan Chrome/Edge/Brave/Opera funciona acá tal cual, con `session.loadExtension` (API oficial de
// Electron). Ver extensions.js para las 3 formas reales de agregar una. Por perfil, igual que el
// resto de la configuración — cada perfil tiene sus propias extensiones instaladas.

function profileStoreAndSessionFor(windowId) {
  const state = windows.get(windowId)
  const profileId = state && !state.isGuest ? state.profileId : 'default'
  return { profileId, profileStore: storeFor(profileId), sess: session.fromPartition(registry.partitionFor(profileId)) }
}

async function loadAndRecord(profileStore, sess, record) {
  const loaded = await sess.loadExtension(record.path, { allowFileAccess: true })
  const manifest = extensionsLib.readManifestSafe(record.path)
  const actionInfo = manifest ? extensionsLib.resolveActionInfo(record.path, manifest) : { icon: null, popup: null }
  // "pinned: true" por defecto — igual que Chrome real, una extensión recién instalada aparece
  // de entrada en la barra; la persona la puede sacar después sin desinstalarla.
  const fullRecord = { ...record, chromeExtensionId: loaded.id, actionIcon: actionInfo.icon, actionPopup: actionInfo.popup, pinned: true }
  profileStore.addExtensionRecord(fullRecord)
  return fullRecord
}

ipcMain.handle('extensions:list', (e) => storeForWindow(windowIdForSender(e)).listExtensions())

ipcMain.handle('extensions:load-unpacked', async (e) => {
  const winId = windowIdForSender(e)
  const win = windows.get(winId)?.window
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Elegí la carpeta de la extensión (con manifest.json)' })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
  try {
    const { profileStore, sess } = profileStoreAndSessionFor(winId)
    const record = extensionsLib.loadUnpacked(result.filePaths[0])
    const fullRecord = await loadAndRecord(profileStore, sess, record)
    return { ok: true, record: fullRecord }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Extensiones reales ya instaladas en Chrome/Edge/Brave/Chromium de esta misma máquina — mismo
// formato en disco, listas para importar (no depende de red).
ipcMain.handle('extensions:scan-other-browsers', () => extensionsLib.scanOtherBrowsers())

ipcMain.handle('extensions:import', async (e, sourcePath) => {
  const winId = windowIdForSender(e)
  try {
    const { profileId, profileStore, sess } = profileStoreAndSessionFor(winId)
    const record = extensionsLib.importFromFolder(sourcePath, app.getPath('userData'), profileId)
    const fullRecord = await loadAndRecord(profileStore, sess, record)
    return { ok: true, record: fullRecord }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Instalar por ID o link de la Chrome Web Store — descarga el .crx real (endpoint público de
// actualización de Google, el mismo que usa Chrome) y lo instala. No es el botón "Agregar a
// Chrome" de la tienda (esa integración depende de una API privada de Google que Electron no
// expone) — el resultado real es el mismo, solo cambia cómo se inicia la instalación.
ipcMain.handle('extensions:install-from-webstore', async (e, idOrUrl) => {
  const winId = windowIdForSender(e)
  try {
    const { profileId, profileStore, sess } = profileStoreAndSessionFor(winId)
    const record = await extensionsLib.installFromChromeWebStore(idOrUrl, app.getPath('userData'), profileId)
    const fullRecord = await loadAndRecord(profileStore, sess, record)
    return { ok: true, record: fullRecord }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('extensions:set-enabled', (e, { recordId, enabled }) => {
  const winId = windowIdForSender(e)
  const { profileStore, sess } = profileStoreAndSessionFor(winId)
  const record = profileStore.listExtensions().find((x) => x.recordId === recordId)
  if (!record) return { ok: false, error: 'esa extensión ya no existe' }
  profileStore.setExtensionEnabled(recordId, enabled)
  if (enabled) {
    sess.loadExtension(record.path, { allowFileAccess: true }).catch((err) => console.error('[MABRIONA Browser] no se pudo recargar la extensión:', err.message))
  } else if (record.chromeExtensionId) {
    try { sess.removeExtension(record.chromeExtensionId) } catch { /* ya no estaba cargada */ }
  }
  return { ok: true }
})

ipcMain.handle('extensions:set-pinned', (e, { recordId, pinned }) => {
  const { profileStore } = profileStoreAndSessionFor(windowIdForSender(e))
  const record = profileStore.listExtensions().find((x) => x.recordId === recordId)
  if (!record) return { ok: false, error: 'esa extensión ya no existe' }
  profileStore.setExtensionPinned(recordId, pinned)
  return { ok: true }
})

// Popup real de la extensión (manifest.action/browser_action.default_popup) — Electron carga
// `session.loadExtension` (background/content scripts/APIs reales) pero NO dibuja un ícono ni un
// popup nativo solo, a diferencia de Chrome — así que se abre una ventana real, chica, sin marco,
// cargando la página real de la extensión (`chrome-extension://<id>/<popup>`) en la MISMA sesión
// del perfil (comparte cookies/storage con el resto de la extensión). Se cierra sola al perder el
// foco, como un popup real. Si la extensión no declara ningún popup, se informa honesto en vez de
// abrir una ventana vacía fingiendo que hay algo.
ipcMain.handle('extensions:open-popup', (e, { recordId, x, y }) => {
  const winId = windowIdForSender(e)
  const { profileStore, sess } = profileStoreAndSessionFor(winId)
  const record = profileStore.listExtensions().find((r) => r.recordId === recordId)
  if (!record) return { ok: false, error: 'esa extensión ya no existe' }
  if (!record.actionPopup || !record.chromeExtensionId) return { ok: false, error: 'no-popup' }
  const popup = new BrowserWindow({
    width: 380,
    height: 520,
    x: Math.round(x),
    y: Math.round(y),
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    webPreferences: { session: sess, contextIsolation: true, sandbox: true },
  })
  popup.loadURL(`chrome-extension://${record.chromeExtensionId}/${record.actionPopup}`)
  popup.once('ready-to-show', () => popup.show())
  popup.on('blur', () => { if (!popup.isDestroyed()) popup.close() })
  return { ok: true }
})

ipcMain.handle('extensions:remove', (e, recordId) => {
  const winId = windowIdForSender(e)
  const { profileStore, sess } = profileStoreAndSessionFor(winId)
  const record = profileStore.listExtensions().find((x) => x.recordId === recordId)
  if (!record) return { ok: false, error: 'esa extensión ya no existe' }
  if (record.chromeExtensionId) {
    try { sess.removeExtension(record.chromeExtensionId) } catch { /* ya no estaba cargada */ }
  }
  extensionsLib.removeExtensionFiles(record)
  profileStore.removeExtensionRecord(recordId)
  return { ok: true }
})

// ===================== Contraseñas reales =====================
// Cifradas con `safeStorage` (API real de Electron — usa el Keychain real en macOS, DPAPI en
// Windows, libsecret/kwallet en Linux vía el sistema operativo, nunca una clave propia inventada
// acá). Nunca en texto plano en disco. El texto plano solo existe en memoria del proceso
// principal, jamás se guarda ni se manda de vuelta al renderer salvo que la persona pida
// explícitamente "mostrar" una contraseña puntual, o para autocompletar el origen exacto que la
// pidió.

function genPasswordId() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// Capturas pendientes de confirmación real del usuario (el banner "¿Guardar la contraseña?") —
// el texto plano vive acá, en memoria, nunca se lo mandamos al renderer hasta que haya que cifrar
// y guardar de verdad. Una por ventana (la última capturada pisa a la anterior — no hace falta más
// de un banner pendiente a la vez en la práctica real).
const pendingPasswordCapture = new Map() // windowId -> { origin, username, password }

ipcMain.on('passwords:capture', (e, { url, username, password }) => {
  const windowId = windowIdForSenderFromBrowserView(e.sender)
  if (windowId == null || !url || !password) return
  let origin
  try { origin = new URL(url).origin } catch { return }
  const state = windows.get(windowId)
  if (!state || state.isGuest) return // Modo Invitado: nunca ofrece guardar nada, mismo criterio que historial/favoritos
  const profileStore = storeForWindow(windowId)
  // Si ya existe exactamente el mismo origen+usuario+contraseña guardado, no hay nada nuevo que
  // ofrecer — evita mostrar el banner en cada login normal a un sitio ya guardado.
  const already = profileStore.listPasswords().find((p) => p.origin === origin && p.username === username)
  if (already && safeStorage.isEncryptionAvailable()) {
    try {
      if (safeStorage.decryptString(Buffer.from(already.encryptedPassword, 'base64')) === password) return
    } catch { /* no se pudo descifrar la guardada — seguir y ofrecer guardar la nueva igual */ }
  }
  pendingPasswordCapture.set(windowId, { origin, username, password })
  sendToWindow(windowId, 'passwords:save-prompt', { origin, username })
})

ipcMain.handle('passwords:confirm-save', (e) => {
  const windowId = windowIdForSender(e)
  const pending = windowId != null ? pendingPasswordCapture.get(windowId) : null
  if (!pending) return { ok: false, error: 'no hay ninguna contraseña real pendiente de guardar' }
  pendingPasswordCapture.delete(windowId)
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'el sistema operativo no tiene disponible el cifrado real (Keychain/credential store) en esta máquina — no se guarda nada sin cifrar' }
  }
  const profileStore = storeForWindow(windowId)
  const encryptedPassword = safeStorage.encryptString(pending.password).toString('base64')
  // Si ya había una guardada para el mismo origen+usuario, se reemplaza (actualizar contraseña),
  // no se duplica.
  const existing = profileStore.listPasswords().find((p) => p.origin === pending.origin && p.username === pending.username)
  if (existing) profileStore.removePasswordRecord(existing.id)
  profileStore.addPasswordRecord({ id: genPasswordId(), origin: pending.origin, username: pending.username, encryptedPassword, createdAt: Date.now() })
  return { ok: true }
})

ipcMain.on('passwords:dismiss-prompt', (e) => {
  const windowId = windowIdForSender(e)
  if (windowId != null) pendingPasswordCapture.delete(windowId)
})

// Lista real para el panel de Contraseñas — nunca incluye la contraseña descifrada, solo
// origen/usuario/fecha. "Mostrar" una puntual es un pedido aparte (passwords:reveal).
ipcMain.handle('passwords:list', (e) => {
  return storeForWindow(windowIdForSender(e)).listPasswords().map(({ id, origin, username, createdAt }) => ({ id, origin, username, createdAt }))
})

ipcMain.handle('passwords:reveal', (e, id) => {
  const record = storeForWindow(windowIdForSender(e)).listPasswords().find((p) => p.id === id)
  if (!record) return { ok: false, error: 'esa contraseña ya no existe' }
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'no se puede descifrar en esta máquina' }
  try {
    return { ok: true, password: safeStorage.decryptString(Buffer.from(record.encryptedPassword, 'base64')) }
  } catch {
    return { ok: false, error: 'no se pudo descifrar esta contraseña real (¿se movió el perfil a otra máquina? el cifrado real está atado a esta computadora)' }
  }
})

ipcMain.handle('passwords:remove', (e, id) => {
  storeForWindow(windowIdForSender(e)).removePasswordRecord(id)
  return { ok: true }
})

// ===================== Autocompletar real de direcciones/tarjetas =====================
// Mismo criterio de seguridad que las contraseñas: el número de tarjeta se cifra con safeStorage
// real antes de guardarse — nunca en texto plano. El CVC nunca se pide para guardar, ni acá ni en
// ningún lado: se sigue pidiendo siempre de nuevo en cada compra, igual que Chrome/Brave real.

function genAutofillId() {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

ipcMain.handle('autofill:list', (e) => {
  return storeForWindow(windowIdForSender(e)).listAutofillProfiles().map((p) => {
    if (p.type !== 'card') return p
    // Nunca se manda el número real completo de vuelta salvo que haga falta llenar un formulario
    // real — para la lista alcanza con los últimos 4 dígitos, como cualquier resumen de tarjeta.
    let last4 = '····'
    if (safeStorage.isEncryptionAvailable()) {
      try { last4 = safeStorage.decryptString(Buffer.from(p.encryptedNumber, 'base64')).slice(-4) } catch { /* no se pudo, se muestra genérico */ }
    }
    return { id: p.id, type: p.type, fields: { ...p.fields, last4 } }
  })
})

ipcMain.handle('autofill:add', (e, { type, fields, cardNumber }) => {
  const profileStore = storeForWindow(windowIdForSender(e))
  if (type === 'card') {
    if (!cardNumber || !safeStorage.isEncryptionAvailable()) return { ok: false, error: 'el sistema operativo no tiene disponible el cifrado real en esta máquina — no se guarda una tarjeta sin cifrar' }
    const encryptedNumber = safeStorage.encryptString(cardNumber).toString('base64')
    profileStore.addAutofillProfile({ id: genAutofillId(), type: 'card', fields, encryptedNumber, createdAt: Date.now() })
  } else {
    profileStore.addAutofillProfile({ id: genAutofillId(), type: 'address', fields, createdAt: Date.now() })
  }
  return { ok: true }
})

ipcMain.handle('autofill:remove', (e, id) => {
  storeForWindow(windowIdForSender(e)).removeAutofillProfile(id)
  return { ok: true }
})

// Para llenar un formulario real — la primera dirección y la primera tarjeta guardadas (a
// diferencia de las contraseñas, esto no está atado a un origen: los datos personales de la
// persona son los mismos en cualquier sitio, así que no hace falta desambiguar por dominio).
ipcMain.handle('autofill:for-fill', (e) => {
  const tab = Array.from(tabs.values()).find((t) => t.view.webContents.id === e.sender.id)
  if (!tab || tab.isPrivate) return { address: null, card: null }
  const profiles = storeForWindow(tab.windowId).listAutofillProfiles()
  const address = profiles.find((p) => p.type === 'address') || null
  const cardRecord = profiles.find((p) => p.type === 'card') || null
  let card = null
  if (cardRecord && safeStorage.isEncryptionAvailable()) {
    try {
      card = { ...cardRecord.fields, number: safeStorage.decryptString(Buffer.from(cardRecord.encryptedNumber, 'base64')) }
    } catch { /* no se pudo descifrar — no se autocompleta tarjeta */ }
  }
  return { address: address ? address.fields : null, card }
})

// Autocompletar real — solo si hay EXACTAMENTE una credencial guardada para este origen exacto (si
// hay más de una, no adivina cuál: mejor no autocompletar nada que completar la cuenta
// equivocada). El origen se calcula acá, del lado seguro, directo de la URL real del propio
// sender (`e.sender.getURL()`) — nunca se le pide a la página que diga cuál es su origen, así no
// hay forma de que un valor mal calculado o falsificado del lado de la página cause un descarte o
// un autocompletado en el origen equivocado.
ipcMain.handle('passwords:for-autofill', (e) => {
  const tab = Array.from(tabs.values()).find((t) => t.view.webContents.id === e.sender.id)
  if (!tab || tab.isPrivate) return null
  let realOrigin
  try { realOrigin = new URL(e.sender.getURL()).origin } catch { return null }
  const profileStore = storeForWindow(tab.windowId)
  const matches = profileStore.listPasswords().filter((p) => p.origin === realOrigin)
  if (matches.length !== 1 || !safeStorage.isEncryptionAvailable()) return null
  try {
    return { username: matches[0].username, password: safeStorage.decryptString(Buffer.from(matches[0].encryptedPassword, 'base64')) }
  } catch {
    return null
  }
})

// Búsqueda propia de MABRIONA (Brave Search API por atrás, resultados mostrados 100% con el
// diseño de MABRIONA). Fase 21: la key real de MABRIONA ya NO viaja empaquetada dentro del
// `.app`/`.exe` distribuido (se podía extraer con `asar extract` — hallazgo real de la Fase 20) —
// vive solo en el servidor (`BRAVE_API_KEY` en Vercel), y este proceso principal llama al proxy
// real `mabriona.com/api/browser-search` en vez de a Brave directo. Si la persona configuró su
// PROPIA key (`registry.getBraveApiKey()`, ver `scripts/set-brave-key.js`), esa sigue yendo directo
// a Brave con su propia cuenta — nunca se manda una key ajena al proxy de MABRIONA.
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
  const ownApiKey = registry.getBraveApiKey()
  try {
    const { url, headers } = ownApiKey
      ? buildRequest(text, ownApiKey, { freshness })
      : {
          url: `${MABRIONA_PROXY_BASE}/browser-search?q=${encodeURIComponent(text)}${VALID_FRESHNESS.has(freshness) ? `&freshness=${freshness}` : ''}`,
          headers: { Accept: 'application/json' },
        }
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
  const ownApiKey = registry.getBraveApiKey()
  try {
    const { url, headers } = ownApiKey
      ? buildImagesRequest(text, ownApiKey)
      : { url: `${MABRIONA_PROXY_BASE}/browser-images?q=${encodeURIComponent(text)}`, headers: { Accept: 'application/json' } }
    const res = await fetch(url, { headers })
    if (!res.ok) return { configured: true, error: `error ${res.status}`, images: [] }
    const data = await res.json()
    return { configured: true, images: normalizeImages(data) }
  } catch (err) {
    return { configured: true, error: String(err), images: [] }
  }
})

ipcMain.handle('privacy:clear-data', async (e) => {
  const state = windows.get(windowIdForSender(e))
  const partition = state ? registry.partitionFor(state.profileId) : 'persist:mabriona-browser'
  const sess = session.fromPartition(partition)
  await sess.clearStorageData()
  await sess.clearCache()
  return true
})

// ===================== Importar datos de otro navegador =====================
// Real y local — ver browserImport.js. Nunca sube nada a ningún servidor, nunca toca contraseñas
// ni cookies (fuera de alcance de esta fase, ver docs/MABRIONA-BROWSER-IMPORT.md). Modo Invitado
// nunca ve el asistente de bienvenida — no tendría sentido en una sesión que se va a olvidar sola.

ipcMain.handle('onboarding:get-status', (e) => {
  const winId = windowIdForSender(e)
  const state = windows.get(winId)
  if (state && state.isGuest) return { show: false }
  return { show: !storeForWindow(winId).getHasCompletedOnboarding() }
})
ipcMain.handle('onboarding:set-completed', (e) => {
  storeForWindow(windowIdForSender(e)).setHasCompletedOnboarding(true)
  return true
})

ipcMain.handle('import:scan-sources', () => browserImportLib.scanAllSources())

ipcMain.handle('import:run', async (e, { source, importBookmarks, importHistory }) => {
  const profileStore = storeForWindow(windowIdForSender(e))
  const result = { favoritesImported: 0, historyImported: 0, error: null }
  try {
    if (source.engine === 'chromium') {
      if (importBookmarks && source.bookmarksPath) {
        const bookmarks = browserImportLib.readChromiumBookmarks(source.bookmarksPath)
        result.favoritesImported = profileStore.importFavorites(bookmarks)
      }
      if (importHistory && source.historyPath) {
        const history = await browserImportLib.readChromiumHistory(source.historyPath)
        result.historyImported = profileStore.importHistoryEntries(history)
      }
    } else if (source.engine === 'firefox') {
      const data = await browserImportLib.readFirefoxData(source.placesPath)
      if (importBookmarks) result.favoritesImported = profileStore.importFavorites(data.bookmarks)
      if (importHistory) result.historyImported = profileStore.importHistoryEntries(data.history)
    }
  } catch (err) {
    result.error = String(err && err.message ? err.message : err)
  }
  return result
})
