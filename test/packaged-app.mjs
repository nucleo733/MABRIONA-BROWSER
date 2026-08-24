// Verifica la app YA EMPAQUETADA (dist/mac/MABRIONA Browser.app), no el
// código fuente — el smoke test normal lanza `electron .` desde el repo,
// que SIEMPRE tiene todos los archivos disponibles y no detecta un
// `package.json` → `build.files` incompleto (pasó de verdad: se agregó
// `search/` y `search-preload.js` al código pero no a esa lista, y la
// app instalada no abría — "Cannot find module"). Este chequeo corre
// el binario real que se instala en /Applications, para agarrar esa
// clase de bug ANTES de reinstalar en la Mac del usuario.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.join(__dirname, '..')
const appPath = path.join(appRoot, 'dist', 'mac', 'MABRIONA Browser.app')
const binPath = path.join(appPath, 'Contents', 'MacOS', 'MABRIONA Browser')

if (!existsSync(binPath)) {
  console.log('FAIL - no existe', binPath, '— correr "npx electron-builder --mac dir" primero')
  process.exit(1)
}

const child = spawn(binPath, [], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
child.stdout.on('data', (d) => { output += d.toString() })
child.stderr.on('data', (d) => { output += d.toString() })

const crashed = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 4000) // sigue viva 4s real = arrancó bien
  child.on('exit', (code) => {
    clearTimeout(timer)
    resolve(code !== null && code !== 0)
  })
})

if (crashed) {
  console.log('FAIL - la app empaquetada se cerró sola al arrancar. Salida:')
  console.log(output.slice(0, 2000))
  process.exitCode = 1
} else {
  console.log('PASS - la app empaquetada (dist/mac/MABRIONA Browser.app) arrancó y siguió viva')
}

child.kill('SIGKILL')
