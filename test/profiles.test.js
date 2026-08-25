'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createProfileRegistry } = require('../profiles')

function tempDir() {
  const dir = path.join(os.tmpdir(), `mabriona-browser-profiles-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

test('primera vez (sin archivo de registro todavía): nace un único perfil "default" — migración real, no una copia', () => {
  const dir = tempDir()
  const legacy = path.join(dir, 'mabriona-browser-data.json')
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), legacy)
  const profiles = registry.list()
  assert.equal(profiles.length, 1)
  assert.equal(profiles[0].id, 'default')
  assert.equal(profiles[0].name, 'Principal')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('el perfil "default" apunta EXACTAMENTE al archivo/partición históricos — cero migración de datos', () => {
  const dir = tempDir()
  const legacy = path.join(dir, 'mabriona-browser-data.json')
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), legacy)
  assert.equal(registry.dataFilePathFor(dir, 'default'), legacy)
  assert.equal(registry.partitionFor('default'), 'persist:mabriona-browser')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('si ya había una Brave API key en el archivo viejo, se migra sola al registro (una sola vez, real)', () => {
  const dir = tempDir()
  const legacy = path.join(dir, 'mabriona-browser-data.json')
  fs.writeFileSync(legacy, JSON.stringify({ braveApiKey: 'BSA-real-de-prueba' }))
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), legacy)
  assert.equal(registry.getBraveApiKey(), 'BSA-real-de-prueba')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('crear un perfil nuevo: id único, no toca el archivo viejo ni la partición default', () => {
  const dir = tempDir()
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), path.join(dir, 'mabriona-browser-data.json'))
  const p = registry.create('Trabajo', '💼')
  assert.notEqual(p.id, 'default')
  assert.equal(p.name, 'Trabajo')
  assert.equal(registry.list().length, 2)
  assert.notEqual(registry.dataFilePathFor(dir, p.id), registry.dataFilePathFor(dir, 'default'))
  assert.notEqual(registry.partitionFor(p.id), registry.partitionFor('default'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('crear un perfil sin nombre le pone un nombre por defecto — nunca queda un perfil sin nombre', () => {
  const dir = tempDir()
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), path.join(dir, 'mabriona-browser-data.json'))
  const p = registry.create('   ')
  assert.equal(p.name, 'Nuevo perfil')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('renombrar un perfil persiste de verdad (releído desde otro registro sobre el mismo archivo)', () => {
  const dir = tempDir()
  const regFile = path.join(dir, 'profiles.json')
  const legacy = path.join(dir, 'mabriona-browser-data.json')
  const registry = createProfileRegistry(regFile, legacy)
  const p = registry.create('Antes')
  registry.rename(p.id, 'Después')
  const reloaded = createProfileRegistry(regFile, legacy)
  assert.equal(reloaded.get(p.id).name, 'Después')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('"default" nunca se puede borrar', () => {
  const dir = tempDir()
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), path.join(dir, 'mabriona-browser-data.json'))
  registry.create('Otro')
  assert.equal(registry.canDelete('default'), false)
  assert.equal(registry.remove('default'), false)
  assert.equal(registry.list().some((p) => p.id === 'default'), true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('el último perfil que queda tampoco se puede borrar — siempre tiene que haber uno', () => {
  const dir = tempDir()
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), path.join(dir, 'mabriona-browser-data.json'))
  // Solo existe 'default' — es el único, así que tampoco se puede borrar (doble motivo acá, pero se prueba la regla general).
  assert.equal(registry.canDelete('default'), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('borrar un perfil real que no es el último ni default: funciona y desaparece de la lista', () => {
  const dir = tempDir()
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), path.join(dir, 'mabriona-browser-data.json'))
  const p = registry.create('Temporal')
  assert.equal(registry.canDelete(p.id), true)
  assert.equal(registry.remove(p.id), true)
  assert.equal(registry.list().some((x) => x.id === p.id), false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('instalación 100% nueva: si viene una key empaquetada junto al código, la usa sola — sin eso la búsqueda queda muerta en producción (bug real 2026-08-25)', () => {
  const dir = tempDir()
  const bundledKeyFile = path.join(dir, 'brave-api-key.local.json')
  fs.writeFileSync(bundledKeyFile, JSON.stringify({ braveApiKey: 'BSA-empaquetada-de-verdad' }))
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), path.join(dir, 'mabriona-browser-data.json'), bundledKeyFile)
  assert.equal(registry.getBraveApiKey(), 'BSA-empaquetada-de-verdad')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('sin archivo de key empaquetada (build local de un contribuidor sin la credencial), queda sin key — honesto, no inventa una', () => {
  const dir = tempDir()
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), path.join(dir, 'mabriona-browser-data.json'), path.join(dir, 'no-existe.json'))
  assert.equal(registry.getBraveApiKey(), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('una key ya configurada (por el usuario o migrada) nunca se pisa con la empaquetada', () => {
  const dir = tempDir()
  const bundledKeyFile = path.join(dir, 'brave-api-key.local.json')
  fs.writeFileSync(bundledKeyFile, JSON.stringify({ braveApiKey: 'BSA-empaquetada' }))
  const regFile = path.join(dir, 'profiles.json')
  const legacy = path.join(dir, 'mabriona-browser-data.json')
  fs.writeFileSync(regFile, JSON.stringify({ profiles: [{ id: 'default', name: 'Principal', emoji: '👤', createdAt: 1 }], lastActiveProfileId: 'default', braveApiKey: 'BSA-ya-configurada-por-el-usuario' }))
  const registry = createProfileRegistry(regFile, legacy, bundledKeyFile)
  assert.equal(registry.getBraveApiKey(), 'BSA-ya-configurada-por-el-usuario')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('un registro existente (de antes de que esta key se empezara a empaquetar) igual la recibe al abrir de nuevo — no solo instalaciones nuevas', () => {
  const dir = tempDir()
  const bundledKeyFile = path.join(dir, 'brave-api-key.local.json')
  fs.writeFileSync(bundledKeyFile, JSON.stringify({ braveApiKey: 'BSA-empaquetada-despues' }))
  const regFile = path.join(dir, 'profiles.json')
  const legacy = path.join(dir, 'mabriona-browser-data.json')
  fs.writeFileSync(regFile, JSON.stringify({ profiles: [{ id: 'default', name: 'Principal', emoji: '👤', createdAt: 1 }], lastActiveProfileId: 'default', braveApiKey: null }))
  const registry = createProfileRegistry(regFile, legacy, bundledKeyFile)
  assert.equal(registry.getBraveApiKey(), 'BSA-empaquetada-despues')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('getLastActiveProfileId cae a "default" si el último activo guardado ya no existe (perfil borrado)', () => {
  const dir = tempDir()
  const registry = createProfileRegistry(path.join(dir, 'profiles.json'), path.join(dir, 'mabriona-browser-data.json'))
  const p = registry.create('Se va a borrar')
  registry.setLastActiveProfileId(p.id)
  registry.remove(p.id)
  assert.equal(registry.getLastActiveProfileId(), 'default')
  fs.rmSync(dir, { recursive: true, force: true })
})
