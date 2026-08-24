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
  query: (text) => ipcRenderer.invoke('search:query', text),
})
