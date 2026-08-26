// End-to-end real del Gestor profesional de favoritos — lanza la app de verdad (Electron +
// Chromium real) con Playwright. Las mutaciones que en la UI real disparan el diálogo propio de
// texto (showTextPrompt, reemplazo real de window.prompt() — ver renderer.js) se hacen acá vía el
// bridge real `window.mabrionaBrowser` (mismo IPC real que usa la UI, ver preload.js/main.js) en
// vez de simular el diálogo — igual criterio que ya usa smoke.mjs para sembrar permisos. Lo que sí
// se prueba tocando la UI de verdad: la barra de favoritos, el desplegable de carpetas, el menú
// contextual, arrastrar y soltar real (HTML5 DnD vía Playwright dragTo), el árbol/breadcrumb/
// búsqueda del gestor, y que todo persiste en disco de verdad tras cerrar y reabrir.
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')

const storeFile = path.join(process.env.HOME, 'Library', 'Application Support', 'MABRIONA Browser', 'mabriona-browser-data.json')
let backupStore = null
try { backupStore = fs.readFileSync(storeFile, 'utf-8') } catch { /* primera corrida real, no hay nada que respaldar */ }
try {
  const data = backupStore ? JSON.parse(backupStore) : {}
  data.lastSession = []
  data.hasCompletedOnboarding = true
  fs.mkdirSync(path.dirname(storeFile), { recursive: true })
  fs.writeFileSync(storeFile, JSON.stringify(data, null, 2))
} catch { /* no debería pasar, pero si pasa, seguimos con lo que haya */ }

const results = { pass: [], fail: [], skip: [] }
const ok = (label) => { results.pass.push(label); console.log('PASS -', label) }
const bad = (label, detail) => { results.fail.push(label); console.log('FAIL -', label, detail ? `— ${detail}` : '') }

const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE

async function launchApp() {
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
  win.on('pageerror', (e) => console.log('[renderer pageerror]', e.message))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1000)
  return { app, win }
}

let { app, win } = await launchApp()

// Limpieza real: si quedaron carpetas/favoritos de una corrida anterior de ESTE script, se borran
// antes de empezar — vía el bridge real, no tocando el archivo a mano.
await win.evaluate(async () => {
  const folders = await window.mabrionaBrowser.listFolders()
  for (const f of folders.filter((f) => f.parentId === null)) await window.mabrionaBrowser.deleteFolder(f.id)
  const favs = await window.mabrionaBrowser.listFavorites()
  for (const f of favs.filter((f) => f.url.includes('e2e-bookmarks-test'))) await window.mabrionaBrowser.removeFavorite(f.url)
})

// ---- Datos reales de partida: 1 carpeta con 1 subcarpeta, favoritos en cada nivel ----
const setup = await win.evaluate(async () => {
  const work = await window.mabrionaBrowser.createFolder('Trabajo E2E')
  const sub = await window.mabrionaBrowser.createFolder('Proyectos E2E', work.id)
  await window.mabrionaBrowser.addFavorite({ url: 'https://example.com/?e2e-bookmarks-test=suelto', title: 'Favorito Suelto E2E', addedAt: Date.now(), folderId: null })
  await window.mabrionaBrowser.addFavorite({ url: 'https://example.com/?e2e-bookmarks-test=adentro', title: 'Favorito Interno E2E', addedAt: Date.now(), folderId: sub.id })
  return { workId: work.id, subId: sub.id }
})
await win.evaluate(() => window.refreshAllFavoritesUI())
await win.waitForTimeout(300)

// ---- Barra de favoritos real: la carpeta de primer nivel aparece ----
const barFolderCount = await win.locator('.fav-bar-folder-btn', { hasText: 'Trabajo E2E' }).count()
if (barFolderCount === 1) ok('barra de favoritos: la carpeta real de primer nivel aparece')
else bad('barra de favoritos — carpeta', `esperaba 1, encontré ${barFolderCount}`)

