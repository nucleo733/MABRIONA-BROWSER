'use strict'

/**
 * Importar favoritos e historial reales desde otro navegador ya instalado en la misma máquina —
 * mismo espíritu que extensions.js (datos reales del disco, nada simulado), pero leyendo los
 * formatos reales de cada navegador en vez de carpetas de extensión.
 *
 * Formatos reales:
 * - Chrome/Edge/Brave (Chromium): `Bookmarks` es un JSON real (sin SQLite). `History` es una base
 *   SQLite real (tabla `urls`), con timestamps en formato WebKit (microsegundos desde 1601-01-01).
 * - Firefox: todo vive en una sola base SQLite real, `places.sqlite` (`moz_bookmarks` +
 *   `moz_places`), con timestamps en formato PRTime (microsegundos desde 1970-01-01).
 *
 * Contraseñas y cookies NO se tocan en absoluto en este módulo — a propósito, fuera de alcance de
 * esta fase (ver docs/MABRIONA-BROWSER-IMPORT.md).
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

let sqlJsPromise = null
function getSqlJs() {
  if (!sqlJsPromise) sqlJsPromise = require('sql.js')()
  return sqlJsPromise
}

// ---------------- Detección real de navegadores instalados ----------------

function chromiumRoots() {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return [
      { browser: 'Google Chrome', dir: path.join(home, 'Library/Application Support/Google/Chrome') },
      { browser: 'Microsoft Edge', dir: path.join(home, 'Library/Application Support/Microsoft Edge') },
      { browser: 'Brave', dir: path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser') },
    ]
  }
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    return [
      { browser: 'Google Chrome', dir: path.join(base, 'Google', 'Chrome', 'User Data') },
      { browser: 'Microsoft Edge', dir: path.join(base, 'Microsoft', 'Edge', 'User Data') },
      { browser: 'Brave', dir: path.join(base, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    ]
  }
  return [
    { browser: 'Google Chrome', dir: path.join(home, '.config', 'google-chrome') },
    { browser: 'Microsoft Edge', dir: path.join(home, '.config', 'microsoft-edge') },
    { browser: 'Brave', dir: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser') },
  ]
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Perfiles reales (Default, Profile 1, Profile 2...) de cada navegador Chromium instalado, cada
 * uno con lo que realmente tenga (Bookmarks y/o History) — nunca se inventa uno vacío. */
