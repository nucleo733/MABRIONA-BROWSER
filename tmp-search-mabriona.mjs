import { _electron as electron } from 'playwright'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const appBinary = path.join(process.cwd(), 'dist', 'mac', 'MABRIONA Browser.app', 'Contents', 'MacOS', 'MABRIONA Browser')
const freshDir = path.join(os.tmpdir(), `mabriona-search-mabriona-${Date.now()}`)
fs.mkdirSync(freshDir, { recursive: true })
const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: appBinary, args: [`--user-data-dir=${freshDir}`], env: launchEnv })
const errors = []
async function findChromeWindow() {
  for (let i = 0; i < 50; i++) {
    const page = app.windows().find((p) => p.url().includes('index.html'))
    if (page) return page
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => {})
  }
  throw new Error('no apareció la ventana')
}
const win = await findChromeWindow()
win.on('pageerror', (e) => errors.push(e.message))
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
if (await win.locator('#onboarding-skip-1').count()) await win.locator('#onboarding-skip-1').click()
await win.waitForTimeout(300)

await win.locator('#address').fill('mabriona')
await win.locator('#address').press('Enter')
await win.waitForTimeout(3500)

const info = await app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const view = w.getBrowserViews()[0]
  return view.webContents.executeJavaScript(`({
    url: location.href,
    cardCount: document.querySelectorAll('.card').length,
    bodyText: document.body.innerText.slice(0, 400),
  })`)
})
console.log(JSON.stringify(info, null, 2))
console.log('errores de página:', errors)

await app.close()
fs.rmSync(freshDir, { recursive: true, force: true })
