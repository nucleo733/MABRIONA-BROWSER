# MABRIONA Browser — Traductor real (DeepL), sin credencial expuesta

Fecha: 2026-08-26. Fase 1.4.3 — cierra el único pendiente real que quedaba documentado en `docs/MABRIONA-BROWSER-ICONS.md`.

## Arquitectura real

Mismo criterio exacto que la búsqueda propia de MABRIONA (Fase 21, ver `docs/MABRIONA-BROWSER-RELEASE.md` y el commit `fix(security): la key real de Brave Search ya no viaja empaquetada en el cliente`): la credencial real de DeepL **nunca viaja empaquetada** dentro del `.app`/`.exe` distribuido.

```
MABRIONA Browser (proceso principal, main.js)
        ↓ sin key propia configurada
https://www.mabriona.com/api/browser-translate   (Vercel, DEEPL_API_KEY server-side)
        ↓
DeepL API real
```

- `main.js#translate:page` resuelve `registry.getDeeplApiKey()` (una key PROPIA que la persona haya configurado ella misma — hoy no existe ningún camino en la UI para hacerlo, ver "Pendiente real" más abajo). Si no hay key propia, arma el pedido contra el proxy real `mabriona.com/api/browser-translate` en vez de contra DeepL directo — mismo patrón línea por línea que `search:query`/`search:images`.
- `app/api/browser-translate.ts` (repo `MABRIONA-STUDIO`, deploy real en Vercel) es el proxy: lee `DEEPL_API_KEY` del entorno real del servidor, arma el pedido real a DeepL (`api-free.deepl.com` o `api.deepl.com` según el sufijo `:fx` de la key), y devuelve la respuesta cruda de DeepL tal cual. La normalización (`normalizeTranslateResponse`) sigue viviendo, sin cambios, en `translate/deeplTranslate.js`.
- Nunca hay un pre-chequeo de "¿está configurado?" — mismo criterio que Search: siempre se intenta (vía proxy o key propia), y el error real (si lo hay) se muestra tal cual, nunca fingido. El campo `configured` en la respuesta quedó, por consistencia con `SEARCH_EMPTY`, pero en la práctica siempre es `true` — el intento real es lo que decide si hubo éxito o error.

## Cómo se traduce (sin tocar scripts ni layout)

Se traduce **nodo de texto por nodo de texto**, nunca el HTML completo:

1. `main.js` recorre el DOM real de la pestaña activa (`document.createTreeWalker`, `NodeFilter.SHOW_TEXT`), saltando `<script>`/`<style>`/`<noscript>`/`<textarea>`/`<title>` — hasta 500 nodos de texto reales por página (tope real, cuida la cuota mensual).
2. Los textos se mandan en tandas de 50 (máximo real por pedido) al proxy o a DeepL directo.
3. La respuesta real se aplica de vuelta a los MISMOS nodos (referencias guardadas en `window.__mabrionaTranslateNodes` dentro de esa pestaña, no un segundo recorrido del DOM — evita que la página cambie entre el paso 1 y este).
4. "Ver original" recarga la pestaña — mismo criterio simple y honesto que un navegador real.

## Idiomas reales

Los que soporta hoy la API de DeepL (`target_lang`) — lista real en `translate/deeplTranslate.js#LANGUAGES`, no un subconjunto elegido a mano.

## Privacidad — qué se manda, qué no

Al traducir, el **texto visible real** de la página (no scripts, no estilos, no atributos ocultos) se envía al proxy de MABRIONA y de ahí a DeepL, para poder traducirlo. Nunca se manda: historial, cookies, contraseñas, datos de perfil, ni ninguna otra credencial — el proxy solo recibe `{ text: string[], target_lang: string }` en el cuerpo del pedido, nada más.

## Errores reales — nunca una traducción fingida

- **DeepL/proxy caído o con error real**: `main.js` corta ahí mismo y devuelve `error` real (ej. `"error 503 del traductor de MABRIONA"`) — la UI lo muestra tal cual, nunca "listo" fingido.
- **Sin conexión real**: el `catch` de `fetch()` devuelve el error real de red.
- **Página sin texto real** (ej. una imagen a pantalla completa): `translatedCount: 0`, mensaje honesto — no es un error, simplemente no había nada que traducir.
- **`DEEPL_API_KEY` sin configurar en Vercel**: el proxy responde `503` real — se ve como cualquier otro error real en la UI, no un estado especial fingido.

## Seguridad Electron — sin tocar nada

`contextIsolation`/`sandbox`/`nodeIntegration: false` sin cambios. La key (propia o del proxy) nunca llega al renderer ni al preload — vive y se usa enteramente dentro del `ipcMain.handle` en el proceso principal.

## Pendiente real, no resuelto en esta fase

- **No existe todavía ninguna forma real, en la UI, de que una persona configure su PROPIA key de DeepL** — el campo `deeplApiKey` existe en `profiles.js`, pero no hay ningún IPC ni panel de Configuración que lo escriba. Mismo hueco real que tiene hoy `scripts/set-brave-key.js` para Brave (ese script además apunta al archivo equivocado — escribe en `mabriona-browser-data.json`, pero `main.js` lee de `mabriona-browser-profiles.json` — roto para cualquier instalación después del primer arranque). Se deja anotado para una fase futura de Configuración real de credenciales propias, compartida entre Search y Traducir — no es parte de esta fase.
- **`mabriona.com/api/browser-translate` no tiene autenticación ni límite de uso propio** — igual que `browser-search`/`browser-images` hoy. Como la cuota de DeepL (500k caracteres/mes en el plan gratis) es bastante más chica que la de Brave, este es un riesgo real de abuso compartido entre los tres proxies, no exclusivo de Traducir — anotado, no resuelto acá (requeriría una decisión de arquitectura para los tres endpoints juntos, no solo el nuevo).

## Manual real: configurar `DEEPL_API_KEY` en Vercel

1. [DeepL](https://www.deepl.com/pro-api) → crear una cuenta (el plan gratis alcanza, 500.000 caracteres/mes) → copiar la API Key real (termina en `:fx` si es del plan gratis).
2. En el dashboard de Vercel del proyecto MABRIONA-STUDIO → Settings → Environment Variables → agregar `DEEPL_API_KEY` con ese valor real → Save.
3. Volver a desplegar (Vercel redeploya solo con el próximo push, o se puede forzar un redeploy manual desde el dashboard).

Sin este paso, "Traducir" sigue funcionando en el sentido de que nunca crashea ni finge — simplemente muestra el error real (`error 503 del traductor de MABRIONA`) hasta que la key esté configurada.
