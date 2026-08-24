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

test('permisos: sin decisión previa devuelve null (nunca asume)', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  assert.equal(store.getPermission('https://a.com', 'camera'), null)
  fs.rmSync(filePath, { force: true })
})

test('permisos: allow se guarda y se puede leer', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.setPermission('https://a.com', 'camera', 'allow')
  assert.equal(store.getPermission('https://a.com', 'camera'), 'allow')
  fs.rmSync(filePath, { force: true })
})

test('permisos: deny se guarda y se puede leer', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.setPermission('https://a.com', 'microphone', 'deny')
  assert.equal(store.getPermission('https://a.com', 'microphone'), 'deny')
  fs.rmSync(filePath, { force: true })
})

test('permisos: cámara y micrófono del mismo origen se guardan aislados entre sí', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.setPermission('https://a.com', 'camera', 'allow')
  store.setPermission('https://a.com', 'microphone', 'deny')
  assert.equal(store.getPermission('https://a.com', 'camera'), 'allow')
  assert.equal(store.getPermission('https://a.com', 'microphone'), 'deny')
  fs.rmSync(filePath, { force: true })
})

test('permisos: dos orígenes distintos no se mezclan (aislamiento entre sitios)', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.setPermission('https://a.com', 'camera', 'allow')
  store.setPermission('https://b.com', 'camera', 'deny')
  assert.equal(store.getPermission('https://a.com', 'camera'), 'allow')
  assert.equal(store.getPermission('https://b.com', 'camera'), 'deny')
  fs.rmSync(filePath, { force: true })
})

test('permisos: se puede cambiar una decisión anterior', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.setPermission('https://a.com', 'camera', 'deny')
  store.setPermission('https://a.com', 'camera', 'allow')
  assert.equal(store.getPermission('https://a.com', 'camera'), 'allow')
  fs.rmSync(filePath, { force: true })
})

test('permisos: la decisión persiste en disco entre reaperturas', () => {
  const filePath = tempStorePath()
  const store1 = createStore(filePath)
  store1.setPermission('https://a.com', 'camera', 'allow')
  const store2 = createStore(filePath)
  assert.equal(store2.getPermission('https://a.com', 'camera'), 'allow')
  fs.rmSync(filePath, { force: true })
})

test('permisos: listPermissions devuelve todo lo guardado', () => {
  const filePath = tempStorePath()
  const store = createStore(filePath)
  store.setPermission('https://a.com', 'camera', 'allow')
  store.setPermission('https://b.com', 'microphone', 'deny')
  const all = store.listPermissions()
  assert.equal(all['https://a.com'].camera, 'allow')
  assert.equal(all['https://b.com'].microphone, 'deny')
  fs.rmSync(filePath, { force: true })
})
