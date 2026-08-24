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
