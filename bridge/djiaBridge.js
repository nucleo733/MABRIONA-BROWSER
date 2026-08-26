'use strict'

/**
 * MABRIONA Browser Integration — puente real con MABRIONA DJ AI
 * (Fase de integración oficial, `docs/INTEGRACION-DJ-AI.md`). Decisión
 * de producto: MABRIONA Browser es el navegador oficial del
 * ecosistema — DJ AI busca/selecciona videos de YouTube DENTRO de una
 * pestaña real de este navegador (nunca dentro de un `<webview>`
 * paralelo, nunca con Brave/Chrome/Firefox instalados).
 *
 * Protocolo real, mínimo, sin dependencias nuevas (solo `node:http`):
 *   POST /pick  { token, query }  → 202 { requestId }
 *     Abre/cambia a una pestaña REAL de este navegador, navegada a un
 *     resultado de búsqueda real de YouTube. El usuario navega/elige
 *     con total libertad (nunca se scrapea la búsqueda por fuera de
 *     la pestaña real) — al abrir un video, aparece un botón real
 *     "Usar en DJ AI"; al tocarlo, se extrae metadata REAL de la
 *     página (nunca inventada) desde `ytInitialPlayerResponse` (el
 *     mismo objeto que ya carga YouTube) o, si no está disponible,
 *     desde el DOM/elemento `<video>` real.
 *   GET  /result?requestId=&token=  → { status: 'pending' } |
 *     { status: 'done', video: {...} } | { status: 'error', message }
 *
 * Solo escucha en 127.0.0.1 (nunca 0.0.0.0) — inalcanzable desde la
 * red. Todo pedido exige el `token` real generado al arrancar
 * (guardado junto al puerto en `djia-bridge.json`, en la carpeta real
 * de datos de la app — el mismo mecanismo que ya usa el resto de
 * MABRIONA Browser para su propio estado). Un cliente que no puede
 * leer ese archivo (porque no es DJ AI corriendo en esta misma
 * máquina, con acceso al disco de este usuario) no tiene forma de
 * adivinar el token.
 */

const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const BRIDGE_FILE_NAME = 'djia-bridge.json'
const POLL_INTERVAL_MS = 900
// El usuario elige el video a su propio ritmo real (puede tardar
// minutos navegando) — el timeout es una red de seguridad real contra
// una pestaña abandonada, no un límite de UX.
const PICK_TIMEOUT_MS = 15 * 60 * 1000

function isYoutubeWatchUrl(url) {
  return /^https:\/\/(www\.)?youtube\.com\/watch\?/.test(url || '')
}

/** Inyectado una vez por navegación real a un video — botón real, nunca oculto/automático (el usuario decide, un clic real). */
function buildButtonInjectScript() {
  return `(function(){
    if (document.getElementById('__mabriona_djia_pick_btn')) return;
    function extractVideoInfo() {
      try {
        var pr = window.ytInitialPlayerResponse;
        if (pr && pr.videoDetails) {
          var vd = pr.videoDetails;
          var thumbs = (vd.thumbnail && vd.thumbnail.thumbnails) || [];
          var best = thumbs[thumbs.length - 1];
          return {
            id: vd.videoId,
            title: vd.title,
            channel: vd.author,
            thumbnail: best ? best.url : ('https://i.ytimg.com/vi/' + vd.videoId + '/hqdefault.jpg'),
            durationSec: vd.lengthSeconds ? Number(vd.lengthSeconds) : null,
          };
        }
      } catch (e) {}
      var idMatch = location.href.match(/[?&]v=([\\w-]{11})/);
      if (!idMatch) return null;
      var titleMeta = document.querySelector('meta[name="title"]');
      var video = document.querySelector('video');
      return {
        id: idMatch[1],
        title: titleMeta ? titleMeta.content : document.title.replace(/ - YouTube$/, ''),
        channel: undefined,
        thumbnail: 'https://i.ytimg.com/vi/' + idMatch[1] + '/hqdefault.jpg',
        durationSec: video && isFinite(video.duration) ? Math.round(video.duration) : null,
      };
    }
    var btn = document.createElement('button');
    btn.id = '__mabriona_djia_pick_btn';
    btn.type = 'button';
    btn.textContent = 'Usar en DJ AI';
    btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#d4ff00;color:#000;font-weight:700;font-size:14px;padding:12px 20px;border-radius:999px;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4);font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    btn.onclick = function () {
      var info = extractVideoInfo();
      if (info && info.id) { window.__mabrionaPicked = info; btn.textContent = '✓ Enviado a DJ AI'; btn.disabled = true; btn.style.opacity = '0.6'; }
    };
    document.body.appendChild(btn);
  })();`
}

