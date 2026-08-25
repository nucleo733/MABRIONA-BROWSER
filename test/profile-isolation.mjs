// Aislamiento real entre perfiles: dos ventanas de dos perfiles distintos, cargando exactamente la
// MISMA página file:// (la new-tab propia de MABRIONA) — si el localStorage de una se filtrara a
// la otra, sería porque comparten partición de Chromium. Se prueba contra la API real de Electron
// (webContents.executeJavaScript), nunca simulado. Si algún día esto no se pudiera garantizar así,
// la instrucción es documentar la limitación en vez de fingir el resultado — pero hoy sí se puede,
// porque son particiones nombradas distintas (ver profiles.js#partitionFor).
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

async function windowIds(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id))
}

async function setValue(app, windowId, key, value) {
  return app.evaluate(async ({ BrowserWindow }, args) => {
    const win = BrowserWindow.fromId(args.windowId)
    const view = win.getBrowserViews()[0]
    return view.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(args.key)}, ${JSON.stringify(args.value)})`)
  }, { windowId, key, value })
}
async function getValue(app, windowId, key) {
  return app.evaluate(async ({ BrowserWindow }, args) => {
    const win = BrowserWindow.fromId(args.windowId)
    const view = win.getBrowserViews()[0]
    return view.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(args.key)})`)
  }, { windowId, key })
}

const app = await electron.launch({ args: [appRoot], env: launchEnv })
const win1 = await findChromeWindow(app)
await win1.waitForTimeout(1200)

const idsBefore = await windowIds(app)
if (idsBefore.length !== 1) { bad('setup', `esperaba 1 ventana al arrancar, encontré ${idsBefore.length}`); await app.close(); process.exit(1) }
const principalWindowId = idsBefore[0]

// Perfil nuevo real, vía el mismo IPC que usa el botón "+ Crear perfil" del panel.
const newProfile = await win1.evaluate(() => window.mabrionaBrowser.createProfile('Aislamiento Test'))
await win1.evaluate((id) => window.mabrionaBrowser.switchToProfile(id), newProfile.id)

let secondaryWindowId = null
for (let i = 0; i < 30; i++) {
  const idsNow = await windowIds(app)
  const diff = idsNow.filter((id) => !idsBefore.includes(id))
  if (diff.length > 0) { secondaryWindowId = diff[0]; break }
  await new Promise((r) => setTimeout(r, 200))
}
if (secondaryWindowId == null) {
  bad('crear perfil abre una ventana real', 'no apareció ninguna ventana nueva')
} else {
  ok('crear perfil real y cambiar a él abre una ventana nueva real')
}

// Dar tiempo a que la segunda ventana termine de cargar su new-tab (mismo file:// que la primera).
await new Promise((r) => setTimeout(r, 1200))

const KEY = 'mabriona-profile-isolation-test'
await setValue(app, principalWindowId, KEY, 'valor-del-principal')
const readBackPrincipal = await getValue(app, principalWindowId, KEY)
if (readBackPrincipal === 'valor-del-principal') ok('localStorage real: se puede escribir y leer en la partición del perfil Principal')
else bad('localStorage — sanity check en Principal', `esperaba "valor-del-principal", encontré ${JSON.stringify(readBackPrincipal)}`)

const leakedIntoSecondary = await getValue(app, secondaryWindowId, KEY)
if (leakedIntoSecondary === null) ok('aislamiento real: el perfil nuevo NO ve el localStorage del Principal (misma página file://, partición distinta)')
else bad('aislamiento — perfil nuevo', `esperaba null, encontré ${JSON.stringify(leakedIntoSecondary)} — filtración real entre perfiles`)

await setValue(app, secondaryWindowId, KEY, 'valor-del-nuevo')
const principalAfterSecondaryWrite = await getValue(app, principalWindowId, KEY)
if (principalAfterSecondaryWrite === 'valor-del-principal') ok('aislamiento real en el otro sentido: escribir en el perfil nuevo no toca el localStorage del Principal')
else bad('aislamiento — vuelta a Principal', `esperaba que siguiera en "valor-del-principal", encontré ${JSON.stringify(principalAfterSecondaryWrite)}`)

// Limpieza real: cerrar la ventana del perfil de prueba y borrar el perfil de verdad (mismo IPC que "✕" en el panel).
await app.evaluate(({ BrowserWindow }, id) => { BrowserWindow.fromId(id)?.close() }, secondaryWindowId)
await new Promise((r) => setTimeout(r, 500))
const deleteResult = await win1.evaluate((id) => window.mabrionaBrowser.deleteProfile(id), newProfile.id)
if (deleteResult.ok) ok('borrar el perfil de prueba funciona de verdad (archivo + partición)')
else bad('borrar perfil de prueba', deleteResult.reason)

const profilesAfterDelete = await win1.evaluate(() => window.mabrionaBrowser.listProfiles())
if (!profilesAfterDelete.some((p) => p.id === newProfile.id)) ok('el perfil borrado ya no aparece en la lista real')
else bad('perfil borrado sigue en la lista', JSON.stringify(profilesAfterDelete))

await app.close()

console.log('\n=== RESUMEN ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  results.fail.forEach((f) => console.log(' -', f))
  process.exitCode = 1
}
