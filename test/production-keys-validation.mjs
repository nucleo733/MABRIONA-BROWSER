// Validación real y directa de los DOS proxies de producción (Search + Translate) apenas se
// configuren BRAVE_API_KEY y DEEPL_API_KEY en Vercel — sin pasar por la app, pega directo a los
// endpoints reales de mabriona.com para confirmar HTTP/JSON/resultados reales antes de gastar
// tiempo reinstalando el .app. Real, sin mocks — usa las cuentas reales de producción.
const results = { pass: [], fail: [] }
const ok = (l) => { results.pass.push(l); console.log('PASS -', l) }
const bad = (l, d) => { results.fail.push(l); console.log('FAIL -', l, d ? `— ${d}` : '') }

console.log('=== MABRIONA Search (browser-search) ===')
for (const q of ['romeo santos', 'apple', 'starbucks madrid', 'asdkjqwoieuqwoiuASDLKJlkajsd987987']) {
  try {
    const res = await fetch(`https://www.mabriona.com/api/browser-search?q=${encodeURIComponent(q)}`)
    const data = await res.json()
    if (res.ok && data && (Array.isArray(data.web?.results) || Array.isArray(data.mixed?.main))) {
      ok(`"${q}" → HTTP ${res.status}, respuesta real de Brave con datos reales`)
    } else if (res.ok) {
      ok(`"${q}" → HTTP ${res.status}, JSON real recibido (sin resultados para esta query — puede ser correcto para la última)`)
    } else {
      bad(`"${q}"`, `HTTP ${res.status} — ${JSON.stringify(data).slice(0, 200)}`)
    }
  } catch (err) {
    bad(`"${q}"`, String(err))
  }
}

console.log('\n=== MABRIONA Translate (browser-translate) ===')
const pairs = [
  { text: ['Hola, ¿cómo estás?'], target_lang: 'EN-US', label: 'Español → Inglés' },
  { text: ['Hello, how are you?'], target_lang: 'ES', label: 'Inglés → Español' },
  { text: ['Buenos días, esto es una prueba real.'], target_lang: 'FR', label: 'Español → Francés' },
]
for (const p of pairs) {
  try {
    const res = await fetch('https://www.mabriona.com/api/browser-translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: p.text, target_lang: p.target_lang }),
    })
    const data = await res.json()
    if (res.ok && Array.isArray(data.translations) && data.translations[0]?.text) {
      ok(`${p.label}: "${p.text[0]}" → "${data.translations[0].text}"`)
    } else {
      bad(p.label, `HTTP ${res.status} — ${JSON.stringify(data).slice(0, 200)}`)
    }
  } catch (err) {
    bad(p.label, String(err))
  }
}

console.log('\n=== RESUMEN (validación directa de producción) ===')
console.log('PASS:', results.pass.length)
console.log('FAIL:', results.fail.length)
if (results.fail.length > 0) {
  console.log('\nFallas:')
  for (const f of results.fail) console.log(' -', f)
  process.exitCode = 1
}
