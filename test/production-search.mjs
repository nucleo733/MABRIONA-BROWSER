// Test de producción OBLIGATORIO — corre contra el .app REALMENTE EMPAQUETADO (electron-builder),
// nunca contra el código fuente en modo desarrollo, y con un `--user-data-dir` 100% nuevo — nada
// de lo que haya en la máquina de quien corre este test. Existe porque un bug real (2026-08-25) se
// coló exactamente por esta brecha: todo funcionaba en desarrollo porque el store real de la
// máquina de desarrollo ya tenía una Brave API key puesta a mano; el .app distribuido, para un
// usuario nuevo de verdad, no la tenía en ningún lado y la búsqueda quedaba muerta.
//
// Requiere haber corrido `npm run dist` antes (deja el .app en dist/mac/MABRIONA Browser.app).
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
  console.log(`No existe el .app empaquetado (${appBinary}). Corré "npm run dist" primero — este test es sobre el .app real, no sobre el código fuente.`)
  process.exit(1)
}

const freshDir = path.join(os.tmpdir(), `mabriona-browser-production-test-${Date.now()}`)
fs.mkdirSync(freshDir, { recursive: true })

const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: appBinary,
  args: [`--user-data-dir=${freshDir}`],
  env: launchEnv,
})

async function findChromeWindow(exclude = []) {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().includes('index.html') && !exclude.includes(p))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no apareció la ventana del chrome')
}
async function windowIds() {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id))
}
async function rawQueryOnWindow(windowId, q) {
  return app.evaluate(async ({ BrowserWindow }, args) => {
    const win = BrowserWindow.fromId(args.windowId)
    const view = win.getBrowserViews()[0]
    const raw = await view.webContents.executeJavaScript(`window.mabrionaSearch.query(${JSON.stringify(args.q)})`)
    return { configured: raw.configured, error: raw.error || null, webCount: raw.web ? raw.web.length : null, hasInfobox: !!raw.infobox }
  }, { windowId, q })
}

const win = await findChromeWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1200)
ok('el .app empaquetado real abre una ventana con un userData 100% nuevo')

// Usuario nuevo real: se omite el asistente de importación para seguir con el resto de este test
// (que prueba Search, no el asistente — ese tiene su propia cobertura en release-checklist.mjs).
if (await win.locator('#onboarding-overlay').isVisible()) {
  await win.locator('#onboarding-skip-1').click()
  await win.waitForTimeout(300)
}

const idsBefore = await windowIds()
const principalId = idsBefore[0]

// ---------------- El bug real: userData fresco, sin ninguna key puesta a mano ----------------
const fresh = await rawQueryOnWindow(principalId, 'romeo santos')
if (fresh.configured && fresh.webCount > 0 && fresh.hasInfobox) {
  ok(`instalación 100% nueva: MABRIONA Search funciona sin configuración manual (${fresh.webCount} resultados, Entity Focus real)`)
} else {
  bad('instalación nueva — search:query', JSON.stringify(fresh))
}

// ---------------- Varias consultas reales, todas con resultados completos ----------------
for (const q of ['apple', 'starbucks madrid', 'javascript']) {
  const r = await rawQueryOnWindow(principalId, q)
  if (r.configured && r.webCount > 0) ok(`consulta real "${q}" trae resultados completos (${r.webCount} web)`)
  else bad(`consulta real "${q}"`, JSON.stringify(r))
}

// ---------------- UI real: la página de resultados renderiza Spectrum + Entity Focus ----------------
await win.locator('#address').fill('')
await win.locator('#address').fill('romeo santos')
await win.locator('#address').press('Enter')
await win.waitForTimeout(2800)
const uiInfo = await app.evaluate(async ({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  const view = win.getBrowserViews()[0]
  return view.webContents.executeJavaScript(`({
    spectrumTabs: Array.from(document.querySelectorAll('.spectrum-tab')).map(b => b.textContent),
    cardCount: document.querySelectorAll('.card').length,
    entityFocus: !!document.querySelector('.entity-focus'),
    mentionsBrave: document.body.innerText.toLowerCase().includes('brave'),
  })`)
})
if (uiInfo.spectrumTabs.includes('Todo') && uiInfo.cardCount > 0 && uiInfo.entityFocus) {
  ok(`UI real: Spectrum (${uiInfo.spectrumTabs.join(', ')}) + ${uiInfo.cardCount} tarjetas + Entity Focus`)
} else {
  bad('UI de resultados', JSON.stringify(uiInfo))
}
if (!uiInfo.mentionsBrave) ok('MABRIONA Search en producción: la interfaz nunca menciona a Brave (proveedor invisible)')
else bad('branding', 'la página de resultados menciona "brave" en texto visible')

// ---------------- Perfiles reales: cada uno busca de verdad ----------------
const newProfile = await win.evaluate(() => window.mabrionaBrowser.createProfile('Test Producción'))
await win.evaluate((id) => window.mabrionaBrowser.switchToProfile(id), newProfile.id)
let secondId = null
for (let i = 0; i < 30; i++) {
  const diff = (await windowIds()).filter((id) => !idsBefore.includes(id))
  if (diff.length > 0) { secondId = diff[0]; break }
  await new Promise((r) => setTimeout(r, 200))
}
await new Promise((r) => setTimeout(r, 1000))
const profileResult = secondId != null ? await rawQueryOnWindow(secondId, 'javascript') : null
if (profileResult && profileResult.configured) ok('un perfil nuevo real también puede buscar (misma key global, sin configuración extra)')
else bad('búsqueda en perfil nuevo', JSON.stringify(profileResult))

const idsBeforeGuest = await windowIds()
await win.evaluate(() => window.mabrionaBrowser.newGuestWindow())
let guestId = null
for (let i = 0; i < 30; i++) {
  const diff = (await windowIds()).filter((id) => !idsBeforeGuest.includes(id))
  if (diff.length > 0) { guestId = diff[0]; break }
  await new Promise((r) => setTimeout(r, 200))
}
await new Promise((r) => setTimeout(r, 1000))
const guestResult = guestId != null ? await rawQueryOnWindow(guestId, 'javascript') : null
if (guestResult && guestResult.configured) ok('Modo Invitado también puede buscar de verdad')
else bad('búsqueda en Modo Invitado', JSON.stringify(guestResult))

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
