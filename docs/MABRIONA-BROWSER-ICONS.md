# MABRIONA Browser — Barra rediseñada: menos íconos, Compartir, Traducir

Fecha: 2026-08-26. Real, sin mocks — verificado con Playwright contra la app real y contra el `.app` empaquetado real (`test/icons-packaged.mjs`, 8/8).

## Por qué

Pedido explícito del usuario: la barra tenía demasiados íconos, algunos con un bug real (ver abajo), y ninguno usaba SVG real — todos eran emoji, que se ven distinto (y a veces mal) según el sistema operativo. Además pidió agregar Compartir, código QR y Traductor como íconos nativos relevantes.

## Barra nueva — de 14 íconos a 8

Solo quedan siempre visibles: Atrás, Adelante, Recargar, Favorito, **Compartir**, **Traducir**, Perfil, y **Más opciones** (un solo menú con todo lo demás: Captura, Historial, Descargas, Favoritos, MABRIONA SHIELDS, Extensiones, Configuración, Nueva ventana, Nueva pestaña privada, Zoom). Antes "Más" solo aparecía en ventana angosta — ahora está siempre, a propósito, para no repetir íconos.

## Material — vidrio real, mismo que MABRIONA DJ IA

Los botones ya no son emoji sobre una píldora genérica — son íconos SVG propios (trazo fino, sin depender de ninguna fuente de emoji del sistema) sobre el mismo material "vidrio" real que usan los botones de mando de MABRIONA DJ IA (`RAISED_BTN`/`raisedActive` en `DjIaScreen.tsx`): vidrio oscuro con un brillo tenue arriba a la izquierda en reposo, y una barra de acento volt con resplandor real sangrando hacia adentro cuando el botón está "prendido" (favorito activo, o el panel de ese botón está abierto) — los valores de gradiente/sombra se tomaron literalmente del código real de DJ IA, no se inventaron de nuevo.

## Bug real encontrado y corregido

El botón "✕" del Gestor de favoritos reusaba por accidente la clase `panel-close` (pensada para paneles con `data-close="nombre"`) sin tener ese atributo — cada clic disparaba una excepción real (`Cannot read properties of null`) porque el manejador genérico buscaba un panel `panel-undefined` que no existe. Se le dio su propia clase (`bm-close-btn`). Verificado con Playwright capturando errores reales de página antes y después del fix.

## Compartir — copiar link + código QR

Electron **no tiene un panel de "compartir" nativo del sistema operativo** — se verificó en código real (`shell` de Electron solo expone `showItemInFolder/openPath/openExternal/trashItem/beep`, nada de compartir). En vez de fingir uno, "Compartir" hace lo que sí es 100% real:

- Copia la URL real de la pestaña activa al portapapeles real del sistema (`clipboard.writeText`, proceso principal).
- Genera un código QR real, **100% local** (librería `qrcode`, sin ninguna llamada de red) con esa misma URL, para escanear con el celular.
- Solo funciona sobre una página real (`http`/`https`) — la pestaña nueva propia de MABRIONA o una página interna no tienen sentido para compartir, y se avisa en vez de mostrar una URL interna confusa.

## Traducir — DeepL real

Traduce el texto real visible de la página (nodo de texto por nodo de texto, recorriendo el DOM real y evitando `<script>/<style>/<textarea>`), no el HTML entero — así nunca se arriesga a corromper un script ni el layout. Hasta 500 nodos de texto por página, en tandas de 50 por pedido real a la API de DeepL.

- Necesita una credencial real de DeepL (`deepl-api-key.local.json`, mismo patrón que la Brave API key — nunca en el repo público, se coloca a mano en la máquina que hace el build oficial). **Sin esa key, el panel lo dice honestamente** ("no está configurado") — nunca finge traducir.
- "Ver original" recarga la pestaña — mismo criterio simple y honesto que usan los navegadores reales para deshacer una traducción.
- Lista real de idiomas destino: los que soporta hoy la API de DeepL (`translate/deeplTranslate.js`), no un subconjunto elegido a mano.

## Nota real sobre `window.prompt()`

Ver `docs/MABRIONA-BROWSER-BOOKMARKS.md` — Electron no lo implementa (excepción real, verificado). No aplica a esta fase (ni Compartir ni Traducir piden texto), mencionado acá porque el mismo hallazgo se reutiliza en toda la app.

## Pendiente real, no resuelto en esta fase

Configurar `deepl-api-key.local.json` en la máquina que hace el build oficial — sin eso, "Traducir" queda honestamente "no configurado" en el `.app` distribuido, igual que pasó con la Brave API key al principio.
