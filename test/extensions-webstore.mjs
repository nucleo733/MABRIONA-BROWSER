// Instalación real desde la Chrome Web Store — descarga de verdad el .crx público de una
// extensión real y conocida (uBlock Origin) desde la infraestructura real de Google, lo
// desempaqueta, y confirma que Chromium le asigna un ID real. Test aparte (no en smoke.mjs)
// porque depende de red externa real, no solo de la app.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')
const results = { pass: [], fail: [] }
const ok = (label) => { results.pass.push(label); console.log('PASS -', label) }
const bad = (label, detail) => { results.fail.push(label); console.log('FAIL -', label, detail ? `— ${detail}` : '') }

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
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1000)

// uBlock Origin — extensión real, pública, popular; buen caso real para probar el pipeline
// completo (descarga real + desempaquetado real de un .crx más grande y complejo que un fixture).
const UBLOCK_ID = 'cjpalhdlnbpafiamejdnhcphjbkeiagm'
const result = await win.evaluate((id) => window.mabrionaBrowser.installExtensionFromWebStore(id), UBLOCK_ID)
if (result.ok && result.record.name && result.record.chromeExtensionId) {
  ok(`instalar por ID real de la Chrome Web Store funciona (${result.record.name} v${result.record.version}, ID real de Chromium: ${result.record.chromeExtensionId})`)
} else {
  bad('instalar desde la Chrome Web Store', JSON.stringify(result))
}

// También probar con un link real completo, no solo el ID puro.
const linkResult = await win.evaluate((id) => window.mabrionaBrowser.installExtensionFromWebStore(`https://chromewebstore.google.com/detail/foo/${id}`), UBLOCK_ID)
if (linkResult.ok) ok('instalar pegando un link real completo de la tienda (no solo el ID) también funciona')
else bad('instalar desde un link real', JSON.stringify(linkResult))

// Limpieza real.
if (result.ok) await win.evaluate((recordId) => window.mabrionaBrowser.removeExtension(recordId), result.record.recordId)
if (linkResult.ok) await win.evaluate((recordId) => window.mabrionaBrowser.removeExtension(recordId), linkResult.record.recordId)
const listAfter = await win.evaluate(() => window.mabrionaBrowser.listExtensions())
if (listAfter.length === 0) ok('limpieza real: no queda ninguna extensión de prueba instalada')
else bad('limpieza', JSON.stringify(listAfter))

await app.close()

console.log('\n=== RESUMEN ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  results.fail.forEach((f) => console.log(' -', f))
  process.exitCode = 1
}
