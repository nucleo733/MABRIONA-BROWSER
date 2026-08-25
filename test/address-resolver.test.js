'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveAddressInput, HOME_URL, RESULTS_URL, EXTERNAL_ENGINES } = require('../address-resolver')

test('string vacío va a la página de inicio', () => {
  assert.equal(resolveAddressInput(''), HOME_URL)
  assert.equal(resolveAddressInput('   '), HOME_URL)
})

test('una URL completa (con esquema) se respeta tal cual', () => {
  assert.equal(resolveAddressInput('https://wikipedia.org'), 'https://wikipedia.org')
  assert.equal(resolveAddressInput('http://example.com/path'), 'http://example.com/path')
})

test('un dominio sin esquema se le agrega https://', () => {
  assert.equal(resolveAddressInput('wikipedia.org'), 'https://wikipedia.org')
  assert.equal(resolveAddressInput('mabriona-studio.vercel.app'), 'https://mabriona-studio.vercel.app')
})

test('un dominio con ruta sin esquema también funciona', () => {
  assert.equal(resolveAddressInput('wikipedia.org/wiki/Test'), 'https://wikipedia.org/wiki/Test')
})

test('texto que no parece un dominio se busca en la página de resultados propia de MABRIONA', () => {
  assert.equal(resolveAddressInput('bachata dominicana'), `${RESULTS_URL}?q=${encodeURIComponent('bachata dominicana')}`)
})

test('texto de una sola palabra sin punto se busca, no se trata como dominio', () => {
  assert.equal(resolveAddressInput('noticias'), `${RESULTS_URL}?q=noticias`)
})

test('caracteres especiales en la búsqueda se codifican bien', () => {
  const result = resolveAddressInput('c++ vs rust?')
  assert.ok(result.startsWith(`${RESULTS_URL}?q=`))
  assert.equal(decodeURIComponent(result.split('q=')[1]), 'c++ vs rust?')
})

test('sin motor elegido (o "mabriona"), una búsqueda va a la página propia — default real, no forzado', () => {
  assert.equal(resolveAddressInput('gatos', 'mabriona'), `${RESULTS_URL}?q=gatos`)
  assert.equal(resolveAddressInput('gatos'), `${RESULTS_URL}?q=gatos`) // sin segundo argumento, mismo comportamiento de siempre
})

test('con un motor externo elegido, la búsqueda va a la URL real de ese motor — MABRIONA nunca es la única opción', () => {
  assert.equal(resolveAddressInput('gatos', 'google'), 'https://www.google.com/search?q=gatos')
  assert.equal(resolveAddressInput('gatos', 'bing'), 'https://www.bing.com/search?q=gatos')
  assert.equal(resolveAddressInput('gatos', 'duckduckgo'), 'https://duckduckgo.com/?q=gatos')
  assert.equal(resolveAddressInput('gatos', 'brave'), 'https://search.brave.com/search?q=gatos')
})

test('un dominio real sigue yendo directo, sin importar el motor elegido — el motor solo aplica a búsquedas', () => {
  assert.equal(resolveAddressInput('wikipedia.org', 'google'), 'https://wikipedia.org')
})

test('los 5 motores reales existen y ninguno está roto/vacío', () => {
  assert.deepEqual(Object.keys(EXTERNAL_ENGINES).sort(), ['bing', 'brave', 'duckduckgo', 'google'])
  for (const build of Object.values(EXTERNAL_ENGINES)) assert.ok(build('q').startsWith('https://'))
})
