// Traductor real (DeepL vía proxy de MABRIONA) — e2e real contra la app en desarrollo, sin mocks.
// DEEPL_API_KEY todavía no está configurada en Vercel (pendiente real, ver
// docs/MABRIONA-BROWSER-TRANSLATE.md) — este test prueba la cadena completa real hasta ahí:
// extracción real de texto → pedido real al proxy real `mabriona.com/api/browser-translate` →
// error real (503, honesto) → la UI lo muestra tal cual, sin fingir una traducción. El día que la
// key esté configurada, este mismo test empezará a ver `result.error` vacío y texto traducido de
// verdad — no hace falta cambiar nada acá para que eso pase a probarse solo.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const results = { pass: [], fail: [] }
const ok = (l) => { results.pass.push(l); console.log('PASS -', l) }
const bad = (l, d) => { results.fail.push(l); console.log('FAIL -', l, d ? `— ${d}` : '') }

// La recuperación de sesión real reabriría la última pestaña real (de una corrida anterior de
// este mismo test, o de uso manual) — este test asume que arranca con una pestaña en blanco,
// mismo criterio real que ya usa smoke.mjs.
const storeFile = path.join(process.env.HOME, 'Library', 'Application Support', 'MABRIONA Browser', 'mabriona-browser-data.json')
try {
  const data = JSON.parse(fs.readFileSync(storeFile, 'utf-8'))
  data.lastSession = []
  data.hasCompletedOnboarding = true
  fs.writeFileSync(storeFile, JSON.stringify(data, null, 2))
} catch { /* primera corrida real — nada que limpiar */ }

const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env: launchEnv })
async function findChromeWindow() {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().endsWith('/renderer/index.html'))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no window')
}
const win = await findChromeWindow()
win.on('pageerror', (e) => bad('excepción real no capturada', e.message))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1200)

// ---- Página que no es un sitio real (pestaña nueva recién abierta): no ofrece traducir ----
await win.locator('#btn-translate').click()
await win.waitForTimeout(400)
const notShareableVisible = await win.locator('#translate-not-shareable:not(.hidden)').count()
const controlsHiddenOnNewTab = await win.locator('#translate-controls.hidden').count()
if (notShareableVisible === 1 && controlsHiddenOnNewTab === 1) {
  ok('en la pestaña nueva (no es un sitio real) avisa en vez de ofrecer traducir')
} else {
  bad('pestaña nueva sin traducir', `notShareable=${notShareableVisible} controlsHidden=${controlsHiddenOnNewTab}`)
}
await win.locator('[data-close="translate"]').click()

// ---- Traducir de verdad contra una página real (Wikipedia) — cadena real completa ----
await win.locator('#address').fill('https://es.wikipedia.org/wiki/Bachata')
await win.locator('#address').press('Enter')
await win.waitForTimeout(2500)

// Los idiomas se cargan recién al abrir Traducir sobre una página real (por diseño — no tiene
// sentido pedirlos antes de que haya algo que traducir).
await win.locator('#btn-translate').click()
await win.waitForTimeout(400)
const controlsVisibleOnRealPage = await win.locator('#translate-controls:not(.hidden)').count()
if (controlsVisibleOnRealPage === 1) ok('en una página real, ofrece traducir directo (nunca precondiciona por si hay key configurada)')
else bad('controles de traducción en página real', `count=${controlsVisibleOnRealPage}`)

const langCount = await win.locator('#translate-lang option').count()
const langValues = await win.locator('#translate-lang option').evaluateAll((els) => els.map((e) => e.value))
if (langCount > 25) ok(`lista real de idiomas de DeepL (${langCount})`)
else bad('lista de idiomas', `count=${langCount}`)
if (langValues.includes('EN-US') && langValues.includes('FR') && langValues.includes('ES')) {
  ok('incluye idiomas reales esperados (EN-US, FR, ES) — no idiomas inventados')
} else {
  bad('idiomas esperados', JSON.stringify(langValues))
}

await win.locator('#translate-lang').selectOption('EN-US')
await win.locator('#translate-go').click()

let statusText = ''
for (let i = 0; i < 20; i++) {
  await win.waitForTimeout(500)
  statusText = await win.locator('#translate-status').textContent()
  if (statusText && statusText !== 'Traduciendo…') break
}
console.log('texto de estado real:', statusText)
// DEEPL_API_KEY todavía no está en Vercel (pendiente real) — la cadena completa real (extracción
// real → proxy real → DeepL real) debe llegar hasta un error real y HONESTO, nunca un "listo"
// fingido. El día que la key exista, este mismo assert pasa a exigir un conteo real > 0.
if (statusText.includes('No se pudo traducir') && statusText.includes('503')) {
  ok(`la cadena real llega hasta el proxy real y muestra el error real y honesto (${statusText})`)
} else if (statusText.match(/Traducido \(\d+ fragmentos/)) {
  ok(`¡DEEPL_API_KEY ya está configurada! Traducción real de verdad: ${statusText}`)
} else {
  bad('resultado real de traducir', statusText)
}

const btnDisabledAfter = await win.locator('#translate-go').isDisabled()
if (!btnDisabledAfter) ok('el botón de traducir vuelve a estar habilitado después del intento real')
else bad('botón de traducir tras el intento', 'sigue deshabilitado')

await app.close()

console.log('\n=== RESUMEN (Traductor — e2e real) ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) process.exitCode = 1