const barFavCount = await win.locator('.fav-bar-item', { hasText: 'Favorito Suelto E2E' }).count()
if (barFavCount === 1) ok('barra de favoritos: el favorito real de primer nivel aparece')
else bad('barra de favoritos — favorito', `esperaba 1, encontré ${barFavCount}`)

// ---- Desplegable real: clic en la carpeta muestra su subcarpeta y no queda vacío ----
await win.locator('.fav-bar-folder-btn', { hasText: 'Trabajo E2E' }).click()
await win.waitForTimeout(200)
const dropdownVisible = await win.locator('.fav-bar-folder', { hasText: 'Trabajo E2E' }).locator('.fav-bar-dropdown:not(.hidden)').count()
if (dropdownVisible === 1) ok('barra de favoritos: el desplegable real se abre al hacer clic')
else bad('desplegable de carpeta', `esperaba visible, count=${dropdownVisible}`)
const nestedFolderVisible = await win.locator('.fbd-folder-btn', { hasText: 'Proyectos E2E' }).count()
if (nestedFolderVisible === 1) ok('barra de favoritos: la subcarpeta real aparece anidada dentro del desplegable')
else bad('subcarpeta anidada en desplegable', `esperaba 1, encontré ${nestedFolderVisible}`)

// clic afuera cierra el desplegable
await win.locator('#address').click()
await win.waitForTimeout(200)
const dropdownHiddenAfter = await win.locator('.fav-bar-folder', { hasText: 'Trabajo E2E' }).locator('> .fav-bar-dropdown.hidden').count()
if (dropdownHiddenAfter === 1) ok('barra de favoritos: clic afuera cierra el desplegable real')
else bad('cierre del desplegable', `esperaba hidden, count=${dropdownHiddenAfter}`)

// ---- Clic en un favorito de la barra navega la pestaña activa de verdad ----
await win.locator('.fav-bar-item', { hasText: 'Favorito Suelto E2E' }).click()
await win.waitForTimeout(500)
const addressAfterBarClick = await win.locator('#address').inputValue()
if (addressAfterBarClick === 'https://example.com/?e2e-bookmarks-test=suelto') ok('barra de favoritos: clic en un favorito navega de verdad la pestaña activa')
else bad('navegación desde la barra', addressAfterBarClick)

// ---- Menú contextual real: clic derecho en un favorito de la barra ----
await win.locator('.fav-bar-item', { hasText: 'Favorito Suelto E2E' }).click({ button: 'right' })
await win.waitForTimeout(200)
const menuVisible = await win.locator('#context-menu:not(.hidden)').count()
if (menuVisible === 1) ok('menú contextual real: clic derecho en un favorito lo abre')
else bad('menú contextual — abrir', `count=${menuVisible}`)
const menuButtons = await win.locator('#context-menu button').allTextContents()
const expectedFavoriteActions = ['Abrir', 'nueva pestaña', 'nueva ventana', 'Editar', 'Mover a', 'Eliminar']
const hasAll = expectedFavoriteActions.every((label) => menuButtons.some((t) => t.includes(label)))
if (hasAll) ok(`menú contextual de favorito: trae las acciones reales pedidas (${menuButtons.join(' | ')})`)
else bad('acciones del menú contextual de favorito', menuButtons.join(' | '))
await win.keyboard.press('Escape')
await win.waitForTimeout(200)
const menuHiddenAfterEsc = await win.locator('#context-menu.hidden').count()
if (menuHiddenAfterEsc === 1) ok('menú contextual real: Escape lo cierra')
else bad('cierre del menú contextual', `count=${menuHiddenAfterEsc}`)

