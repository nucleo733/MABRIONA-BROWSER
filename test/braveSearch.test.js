'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildRequest, normalizeResults, BRAVE_ENDPOINT } = require('../search/braveSearch')

test('buildRequest arma la URL con la query codificada', () => {
  const { url } = buildRequest('bachata dominicana', 'fake-key')
  assert.equal(url, `${BRAVE_ENDPOINT}?q=${encodeURIComponent('bachata dominicana')}`)
})

test('buildRequest manda la API key como header, nunca en la URL', () => {
  const { url, headers } = buildRequest('mabriona', 'MI-KEY-SECRETA')
  assert.ok(!url.includes('MI-KEY-SECRETA'))
  assert.equal(headers['X-Subscription-Token'], 'MI-KEY-SECRETA')
})

test('normalizeResults extrae título/url/descripción de una respuesta real', () => {
  const data = {
    web: {
      results: [
        { title: 'Bachata - Wikipedia', url: 'https://es.wikipedia.org/wiki/Bachata', description: 'Género musical...' },
        { title: 'MABRIONA', url: 'https://mabriona-studio.vercel.app', description: 'Plataforma musical' },
      ],
    },
  }
  const results = normalizeResults(data)
  assert.equal(results.length, 2)
  assert.deepEqual(results[0], { title: 'Bachata - Wikipedia', url: 'https://es.wikipedia.org/wiki/Bachata', description: 'Género musical...' })
})

test('normalizeResults descarta resultados sin título o sin url', () => {
  const data = { web: { results: [{ title: 'Sin url' }, { url: 'https://sin-titulo.com' }, { title: 'OK', url: 'https://ok.com' }] } }
  assert.deepEqual(normalizeResults(data), [{ title: 'OK', url: 'https://ok.com', description: '' }])
})

test('normalizeResults no rompe con una respuesta vacía/inesperada', () => {
  assert.deepEqual(normalizeResults({}), [])
  assert.deepEqual(normalizeResults(null), [])
  assert.deepEqual(normalizeResults({ web: {} }), [])
  assert.deepEqual(normalizeResults({ web: { results: null } }), [])
})

test('normalizeResults completa la descripción vacía si no viene', () => {
  const data = { web: { results: [{ title: 'X', url: 'https://x.com' }] } }
  assert.equal(normalizeResults(data)[0].description, '')
})
