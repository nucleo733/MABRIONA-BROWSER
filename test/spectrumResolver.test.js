'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveSpectrum, MAX_VISIBLE_TABS } = require('../search/spectrumResolver')

function web(n) { return Array.from({ length: n }, (_, i) => ({ title: `w${i}`, url: `https://w${i}.com` })) }
function video(n, short = false) { return Array.from({ length: n }, (_, i) => ({ title: `v${i}`, url: `https://v${i}.com`, isShortForm: short })) }
function news(n) { return Array.from({ length: n }, (_, i) => ({ title: `n${i}`, url: `https://n${i}.com` })) }
function place(n) { return Array.from({ length: n }, (_, i) => ({ title: `p${i}`, url: `https://p${i}.com` })) }

test('sin ningún dato real (ni siquiera web) no arma Spectrum — Imágenes sola no cuenta', () => {
  const result = resolveSpectrum({})
  assert.deepEqual(result, { tabs: [], overflow: [] })
})

test('consulta general con solo web: Todo + Web + Imágenes (candidata fija)', () => {
  const result = resolveSpectrum({ web: web(5) })
  assert.deepEqual(result.tabs.map((t) => t.id), ['todo', 'web', 'images'])
})

test('búsqueda de lugar (Places, sin infobox por la exclusión mutua ya auditada): Lugares queda antes que Web', () => {
  const result = resolveSpectrum({ web: web(5), locations: place(4) })
  const ids = result.tabs.map((t) => t.id)
  assert.ok(ids.indexOf('places') < ids.indexOf('web'), `esperaba Lugares antes que Web: ${ids}`)
})

test('búsqueda de actualidad (3+ noticias reales) sube Noticias por encima de Web', () => {
  const result = resolveSpectrum({ web: web(5), news: news(4) })
  const ids = result.tabs.map((t) => t.id)
  assert.ok(ids.indexOf('news') < ids.indexOf('web'), `esperaba Noticias antes que Web con 4 noticias reales: ${ids}`)
})

test('con pocas noticias (menos de 3) Noticias queda detrás de Web — no toda mención de noticias es "de actualidad"', () => {
  const result = resolveSpectrum({ web: web(5), news: news(1) })
  const ids = result.tabs.map((t) => t.id)
  assert.ok(ids.indexOf('news') > ids.indexOf('web'), `esperaba Noticias detrás de Web con solo 1 noticia: ${ids}`)
})

test('video real se separa de Cortos por evidencia real de URL, ambos aparecen si hay de los dos', () => {
  const result = resolveSpectrum({ web: web(5), videos: [...video(2, false), ...video(2, true)] })
  const ids = result.tabs.map((t) => t.id)
  assert.ok(ids.includes('video'))
  assert.ok(ids.includes('shorts'))
})

test('herramienta real (calculadora) queda primera — es la respuesta más directa posible', () => {
  const result = resolveSpectrum({ web: web(5), tool: { type: 'calculator', expression: '2+2', result: 4 } })
  assert.equal(result.tabs[1].id, 'tools')
})

test('muchas categorías reales: las que exceden el máximo visible van a "overflow" (Más)', () => {
  const result = resolveSpectrum({
    web: web(5),
    videos: [...video(2, false), ...video(2, true)],
    news: news(4),
    locations: place(2),
    tool: { type: 'datetime', now: new Date().toISOString() },
  })
  assert.ok(result.tabs.length <= MAX_VISIBLE_TABS + 1, `Todo + máximo ${MAX_VISIBLE_TABS} pestañas visibles, encontré ${result.tabs.length}`)
  assert.ok(result.overflow.length > 0, 'con 6 categorías reales + Imágenes esperaba overflow')
  const allIds = [...result.tabs.map((t) => t.id), ...result.overflow.map((t) => t.id)]
  assert.deepEqual(new Set(allIds).size, allIds.length, 'no debe haber pestañas duplicadas entre visibles y overflow')
})

test('Imágenes siempre es candidata (ciega, se autorregula del lado del cliente) mientras haya algo más real', () => {
  const result = resolveSpectrum({ web: web(1) })
  assert.ok(result.tabs.some((t) => t.id === 'images'))
})
