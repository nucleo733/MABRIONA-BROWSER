# MABRIONA Browser — Search y Traducir en producción

Este documento describe cómo funcionan **MABRIONA Search** y **MABRIONA
Traducir** de punta a punta: qué corre en el navegador, qué corre en
`mabriona.com`, y por qué un usuario nuevo no necesita configurar nada.

**Este documento no contiene, y nunca debe contener, el valor real de
ninguna credencial.**

## Arquitectura

Ninguna credencial de proveedor externo (Brave Search, DeepL) viaja jamás
dentro del `.app`/`.exe`/AppImage distribuido, ni existe en este
repositorio (`main.js`, `preload.js`, `renderer/`). Ambas funciones usan
el mismo patrón:

1. El navegador llama primero a `registry.getBraveApiKey()` /
   `registry.getDeeplApiKey()` — la key **propia** que un usuario avanzado
   puede configurar localmente para usar su propia cuenta (ver
   `scripts/set-brave-key.js`; hoy no existe un equivalente de UI/CLI para
   DeepL, es un hueco conocido, fuera de alcance de este documento).
2. Si no hay key propia configurada (el caso normal, el 100% de los
   usuarios nuevos), el navegador llama a un proxy real, server-side, en
   `https://www.mabriona.com/api/browser-search`,
   `/api/browser-images` y `/api/browser-translate`.
3. Esos endpoints (Vercel Serverless Functions, código en
   `app/api/browser-search.ts`, `app/api/browser-images.ts`,
   `app/api/browser-translate.ts` del repo `MABRIONA-STUDIO`) tienen la
   credencial real como variable de entorno de Vercel — nunca en el
   código fuente, nunca en el bundle del cliente. Ellos hacen la llamada
   real a Brave/DeepL y devuelven la respuesta real al navegador.

El navegador nunca ve, guarda ni transmite la credencial real del
proveedor — solo habla con `mabriona.com`, que es infraestructura propia
de MABRIONA.

## Variables de entorno configuradas

En el proyecto `mabriona-studio` de Vercel:

| Variable | Entornos | Usada por |
|---|---|---|
| `BRAVE_API_KEY` | Production, Preview | `browser-search`, `browser-images` |
| `DEEPL_API_KEY` | Production, Preview | `browser-translate` |

`Development` no tiene ninguna de las dos configuradas — no hace falta:
el desarrollo local del navegador apunta igual al proxy real de
`www.mabriona.com`, no a un servidor local.

## Seguridad

- Las credenciales viven exclusivamente en las variables de entorno de
  Vercel. Nadie las escribe en código, en commits, en `dist/`, en el
  `.app` empaquetado, ni en logs.
- Auditado explícitamente en cada release (`v1.4.3`, `v1.4.4`): se
  extrae `app.asar` del `.app` compilado y se busca el valor real de
  cada credencial — no debe aparecer.
- Gap conocido, no cerrado en este release: los tres endpoints
  (`browser-search`, `browser-images`, `browser-translate`) no tienen
  autenticación ni rate-limiting propios más allá de los límites del
  proveedor — cualquiera que conozca la URL puede llamarlos. No es
  distinto del comportamiento típico de un proxy de búsqueda "sin
  cuenta", pero queda anotado como pendiente de fortalecer.

## Privacidad

- **Search**: solo se envía el texto de la búsqueda que el usuario tipeó.
  No se envía historial, cookies, contraseñas ni ningún otro dato del
  perfil.
- **Traducir**: solo se envía el texto visible de la página que el
  usuario decide traducir (nodo por nodo), nunca la página completa como
  HTML, nunca cookies, contraseñas ni datos de sesión.

## Límites y cuotas reales

- DeepL (plan Free/Developer): 500,000 caracteres por mes. Al agotarse,
  DeepL devuelve un error real de cuota — el navegador lo muestra tal
  cual, nunca finge una traducción.
- Brave Search: sujeto al plan real contratado en la cuenta de Brave de
  MABRIONA. Al agotarse o fallar, el navegador muestra el error real, no
  resultados falsos.
- No existe ningún sistema de reintento infinito ni cola propia — un
  fallo del proveedor es un fallo real, comunicado tal cual al usuario.

## Comportamiento ante fallos (honesto, sin mocks)

En cualquiera de estos casos el navegador muestra un mensaje real de
error, nunca un resultado falso ni un "traducido"/"buscado" simulado:

- Sin conexión a internet.
- Credencial inválida o vencida (del lado de Vercel).
- Proveedor caído o con rate limit alcanzado.
- Respuesta inesperada/no válida del proveedor.
- Texto vacío o página no traducible (ej. `chrome://`, `file://`).

## Proceso de release

1. Verificar en Vercel (proyecto `mabriona-studio`) que `BRAVE_API_KEY` y
   `DEEPL_API_KEY` sigan configuradas en Production y Preview.
2. Compilar el navegador (`npm run dist`, `--arm64`, `dist:linux`,
   workflow `build-windows.yml`).
3. Extraer `app.asar` del build final y confirmar que no contiene ningún
   valor real de credencial.
4. Correr la regresión completa: tests unitarios, `smoke.mjs`,
   `translate-e2e.mjs`, `release-checklist.mjs`, `icons-packaged.mjs`,
   `bookmarks-manager-packaged.mjs`, `production-keys-validation.mjs`
   (pega directo a los proxies reales) y `production-user-nuevo.mjs`
   (usuario nuevo, máquina limpia, sin ninguna credencial local).
5. Publicar el release en GitHub con checksums SHA-256 reales de los
   cuatro instaladores (mac x64, mac arm64, Linux AppImage, Windows
   NSIS).
6. Actualizar la página de descarga en `mabriona.com/browser`.
