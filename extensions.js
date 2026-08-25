'use strict'

/**
 * Extensiones reales de Chrome — MABRIONA es Chromium (vía Electron), así que el mismo formato de
 * extensión (manifest.json + código) que usan Chrome/Edge/Brave/Opera/Vivaldi funciona acá tal
 * cual, con la API real de Electron (`session.loadExtension`). Tres formas reales de agregar una:
 *
 * 1. Cargar sin empaquetar — apuntar a cualquier carpeta con manifest.json (modo desarrollador,
 *    igual que en Chrome). Se usa la carpeta original tal cual, sin copiarla.
 * 2. Importar desde otro navegador ya instalado (Chrome/Edge/Brave/Chromium) — se escanean las
 *    carpetas reales donde esos navegadores guardan sus extensiones YA descomprimidas (mismo
 *    formato), y se copian a la carpeta propia de MABRIONA (para no depender de que el otro
 *    navegador no las borre/actualice después).
 * 3. Instalar por ID o link de la Chrome Web Store — se descarga el .crx real desde el endpoint
 *    público de actualización de Google (el mismo que usa Chrome internamente), se descomprime
 *    (un .crx es un .zip con un encabezado de firma antes) y se copia a la carpeta de MABRIONA.
 *    Esto NO es el botón "Agregar a Chrome" de la tienda (esa integración depende de una API
 *    privada de Google que Electron no expone) — es una instalación real igual de funcional, solo
 *    que iniciada con el ID/link en vez de un botón dentro de la página de la tienda.
 */

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const https = require('node:https')
const extractZip = require('extract-zip')

function readManifestSafe(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'))
  } catch {
    return null
  }
}

/** Nombre real para mostrar — Chrome permite nombres localizados ("__MSG_nombre__" vía
 * _locales/*.json); se resuelve el mensaje real si existe, en vez de mostrar la clave cruda. */
