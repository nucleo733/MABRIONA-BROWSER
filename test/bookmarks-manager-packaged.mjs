// Gestor de favoritos — verificación real contra el .app EMPAQUETADO (no el código fuente), con
// un userData 100% nuevo: crear una carpeta real, cerrar la app, reabrir, confirmar que persiste.
// Además confirma lo que solo tiene sentido probar en un escenario multi-perfil real: que las
// carpetas/favoritos de un perfil NO se mezclan con las de otro, y que Modo Invitado nunca
// persiste nada de esto (mismo criterio ya usado en test/profile-isolation.mjs).
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

const freshDir = path.join(os.tmpdir(), `mabriona-bookmarks-packaged-${Date.now()}`)
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

// ---------------- Sesión 1: userData nuevo → omitir asistente → crear carpeta real ----------------
let app = await electron.launch({ executablePath: appBinary, args: [`--user-data-dir=${freshDir}`], env: launchEnv })
let win = await findChromeWindow(app)
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)

const onboardingVisible = await win.locator('#onboarding-overlay:not(.hidden)').count()
if (onboardingVisible === 1) {
  await win.locator('#onboarding-skip-1').click()
  await win.waitForTimeout(300)
}

await win.evaluate(async () => {
  const folder = await window.mabrionaBrowser.createFolder('Carpeta Real Empaquetada')
  await window.mabrionaBrowser.addFavorite({ url: 'https://example.com/?packaged-test=1', title: 'Favorito Real Empaquetado', addedAt: Date.now(), folderId: folder.id })
  await window.refreshAllFavoritesUI()
})
await win.waitForTimeout(300)
const barShowsFolder = await win.locator('.fav-bar-folder-btn', { hasText: 'Carpeta Real Empaquetada' }).count()
if (barShowsFolder === 1) ok('gestor de favoritos en el .app instalado: crear una carpeta real se ve de inmediato en la barra')
else bad('crear carpeta en el .app instalado', `count=${barShowsFolder}`)

await app.close()

// ---------------- Sesión 2: reabrir con el MISMO userData — tiene que seguir ahí ----------------
app = await electron.launch({ executablePath: appBinary, args: [`--user-data-dir=${freshDir}`], env: launchEnv })
win = await findChromeWindow(app)
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
const persistedAfterRestart = await win.evaluate(() => window.mabrionaBrowser.listFolders())
if (persistedAfterRestart.some((f) => f.name === 'Carpeta Real Empaquetada')) {
  ok('gestor de favoritos en el .app instalado: la carpeta real sigue ahí después de cerrar y reabrir')
} else {
  bad('persistencia en el .app instalado', JSON.stringify(persistedAfterRestart))
}

// ---------------- Perfiles reales: un perfil nuevo no ve las carpetas del Principal ----------------
const profile = await win.evaluate((name) => window.mabrionaBrowser.createProfile(name), 'Perfil Bookmarks E2E')
const windowIdsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id))
await win.evaluate((id) => window.mabrionaBrowser.switchToProfile(id), profile.id)
await win.waitForTimeout(800)
const profileWin = await findChromeWindow(app, [win])
await profileWin.waitForLoadState('domcontentloaded')
await profileWin.waitForTimeout(500)
const foldersInNewProfile = await profileWin.evaluate(() => window.mabrionaBrowser.listFolders())
if (foldersInNewProfile.length === 0) {
  ok('perfiles reales: un perfil nuevo arranca sin ninguna carpeta del perfil Principal (aislamiento real, no compartido)')
} else {
  bad('aislamiento de carpetas entre perfiles', JSON.stringify(foldersInNewProfile))
}
await profileWin.evaluate(async () => { await window.mabrionaBrowser.createFolder('Solo De Este Perfil') })
await win.waitForTimeout(300)
const stillNotInMain = (await win.evaluate(() => window.mabrionaBrowser.listFolders())).some((f) => f.name === 'Solo De Este Perfil')
if (!stillNotInMain) ok('perfiles reales: una carpeta creada en el perfil nuevo no aparece en el perfil Principal')
else bad('fuga de carpetas entre perfiles', 'la carpeta del perfil nuevo apareció en el Principal')
// Cerrar la ventana del perfil nuevo ANTES de abrir Invitado — si no, la siguiente búsqueda de
// "una ventana que no sea `win`" podría agarrar esta por error en vez de la de Invitado.
await profileWin.close()
await win.waitForTimeout(300)
await win.evaluate((id) => window.mabrionaBrowser.deleteProfile(id), profile.id).catch(() => {})

// ---------------- Modo Invitado real: crear una carpeta ahí nunca debe persistir ----------------
await win.evaluate(() => window.mabrionaBrowser.newGuestWindow())
await win.waitForTimeout(800)
const guestWin = await findChromeWindow(app, [win])
const guestUrl = await guestWin.evaluate(() => window.mabrionaBrowser.getActiveProfile())
if (!guestUrl?.isGuest) bad('ventana de Invitado — identificación en el test', `la ventana encontrada no es Invitado: ${JSON.stringify(guestUrl)}`)
await guestWin.waitForLoadState('domcontentloaded')
await guestWin.waitForTimeout(500)
await guestWin.evaluate(async () => { await window.mabrionaBrowser.createFolder('Carpeta De Invitado — Nunca Debe Persistir') })
await guestWin.waitForTimeout(300)
const guestFolderVisibleLive = await guestWin.evaluate(() => window.mabrionaBrowser.listFolders())
const liveOk = guestFolderVisibleLive.some((f) => f.name.includes('Nunca Debe Persistir'))
if (liveOk) ok('Modo Invitado: crear una carpeta funciona en memoria durante la sesión (como se espera)')
else bad('Modo Invitado — creación en memoria', 'no se vio ni siquiera en vivo')
await guestWin.close()
await win.waitForTimeout(300)

await app.close()

// ---------------- Sesión 3: reabrir de nuevo — la carpeta de Invitado NUNCA debió guardarse ----------------
app = await electron.launch({ executablePath: appBinary, args: [`--user-data-dir=${freshDir}`], env: launchEnv })
win = await findChromeWindow(app)
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
const finalFolders = await win.evaluate(() => window.mabrionaBrowser.listFolders())
const guestLeaked = finalFolders.some((f) => f.name.includes('Nunca Debe Persistir'))
if (!guestLeaked) ok('Modo Invitado real: la carpeta creada en Invitado NO existe después de reabrir la app — se olvidó de verdad, como Historial/Favoritos')
else bad('fuga de datos de Modo Invitado', 'la carpeta de Invitado sobrevivió al reinicio — esto no debería pasar nunca')
if (finalFolders.some((f) => f.name === 'Carpeta Real Empaquetada')) ok('la carpeta real del perfil Principal sigue intacta después de todo el flujo (perfiles + invitado no la afectaron)')
else bad('integridad de la carpeta real del Principal', JSON.stringify(finalFolders))

await app.close()
fs.rmSync(freshDir, { recursive: true, force: true })

console.log('\n=== RESUMEN (Gestor de favoritos — .app empaquetado real) ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  for (const f of results.fail) console.log(' -', f)
  process.exitCode = 1
}