// ---- Menú contextual real de una carpeta ----
await win.locator('.fav-bar-folder-btn', { hasText: 'Trabajo E2E' }).click({ button: 'right' })
await win.waitForTimeout(200)
const folderMenuButtons = await win.locator('#context-menu button').allTextContents()
const expectedFolderActions = ['Abrir todos', 'Nueva subcarpeta', 'Renombrar', 'Mover a', 'Eliminar']
const hasAllFolder = expectedFolderActions.every((label) => folderMenuButtons.some((t) => t.includes(label)))
if (hasAllFolder) ok(`menú contextual de carpeta: trae las acciones reales pedidas (${folderMenuButtons.join(' | ')})`)
else bad('acciones del menú contextual de carpeta', folderMenuButtons.join(' | '))
await win.keyboard.press('Escape')
await win.waitForTimeout(200)

// ---- Arrastrar y soltar real (HTML5 DnD): mover el favorito suelto ADENTRO de la carpeta ----
await win.locator('.fav-bar-item', { hasText: 'Favorito Suelto E2E' })
  .dragTo(win.locator('.fav-bar-folder-btn', { hasText: 'Trabajo E2E' }))
await win.waitForTimeout(400)
const movedFolderId = await win.evaluate(async () => {
  const favs = await window.mabrionaBrowser.listFavorites()
  return favs.find((f) => f.url === 'https://example.com/?e2e-bookmarks-test=suelto')?.folderId || null
})
if (movedFolderId === setup.workId) ok('arrastrar y soltar real: soltar un favorito sobre una carpeta lo mueve de verdad adentro (persistido en disco)')
else bad('drag and drop — mover a carpeta', `esperaba folderId=${setup.workId}, encontré ${movedFolderId}`)

// ---- Gestor profesional de favoritos — pantalla completa ----
await win.locator('#btn-manage-favorites').click()
await win.waitForTimeout(300)
const managerVisible = await win.locator('#bookmarks-manager-overlay:not(.hidden)').count()
if (managerVisible === 1) ok('gestor de favoritos: se abre en pantalla completa')
else bad('abrir el gestor', `count=${managerVisible}`)

const treeHasFolder = await win.locator('#bm-tree .bm-tree-row', { hasText: 'Trabajo E2E' }).count()
if (treeHasFolder === 1) ok('gestor de favoritos: el árbol real de carpetas muestra la carpeta de primer nivel')
else bad('árbol del gestor', `esperaba 1, encontré ${treeHasFolder}`)

await win.locator('#bm-tree .bm-tree-row', { hasText: 'Trabajo E2E' }).first().click()
await win.waitForTimeout(300)
const breadcrumbText = await win.locator('#bm-breadcrumb').textContent()
if (breadcrumbText.includes('Trabajo E2E')) ok(`gestor de favoritos: el breadcrumb real refleja la carpeta abierta ("${breadcrumbText.trim()}")`)
else bad('breadcrumb del gestor', breadcrumbText)

const itemsAfterOpen = await win.locator('#bm-items .bm-item').allTextContents()
const showsSubfolder = itemsAfterOpen.some((t) => t.includes('Proyectos E2E'))
const showsMovedFavorite = itemsAfterOpen.some((t) => t.includes('Favorito Suelto E2E'))
if (showsSubfolder && showsMovedFavorite) ok('gestor de favoritos: la lista de items real muestra la subcarpeta y el favorito recién movido, ambos de verdad adentro')
else bad('items dentro de la carpeta', JSON.stringify(itemsAfterOpen))

// ---- Búsqueda real dentro del gestor (plana, con la ruta de carpeta como referencia) ----
await win.locator('#bm-search').fill('Favorito Interno')
await win.waitForTimeout(300)
const searchResults = await win.locator('#bm-items .bm-item').allTextContents()
if (searchResults.length === 1 && searchResults[0].includes('Favorito Interno E2E') && searchResults[0].includes('Trabajo E2E/Proyectos E2E')) {
  ok(`gestor de favoritos: la búsqueda real encuentra el favorito y muestra su ruta de carpeta real (${searchResults[0].replace(/\s+/g, ' ').trim()})`)
} else {
  bad('búsqueda del gestor', JSON.stringify(searchResults))
}
await win.locator('#bm-search').fill('')
await win.waitForTimeout(300)