function scanChromiumSources() {
  const found = []
  for (const { browser, dir } of chromiumRoots()) {
    if (!fs.existsSync(dir)) continue
    const profileDirs = safeReaddir(dir).filter((e) => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile ')))
    for (const entry of profileDirs) {
      const profileDir = path.join(dir, entry.name)
      const bookmarksPath = path.join(profileDir, 'Bookmarks')
      const historyPath = path.join(profileDir, 'History')
      const hasBookmarks = fs.existsSync(bookmarksPath)
      const hasHistory = fs.existsSync(historyPath)
      if (!hasBookmarks && !hasHistory) continue
      found.push({
        browser,
        profile: entry.name,
        engine: 'chromium',
        bookmarksPath: hasBookmarks ? bookmarksPath : null,
        historyPath: hasHistory ? historyPath : null,
      })
    }
  }
  return found
}

/** Perfiles reales de Firefox, vía profiles.ini (Firefox no usa nombres de carpeta predecibles —
 * cada perfil tiene un hash real generado al crearse). */
function scanFirefoxSources() {
  const home = os.homedir()
  let firefoxRoot
  if (process.platform === 'darwin') firefoxRoot = path.join(home, 'Library/Application Support/Firefox')
  else if (process.platform === 'win32') firefoxRoot = path.join(process.env.APPDATA || path.join(home, 'AppData/Roaming'), 'Mozilla/Firefox')
  else firefoxRoot = path.join(home, '.mozilla/firefox')

  const iniPath = path.join(firefoxRoot, 'profiles.ini')
  if (!fs.existsSync(iniPath)) return []

  let ini
  try {
    ini = fs.readFileSync(iniPath, 'utf-8')
  } catch {
    return []
  }

  const found = []
  const sections = ini.split(/\r?\n(?=\[)/)
  for (const section of sections) {
    if (!/^\[Profile\d+\]/.test(section)) continue
    const nameMatch = section.match(/^Name=(.*)$/m)
    const pathMatch = section.match(/^Path=(.*)$/m)
    const isRelativeMatch = section.match(/^IsRelative=(\d)$/m)
    if (!pathMatch) continue
    const isRelative = !isRelativeMatch || isRelativeMatch[1] === '1'
    const profileDir = isRelative ? path.join(firefoxRoot, pathMatch[1]) : pathMatch[1]
    const placesPath = path.join(profileDir, 'places.sqlite')
    if (!fs.existsSync(placesPath)) continue
    found.push({
      browser: 'Firefox',
      profile: nameMatch ? nameMatch[1] : pathMatch[1],
      engine: 'firefox',
      placesPath,
    })
  }
  return found
}

function scanAllSources() {
  return [...scanChromiumSources(), ...scanFirefoxSources()]
}

// ---------------- Timestamps reales de cada formato ----------------

/** WebKit/Chrome: microsegundos desde 1601-01-01 UTC. */
function webkitTimeToMs(webkitMicroseconds) {
  const n = Number(webkitMicroseconds)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n / 1000) - 11644473600000
}

/** PRTime (Firefox): microsegundos desde 1970-01-01 UTC — mucho más simple que el de Chrome. */
function firefoxTimeToMs(prtimeMicroseconds) {
  const n = Number(prtimeMicroseconds)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n / 1000)
}

// ---------------- Bookmarks reales de Chromium (JSON, sin SQLite) ----------------

const CHROMIUM_ROOT_LABELS = {
  bookmark_bar: 'Barra de favoritos',
  other: 'Otros favoritos',
  synced: 'Favoritos sincronizados',
}

function walkChromiumNode(node, folderPath, out) {
  if (node.type === 'url' && typeof node.url === 'string' && node.url) {
    out.push({
      title: typeof node.name === 'string' && node.name ? node.name : node.url,
      url: node.url,
      addedAt: webkitTimeToMs(node.date_added) ?? Date.now(),
      folder: folderPath.join('/') || null,
    })
    return
  }
  if (node.type === 'folder' && Array.isArray(node.children)) {
    const nextPath = folderPath.concat(node.name ? [node.name] : [])
    for (const child of node.children) walkChromiumNode(child, nextPath, out)
  }
}

/** Favoritos reales de Chrome/Edge/Brave, con la carpeta real de origen preservada — nunca los
 * mezcla como si no tuvieran carpeta. */
function readChromiumBookmarks(bookmarksPath) {
  const raw = fs.readFileSync(bookmarksPath, 'utf-8')
  const data = JSON.parse(raw)
  const out = []
  for (const [rootKey, rootNode] of Object.entries(data.roots || {})) {
    if (!rootNode || typeof rootNode !== 'object' || !Array.isArray(rootNode.children)) continue
    // El nodo raíz ya tiene su propio nombre real (ej. "Bookmarks bar") — se etiqueta con el
    // nuestro en español y se arranca desde sus hijos, para no duplicarlo como "X/X".
    const label = CHROMIUM_ROOT_LABELS[rootKey] || rootKey
    for (const child of rootNode.children) walkChromiumNode(child, [label], out)
  }
  return out
}

// ---------------- Historial real de Chromium (SQLite real, vía sql.js) ----------------

