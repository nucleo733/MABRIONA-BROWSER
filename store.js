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
      return { history: [], favorites: [], downloads: [], shieldsEnabled: true, ...parsed }
    } catch {
      return { history: [], favorites: [], downloads: [], shieldsEnabled: true }
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
  }
}

module.exports = { createStore }
