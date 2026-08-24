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

test('descargas: sin elegir carpeta, devuelve null (usar el default del sistema)', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  assert.equal(store.getDownloadsDir(), null)
  fs.rmSync(filePath, { force: true })
})

test('descargas: elegir una carpeta se guarda y persiste', () => {
  const filePath = tempStorePath()
  const store1 = createStore(filePath)
  store1.setDownloadsDir('/Users/alguien/MisDescargas')
  const store2 = createStore(filePath)
  assert.equal(store2.getDownloadsDir(), '/Users/alguien/MisDescargas')
  fs.rmSync(filePath, { force: true })
})

test('permisos: clearPermission olvida una decisión puntual', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.setPermission('https://a.com', 'camera', 'allow')
  store.setPermission('https://a.com', 'microphone', 'deny')
  store.clearPermission('https://a.com', 'camera')
  assert.equal(store.getPermission('https://a.com', 'camera'), null)
  assert.equal(store.getPermission('https://a.com', 'microphone'), 'deny') // el otro permiso del mismo sitio no se toca
  fs.rmSync(filePath, { force: true })
})

test('permisos: clearPermission sobre un origen sin permisos no rompe nada', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.clearPermission('https://no-existe.com', 'camera')
  assert.deepEqual(store.listPermissions(), {})
  fs.rmSync(filePath, { force: true })
})
