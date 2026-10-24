# Cestoria — catálogo independiente para Netlify

Este paquete es únicamente el frontend estático del catálogo de Cestoria. No reemplaza ni migra la tienda online existente, no modifica su dominio y no incluye el backend de automatización de Instagram.

## Publicación rápida sin GitHub

1. Descomprime el archivo ZIP en tu computador.
2. Entra a https://app.netlify.com/ y abre **Add new project** / **Deploy manually** (el texto puede variar).
3. Arrastra la carpeta `cestoria_catalogo_netlify` —la carpeta que contiene directamente `index.html`— al área de despliegue manual.
4. Espera a que Netlify publique el sitio y abre la URL `*.netlify.app` que te asigne.
5. Comprueba que aparezcan los productos, imágenes, filtros, favoritos y enlaces de redes sociales.

No conectes el repositorio `cestoria-global-flow` de la tienda para publicar este catálogo. Este ZIP es una publicación independiente.

## Contenido

- `index.html`: interfaz del catálogo.
- `cestoria_data.json`: categorías, productos y enlaces.
- `manifest.webmanifest`, `sw.js`, `icons/icon.svg`: soporte PWA básico.
- `netlify.toml`: carpeta de publicación estática.

## Automatización de Instagram

Este despliegue estático no ejecuta el servidor Node del directorio `backend` de la versión de desarrollo. Si se quiere activar el webhook de comentarios y enviar respuestas privadas de Instagram, ese backend debe desplegarse aparte en un servicio compatible con Node, configurar sus variables secretas y validar permisos/webhooks de Meta. La publicación de este catálogo por sí sola no activa mensajes automáticos.