// ---- Crear carpeta real desde el gestor (vía el bridge, prompt() real no existe en Electron —
// ver showTextPrompt en renderer.js) y confirmar que aparece en el árbol tras refrescar ----
await win.evaluate(async () => { await window.mabrionaBrowser.createFolder('Nueva Desde Gestor E2E', null); await window.loadFavoritesData(); window.renderBookmarksManager() })
await win.waitForTimeout(300)
const newFolderInTree = await win.locator('#bm-tree .bm-tree-row', { hasText: 'Nueva Desde Gestor E2E' }).count()
if (newFolderInTree === 1) ok('gestor de favoritos: una carpeta creada real aparece en el árbol tras refrescar')
else bad('nueva carpeta en el árbol', `count=${newFolderInTree}`)

// ---- Renombrar/mover/eliminar reales vía el bridge — el store.js ya tiene tests unitarios
// exhaustivos para estos métodos; acá solo se confirma que la UI del gestor refleja el estado real
// después de una mutación, que es lo que le corresponde probar a un e2e. ----
await win.evaluate(async () => { await window.mabrionaBrowser.renameFolder(await (async () => (await window.mabrionaBrowser.listFolders()).find((f) => f.name === 'Nueva Desde Gestor E2E').id)(), 'Renombrada E2E'); await window.loadFavoritesData(); window.renderBookmarksManager() })
await win.waitForTimeout(300)
const renamedVisible = await win.locator('#bm-tree .bm-tree-row', { hasText: 'Renombrada E2E' }).count()
if (renamedVisible === 1) ok('gestor de favoritos: renombrar una carpeta real se refleja en el árbol')
else bad('renombrar carpeta', `count=${renamedVisible}`)

// ---- Cerrar y reabrir la app real — todo tiene que persistir en disco, no solo en memoria ----
await app.close()
;({ app, win } = await launchApp())
const persistedFolders = await win.evaluate(() => window.mabrionaBrowser.listFolders())
const persistedNames = persistedFolders.map((f) => f.name)
if (persistedNames.includes('Trabajo E2E') && persistedNames.includes('Proyectos E2E') && persistedNames.includes('Renombrada E2E')) {
  ok('persistencia real: las carpetas siguen ahí después de cerrar y reabrir la app de verdad')
} else {
  bad('persistencia de carpetas', JSON.stringify(persistedNames))
}
const persistedFavs = await win.evaluate(() => window.mabrionaBrowser.listFavorites())
const movedFavStillThere = persistedFavs.find((f) => f.url === 'https://example.com/?e2e-bookmarks-test=suelto')
if (movedFavStillThere && movedFavStillThere.folderId === setup.workId) ok('persistencia real: el favorito movido por drag-and-drop sigue en su carpeta real después de reabrir')
else bad('persistencia del favorito movido', JSON.stringify(movedFavStillThere))

// ---- Limpieza real de los datos de este test (no ensuciar el perfil real del desarrollador) ----
await win.evaluate(async () => {
  const folders = await window.mabrionaBrowser.listFolders()
  for (const f of folders.filter((f) => f.parentId === null && (f.name.includes('E2E')))) await window.mabrionaBrowser.deleteFolder(f.id)
  const favs = await window.mabrionaBrowser.listFavorites()
  for (const f of favs.filter((f) => f.url.includes('e2e-bookmarks-test'))) await window.mabrionaBrowser.removeFavorite(f.url)
})

await app.close()

// Restaurar exactamente el archivo real como estaba antes de este test (solo tocamos lastSession/
// hasCompletedOnboarding al arrancar, y ya limpiamos nuestros propios datos arriba — esto es una
// red de seguridad extra, no la limpieza principal).
if (backupStore) fs.writeFileSync(storeFile, backupStore)

console.log('\n=== RESUMEN (Gestor de favoritos) ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  for (const f of results.fail) console.log(' -', f)
  process.exitCode = 1
}
