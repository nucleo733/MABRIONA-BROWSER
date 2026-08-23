'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { isBlockedHost, AD_TRACKER_DOMAINS } = require('../shields/blocklist')

test('bloquea un dominio exacto de la lista', () => {
  assert.equal(isBlockedHost('doubleclick.net'), true)
})

test('bloquea un subdominio de un dominio de la lista', () => {
  assert.equal(isBlockedHost('stats.g.doubleclick.net'), true)
})

test('no bloquea un dominio legítimo cualquiera', () => {
  assert.equal(isBlockedHost('wikipedia.org'), false)
})

test('no bloquea un dominio parecido pero distinto (no debe hacer match parcial de substring)', () => {
  assert.equal(isBlockedHost('notdoubleclick.net'), false)
})

test('no bloquea youtube.com a propósito (los anuncios de YouTube viajan por el canal del video, no se tocan acá)', () => {
  assert.equal(isBlockedHost('youtube.com'), false)
  assert.equal(isBlockedHost('www.youtube.com'), false)
  assert.equal(isBlockedHost('googlevideo.com'), false)
})

test('hostname vacío/nulo no rompe, devuelve false', () => {
  assert.equal(isBlockedHost(null), false)
  assert.equal(isBlockedHost(''), false)
  assert.equal(isBlockedHost(undefined), false)
})

test('la lista no está vacía y tiene dominios reales conocidos', () => {
  assert.ok(AD_TRACKER_DOMAINS.length > 30)
  assert.ok(AD_TRACKER_DOMAINS.includes('googlesyndication.com'))
  assert.ok(AD_TRACKER_DOMAINS.includes('facebook.net'))
})

test('la comparación no distingue mayúsculas/minúsculas', () => {
  assert.equal(isBlockedHost('DoubleClick.NET'), true)
})
