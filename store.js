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
    // Carpetas reales de Favoritos — árbol real por id, no rutas de texto. Cada entrada:
    // { id, name, parentId, order }. `parentId: null` = carpeta de primer nivel (la barra de
    // favoritos). Un favorito con `folderId: null` está en el primer nivel también.
    folders: [],
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
    // Contraseñas guardadas de este perfil — cada entrada: { id, origin, username,
    // encryptedPassword (base64, ya cifrado con safeStorage real por main.js), createdAt }.
    passwords: [],
    // Idiomas reales del corrector ortográfico de Chromium para este perfil — se validan contra
    // `session.availableSpellCheckerLanguages` real en main.js antes de aplicarlos, nunca se
    // asume que un idioma existe solo porque está en esta lista guardada.
    spellcheckLanguages: ['es', 'en-US'],
    // Autocompletar real de direcciones/tarjetas — cada entrada: { id, type: 'address'|'card',
    // fields: {...} }. El número de tarjeta viaja cifrado (encryptedNumber, safeStorage real,
    // igual que las contraseñas) — el CVC NUNCA se guarda, ni siquiera cifrado (mismo criterio de
    // seguridad que Chrome/Brave real: pedirlo siempre de nuevo en cada compra).
    autofillProfiles: [],
    // Se pone en true la primera vez que este perfil termina (o se salta) el asistente real de
    // "Importar datos del navegador" — ver browserImport.js. Perfil "default" migrado de una
    // instalación anterior a este sistema nace en true (nunca se le muestra el asistente a un
    // perfil que ya tenía datos reales de antes).
    hasCompletedOnboarding: false,
  }
}

/**
 * Migra los favoritos reales de "carpeta como ruta de texto" (formato viejo, el que dejaba el
 * asistente de importación antes de que existiera un árbol real de carpetas) a un árbol real de
 * carpetas con id — sin esto, renombrar o mover una carpeta sería reescribir strings a mano en
 * cada favorito, frágil y no soporta carpetas vacías. Real y aditiva: nunca borra un favorito, el
 * campo viejo `folder` se deja tal cual en cada favorito (no se borra, por si algo lo necesita),
 * solo se agrega `folderId` apuntando a la carpeta real correspondiente.
 */
/**
 * Busca (o crea, real, mutando el array recibido) la carpeta real correspondiente a una ruta de
 * texto tipo "Barra de favoritos/Trabajo" — reutilizable tanto por la migración de una sola vez
 * como por cada importación nueva (si ya existe una carpeta con ese nombre en ese mismo nivel, la
 * reutiliza en vez de crear una duplicada).
 */
