// Pruebas sin red de netlify/functions/catalog.mjs con un almacén en memoria.
import assert from "node:assert/strict";
import handler, { __setStoreFactoryForTests, sanitizeCatalog } from "../netlify/functions/catalog.mjs";

const stores = {};
function memStore(name) {
  const m = stores[name] ||= new Map(); let n = 0;
  return {
    async getWithMetadata(k) { const e = m.get(k); return e ? { data: JSON.parse(e.v), etag: e.etag, metadata: e.meta } : null; },
    async setJSON(k, v, o = {}) {
      const e = m.get(k);
      if (o.onlyIfNew && e) return { modified: false };
      if (o.onlyIfMatch && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
      const etag = '"' + name + "-" + (++n) + "-" + Date.now() + '"';
      m.set(k, { v: JSON.stringify(v), etag, meta: o.metadata || {} }); return { modified: true, etag };
    },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
    async delete(k) { m.delete(k); }
  };
}
__setStoreFactoryForTests(memStore);
const prod = { deploy: { context: "production" } };
const req = (method, body, key) => new Request("http://x/.netlify/functions/catalog", {
  method, headers: key ? { authorization: "Bearer " + key } : {}, body: body ? JSON.stringify(body) : undefined
});
const catalog = { store_name: "Cestoria", socials: [{ name: "WhatsApp", url: "https://wa.me/57", icon: "whatsapp" }],
  categories: [{ id: "c1", name: "Sensorial", items: [{ id: "a", title: "Botella", url: "https://link.amazon/B02KjkcGI", image: "https://m.media-amazon.com/x.jpg", description: "Glitter", type: "AMAZON_PRODUCT" }] }] };

// Sin clave configurada
delete process.env.CATALOG_ADMIN_KEY;
let r = await handler(req("POST", { catalog }, "x"), prod); assert.equal(r.status, 503);
process.env.CATALOG_ADMIN_KEY = "clave-larga-de-prueba-123";

// GET sin publicar -> 404 (el catálogo usa entonces cestoria_data.json)
r = await handler(req("GET"), prod); assert.equal(r.status, 404);
// Clave incorrecta
r = await handler(req("POST", { catalog }, "otra"), prod); assert.equal(r.status, 401);
// Verificar clave
r = await handler(req("POST", { verify: true }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 200);
// Primera publicación
r = await handler(req("POST", { catalog }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 200);
const first = await r.json(); assert.equal(first.items, 1);
r = await handler(req("GET"), prod); assert.equal(r.status, 200);
const etag1 = r.headers.get("etag"); const pub = await r.json();
assert.equal(pub.categories[0].items[0].url, "https://link.amazon/B02KjkcGI", "enlace intacto");
assert.equal(pub.categories[0].items[0].description, "Glitter");
// Segunda publicación sin baseEtag -> 409 (protege de sobrescribir)
r = await handler(req("POST", { catalog }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 409);
// Con baseEtag correcto -> OK, y guarda historial
const cat2 = structuredClone(catalog); cat2.categories[0].items.push({ title: "Tablero", url: "https://amzn.to/abc", image: "", type: "AMAZON_PRODUCT" });
r = await handler(req("POST", { catalog: cat2, baseEtag: etag1 }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 200);
assert.equal((await r.json()).items, 2);
assert.ok([...stores.catalogo.keys()].some(k => k.startsWith("historial/")), "guarda copia anterior");
// baseEtag viejo (otro dispositivo publicó) -> 409
r = await handler(req("POST", { catalog, baseEtag: etag1 }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 409);
// Las vistas previas usan otro almacén
r = await handler(req("GET"), { deploy: { context: "deploy-preview" } }); assert.equal(r.status, 404);
// Validaciones
assert.throws(() => sanitizeCatalog({ categories: [{ name: "X", items: [{ title: "a", url: "http://inseguro" }] }] }), /https/);
assert.throws(() => sanitizeCatalog({ categories: [{ name: "X", items: [{ title: "a", url: "javascript:alert(1)" }] }] }), /https/);
assert.throws(() => sanitizeCatalog({ categories: [{ name: "X", items: [{ title: "a", url: "https://a.b", image: "data:x" }] }] }), /imagen/);
assert.throws(() => sanitizeCatalog({ categories: [{ name: "", items: [] }] }), /nombre/);
const s = sanitizeCatalog({ categories: [{ name: "X", items: [{ id: "1", title: "a", url: "https://a.b", type: "RARO", extra: "<script>" }, { id: "1", title: "b", url: "https://a.b" }] }] });
assert.equal(s.categories[0].items[0].type, "CLASSIC"); assert.equal(s.categories[0].items[0].extra, undefined);
assert.notEqual(s.categories[0].items[0].id, s.categories[0].items[1].id, "ids únicos");
// Historial limitado a 20
let etag = (await handler(req("GET"), prod)).headers.get("etag");
for (let i = 0; i < 25; i++) {
  await new Promise(r => setTimeout(r, 2));
  r = await handler(req("POST", { catalog, baseEtag: etag }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 200); etag = (await r.json()).etag;
}
assert.ok([...stores.catalogo.keys()].filter(k => k.startsWith("historial/")).length <= 20);
// Netlify cambia la ETag al comprimir ("…-df", W/"…"): debe seguir permitiendo publicar.
await new Promise(r => setTimeout(r, 2)); let g = await handler(req("GET"), prod); const raw = g.headers.get("etag");
assert.equal(g.headers.get("x-catalog-etag"), raw.replace(/"/g, ""));
const compressed = raw.replace(/"$/, '-df"');
r = await handler(req("POST", { catalog, baseEtag: compressed }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 200, "ETag comprimida");
await new Promise(r => setTimeout(r, 2)); g = await handler(req("GET"), prod);
r = await handler(req("POST", { catalog, baseEtag: "W/" + g.headers.get("etag") }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 200, "ETag débil");
r = await handler(req("POST", { catalog, baseEtag: compressed }, "clave-larga-de-prueba-123"), prod); assert.equal(r.status, 409, "una versión vieja sigue bloqueada");
console.log("OK: publicación del catálogo, 17 comprobaciones superadas");
// Contenido o app aliada: tipo aceptado y conservado
{
  const c = sanitizeCatalog({ categories: [{ name: "Aprende con nuestros aliados", items: [{ title: "Club Animalitos", url: "https://www.youtube.com/@clubanimalitos", type: "ALLY_CONTENT" }] }] });
  assert.equal(c.categories[0].items[0].type, "ALLY_CONTENT");
  console.log("OK: contenido aliado aceptado");
}
