const CACHE='cestoria-catalog-v3';
const CORE=['./','./index.html','./manifest.webmanifest','./cestoria_data.json','./icons/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
// Páginas, datos del catálogo y funciones: primero la red (para ver productos nuevos), caché solo sin conexión.
// Imágenes y demás archivos estáticos: primero la caché.
const networkFirst=req=>fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy))}return res}).catch(()=>caches.match(req).then(c=>c||(req.mode==='navigate'?caches.match('./index.html'):Response.error())));
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.origin!==self.location.origin)return;
if(url.pathname.endsWith('/admin.html'))return;
if(req.mode==='navigate'||url.pathname.endsWith('.json')||url.pathname.endsWith('.html')||url.pathname.startsWith('/.netlify/functions/')){event.respondWith(networkFirst(req));return}
event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(cache=>cache.put(req,copy))}return res})))});
