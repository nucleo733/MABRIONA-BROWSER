// Smoke test real — lanza la app de verdad (Electron + Chromium real,
// no un mock) con Playwright, navega, y toma screenshots reales.
// Mismo espíritu que los *-check.mjs de MABRIONA-STUDIO: script
// observacional, console.log + screenshots, se lee el resultado.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')
fs.mkdirSync(path.join(appRoot, 'screenshots'), { recursive: true })

const results = { pass: [], fail: [] }
const ok = (label) => { results.pass.push(label); console.log('PASS -', label) }
const bad = (label, detail) => { results.fail.push(label); console.log('FAIL -', label, detail ? `— ${detail}` : '') }

// Este entorno de desarrollo tiene ELECTRON_RUN_AS_NODE=1 seteado
// globalmente (para que otras herramientas de Node funcionen) — eso
// hace que Electron arranque como Node puro en vez de como app real
// con ventana. Se lo saca solo para este proceso hijo; una app
// empaquetada de verdad (electron-builder) nunca tiene esa variable.
const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [appRoot], env: launchEnv })
const win = await app.firstWindow()
win.on('console', (m) => console.log('[renderer console]', m.type(), m.text()))
win.on('pageerror', (e) => console.log('[renderer pageerror]', e.message))
console.log('window URL:', win.url())
await win.waitForLoadState('domcontentloaded')

ok('la app de Electron levanta y abre una ventana real')

await win.waitForTimeout(3000) // dejar que la pestaña inicial (DuckDuckGo real) cargue de verdad
await win.screenshot({ path: path.join(appRoot, 'screenshots', 'smoke-00-boot.png') })

const tabCount = await win.locator('.tab').count()
if (tabCount === 1) ok('arranca con exactamente 1 pestaña')
else bad('cantidad de pestañas al arrancar', `esperaba 1, encontré ${tabCount}`)

const addressValue = await win.locator('#address').inputValue()
if (addressValue.includes('duckduckgo.com')) ok(`la pestaña inicial navegó de verdad a DuckDuckGo (${addressValue})`)
else bad('URL de la pestaña inicial', `encontré "${addressValue}"`)

// Nueva pestaña real
await win.locator('#btn-new-tab').click()
await win.waitForTimeout(500)
const tabCountAfterNew = await win.locator('.tab').count()
if (tabCountAfterNew === 2) ok('crear una pestaña nueva funciona (ahora hay 2)')
else bad('cantidad de pestañas tras crear una nueva', `esperaba 2, encontré ${tabCountAfterNew}`)

// Navegar la pestaña activa a un sitio real
await win.locator('#address').fill('wikipedia.org')
await win.locator('#address').press('Enter')
await win.waitForTimeout(3000)
const addressAfterNav = await win.locator('#address').inputValue()
if (addressAfterNav.includes('wikipedia.org')) ok(`navegación real a un sitio funciona (${addressAfterNav})`)
else bad('navegación a wikipedia.org', `encontré "${addressAfterNav}"`)
await win.screenshot({ path: path.join(appRoot, 'screenshots', 'smoke-01-wikipedia.png') })

// Cerrar una pestaña
await win.locator('.tab-close').first().click()
await win.waitForTimeout(500)
const tabCountAfterClose = await win.locator('.tab').count()
if (tabCountAfterClose === 1) ok('cerrar una pestaña funciona (vuelve a 1)')
else bad('cantidad de pestañas tras cerrar', `esperaba 1, encontré ${tabCountAfterClose}`)

// Favoritos: agregar y ver en el panel
await win.locator('#btn-fav').click()
await win.waitForTimeout(300)
await win.locator('#btn-favorites').click()
await win.waitForTimeout(300)
const favCount = await win.locator('#favorites-list li').count()
if (favCount >= 1) ok('agregar a favoritos y verlo en el panel funciona')
else bad('panel de favoritos', 'no aparece ningún favorito tras agregar uno')
await win.screenshot({ path: path.join(appRoot, 'screenshots', 'smoke-02-favorites.png') })

// Shields: el panel abre y el toggle existe
await win.locator('[data-close="favorites"]').click()
await win.locator('#btn-shields').click()
await win.waitForTimeout(300)
const shieldsToggleVisible = await win.locator('#shields-toggle-input').isVisible()
if (shieldsToggleVisible) ok('panel de MABRIONA SHIELDS abre con el toggle visible')
else bad('panel de shields', 'el toggle no está visible')

await app.close()

console.log('\n=== RESUMEN ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  for (const f of results.fail) console.log(' -', f)
  process.exitCode = 1
}
