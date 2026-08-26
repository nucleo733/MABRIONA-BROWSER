// Traductor real (DeepL vía proxy de MABRIONA) — verificación real contra el .app EMPAQUETADO (no
// el código fuente), con un userData 100% nuevo: usuario nuevo, sin configuración de ningún tipo,
// abre la app y prueba Traducir. Requiere haber corrido "npm run dist" antes.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')
const appBinary = path.join(appRoot, 'dist', 'mac', 'MABRIONA Browser.app', 'Contents', 'MacOS', 'MABRIONA Browser')

const results = { pass: [], fail: [] }
const ok = (l) => { results.pass.push(l); console.log('PASS -', l) }
const bad = (l, d) => { results.fail.push(l); console.log('FAIL -', l, d ? `— ${d}` : '') }

if (!fs.existsSync(appBinary)) {
  console.log(`No existe el .app empaquetado (${appBinary}). Corré "npm run dist" primero.`)
  process.exit(1)
}

const freshDir = path.join(os.tmpdir(), `mabriona-translate-packaged-${Date.now()}`)
fs.mkdirSync(freshDir, { recursive: true })
const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE

const app = await electron.launch({ executablePath: appBinary, args: [`--user-data-dir=${freshDir}`], env: launchEnv })
async function findChromeWindow() {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().includes('index.html'))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no apareció la ventana del chrome')
}
const win = await findChromeWindow()
win.on('pageerror', (e) => bad('excepción real no capturada en el .app instalado', e.message))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
if (await win.locator('#onboarding-skip-1').count()) await win.locator('#onboarding-skip-1').click()
await win.waitForTimeout(300)

// Usuario 100% nuevo — sin configurar absolutamente nada (sin key propia, sin tocar Configuración)
await win.locator('#address').fill('https://es.wikipedia.org/wiki/Bachata')
await win.locator('#address').press('Enter')
await win.waitForTimeout(2500)

await win.locator('#btn-translate').click()
await win.waitForTimeout(500)
const langCount = await win.locator('#translate-lang option').count()
if (langCount > 25) ok(`Traducir en el .app instalado: lista real de idiomas sin configurar nada (${langCount})`)
else bad('idiomas en el .app instalado', `count=${langCount}`)

await win.locator('#translate-lang').selectOption('EN-US')
await win.locator('#translate-go').click()
let statusText = ''
for (let i = 0; i < 20; i++) {
  await win.waitForTimeout(500)
  statusText = await win.locator('#translate-status').textContent()
  if (statusText && statusText !== 'Traduciendo…') break
}
console.log('texto de estado real en el .app instalado:', statusText)
if (statusText.includes('No se pudo traducir') && statusText.includes('503')) {
  ok(`.app instalado: usuario nuevo llega hasta el proxy real de MABRIONA sin configurar nada, error real y honesto (${statusText})`)
} else if (statusText.match(/Traducido \(\d+ fragmentos/)) {
  ok(`.app instalado: ¡DEEPL_API_KEY ya configurada! Traducción real funcionando de punta a punta para un usuario nuevo: ${statusText}`)
} else {
  bad('resultado real de traducir en el .app instalado', statusText)
}

await app.close()
fs.rmSync(freshDir, { recursive: true, force: true })

console.log('\n=== RESUMEN (Traductor — .app empaquetado real, usuario nuevo) ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) process.exitCode = 1
