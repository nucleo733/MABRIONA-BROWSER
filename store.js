'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * Persistencia real del navegador (historial/favoritos/descargas/config
 * de MABRIONA SHIELDS) — un archivo JSON en userData, mismo criterio
 * liviano que el resto del ecosistema MABRIONA (localStorage en la web,
 * JSON acá porque no hay localStorage en el proceso principal).
 */
function createStore(filePath) {
  function readAll() {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return { history: [], favorites: [], downloads: [], shieldsEnabled: true, braveApiKey: null, permissions: {}, downloadsDir: null, ...parsed }
    } catch {
      return { history: [], favorites: [], downloads: [], shieldsEnabled: true, braveApiKey: null, permissions: {}, downloadsDir: null }
    }
  }

  function writeAll(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  }

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
  }
}

module.exports = { createStore }
