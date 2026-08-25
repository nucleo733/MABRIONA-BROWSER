// Recuperación de sesión real: cierra la app de verdad y la vuelve a abrir, verificando que la
// pestaña reabre la misma URL real — no se puede probar dentro de smoke.mjs porque ese script
// mantiene UNA sola sesión de Electron corriendo todo el tiempo.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')
const results = { pass: [], fail: [] }
const ok = (label) => { results.pass.push(label); console.log('PASS -', label) }
const bad = (label, detail) => { results.fail.push(label); console.log('FAIL -', label, detail ? `— ${detail}` : '') }

const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE

async function findChromeWindow(app) {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().endsWith('/renderer/index.html'))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no apareció la ventana del chrome')
}

// Paso 1 — arrancar limpio, navegar a un sitio real, cerrar la app (dispara el guardado de sesión).
const app1 = await electron.launch({ args: [appRoot], env: launchEnv })
const win1 = await findChromeWindow(app1)
await win1.waitForTimeout(1000)
await win1.locator('#address').fill('https://es.wikipedia.org/wiki/Bachata')
await win1.locator('#address').press('Enter')
await win1.waitForTimeout(2500)
await app1.close()
await new Promise((r) => setTimeout(r, 500)) // dar tiempo real a que el proceso cierre del todo

// Paso 2 — relanzar y verificar que la pestaña real reabre esa misma URL.
const app2 = await electron.launch({ args: [appRoot], env: launchEnv })
const win2 = await findChromeWindow(app2)
await win2.waitForTimeout(2000)
const restoredAddress = await win2.locator('#address').inputValue()
if (restoredAddress.includes('wikipedia.org') && restoredAddress.includes('Bachata')) {
  ok(`recuperación de sesión real: la pestaña reabre la URL real de la sesión anterior (${restoredAddress})`)
} else {
  bad('recuperación de sesión', `esperaba una URL con wikipedia.org/Bachata, encontré "${restoredAddress}"`)
}
const tabCount = await win2.locator('.tab').count()
if (tabCount === 1) ok('recuperación de sesión: reabre exactamente 1 pestaña (no duplica)')
else bad('recuperación de sesión — cantidad de pestañas', `esperaba 1, encontré ${tabCount}`)

// Limpieza — dejar la sesión guardada en blanco para no interferir con smoke.mjs ni con el uso real.
await app2.close()
const storeFile = path.join(process.env.HOME, 'Library', 'Application Support', 'MABRIONA Browser', 'mabriona-browser-data.json')
try {
  const data = JSON.parse(fs.readFileSync(storeFile, 'utf-8'))
  data.lastSession = []
  fs.writeFileSync(storeFile, JSON.stringify(data, null, 2))
} catch { /* nada que limpiar */ }

console.log('\n=== RESUMEN ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  results.fail.forEach((f) => console.log(' -', f))
  process.exitCode = 1
}
