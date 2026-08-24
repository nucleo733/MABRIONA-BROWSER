'use strict'

// Uso: node scripts/set-brave-key.js <API_KEY>
// Guarda la key en el mismo archivo de userData que usa la app instalada
// (no en el repo, no en git) — la próxima vez que se abra MABRIONA
// Browser, la búsqueda propia ya la va a usar.

const path = require('node:path')
const os = require('node:os')
const { createStore } = require('../store')

const key = process.argv[2]
if (!key) {
  console.error('Uso: node scripts/set-brave-key.js <API_KEY>')
  process.exit(1)
}

// Mismo path que arma Electron para `app.getPath('userData')` en macOS para esta app
// (ver `productName` en package.json) — no depende de tener Electron corriendo.
const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'MABRIONA Browser', 'mabriona-browser-data.json')
const store = createStore(userDataPath)
store.setBraveApiKey(key)
console.log('Listo — key guardada en', userDataPath)
