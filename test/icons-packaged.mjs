// Verificación real, contra el .app EMPAQUETADO (no el código fuente), de la barra rediseñada:
// pocos íconos, material vidrio con estado "prendido", Compartir (copiar link + QR 100% local) y
// Traducir (DeepL, estado honesto "no configurado" cuando no hay credencial real). Requiere haber
// corrido "npm run dist" antes (dist/mac/MABRIONA Browser.app).
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

const freshDir = path.join(os.tmpdir(), `mabriona-icons-packaged-${Date.now()}`)
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

const toolbarButtonCount = await win.locator('#toolbar button').count()
if (toolbarButtonCount <= 9) ok(`barra con pocos íconos real en el .app instalado (${toolbarButtonCount})`)
else bad('cantidad de íconos', `esperaba pocos, encontré ${toolbarButtonCount}`)

const svgCount = await win.locator('#toolbar svg').count()
// #profile-emoji es el emoji REAL que la persona eligió para identificar su propio perfil — dato
// real, no un ícono decorativo genérico — se excluye a propósito de este chequeo.
const emojiInToolbar = await win.locator('#toolbar').evaluate((el) => {
  const clone = el.cloneNode(true)
  clone.querySelector('#profile-emoji')?.remove()
  return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(clone.textContent)
})
if (svgCount >= 7 && !emojiInToolbar) ok(`íconos reales SVG en la barra, sin emoji genérico (${svgCount} svg)`)
else bad('íconos SVG sin emoji', `svg=${svgCount} emojiDetectado=${emojiInToolbar}`)

await win.locator('#address').fill('https://example.com/')
await win.locator('#address').press('Enter')
await win.waitForTimeout(2000)

// Compartir real: copiar + QR 100% local
await win.locator('#btn-share').click()
await win.waitForTimeout(500)
const qrNatural = await win.locator('#share-qr-img').evaluate((img) => img.naturalWidth).catch(() => 0)
if (qrNatural > 0) ok(`Compartir real en el .app instalado: el código QR se genera y se ve de verdad (${qrNatural}px)`)
else bad('QR en el .app instalado', 'no cargó')
await win.locator('#share-copy').click({ timeout: 5000 }).then(() => ok('Compartir real: "Copiar link" es clickeable y responde')).catch((e) => bad('clic en Copiar link', e.message.split('\n')[0]))
await win.waitForTimeout(300)
const copiedText = await win.locator('#share-copy').textContent()
if (copiedText.includes('Copiado')) ok('Compartir real: confirma visualmente que copió')
else bad('confirmación de copiado', copiedText)
await win.locator('[data-close="share"]').click()
await win.waitForTimeout(200)
const shareStillActive = await win.locator('#btn-share.active').count()
if (shareStillActive === 0) ok('el ícono de Compartir se apaga de verdad al cerrar el panel')
else bad('ícono de Compartir tras cerrar', 'sigue "prendido"')

// Traducir real: abre el panel sin errores (la cadena real completa — idiomas, proxy, error
// honesto — tiene su propio test dedicado en test/translate-packaged.mjs).
await win.locator('#btn-translate').click()
await win.waitForTimeout(500)
if ((await win.locator('#panel-translate:not(.hidden)').count()) === 1) ok('Traducir real: el panel abre sin errores en el .app instalado')
else bad('panel de traducir en el .app instalado', 'no abrió')
await win.locator('[data-close="translate"]').click()

// Menú "Más" real: todo lo que se sacó de la barra sigue accesible ahí
await win.locator('#btn-more').click()
await win.waitForTimeout(300)
const moreTexts = await win.locator('#panel-more button').allTextContents()
const expected = ['Capturar pantalla', 'Historial', 'Descargas', 'Favoritos', 'SHIELDS', 'Extensiones', 'Configuración', 'Nueva ventana', 'Nueva pestaña privada']
const missing = expected.filter((label) => !moreTexts.some((t) => t.includes(label)))
if (missing.length === 0) ok('el menú "Más" real trae todas las funciones que se sacaron de la barra')
else bad('funciones faltantes en "Más"', JSON.stringify(missing))
await win.locator('[data-close="more"]').click()

await app.close()
fs.rmSync(freshDir, { recursive: true, force: true })

console.log('\n=== RESUMEN (Íconos rediseñados — .app empaquetado real) ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  for (const f of results.fail) console.log(' -', f)
  process.exitCode = 1
}
