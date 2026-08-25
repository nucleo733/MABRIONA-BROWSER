// Checklist de release (Fase C/V, 1.1) — el flujo completo de un usuario real contra el .APP
// REALMENTE EMPAQUETADO (no el código fuente en modo desarrollo), con un userData 100% nuevo:
// instalar → abrir → pestaña → navegar → buscar → perfil → privado → historial → favoritos →
// descarga → shields → cerrar → reabrir → verificar recuperación de sesión.
// Requiere haber corrido "npm run dist" antes (dist/mac/MABRIONA Browser.app).
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')
const appBinary = path.join(appRoot, 'dist', 'mac', 'MABRIONA Browser.app', 'Contents', 'MacOS', 'MABRIONA Browser')

const results = { pass: [], fail: [] }
const ok = (label) => { results.pass.push(label); console.log('PASS -', label) }
const bad = (label, detail) => { results.fail.push(label); console.log('FAIL -', label, detail ? `— ${detail}` : '') }

if (!fs.existsSync(appBinary)) {
  console.log(`No existe el .app empaquetado (${appBinary}). Corré "npm run dist" primero.`)
  process.exit(1)
}

const freshDir = path.join(os.tmpdir(), `mabriona-browser-release-checklist-${Date.now()}`)
fs.mkdirSync(freshDir, { recursive: true })
const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE

async function findChromeWindow(app, exclude = []) {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().includes('index.html') && !exclude.includes(p))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no apareció la ventana del chrome')
}

// ---------------- Sesión 1: instalar (userData nuevo) → abrir → usar ----------------
let app = await electron.launch({ executablePath: appBinary, args: [`--user-data-dir=${freshDir}`], env: launchEnv })
let win = await findChromeWindow(app)
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1200)
ok('el .app empaquetado real abre con un userData 100% nuevo (instalación simulada de un usuario nuevo)')

// Crear pestaña
await win.locator('#btn-new-tab').click()
await win.waitForTimeout(500)
const tabCount = await win.locator('.tab').count()
if (tabCount === 2) ok('crear una pestaña nueva funciona (ahora hay 2)')
else bad('crear pestaña', `esperaba 2, encontré ${tabCount}`)

// Navegar
await win.locator('#address').fill('https://es.wikipedia.org/wiki/Bachata')
await win.locator('#address').press('Enter')
await win.waitForTimeout(2500)
const tabsAfterNav = await win.evaluate(() => window.mabrionaBrowser.getTabsState())
if (tabsAfterNav.find((t) => t.isActive)?.url.includes('wikipedia.org')) ok('navegación real a un sitio funciona')
else bad('navegación', JSON.stringify(tabsAfterNav.find((t) => t.isActive)))

// Buscar (misma pestaña, otra query)
await win.locator('#address').fill('romeo santos')
await win.locator('#address').press('Enter')
await win.waitForTimeout(2800)
const searchInfo = await app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const view = w.getBrowserViews()[0]
  return view.webContents.executeJavaScript(`({ cardCount: document.querySelectorAll('.card').length, entityFocus: !!document.querySelector('.entity-focus') })`)
})
if (searchInfo.cardCount > 0 && searchInfo.entityFocus) ok(`MABRIONA Search real funciona en el .app instalado (${searchInfo.cardCount} tarjetas, Entity Focus)`)
else bad('búsqueda en el .app instalado', JSON.stringify(searchInfo))

// Favorito
await win.locator('#btn-fav').click()
await win.waitForTimeout(300)
await win.locator('#btn-favorites').click()
await win.waitForTimeout(300)
const favCount = await win.locator('#favorites-list li').count()
if (favCount >= 1) ok('agregar a favoritos funciona en el .app instalado')
else bad('favoritos', 'no aparece ningún favorito')
await win.locator('[data-close="favorites"]').click()

// Historial
await win.locator('#btn-history').click()
await win.waitForTimeout(300)
const histCount = await win.locator('#history-list li').count()
if (histCount >= 1) ok(`historial real funciona en el .app instalado (${histCount} entradas)`)
else bad('historial', 'vacío después de navegar')
await win.locator('[data-close="history"]').click()

