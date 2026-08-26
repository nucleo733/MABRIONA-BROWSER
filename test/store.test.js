'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createStore } = require('../store')

function tempStorePath() {
  return path.join(os.tmpdir(), `mabriona-browser-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
}

test('historial: agregar y listar', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addHistoryEntry({ url: 'https://a.com', title: 'A', visitedAt: 1 })
  store.addHistoryEntry({ url: 'https://b.com', title: 'B', visitedAt: 2 })
  assert.equal(store.getState().history.length, 2)
  fs.rmSync(filePath, { force: true })
})

test('historial: borrado puntual saca solo la entrada indicada', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addHistoryEntry({ url: 'https://a.com', title: 'A', visitedAt: 1 })
  store.addHistoryEntry({ url: 'https://b.com', title: 'B', visitedAt: 2 })
  store.addHistoryEntry({ url: 'https://c.com', title: 'C', visitedAt: 3 })
  store.removeHistoryEntry('https://b.com')
  const urls = store.getState().history.map((h) => h.url).sort()
  assert.deepEqual(urls, ['https://a.com', 'https://c.com'])
  fs.rmSync(filePath, { force: true })
})

test('historial: borrar una url que no existe no rompe nada', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addHistoryEntry({ url: 'https://a.com', title: 'A', visitedAt: 1 })
  store.removeHistoryEntry('https://no-existe.com')
  assert.equal(store.getState().history.length, 1)
  fs.rmSync(filePath, { force: true })
})

test('historial: el borrado puntual persiste en disco', () => {
  const filePath = tempStorePath()
  const store1 = createStore(filePath)
  store1.addHistoryEntry({ url: 'https://a.com', title: 'A', visitedAt: 1 })
  store1.addHistoryEntry({ url: 'https://b.com', title: 'B', visitedAt: 2 })
  store1.removeHistoryEntry('https://a.com')

  const store2 = createStore(filePath) // simula reabrir la app — lee el archivo real de disco
  assert.deepEqual(store2.getState().history.map((h) => h.url), ['https://b.com'])
  fs.rmSync(filePath, { force: true })
})

test('historial: Vaciar (clearHistory) sigue funcionando igual que antes', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addHistoryEntry({ url: 'https://a.com', title: 'A', visitedAt: 1 })
  store.addHistoryEntry({ url: 'https://b.com', title: 'B', visitedAt: 2 })
  store.clearHistory()
  assert.equal(store.getState().history.length, 0)
  fs.rmSync(filePath, { force: true })
})

test('onboarding: un archivo 100% nuevo empieza en false (hay que mostrar el asistente)', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  assert.equal(store.getHasCompletedOnboarding(), false)
  fs.rmSync(filePath, { force: true })
})

test('onboarding: se puede marcar como terminado y persiste en disco', () => {
  const filePath = tempStorePath()
  const store1 = createStore(filePath)
  store1.setHasCompletedOnboarding(true)
  const store2 = createStore(filePath)
  assert.equal(store2.getHasCompletedOnboarding(), true)
  fs.rmSync(filePath, { force: true })
})

test('onboarding: un archivo real que ya existía antes de este sistema se migra a true — nunca le muestra el asistente a alguien que ya usaba MABRIONA', () => {
  const filePath = tempStorePath()
  fs.writeFileSync(filePath, JSON.stringify({ history: [{ url: 'https://ya-tenia-datos.com', title: 'x', visitedAt: 1 }], favorites: [] }))
  const store = createStore(filePath)
  assert.equal(store.getHasCompletedOnboarding(), true)
  fs.rmSync(filePath, { force: true })
})

test('importFavorites: agrega favoritos reales nuevos y cuenta cuántos importó', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  const count = store.importFavorites([
    { url: 'https://importado1.com', title: 'Uno', addedAt: 1, folder: 'Barra de favoritos' },
    { url: 'https://importado2.com', title: 'Dos', addedAt: 2, folder: null },
  ])
  assert.equal(count, 2)
  assert.equal(store.listFavorites().length, 2)
  fs.rmSync(filePath, { force: true })
})

test('importFavorites: nunca duplica una URL que ya existe — la deja como estaba', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addFavorite({ url: 'https://ya-existia.com', title: 'Título original', addedAt: 1 })
  const count = store.importFavorites([{ url: 'https://ya-existia.com', title: 'Título importado (no debería pisar)', addedAt: 2 }])
  assert.equal(count, 0)
  assert.equal(store.listFavorites().length, 1)
  assert.equal(store.listFavorites()[0].title, 'Título original')
  fs.rmSync(filePath, { force: true })
})

test('importHistoryEntries: mezcla con el historial real ya existente, sin perder nada', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addHistoryEntry({ url: 'https://ya-tenia.com', title: 'Ya tenía', visitedAt: 100 })
  const total = store.importHistoryEntries([
    { url: 'https://importado.com', title: 'Importado', visitedAt: 200 },
  ])
  assert.equal(total, 2)
  const urls = store.getState().history.map((h) => h.url).sort()
  assert.deepEqual(urls, ['https://importado.com', 'https://ya-tenia.com'])
  fs.rmSync(filePath, { force: true })
})

test('importHistoryEntries: misma URL en los dos lados se queda con la visita más reciente real, no con las dos', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addHistoryEntry({ url: 'https://mismo.com', title: 'Visita vieja', visitedAt: 100 })
  store.importHistoryEntries([{ url: 'https://mismo.com', title: 'Visita más reciente importada', visitedAt: 500 }])
  const entries = store.getState().history.filter((h) => h.url === 'https://mismo.com')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].title, 'Visita más reciente importada')
  fs.rmSync(filePath, { force: true })
})

// ---------------- Carpetas reales de Favoritos ----------------

test('carpetas: crear una real y verla en listFolders', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  const folder = store.createFolder('Música')
  assert.equal(folder.name, 'Música')
  assert.equal(folder.parentId, null)
  assert.equal(store.listFolders().length, 1)
  fs.rmSync(filePath, { force: true })
})

test('carpetas: subcarpeta real (parentId apunta a la carpeta padre real)', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  const padre = store.createFolder('Trabajo')
  const hija = store.createFolder('Proyectos', padre.id)
  assert.equal(hija.parentId, padre.id)
  fs.rmSync(filePath, { force: true })
})

test('carpetas: renombrar persiste de verdad', () => {
  const filePath = tempStorePath()
  const store1 = createStore(filePath)
  const folder = store1.createFolder('Nombre viejo')
  store1.renameFolder(folder.id, 'Nombre nuevo')
  const store2 = createStore(filePath)
  assert.equal(store2.getFolder(folder.id).name, 'Nombre nuevo')
  fs.rmSync(filePath, { force: true })
})

test('carpetas: mover una carpeta adentro de su propio hijo se rechaza — no rompe el árbol en un ciclo', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  const padre = store.createFolder('Padre')
  const hijo = store.createFolder('Hijo', padre.id)
  const resultado = store.moveFolder(padre.id, hijo.id)
  assert.equal(resultado, false)
  assert.equal(store.getFolder(padre.id).parentId, null, 'el padre no debería haberse movido')
  fs.rmSync(filePath, { force: true })
})

test('carpetas: mover una carpeta real a otro padre real funciona', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  const a = store.createFolder('A')
  const b = store.createFolder('B')
  store.moveFolder(a.id, b.id)
  assert.equal(store.getFolder(a.id).parentId, b.id)
  fs.rmSync(filePath, { force: true })
})

test('carpetas: borrar una carpeta NUNCA borra lo que tenía adentro — sube todo un nivel real', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  const padre = store.createFolder('Padre')
  const subcarpeta = store.createFolder('Subcarpeta', padre.id)
  store.addFavorite({ url: 'https://adentro.com', title: 'Favorito adentro', addedAt: 1, folderId: padre.id })
  store.deleteFolder(padre.id)
  assert.equal(store.getFolder(padre.id), null, 'la carpeta borrada ya no existe')
  assert.equal(store.getFolder(subcarpeta.id).parentId, null, 'la subcarpeta subió al nivel raíz real')
  const favorito = store.listFavorites().find((f) => f.url === 'https://adentro.com')
  assert.equal(favorito.folderId, null, 'el favorito no se perdió, subió al nivel raíz real')
  fs.rmSync(filePath, { force: true })
})

test('favoritos: moveFavorite cambia la carpeta real de un favorito ya guardado', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  const folder = store.createFolder('Destino')
  store.addFavorite({ url: 'https://mover.com', title: 'x', addedAt: 1 })
  store.moveFavorite('https://mover.com', folder.id)
  assert.equal(store.listFavorites()[0].folderId, folder.id)
  fs.rmSync(filePath, { force: true })
})

test('favoritos: renameFavorite persiste el título nuevo real', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addFavorite({ url: 'https://renombrar.com', title: 'Viejo', addedAt: 1 })
  store.renameFavorite('https://renombrar.com', 'Nuevo título real')
  assert.equal(store.listFavorites()[0].title, 'Nuevo título real')
  fs.rmSync(filePath, { force: true })
})

test('favoritos: updateFavoriteUrl cambia la URL real, pero nunca pisa otro favorito que ya use esa URL', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.addFavorite({ url: 'https://uno.com', title: 'Uno', addedAt: 1 })
  store.addFavorite({ url: 'https://dos.com', title: 'Dos', addedAt: 2 })
  const okReal = store.updateFavoriteUrl('https://uno.com', 'https://uno-actualizado.com')
  assert.equal(okReal, true)
  assert.ok(store.listFavorites().some((f) => f.url === 'https://uno-actualizado.com'))
  const rechazado = store.updateFavoriteUrl('https://dos.com', 'https://uno-actualizado.com')
  assert.equal(rechazado, false, 'no debe pisar un favorito real que ya usa esa URL')
  fs.rmSync(filePath, { force: true })
})

test('migración real: un archivo viejo con favoritos guardados como ruta de texto ("folder") se convierte a carpetas reales con id, sin perder ningún favorito', () => {
  const filePath = tempStorePath()
  fs.writeFileSync(filePath, JSON.stringify({
    favorites: [
      { url: 'https://a.com', title: 'A', addedAt: 1, folder: 'Barra de favoritos/Trabajo' },
      { url: 'https://b.com', title: 'B', addedAt: 2, folder: 'Barra de favoritos/Trabajo' },
      { url: 'https://c.com', title: 'C', addedAt: 3, folder: null },
    ],
  }))
  const store = createStore(filePath)
  assert.equal(store.listFavorites().length, 3, 'ningún favorito real se perdió en la migración')
  const folders = store.listFolders()
  const nombres = folders.map((f) => f.name).sort()
  assert.deepEqual(nombres, ['Barra de favoritos', 'Trabajo'])
  const a = store.listFavorites().find((f) => f.url === 'https://a.com')
  const b = store.listFavorites().find((f) => f.url === 'https://b.com')
  assert.equal(a.folderId, b.folderId, 'A y B compartían la misma ruta real — deben terminar en la MISMA carpeta, no en dos duplicadas')
  const c = store.listFavorites().find((f) => f.url === 'https://c.com')
  assert.equal(c.folderId, null)
  fs.rmSync(filePath, { force: true })
})

test('importFavorites: crea carpetas reales a partir de la ruta de la extensión importada, reutilizando una que ya exista con el mismo nombre', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.createFolder('Barra de favoritos') // ya existía una carpeta real con ese nombre
  store.importFavorites([{ url: 'https://importado.com', title: 'Importado', addedAt: 1, folder: 'Barra de favoritos' }])
  assert.equal(store.listFolders().length, 1, 'no debería crear una carpeta "Barra de favoritos" duplicada')
  const fav = store.listFavorites().find((f) => f.url === 'https://importado.com')
  assert.equal(fav.folderId, store.listFolders()[0].id)
  fs.rmSync(filePath, { force: true })
})
