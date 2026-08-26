'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { LANGUAGES, apiBaseFor, buildTranslateRequest, normalizeTranslateResponse } = require('../translate/deeplTranslate')

test('LANGUAGES: trae la lista real de idiomas destino de DeepL, con código y nombre', () => {
  assert.ok(LANGUAGES.length > 25)
  assert.ok(LANGUAGES.some((l) => l.code === 'ES' && l.name === 'Español'))
  assert.ok(LANGUAGES.every((l) => l.code && l.name))
})

test('apiBaseFor: una key gratuita real (termina en ":fx") usa el host free real de DeepL', () => {
  assert.equal(apiBaseFor('abc123:fx'), 'https://api-free.deepl.com')
})

test('apiBaseFor: una key paga real (sin ":fx") usa el host pago real de DeepL', () => {
  assert.equal(apiBaseFor('abc123xyz'), 'https://api.deepl.com')
})

test('buildTranslateRequest: arma la URL, el header de autorización real y el body real con los textos y el idioma', () => {
  const { url, headers, body } = buildTranslateRequest(['Hola', 'Mundo'], 'EN-US', 'realkey:fx')
  assert.equal(url, 'https://api-free.deepl.com/v2/translate')
  assert.equal(headers.Authorization, 'DeepL-Auth-Key realkey:fx')
  assert.deepEqual(JSON.parse(body), { text: ['Hola', 'Mundo'], target_lang: 'EN-US' })
})

test('normalizeTranslateResponse: extrae el texto traducido real en el mismo orden que se mandó', () => {
  const data = { translations: [{ text: 'Hello', detected_source_language: 'ES' }, { text: 'World', detected_source_language: 'ES' }] }
  assert.deepEqual(normalizeTranslateResponse(data), ['Hello', 'World'])
})

test('normalizeTranslateResponse: una respuesta real sin `translations` (error) no inventa texto — devuelve null', () => {
  assert.equal(normalizeTranslateResponse({ message: 'Forbidden' }), null)
  assert.equal(normalizeTranslateResponse(null), null)
})
