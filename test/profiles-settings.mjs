// E2E real de Perfiles + Configuración — botones y paneles reales, contra la app empaquetada de
// verdad (Electron + Chromium real), no un mock. Complementa profile-isolation.mjs (que prueba el
// aislamiento real de datos por debajo de la UI) probando los flujos que la persona realmente usa.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')
const results = { pass: [], fail: [] }
const ok = (label) => { results.pass.push(label); console.log('PASS -', label) }
const bad = (label, detail) => { results.fail.push(label); console.log('FAIL -', label, detail ? `— ${detail}` : '') }

// Mismo criterio que smoke.mjs: una sesión de recuperación real quedaría reabriendo pestañas
// viejas y rompería la suposición de "arranca en blanco" de este script.
const storeFile = path.join(process.env.HOME, 'Library', 'Application Support', 'MABRIONA Browser', 'mabriona-browser-data.json')
try {
  const data = JSON.parse(fs.readFileSync(storeFile, 'utf-8'))
  data.lastSession = []
  fs.writeFileSync(storeFile, JSON.stringify(data, null, 2))
} catch { /* primera corrida — nada que limpiar */ }

const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [appRoot], env: launchEnv })

async function findChromeWindow(excludePages = []) {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().endsWith('/renderer/index.html') && !excludePages.includes(p))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no apareció una ventana nueva del chrome')
}
async function windowIds() {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id))
}

const win = await findChromeWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1200)

// ---------------- Botón y panel de Perfil ----------------
const profileEmoji = await win.locator('#profile-emoji').textContent()
if (profileEmoji.trim().length > 0) ok(`botón de Perfil muestra un ícono real (${profileEmoji})`)
else bad('botón de Perfil vacío')

await win.locator('#btn-profile').click()
await win.waitForTimeout(400)
const activeNote = await win.locator('#profile-active-note').textContent()
if (activeNote.includes('Principal')) ok('panel de Perfil: muestra "Principal" como perfil activo (perfil migrado real)')
else bad('panel de Perfil — nota activa', activeNote)
const profileRowCount = await win.locator('#profile-list li').count()
if (profileRowCount === 1) ok('panel de Perfil: lista real de perfiles muestra exactamente 1 (solo Principal existe todavía)')
else bad('panel de Perfil — cantidad de filas', `esperaba 1, encontré ${profileRowCount}`)
await win.locator('[data-close="profile"]').click()

// ---------------- Configuración — General / Búsqueda, capacidades reales por perfil ----------------
await win.locator('#btn-more').click()
await win.waitForTimeout(200)
await win.locator('#more-settings').click()
await win.waitForTimeout(300)
const activeProfileLine = await win.locator('#settings-active-profile').textContent()
if (activeProfileLine.includes('Principal')) ok('Configuración → General: muestra el perfil real activo')
else bad('Configuración — perfil activo', activeProfileLine)

const restoreCheckedBefore = await win.locator('#settings-restore-session').isChecked()
if (restoreCheckedBefore) ok('Configuración → General: "Restaurar sesión" viene activado por default (comportamiento de siempre)')
else bad('Configuración — restaurar sesión default', 'esperaba activado')
await win.locator('#settings-restore-session').uncheck()
await win.waitForTimeout(300)
const restoreAfterUncheck = await win.evaluate(() => window.mabrionaBrowser.getRestoreSession())
if (restoreAfterUncheck === false) ok('Configuración → General: desactivar "Restaurar sesión" persiste de verdad (IPC real, no solo visual)')
else bad('Configuración — restaurar sesión tras desactivar', String(restoreAfterUncheck))
await win.locator('#settings-restore-session').check() // se deja como estaba
await win.waitForTimeout(300)

const engineBefore = await win.locator('#settings-search-engine').inputValue()
if (engineBefore === 'mabriona') ok('Configuración → Búsqueda: MABRIONA es el default, pero no forzado (select real, editable)')
else bad('Configuración — motor default', engineBefore)
await win.locator('#settings-search-engine').selectOption('duckduckgo')
await win.waitForTimeout(300)
const engineAfterSelect = await win.evaluate(() => window.mabrionaBrowser.getSearchEngine())
if (engineAfterSelect === 'duckduckgo') ok('Configuración → Búsqueda: elegir un motor externo persiste de verdad')
else bad('Configuración — motor tras elegir', String(engineAfterSelect))
await win.locator('#settings-search-engine').selectOption('mabriona') // se deja como estaba
await win.waitForTimeout(300)
await win.locator('[data-close="settings"]').click()

// ---------------- Modo Invitado — ventana nueva real, no deja rastro ----------------
const idsBeforeGuest = await windowIds()
await win.locator('#btn-profile').click()
await win.waitForTimeout(300)
await win.locator('#profile-guest').click()
await win.waitForTimeout(1500)
let guestWindowId = null
for (let i = 0; i < 20; i++) {
  const idsNow = await windowIds()
  const diff = idsNow.filter((id) => !idsBeforeGuest.includes(id))
  if (diff.length > 0) { guestWindowId = diff[0]; break }
  await new Promise((r) => setTimeout(r, 200))
}
if (guestWindowId != null) ok('Modo Invitado abre una ventana real nueva')
else bad('Modo Invitado', 'no se abrió ninguna ventana nueva')

const guestWin = await findChromeWindow([win])
await guestWin.waitForLoadState('domcontentloaded')
await guestWin.waitForTimeout(800)
const guestTabCount = await guestWin.locator('.tab.private').count()
if (guestTabCount === 1) ok('Modo Invitado: la pestaña inicial ya nace marcada como privada (🕶️), igual que Modo Privado')
else bad('Modo Invitado — marca privada', `esperaba 1 pestaña .private, encontré ${guestTabCount}`)

await guestWin.locator('#address').fill('https://es.wikipedia.org/wiki/Merengue')
await guestWin.locator('#address').press('Enter')
await guestWin.waitForTimeout(2000)
await guestWin.locator('#btn-more').click()
await guestWin.waitForTimeout(200)
await guestWin.locator('#more-history').click()
await guestWin.waitForTimeout(300)
const guestHistoryText = await guestWin.locator('#history-list').textContent()
if (guestHistoryText.includes('Sin historial')) ok('Modo Invitado: navegar de verdad NO deja historial (real, no simulado)')
else bad('Modo Invitado — historial', 'debería seguir vacío después de navegar')

await app.evaluate(({ BrowserWindow }, id) => { BrowserWindow.fromId(id)?.close() }, guestWindowId)
await new Promise((r) => setTimeout(r, 500))

// La ventana Principal no debe verse afectada por lo que pasó en la ventana de Invitado.
await win.locator('[data-close="history"]').click().catch(() => {})
await win.locator('#btn-more').click()
await win.waitForTimeout(200)
await win.locator('#more-history').click()
await win.waitForTimeout(300)
const principalHistoryAfterGuest = await win.locator('#history-list li').count()
if (principalHistoryAfterGuest > 0) ok('la ventana Principal conserva su propio historial real, sin mezcla con Modo Invitado')
else bad('historial de Principal tras Modo Invitado', 'quedó vacío — posible mezcla de perfiles')
await win.locator('[data-close="history"]').click()

await app.close()

console.log('\n=== RESUMEN ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  results.fail.forEach((f) => console.log(' -', f))
  process.exitCode = 1
}
