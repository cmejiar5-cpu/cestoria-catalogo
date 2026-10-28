// Pruebas sin red de los códigos de referencia («Ref. C27»):
// catálogo (asignación), recepción desde Creativos, fotos y asociación automática en Instagram.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import catalogFn, { __setStoreFactoryForTests, sanitizeCatalog } from "../netlify/functions/catalog.mjs";
import ingest, { __setFetchStoreForTests, __setImageStoreFactoryForTests, sameUrl } from "../netlify/functions/catalog-ingest.mjs";
import img from "../netlify/functions/img.mjs";
import webhook from "../netlify/functions/instagram-webhook.mjs";
import { __setInstagramStoreForTests, __setInstagramFetchForTests } from "../netlify/lib/instagram.mjs";
import { findRefInText, resolveRef, storeSlugFromUrl } from "../netlify/lib/refs.mjs";

const stores = {};
let failNextMatch = 0;
function memStore(name) {
  const m = stores[name] ||= new Map(); let n = 0;
  return {
    async get(k, o) { const e = m.get(k); if (!e) return null; return o?.type === "json" ? JSON.parse(e.v) : e.v; },
    async getWithMetadata(k, o) { const e = m.get(k); if (!e) return null; return { data: o?.type === "arrayBuffer" ? e.v : JSON.parse(e.v), etag: e.etag, metadata: e.meta }; },
    async getMetadata(k) { const e = m.get(k); return e ? { etag: e.etag, metadata: e.meta } : null; },
    async set(k, v, o = {}) { m.set(k, { v: await v.arrayBuffer(), etag: '"b' + (++n) + '"', meta: o.metadata || {} }); return { modified: true }; },
    async setJSON(k, v, o = {}) {
      const e = m.get(k);
      if (o.onlyIfNew && e) return { modified: false };
      if (o.onlyIfMatch && (failNextMatch > 0 && k === "publicado" ? (failNextMatch--, true) : (!e || e.etag !== o.onlyIfMatch))) return { modified: false };
      const etag = '"' + name + "-" + (++n) + '"';
      m.set(k, { v: JSON.stringify(v), etag, meta: o.metadata || {} }); return { modified: true, etag };
    },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
    async delete(k) { m.delete(k); }
  };
}
__setStoreFactoryForTests(memStore);
__setInstagramStoreForTests(memStore);
__setImageStoreFactoryForTests(memStore);
__setFetchStoreForTests(async country => country === "CO"
  ? [{ price: 99000, stock: 3, products: { slug: "mesa-proyector", name: "Mesa Educativa con Proyector", image_url: "https://img.cestoria.shop/mesa.jpg" } }]
  : []);

const prod = { deploy: { context: "production" } };
const KEY = "clave-larga-de-prueba-123";
process.env.CATALOG_ADMIN_KEY = KEY;
const post = (fn, path, body, key = KEY) => fn(new Request("https://catalogo.test" + path, {
  method: "POST", headers: key ? { authorization: "Bearer " + key } : {}, body: JSON.stringify(body)
}), prod);
let ok = 0; const check = (c, m) => { assert.ok(c, m); ok++; };

// 1. Texto de Instagram -> código
check(findRefInText("Comenta QUIERO 💌\n\nRef. C27") === "C27", "Ref. C27");
check(findRefInText("REF: c-5 #juguetes") === "C5", "REF: c-5");
check(findRefInText("ref T3") === "T3", "ref T3");
check(findRefInText("referencia del producto C27") === "", "no confunde la palabra «referencia»");
check(findRefInText("Sin código") === "", "sin código");
check(storeSlugFromUrl("https://cestoria.shop/producto/mesa-proyector?x=1") === "mesa-proyector", "slug de la tienda");
check(storeSlugFromUrl("https://amzn.to/abc") === "", "Amazon no es tienda");
check(sameUrl("https://LINK.amazon/B02/", "https://link.amazon/B02"), "mismo enlace con barra final");

// 2. El catálogo da códigos a los productos que no tienen y nunca los reutiliza
const base = { store_name: "Cestoria", categories: [{ id: "c1", name: "Sensorial", items: [
  { id: "a", title: "Botella", url: "https://link.amazon/A1", type: "AMAZON_PRODUCT" },
  { id: "b", title: "Busy board", url: "https://link.amazon/B2", type: "AMAZON_PRODUCT", ref: "C7" },
  { id: "c", title: "Copia", url: "https://link.amazon/C3", type: "AMAZON_PRODUCT", ref: "C7" }
] }] };
let s = sanitizeCatalog(base);
const refs = s.categories[0].items.map(i => i.ref);
check(refs[1] === "C7", "conserva el código existente");
check(new Set(refs).size === 3 && refs.every(r => /^C\d+$/.test(r)), "códigos únicos: " + refs);
check(s.ref_seq === 9, "guarda el último número entregado");
const sinB = sanitizeCatalog({ ...s, categories: [{ ...s.categories[0], items: [s.categories[0].items[0], { id: "d", title: "Nuevo", url: "https://link.amazon/D4" }] }] });
check(sinB.categories[0].items[1].ref === "C10", "tras borrar un producto el número no se reutiliza");
check(sanitizeCatalog({ categories: [{ name: "X", items: [{ title: "y", url: "https://a.co/1", ref: "<script>" }] }] }).categories[0].items[0].ref === "C1", "código inválido se reemplaza");

