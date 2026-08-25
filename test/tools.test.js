'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateArithmetic, tryCalculator, tryUnitConversion, tryDateTime, detectTool, convertTemperature } = require('../search/tools')

test('evaluateArithmetic resuelve operaciones reales con precedencia correcta', () => {
  assert.equal(evaluateArithmetic('2 + 3'), 5)
  assert.equal(evaluateArithmetic('2 + 3 * 4'), 14)
  assert.equal(evaluateArithmetic('(2 + 3) * 4'), 20)
  assert.equal(evaluateArithmetic('2 ^ 10'), 1024)
  assert.equal(evaluateArithmetic('10 / 4'), 2.5)
  assert.equal(evaluateArithmetic('-5 + 3'), -2)
})

test('evaluateArithmetic lanza con expresiones inválidas (nunca adivina un resultado)', () => {
  assert.throws(() => evaluateArithmetic('2 +'))
  assert.throws(() => evaluateArithmetic('(2 + 3'))
  assert.throws(() => evaluateArithmetic('2 + + 3 x'))
})

test('tryCalculator reconoce una cuenta real', () => {
  assert.deepEqual(tryCalculator('23 * 47'), { type: 'calculator', expression: '23 * 47', result: 1081 })
})

test('tryCalculator no dispara para un número suelto, año, o texto — evita falsos positivos', () => {
  assert.equal(tryCalculator('2024'), null)
  assert.equal(tryCalculator('-5'), null)
  assert.equal(tryCalculator('romeo santos'), null)
  assert.equal(tryCalculator('F1'), null)
})

test('tryUnitConversion convierte longitud real (km a millas, factor real 1609.344)', () => {
  const result = tryUnitConversion('10 km to miles')
  assert.equal(result.type, 'conversion')
  assert.ok(Math.abs(result.result - 6.2137) < 0.001)
})

test('tryUnitConversion convierte peso real en español', () => {
  const result = tryUnitConversion('5 libras en kg')
  assert.ok(Math.abs(result.result - 2.26796) < 0.001)
})

test('tryUnitConversion convierte temperatura con la fórmula real (no un factor lineal)', () => {
  const result = tryUnitConversion('100 f a c')
  assert.ok(Math.abs(result.result - 37.7778) < 0.001)
  assert.equal(convertTemperature(0, 'c', 'f'), 32)
  assert.equal(convertTemperature(100, 'c', 'k'), 373.15)
})

test('tryUnitConversion devuelve null si las unidades son de categorías distintas (nunca convierte kg a metros)', () => {
  assert.equal(tryUnitConversion('5 kg to km'), null)
})

test('tryUnitConversion devuelve null si no reconoce las unidades o el patrón', () => {
  assert.equal(tryUnitConversion('romeo santos'), null)
  assert.equal(tryUnitConversion('5 blorgs to zats'), null)
})

test('tryDateTime devuelve la hora real del sistema solo para un pedido explícito', () => {
  const result = tryDateTime('qué hora es')
  assert.equal(result.type, 'datetime')
  assert.ok(!Number.isNaN(new Date(result.now).getTime()))
  assert.equal(tryDateTime('romeo santos'), null)
})

test('detectTool prueba cada herramienta en orden y no dispara para una búsqueda normal', () => {
  assert.equal(detectTool('23 * 47').type, 'calculator')
  assert.equal(detectTool('10 km to miles').type, 'conversion')
  assert.equal(detectTool('qué hora es').type, 'datetime')
  assert.equal(detectTool('romeo santos'), null)
  assert.equal(detectTool(''), null)
})
