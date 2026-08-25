'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * Registro de perfiles — un archivo JSON aparte de los datos de cada perfil (que siguen viviendo
 * en su propio `createStore`, ver store.js). Acá solo vive la lista de perfiles que existen, cuál
 * fue el último activo, y la Brave API key (es una credencial de la app, no un dato de usuario —
 * por eso es global y no por perfil).
 *
 * Migración real, sin mover nada: si este archivo no existe todavía (primera vez que corre esta
 * versión), se crea con un único perfil `id: 'default'`. Ese id apunta, a propósito, al MISMO
 * archivo de datos (`mabriona-browser-data.json`) y a la MISMA partición de Chromium
 * (`persist:mabriona-browser`) que ya existían — cero riesgo de pérdida de datos, cero copia.
 */
function createProfileRegistry(registryFilePath, legacyDataFilePath) {
  function readAll() {
    try {
      const raw = fs.readFileSync(registryFilePath, 'utf-8')
      const parsed = JSON.parse(raw)
      return { profiles: [], lastActiveProfileId: 'default', braveApiKey: null, ...parsed }
    } catch {
      return null
    }
  }

  function writeAll(d) {
    fs.mkdirSync(path.dirname(registryFilePath), { recursive: true })
    fs.writeFileSync(registryFilePath, JSON.stringify(d, null, 2))
  }

  let data = readAll()
  if (!data) {
    // Primera vez: el perfil "Principal" nace apuntando a lo que ya existía, no a algo nuevo.
    let migratedKey = null
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyDataFilePath, 'utf-8'))
      migratedKey = legacy.braveApiKey || null
    } catch { /* no había datos previos — primera instalación real */ }
    data = {
      profiles: [{ id: 'default', name: 'Principal', emoji: '👤', createdAt: Date.now() }],
      lastActiveProfileId: 'default',
      braveApiKey: migratedKey,
    }
    writeAll(data)
  }

  function genId() {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  }

  return {
    list: () => data.profiles,
    get: (id) => data.profiles.find((p) => p.id === id) || null,

    create(name, emoji) {
      const id = genId()
      const profile = { id, name: (name || '').trim() || 'Nuevo perfil', emoji: emoji || '👤', createdAt: Date.now() }
      data.profiles = [...data.profiles, profile]
      writeAll(data)
      return profile
    },

    rename(id, name) {
      const trimmed = (name || '').trim()
      if (!trimmed) return this.get(id)
      data.profiles = data.profiles.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
      writeAll(data)
      return this.get(id)
    },

    /** No borra 'default' ni el último perfil que quede — siempre tiene que haber a dónde volver. */
    canDelete(id) {
      if (id === 'default') return false
      if (data.profiles.length <= 1) return false
      return data.profiles.some((p) => p.id === id)
    },
    remove(id) {
      if (!this.canDelete(id)) return false
      data.profiles = data.profiles.filter((p) => p.id !== id)
      writeAll(data)
      return true
    },

    getLastActiveProfileId: () => (data.profiles.some((p) => p.id === data.lastActiveProfileId) ? data.lastActiveProfileId : 'default'),
    setLastActiveProfileId(id) {
      data.lastActiveProfileId = id
      writeAll(data)
    },

    getBraveApiKey: () => data.braveApiKey || null,
    setBraveApiKey(key) {
      data.braveApiKey = key || null
      writeAll(data)
      return data.braveApiKey
    },

    /** Archivo de datos real de un perfil — 'default' reutiliza el archivo histórico tal cual. */
    dataFilePathFor(userDataDir, id) {
      return id === 'default'
        ? legacyDataFilePath
        : path.join(userDataDir, `mabriona-browser-profile-${id}.json`)
    },

    /** Partición real de Chromium — 'default' reutiliza la partición histórica tal cual. */
    partitionFor(id) {
      return id === 'default' ? 'persist:mabriona-browser' : `persist:mabriona-profile-${id}`
    },
  }
}

module.exports = { createProfileRegistry }