// 3. Publicación desde el administrador -> los productos quedan con código
let r = await catalogFn(new Request("https://catalogo.test/.netlify/functions/catalog", { method: "POST", headers: { authorization: "Bearer " + KEY }, body: JSON.stringify({ catalog: base }) }), prod);
check(r.status === 200, "publica");
r = await catalogFn(new Request("https://catalogo.test/.netlify/functions/catalog"), prod);
const adminEtag = r.headers.get("x-catalog-etag");
let pub = await r.json();
check(pub.categories[0].items.every(i => i.ref), "el catálogo publicado trae códigos");

// 4. Recepción desde Creativos
check((await post(ingest, "/.netlify/functions/catalog-ingest", { url: "https://amzn.to/xyz", title: "X" }, "mala")).status === 401, "clave incorrecta -> 401");
check((await post(ingest, "/.netlify/functions/catalog-ingest", { url: "javascript:alert(1)", title: "X" })).status === 400, "enlace no https -> 400");
const png = "data:image/png;base64," + Buffer.from("\x89PNG\r\n\x1a\nfalsa-imagen").toString("base64");
failNextMatch = 1; // otro dispositivo publicó justo antes: se reintenta y no se pierde nada
r = await post(ingest, "/.netlify/functions/catalog-ingest", { url: "https://amzn.to/4dQlLxW", title: "Numberblocks figuras", imageData: png, description: "Figuras de números" });
let d = await r.json();
check(r.status === 200 && d.status === "nuevo" && d.ref === "C10", "producto nuevo de Amazon -> C10: " + JSON.stringify(d));
check(/^https:\/\/catalogo\.test\/img\/[0-9a-f]{32}\.png$/.test(d.image), "la foto queda alojada en el catálogo: " + d.image);
pub = await (await catalogFn(new Request("https://catalogo.test/.netlify/functions/catalog"), prod)).json();
const nov = pub.categories.find(c => c.name === "Novedades");
check(nov && nov.items[0].ref === "C10" && nov.items[0].type === "AMAZON_PRODUCT", "queda publicado en «Novedades» como producto de Amazon");
check(pub.categories[0].items.length === 3, "no toca los demás productos");
const imgRes = await img(new Request(d.image), { ...prod, params: { name: d.image.split("/").pop() } });
check(imgRes.status === 200 && imgRes.headers.get("content-type") === "image/png" && /immutable/.test(imgRes.headers.get("cache-control")), "sirve la foto con caché larga");
check((await img(new Request("https://catalogo.test/img/../x"), { ...prod, params: { name: "../x" } })).status === 404, "nombre de foto inválido -> 404");
r = await post(ingest, "/.netlify/functions/catalog-ingest", { url: "https://amzn.to/4dQlLxW/", title: "Otro nombre" });
d = await r.json();
check(d.status === "existente" && d.ref === "C10", "mismo enlace -> mismo código, sin duplicar");
r = await post(ingest, "/.netlify/functions/catalog-ingest", { url: "https://link.amazon/A1", title: "Botella" });
check((await r.json()).ref === pub.categories[0].items[0].ref, "producto que ya estaba -> su código");
// El administrador tenía abierta la versión anterior: al publicar recibe el aviso de cambios (no borra lo de Creativos)
r = await catalogFn(new Request("https://catalogo.test/.netlify/functions/catalog", { method: "POST", headers: { authorization: "Bearer " + KEY }, body: JSON.stringify({ catalog: base, baseEtag: adminEtag }) }), prod);
check(r.status === 409, "el administrador con versión vieja no pisa el producto nuevo");

// 5. Producto de cestoria.shop -> código T, no se agrega al catálogo
r = await post(ingest, "/.netlify/functions/catalog-ingest", { url: "https://cestoria.shop/producto/mesa-proyector", title: "mesa" });
d = await r.json();
check(d.ref === "T1" && d.source === "tienda" && d.title === "Mesa Educativa con Proyector", "tienda -> T1 con el nombre real: " + JSON.stringify(d));
check((await (await post(ingest, "/.netlify/functions/catalog-ingest", { url: "https://cestoria.shop/producto/mesa-proyector" })).json()).ref === "T1", "tienda repetida -> mismo código");
const pub2 = await (await catalogFn(new Request("https://catalogo.test/.netlify/functions/catalog"), prod)).json();
check(!JSON.stringify(pub2).includes("cestoria.shop/producto"), "la tienda no se duplica en el catálogo");
const g = await (await ingest(new Request("https://catalogo.test/.netlify/functions/catalog-ingest"), prod)).json();
check(g.items["mesa-proyector"].ref === "T1", "el administrador puede leer los códigos de la tienda");
check(resolveRef("C10", pub2, null).url === "https://catalogo-cestoriashop-git.netlify.app/?p=" + encodeURIComponent(nov.items[0].id), "C10 -> enlace del catálogo con el producto");

