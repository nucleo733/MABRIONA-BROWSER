'use strict'

/**
 * MABRIONA Tools — utilitarios que MABRIONA puede resolver por sí misma, sin depender de Brave ni
 * de ninguna API externa: son cálculo real, no un dato que se pida prestado. Por eso viven en su
 * propio módulo puro (sin red, sin DOM) en vez de en `braveSearch.js`.
 *
 * Regla de esta fase: "cada herramienta debe funcionar realmente... si requiere una capacidad que
 * no existe, no implementarla". Se auditaron mentalmente varias herramientas típicas (traductor,
 * clima, calculadora científica avanzada) y se implementaron solo las que MABRIONA puede resolver
 * con 100% de certeza matemática/de sistema — nunca aproximando ni inventando: calculadora
 * aritmética, conversión de unidades (factores reales), y fecha/hora real del sistema.
 */

// ---------------- Calculadora ----------------

/** Parser recursivo-descendente real (sin `eval`, sin librerías) — soporta +, -, *, /, ^, paréntesis
 * y decimales. Lanza si la expresión es inválida; nunca "adivina" un resultado. */
function evaluateArithmetic(expr) {
  let pos = 0
  const peek = () => expr[pos]
  const skipSpace = () => { while (peek() === ' ') pos++ }

  function parseNumber() {
    skipSpace()
    const start = pos
    while (pos < expr.length && /[0-9.]/.test(peek())) pos++
    if (pos === start) throw new Error('número esperado')
    const value = Number(expr.slice(start, pos))
    if (Number.isNaN(value)) throw new Error('número inválido')
    return value
  }

  function parseFactor() {
    skipSpace()
    if (peek() === '(') {
      pos++
      const value = parseExpr()
      skipSpace()
      if (peek() !== ')') throw new Error('falta cerrar paréntesis')
      pos++
      return value
    }
    if (peek() === '-') { pos++; return -parseFactor() }
    if (peek() === '+') { pos++; return parseFactor() }
    return parseNumber()
  }

  function parsePower() {
    const base = parseFactor()
    skipSpace()
    if (peek() === '^') { pos++; return Math.pow(base, parsePower()) }
    return base
  }

  function parseTerm() {
    let value = parsePower()
    skipSpace()
    while (peek() === '*' || peek() === '/') {
      const op = peek()
      pos++
      const rhs = parsePower()
      value = op === '*' ? value * rhs : value / rhs
      skipSpace()
    }
    return value
  }

  function parseExpr() {
    let value = parseTerm()
    skipSpace()
    while (peek() === '+' || peek() === '-') {
      const op = peek()
      pos++
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
      skipSpace()
    }
    return value
  }

  const result = parseExpr()
  skipSpace()
  if (pos !== expr.length) throw new Error('caracteres inesperados')
  return result
}

/** Solo dispara para algo que de verdad parece una cuenta (tiene un operador real) — una búsqueda
 * como "2024" o "F1" nunca debe convertirse en un resultado de calculadora. */
function tryCalculator(query) {
  const trimmed = String(query).trim()
  if (!/^[0-9+\-*/^().\s]+$/.test(trimmed)) return null
  if (!/[0-9]/.test(trimmed)) return null
  if (!/[+\-*/^]/.test(trimmed.replace(/^-/, ''))) return null // excluye un número negativo suelto
  try {
    const result = evaluateArithmetic(trimmed)
    if (!Number.isFinite(result)) return null
    return { type: 'calculator', expression: trimmed, result }
  } catch {
    return null
  }
}

// ---------------- Conversión de unidades ----------------

/** Factores reales (SI), no inventados. */
const UNIT_CATEGORIES = [
  { base: 'm', units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 } },
  { base: 'kg', units: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.45359237, oz: 0.028349523125 } },
]

