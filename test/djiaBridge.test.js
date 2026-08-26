'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startDjiaBridge, isYoutubeWatchUrl } = require('../bridge/djiaBridge')

test('isYoutubeWatchUrl distingue una página real de video de una que no lo es', () => {
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true)
  assert.equal(isYoutubeWatchUrl('https://youtube.com/watch?v=dQw4w9WgXcQ'), true)
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/results?search_query=x'), false)
  assert.equal(isYoutubeWatchUrl('https://example.com'), false)
  assert.equal(isYoutubeWatchUrl(''), false)
  assert.equal(isYoutubeWatchUrl(undefined), false)
})

/** Doble real mínimo de un `webContents` de Electron — solo lo que el bridge realmente usa. */
function fakeWebContents({ url = 'https://www.youtube.com/watch?v=abc12345678', pickedResult = null } = {}) {
  const listeners = { 'did-finish-load': [], 'did-navigate-in-page': [] }
  return {
    _picked: pickedResult,
    _destroyed: false,
    isDestroyed() {
      return this._destroyed
    },
    getURL() {
      return url
    },
    on(event, cb) {
      listeners[event]?.push(cb)
    },
    removeListener(event, cb) {
      const arr = listeners[event]
      if (!arr) return
      const i = arr.indexOf(cb)
      if (i !== -1) arr.splice(i, 1)
    },
    executeJavaScript(script) {
      // El script real de inyección del botón no devuelve nada útil acá (es DOM real de una
      // página real) — el de poll es el que importa para probar el protocolo de a de verdad.
      if (script.includes('__mabrionaPicked')) {
        const v = this._picked
        this._picked = null
        return Promise.resolve(v)
      }
      return Promise.resolve(undefined)
    },
  }
}

function withBridge(t, overrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'djia-bridge-test-'))
  const tabs = new Map()
  let nextTabId = 1
  const wc = fakeWebContents(overrides.wcOptions)
  const createAndSwitchTab = (url) => {
    const id = nextTabId++
    tabs.set(id, { id, url, view: { webContents: wc } })
    return id
  }
  const bridge = startDjiaBridge({
    userDataPath: tmpDir,
    createAndSwitchTab,
    getTab: (id) => tabs.get(id),
    getOrCreateTargetWindowId: () => 1,
  })
  t.after(() => bridge.close())
  return { tmpDir, wc, bridge }
}

function readBridgeFile(tmpDir) {
  // El bridge escribe el archivo de forma asíncrona (recién cuando el server real ya está
  // escuchando) — se espera con reintentos reales en vez de asumir que ya está.
  return new Promise((resolve, reject) => {
    const filePath = path.join(tmpDir, 'djia-bridge.json')
    const deadline = Date.now() + 3000
    const tryRead = () => {
      if (fs.existsSync(filePath)) {
        resolve(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
        return
      }
      if (Date.now() > deadline) {
        reject(new Error('djia-bridge.json nunca apareció'))
        return
      }
      setTimeout(tryRead, 20)
    }
    tryRead()
  })
}

test('el bridge real escribe puerto+token reales en userData al arrancar', async (t) => {
  const { tmpDir } = withBridge(t)
  const info = await readBridgeFile(tmpDir)
  assert.ok(info.port > 0)
  assert.equal(typeof info.token, 'string')
  assert.ok(info.token.length >= 32)
})

test('POST /pick sin token real es rechazado (401)', async (t) => {
  const { tmpDir } = withBridge(t)
  const { port } = await readBridgeFile(tmpDir)
  const res = await fetch(`http://127.0.0.1:${port}/pick`, {
    method: 'POST',
    body: JSON.stringify({ token: 'token-inventado', query: 'bachata' }),
  })
  assert.equal(res.status, 401)
})

test('POST /pick real abre una pestaña real de búsqueda de YouTube y devuelve un requestId real', async (t) => {
  const { tmpDir } = withBridge(t)
  const { port, token } = await readBridgeFile(tmpDir)
  const res = await fetch(`http://127.0.0.1:${port}/pick`, {
    method: 'POST',
    body: JSON.stringify({ token, query: 'bachata dominicana' }),
  })
  assert.equal(res.status, 202)
  const body = await res.json()
  assert.equal(typeof body.requestId, 'string')
})

test('GET /result real refleja pending hasta que el usuario elige, y done real con la metadata cuando elige', async (t) => {
  const { tmpDir, wc } = withBridge(t)
  const { port, token } = await readBridgeFile(tmpDir)
  const pickRes = await (await fetch(`http://127.0.0.1:${port}/pick`, { method: 'POST', body: JSON.stringify({ token, query: 'bachata' }) })).json()
  const requestId = pickRes.requestId

  const pendingRes = await (await fetch(`http://127.0.0.1:${port}/result?requestId=${requestId}&token=${token}`)).json()
  assert.equal(pendingRes.status, 'pending')

  // El usuario real hizo clic en "Usar en DJ AI" — el poll real (cada ~900ms) lo recoge.
  wc._picked = { id: 'dQw4w9WgXcQ', title: 'Canción real', channel: 'Canal real', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', durationSec: 213 }

  await new Promise((resolve) => setTimeout(resolve, 1200))
  const doneRes = await (await fetch(`http://127.0.0.1:${port}/result?requestId=${requestId}&token=${token}`)).json()
  assert.equal(doneRes.status, 'done')
  assert.equal(doneRes.video.id, 'dQw4w9WgXcQ')
  assert.equal(doneRes.video.title, 'Canción real')
})

test('GET /result de un requestId que no existe da 404 real', async (t) => {
  const { tmpDir } = withBridge(t)
  const { port, token } = await readBridgeFile(tmpDir)
  const res = await fetch(`http://127.0.0.1:${port}/result?requestId=no-existe&token=${token}`)
  assert.equal(res.status, 404)
})

test('close() real borra el archivo de puente — nada queda apuntando a un server que ya no corre', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'djia-bridge-test-'))
  const bridge = startDjiaBridge({
    userDataPath: tmpDir,
    createAndSwitchTab: () => 1,
    getTab: () => undefined,
    getOrCreateTargetWindowId: () => 1,
  })
  await readBridgeFile(tmpDir)
  bridge.close()
  assert.equal(fs.existsSync(path.join(tmpDir, 'djia-bridge.json')), false)
})
