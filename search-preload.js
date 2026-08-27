'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * Puente seguro para la página de resultados propia de MABRIONA — la
 * única capacidad que expone es "pedile al proceso principal que
 * busque esto", nunca la API key en sí (esa vive solo en main.js).
 * Se instala en TODAS las pestañas (no solo results.html): es
 * inofensivo en cualquier sitio real, contextIsolation impide que la
 * página toque nada más allá de esta única función.
 */
contextBridge.exposeInMainWorld('mabrionaSearch', {
  query: (text, freshness) => ipcRenderer.invoke('search:query', { text, freshness }),
  // Perezoso a propósito: solo se llama cuando el usuario abre la pestaña Imágenes (ver
  // renderer/results.js) — Brave no incluye imágenes en la respuesta de `query`, así que pedirlas
  // siempre en cada búsqueda gastaría cupo de la cuenta sin necesidad.
  images: (text) => ipcRenderer.invoke('search:images', text),
})

/**
 * Segundo puente, separado a propósito — los accesos directos de la Nueva Pestaña (sitios más
 * visitados, real, calculado del historial real). Igual que el de arriba, se instala en TODAS las
 * pestañas — pero esto SÍ toca datos sensibles (el historial real), así que la verificación real
 * de que quien pide esto es de verdad `newtab.html` vive del lado seguro, en main.js (nunca hay
 * que confiar en que la página se autolimite) — cualquier otro sitio que llame a esto recibe una
 * lista vacía, nunca el historial real.
 */
contextBridge.exposeInMainWorld('mabrionaNewTab', {
  getTopSites: () => ipcRenderer.invoke('newtab:top-sites'),
})

/**
 * Contraseñas reales — captura y autocompletado. Nada de esto se expone a `window` (la página no
 * tiene forma de invocarlo ni de leerlo): son simples listeners nativos del propio preload sobre
 * el DOM real de la página, igual que cualquier extensión de gestor de contraseñas real. El texto
 * plano de la contraseña sale de acá solo por IPC hacia el proceso principal — nunca se guarda ni
 * se loguea en este archivo.
 */
document.addEventListener('submit', (e) => {
  const form = e.target
  if (!(form instanceof HTMLFormElement)) return
  const passwordInput = form.querySelector('input[type="password"]')
  if (!passwordInput || !passwordInput.value) return
  const usernameInput = form.querySelector('input[type="email"], input[type="text"]')
  ipcRenderer.send('passwords:capture', {
    // Se manda la URL completa, no `location.origin` — Node (que valida esto del lado de main.js)
    // y Chromium calculan el origen distinto para casos raros como `file://`; usando la URL cruda
    // y dejando que main.js calcule el origen con el mismo parser en los dos lados (captura y
    // autocompletado), nunca hay un desacople real entre cómo se guardó y cómo se busca.
    url: location.href,
    username: usernameInput ? usernameInput.value : '',
    password: passwordInput.value,
  })
}, true)

function findField(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return null
}
function fillField(el, value) {
  if (!el || !value) return
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

window.addEventListener('DOMContentLoaded', async () => {
  const passwordInput = document.querySelector('input[type="password"]')
  if (passwordInput) {
    const creds = await ipcRenderer.invoke('passwords:for-autofill').catch(() => null)
    if (creds) {
      fillField(passwordInput, creds.password)
      if (creds.username) fillField(document.querySelector('input[type="email"], input[type="text"]'), creds.username)
    }
  }

  // Direcciones/tarjetas — se buscan por el atributo real `autocomplete` (el estándar HTML que
  // los sitios usan para esto) primero, con un respaldo por `name`/`type` para sitios que no lo
  // declaran. No adivina qué campo es sin ninguna de las dos señales — mejor no llenar nada que
  // llenar el campo equivocado.
  const { address, card } = await ipcRenderer.invoke('autofill:for-fill').catch(() => ({ address: null, card: null }))
  if (address) {
    fillField(findField(['[autocomplete="name"]', 'input[name*="name" i]:not([type="password"])']), address.name)
    fillField(findField(['[autocomplete="email"]', 'input[type="email"]']), address.email)
    fillField(findField(['[autocomplete="tel"]', 'input[type="tel"]']), address.phone)
    fillField(findField(['[autocomplete="street-address"]', '[autocomplete="address-line1"]', 'input[name*="address" i]']), address.address)
    fillField(findField(['[autocomplete="address-level2"]', 'input[name*="city" i]']), address.city)
    fillField(findField(['[autocomplete="postal-code"]', 'input[name*="zip" i]', 'input[name*="postal" i]']), address.zip)
    fillField(findField(['[autocomplete="country"]', 'input[name*="country" i]']), address.country)
  }
  if (card) {
    fillField(findField(['[autocomplete="cc-name"]']), card.cardholder)
    fillField(findField(['[autocomplete="cc-number"]', 'input[name*="card" i][name*="number" i]']), card.number)
    fillField(findField(['[autocomplete="cc-exp"]', 'input[name*="expiry" i]', 'input[name*="exp" i]']), card.expiry)
  }
})
