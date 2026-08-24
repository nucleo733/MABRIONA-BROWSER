'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildContextGraph, extractRelatedEntities } = require('../search/contextGraph')

function baseInfobox(overrides = {}) {
  return {
    title: 'Romeo Santos',
    category: 'person',
    description: '',
    longDescription: '',
    sourceUrl: 'https://en.wikipedia.org/wiki/Romeo_Santos',
    attributes: [],
    profiles: [],
    ...overrides,
  }
}

test('buildContextGraph devuelve null si no hay entidad reconocida (sin infobox no hay centro)', () => {
  assert.equal(buildContextGraph({ infobox: null }), null)
  assert.equal(buildContextGraph({}), null)
})

test('buildContextGraph devuelve null si hay entidad pero ninguna relación real — la ausencia es válida', () => {
  const graph = buildContextGraph({ infobox: baseInfobox({ sourceUrl: null, profiles: [], attributes: [] }) })
  assert.equal(graph, null)
})

test('buildContextGraph arma la relación "source" real con confianza high', () => {
  const graph = buildContextGraph({ infobox: baseInfobox() })
  assert.equal(graph.center.label, 'Romeo Santos')
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].type, 'source')
  assert.equal(graph.edges[0].confidence, 'high')
  assert.equal(graph.edges[0].target.url, 'https://en.wikipedia.org/wiki/Romeo_Santos')
})

test('buildContextGraph arma perfiles reales como relaciones profile_of, confianza high', () => {
  const graph = buildContextGraph({
    infobox: baseInfobox({
      sourceUrl: null,
      profiles: [
        { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Romeo_Santos', icon: null },
        { name: 'YouTube', url: 'https://youtube.com/romeosantos', icon: null },
      ],
    }),
  })
  assert.equal(graph.edges.length, 2)
  for (const edge of graph.edges) {
    assert.equal(edge.type, 'profile_of')
    assert.equal(edge.confidence, 'high')
  }
})

test('extractRelatedEntities extrae enlaces reales dentro de un atributo (forma real de Apple Inc.)', () => {
  const attributes = [
    {
      label: 'Founders',
      value:
        "<a href='https://en.wikipedia.org/wiki/Steve_Jobs'>Steve Jobs</a><br><a href='https://en.wikipedia.org/wiki/Steve_Wozniak'>Steve Wozniak</a>",
    },
  ]
  const related = extractRelatedEntities(attributes)
  assert.deepEqual(related, [
    { url: 'https://en.wikipedia.org/wiki/Steve_Jobs', name: 'Steve Jobs', relationLabel: 'Founders' },
    { url: 'https://en.wikipedia.org/wiki/Steve_Wozniak', name: 'Steve Wozniak', relationLabel: 'Founders' },
  ])
})

test('extractRelatedEntities no rompe con atributos sin enlaces ni con forma rara', () => {
  assert.deepEqual(extractRelatedEntities([{ label: 'Born', value: '1981-07-21' }]), [])
  assert.deepEqual(extractRelatedEntities([{ label: 'X', value: null }]), [])
  assert.deepEqual(extractRelatedEntities([]), [])
})

test('buildContextGraph usa los enlaces reales de attributes como relaciones entidad-a-entidad, confianza high', () => {
  const graph = buildContextGraph({
    infobox: baseInfobox({
      sourceUrl: null,
      attributes: [{ label: 'Founders', value: "<a href='https://en.wikipedia.org/wiki/Steve_Jobs'>Steve Jobs</a>" }],
    }),
  })
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].type, 'Founders')
  assert.equal(graph.edges[0].confidence, 'high')
  assert.equal(graph.edges[0].target.label, 'Steve Jobs')
  assert.equal(graph.edges[0].origin, 'infobox.attributes')
})

test('buildContextGraph nunca produce confianza "low"', () => {
  const graph = buildContextGraph({
    infobox: baseInfobox(),
    faq: [{ question: '¿Q?', answer: 'A', sourceUrl: 'https://x.com/faq', sourceHost: 'x.com', sourceTitle: null }],
    videos: [{ title: 'V', url: 'https://youtube.com/v', thumbnail: null, duration: null, source: null }],
  })
  for (const edge of graph.edges) {
    assert.ok(edge.confidence === 'high' || edge.confidence === 'medium')
  }
})

test('buildContextGraph: FAQ/video/noticias/discusiones quedan con confianza medium, nunca high, y requieren infobox', () => {
  const graph = buildContextGraph({
    infobox: baseInfobox({ sourceUrl: null }),
    faq: [{ question: '¿Q?', answer: 'A', sourceUrl: 'https://ticketmaster.com/faq', sourceHost: 'ticketmaster.com', sourceTitle: null }],
    videos: [{ title: 'V', url: 'https://youtube.com/v', thumbnail: null, duration: null, source: 'YouTube' }],
    news: [{ title: 'N', url: 'https://people.com/n', source: 'people.com' }],
    discussions: [{ title: 'D', url: 'https://reddit.com/d', forum: 'r/Music' }],
  })
  const types = graph.edges.map((e) => e.type)
  assert.deepEqual(types.sort(), ['answer_source', 'related_discussion', 'related_news', 'related_video'])
  for (const edge of graph.edges) assert.equal(edge.confidence, 'medium')
})

test('buildContextGraph no duplica nodos que apuntan a la misma URL', () => {
  const graph = buildContextGraph({
    infobox: baseInfobox({
      sourceUrl: 'https://en.wikipedia.org/wiki/Romeo_Santos',
      profiles: [{ name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Romeo_Santos', icon: null }],
    }),
  })
  // sourceUrl y el perfil de Wikipedia apuntan a la misma URL real — un solo nodo, no dos.
  assert.equal(graph.edges.length, 1)
})

test('buildContextGraph respeta el límite total de nodos aunque haya muchas relaciones reales disponibles', () => {
  const manyProfiles = Array.from({ length: 10 }, (_, i) => ({ name: `Perfil ${i}`, url: `https://x.com/${i}`, icon: null }))
  const manyAttrs = Array.from({ length: 10 }, (_, i) => ({
    label: 'Related',
    value: `<a href='https://en.wikipedia.org/wiki/Entity_${i}'>Entity ${i}</a>`,
  }))
  const graph = buildContextGraph({
    infobox: baseInfobox({ sourceUrl: 'https://en.wikipedia.org/wiki/Romeo_Santos', profiles: manyProfiles, attributes: manyAttrs }),
    faq: [{ question: '1', answer: 'a', sourceUrl: 'https://f1.com', sourceHost: null, sourceTitle: null }],
    videos: [{ title: 'v', url: 'https://v1.com', thumbnail: null, duration: null, source: null }],
    news: [{ title: 'n', url: 'https://n1.com', source: null }],
    discussions: [{ title: 'd', url: 'https://d1.com', forum: null }],
  })
  assert.ok(graph.edges.length <= 8, `esperaba <=8 nodos, encontré ${graph.edges.length}`)
})

test('buildContextGraph con una entidad real sin ningún dato relacional adicional (ni source) no rompe', () => {
  assert.equal(buildContextGraph({ infobox: baseInfobox({ sourceUrl: null }) }), null)
})