function copyToTemp(sourcePath, label) {
  const dest = path.join(os.tmpdir(), `mabriona-import-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  // El navegador de origen puede tener el archivo abierto — se copia primero para no pelear por
  // el lock, en vez de abrirlo directo (misma técnica que usan las herramientas reales de
  // migración de navegadores).
  fs.copyFileSync(sourcePath, dest)
  return dest
}

async function readChromiumHistory(historyPath, limit = 2000) {
  const tmp = copyToTemp(historyPath, 'chromium-history')
  try {
    const SQL = await getSqlJs()
    const db = new SQL.Database(fs.readFileSync(tmp))
    try {
      const res = db.exec(`SELECT url, title, last_visit_time FROM urls WHERE last_visit_time IS NOT NULL ORDER BY last_visit_time DESC LIMIT ${limit}`)
      if (!res[0]) return []
      return res[0].values
        .map(([url, title, lastVisitTime]) => ({
          url: String(url),
          title: title ? String(title) : String(url),
          visitedAt: webkitTimeToMs(lastVisitTime),
        }))
        .filter((h) => h.url && h.visitedAt)
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

// ---------------- Firefox real (bookmarks + history en el mismo places.sqlite) ----------------

const FIREFOX_ROOT_LABELS = {
  toolbar: 'Barra de marcadores',
  menu: 'Menú de marcadores',
  unfiled: 'Otros marcadores',
  mobile: 'Marcadores móviles',
}

async function readFirefoxData(placesPath, { historyLimit = 2000 } = {}) {
  const tmp = copyToTemp(placesPath, 'firefox-places')
  try {
    const SQL = await getSqlJs()
    const db = new SQL.Database(fs.readFileSync(tmp))
    try {
      // Carpetas reales primero — se necesita el árbol completo para reconstruir la ruta real de
      // cada favorito (Firefox guarda "parent" como id, no como ruta ya armada).
      const foldersRes = db.exec('SELECT id, title, parent FROM moz_bookmarks WHERE type = 2')
      const folders = new Map()
      for (const row of foldersRes[0]?.values || []) {
        const [id, title, parent] = row
        folders.set(Number(id), { title: title ? String(title) : '', parent: Number(parent) })
      }
      function folderPathFor(id) {
        const parts = []
        let current = folders.get(Number(id))
        let guard = 0
        while (current && guard < 50) {
          const label = FIREFOX_ROOT_LABELS[current.title] || current.title
          if (label) parts.unshift(label)
          current = folders.get(current.parent)
          guard++
        }
        return parts.join('/') || null
      }

      const bookmarksRes = db.exec(`
        SELECT b.title, p.url, b.dateAdded, b.parent
        FROM moz_bookmarks b
        JOIN moz_places p ON b.fk = p.id
        WHERE b.type = 1 AND p.url IS NOT NULL
      `)
      const bookmarks = (bookmarksRes[0]?.values || [])
        .map(([title, url, dateAdded, parent]) => ({
          title: title ? String(title) : String(url),
          url: String(url),
          addedAt: firefoxTimeToMs(dateAdded) ?? Date.now(),
          folder: folderPathFor(parent),
        }))
        .filter((b) => /^https?:\/\//i.test(b.url)) // Firefox guarda algunos favoritos internos (about:, place:) — no son sitios reales navegables

      const historyRes = db.exec(`
        SELECT url, title, last_visit_date FROM moz_places
        WHERE last_visit_date IS NOT NULL
        ORDER BY last_visit_date DESC
        LIMIT ${historyLimit}
      `)
      const history = (historyRes[0]?.values || [])
        .map(([url, title, lastVisitDate]) => ({
          url: String(url),
          title: title ? String(title) : String(url),
          visitedAt: firefoxTimeToMs(lastVisitDate),
        }))
        .filter((h) => h.url && h.visitedAt && /^https?:\/\//i.test(h.url))

      return { bookmarks, history }
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

module.exports = {
  scanAllSources,
  scanChromiumSources,
  scanFirefoxSources,
  readChromiumBookmarks,
  readChromiumHistory,
  readFirefoxData,
  webkitTimeToMs,
  firefoxTimeToMs,
}
