// E2E real de Extensiones — UI real (clicks reales sobre el panel), contra la app real (Electron +
// Chromium real). "Cargar sin empaquetar" usa el diálogo nativo del sistema operativo, que no se
// puede accionar desde un test automatizado sin mockearlo — se prueba con el IPC real
// (`importExtension`, el mismo código que corre main.js del lado real, solo sin el diálogo), y el
// resto de flujos (listar, activar/desactivar, quitar, escanear otros navegadores) se prueban
// 100% por UI real.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')
const results = { pass: [], fail: [] }
const ok = (label) => { results.pass.push(label); console.log('PASS -', label) }
const bad = (label, detail) => { results.fail.push(label); console.log('FAIL -', label, detail ? `— ${detail}` : '') }

const storeFile = path.join(process.env.HOME, 'Library', 'Application Support', 'MABRIONA Browser', 'mabriona-browser-data.json')
const extensionsDir = path.join(process.env.HOME, 'Library', 'Application Support', 'MABRIONA Browser', 'extensions')
try {
  const data = JSON.parse(fs.readFileSync(storeFile, 'utf-8'))
  data.lastSession = []
  // Si una corrida anterior de este mismo test se cortó a mitad de camino (antes de llegar al
  // paso de "quitar"), puede haber dejado una extensión de prueba instalada de verdad — se limpia
  // acá para que esta corrida no la vea duplicada.
  data.extensions = (data.extensions || []).filter((e) => e.name !== 'MABRIONA Test Extension')
  fs.writeFileSync(storeFile, JSON.stringify(data, null, 2))
} catch { /* primera corrida */ }
fs.rmSync(extensionsDir, { recursive: true, force: true })

const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [appRoot], env: launchEnv })

async function findChromeWindow() {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().endsWith('/renderer/index.html'))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no apareció la ventana del chrome')
}
const win = await findChromeWindow()
win.on('dialog', (d) => d.accept())
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1200)

// Instalar (vía el mismo IPC real que usa "importar de otro navegador" — sin el diálogo nativo).
const fixturePath = path.join(appRoot, 'test', 'fixtures', 'test-extension')
const importResult = await win.evaluate((p) => window.mabrionaBrowser.importExtension(p), fixturePath)
if (importResult.ok && importResult.record.chromeExtensionId) {
  ok(`instalar una extensión real funciona (Chromium le asignó un ID real: ${importResult.record.chromeExtensionId})`)
} else {
  bad('instalar extensión', JSON.stringify(importResult))
}

// Content script real corre en una página real.
await win.locator('#address').fill('https://example.com')
await win.locator('#address').press('Enter')
await win.waitForTimeout(2000)
const badgeText = await app.evaluate(async ({ BrowserWindow }) => {
  const view = BrowserWindow.getAllWindows()[0].getBrowserViews()[0]
  return view.webContents.executeJavaScript('document.getElementById("mabriona-test-ext-badge")?.textContent || null')
})
if (badgeText === 'EXT-OK') ok('el content script real de la extensión corre de verdad sobre una página real')
else bad('content script real', `esperaba "EXT-OK", encontré ${JSON.stringify(badgeText)}`)

// Panel real: aparece en la lista (Extensiones ahora vive dentro del menú "Más").
await win.locator('#btn-more').click()
await win.waitForTimeout(200)
await win.locator('#more-extensions').click()
await win.waitForTimeout(400)
const listedText = await win.locator('#extensions-list').textContent()
if (listedText.includes('MABRIONA Test Extension')) ok('panel de Extensiones real: la extensión instalada aparece en la lista')
else bad('panel de Extensiones — lista', listedText)

// Desactivar por UI real (checkbox).
await win.locator('#extensions-list .ext-toggle').first().click()
await win.waitForTimeout(500)
const afterDisableText = await win.locator('#extensions-list').textContent()
if (afterDisableText.includes('desactivada')) ok('desactivar una extensión por UI real funciona')
else bad('desactivar extensión', afterDisableText)

// Escanear otros navegadores reales instalados en esta máquina (Chrome/Edge/Brave) — UI real.
await win.locator('#ext-scan-browsers').click()
await win.waitForTimeout(2000)
const scanVisible = await win.locator('#ext-scan-results').isVisible()
const scanCount = await win.locator('#ext-scan-results li').count()
if (scanVisible && scanCount > 0) {
  ok(`escanear otros navegadores por UI real encontró resultados reales (${scanCount})`)
} else if (scanVisible && scanCount === 1) {
  ok('escanear otros navegadores por UI real corrió (sin navegadores Chromium con extensiones en esta máquina)')
} else {
  bad('escanear otros navegadores', `visible=${scanVisible} count=${scanCount}`)
}

// Quitar por UI real (botón ✕ + confirm nativo).
await win.locator('#extensions-list .item-delete').first().click()
await win.waitForTimeout(500)
const afterRemoveText = await win.locator('#extensions-list').textContent()
if (!afterRemoveText.includes('MABRIONA Test Extension')) ok('quitar una extensión por UI real funciona')
else bad('quitar extensión', afterRemoveText)

await app.close()

console.log('\n=== RESUMEN ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  results.fail.forEach((f) => console.log(' -', f))
  process.exitCode = 1
}