function resolveFolderPathInto(folders, pathStr) {
  if (!pathStr) return null
  const segments = pathStr.split('/').filter(Boolean)
  let parentId = null
  for (const segment of segments) {
    let existing = folders.find((f) => f.parentId === parentId && f.name === segment)
    if (!existing) {
      const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${folders.length}`
      const order = folders.filter((f) => f.parentId === parentId).length
      existing = { id, name: segment, parentId, order }
      folders.push(existing)
    }
    parentId = existing.id
  }
  return parentId
}

function migrateFolderPathsToRealFolders(data, alreadyHadFolders) {
  if (alreadyHadFolders) return data // ya migrado — nunca se vuelve a correr
  const folders = []
  data.favorites = (data.favorites || []).map((fav) => ({ ...fav, folderId: resolveFolderPathInto(folders, fav.folder) }))
  data.folders = folders
  return data
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
      const alreadyHadFolders = Array.isArray(parsed.folders)
      const merged = { ...freshDefaults(), ...parsed, ...(migratingFromBeforeOnboarding ? { hasCompletedOnboarding: true } : {}) }
      return migrateFolderPathsToRealFolders(merged, alreadyHadFolders)
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
    renameFavorite(url, title) {
      const trimmed = (title || '').trim()
      if (!trimmed) return false
      data.favorites = data.favorites.map((f) => (f.url === url ? { ...f, title: trimmed } : f))
      writeAll(data)
      return true
    },
    /** Cambiar la URL de un favorito ya guardado — nunca deja dos favoritos reales con la misma
     * URL nueva (se rechaza en vez de pisar el que ya estaba ahí). */
    updateFavoriteUrl(oldUrl, newUrl) {
      const trimmed = (newUrl || '').trim()
      if (!trimmed || !/^https?:\/\//i.test(trimmed)) return false
      if (trimmed !== oldUrl && data.favorites.some((f) => f.url === trimmed)) return false
      data.favorites = data.favorites.map((f) => (f.url === oldUrl ? { ...f, url: trimmed } : f))
      writeAll(data)
      return true
    },
    moveFavorite(url, folderId) {
      data.favorites = data.favorites.map((f) => (f.url === url ? { ...f, folderId: folderId || null } : f))
      writeAll(data)
      return true
    },
    reorderFavorite(url, order) {
      data.favorites = data.favorites.map((f) => (f.url === url ? { ...f, order } : f))
      writeAll(data)
      return true
    },

    // ---------------- Carpetas reales de Favoritos ----------------
    listFolders: () => data.folders,
    createFolder(name, parentId = null) {
      const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      const order = data.folders.filter((f) => f.parentId === parentId).length
      const folder = { id, name: (name || '').trim() || 'Carpeta nueva', parentId, order }
      data.folders = [...data.folders, folder]
      writeAll(data)
      return folder
    },
    renameFolder(id, name) {
      const trimmed = (name || '').trim()
      if (!trimmed) return this.getFolder(id)
      data.folders = data.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
      writeAll(data)
      return this.getFolder(id)
    },
    getFolder: (id) => data.folders.find((f) => f.id === id) || null,
    /** Es descendiente real (directo o indirecto) de otra carpeta — evita moverla adentro de sí
     * misma o de uno de sus propios hijos, lo que rompería el árbol en un ciclo. */
    isDescendantFolder(candidateId, ofId) {
      let current = data.folders.find((f) => f.id === candidateId)
      let guard = 0
      while (current && current.parentId != null && guard < 200) {
        if (current.parentId === ofId) return true
        current = data.folders.find((f) => f.id === current.parentId)
        guard++
      }
      return false
    },
    moveFolder(id, newParentId) {
      const target = newParentId || null
      if (id === target) return false
      if (target && this.isDescendantFolder(target, id)) return false
      const order = data.folders.filter((f) => f.parentId === target && f.id !== id).length
      data.folders = data.folders.map((f) => (f.id === id ? { ...f, parentId: target, order } : f))
      writeAll(data)
      return true
    },
    reorderFolder(id, order) {
      data.folders = data.folders.map((f) => (f.id === id ? { ...f, order } : f))
      writeAll(data)
      return true
    },
    /** Borrar una carpeta NUNCA borra lo que tenía adentro — sus favoritos y subcarpetas suben un
     * nivel real (al padre de la carpeta borrada). Nada desaparece sin que la persona lo borre
     * aparte, a propósito. */
    deleteFolder(id) {
      const folder = this.getFolder(id)
      if (!folder) return false
      data.folders = data.folders
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId: folder.parentId } : f))
      data.favorites = data.favorites.map((fav) => (fav.folderId === id ? { ...fav, folderId: folder.parentId } : fav))
      writeAll(data)
      return true
    },

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
    // "Fijada" al ícono de la barra — igual que "pin" en Chrome real. Por defecto true al
    // instalarla (ver addExtensionRecord real en extensions.js/main.js), para que se vea de
    // inmediato; desde acá se puede sacar de la barra sin desinstalarla.
    setExtensionPinned(recordId, pinned) {
      data.extensions = (data.extensions || []).map((e) => (e.recordId === recordId ? { ...e, pinned } : e))
      writeAll(data)
      return data.extensions
    },

    // Contraseñas reales — este store NUNCA ve la contraseña en texto plano: main.js la cifra con
    // `safeStorage` (real, del sistema operativo — Keychain en macOS) ANTES de llamar acá, y esto
    // solo persiste el blob ya cifrado (base64) tal cual, como cualquier otro dato de perfil.
    listPasswords: () => data.passwords || [],
    addPasswordRecord(record) {
      data.passwords = [...(data.passwords || []), record]
      writeAll(data)
      return data.passwords
    },
    removePasswordRecord(id) {
      data.passwords = (data.passwords || []).filter((p) => p.id !== id)
      writeAll(data)
      return data.passwords
    },

    getSpellcheckLanguages: () => data.spellcheckLanguages || ['es', 'en-US'],
    setSpellcheckLanguages(langs) {
      data.spellcheckLanguages = langs
      writeAll(data)
      return data.spellcheckLanguages
    },

    listAutofillProfiles: () => data.autofillProfiles || [],
    addAutofillProfile(record) {
      data.autofillProfiles = [...(data.autofillProfiles || []), record]
      writeAll(data)
      return data.autofillProfiles
    },
    removeAutofillProfile(id) {
      data.autofillProfiles = (data.autofillProfiles || []).filter((p) => p.id !== id)
      writeAll(data)
      return data.autofillProfiles
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
        // La carpeta real de origen (si el navegador de origen tenía una) se resuelve a una
        // carpeta real acá mismo — reutiliza una carpeta que ya exista con el mismo nombre en vez
        // de crear una duplicada en cada importación.
        const folderId = item.folder ? resolveFolderPathInto(data.folders, item.folder) : (item.folderId ?? null)
        data.favorites.push({ ...item, folderId })
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
