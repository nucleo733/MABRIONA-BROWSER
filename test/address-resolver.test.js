'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveAddressInput, HOME_URL, RESULTS_URL } = require('../address-resolver')

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
