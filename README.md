# Cestoria — catálogo independiente

Este repositorio contiene únicamente el frontend estático del catálogo Cestoria. No contiene ni reemplaza el código de la tienda `cestoria.shop`.

## Archivos
- `index.html`: interfaz, estilos y lógica de catálogo.
- `cestoria_data.json`: 32 productos, categorías, imágenes y enlaces originales.
- `manifest.webmanifest`, `sw.js`, `icons/icon.svg`: soporte PWA básico.
- `netlify.toml`: configuración estática para Netlify.

## Publicar con GitHub + Netlify
1. Crea un repositorio nuevo llamado `cestoria-catalogo` en GitHub. No uses `cestoria-global-flow`.
2. Sube todos los archivos y la carpeta `icons` de este proyecto a la raíz del repositorio.
3. En Netlify, abre el proyecto existente `catalogo-cestoriashop`.
4. Ve a **Project configuration / Build & deploy** y conecta el repositorio nuevo, o crea un proyecto nuevo desde ese repositorio si prefieres conservar el sitio actual como respaldo.
5. Para este sitio estático, deja el directorio de publicación en la raíz (`.`); no hace falta comando de build.
6. Comprueba el deploy y verifica enlaces antes de considerar el cambio terminado.

## Botones de compra
- Enlaces a Amazon (`amzn.to` o dominios Amazon): “Comprar en Amazon”, abren el enlace afiliado existente.
- Enlaces a `cestoria.shop`: “Pedir con pago contra entrega”, abren la página de producto original en la tienda.
- Otros dominios: conservan “Ver producto”.

Se añadió un aviso de afiliación de Amazon. No se han cambiado los títulos, imágenes, categorías ni las URL de los productos.

## Importante
No cambies los DNS ni asignes `cestoria.shop` como dominio de Netlify. La tienda debe seguir en su alojamiento actual. Si quieres un dominio propio para el catálogo, usa un subdominio independiente como `catalogo.cestoria.shop`.

## Publicar productos (administrador)
- `admin.html` guarda los cambios como pendientes en el navegador y los publica con «Publicar cambios».
- Lo publicado se guarda en **Netlify Blobs** (función `netlify/functions/catalog.mjs`). Publicar **no genera un deploy**, así que no gasta los créditos de «production deploy» del plan gratuito (15 créditos cada uno, según la página de precios de Netlify).
- `cestoria_data.json` queda como catálogo inicial y respaldo si no hay nada publicado.
- **Configuración obligatoria:** en Netlify → Project configuration → Environment variables, crea `CATALOG_ADMIN_KEY` con una clave larga (20+ caracteres) y con alcance que incluya *Functions*. Después hay que volver a desplegar para que la función la lea.
- Se guardan las 20 versiones anteriores en el almacén `catalogo` (claves `historial/…`), visibles en Netlify → Data & Storage → Blobs.
- Las vistas previas (deploy previews) usan otro almacén y no tocan el catálogo real.

## Construcción y pruebas
- `npm run build` copia solo los archivos públicos a `dist/` (no se publican `node_modules`, `scripts` ni el código de las funciones).
- `npm test` ejecuta las pruebas sin red de las funciones.
