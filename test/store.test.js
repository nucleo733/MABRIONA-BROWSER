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