// 6. Instagram: comentario en publicación nueva con código -> se asocia sola
const SECRET = "0123456789abcdef0123456789abcdef";
await memStore("instagram").setJSON("config", { appSecret: SECRET, accessToken: "TOKEN", igUserId: "17841424417134943", whatsapp: "https://wa.me/573152424445" });
const captions = { "18100000000000001": "Figuras que cuentan 🔢\n\nRef. C10", "18100000000000002": "Mesa con proyector\nRef. T1", "18100000000000003": "Ref. C999", "18100000000000004": "Sin código" };
const calls = [];
__setInstagramFetchForTests(async (url, init = {}) => {
  const u = String(url); calls.push(u);
  const m = u.match(/\/(\d+)\?fields=caption/);
  if (m) return Response.json({ id: m[1], caption: captions[m[1]], permalink: "https://www.instagram.com/p/" + m[1] + "/" });
  if (u.includes("/messages")) { calls.push(JSON.parse(init.body).message.text); return Response.json({ message_id: "m" }); }
  return new Response("{}", { status: 404 });
});
const hook = async (cid, media, from = "u" + cid) => {
  const raw = JSON.stringify({ object: "instagram", entry: [{ id: "17841424417134943", changes: [{ field: "comments", value: { id: cid, text: "QUIERO", from: { id: from, username: "mama_lu" }, media: { id: media } } }] }] });
  const sig = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  return (await webhook(new Request("https://catalogo.test/instagram-webhook", { method: "POST", headers: { "x-hub-signature-256": sig }, body: raw }), prod)).json();
};
await hook("k1", "18100000000000001");
check(/Numberblocks figuras\nhttps:\/\/catalogo-cestoriashop-git\.netlify\.app\/p\/creativos-/.test(calls.at(-1)), "Ref. C10 -> mensaje con el producto: " + calls.at(-1));
const saved = JSON.parse(stores.instagram.get("posts/18100000000000001").v);
check(saved.auto === true && saved.ref === "C10" && saved.permalink.includes("instagram.com"), "queda guardada la asociación (se ve en el administrador)");
const n = calls.length;
await hook("k2", "18100000000000001");
check(!calls.slice(n).some(c => /fields=caption/.test(c)), "el segundo comentario ya no consulta el texto");
await hook("k3", "18100000000000002");
check(/Mesa Educativa con Proyector\nhttps:\/\/cestoria\.shop\/producto\/mesa-proyector/.test(calls.at(-1)), "Ref. T1 -> producto de la tienda");
await hook("k4", "18100000000000003");
check(/nuestro catálogo/.test(calls.at(-1)) && !stores.instagram.has("posts/18100000000000003"), "código que no existe -> catálogo, sin asociar");
await hook("k5", "18100000000000004");
check(/nuestro catálogo/.test(calls.at(-1)), "sin código -> catálogo, como antes");
const log = [...stores.instagram.keys()].filter(k => k.startsWith("log/")).map(k => JSON.parse(stores.instagram.get(k).v).result).join(" | ");
check(/asociado solo por Ref\. C10/.test(log) && /Ref\. C999 no existe/.test(log), "el registro explica qué pasó: " + log);

// 7. /p/<id>: tarjeta de Instagram con foto y nombre, y paso directo a la ficha
const { default: productPage, productHtml } = await import("../netlify/functions/product-page.mjs");
const nid = nov.items[0].id;
let pr = await productPage(new Request("https://catalogo.test/p/" + nid), { ...prod, params: { id: nid } });
let html = await pr.text();
check(pr.status === 200 && /og:title" content="Numberblocks figuras \| Cestoria"/.test(html) && /og:image" content="https:\/\/catalogo\.test\/img\//.test(html), "la página corta trae nombre y foto para Instagram: " + html.slice(0, 400));
check(html.includes('location.replace("https://catalogo.test/?p=' + nid + '")') && /http-equiv="refresh"/.test(html), "la página corta lleva a la ficha del producto");
pr = await productPage(new Request("https://catalogo.test/p/no-existe"), { ...prod, params: { id: "no-existe" } });
check(pr.status === 302 && pr.headers.get("location") === "https://catalogo.test/", "producto que no existe -> catálogo");
check(!productHtml({ id: "x", title: '"><script>alert(1)</script>', image: "javascript:x" }, "https://c.test").includes("<script>alert"), "el nombre no puede inyectar código");

console.log("OK: códigos de referencia, " + ok + " comprobaciones superadas");
