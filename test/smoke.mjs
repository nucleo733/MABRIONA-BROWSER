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
// El chrome (renderer/index.html) y el contenido de cada pestaña (BrowserView) son targets CDP
// separados — `firstWindow()` puede devolver cualquiera de los dos según el orden de carga (antes
// no importaba porque duckduckgo.com por red siempre tardaba más que el chrome local; ahora que la
// pestaña inicial también es un archivo local, hay que pedir el chrome explícitamente por URL).
async function findChromeWindow() {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().endsWith('/renderer/index.html'))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no apareció la ventana del chrome (renderer/index.html)')
}
const win = await findChromeWindow()
win.on('console', (m) => console.log('[renderer console]', m.type(), m.text()))
win.on('pageerror', (e) => console.log('[renderer pageerror]', e.message))
console.log('window URL:', win.url())
await win.waitForLoadState('domcontentloaded')

ok('la app de Electron levanta y abre una ventana real')

await win.waitForTimeout(1500) // dejar que la pestaña inicial (MABRIONA newtab, local) cargue
await win.screenshot({ path: path.join(appRoot, 'screenshots', 'smoke-00-boot.png') })

const tabCount = await win.locator('.tab').count()
if (tabCount === 1) ok('arranca con exactamente 1 pestaña')
else bad('cantidad de pestañas al arrancar', `esperaba 1, encontré ${tabCount}`)

const addressValue = await win.locator('#address').inputValue()
if (addressValue === '') ok('la pestaña inicial abre la página propia de MABRIONA (barra de direcciones vacía, como una new-tab real)')
else bad('URL de la pestaña inicial', `esperaba barra vacía, encontré "${addressValue}"`)

// El contenido de la pestaña (BrowserView) es una capa nativa separada del DOM de la ventana —
// Playwright no puede hacer `win.locator(...)` ahí adentro (limitación conocida, ver README). Se
// verifica desde el proceso principal con la API real de Electron (`getBrowserViews`), no fingido.
const tabUrls = await app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows()[0].getBrowserViews().map((v) => v.webContents.getURL()),
)
if (tabUrls.some((u) => u.endsWith('/renderer/newtab.html'))) ok(`la pestaña inicial cargó de verdad la página propia de MABRIONA (${tabUrls[0]})`)
else bad('URL real de la pestaña inicial', JSON.stringify(tabUrls))

// Buscar desde esa página (form real, sin JS) tiene que llevar de verdad a DuckDuckGo — se
// completa el form vía CDP (executeJavaScript no está sujeto al CSP de la página, mismo mecanismo
// que usaría un usuario tipeando, no una inyección que la CSP debería bloquear).
await app.evaluate(({ BrowserWindow }) => {
  const view = BrowserWindow.getAllWindows()[0].getBrowserViews()[0]
  return view.webContents.executeJavaScript(
    "document.querySelector('input[name=q]').value = 'mabriona'; document.querySelector('form').submit();",
  )
})
await win.waitForTimeout(2500)
const addressAfterSearch = await win.locator('#address').inputValue()
if (addressAfterSearch.includes('duckduckgo.com')) ok(`buscar desde la página de inicio de MABRIONA navega de verdad a DuckDuckGo (${addressAfterSearch})`)
else bad('búsqueda desde la página de inicio', `encontré "${addressAfterSearch}"`)

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
