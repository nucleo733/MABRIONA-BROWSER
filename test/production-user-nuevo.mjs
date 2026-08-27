// LA PRUEBA MÁS IMPORTANTE: usuario 100% nuevo, máquina limpia, sin ninguna key local, sin .env,
// sin configuración previa — instala el .app real, busca "Romeo Santos", abre una página y traduce.
// Todo tiene que funcionar solo con la infraestructura server-side real de MABRIONA.
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

// Usuario 100% nuevo: userData vacío, SIN ninguna variable de entorno de key local.
const freshDir = path.join(os.tmpdir(), `mabriona-usuario-nuevo-${Date.now()}`)
fs.mkdirSync(freshDir, { recursive: true })
const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
delete launchEnv.BRAVE_API_KEY
delete launchEnv.DEEPL_API_KEY

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
win.on('pageerror', (e) => bad('excepción real no capturada', e.message))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
if (await win.locator('#onboarding-skip-1').count()) await win.locator('#onboarding-skip-1').click()
await win.waitForTimeout(300)

console.log('--- 1. Buscar "Romeo Santos" (sin configurar nada) ---')
await win.locator('#address').fill('Romeo Santos')
await win.locator('#address').press('Enter')
await win.waitForTimeout(3500)
const searchInfo = await app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const view = w.getBrowserViews()[0]
  return view.webContents.executeJavaScript(`({
    cardCount: document.querySelectorAll('.card').length,
    entityFocus: !!document.querySelector('.entity-focus'),
    bodyText: document.body.innerText.slice(0, 200),
  })`)
})
if (searchInfo.cardCount > 0) ok(`Search real funciona para un usuario nuevo, sin configurar nada (${searchInfo.cardCount} tarjetas, Entity Focus: ${searchInfo.entityFocus})`)
else bad('Search para usuario nuevo', JSON.stringify(searchInfo))

console.log('--- 2. Abrir una página real y Traducir (sin configurar nada) ---')
await win.locator('#address').fill('https://es.wikipedia.org/wiki/Bachata')
await win.locator('#address').press('Enter')
await win.waitForTimeout(2500)
await win.locator('#btn-translate').click()
await win.waitForTimeout(500)
await win.locator('#translate-lang').selectOption('EN-US')
await win.locator('#translate-go').click()
let statusText = ''
for (let i = 0; i < 20; i++) {
  await win.waitForTimeout(500)
  statusText = await win.locator('#translate-status').textContent()
  if (statusText && statusText !== 'Traduciendo…') break
}
console.log('resultado real de Traducir:', statusText)
if (statusText.match(/Traducido \(\d+ fragmentos/)) {
  ok(`Traducir real funciona para un usuario nuevo, sin configurar nada: ${statusText}`)
} else {
  bad('Traducir para usuario nuevo', statusText)
}

await app.close()
fs.rmSync(freshDir, { recursive: true, force: true })

console.log('\n=== RESUMEN (usuario 100% nuevo, .app real, sin configurar nada) ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) process.exitCode = 1