/** Poll real, no push — sin dependencias nuevas (nada de WebSocket). Lee y limpia la bandera en el mismo paso, nunca la reporta dos veces. */
function buildPollScript() {
  return `(function(){ var v = window.__mabrionaPicked; window.__mabrionaPicked = null; return v || null; })();`
}

/**
 * @param {object} deps
 * @param {string} deps.userDataPath - carpeta real de datos de MABRIONA Browser (`app.getPath('userData')`)
 * @param {(url: string, windowId: number) => number} deps.createAndSwitchTab
 * @param {(id: number) => any} deps.getTab - `tabs.get(id)` real
 * @param {() => number} deps.getOrCreateTargetWindowId
 */
function startDjiaBridge({ userDataPath, createAndSwitchTab, getTab, getOrCreateTargetWindowId }) {
  const token = crypto.randomBytes(24).toString('hex')
  /** @type {Map<string, { tabId: number, done: boolean, video: any, error: string|null, pollTimer: any, timeoutTimer: any, injectedNav: () => void, wc: any }>} */
  const pending = new Map()

  function finish(requestId, video, error) {
    const entry = pending.get(requestId)
    if (!entry || entry.done) return
    entry.done = true
    clearInterval(entry.pollTimer)
    clearTimeout(entry.timeoutTimer)
    if (entry.wc && !entry.wc.isDestroyed() && entry.injectedNav) {
      entry.wc.removeListener('did-finish-load', entry.injectedNav)
      entry.wc.removeListener('did-navigate-in-page', entry.injectedNav)
    }
    entry.video = video
    entry.error = error
  }

  function beginPolling(requestId, tabId) {
    const entry = pending.get(requestId)
    const tab = getTab(tabId)
    if (!tab || !entry) return
    const wc = tab.view.webContents
    entry.wc = wc
    const inject = () => {
      if (wc.isDestroyed() || !isYoutubeWatchUrl(wc.getURL())) return
      wc.executeJavaScript(buildButtonInjectScript(), true).catch(() => {})
    }
    // YouTube es una SPA real — pasar de un video a otro (o de resultados a un
    // video) muchas veces no dispara `did-finish-load`, solo `did-navigate-in-page`.
    wc.on('did-finish-load', inject)
    wc.on('did-navigate-in-page', inject)
    entry.injectedNav = inject
    inject()
    entry.pollTimer = setInterval(() => {
      const t = getTab(tabId)
      if (!t || t.view.webContents.isDestroyed()) {
        finish(requestId, null, 'MABRIONA_BROWSER_TAB_CLOSED')
        return
      }
      t.view.webContents
        .executeJavaScript(buildPollScript(), true)
        .then((video) => {
          if (video && video.id) finish(requestId, video, null)
        })
        .catch(() => {})
    }, POLL_INTERVAL_MS)
    entry.timeoutTimer = setTimeout(() => finish(requestId, null, 'MABRIONA_BROWSER_PICK_TIMEOUT'), PICK_TIMEOUT_MS)
  }

  function json(res, status, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
  }

  function readJsonBody(body) {
    try {
      return body ? JSON.parse(body) : {}
    } catch {
      return {}
    }
  }

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      // Cuerpo real esperado: unos pocos bytes (query de búsqueda). Cortar cualquier intento de
      // mandar un payload gigante — nunca hace falta acá.
      if (body.length > 8192) req.destroy()
    })
    req.on('end', () => {
      try {
        handleRequest(req, res, body)
      } catch (err) {
        json(res, 500, { error: 'INTERNAL_ERROR', message: String(err && err.message) })
      }
    })
  })

  function handleRequest(req, res, body) {
    let url
    try {
      url = new URL(req.url, 'http://127.0.0.1')
    } catch {
      return json(res, 400, { error: 'BAD_URL' })
    }

    if (req.method === 'POST' && url.pathname === '/pick') {
      const payload = readJsonBody(body)
      if (payload.token !== token) return json(res, 401, { error: 'UNAUTHORIZED' })
      const query = typeof payload.query === 'string' ? payload.query.trim() : ''
      if (!query) return json(res, 400, { error: 'MISSING_QUERY' })
      const requestId = crypto.randomUUID()
      const searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)
      const windowId = getOrCreateTargetWindowId()
      const tabId = createAndSwitchTab(searchUrl, windowId)
      pending.set(requestId, { tabId, done: false, video: null, error: null, pollTimer: null, timeoutTimer: null, injectedNav: null, wc: null })
      beginPolling(requestId, tabId)
      return json(res, 202, { requestId })
    }

    if (req.method === 'GET' && url.pathname === '/result') {
      if (url.searchParams.get('token') !== token) return json(res, 401, { error: 'UNAUTHORIZED' })
      const requestId = url.searchParams.get('requestId') || ''
      const entry = pending.get(requestId)
      if (!entry) return json(res, 404, { error: 'NOT_FOUND' })
      if (!entry.done) return json(res, 200, { status: 'pending' })
      pending.delete(requestId)
      if (entry.error) return json(res, 200, { status: 'error', message: entry.error })
      return json(res, 200, { status: 'done', video: entry.video })
    }

    return json(res, 404, { error: 'NOT_FOUND' })
  }

  const bridgeFilePath = path.join(userDataPath, BRIDGE_FILE_NAME)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    fs.writeFileSync(bridgeFilePath, JSON.stringify({ port, token, pid: process.pid }), 'utf-8')
  })

  return {
    close() {
      for (const requestId of Array.from(pending.keys())) finish(requestId, null, 'MABRIONA_BROWSER_CLOSED')
      try {
        fs.unlinkSync(bridgeFilePath)
      } catch {
        /* ya no existía, nada que limpiar */
      }
      server.close()
    },
  }
}