// Descarga real (captura de pantalla, mismo mecanismo que usa Descargas)
await win.locator('#btn-screenshot').click()
await win.waitForTimeout(1500)
await win.locator('#btn-downloads').click()
await win.waitForTimeout(300)
const dlCount = await win.locator('#downloads-list li').count()
if (dlCount >= 1) ok('descarga real (captura de pantalla) aparece en el panel de Descargas')
else bad('descargas', 'no aparece ninguna descarga')
await win.locator('[data-close="downloads"]').click()

// Shields (panel abre; el bloqueo real ya está cubierto por smoke.mjs)
await win.locator('#btn-shields').click()
await win.waitForTimeout(300)
if (await win.locator('#shields-toggle-input').isVisible()) ok('panel de MABRIONA SHIELDS abre en el .app instalado')
else bad('Shields', 'toggle no visible')
await win.locator('[data-close="shields"]').click()

// Perfil nuevo
const idsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id))
const newProfile = await win.evaluate(() => window.mabrionaBrowser.createProfile('Checklist'))
await win.evaluate((id) => window.mabrionaBrowser.switchToProfile(id), newProfile.id)
let profileWinId = null
for (let i = 0; i < 30; i++) {
  const diff = (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id))).filter((id) => !idsBefore.includes(id))
  if (diff.length > 0) { profileWinId = diff[0]; break }
  await new Promise((r) => setTimeout(r, 200))
}
if (profileWinId != null) ok('crear un perfil nuevo abre una ventana real en el .app instalado')
else bad('perfil nuevo', 'no abrió ventana')
if (profileWinId != null) await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), profileWinId)
// Crear/cambiar de perfil actualiza cuál es "el último perfil activo" — se vuelve a Principal
// antes de cerrar, si no la recuperación de sesión de abajo reabriría el perfil nuevo (vacío) en
// vez de Principal, que es donde realmente pasó toda la navegación de este test.
await win.evaluate(() => window.mabrionaBrowser.switchToProfile('default'))
await win.waitForTimeout(300)

// Modo Privado
await win.evaluate(() => window.mabrionaBrowser.createPrivateTab())
await win.waitForTimeout(500)
const tabsWithPrivate = await win.evaluate(() => window.mabrionaBrowser.getTabsState())
if (tabsWithPrivate.some((t) => t.isPrivate)) ok('Modo Privado real funciona en el .app instalado')
else bad('Modo Privado', 'ninguna pestaña marcada como privada')

await win.waitForTimeout(1000) // dejar que se guarde la sesión (debounce real de 800ms)
await app.close()
ok('cerrar la app funciona sin colgarse')

// ---------------- Sesión 2: reabrir → verificar recuperación ----------------
await new Promise((r) => setTimeout(r, 500))
app = await electron.launch({ executablePath: appBinary, args: [`--user-data-dir=${freshDir}`], env: launchEnv })
win = await findChromeWindow(app)
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2000)
const tabsAfterReopen = await win.evaluate(() => window.mabrionaBrowser.getTabsState())
const restoredUrls = tabsAfterReopen.map((t) => t.url)
if (restoredUrls.some((u) => u.includes('results.html') || u.includes('wikipedia.org'))) {
  ok(`recuperación de sesión real: reabre las pestañas reales de la sesión anterior (${restoredUrls.length} pestañas)`)
} else {
  bad('recuperación de sesión', JSON.stringify(restoredUrls))
}
// La pestaña privada nunca debe reaparecer — no deja rastro a propósito.
if (!tabsAfterReopen.some((t) => t.isPrivate)) ok('Modo Privado real: no se restauró ninguna pestaña privada (no deja rastro, como se documentó)')
else bad('Modo Privado tras reabrir', 'una pestaña privada se restauró — no debería pasar nunca')

await app.close()
fs.rmSync(freshDir, { recursive: true, force: true })

console.log('\n=== RESUMEN ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  results.fail.forEach((f) => console.log(' -', f))
  process.exitCode = 1
}
