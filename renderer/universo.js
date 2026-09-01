'use strict'
// MABRIOON Universo — chrome real de MABRIONA Browser. Reemplaza la barra de pestañas y la
// barra de direcciones por un sistema solar interactivo. Los 8 planetas fijos son paneles de
// datos reales (mismas llamadas IPC que antes usaban los paneles clásicos de renderer.js); el
// Sol y cualquier planeta-página son pestañas reales (BrowserView de Chromium, no una maqueta).
// Puerto a JS vanilla del diseño aprobado en Mabrioon Universo CONGELADO.dc.html — misma física
// de órbitas, mismo lenguaje visual, datos reales en vez de los de ejemplo del boceto.
;(() => {
  const api = window.mabrionaBrowser
  const stage = document.getElementById('stage')

  // ---------------------------------------------------------------------------------------
  // Constantes de diseño / física (valores tomados 1:1 del boceto congelado)
  // ---------------------------------------------------------------------------------------
  const HUES = {
    llaves: '#9a9088', aterrizajes: '#e0c07a', vuelo: '#3b7fd4', estela: '#c1583a',
    constelacion: '#c9a37a', gravedad: '#d8c08a', eclipse: '#8fd8dd', tripulacion: '#3b5bc4',
  }
  const PSIZE = {
    llaves: 0.042, aterrizajes: 0.095, vuelo: 0.101, estela: 0.056,
    constelacion: 0.2, gravedad: 0.172, eclipse: 0.116, tripulacion: 0.112,
  }
  const YEAR = { llaves: 0.241, aterrizajes: 0.615, vuelo: 1, estela: 1.881, constelacion: 11.86, gravedad: 29.46, eclipse: 84.01, tripulacion: 164.8 }
  const DAY = { llaves: 58.6, aterrizajes: -243, vuelo: 1, estela: 1.03, constelacion: 0.41, gravedad: 0.45, eclipse: -0.72, tripulacion: 0.67 }
  // Sin lunas orbitando los planetas — a pedido explícito, solo quedan los planetas (2026-09-01).
  const MOONS = {}
  // Cada planeta con su propia superficie (2026-09-01) — antes todos compartían el mismo
  // patrón de rayas genérico. Opacidad baja a propósito: es textura, no debe competir con
  // el nombre/meta ni con el brillo del disco.
  const SURFACE_STYLE = {
    llaves: 'opacity:.28;background:radial-gradient(38% 38% at 22% 30%,rgba(0,0,0,.4),transparent 60%),radial-gradient(26% 26% at 68% 62%,rgba(0,0,0,.32),transparent 60%),radial-gradient(18% 18% at 78% 22%,rgba(0,0,0,.28),transparent 60%)',
    aterrizajes: 'opacity:.24;background:repeating-linear-gradient(18deg,transparent 0 9%,rgba(255,255,255,.14) 9% 13%,transparent 13% 22%)',
    estela: 'opacity:.26;background:radial-gradient(30% 22% at 30% 70%,rgba(0,0,0,.3),transparent 60%),radial-gradient(20% 30% at 70% 30%,rgba(0,0,0,.24),transparent 60%)',
    constelacion: 'opacity:.24;background:repeating-linear-gradient(0deg,transparent 0 10%,rgba(255,255,255,.14) 10% 16%,transparent 16% 26%)',
    gravedad: 'opacity:.22;background:repeating-linear-gradient(0deg,transparent 0 14%,rgba(255,255,255,.12) 14% 19%,transparent 19% 32%)',
    eclipse: 'opacity:.18;background:repeating-linear-gradient(88deg,transparent 0 16%,rgba(255,255,255,.1) 16% 20%,transparent 20% 36%)',
    tripulacion: 'opacity:.26;background:radial-gradient(34% 26% at 40% 44%,rgba(0,0,0,.32),transparent 62%)',
    _default: 'opacity:.22;background:repeating-linear-gradient(92deg,transparent 0 7%,rgba(255,255,255,.16) 7% 10%,transparent 10% 20%)',
  }
  const EARTH_YEAR_MS = 90000, EARTH_DAY_MS = 7000
  const PAGE_HUES = ['#00f8f8', '#28d0f8', '#2880f8', '#6a6cf5', '#a850f8', '#c46cff']
  const EXT_HUE = '#a850f8'

  const SYSTEM_DEFS = [
    { id: 'llaves', name: 'LLAVES', meta: 'mercurio', kicker: 'LO QUE TE ABRE PUERTAS', title: 'Llaves', desc: 'Contraseñas y accesos, cifrados en tu propio equipo. Ningún mundo las ve completas.' },
    { id: 'aterrizajes', name: 'ATERRIZAJES', meta: 'venus', kicker: 'LO QUE TOCÓ TIERRA', title: 'Aterrizajes', desc: 'Archivos en camino o ya descargados, cada uno con su estado real.' },
    { id: 'vuelo', name: 'VUELO', meta: 'tierra', kicker: 'MUNDOS EN VUELO', title: 'En vuelo', desc: 'Las páginas que tenés abiertas ahora, sus grupos y las que cerraste hace poco.', earth: true },
    { id: 'estela', name: 'ESTELA', meta: 'marte', kicker: 'POR DÓNDE VOLASTE', title: 'Estela', desc: 'Tu recorrido real, ordenado por tiempo.' },
    { id: 'constelacion', name: 'CONSTELACIÓN', meta: 'júpiter', kicker: 'LO QUE FIJASTE EN EL CIELO', title: 'Constelación', desc: 'Lo que decidiste conservar.' },
    { id: 'gravedad', name: 'GRAVEDAD', meta: 'saturno', kicker: 'LAS LEYES DEL SISTEMA', title: 'Gravedad', desc: 'Buscador por defecto, permisos por sitio y MABRIONA SHIELDS.' },
    { id: 'eclipse', name: 'ECLIPSE', meta: 'urano', kicker: 'VUELO A OSCURAS', title: 'Eclipse', desc: 'Un sistema en sombra que se apaga al cerrarlo: nada de historial ni cookies queda escrito.' },
    { id: 'tripulacion', name: 'TRIPULACIÓN', meta: 'neptuno', kicker: 'QUIÉN VUELA', title: 'Tripulación', desc: 'Cada quien vuela su propio sistema: sus mundos y su historia, sin mezclarse.' },
  ]

  // ---------------------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------------------
  const state = {
    bodies: [],                 // sol + 8 fijos + planetas-página + extensiones lanzadas
    byId: new Map(),            // id -> body (identidad estable entre refrescos de datos)
    tabsById: new Map(),        // id de pestaña real -> último tabState recibido
    groups: [],
    recentlyClosed: [],
    extensions: [],             // último listExtensions() real
    launchedExtIds: new Set(),  // extensiones "lanzadas" a orbitar (solo memoria de sesión)
    landed: null,                // null | 'llaves'... | 'vault' | tabId (number)
    allOpen: false,
    dragging: null,
    downPt: null,
    flight: 0,                   // 0 inactivo, 1 arranca, 2 en vuelo
    lastFrame: 0,
    raf: null,
  }

  // ---------------------------------------------------------------------------------------
  // DOM estático
  // ---------------------------------------------------------------------------------------
  function el(tag, style, parent) {
    const e = document.createElement('div')
    if (style) e.style.cssText = style
    if (parent) parent.appendChild(e)
    return e
  }

  const skyEl = el('div', 'position:absolute;inset:0;pointer-events:none;transition:background 1s ease', stage)
  const starsEl = el('div', 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(1px 1px at 9% 18%,rgba(255,255,255,.55),transparent),radial-gradient(1px 1px at 74% 11%,rgba(255,255,255,.4),transparent),radial-gradient(1px 1px at 31% 81%,rgba(255,255,255,.45),transparent),radial-gradient(1px 1px at 91% 62%,rgba(255,255,255,.32),transparent),radial-gradient(1px 1px at 54% 39%,rgba(255,255,255,.28),transparent),radial-gradient(1px 1px at 22% 52%,rgba(255,255,255,.22),transparent),radial-gradient(1px 1px at 66% 88%,rgba(255,255,255,.3),transparent)', stage)
  const orbitsEl = el('div', 'position:absolute;inset:0;pointer-events:none', stage)
  const beltEl = el('div', 'position:absolute;pointer-events:none;border-radius:50%;box-shadow:inset 0 0 26px rgba(120,170,255,.06)', stage)
  const glowEl = el('div', 'position:absolute;pointer-events:none;border-radius:50%;background:radial-gradient(circle,rgba(40,150,248,.3),transparent 70%);filter:blur(38px);animation:u-breathe 9s ease-in-out infinite', stage)
  const coreSwirlEl = el('div', 'position:absolute;pointer-events:none', stage)
  el('div', 'position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.9) 0%,rgba(40,208,248,.55) 22%,rgba(168,80,248,.25) 48%,transparent 72%);filter:blur(6px)', coreSwirlEl)
  const tethersEl = el('div', 'position:absolute;inset:0;pointer-events:none', stage)
  const meteorsEl = el('div', 'position:absolute;inset:0;pointer-events:none', stage)
  const bodiesEl = el('div', 'position:absolute;inset:0', stage)
  const moonEl = el('div', 'position:absolute;cursor:pointer;z-index:25;border-radius:50%', stage)
  const moonFace = el('div', 'position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 42% 38%,#ffffff 0%,#f3f7ff 42%,#dce6ff 74%,#b9c9f2 100%);box-shadow:0 0 26px rgba(235,242,255,.85),0 0 70px rgba(190,215,255,.5),0 0 130px rgba(150,190,255,.28)', moonEl)
  const moonLabel = el('div', 'position:absolute;left:50%;top:calc(100% + 9px);transform:translateX(-50%);font-size:9px;letter-spacing:.2em;color:rgba(255,255,255,.55);white-space:nowrap', moonEl)
  moonLabel.textContent = 'LUNA'

  // Encabezado — decorativo y sin interacción mientras el Universo está a la vista (solo el
  // isotipo, como en el boceto); se convierte en la barra de dirección real + "VOLVER AL SISTEMA"
  // solo mientras hay una página real aterrizada a pantalla completa (ver `updateHeaderMode`).
  const headerEl = el('div', 'position:absolute;left:0;right:0;top:0;height:86px;z-index:60;display:flex;align-items:center;gap:24px;padding:0 30px;pointer-events:none;box-sizing:border-box;transition:border-color .3s ease', stage)
  const headerLogo = el('div', 'width:34px;height:34px;flex:0 0 auto;background:url(mabrioon-mark-t.png) center/contain no-repeat;filter:drop-shadow(0 0 22px rgba(40,150,248,.6))', headerEl)
  const headerWord = el('div', "font-family:'Syncopate',sans-serif;font-weight:700;font-size:14px;letter-spacing:.2em;flex:0 0 auto;white-space:nowrap;background:linear-gradient(96deg,#ffffff 4%,#28d0f8 46%,#a850f8 96%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent", headerEl)
  headerWord.textContent = 'MABRIOON'
  const headerAddressWrap = el('div', 'display:none;flex:1;align-items:center;gap:14px;padding:14px 24px;border-radius:999px', headerEl)
  headerAddressWrap.className = 'u-address'
  const headerAddress = document.createElement('input')
  headerAddress.style.cssText = "flex:1;background:transparent;border:none;outline:none;color:#ffffff;font-family:'JetBrains Mono',monospace;font-size:14px;text-shadow:0 1px 3px rgba(0,0,0,.5)"
  headerAddressWrap.appendChild(headerAddress)
  const headerMoreBtn = el('button', 'display:none;width:36px;height:36px;border-radius:50%;color:#ffffff;font-size:14px;cursor:pointer;flex:0 0 auto;pointer-events:auto', headerEl)
  headerMoreBtn.className = 'u-icon-btn'
  headerMoreBtn.textContent = '···'
  const headerBackBtn = el('div', 'display:none;flex:0 0 auto;font-size:9px;letter-spacing:.22em;pointer-events:auto', headerEl)
  headerBackBtn.className = 'u-pill'
  headerBackBtn.textContent = 'VOLVER AL SISTEMA'

  const morePopover = el('div', 'position:absolute;right:30px;top:96px;width:260px;display:none;flex-direction:column;gap:6px;padding:14px;border-radius:18px;z-index:70', stage)
  morePopover.className = 'u-glass'

  const flyerEl = el('div', 'position:absolute;pointer-events:none;z-index:80;display:none;background:url(mabrioon-mark-t.png) center/contain no-repeat;filter:drop-shadow(0 0 34px rgba(40,180,248,.75))', stage)

  const searchEl = el('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:0 24px;z-index:65;background:rgba(3,4,10,.55);backdrop-filter:blur(3px)', stage)
  const searchBox = el('div', 'width:min(720px,84vw);display:flex;align-items:center;gap:16px;padding:20px 28px;border-radius:22px', searchEl)
  searchBox.className = 'u-glass'
  const searchArrow = el('div', 'font-size:13px;color:#a850f8', searchBox)
  searchArrow.textContent = '›'
  const searchInput = document.createElement('input')
  searchInput.placeholder = 'dime a dónde volar'
  searchInput.style.cssText = "flex:1;background:transparent;border:none;outline:none;color:#ffffff;font-family:'JetBrains Mono',monospace;font-size:15px"
  searchBox.appendChild(searchInput)
  const searchEsc = el('div', 'font-size:9px;letter-spacing:.24em;color:rgba(255,255,255,.4);cursor:pointer', searchBox)
  searchEsc.textContent = 'ESC'

  const landedEl = el('div', 'position:absolute;left:clamp(24px,6vw,88px);top:50%;transform:translateY(-50%);display:none;flex-direction:column;gap:14px;max-width:min(560px,72vw);max-height:82vh;overflow:auto;z-index:50', stage)
  const landedKicker = el('div', 'font-size:9px;letter-spacing:.36em;color:rgba(255,255,255,.55)', landedEl)
  const landedTitle = el('div', "font-family:'Archivo Black',sans-serif;font-size:clamp(34px,5vw,62px);line-height:1;letter-spacing:-.02em;background:linear-gradient(100deg,#ffffff,#28d0f8 50%,#a850f8);-webkit-background-clip:text;background-clip:text;color:transparent", landedEl)
  const landedDesc = el('div', 'font-size:13px;line-height:1.7;color:rgba(255,255,255,.78);max-width:520px', landedEl)
  const landedRows = el('div', 'display:flex;flex-direction:column;gap:9px;width:min(520px,80vw);max-height:40vh;overflow:auto', landedEl)
  const landedExtra = el('div', 'display:flex;flex-direction:column;gap:9px;width:min(520px,80vw)', landedEl)
  const landedActions = el('div', 'display:flex;gap:10px;flex-wrap:wrap', landedEl)

  const allEl = el('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:24px;z-index:66;background:rgba(3,4,10,.6)', stage)
  const allBox = el('div', 'width:min(880px,88vw);max-height:78vh;overflow:auto;padding:34px;display:flex;flex-direction:column;gap:24px', allEl)
  allBox.className = 'u-glass'
  const allHeaderKicker = el('div', 'font-size:9px;letter-spacing:.34em;color:rgba(255,255,255,.55)', allBox)
  allHeaderKicker.textContent = 'EL SISTEMA COMPLETO'
  const allHeaderTitle = el('div', "font-family:'Syncopate',sans-serif;font-weight:700;font-size:20px;letter-spacing:.1em;color:#ffffff", allBox)
  allHeaderTitle.textContent = 'TODOS LOS MUNDOS'
  const allGrid = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:18px', allBox)
  allEl.addEventListener('click', (e) => { if (e.target === allEl) closeAll() })
  allBox.addEventListener('click', (e) => e.stopPropagation())

  const permBanner = el('div', 'position:absolute;left:50%;top:100px;transform:translateX(-50%);display:none;align-items:center;gap:14px;padding:12px 20px;border-radius:16px;z-index:90', stage)
  permBanner.className = 'u-glass'
  const permText = el('div', 'font-size:11px;color:rgba(255,255,255,.78);max-width:46vw', permBanner)
  const permAllow = el('button', 'u-pill', permBanner); permAllow.className = 'u-pill u-pill-green'; permAllow.textContent = 'PERMITIR'
  const permDeny = el('button', null, permBanner); permDeny.className = 'u-pill u-pill-danger'; permDeny.textContent = 'BLOQUEAR'

  const pwBanner = el('div', 'position:absolute;left:50%;top:100px;transform:translateX(-50%);display:none;align-items:center;gap:14px;padding:12px 20px;border-radius:16px;z-index:90', stage)
  pwBanner.className = 'u-glass'
  const pwText = el('div', 'font-size:11px;color:rgba(255,255,255,.78)', pwBanner)
  const pwYes = el('button', null, pwBanner); pwYes.className = 'u-pill u-pill-green'; pwYes.textContent = 'GUARDAR'
  const pwNo = el('button', null, pwBanner); pwNo.className = 'u-pill u-pill-danger'; pwNo.textContent = 'NO, GRACIAS'

  const promptEl = el('div', 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:95;background:rgba(3,4,10,.6)', stage)
  const promptBox = el('div', 'width:min(420px,86vw);display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:20px', promptEl)
  promptBox.className = 'u-glass'
  const promptLabel = el('div', 'font-size:12px;color:#ffffff', promptBox)
  const promptInput = document.createElement('input')
  promptInput.className = 'u-field'
  promptBox.appendChild(promptInput)
  const promptRow = el('div', 'display:flex;gap:10px;justify-content:flex-end', promptBox)
  const promptCancel = el('button', null, promptRow); promptCancel.className = 'u-pill u-pill-danger'; promptCancel.textContent = 'CANCELAR'
  const promptOk = el('button', null, promptRow); promptOk.className = 'u-pill'; promptOk.textContent = 'OK'

  const findEl = el('div', 'position:absolute;left:50%;bottom:26px;transform:translateX(-50%);display:none;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;z-index:70', stage)
  findEl.className = 'u-glass'
  const findInput = document.createElement('input')
  findInput.className = 'u-field'
  findInput.style.width = '180px'
  findInput.placeholder = 'buscar en la página'
  findEl.appendChild(findInput)
  const findCount = el('div', 'font-size:10px;color:rgba(255,255,255,.55);white-space:nowrap', findEl)
  const findPrev = el('button', null, findEl); findPrev.textContent = '↑'
  const findNext = el('button', null, findEl); findNext.textContent = '↓'
  const findClose = el('button', null, findEl); findClose.textContent = '✕'

  // ---------------------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------------------
  function fmtAgo(ts) {
    if (!ts) return ''
    const diff = Date.now() - ts
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'AHORA'
    if (min < 60) return `HACE ${min} MIN`
    const h = Math.floor(min / 60)
    if (h < 24) return `HACE ${h} H`
    return `HACE ${Math.floor(h / 24)} D`
  }
  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url || '' } }
  function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild) }
  function makeRow(text, meta, onDelete, thumbnail) {
    const row = document.createElement('div')
    row.className = 'u-row'
    let dot
    if (thumbnail) {
      dot = document.createElement('div')
      dot.style.cssText = 'width:28px;height:20px;border-radius:4px;background-size:cover;background-position:center;flex:0 0 auto;border:1px solid rgba(140,190,255,.25)'
      dot.style.backgroundImage = `url("${thumbnail}")`
    } else {
      dot = document.createElement('div'); dot.className = 'u-row-dot'
    }
    const t = document.createElement('div'); t.className = 'u-row-text'; t.textContent = text
    const m = document.createElement('div'); m.className = 'u-row-meta'; m.textContent = meta || ''
    row.append(dot, t, m)
    if (onDelete) {
      const x = document.createElement('div'); x.className = 'u-row-x'; x.textContent = '×'
      x.addEventListener('click', (e) => { e.stopPropagation(); onDelete() })
      row.appendChild(x)
    }
    return row
  }

  // ---------------------------------------------------------------------------------------
  // Cuerpos: creación
  // ---------------------------------------------------------------------------------------
  function makeCore() {
    return { kind: 'sol', id: 'sol', core: true, name: 'BUSCAR', meta: '', hue: '#00f8f8', x: 0, y: 0, rot: 0 }
  }
  function makeSystemBody(def, i) {
    const yr = Math.pow(YEAR[def.id] || 1, 0.42)
    const kep = (Math.PI * 2) / (yr * EARTH_YEAR_MS)
    const dySign = Math.sign(DAY[def.id] || 1)
    const dy = dySign * Math.pow(Math.abs(DAY[def.id] || 1), 0.35)
    return {
      kind: 'sistema', id: def.id, name: def.name, meta: def.meta, hue: HUES[def.id], psize: PSIZE[def.id],
      kicker: def.kicker, title: def.title, desc: def.desc, earth: !!def.earth,
      a: (i / 9) * Math.PI * 2, r: 0.19 + i * 0.034, spin: kep, axis: (Math.PI * 2) / (dy * EARTH_DAY_MS),
      rot: Math.random() * 6.28, wob: Math.random() * 6.28, moon: 0, x: 0, y: 0, held: false, rows: [],
    }
  }
  function makePageBody(tab, index) {
    return {
      kind: 'pagina', id: `tab:${tab.id}`, tabId: tab.id, name: (tab.title || hostOf(tab.url) || 'PÁGINA').slice(0, 14).toUpperCase(),
      meta: tab.isPrivate ? 'privada' : hostOf(tab.url), hue: tab.isPrivate ? '#7ea0c8' : PAGE_HUES[index % PAGE_HUES.length],
      psize: 0.105, a: Math.random() * 6.28, r: 0.36 + (index % 4) * 0.035, spin: 0.00014, axis: 0.0001,
      rot: 0, wob: Math.random() * 6.28, moon: 0, x: 0, y: 0, held: false,
    }
  }
  function makeExtBody(ext, index) {
    return {
      kind: 'extension', id: `ext:${ext.recordId}`, extId: ext.recordId, name: (ext.name || 'EXTENSIÓN').slice(0, 14).toUpperCase(),
      meta: ext.enabled ? 'activa' : 'apagada', hue: EXT_HUE, psize: 0.07, a: index * 1.1, r: 0.32, spin: 0.00018,
      axis: 0.00012, rot: 0, wob: Math.random() * 6.28, moon: 0, x: 0, y: 0, held: false,
    }
  }

  const core = makeCore()
  state.byId.set('sol', core)
  SYSTEM_DEFS.forEach((def, idx) => { const b = makeSystemBody(def, idx + 1); state.byId.set(b.id, b) })

  function rebuildBodiesArray() {
    state.bodies = [core, ...SYSTEM_DEFS.map((d) => state.byId.get(d.id))]
    for (const tab of state.tabsById.values()) {
      const id = `tab:${tab.id}`
      if (!state.byId.has(id)) state.byId.set(id, makePageBody(tab, state.byId.size))
      const b = state.byId.get(id)
      b.name = (tab.title || hostOf(tab.url) || 'PÁGINA').slice(0, 14).toUpperCase()
      b.meta = tab.isPrivate ? 'privada' : hostOf(tab.url)
      b.tabState = tab
      state.bodies.push(b)
    }
    for (const extId of state.launchedExtIds) {
      const ext = state.extensions.find((x) => x.recordId === extId)
      if (!ext) continue
      const id = `ext:${extId}`
      if (!state.byId.has(id)) state.byId.set(id, makeExtBody(ext, state.byId.size))
      const b = state.byId.get(id)
      b.name = (ext.name || 'EXTENSIÓN').slice(0, 14).toUpperCase()
      b.meta = ext.enabled ? 'activa' : 'apagada'
      state.bodies.push(b)
    }
    // limpia identidades que ya no existen (pestaña cerrada / extensión desinstalada)
    for (const key of Array.from(state.byId.keys())) {
      if (key === 'sol' || SYSTEM_DEFS.some((d) => d.id === key)) continue
      if (!state.bodies.includes(state.byId.get(key))) state.byId.delete(key)
    }
  }

  // ---------------------------------------------------------------------------------------
  // Carga de datos reales (perezosa: se refresca al abrir cada panel)
  // ---------------------------------------------------------------------------------------
  async function safe(fn, fallback) { try { return await fn() } catch (err) { console.error('[Universo]', err); return fallback } }

  async function loadRowsFor(id) {
    if (id === 'llaves') {
      const list = await safe(() => api.listPasswords(), [])
      return list.map((p) => ({
        text: `${p.username || 'sin usuario'} · ${hostOf(p.origin)}`, meta: 'GUARDADA',
        onDelete: async () => { await api.removePassword(p.id); openLanded('llaves') },
      }))
    }
    if (id === 'aterrizajes') {
      const list = await safe(() => api.listDownloads(), [])
      return list.slice().reverse().map((d) => ({
        text: d.filename, meta: d.state === 'completed' ? 'LISTO' : d.state === 'progressing' ? 'DESCARGANDO' : (d.state || '').toUpperCase(),
        onClick: () => api.openDownload(d.path),
      }))
    }
    if (id === 'estela') {
      const list = await safe(() => api.listHistory(), [])
      return list.slice().sort((a, b) => (b.visitedAt || 0) - (a.visitedAt || 0)).slice(0, 40).map((h) => ({
        text: h.title || h.url, meta: fmtAgo(h.visitedAt),
        onDelete: async () => { await api.removeHistoryEntry(h.url); openLanded('estela') },
      }))
    }
    if (id === 'constelacion') {
      const list = await safe(() => api.listFavorites(), [])
      return list.map((f) => ({
        text: f.title || f.url, meta: hostOf(f.url), thumbnail: f.thumbnail || null,
        onClick: async () => { const { id: tid } = await api.createTabBackground(f.url); land(tid) },
        onDelete: async () => { await api.removeFavorite(f.url); openLanded('constelacion') },
      }))
    }
    if (id === 'vuelo') {
      const tabs = Array.from(state.tabsById.values())
      const rows = tabs.map((t) => ({
        text: t.title || hostOf(t.url), meta: t.isActive ? 'ACTIVA' : (t.loading ? 'CARGANDO' : 'EN VUELO'),
        onClick: () => land(t.id),
        onDelete: () => api.closeTab(t.id),
      }))
      const recent = await safe(() => api.listRecentlyClosed(), [])
      for (const r of recent) rows.push({ text: r.title || r.url, meta: `CERRADA · ${fmtAgo(r.closedAt)}` })
      return rows
    }
    if (id === 'gravedad') {
      const engine = await safe(() => api.getSearchEngine(), 'mabriona')
      const shields = await safe(() => api.getShieldsEnabled(), true)
      const perms = await safe(() => api.listPermissions(), [])
      const zoom = await safe(() => api.getDefaultZoom(), 100)
      const translateLang = await safe(() => api.getDefaultTranslateLang(), 'ES')
      const minFont = await safe(() => api.getMinFontSize(), 0)
      const rows = [
        { text: 'Buscador por defecto', meta: String(engine || 'mabriona').toUpperCase() },
        { text: 'MABRIONA SHIELDS', meta: shields ? 'ACTIVO' : 'APAGADO', onClick: async () => { await api.setShieldsEnabled(!shields); openLanded('gravedad') } },
        { text: 'Zoom por defecto (pestañas nuevas)', meta: `${zoom}%` },
        { text: 'Idioma de traducción por defecto', meta: String(translateLang || 'ES').toUpperCase() },
        { text: 'Tamaño mínimo de letra (accesibilidad)', meta: minFont > 0 ? `${minFont}px` : 'SIN MÍNIMO' },
      ]
      for (const p of Array.isArray(perms) ? perms.slice(0, 10) : []) {
        rows.push({ text: `${hostOf(p.origin || '')} · ${p.kind || ''}`, meta: String(p.decision || '').toUpperCase(), onDelete: async () => { await api.clearPermission(p.origin, p.kind); openLanded('gravedad') } })
      }
      return rows
    }
    if (id === 'eclipse') {
      const shields = await safe(() => api.getShieldsEnabled(), true)
      const privateTabs = Array.from(state.tabsById.values()).filter((t) => t.isPrivate)
      const blocked = Array.from(state.tabsById.values()).reduce((sum, t) => sum + (t.blockedCount || 0), 0)
      const rows = [{ text: 'Rastreadores bloqueados', meta: String(blocked) }, { text: 'MABRIONA SHIELDS', meta: shields ? 'ACTIVO' : 'APAGADO' }]
      for (const t of privateTabs) rows.push({ text: t.title || hostOf(t.url), meta: 'A OSCURAS', onClick: () => land(t.id), onDelete: () => api.closeTab(t.id) })
      return rows
    }
    if (id === 'tripulacion') {
      const profiles = await safe(() => api.listProfiles(), [])
      const active = await safe(() => api.getActiveProfile(), null)
      const autofill = await safe(() => api.listAutofillProfiles(), [])
      const rows = profiles.map((p) => ({
        text: `${p.emoji || '👤'} ${p.name}`, meta: active && active.id === p.id ? 'ACTIVO' : 'CAMBIAR',
        onClick: () => { if (!(active && active.id === p.id)) api.switchToProfile(p.id) },
      }))
      rows.push({ text: 'Autocompletar guardado', meta: String(autofill.length || 0) })
      rows.push({ text: 'Modo invitado — ventana nueva sin guardar nada', meta: 'ABRIR', onClick: () => api.newGuestWindow() })
      return rows
    }
    return []
  }

  // ---------------------------------------------------------------------------------------
  // Panel "aterrizado" (izquierda) — planetas fijos y Baúl comparten este contenedor
  // ---------------------------------------------------------------------------------------
  function closeLanded() {
    state.landed = null
    syncBrowserView()
    render()
  }

  async function openLanded(id) {
    state.landed = id
    render()
    if (id === 'vault') { renderVaultPanel(); syncBrowserView(); return }
    const b = state.byId.get(id)
    if (b && b.kind === 'extension') { renderExtensionPanel(b); syncBrowserView(); return }
    landedKicker.textContent = b.kicker
    landedTitle.textContent = b.title
    landedDesc.textContent = b.desc
    clearChildren(landedRows)
    clearChildren(landedExtra)
    clearChildren(landedActions)
    const loading = document.createElement('div'); loading.className = 'u-note'; loading.textContent = 'cargando…'
    landedRows.appendChild(loading)
    const rows = await loadRowsFor(id)
    if (state.landed !== id) return
    clearChildren(landedRows)
    if (rows.length === 0) {
      const empty = document.createElement('div'); empty.className = 'u-note'; empty.textContent = 'Nada por acá todavía.'
      landedRows.appendChild(empty)
    }
    for (const r of rows) {
      const row = makeRow(r.text, r.meta, r.onDelete, r.thumbnail)
      if (r.onClick) { row.style.cursor = 'pointer'; row.addEventListener('click', r.onClick) }
      landedRows.appendChild(row)
    }
    renderLandedExtras(id)
    syncBrowserView()
  }

  function renderLandedExtras(id) {
    clearChildren(landedExtra)
    clearChildren(landedActions)
    if (id === 'gravedad') {
      const select = document.createElement('select'); select.className = 'u-select'
      for (const [val, label] of [['mabriona', 'MABRIONA Search'], ['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave Search']]) {
        const opt = document.createElement('option'); opt.value = val; opt.textContent = label; select.appendChild(opt)
      }
      safe(() => api.getSearchEngine(), 'mabriona').then((cur) => { select.value = cur || 'mabriona' })
      select.addEventListener('change', () => api.setSearchEngine(select.value))
      landedExtra.appendChild(select)

      const zoomRow = document.createElement('div'); zoomRow.style.cssText = 'display:flex;align-items:center;gap:10px'
      const zoomLabel = document.createElement('div'); zoomLabel.className = 'u-note'; zoomLabel.textContent = 'Zoom por defecto'
      const zoomInput = document.createElement('input'); zoomInput.className = 'u-field'; zoomInput.type = 'number'; zoomInput.min = '50'; zoomInput.max = '300'; zoomInput.step = '10'; zoomInput.style.width = '70px'
      safe(() => api.getDefaultZoom(), 100).then((cur) => { zoomInput.value = cur || 100 })
      zoomInput.addEventListener('change', async () => { await api.setDefaultZoom(zoomInput.value); openLanded('gravedad') })
      zoomRow.append(zoomLabel, zoomInput)
      landedExtra.appendChild(zoomRow)

      const langSelect = document.createElement('select'); langSelect.className = 'u-select'
      safe(() => api.getTranslateLanguages(), []).then((langs) => {
        clearChildren(langSelect)
        for (const l of langs) { const opt = document.createElement('option'); opt.value = l.code; opt.textContent = l.name; langSelect.appendChild(opt) }
        safe(() => api.getDefaultTranslateLang(), 'ES').then((cur) => { langSelect.value = cur || 'ES' })
      })
      langSelect.addEventListener('change', () => api.setDefaultTranslateLang(langSelect.value))
      landedExtra.appendChild(langSelect)

      const fontRow = document.createElement('div'); fontRow.style.cssText = 'display:flex;align-items:center;gap:10px'
      const fontLabel = document.createElement('div'); fontLabel.className = 'u-note'; fontLabel.textContent = 'Tamaño mínimo de letra (0 = sin mínimo)'
      const fontInput = document.createElement('input'); fontInput.className = 'u-field'; fontInput.type = 'number'; fontInput.min = '0'; fontInput.max = '48'; fontInput.step = '1'; fontInput.style.width = '70px'
      safe(() => api.getMinFontSize(), 0).then((cur) => { fontInput.value = cur || 0 })
      fontInput.addEventListener('change', async () => { await api.setMinFontSize(fontInput.value); openLanded('gravedad') })
      fontRow.append(fontLabel, fontInput)
      landedExtra.appendChild(fontRow)
    }
    if (id === 'tripulacion') {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px'
      const input = document.createElement('input'); input.className = 'u-field'; input.placeholder = 'Nombre del perfil nuevo'
      const btn = document.createElement('button'); btn.className = 'u-pill u-pill-violet'; btn.textContent = '+ CREAR'
      btn.addEventListener('click', async () => { if (!input.value.trim()) return; await api.createProfile(input.value.trim(), '👤'); input.value = ''; openLanded('tripulacion') })
      row.append(input, btn)
      landedExtra.appendChild(row)
    }
    if (id === 'estela') {
      const clearBtn = document.createElement('button'); clearBtn.className = 'u-pill u-pill-danger'; clearBtn.textContent = 'VACIAR HISTORIAL'
      clearBtn.addEventListener('click', async () => { await api.clearHistory(); openLanded('estela') })
      landedExtra.appendChild(clearBtn)
    }
    if (id === 'eclipse') {
      const btn = document.createElement('button'); btn.className = 'u-pill u-pill-violet'; btn.textContent = 'ABRIR PESTAÑA PRIVADA'
      btn.addEventListener('click', async () => { const id2 = await api.createPrivateTab(); land(id2) })
      landedExtra.appendChild(btn)
    }
    if (state.byId.get(id) && state.byId.get(id).kind === 'sistema') {
      const closeBtn = document.createElement('div'); closeBtn.className = 'u-pill'; closeBtn.textContent = 'VOLVER AL UNIVERSO'
      closeBtn.addEventListener('click', closeLanded)
      landedActions.appendChild(closeBtn)
    }
  }

  function renderExtensionPanel(b) {
    const ext = state.extensions.find((x) => x.recordId === b.extId)
    landedKicker.textContent = 'EXTENSIÓN'
    landedTitle.textContent = ext ? (ext.name || ext.origin) : b.name
    landedDesc.textContent = ext ? `${ext.origin === 'webstore' ? 'Chrome Web Store' : ext.origin === 'unpacked' ? 'Cargada desde una carpeta' : 'Importada de otro navegador'} · v${ext.version || '—'}` : 'Esta extensión ya no está instalada.'
    clearChildren(landedRows); clearChildren(landedExtra); clearChildren(landedActions)
    if (!ext) return
    landedRows.appendChild(makeRow(ext.enabled ? 'Activa' : 'Apagada', ext.pinned ? 'FIJADA EN LA BARRA' : ''))
    const toggleBtn = document.createElement('div'); toggleBtn.className = ext.enabled ? 'u-pill u-pill-amber' : 'u-pill u-pill-green'; toggleBtn.textContent = ext.enabled ? 'APAGAR' : 'PRENDER'
    toggleBtn.addEventListener('click', async () => { await api.setExtensionEnabled(ext.recordId, !ext.enabled); await refreshExtensions(); openLanded(b.id) })
    const storeBtn = document.createElement('div'); storeBtn.className = 'u-pill u-pill-turquoise'; storeBtn.textContent = 'GUARDAR EN EL BAÚL'
    storeBtn.addEventListener('click', () => { state.launchedExtIds.delete(b.extId); rebuildBodiesArray(); closeLanded() })
    const delBtn = document.createElement('div'); delBtn.className = 'u-pill u-pill-danger'; delBtn.textContent = 'ELIMINAR'
    delBtn.addEventListener('click', async () => { await api.removeExtension(ext.recordId); state.launchedExtIds.delete(b.extId); await refreshExtensions(); rebuildBodiesArray(); closeLanded() })
    landedActions.append(toggleBtn, storeBtn, delBtn)
  }

  function renderVaultPanel() {
    landedKicker.textContent = 'LO QUE INSTALASTE'
    landedTitle.textContent = 'Baúl'
    landedDesc.textContent = 'Todo lo que instalás vive acá. Sacá una extensión para que orbite como un mundo más, o tocá el interruptor para prenderla/apagarla de verdad.'
    clearChildren(landedRows)
    const stored = state.extensions.filter((x) => !state.launchedExtIds.has(x.recordId))
    if (stored.length === 0 && state.extensions.length === 0) {
      const empty = document.createElement('div'); empty.className = 'u-note'; empty.textContent = 'Todavía no instalaste ninguna extensión real.'
      landedRows.appendChild(empty)
    }
    for (const ext of stored) {
      const row = document.createElement('div'); row.className = 'u-row'; row.style.cursor = 'pointer'
      const dot = document.createElement('div'); dot.className = 'u-row-dot'
      const t = document.createElement('div'); t.className = 'u-row-text'; t.textContent = ext.name || ext.origin
      const toggle = document.createElement('div'); toggle.className = 'u-row-meta'; toggle.style.cursor = 'pointer'
      toggle.textContent = ext.enabled ? 'ACTIVA' : 'APAGADA'
      toggle.addEventListener('click', async (e) => { e.stopPropagation(); await api.setExtensionEnabled(ext.recordId, !ext.enabled); await refreshExtensions(); renderVaultPanel() })
      const launch = document.createElement('div'); launch.className = 'u-row-meta'; launch.style.color = '#00f8f8'; launch.textContent = 'LANZAR'
      const x = document.createElement('div'); x.className = 'u-row-x'; x.textContent = '×'
      x.addEventListener('click', async (e) => { e.stopPropagation(); await api.removeExtension(ext.recordId); await refreshExtensions(); renderVaultPanel() })
      row.addEventListener('click', () => { state.launchedExtIds.add(ext.recordId); rebuildBodiesArray(); closeLanded() })
      row.append(dot, t, toggle, launch, x)
      landedRows.appendChild(row)
    }
    clearChildren(landedExtra)
    const addRow = document.createElement('div'); addRow.style.cssText = 'display:flex;flex-direction:column;gap:8px'
    const loadBtn = document.createElement('button'); loadBtn.className = 'u-btn'; loadBtn.textContent = 'Cargar extensión desde una carpeta'
    loadBtn.addEventListener('click', async () => { await api.loadUnpackedExtension(); await refreshExtensions(); renderVaultPanel() })
    const webRow = document.createElement('div'); webRow.style.cssText = 'display:flex;gap:8px'
    const webInput = document.createElement('input'); webInput.className = 'u-field'; webInput.placeholder = 'ID o link de la Chrome Web Store'
    const webBtn = document.createElement('button'); webBtn.className = 'u-pill u-pill-violet'; webBtn.textContent = 'INSTALAR'
    webBtn.addEventListener('click', async () => { if (!webInput.value.trim()) return; await api.installExtensionFromWebStore(webInput.value.trim()); webInput.value = ''; await refreshExtensions(); renderVaultPanel() })
    webRow.append(webInput, webBtn)
    addRow.append(loadBtn, webRow)
    landedExtra.appendChild(addRow)
    clearChildren(landedActions)
  }

  async function refreshExtensions() { state.extensions = await safe(() => api.listExtensions(), []) }

  // ---------------------------------------------------------------------------------------
  // Mosaico "todos los mundos" (Luna)
  // ---------------------------------------------------------------------------------------
  function tile(name, kind, hue, onPick, onDelete) {
    const box = document.createElement('div')
    box.className = 'u-btn'
    box.style.cssText = 'flex-direction:column;align-items:center;gap:10px;padding:16px 10px;border-radius:14px;cursor:pointer'
    const disc = document.createElement('div')
    disc.style.cssText = `width:58px;height:58px;border-radius:50%;background:radial-gradient(120% 120% at 32% 26%,rgba(255,255,255,.22),rgba(255,255,255,.03) 52%,rgba(6,9,22,.9));border:1px solid ${hue};box-shadow:0 0 22px ${hue}66`
    const label = document.createElement('div'); label.style.cssText = 'font-size:10px;letter-spacing:.14em;color:#ffffff;text-align:center'; label.textContent = name
    const kindEl = document.createElement('div'); kindEl.style.cssText = 'font-size:9px;letter-spacing:.16em;color:#7b86ab'; kindEl.textContent = kind
    box.append(disc, label, kindEl)
    if (onDelete) {
      const del = document.createElement('div'); del.style.cssText = 'font-size:9px;letter-spacing:.2em;color:#ff9ab8;cursor:pointer'; del.textContent = 'ELIMINAR'
      del.addEventListener('click', (e) => { e.stopPropagation(); onDelete() })
      box.appendChild(del)
    }
    box.addEventListener('click', onPick)
    return box
  }
  function openAll() {
    state.allOpen = true
    render()
    clearChildren(allGrid)
    for (const def of SYSTEM_DEFS) allGrid.appendChild(tile(def.name, 'MUNDO', HUES[def.id], () => { closeAll(); openLanded(def.id) }))
    for (const tab of state.tabsById.values()) allGrid.appendChild(tile(tab.title || hostOf(tab.url), tab.isPrivate ? 'PRIVADA' : 'PÁGINA', tab.isPrivate ? '#7ea0c8' : '#28d0f8', () => { closeAll(); land(tab.id) }, () => { api.closeTab(tab.id); openAll() }))
    for (const ext of state.extensions) allGrid.appendChild(tile(ext.name || ext.origin, 'EXTENSIÓN', EXT_HUE, () => { closeAll(); state.launchedExtIds.add(ext.recordId); rebuildBodiesArray(); render() }, async () => { await api.removeExtension(ext.recordId); await refreshExtensions(); openAll() }))
    const plus = document.createElement('div')
    plus.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px 10px;border-radius:14px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.4);cursor:pointer'
    plus.innerHTML = ''
    const plusDisc = document.createElement('div'); plusDisc.style.cssText = 'width:54px;height:54px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5);display:flex;align-items:center;justify-content:center;font-size:22px;color:#ffffff'; plusDisc.textContent = '+'
    const plusLabel = document.createElement('div'); plusLabel.style.cssText = 'font-size:10px;letter-spacing:.14em;color:#ffffff'; plusLabel.textContent = 'NUEVO'
    plus.append(plusDisc, plusLabel)
    plus.addEventListener('click', () => { closeAll(); openSearch() })
    allGrid.appendChild(plus)
  }
  function closeAll() { state.allOpen = false; render() }

  // ---------------------------------------------------------------------------------------
  // Sincronía con el BrowserView real
  // ---------------------------------------------------------------------------------------
  function syncBrowserView() {
    const showingPage = typeof state.landed === 'number'
    api.setPanelOpen(showingPage ? false : 'full')
  }
  function land(tabId) {
    state.landed = tabId
    state.allOpen = false
    api.switchTab(tabId)
    syncBrowserView()
    render()
  }

  // ---------------------------------------------------------------------------------------
  // Buscador / Sol
  // ---------------------------------------------------------------------------------------
  function openSearch() {
    searchEl.style.display = 'flex'
    searchInput.value = ''
    setTimeout(() => searchInput.focus(), 0)
  }
  function closeSearch() { searchEl.style.display = 'none' }
  searchEl.addEventListener('click', closeSearch)
  searchBox.addEventListener('click', (e) => e.stopPropagation())
  searchEsc.addEventListener('click', closeSearch)
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSearch(); return }
    if (e.key !== 'Enter') return
    const q = searchInput.value.trim()
    if (!q) { closeSearch(); return }
    closeSearch()
    flyAndCreate(q)
  })

  function flyAndCreate(q) {
    const W = stage.clientWidth, H = stage.clientHeight
    const unit = Math.max(320, Math.min(W, H))
    const size = unit * 0.16
    flyerEl.style.display = 'block'
    flyerEl.style.width = size + 'px'
    flyerEl.style.height = size + 'px'
    flyerEl.style.left = '56px'
    flyerEl.style.top = '48px'
    flyerEl.style.transform = 'translate(-50%,-50%) scale(1) rotate(-14deg)'
    flyerEl.style.opacity = '1'
    flyerEl.style.transition = 'none'
    let createdTabId = null
    api.createTabBackground(q).then((res) => { createdTabId = res && res.id }).catch((err) => console.error('[Universo] no se pudo crear la pestaña', err))
    requestAnimationFrame(() => requestAnimationFrame(() => {
      flyerEl.style.transition = 'all 1.05s cubic-bezier(.4,0,.2,1)'
      flyerEl.style.left = (W / 2) + 'px'
      flyerEl.style.top = (H / 2) + 'px'
      flyerEl.style.transform = 'translate(-50%,-50%) scale(0.34) rotate(26deg)'
      flyerEl.style.opacity = '0'
    }))
    setTimeout(() => {
      flyerEl.style.display = 'none'
      if (createdTabId != null) land(createdTabId)
    }, 1150)
  }

  // ---------------------------------------------------------------------------------------
  // "···" — acciones sobre la página aterrizada
  // ---------------------------------------------------------------------------------------
  function currentLandedTab() { return typeof state.landed === 'number' ? state.tabsById.get(state.landed) : null }
  function buildMorePopover() {
    clearChildren(morePopover)
    const tab = currentLandedTab()
    if (!tab) return
    const actions = [
      ['← Atrás', () => api.back(tab.id)],
      ['→ Adelante', () => api.forward(tab.id)],
      [tab.loading ? '✕ Detener' : '⟳ Recargar', () => (tab.loading ? api.stop(tab.id) : api.reload(tab.id))],
      ['⭐ Guardar en Constelación', async () => {
        toggleMore(false)
        await api.addFavorite({ url: tab.url, title: tab.title, tabId: tab.id, addedAt: Date.now() })
      }],
      ['🌐 Traducir', async () => {
        toggleMore(false)
        const lang = await safe(() => api.getDefaultTranslateLang(), 'ES')
        await api.translatePage(lang)
      }],
      ['🔍 Buscar en la página', () => { toggleMore(false); findEl.style.display = 'flex'; findInput.focus() }],
      ['🔗 Copiar link', async () => { await api.copyText(tab.url); toggleMore(false) }],
      ['🖨 Imprimir', () => api.print()],
      ['🛠 DevTools', () => api.toggleDevTools()],
      ['− Alejar', async () => { const f = await api.getZoom(tab.id); api.setZoom(tab.id, Math.max(0.5, f - 0.1)) }],
      ['+ Acercar', async () => { const f = await api.getZoom(tab.id); api.setZoom(tab.id, Math.min(3, f + 0.1)) }],
      ['🕶 Nueva pestaña privada', async () => { const id = await api.createPrivateTab(); toggleMore(false); land(id) }],
      ['🪟 Nueva ventana', () => api.newWindow()],
    ]
    for (const [label, fn] of actions) {
      const btn = document.createElement('button'); btn.className = 'u-btn'; btn.textContent = label
      btn.addEventListener('click', async () => { await fn(); })
      morePopover.appendChild(btn)
    }
  }
  function toggleMore(force) {
    const show = force !== undefined ? force : morePopover.style.display !== 'flex'
    if (show) buildMorePopover()
    morePopover.style.display = show ? 'flex' : 'none'
  }
  headerMoreBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMore() })
  stage.addEventListener('click', () => { if (morePopover.style.display === 'flex') toggleMore(false) })
  headerBackBtn.addEventListener('click', (e) => { e.stopPropagation(); closeLanded() })
  headerAddress.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const tab = currentLandedTab()
    if (tab && headerAddress.value.trim()) api.navigate(tab.id, headerAddress.value.trim())
    headerAddress.blur()
  })

  findClose.addEventListener('click', () => { findEl.style.display = 'none'; const t = currentLandedTab(); if (t) api.stopFind(t.id) })
  function runFind(forward, findNext) { const t = currentLandedTab(); if (t && findInput.value) api.findInPage(t.id, findInput.value, { forward, findNext }) }
  findInput.addEventListener('input', () => runFind(true, false))
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runFind(true, true); if (e.key === 'Escape') findClose.click() })
  findNext.addEventListener('click', () => runFind(true, true))
  findPrev.addEventListener('click', () => runFind(false, true))
  api.onFindResult(({ activeMatchOrdinal, matches }) => { findCount.textContent = `${activeMatchOrdinal || 0}/${matches || 0}` })

  // ---------------------------------------------------------------------------------------
  // Prompt de texto genérico (reemplazo de window.prompt)
  // ---------------------------------------------------------------------------------------
  function showPrompt(label, def) {
    return new Promise((resolve) => {
      promptLabel.textContent = label
      promptInput.value = def || ''
      promptEl.style.display = 'flex'
      promptInput.focus(); promptInput.select()
      function done(v) { promptEl.style.display = 'none'; cleanup(); resolve(v) }
      function onOk() { done(promptInput.value) }
      function onCancel() { done(null) }
      function onKey(e) { if (e.key === 'Enter') onOk(); if (e.key === 'Escape') onCancel() }
      function cleanup() { promptOk.removeEventListener('click', onOk); promptCancel.removeEventListener('click', onCancel); promptInput.removeEventListener('keydown', onKey) }
      promptOk.addEventListener('click', onOk); promptCancel.addEventListener('click', onCancel); promptInput.addEventListener('keydown', onKey)
    })
  }

  // ---------------------------------------------------------------------------------------
  // Permisos / guardar contraseña — banners flotantes, siempre activos
  // ---------------------------------------------------------------------------------------
  const KIND_LABEL = { camera: 'la cámara', microphone: 'el micrófono', location: 'tu ubicación', notifications: 'mostrarte notificaciones', clipboard: 'leer el portapapeles', midi: 'dispositivos MIDI' }
  const permQueue = []
  let permShowing = null
  function showNextPermission() {
    if (permShowing || permQueue.length === 0) return
    permShowing = permQueue.shift()
    const labels = permShowing.kinds.map((k) => KIND_LABEL[k] || k).join(' y ')
    permText.textContent = `${permShowing.origin} solicita acceso a ${labels}.`
    permBanner.style.display = 'flex'
  }
  function resolvePermission(allow) {
    if (!permShowing) return
    api.respondPermission(permShowing.requestId, allow)
    permShowing = null
    permBanner.style.display = 'none'
    showNextPermission()
  }
  permAllow.addEventListener('click', () => resolvePermission(true))
  permDeny.addEventListener('click', () => resolvePermission(false))
  api.onPermissionRequest((req) => { permQueue.push(req); showNextPermission() })

  api.onPasswordSavePrompt(({ username }) => { pwText.textContent = `¿Guardar la contraseña de ${username}?`; pwBanner.style.display = 'flex' })
  pwYes.addEventListener('click', async () => { await api.confirmSavePassword(); pwBanner.style.display = 'none' })
  pwNo.addEventListener('click', () => { api.dismissPasswordPrompt(); pwBanner.style.display = 'none' })

  // ---------------------------------------------------------------------------------------
  // Cuerpos: interacción (drag / click)
  // ---------------------------------------------------------------------------------------
  function pointerPos(e) {
    const r = stage.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function onBodyPointerDown(b, e) {
    if (b.core) { e.stopPropagation(); openSearch(); return }
    e.stopPropagation()
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId)
    b.held = true
    state.dragging = b
    state.downPt = { x: e.clientX, y: e.clientY }
  }
  function onBodyClick(b, e) {
    e.stopPropagation()
  }
  stage.addEventListener('pointermove', (e) => {
    const b = state.dragging
    if (!b) return
    const p = pointerPos(e)
    b.x = p.x; b.y = p.y
  })
  stage.addEventListener('pointerup', (e) => onDragEnd(e))
  stage.addEventListener('pointerleave', (e) => onDragEnd(e))
  function onDragEnd(e) {
    const b = state.dragging
    if (!b) return
    const W = stage.clientWidth, H = stage.clientHeight
    const cx = W / 2, cy = H / 2, unit = Math.max(320, Math.min(W, H))
    const wasClick = state.downPt && Math.hypot(e.clientX - state.downPt.x, e.clientY - state.downPt.y) < 6
    b.held = false
    state.dragging = null
    state.downPt = null
    if (wasClick) {
      if (b.kind === 'pagina') land(b.tabId)
      else if (b.kind === 'extension') openLanded(b.id)
      else openLanded(b.id)
      return
    }
    const dc = Math.hypot(b.x - cx, b.y - cy)
    const vr = unit * 0.075, vx = W - vr - unit * 0.05, vy = H - vr - unit * 0.05
    if (b.kind === 'extension' && Math.hypot(b.x - vx, b.y - vy) < vr * 1.5) {
      state.launchedExtIds.delete(b.extId)
      rebuildBodiesArray()
      render()
      return
    }
    if (dc < unit * 0.13) {
      b.a = Math.atan2(b.y - cy, b.x - cx); b.r = 0.30
      if (b.kind === 'pagina') land(b.tabId)
      else openLanded(b.id)
      return
    }
    if (dc > unit * 0.46 && b.kind === 'pagina') { api.closeTab(b.tabId); return }
    b.a = Math.atan2((b.y - cy) / (H * 0.86), (b.x - cx) / (W * 0.92))
    b.r = Math.min(0.48, Math.max(0.2, Math.hypot((b.x - cx) / (W * 0.92), (b.y - cy) / (H * 0.86))))
  }
  stage.addEventListener('click', (e) => {
    if (e.target === stage || e.target === bodiesEl || e.target === starsEl) {
      if (state.landed !== null || state.allOpen) { closeLanded(); state.allOpen = false; render() }
    }
  })

  // ---------------------------------------------------------------------------------------
  // Meteoritos decorativos — dos rocas chicas con estela corta, entran lento desde cualquier
  // borde y reaparecen al salir (ver Mabrioon Universo.dc.html, spawnMeteor).
  // ---------------------------------------------------------------------------------------
  const METEOR_TONES = ['#8d8377', '#a2988a']
  function makeMeteorEl() {
    const wrap = el('div', 'position:absolute;width:0;height:0;pointer-events:none', meteorsEl)
    const tail = el('div', 'position:absolute;left:0;top:0;background:linear-gradient(90deg,transparent,rgba(220,232,255,.32));border-radius:2px', wrap)
    const rock = el('div', 'position:absolute;left:0;top:0;border-radius:52% 46% 58% 44%/48% 56% 44% 52%;box-shadow:0 0 8px rgba(255,238,210,.28)', wrap)
    return { wrap, tail, rock }
  }
  const meteors = [0, 1].map(() => Object.assign({ x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, s: 1.5, tone: METEOR_TONES[0] }, makeMeteorEl()))
  function spawnMeteor(m, W, H) {
    const side = Math.floor(Math.random() * 4)
    const speed = 0.022 + Math.random() * 0.035
    const spread = () => (Math.random() - 0.5) * 1.1
    let dir
    if (side === 0) { m.x = -80; m.y = Math.random() * H; dir = spread() }
    else if (side === 1) { m.x = W + 80; m.y = Math.random() * H; dir = Math.PI + spread() }
    else if (side === 2) { m.x = Math.random() * W; m.y = -80; dir = Math.PI / 2 + spread() }
    else { m.x = Math.random() * W; m.y = H + 80; dir = -Math.PI / 2 + spread() }
    m.vx = Math.cos(dir) * speed
    m.vy = Math.sin(dir) * speed
    m.s = 1.2 + Math.random() * 1.8
    m.rot = Math.random() * 6.28
    m.spin = (Math.random() - 0.5) * 0.004
    m.tone = METEOR_TONES[Math.floor(Math.random() * METEOR_TONES.length)]
  }
  meteors.forEach((m) => spawnMeteor(m, window.innerWidth, window.innerHeight))
  function tickMeteors(dt, W, H) {
    for (const m of meteors) {
      m.x += m.vx * dt; m.y += m.vy * dt; m.rot += m.spin * dt
      if (m.x < -160 || m.x > W + 160 || m.y < -160 || m.y > H + 160) spawnMeteor(m, W, H)
      m.wrap.style.left = m.x + 'px'; m.wrap.style.top = m.y + 'px'
      const tailLen = m.s * 22
      const angDeg = Math.atan2(m.vy, m.vx) * 180 / Math.PI
      m.tail.style.width = tailLen + 'px'; m.tail.style.height = '1px'
      m.tail.style.transform = `translate(-100%,-50%) rotate(${angDeg}deg)`
      m.tail.style.transformOrigin = '100% 50%'
      m.rock.style.width = m.s + 'px'; m.rock.style.height = (m.s * 0.82) + 'px'
      m.rock.style.margin = `${-m.s * 0.41}px 0 0 ${-m.s / 2}px`
      m.rock.style.transform = `rotate(${m.rot}rad)`
      m.rock.style.background = `radial-gradient(circle at 32% 30%,#d6d2c9,${m.tone} 52%,#241f1b)`
    }
  }

  // ---------------------------------------------------------------------------------------
  // Render de cuerpos (física -> DOM)
  // ---------------------------------------------------------------------------------------
  function ensureBodyEl(b) {
    if (b.el) return b.el
    const wrap = document.createElement('div')
    wrap.style.position = 'absolute'
    const disc = el('div', null, wrap)
    const label = el('div', null, wrap)
    const name = el('div', null, label)
    const meta = el('div', null, label)
    const ring = el('div', null, wrap)
    const surface = el('div', null, wrap)
    const cloud = el('div', null, wrap)
    const moonsWrap = el('div', null, wrap)
    wrap.addEventListener('pointerdown', (e) => onBodyPointerDown(b, e))
    wrap.addEventListener('click', (e) => onBodyClick(b, e))
    b.el = wrap; b._disc = disc; b._label = label; b._name = name; b._meta = meta; b._ring = ring; b._surface = surface; b._cloud = cloud; b._moonsWrap = moonsWrap
    bodiesEl.appendChild(wrap)
    return wrap
  }
  function removeStaleBodyEls() {
    for (const child of Array.from(bodiesEl.children)) {
      const owner = state.bodies.find((b) => b.el === child)
      if (!owner) child.remove()
    }
  }

  function renderFrame(W, H, cx, cy, unit) {
    beltEl.style.left = cx + 'px'; beltEl.style.top = cy + 'px'
    beltEl.style.width = (0.335 * W * 0.92 * 2) + 'px'; beltEl.style.height = (0.335 * H * 0.86 * 2) + 'px'
    beltEl.style.transform = 'translate(-50%,-50%)'
    beltEl.style.border = '14px solid rgba(150,180,255,.05)'
    glowEl.style.left = cx + 'px'; glowEl.style.top = cy + 'px'
    glowEl.style.width = glowEl.style.height = (unit * 0.5) + 'px'
    glowEl.style.transform = 'translate(-50%,-50%)'
    const coreS = unit * 0.2
    coreSwirlEl.style.left = cx + 'px'; coreSwirlEl.style.top = cy + 'px'
    coreSwirlEl.style.width = coreSwirlEl.style.height = coreS + 'px'
    coreSwirlEl.style.transform = 'translate(-50%,-50%)'
    coreSwirlEl.style.opacity = state.landed !== null ? '0.25' : '1'
    coreSwirlEl.style.transition = 'opacity .6s ease'

    // órbitas (líneas guía)
    if (orbitsEl.childElementCount !== state.bodies.length - 1) {
      clearChildren(orbitsEl)
      for (let i = 1; i < state.bodies.length; i++) el('div', 'position:absolute;border-radius:50%;border:1px solid rgba(120,170,255,.08)', orbitsEl)
    }
    for (let i = 1; i < state.bodies.length; i++) {
      const b = state.bodies[i]
      const ring = orbitsEl.children[i - 1]
      if (!ring) continue
      ring.style.left = cx + 'px'; ring.style.top = cy + 'px'
      ring.style.width = (b.r * W * 0.92 * 2) + 'px'; ring.style.height = (b.r * H * 0.86 * 2) + 'px'
      ring.style.transform = 'translate(-50%,-50%)'
    }

    removeStaleBodyEls()

    const landedBody = typeof state.landed === 'string' ? state.byId.get(state.landed) : null
    const dimAll = state.landed !== null || state.allOpen

    // Etiquetas sin choques — dos planetas cercanos en su órbita (ej. Gravedad/Estela) pueden
    // terminar con los discos pegados; sin esto sus nombres se superponen y se leen como un
    // solo texto ilegible. Se prueban candidatos en las 4 direcciones a 3 distancias, en orden
    // de disco más grande a más chico, y se descarta cualquiera que se salga de pantalla, pise
    // OTRO disco, o pise una etiqueta ya puesta.
    const labelPlan = new Map()
    const nonCore = state.bodies.filter((b) => !b.core)
    const discOf = (b) => ({ x: b.x, y: b.y, r: unit * Math.max(0.045, Math.min(0.115, b.psize || 0.09)) / 2 })
    const boxesOverlap = (a, o) => Math.abs(a.x - o.x) < (a.w + o.w) / 2 && Math.abs(a.y - o.y) < (a.h + o.h) / 2
    const placedLabelBoxes = []
    for (const b of [...nonCore].sort((p, q) => discOf(q).r - discOf(p).r)) {
      const disc = discOf(b)
      const labelW = Math.max(String(b.name || '').length, String(b.meta || '').length) * 8.9 + 6
      const labelH = 30
      const base = disc.r + labelH / 2 + 9
      const candidates = [[0, base], [0, -base], [base, 0], [-base, 0], [0, base * 1.7], [0, -base * 1.7], [base * 1.7, 0], [-base * 1.7, 0]]
      let chosen = candidates[0]
      for (const [dx, dy] of candidates) {
        const box = { x: b.x + dx, y: b.y + dy, w: labelW, h: labelH }
        if (box.x - labelW / 2 < 6 || box.x + labelW / 2 > W - 6 || box.y - labelH / 2 < 6 || box.y + labelH / 2 > H - 6) continue
        const onAnotherDisc = nonCore.some((o) => o !== b && !o.gone && Math.hypot(box.x - o.x, box.y - o.y) < labelH / 2 + discOf(o).r)
        if (onAnotherDisc) continue
        if (placedLabelBoxes.some((o) => boxesOverlap(box, o))) continue
        chosen = [dx, dy]
        break
      }
      placedLabelBoxes.push({ x: b.x + chosen[0], y: b.y + chosen[1], w: labelW, h: labelH })
      labelPlan.set(b, chosen)
    }

    for (const b of state.bodies) {
      ensureBodyEl(b)
      if (b.core) {
        const size = coreS
        b.el.style.left = cx + 'px'; b.el.style.top = cy + 'px'
        b.el.style.width = b.el.style.height = size + 'px'
        b.el.style.transform = 'translate(-50%,-50%)'
        b.el.style.opacity = dimAll ? '0.35' : '1'
        b.el.style.transition = 'opacity .5s ease'
        b.el.style.cursor = 'pointer'
        b._disc.style.cssText = 'width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(255,255,255,.20) 0%,rgba(40,208,248,.16) 42%,rgba(6,9,22,.85) 78%);border:1px solid rgba(140,220,255,.5);box-shadow:0 0 90px rgba(40,208,248,.5),0 0 180px rgba(168,80,248,.28),inset 0 1px 0 rgba(255,255,255,.4);backdrop-filter:blur(14px)'
        b._label.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none'
        b._name.style.cssText = `font-size:${Math.max(16, size * 0.13)}px;letter-spacing:.2em;color:#e7ecfb`
        b._name.textContent = 'BUSCAR'
        b._meta.style.cssText = 'display:none'
        b._ring.style.cssText = 'display:none'; b._surface.style.cssText = 'display:none'; b._cloud.style.cssText = 'display:none'; b._moonsWrap.style.cssText = 'display:none'
        continue
      }
      const size = unit * Math.max(0.045, Math.min(0.115, b.psize || 0.09))
      const dc = Math.hypot(b.x - cx, b.y - cy)
      const near = dc < unit * 0.13
      const ang = Math.atan2(cy - b.y, cx - b.x)
      const lightX = (50 + Math.cos(ang) * 30).toFixed(1)
      const lightY = (50 + Math.sin(ang) * 30).toFixed(1)
      const isThisLanded = (landedBody === b) || (b.kind === 'pagina' && state.landed === b.tabId)
      const dim = dimAll && !isThisLanded ? 0.28 : 1
      b.el.style.left = b.x + 'px'; b.el.style.top = b.y + 'px'
      b.el.style.width = b.el.style.height = size + 'px'
      b.el.style.transform = `translate(-50%,-50%) scale(${b.held ? 1.14 : 1})`
      b.el.style.opacity = String(dim)
      b.el.style.transition = 'opacity .5s ease'
      b.el.style.cursor = b.held ? 'grabbing' : 'grab'
      b._disc.style.cssText = `width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at ${lightX}% ${lightY}%,#ffffff 0%,${b.hue} 26%,${b.hue}bb 46%,rgba(8,12,26,.96) 78%);box-shadow:0 0 ${near || b.held ? 44 : 20}px ${b.hue}44,inset -6px -6px 22px rgba(2,4,12,.75)`
      {
        const [ldx, ldy] = labelPlan.get(b) || [0, size / 2 + 24]
        b._label.style.cssText = `position:absolute;left:calc(50% + ${ldx}px);top:calc(50% + ${ldy}px);transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none;white-space:nowrap`
      }
      b._name.style.cssText = 'font-size:11px;letter-spacing:.2em;color:#e7ecfb'
      b._name.textContent = b.name
      b._meta.style.cssText = 'font-size:9px;letter-spacing:.18em;color:#7c86a8'
      b._meta.textContent = b.meta || ''
      b._ring.style.cssText = `position:absolute;inset:-14%;border-radius:50%;border:1px solid ${b.hue}${near || b.held ? '88' : '22'};pointer-events:none`
      if (b.earth) {
        // Solo nubes reales — sin la mancha de "continentes" (se veía como una hoja verde
        // pegada encima, a pedido explícito).
        b._surface.style.cssText = 'display:none'
        b._cloud.style.cssText = `position:absolute;inset:1%;border-radius:50%;pointer-events:none;opacity:.34;transform:rotate(${-(b.rot || 0) * 0.6}rad);background:radial-gradient(24% 12% at 32% 40%,#ffffff,transparent 70%),radial-gradient(18% 10% at 62% 26%,#ffffff,transparent 70%);mix-blend-mode:screen`
      } else {
        // Cada planeta con su propia superficie — antes todos (menos Tierra) compartían la
        // misma textura genérica de rayas; ahora cada `id` tiene su propio patrón.
        b._surface.style.cssText = `position:absolute;inset:4%;border-radius:50%;pointer-events:none;overflow:hidden;transform:rotate(${b.rot || 0}rad);${SURFACE_STYLE[b.id] || SURFACE_STYLE._default}`
        b._cloud.style.cssText = 'display:none'
      }
      const moonDefs = MOONS[b.id] || []
      if (b._moonsWrap.childElementCount !== moonDefs.length) {
        clearChildren(b._moonsWrap)
        for (let k = 0; k < moonDefs.length; k++) el('div', 'position:absolute;border-radius:50%;pointer-events:none', b._moonsWrap)
      }
      for (let k = 0; k < moonDefs.length; k++) {
        const md = moonDefs[k]
        const d = Math.max(4, size * md.s)
        const mEl = b._moonsWrap.children[k]
        mEl.style.left = '50%'; mEl.style.top = '50%'
        mEl.style.width = mEl.style.height = d + 'px'
        mEl.style.margin = (-d / 2) + 'px'
        mEl.style.background = `radial-gradient(circle at 34% 32%,#f2f4fa,${md.c} 58%,rgba(6,10,20,.9))`
        mEl.style.boxShadow = '0 0 7px rgba(210,225,255,.35)'
        mEl.style.transform = `rotate(${(b.moon || 0) * md.v + k * 1.7}rad) translateX(${size * md.d}px)`
      }
    }

    // tethers
    const live = state.bodies.filter((b) => !b.core)
    if (tethersEl.childElementCount > live.length * live.length) clearChildren(tethersEl)
    let ti = 0
    for (let m = 0; m < live.length; m++) {
      for (let n = m + 1; n < live.length; n++) {
        const A = live[m], B = live[n]
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy)
        if (d > unit * 0.16) continue
        let line = tethersEl.children[ti]
        if (!line) line = el('div', null, tethersEl)
        ti++
        const angDeg = Math.atan2(dy, dx) * 180 / Math.PI
        line.style.cssText = `position:absolute;left:${A.x}px;top:${A.y}px;width:${d}px;height:2px;transform-origin:0 50%;transform:rotate(${angDeg}deg);background:linear-gradient(90deg,${A.hue},${B.hue});opacity:${(1 - d / (unit * 0.16)) * 0.85};box-shadow:0 0 16px ${A.hue};border-radius:2px`
      }
    }
    while (tethersEl.children.length > ti) tethersEl.lastChild.remove()

    // Baúl (Plutón) + Luna
    const vr = unit * 0.075, vx = W - vr - unit * 0.05, vy = H - vr - unit * 0.05
    moonEl.style.left = (vx - vr * 2.3) + 'px'; moonEl.style.top = vy + 'px'
    moonEl.style.width = moonEl.style.height = (vr * 1.05) + 'px'
    moonEl.style.transform = 'translate(-50%,-50%)'
  }

  const vaultEl = el('div', 'position:absolute;cursor:pointer;z-index:25', stage)
  const vaultDisc = el('div', 'width:100%;height:100%;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:radial-gradient(120% 120% at 32% 26%,rgba(90,140,220,.32),rgba(10,16,36,.95));border:2px solid rgba(140,200,255,.6);box-shadow:0 0 30px rgba(0,248,248,.3);backdrop-filter:blur(12px)', vaultEl)
  const vaultLabel1 = el('div', 'font-size:12px;letter-spacing:.14em;color:#ffffff;white-space:nowrap', vaultDisc); vaultLabel1.textContent = 'BAÚL'
  const vaultLabel2 = el('div', 'font-size:9px;letter-spacing:.14em;color:#8fa6d8;white-space:nowrap', vaultDisc); vaultLabel2.textContent = 'plutón'
  const vaultCount = el('div', 'font-size:12px;letter-spacing:.08em;color:#00f8f8;white-space:nowrap', vaultDisc)
  vaultEl.addEventListener('click', (e) => { e.stopPropagation(); openLanded('vault') })
  moonEl.addEventListener('click', (e) => { e.stopPropagation(); openAll() })

  function positionVault() {
    const W = stage.clientWidth, H = stage.clientHeight
    const unit = Math.max(320, Math.min(W, H))
    const vr = unit * 0.075, vx = W - vr - unit * 0.05, vy = H - vr - unit * 0.05
    vaultEl.style.left = vx + 'px'; vaultEl.style.top = vy + 'px'
    vaultEl.style.width = vaultEl.style.height = (vr * 2) + 'px'
    vaultEl.style.transform = 'translate(-50%,-50%)'
    vaultCount.textContent = String(state.extensions.filter((x) => !state.launchedExtIds.has(x.recordId)).length)
  }

  // ---------------------------------------------------------------------------------------
  // Render de overlays (búsqueda / aterrizado / mosaico / HUD)
  // ---------------------------------------------------------------------------------------
  function render() {
    const showingPage = typeof state.landed === 'number'
    const tab = showingPage ? state.tabsById.get(state.landed) : null
    headerEl.style.pointerEvents = showingPage ? 'auto' : 'none'
    headerEl.style.borderBottom = showingPage ? '1px solid rgba(140,180,255,.14)' : '1px solid transparent'
    headerEl.style.background = showingPage ? 'rgba(8,10,18,.92)' : 'transparent'
    headerEl.style.backdropFilter = showingPage ? 'blur(14px)' : 'none'
    headerAddressWrap.style.display = showingPage ? 'flex' : 'none'
    headerMoreBtn.style.display = showingPage ? 'flex' : 'none'
    headerBackBtn.style.display = showingPage ? 'flex' : 'none'
    if (tab && document.activeElement !== headerAddress) headerAddress.value = tab.url && !tab.url.startsWith('file://') ? tab.url : ''
    headerLogo.style.opacity = state.flight ? '0' : '1'

    const systemLanded = typeof state.landed === 'string'
    landedEl.style.display = systemLanded ? 'flex' : 'none'
    if (!systemLanded) landedActions.innerHTML = ''

    allEl.style.display = state.allOpen ? 'flex' : 'none'

    skyEl.style.background = systemLanded && state.byId.get(state.landed)
      ? `radial-gradient(70% 60% at 50% 46%,${state.byId.get(state.landed).hue}33 0%,transparent 70%)`
      : 'transparent'

    positionVault()
  }

  // ---------------------------------------------------------------------------------------
  // Datos reales en vivo
  // ---------------------------------------------------------------------------------------
  function applyTabsState(list) {
    state.tabsById = new Map(list.map((t) => [t.id, t]))
    rebuildBodiesArray()
    if (typeof state.landed === 'number' && !state.tabsById.has(state.landed)) {
      state.landed = null
      syncBrowserView()
    } else {
      const active = list.find((t) => t.isActive)
      if (typeof state.landed === 'number' && active && active.id !== state.landed) state.landed = active.id
    }
    if (state.landed === 'vuelo') openLanded('vuelo')
    render()
  }
  api.onTabsState(applyTabsState)
  api.onGroupsState((groups) => { state.groups = groups })
  api.onDownloadsState(() => { if (state.landed === 'aterrizajes') openLanded('aterrizajes') })

  async function initialLoad() {
    const [tabs, exts] = await Promise.all([
      safe(() => api.getTabsState(), []),
      safe(() => api.listExtensions(), []),
    ])
    state.extensions = exts
    applyTabsState(tabs)
    const active = tabs.find((t) => t.isActive)
    if (active) { state.landed = active.id; syncBrowserView(); render() }
  }

  // ---------------------------------------------------------------------------------------
  // Bucle principal
  // ---------------------------------------------------------------------------------------
  function tick(t) {
    const dt = Math.min(48, t - (state.lastFrame || t))
    state.lastFrame = t
    const W = stage.clientWidth || window.innerWidth
    const H = stage.clientHeight || window.innerHeight
    const cx = W / 2, cy = H / 2, unit = Math.max(320, Math.min(W, H))
    for (const b of state.bodies) {
      if (b.core) { b.x = cx; b.y = cy; b.rot = (b.rot || 0) + 0.00004 * dt; continue }
      if (b.held) continue
      b.a += b.spin * dt
      b.wob += 0.0009 * dt
      const rr = b.r + Math.sin(b.wob) * 0.008
      b.x = cx + Math.cos(b.a) * rr * W * 0.92
      b.y = cy + Math.sin(b.a) * rr * H * 0.86
      b.moon = (b.moon || 0) + 0.0022 * dt
      b.rot = (b.rot || 0) + (b.axis || 0.0004) * dt
    }
    tickMeteors(dt, W, H)
    renderFrame(W, H, cx, cy, unit)
    state.raf = requestAnimationFrame(tick)
  }

  rebuildBodiesArray()
  render()
  initialLoad()
  state.raf = requestAnimationFrame(tick)
})()
