// Prueba de extremo a extremo: administrador -> función de publicación (real, almacén en memoria) -> catálogo público.
// Requiere Playwright y un servidor estático en el puerto indicado. Uso: node scripts/test-publish-e2e.mjs [puerto]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import handler, { __setStoreFactoryForTests } from "../netlify/functions/catalog.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = "http://127.0.0.1:" + (process.argv[2] || 8765);
const KEY = "clave-de-prueba-larga-2026";
process.env.CATALOG_ADMIN_KEY = KEY;

const mem = new Map(); let n = 0;
__setStoreFactoryForTests(() => ({
  async getWithMetadata(k) { const e = mem.get(k); return e ? { data: JSON.parse(e.v), etag: e.etag, metadata: e.meta } : null; },
  async setJSON(k, v, o = {}) { const e = mem.get(k); if (o.onlyIfNew && e) return { modified: false }; if (o.onlyIfMatch && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
    const etag = '"e' + (++n) + '"'; mem.set(k, { v: JSON.stringify(v), etag, meta: o.metadata || {} }); return { modified: true, etag }; },
  async list({ prefix = "" } = {}) { return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  async delete(k) { mem.delete(k); }
}));
async function route(r) {
  const q = r.request();
  const res = await handler(new Request(q.url(), { method: q.method(), headers: q.headers(), body: q.method() === "POST" ? q.postData() : undefined }), { deploy: { context: "production" } });
  const headers = Object.fromEntries(res.headers);
  // Como Netlify al comprimir: la ETag llega cambiada ("…-df").
  if (headers.etag) headers.etag = headers.etag.replace(/"$/, '-df"');
  r.fulfill({ status: res.status, headers, body: await res.text() });
}

const b = await chromium.launch();
const ctx = await b.newContext(); await ctx.route("**/.netlify/functions/catalog", route);
const p = await ctx.newPage(); p.on("dialog", d => d.accept());
const status = async sel => (await p.textContent(sel)).trim();

// 1. Sin catálogo publicado: carga el archivo inicial
await p.goto(BASE + "/admin.html"); await p.waitForFunction(() => document.querySelectorAll("#productList .item").length > 0);
assert.equal(await p.locator("#productList .item").count(), 32);
assert.match(await status("#pendingInfo"), /archivo inicial/);

// 2. Añadir producto -> pendiente
await p.fill("#title", "Hahaland - Juguetes de silicona para apilar"); await p.fill("#url", "https://link.amazon/B02KjkcGI");
await p.fill("#image", "https://m.media-amazon.com/images/I/71qQvKAyItL._AC_SL1500_.jpg"); await p.fill("#category", "Sensorial");
await p.fill("#description", "Bloques de silicona"); await p.click("button[type=submit]");
assert.match(await status("#pendingInfo"), /^1 cambio/);

// 3. Clave incorrecta
await p.fill("#adminKey", "mala"); await p.click("#publishBtn"); await p.waitForFunction(() => /No se publicó/.test(document.querySelector("#publishStatus").textContent));
assert.match(await status("#publishStatus"), /Clave de publicación incorrecta/);
assert.match(await status("#pendingInfo"), /^1 cambio/);

// 4. Clave correcta
await p.fill("#adminKey", KEY); await p.click("#publishBtn"); await p.waitForFunction(() => /Publicado/.test(document.querySelector("#publishStatus").textContent));
console.log("4:", await status("#publishStatus"));
assert.match(await status("#pendingInfo"), /No hay cambios pendientes/);

// 5. El catálogo público lo muestra, con botón de Amazon para link.amazon
const pub = await ctx.newPage(); await pub.goto(BASE + "/index.html");
await pub.waitForFunction(() => document.querySelectorAll("#products .product").length > 0);
assert.equal(await pub.locator("#products .product").count(), 33);
const card = pub.locator("#products .product", { hasText: "Hahaland" });
assert.equal(await card.locator("a.btn").getAttribute("href"), "https://link.amazon/B02KjkcGI");
assert.match(await card.locator("a.btn").textContent(), /Comprar en Amazon/);

// 6. Otro dispositivo abre el administrador (versión actual)
const ctx2 = await b.newContext(); await ctx2.route("**/.netlify/functions/catalog", route);
const p2 = await ctx2.newPage(); p2.on("dialog", d => d.accept());
await p2.goto(BASE + "/admin.html"); await p2.waitForFunction(() => document.querySelectorAll("#productList .item").length > 0);
assert.match(await p2.textContent("#pendingInfo"), /publicado/);

// 7. Editar y eliminar en el primer dispositivo, publicar
await p.reload(); await p.waitForFunction(() => document.querySelectorAll("#productList .item").length > 0);
await p.locator("#productList .item", { hasText: "Hahaland" }).locator("button").click();
await p.fill("#title", "Hahaland - Bloques de silicona (editado)"); await p.click("button[type=submit]");
await p.locator("#productList .item").nth(5).locator("button").click(); const gone = await p.inputValue("#title");
await p.click("#deleteBtn");
assert.match(await status("#pendingInfo"), /^2 cambio/);
await p.fill("#adminKey", KEY); await p.click("#publishBtn"); await p.waitForFunction(() => /Publicado/.test(document.querySelector("#publishStatus").textContent));
await pub.reload(); await pub.waitForFunction(() => document.querySelectorAll("#products .product").length > 0);
assert.equal(await pub.locator("#products .product").count(), 32);
assert.ok((await pub.textContent("#products")).includes("(editado)"));
assert.ok(!(await pub.textContent("#products")).includes(gone.slice(0, 40)), "eliminado");

// 8. El segundo dispositivo tiene una versión vieja: no pisa los cambios
await p2.fill("#title", "Producto desde el móvil"); await p2.fill("#url", "https://amzn.to/x"); await p2.fill("#category", "Sensorial"); await p2.click("button[type=submit]");
await p2.fill("#adminKey", KEY); await p2.click("#publishBtn"); await p2.waitForFunction(() => /No se publicó/.test(document.querySelector("#publishStatus").textContent));
assert.match(await p2.textContent("#publishStatus"), /otro dispositivo/);
// Al recargar conserva su cambio pendiente sobre la versión nueva y puede publicar
await p2.reload(); await p2.waitForFunction(() => document.querySelectorAll("#productList .item").length > 0);
assert.ok((await p2.textContent("#productList")).includes("(editado)") && (await p2.textContent("#productList")).includes("Producto desde el móvil"));
await p2.fill("#adminKey", KEY); await p2.click("#publishBtn"); await p2.waitForFunction(() => /Publicado/.test(document.querySelector("#publishStatus").textContent));
await pub.reload(); await pub.waitForFunction(() => document.querySelectorAll("#products .product").length > 0);
assert.equal(await pub.locator("#products .product").count(), 33);

console.log("OK: publicación de extremo a extremo, 8 escenarios superados"); await b.close();
