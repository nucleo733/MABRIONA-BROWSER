'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * Persistencia real del navegador (historial/favoritos/descargas/config
 * de MABRIONA SHIELDS) — un archivo JSON en userData, mismo criterio
 * liviano que el resto del ecosistema MABRIONA (localStorage en la web,
 * JSON acá porque no hay localStorage en el proceso principal).
 */
// braveApiKey queda acá por compatibilidad hacia atrás (versiones previas al sistema de perfiles
// la guardaban en el store del perfil "Principal") — desde profiles.js pasó a ser global, este
// campo ya no se lee en main.js, pero no se borra: eliminar un campo de un archivo real del
// usuario sin necesidad es un riesgo de datos que no vale la pena correr.
// Función, no un objeto — un objeto compartido acá sería un bug real: `{...DEFAULTS}` solo copia
// superficial, así que campos anidados (`history`, `permissions`, etc.) quedarían con la MISMA
// referencia en todos los perfiles cuyo archivo todavía no existe, y mutar uno mutaría a todos.
function freshDefaults() {
  return {
    history: [],
    favorites: [],
    downloads: [],
    shieldsEnabled: true,
    braveApiKey: null,
    permissions: {},
    downloadsDir: null,
    lastSession: [],
    searchEngine: 'mabriona', // 'mabriona' | 'google' | 'bing' | 'duckduckgo' | 'brave'
    restoreSessionOnStartup: true,
  }
}

function createStore(filePath) {
  function readAll() {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return { ...freshDefaults(), ...parsed }
    } catch {
      return freshDefaults()
    }
  }

  function writeAll(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  }

  return buildStore(readAll, writeAll)
}

/**
 * Store real en memoria — misma forma e interfaz que `createStore`, pero `writeAll` nunca toca
 * disco. Es lo que usa cada ventana de Modo Invitado: cuando se cierra la ventana, este objeto se
 * descarta entero y no queda ni un archivo con lo que pasó en esa sesión (mismo criterio que la
 * partición en memoria de Modo Privado, ver main.js).
 */
function createMemoryStore() {
  return buildStore(() => freshDefaults(), () => {})
}

function buildStore(readAll, writeAll) {
  let data = readAll()

  return {
    getState: () => data,

    addHistoryEntry(entry) {
      data.history = [entry, ...data.history.filter((h) => h.url !== entry.url)].slice(0, 2000)
      writeAll(data)
      return data.history
    },
    clearHistory() {
      data.history = []
      writeAll(data)
      return data.history
    },
    removeHistoryEntry(url) {
      data.history = data.history.filter((h) => h.url !== url)
      writeAll(data)
      return data.history
    },

    listFavorites: () => data.favorites,
    addFavorite(fav) {
      if (data.favorites.some((f) => f.url === fav.url)) return data.favorites
      data.favorites = [fav, ...data.favorites]
      writeAll(data)
      return data.favorites
    },
    removeFavorite(url) {
      data.favorites = data.favorites.filter((f) => f.url !== url)
      writeAll(data)
      return data.favorites
    },
    isFavorite: (url) => data.favorites.some((f) => f.url === url),

    listDownloads: () => data.downloads,
    addDownload(entry) {
      data.downloads = [entry, ...data.downloads].slice(0, 500)
      writeAll(data)
      return data.downloads
    },
    updateDownload(id, patch) {
      data.downloads = data.downloads.map((d) => (d.id === id ? { ...d, ...patch } : d))
      writeAll(data)
      return data.downloads
    },
    clearDownloads() {
      data.downloads = []
      writeAll(data)
      return data.downloads
    },

    getShieldsEnabled: () => data.shieldsEnabled !== false,
    setShieldsEnabled(enabled) {
      data.shieldsEnabled = enabled
      writeAll(data)
      return data.shieldsEnabled
    },

    // Búsqueda propia de MABRIONA — la key nunca sale del proceso principal (ver main.js).
    getBraveApiKey: () => data.braveApiKey || null,
    setBraveApiKey(key) {
      data.braveApiKey = key || null
      writeAll(data)
      return data.braveApiKey
    },

    // Permisos por sitio (cámara/micrófono) — decisión real del usuario, persistida por origen.
    getPermission(origin, kind) {
      return data.permissions[origin]?.[kind] || null // null = todavía no se decidió
    },
    setPermission(origin, kind, decision) {
      data.permissions[origin] = { ...data.permissions[origin], [kind]: decision }
      writeAll(data)
      return data.permissions[origin]
    },
    listPermissions: () => data.permissions,
    clearPermission(origin, kind) {
      if (data.permissions[origin]) delete data.permissions[origin][kind]
      writeAll(data)
      return data.permissions
    },

    getDownloadsDir: () => data.downloadsDir, // null = usar el default del sistema
    setDownloadsDir(dir) {
      data.downloadsDir = dir || null
      writeAll(data)
      return data.downloadsDir
    },

    // Recuperación de sesión real — URLs reales de la última vez que se cerró la app (nunca de
    // pestañas privadas, esas no dejan rastro a propósito).
    getLastSession: () => data.lastSession || [],
    setLastSession(urls) {
      data.lastSession = Array.isArray(urls) ? urls : []
      writeAll(data)
      return data.lastSession
    },

    // Motor de búsqueda de este perfil — real, cambia a dónde va la barra de direcciones (ver
    // address-resolver.js). MABRIONA es el default (igual que Chrome arranca en Google, Safari en
    // Google/lo que elija el sistema) pero nunca la única opción real.
    getSearchEngine: () => data.searchEngine || 'mabriona',
    setSearchEngine(engine) {
      data.searchEngine = engine
      writeAll(data)
      return data.searchEngine
    },

    getRestoreSessionOnStartup: () => data.restoreSessionOnStartup !== false,
    setRestoreSessionOnStartup(enabled) {
      data.restoreSessionOnStartup = !!enabled
      writeAll(data)
      return data.restoreSessionOnStartup
    },
  }
}

module.exports = { createStore, createMemoryStore }
