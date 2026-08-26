'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const imp = require('../browserImport')

function tempDir() {
  const dir = path.join(os.tmpdir(), `mabriona-browser-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

test('webkitTimeToMs: convierte un timestamp real de Chrome a milisegundos reales', () => {
  // 13305658437488171 es un timestamp real tomado de un Bookmarks real de Chrome en esta auditoría.
  const ms = imp.webkitTimeToMs('13305658437488171')
  const date = new Date(ms)
  assert.equal(date.getUTCFullYear(), 2022) // fecha real conocida de ese bookmark
})

test('webkitTimeToMs: valores inválidos devuelven null, nunca una fecha inventada', () => {
  assert.equal(imp.webkitTimeToMs(undefined), null)
  assert.equal(imp.webkitTimeToMs('0'), null)
  assert.equal(imp.webkitTimeToMs('no-es-un-numero'), null)
})

test('firefoxTimeToMs: PRTime real (microsegundos desde 1970) a milisegundos reales', () => {
  const ms = imp.firefoxTimeToMs('1726174825005000')
  assert.equal(ms, 1726174825005)
})

test('readChromiumBookmarks: árbol real con carpetas anidadas, sin duplicar el nombre de la raíz', () => {
  const dir = tempDir()
  const bookmarksPath = path.join(dir, 'Bookmarks')
  fs.writeFileSync(bookmarksPath, JSON.stringify({
    version: 1,
    roots: {
      bookmark_bar: {
        type: 'folder',
        name: 'Bookmarks bar',
        children: [
          { type: 'url', name: 'Sitio A', url: 'https://a.example.com', date_added: '13305658437488171' },
          {
            type: 'folder',
            name: 'Trabajo',
            children: [
              { type: 'url', name: 'Sitio B', url: 'https://b.example.com', date_added: '13305658437488171' },
            ],
          },
        ],
      },
      other: { type: 'folder', name: 'Other bookmarks', children: [] },
    },
  }))
  const result = imp.readChromiumBookmarks(bookmarksPath)
  assert.equal(result.length, 2)
  const a = result.find((b) => b.url === 'https://a.example.com')
  const b = result.find((b) => b.url === 'https://b.example.com')
  assert.equal(a.folder, 'Barra de favoritos')
  assert.equal(b.folder, 'Barra de favoritos/Trabajo')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('readChromiumBookmarks: una carpeta vacía no agrega nada, no inventa favoritos', () => {
  const dir = tempDir()
  const bookmarksPath = path.join(dir, 'Bookmarks')
  fs.writeFileSync(bookmarksPath, JSON.stringify({
    roots: { bookmark_bar: { type: 'folder', name: 'x', children: [] }, other: { type: 'folder', name: 'y', children: [] } },
  }))
  assert.deepEqual(imp.readChromiumBookmarks(bookmarksPath), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('scanFirefoxSources: parsea profiles.ini real y solo devuelve perfiles con places.sqlite real', () => {
  const dir = tempDir()
  const profileDir = path.join(dir, 'Profiles', 'abc123.default-release')
  fs.mkdirSync(profileDir, { recursive: true })
  fs.writeFileSync(path.join(profileDir, 'places.sqlite'), 'contenido-no-relevante-para-este-test')
  fs.writeFileSync(path.join(dir, 'profiles.ini'), [
    '[Profile0]',
    'Name=default-release',
    'IsRelative=1',
    'Path=Profiles/abc123.default-release',
    '',
    '[Profile1]',
    'Name=perfil-sin-datos',
    'IsRelative=1',
    'Path=Profiles/sin-datos.default',
  ].join('\n'))

  // scanFirefoxSources usa la ruta real del sistema — se simula apuntando HOME a este directorio temporal.
  const originalHome = os.homedir
  os.homedir = () => dir
  try {
    // En Mac necesita Library/Application Support/Firefox — se arma esa estructura real acá.
    const macRoot = path.join(dir, 'Library', 'Application Support', 'Firefox')
    fs.mkdirSync(macRoot, { recursive: true })
    fs.cpSync(path.join(dir, 'Profiles'), path.join(macRoot, 'Profiles'), { recursive: true })
    fs.copyFileSync(path.join(dir, 'profiles.ini'), path.join(macRoot, 'profiles.ini'))

    const sources = imp.scanFirefoxSources()
    assert.equal(sources.length, 1, 'el perfil sin places.sqlite real no debería aparecer')
    assert.equal(sources[0].profile, 'default-release')
    assert.equal(sources[0].engine, 'firefox')
  } finally {
    os.homedir = originalHome
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('readFirefoxData: reconstruye la ruta real de carpeta desde el árbol de moz_bookmarks', async () => {
  const dir = tempDir()
  const placesPath = path.join(dir, 'places.sqlite')
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(`
    CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title TEXT, dateAdded INTEGER);
    INSERT INTO moz_places (id, url, title, last_visit_date) VALUES (1, 'https://real.example.com', 'Sitio real', 1726174825005000);
    INSERT INTO moz_bookmarks (id, type, fk, parent, title, dateAdded) VALUES (10, 2, NULL, 1, 'toolbar', NULL);
    INSERT INTO moz_bookmarks (id, type, fk, parent, title, dateAdded) VALUES (11, 2, NULL, 10, 'Mi carpeta real', NULL);
    INSERT INTO moz_bookmarks (id, type, fk, parent, title, dateAdded) VALUES (20, 1, 1, 11, 'Sitio real', 1726174825005000);
  `)
  const buffer = db.export()
  fs.writeFileSync(placesPath, Buffer.from(buffer))
  db.close()

  const result = await imp.readFirefoxData(placesPath)
  assert.equal(result.bookmarks.length, 1)
  assert.equal(result.bookmarks[0].url, 'https://real.example.com')
  assert.equal(result.bookmarks[0].folder, 'Barra de marcadores/Mi carpeta real')
  assert.equal(result.history.length, 1)
  assert.equal(result.history[0].url, 'https://real.example.com')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('readFirefoxData: descarta URLs internas (about:, place:) — no son sitios reales navegables', async () => {
  const dir = tempDir()
  const placesPath = path.join(dir, 'places.sqlite')
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(`
    CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title TEXT, dateAdded INTEGER);
    INSERT INTO moz_places (id, url, title, last_visit_date) VALUES (1, 'about:preferences', 'Preferencias', 1726174825005000);
    INSERT INTO moz_places (id, url, title, last_visit_date) VALUES (2, 'https://real.example.com', 'Real', 1726174825005000);
    INSERT INTO moz_bookmarks (id, type, fk, parent, title, dateAdded) VALUES (1, 1, 1, 0, 'x', 1726174825005000);
    INSERT INTO moz_bookmarks (id, type, fk, parent, title, dateAdded) VALUES (2, 1, 2, 0, 'y', 1726174825005000);
  `)
  fs.writeFileSync(placesPath, Buffer.from(db.export()))
  db.close()

  const result = await imp.readFirefoxData(placesPath)
  assert.equal(result.bookmarks.length, 1)
  assert.equal(result.bookmarks[0].url, 'https://real.example.com')
  assert.equal(result.history.length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
