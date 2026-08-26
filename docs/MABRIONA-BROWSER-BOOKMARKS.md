# MABRIONA Browser — Gestor profesional de favoritos

Fecha: 2026-08-26. Real, sin mocks — verificado con Playwright contra la app real (`test/bookmarks-manager.mjs`, 20/20) y contra el `.app` empaquetado real con un userData 100% nuevo (`test/bookmarks-manager-packaged.mjs`, 7/7: persistencia real, aislamiento real entre perfiles, Modo Invitado nunca persiste).

## Qué hace

Los favoritos dejaron de ser una lista plana. Ahora son un árbol real de carpetas y subcarpetas, con:

- **Barra de favoritos real** en la barra de herramientas — carpetas de primer nivel se ven como desplegables (con sus propias subcarpetas anidadas adentro), favoritos sueltos como botones que navegan al hacer clic.
- **Gestor de favoritos** (⋯ al final de la barra, o "Administrar favoritos…" desde el panel ★) — pantalla completa con árbol de carpetas a la izquierda, breadcrumb + lista de la carpeta abierta a la derecha, búsqueda real (por título o URL, en todos los favoritos, mostrando la ruta de carpeta de cada resultado), y orden manual o por nombre.
- **Menú contextual real** (clic derecho) en la barra y en el gestor:
  - Favorito: Abrir · Abrir en nueva pestaña · Abrir en nueva ventana · Editar (título y URL) · Mover a… · Eliminar.
  - Carpeta: Abrir todos · Nueva subcarpeta · Renombrar · Mover a… · Eliminar.
- **Arrastrar y soltar real** (HTML5 drag-and-drop) — favorito o carpeta arrastrado sobre una carpeta se mueve adentro; soltado sobre un hermano se reordena junto a él.

## Modelo de datos — árbol real por id, no rutas de texto

`store.js`:

```js
folders: [{ id, name, parentId, order }]   // parentId: null = primer nivel
favorites: [{ url, title, addedAt, folderId, order, ... }]  // folderId: null = primer nivel
```

Un árbol real por id (igual que Chrome/Firefox modelan sus propios marcadores internamente) en vez de una ruta de texto tipo `"Barra de favoritos/Trabajo"`: soporta carpetas vacías, renombrar sin reescribir nada más, y mover una carpeta adentro de otra sin tocar ningún favorito.

**Migración real, automática, de una sola vez** (`migrateFolderPathsToRealFolders`): un archivo que todavía tenía favoritos con `folder: "A/B"` (formato viejo, el que dejaba el asistente de importación antes de que existiera este árbol) se convierte solo, la primera vez que se abre, a carpetas reales con id — sin perder ningún favorito, sin duplicar carpetas si dos favoritos compartían la misma ruta. El campo viejo `folder` nunca se borra (por si algo lo necesita) — solo se agrega `folderId` apuntando a la carpeta real.

Bug real encontrado y corregido durante esta fase: la migración usaba `Array.isArray(data.folders)` sobre el objeto YA fusionado con los valores por defecto (`folders: []`) para decidir si ya se había migrado — como los valores por defecto siempre traen un array vacío, esto hacía que la migración se diera por hecha sin haber corrido nunca. Se corrigió comparando contra el archivo real tal cual estaba en disco, antes de fusionarlo con los defaults (mismo patrón que ya usaba la migración de onboarding).

## Integración con la importación

`importFavorites` (usado por el asistente de "Importar datos del navegador", ver `docs/MABRIONA-BROWSER-IMPORT.md`) resuelve la ruta de texto real que trae cada navegador de origen (`"Barra de favoritos/Trabajo"`) contra el árbol real de carpetas, reutilizando una carpeta si ya existe con ese mismo nombre en ese mismo nivel — importar dos veces (o importar después de ya tener carpetas propias) nunca crea carpetas duplicadas.

## Borrar una carpeta nunca borra lo que tenía adentro

`deleteFolder` sube sus subcarpetas y favoritos un nivel real (al padre de la carpeta borrada) — nada desaparece sin que la persona lo borre aparte, a propósito. Mover una carpeta adentro de sí misma o de una de sus propias subcarpetas se rechaza (`isDescendantFolder`, guardado contra ciclos).

## Perfiles y Modo Invitado

Las carpetas/favoritos viven en el store real de cada perfil (`storeForWindow`, mismo patrón que Historial/Extensiones) — un perfil nunca ve las carpetas de otro, verificado con dos perfiles reales en el `.app` empaquetado. Modo Invitado usa el mismo store en memoria de siempre (`createMemoryStore`) — crear una carpeta ahí funciona durante la sesión, pero se olvida por completo al cerrar la ventana, verificado cerrando y reabriendo la app real.

## Seguridad

`contextIsolation`/`sandbox` sin tocar. El IPC nuevo (`favorites:rename|update-url|move|reorder`, `folders:list|create|rename|move|reorder|delete`) sigue el mismo patrón que ya existía, resuelto siempre por la ventana que llama (`storeForWindow`). `updateFavoriteUrl` valida que la URL nueva empiece con `http://`/`https://` antes de guardarla, y nunca dos favoritos terminan con la misma URL (se rechaza la edición, no se pisa el otro).

## Nota real sobre `window.prompt()`

Electron **no implementa `window.prompt()`** — lanza una excepción real ("prompt() is and will not be supported"), verificado en esta misma versión de Electron antes de que llegara a producción. "Nueva carpeta", "Renombrar" y "Editar" usan un diálogo propio (`showTextPrompt`, overlay real con input + Aceptar/Cancelar) en vez de `prompt()`. `alert()` y `confirm()` sí funcionan (diálogo nativo real, verificado) y se siguen usando tal cual para errores y confirmaciones de borrado.

## A propósito, no implementado en esta fase

Gestor de contraseñas, importación de contraseñas, contraseña maestra, autofill — fase aparte, requiere una arquitectura de seguridad dedicada.
