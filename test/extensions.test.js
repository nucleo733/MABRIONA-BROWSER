'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ext = require('../extensions')

function tempDir() {
  const dir = path.join(os.tmpdir(), `mabriona-browser-ext-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
}

test('extractChromeWebStoreId: reconoce un ID real de 32 letras a-p', () => {
  assert.equal(ext.extractChromeWebStoreId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
})

test('extractChromeWebStoreId: reconoce un link real de chrome.google.com/webstore', () => {
  const id = 'cfhdojbkjhnklbpkdaibdccddilifddb'
  assert.equal(ext.extractChromeWebStoreId(`https://chrome.google.com/webstore/detail/adblock/${id}`), id)
})

test('extractChromeWebStoreId: reconoce un link real del dominio nuevo chromewebstore.google.com', () => {
  const id = 'cfhdojbkjhnklbpkdaibdccddilifddb'
  assert.equal(ext.extractChromeWebStoreId(`https://chromewebstore.google.com/detail/adblock/${id}`), id)
})

test('extractChromeWebStoreId: devuelve null para texto que no es ni un ID ni un link real', () => {
  assert.equal(ext.extractChromeWebStoreId('esto no es nada'), null)
  assert.equal(ext.extractChromeWebStoreId(''), null)
  assert.equal(ext.extractChromeWebStoreId('123'), null)
})

test('crxToZipBuffer: desempaqueta un CRX3 real (encabezado con header_size)', () => {
  const zipContent = Buffer.from('PK\x03\x04contenido-zip-real')
  const headerSize = 20
  const header = Buffer.alloc(12 + headerSize)
  header.write('Cr24', 0, 'ascii')
  header.writeUInt32LE(3, 4)
  header.writeUInt32LE(headerSize, 8)
  const crx = Buffer.concat([header, zipContent])
  const result = ext.crxToZipBuffer(crx)
  assert.ok(result.equals(zipContent))
})

test('crxToZipBuffer: desempaqueta un CRX2 real (clave pública + firma)', () => {
  const zipContent = Buffer.from('PK\x03\x04contenido-zip-crx2')
  const pubKeyLen = 10
  const sigLen = 15
  const header = Buffer.alloc(16 + pubKeyLen + sigLen)
  header.write('Cr24', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(pubKeyLen, 8)
  header.writeUInt32LE(sigLen, 12)
  const crx = Buffer.concat([header, zipContent])
  const result = ext.crxToZipBuffer(crx)
  assert.ok(result.equals(zipContent))
})

test('crxToZipBuffer: rechaza un archivo sin la firma real "Cr24" — nunca finge que es válido', () => {
  assert.throws(() => ext.crxToZipBuffer(Buffer.from('esto no es un crx real')), /no es un \.crx real/)
})

test('crxToZipBuffer: rechaza una versión de CRX no soportada', () => {
  const header = Buffer.alloc(12)
  header.write('Cr24', 0, 'ascii')
  header.writeUInt32LE(99, 4)
  assert.throws(() => ext.crxToZipBuffer(header), /versión de \.crx no soportada/)
})

test('loadUnpacked: una carpeta real con manifest.json válido se acepta', () => {
  const dir = tempDir()
  writeManifest(dir, { name: 'Mi Extensión', version: '2.1.0', manifest_version: 3 })
  const record = ext.loadUnpacked(dir)
  assert.equal(record.origin, 'unpacked')
  assert.equal(record.path, dir)
  assert.equal(record.name, 'Mi Extensión')
  assert.equal(record.version, '2.1.0')
  assert.equal(record.enabled, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadUnpacked: una carpeta sin manifest.json real se rechaza — nunca finge que es una extensión', () => {
  const dir = tempDir()
  assert.throws(() => ext.loadUnpacked(dir), /no tiene un manifest\.json real/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('importFromFolder: copia la carpeta real a la carpeta propia de MABRIONA — el original queda intacto', () => {
  const sourceDir = tempDir()
  writeManifest(sourceDir, { name: 'Copiada', version: '1.0.0', manifest_version: 3 })
  fs.writeFileSync(path.join(sourceDir, 'content.js'), 'console.log(1)')
  const userDataDir = tempDir()
  const record = ext.importFromFolder(sourceDir, userDataDir, 'default')
  assert.equal(record.origin, 'imported')
  assert.notEqual(record.path, sourceDir)
  assert.ok(fs.existsSync(path.join(record.path, 'manifest.json')))
  assert.ok(fs.existsSync(path.join(record.path, 'content.js')))
  assert.ok(fs.existsSync(path.join(sourceDir, 'manifest.json')), 'el original no debería tocarse')
  fs.rmSync(sourceDir, { recursive: true, force: true })
  fs.rmSync(userDataDir, { recursive: true, force: true })
})

test('resolveDisplayName: nombre normal se devuelve tal cual', () => {
  const dir = tempDir()
  assert.equal(ext.resolveDisplayName(dir, { name: 'Nombre Normal' }), 'Nombre Normal')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('resolveDisplayName: nombre localizado real ("__MSG_x__") se resuelve contra _locales real', () => {
  const dir = tempDir()
  fs.mkdirSync(path.join(dir, '_locales', 'en'), { recursive: true })
  fs.writeFileSync(path.join(dir, '_locales', 'en', 'messages.json'), JSON.stringify({ extName: { message: 'Nombre Real Traducido' } }))
  const name = ext.resolveDisplayName(dir, { name: '__MSG_extName__', default_locale: 'en' })
  assert.equal(name, 'Nombre Real Traducido')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('resolveDisplayName: si el locale real no existe, devuelve la clave cruda en vez de inventar una traducción', () => {
  const dir = tempDir()
  const name = ext.resolveDisplayName(dir, { name: '__MSG_noExiste__' })
  assert.equal(name, '__MSG_noExiste__')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('removeExtensionFiles: borra del disco una extensión importada/de la tienda', () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}')
  ext.removeExtensionFiles({ origin: 'imported', path: dir })
  assert.equal(fs.existsSync(dir), false)
})

test('removeExtensionFiles: NUNCA borra la carpeta de una extensión "sin empaquetar" — no es de MABRIONA', () => {
  const dir = tempDir()
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}')
  ext.removeExtensionFiles({ origin: 'unpacked', path: dir })
  assert.equal(fs.existsSync(dir), true, 'la carpeta original del usuario no debe borrarse nunca')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('extensionsDirFor: separa las extensiones por perfil real', () => {
  const a = ext.extensionsDirFor('/userdata', 'default')
  const b = ext.extensionsDirFor('/userdata', 'otro-perfil')
  assert.notEqual(a, b)
})
