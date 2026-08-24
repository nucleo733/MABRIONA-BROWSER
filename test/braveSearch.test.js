'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildRequest,
  buildImagesRequest,
  normalizeResults,
  normalizeInfobox,
  normalizeVideos,
  normalizeFaq,
  normalizeNews,
  normalizeLocations,
  normalizeImages,
  BRAVE_ENDPOINT,
  IMAGES_ENDPOINT,
} = require('../search/braveSearch')

test('buildRequest sin opciones no agrega freshness (compatibilidad con las llamadas de Etapas 1-4)', () => {
  const { url } = buildRequest('bachata', 'fake-key')
  assert.ok(!url.includes('freshness'))
})

test('buildRequest agrega freshness real cuando se pide un valor válido (día/semana/mes/año — verificado que cambian los resultados de verdad)', () => {
  assert.ok(buildRequest('x', 'k', { freshness: 'pd' }).url.endsWith('&freshness=pd'))
  assert.ok(buildRequest('x', 'k', { freshness: 'pw' }).url.endsWith('&freshness=pw'))
  assert.ok(buildRequest('x', 'k', { freshness: 'pm' }).url.endsWith('&freshness=pm'))
  assert.ok(buildRequest('x', 'k', { freshness: 'py' }).url.endsWith('&freshness=py'))
})

test('buildRequest descarta un freshness inválido en vez de mandarlo tal cual a la API', () => {
  const { url } = buildRequest('x', 'k', { freshness: 'algo-inventado' })
  assert.ok(!url.includes('freshness'))
})

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

test('buildImagesRequest arma la URL del endpoint dedicado de imágenes con la key como header', () => {
  const { url, headers } = buildImagesRequest('bachata', 'MI-KEY')
  assert.equal(url, `${IMAGES_ENDPOINT}?q=${encodeURIComponent('bachata')}`)
  assert.ok(!url.includes('MI-KEY'))
  assert.equal(headers['X-Subscription-Token'], 'MI-KEY')
})

test('normalizeNews extrae título/url/descripción/fecha/fuente de una respuesta real (embebida, misma llamada)', () => {
  const data = {
    news: {
      results: [
        {
          title: 'Noticia real',
          url: 'https://people.com/n',
          description: 'Texto <strong>real</strong>',
          age: '3 hours ago',
          meta_url: { hostname: 'people.com' },
          thumbnail: { src: 'https://imgs.search.brave.com/thumb.jpg' },
        },
      ],
    },
  }
  assert.deepEqual(normalizeNews(data), [
    {
      title: 'Noticia real',
      url: 'https://people.com/n',
      description: 'Texto <strong>real</strong>',
      age: '3 hours ago',
      source: 'people.com',
      thumbnail: 'https://imgs.search.brave.com/thumb.jpg',
    },
  ])
})

test('normalizeNews no rompe sin datos y descarta entradas sin título/url', () => {
  assert.deepEqual(normalizeNews({}), [])
  assert.deepEqual(normalizeNews({ news: { results: [{ title: 'sin url' }] } }), [])
})

test('normalizeLocations extrae un lugar real (forma real de "starbucks nueva york")', () => {
  const data = {
    locations: {
      results: [
        {
          title: 'Starbucks',
          url: 'https://starbucks.com/store-locator/store/18526',
          postal_address: { displayAddress: '291 Broadway, New York, NY 10007' },
          contact: { telephone: '+12124065315' },
          rating: { ratingValue: 3.9, reviewCount: 74 },
          opening_hours: { current_day: [{ opens: '06:00', closes: '18:00' }] },
          thumbnail: { src: 'https://imgs.search.brave.com/thumb.jpg' },
        },
      ],
    },
  }
  assert.deepEqual(normalizeLocations(data), [
    {
      title: 'Starbucks',
      url: 'https://starbucks.com/store-locator/store/18526',
      address: '291 Broadway, New York, NY 10007',
      phone: '+12124065315',
      rating: 3.9,
      ratingCount: 74,
      todayHours: '06:00 – 18:00',
      thumbnail: 'https://imgs.search.brave.com/thumb.jpg',
    },
  ])
})

test('normalizeLocations no rompe sin datos ni con horario/rating ausente', () => {
  assert.deepEqual(normalizeLocations({}), [])
  const data = { locations: { results: [{ title: 'Lugar sin más datos', url: 'https://x.com' }] } }
  assert.deepEqual(normalizeLocations(data), [
    { title: 'Lugar sin más datos', url: 'https://x.com', address: null, phone: null, rating: null, ratingCount: null, todayHours: null, thumbnail: null },
  ])
})

test('normalizeImages extrae título/url/fuente/miniatura/dimensiones del endpoint dedicado real', () => {
  const data = {
    results: [
      {
        title: 'Romeo Santos en concierto',
        url: 'https://www.gettyimages.com/photos/romeo-santos-photos',
        source: 'gettyimages.com',
        thumbnail: { src: 'https://imgs.search.brave.com/thumb.jpg' },
        properties: { width: 500, height: 599 },
      },
    ],
  }
  assert.deepEqual(normalizeImages(data), [
    {
      title: 'Romeo Santos en concierto',
      url: 'https://www.gettyimages.com/photos/romeo-santos-photos',
      source: 'gettyimages.com',
      thumbnail: 'https://imgs.search.brave.com/thumb.jpg',
      width: 500,
      height: 599,
    },
  ])
})

test('normalizeImages descarta resultados sin thumbnail real (nunca muestra una imagen rota) y no rompe sin datos', () => {
  assert.deepEqual(normalizeImages({}), [])
  assert.deepEqual(normalizeImages({ results: [{ title: 'X', url: 'https://x.com' }] }), [])
})
