'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildRequest, normalizeResults, normalizeInfobox, normalizeVideos, normalizeFaq, BRAVE_ENDPOINT } = require('../search/braveSearch')

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

test('normalizeInfobox extrae una entidad real (persona) con atributos y perfiles', () => {
  const data = {
    infobox: {
      results: [
        {
          title: 'Romeo Santos',
          category: 'person',
          description: 'American singer',
          long_desc: 'Anthony "Romeo" Santos...',
          url: 'https://en.wikipedia.org/wiki/Romeo_Santos',
          attributes: [['Born', '1981-07-21'], ['Genres', 'Bachata']],
          profiles: [{ name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Romeo_Santos', img: 'https://x.com/icon.png' }],
        },
      ],
    },
  }
  const box = normalizeInfobox(data)
  assert.equal(box.title, 'Romeo Santos')
  assert.equal(box.category, 'person')
  assert.deepEqual(box.attributes[0], { label: 'Born', value: '1981-07-21' })
  assert.deepEqual(box.profiles[0], { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Romeo_Santos', icon: 'https://x.com/icon.png' })
})

test('normalizeInfobox devuelve null cuando Brave no manda entidad (nunca inventa una)', () => {
  assert.equal(normalizeInfobox({}), null)
  assert.equal(normalizeInfobox({ infobox: { results: [] } }), null)
  assert.equal(normalizeInfobox({ infobox: { results: [{}] } }), null) // sin título no cuenta
  assert.equal(normalizeInfobox(null), null)
})

test('normalizeInfobox no rompe si attributes/profiles vienen con forma rara', () => {
  const data = { infobox: { results: [{ title: 'X', attributes: 'no-es-array', profiles: null }] } }
  const box = normalizeInfobox(data)
  assert.deepEqual(box.attributes, [])
  assert.deepEqual(box.profiles, [])
})

test('normalizeVideos extrae título/url/miniatura/duración/fuente de una respuesta real', () => {
  const data = {
    videos: {
      results: [
        {
          title: 'Video real',
          url: 'https://www.youtube.com/watch?v=abc',
          thumbnail: { src: 'https://img.example/thumb.jpg' },
          video: { duration: '05:03', publisher: 'YouTube' },
        },
      ],
    },
  }
  assert.deepEqual(normalizeVideos(data), [
    { title: 'Video real', url: 'https://www.youtube.com/watch?v=abc', thumbnail: 'https://img.example/thumb.jpg', duration: '05:03', source: 'YouTube' },
  ])
})

test('normalizeVideos descarta resultados sin título o sin url, y no rompe sin datos', () => {
  assert.deepEqual(normalizeVideos({}), [])
  assert.deepEqual(normalizeVideos({ videos: { results: [{ title: 'sin url' }] } }), [])
})

test('normalizeInfobox descarta filas separadoras de sección (value null) — regresión de un bug real', () => {
  // Forma real observada consultando la API de Brave con "eiffel tower" / "tesla model 3": la
  // tabla de Wikipedia trae encabezados de sub-sección como par [label, null]. Antes se convertían
  // en un atributo falso de valor literal "null" (String(null)).
  const data = {
    infobox: {
      results: [
        {
          title: 'Eiffel Tower',
          attributes: [
            ['<span><strong>General information</strong></span>', null],
            ['Location', 'Paris, France'],
            ['Height', ''],
          ],
        },
      ],
    },
  }
  const box = normalizeInfobox(data)
  assert.deepEqual(box.attributes, [{ label: 'Location', value: 'Paris, France' }])
})

test('normalizeFaq extrae pregunta/respuesta/fuente de una respuesta real', () => {
  const data = {
    faq: {
      results: [
        {
          question: '¿Quién es Romeo Santos?',
          answer: '<p>Cantante de bachata.</p>',
          title: 'Romeo Santos - Biografía',
          url: 'https://es.wikipedia.org/wiki/Romeo_Santos',
          meta_url: { hostname: 'es.wikipedia.org' },
        },
      ],
    },
  }
  assert.deepEqual(normalizeFaq(data), [
    {
      question: '¿Quién es Romeo Santos?',
      answer: '<p>Cantante de bachata.</p>',
      sourceTitle: 'Romeo Santos - Biografía',
      sourceUrl: 'https://es.wikipedia.org/wiki/Romeo_Santos',
      sourceHost: 'es.wikipedia.org',
    },
  ])
})

test('normalizeFaq devuelve [] cuando Brave no manda FAQ para esa búsqueda (nunca inventa una pregunta)', () => {
  assert.deepEqual(normalizeFaq({}), [])
  assert.deepEqual(normalizeFaq({ faq: {} }), [])
  assert.deepEqual(normalizeFaq(null), [])
})

test('normalizeFaq descarta entradas sin pregunta o sin respuesta, y no rompe con forma rara', () => {
  const data = { faq: { results: [{ question: 'sin respuesta' }, { answer: 'sin pregunta' }, 'no-es-objeto'] } }
  assert.deepEqual(normalizeFaq(data), [])
})