function resolveDisplayName(dir, manifest) {
  const raw = manifest.name || 'Extensión sin nombre'
  const match = /^__MSG_(.+)__$/.exec(raw)
  if (!match) return raw
  const key = match[1]
  const defaultLocale = manifest.default_locale || 'en'
  for (const locale of [defaultLocale, 'en', 'en_US']) {
    try {
      const messages = JSON.parse(fs.readFileSync(path.join(dir, '_locales', locale, 'messages.json'), 'utf-8'))
      if (messages[key] && messages[key].message) return messages[key].message
    } catch { /* ese locale no existe — probar el siguiente */ }
  }
  return raw
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

function genExtensionRecordId() {
  return `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Carpeta real donde MABRIONA guarda las extensiones importadas/instaladas de un perfil — las
 * cargadas "sin empaquetar" NO viven acá, se referencian donde ya estaban. */
function extensionsDirFor(userDataDir, profileId) {
  return path.join(userDataDir, 'extensions', profileId)
}

function loadUnpacked(folderPath) {
  const manifest = readManifestSafe(folderPath)
  if (!manifest) throw new Error('esa carpeta no tiene un manifest.json real — no es una extensión válida')
  return {
    recordId: genExtensionRecordId(),
    origin: 'unpacked',
    path: folderPath,
    name: resolveDisplayName(folderPath, manifest),
    version: manifest.version || '0.0.0',
    manifestVersion: manifest.manifest_version || 2,
    enabled: true,
  }
}

function importFromFolder(sourceFolderPath, userDataDir, profileId) {
  const manifest = readManifestSafe(sourceFolderPath)
  if (!manifest) throw new Error('esa carpeta no tiene un manifest.json real — no es una extensión válida')
  const recordId = genExtensionRecordId()
  const destDir = path.join(extensionsDirFor(userDataDir, profileId), recordId)
  copyDirRecursive(sourceFolderPath, destDir)
  return {
    recordId,
    origin: 'imported',
    path: destDir,
    name: resolveDisplayName(destDir, manifest),
    version: manifest.version || '0.0.0',
    manifestVersion: manifest.manifest_version || 2,
    enabled: true,
  }
}

// ---------------- Escaneo real de otros navegadores Chromium ya instalados ----------------

function otherBrowserRoots() {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    return [
      { browser: 'Google Chrome', dir: path.join(home, 'Library/Application Support/Google/Chrome') },
      { browser: 'Microsoft Edge', dir: path.join(home, 'Library/Application Support/Microsoft Edge') },
      { browser: 'Brave', dir: path.join(home, 'Library/Application Support/BraveSoftware/Brave-Browser') },
      { browser: 'Chromium', dir: path.join(home, 'Library/Application Support/Chromium') },
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
    { browser: 'Chromium', dir: path.join(home, '.config', 'chromium') },
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

/** Extensiones reales ya instaladas en otros navegadores Chromium de esta misma máquina — mismo
 * formato en disco que usa MABRIONA (id/version/ ya descomprimido), listas para importar. */
function scanOtherBrowsers() {
  const found = []
  for (const { browser, dir } of otherBrowserRoots()) {
    if (!fs.existsSync(dir)) continue
    const profileDirs = safeReaddir(dir)
      .filter((e) => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile ')))
      .map((e) => e.name)
    for (const profileDir of profileDirs) {
      const extRoot = path.join(dir, profileDir, 'Extensions')
      for (const idEntry of safeReaddir(extRoot).filter((e) => e.isDirectory())) {
        const idDir = path.join(extRoot, idEntry.name)
        const versions = safeReaddir(idDir).filter((e) => e.isDirectory()).map((e) => e.name).sort()
        if (versions.length === 0) continue
        const versionDir = path.join(idDir, versions[versions.length - 1])
        const manifest = readManifestSafe(versionDir)
        if (!manifest) continue
        found.push({
          browser,
          profile: profileDir,
          extensionId: idEntry.name,
          name: resolveDisplayName(versionDir, manifest),
          version: manifest.version || versions[versions.length - 1],
          sourcePath: versionDir,
        })
      }
    }
  }
  return found
}

// ---------------- Chrome Web Store — descarga real del .crx público ----------------

function extractChromeWebStoreId(input) {
  const trimmed = (input || '').trim()
  if (/^[a-p]{32}$/.test(trimmed)) return trimmed
  const patterns = [
    /chrome\.google\.com\/webstore\/detail\/[^/]+\/([a-p]{32})/,
    /chromewebstore\.google\.com\/detail\/[^/]+\/([a-p]{32})/,
  ]
  for (const re of patterns) {
    const match = trimmed.match(re)
    if (match) return match[1]
  }
  return null
}

function downloadBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume()
        downloadBuffer(res.headers.location, redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`descarga falló: HTTP ${res.statusCode}`)); return }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

/** Desempaqueta un .crx real: encabezado de firma (CRX2 o CRX3) + payload ZIP real después. */
function crxToZipBuffer(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('el archivo descargado no es un .crx real de Chrome')
  }
  const version = buffer.readUInt32LE(4)
  if (version === 3) {
    const headerSize = buffer.readUInt32LE(8)
    return buffer.subarray(12 + headerSize)
  }
  if (version === 2) {
    const pubKeyLen = buffer.readUInt32LE(8)
    const sigLen = buffer.readUInt32LE(12)
    return buffer.subarray(16 + pubKeyLen + sigLen)
  }
  throw new Error(`versión de .crx no soportada: ${version}`)
}

async function installFromChromeWebStore(idOrUrl, userDataDir, profileId) {
  const extensionId = extractChromeWebStoreId(idOrUrl)
  if (!extensionId) throw new Error('no se reconoce como un ID ni un link real de la Chrome Web Store')
  // Mismo endpoint público que usa Chrome de verdad para chequear/descargar actualizaciones —
  // funciona para cualquier extensión pública de la tienda, sin necesitar ninguna key.
  const updateUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0.0.0&acceptformat=crx2,crx3&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`
  const crxBuffer = await downloadBuffer(updateUrl)
  const zipBuffer = crxToZipBuffer(crxBuffer)

  const recordId = genExtensionRecordId()
  const destDir = path.join(extensionsDirFor(userDataDir, profileId), recordId)
  const tmpZip = path.join(os.tmpdir(), `mabriona-ext-${recordId}.zip`)
  fs.mkdirSync(destDir, { recursive: true })
  fs.writeFileSync(tmpZip, zipBuffer)
  try {
    await extractZip(tmpZip, { dir: destDir })
  } finally {
    fs.rmSync(tmpZip, { force: true })
  }
  const manifest = readManifestSafe(destDir)
  if (!manifest) throw new Error('el paquete descargado no trae un manifest.json real')
  return {
    recordId,
    origin: 'webstore',
    path: destDir,
    name: resolveDisplayName(destDir, manifest),
    version: manifest.version || '0.0.0',
    manifestVersion: manifest.manifest_version || 2,
    enabled: true,
    sourceId: extensionId,
  }
}

function removeExtensionFiles(record) {
  // Solo se borra del disco lo que MABRIONA copió — una extensión "sin empaquetar" apunta a una
  // carpeta ajena (del usuario, o de otro navegador) que no es de MABRIONA para borrar.
  if (record.origin === 'unpacked') return
  try { fs.rmSync(record.path, { recursive: true, force: true }) } catch { /* ya no estaba */ }
}

module.exports = {
  loadUnpacked,
  importFromFolder,
  scanOtherBrowsers,
  installFromChromeWebStore,
  extractChromeWebStoreId,
  removeExtensionFiles,
  extensionsDirFor,
  readManifestSafe,
  resolveDisplayName,
  crxToZipBuffer,
}