const UNIT_ALIASES = {
  km: 'km', kilometro: 'km', kilometros: 'km', kilómetro: 'km', kilómetros: 'km', kilometer: 'km', kilometers: 'km',
  m: 'm', metro: 'm', metros: 'm', meter: 'm', meters: 'm',
  cm: 'cm', centimetro: 'cm', centimetros: 'cm', centímetro: 'cm', centímetros: 'cm', centimeter: 'cm', centimeters: 'cm',
  mm: 'mm', milimetro: 'mm', milimetros: 'mm', milímetro: 'mm', milímetros: 'mm', millimeter: 'mm', millimeters: 'mm',
  mi: 'mi', milla: 'mi', millas: 'mi', mile: 'mi', miles: 'mi',
  yd: 'yd', yarda: 'yd', yardas: 'yd', yard: 'yd', yards: 'yd',
  ft: 'ft', pie: 'ft', pies: 'ft', foot: 'ft', feet: 'ft',
  in: 'in', pulgada: 'in', pulgadas: 'in', inch: 'in', inches: 'in',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gramo: 'g', gramos: 'g', gram: 'g', grams: 'g',
  mg: 'mg', miligramo: 'mg', miligramos: 'mg', milligram: 'mg', milligrams: 'mg',
  lb: 'lb', lbs: 'lb', libra: 'lb', libras: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', onza: 'oz', onzas: 'oz', ounce: 'oz', ounces: 'oz',
  c: 'c', celsius: 'c', centigrados: 'c', centígrados: 'c',
  f: 'f', fahrenheit: 'f',
  k: 'k', kelvin: 'k',
}

const TEMPERATURE_UNITS = new Set(['c', 'f', 'k'])

function convertTemperature(value, from, to) {
  let celsius
  if (from === 'c') celsius = value
  else if (from === 'f') celsius = ((value - 32) * 5) / 9
  else celsius = value - 273.15
  if (to === 'c') return celsius
  if (to === 'f') return (celsius * 9) / 5 + 32
  return celsius + 273.15
}

/** Reconoce "10 km to miles" / "5 lbs en kg" / "100 f a c" (español/inglés). Devuelve `null` si no
 * reconoce ambas unidades o si son de categorías distintas (nunca convierte kg a metros). */
function tryUnitConversion(query) {
  const match = String(query)
    .trim()
    .match(/^([\d.,]+)\s*([a-zA-ZÁÉÍÓÚáéíóúñÑ]+)\s+(?:a|en|to|in)\s+([a-zA-ZÁÉÍÓÚáéíóúñÑ]+)$/)
  if (!match) return null

  const value = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(value)) return null

  const from = UNIT_ALIASES[match[2].toLowerCase()]
  const to = UNIT_ALIASES[match[3].toLowerCase()]
  if (!from || !to) return null

  if (TEMPERATURE_UNITS.has(from) || TEMPERATURE_UNITS.has(to)) {
    if (!TEMPERATURE_UNITS.has(from) || !TEMPERATURE_UNITS.has(to)) return null
    return { type: 'conversion', value, from, to, result: convertTemperature(value, from, to) }
  }

  for (const category of UNIT_CATEGORIES) {
    if (category.units[from] != null && category.units[to] != null) {
      const result = (value * category.units[from]) / category.units[to]
      return { type: 'conversion', value, from, to, result }
    }
  }
  return null
}

// ---------------- Fecha y hora ----------------

const DATE_TIME_PATTERNS = [
  'que hora es', 'qué hora es', 'what time is it', 'hora actual', 'current time',
  'que dia es hoy', 'qué día es hoy', 'que fecha es hoy', 'qué fecha es hoy', 'fecha de hoy',
  "what's today's date", 'current date', "today's date",
]

/** La hora/fecha real del sistema en el momento de la búsqueda — nunca un valor fijo ni simulado. */
function tryDateTime(query) {
  const normalized = String(query).trim().toLowerCase()
  if (!DATE_TIME_PATTERNS.includes(normalized)) return null
  return { type: 'datetime', now: new Date().toISOString() }
}

/** Único punto de entrada — intenta cada herramienta en orden y devuelve la primera que reconozca
 * la consulta real, o `null` si ninguna aplica (la mayoría de las búsquedas). */
function detectTool(query) {
  if (!query) return null
  return tryCalculator(query) || tryUnitConversion(query) || tryDateTime(query)
}

module.exports = { evaluateArithmetic, tryCalculator, tryUnitConversion, tryDateTime, detectTool, convertTemperature }
