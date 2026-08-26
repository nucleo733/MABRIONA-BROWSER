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
    // Extensiones reales de Chrome de este perfil — ver extensions.js. Cada entrada:
    // { recordId, origin: 'unpacked'|'imported'|'webstore', path, name, version, manifestVersion, enabled }.
    extensions: [],
    // Se pone en true la primera vez que este perfil termina (o se salta) el asistente real de
    // "Importar datos del navegador" — ver browserImport.js. Perfil "default" migrado de una
    // instalación anterior a este sistema nace en true (nunca se le muestra el asistente a un
    // perfil que ya tenía datos reales de antes).
    hasCompletedOnboarding: false,
  }
}

function createStore(filePath) {
  function readAll() {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(raw)
      // Un archivo real que ya existía antes de que existiera el asistente de importación (no
      // trae `hasCompletedOnboarding` todavía) es de alguien que YA usaba MABRIONA — nunca se le
      // debe mostrar el asistente de "bienvenido, ¿venís de otro navegador?" como si fuera nuevo.
      const migratingFromBeforeOnboarding = !('hasCompletedOnboarding' in parsed)
      return { ...freshDefaults(), ...parsed, ...(migratingFromBeforeOnboarding ? { hasCompletedOnboarding: true } : {}) }
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

    // Extensiones reales de Chrome — ver extensions.js para cómo se cargan/instalan de verdad.
    listExtensions: () => data.extensions || [],
    addExtensionRecord(record) {
      data.extensions = [...(data.extensions || []), record]
      writeAll(data)
      return data.extensions
    },
    removeExtensionRecord(recordId) {
      data.extensions = (data.extensions || []).filter((e) => e.recordId !== recordId)
      writeAll(data)
      return data.extensions
    },
    setExtensionEnabled(recordId, enabled) {
      data.extensions = (data.extensions || []).map((e) => (e.recordId === recordId ? { ...e, enabled } : e))
      writeAll(data)
      return data.extensions
    },

    getHasCompletedOnboarding: () => data.hasCompletedOnboarding === true,
    setHasCompletedOnboarding(done) {
      data.hasCompletedOnboarding = !!done
      writeAll(data)
      return data.hasCompletedOnboarding
    },

    // Importación real desde otro navegador — ver browserImport.js. Nunca duplica: un favorito
    // cuya URL ya existe se deja como está (no se pisa, no se agrega una copia). Se escribe en
    // disco una sola vez al final, no por cada item — importar miles de favoritos/entradas de
    // golpe no debe hacer miles de escrituras sincrónicas.
    importFavorites(items) {
      const existingUrls = new Set(data.favorites.map((f) => f.url))
      let imported = 0
      for (const item of items) {
        if (existingUrls.has(item.url)) continue
        existingUrls.add(item.url)
        data.favorites.push(item)
        imported++
      }
      writeAll(data)
      return imported
    },
    // El historial importado se mezcla con el real que ya había — por URL, se queda con la visita
    // más reciente de las dos (importada o ya existente), nunca inventa ni pierde datos, y
    // respeta el mismo límite real de 2000 entradas que ya usa addHistoryEntry.
    importHistoryEntries(items) {
      const byUrl = new Map(data.history.map((h) => [h.url, h]))
      for (const item of items) {
        const existing = byUrl.get(item.url)
        if (!existing || item.visitedAt > existing.visitedAt) byUrl.set(item.url, item)
      }
      data.history = Array.from(byUrl.values())
        .sort((a, b) => b.visitedAt - a.visitedAt)
        .slice(0, 2000)
      writeAll(data)
      return data.history.length
    },
  }
}

module.exports = { createStore, createMemoryStore }