/**
 * Camino real para MABRIONA DJ AI **web** (sin app de escritorio,
 * `docs/INTEGRACION-DJ-AI.md`, sección "Web"): la página web no puede
 * hablar HTTP directo con este proceso (CORS/seguridad de navegador),
 * así que el handoff real es vía protocolo registrado
 * (`mabriona-browser://pick?q=...&back=...`) y el resultado vuelve por
 * `shell.openExternal(back + '?ytpick=...')`, al navegador normal del
 * usuario — no hay servidor HTTP de por medio en este camino.
 */
function pickAndOpenExternalCallback({ query, backUrl, createAndSwitchTab, getTab, getOrCreateTargetWindowId, shellOpenExternal }) {
  const windowId = getOrCreateTargetWindowId()
  const searchUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)
  const tabId = createAndSwitchTab(searchUrl, windowId)
  const tab = getTab(tabId)
  if (!tab) return
  const wc = tab.view.webContents
  const inject = () => {
    if (wc.isDestroyed() || !isYoutubeWatchUrl(wc.getURL())) return
    wc.executeJavaScript(buildButtonInjectScript(), true).catch(() => {})
  }
  wc.on('did-finish-load', inject)
  wc.on('did-navigate-in-page', inject)
  inject()
  const poll = setInterval(() => {
    if (wc.isDestroyed()) {
      clearInterval(poll)
      return
    }
    wc.executeJavaScript(buildPollScript(), true)
      .then((video) => {
        if (!video || !video.id) return
        clearInterval(poll)
        const payload = Buffer.from(JSON.stringify(video), 'utf-8').toString('base64')
        shellOpenExternal(`${backUrl}?ytpick=${encodeURIComponent(payload)}`)
      })
      .catch(() => {})
  }, POLL_INTERVAL_MS)
}

module.exports = { startDjiaBridge, pickAndOpenExternalCallback, BRIDGE_FILE_NAME, isYoutubeWatchUrl, buildButtonInjectScript, buildPollScript }
