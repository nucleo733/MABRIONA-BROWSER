// Content script real — modifica el DOM de verdad para que un test pueda confirmar, desde afuera,
// que esta extensión realmente corrió sobre la página (no solo que "se cargó" según la API).
const badge = document.createElement('div')
badge.id = 'mabriona-test-ext-badge'
badge.textContent = 'EXT-OK'
badge.style.cssText = 'position:fixed;top:0;left:0;z-index:999999'
document.documentElement.appendChild(badge)
