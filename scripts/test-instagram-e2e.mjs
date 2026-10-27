// Prueba en navegador de la sección de Instagram del administrador y del enlace ?p= del catálogo.
// Requiere Playwright y un servidor estático de dist/ en el puerto indicado.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import admin from "../netlify/functions/instagram-admin.mjs";
import { __setInstagramStoreForTests, __setInstagramFetchForTests } from "../netlify/lib/instagram.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = "http://127.0.0.1:" + (process.argv[2] || 8765);
process.env.CATALOG_ADMIN_KEY = "clave-admin-larga-123";
const m = new Map();
__setInstagramStoreForTests(() => ({
  async get(k, o) { const v = m.get(k); return v === undefined ? null : (o?.type === "json" ? JSON.parse(v) : v); },
  async setJSON(k, v) { m.set(k, JSON.stringify(v)); return { modified: true }; },
  async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  async delete(k) { m.delete(k); }
}));
__setInstagramFetchForTests(async url => {
  const u = String(url);
  if (u.includes("/me?fields")) return Response.json({ user_id: "17841424417134943", username: "cestoriashop" });
  if (u.includes("/me/media")) return Response.json({ data: [{ id: "18000000000000001", caption: "¿Buscas juegos sensoriales?", media_type: "VIDEO", thumbnail_url: "https://cdn.ig/t.jpg", permalink: "https://www.instagram.com/reel/abc/", timestamp: "2026-10-24T11:34:00+0000" }, { id: "18000000000000002", caption: "Otro reel", media_type: "VIDEO", thumbnail_url: "https://cdn.ig/t2.jpg", permalink: "https://www.instagram.com/reel/def/", timestamp: "2026-10-23T11:34:00+0000" }] });
  if (u.includes("subscribed_apps")) return Response.json(u.includes("subscribed_fields") ? { success: true } : { data: [{ subscribed_fields: ["comments"] }] });
  return new Response("{}", { status: 404 });
});
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.route("**/.netlify/functions/catalog", r => r.fulfill({ status: 404, body: "{}" }));
await ctx.route("**/.netlify/functions/store-products*", r => r.fulfill({ contentType: "application/json", body: JSON.stringify({ country: "CO", currency: "COP", items: [{ id: "tienda-nebulizador", title: "Nebulizador ultrasónico", url: "https://cestoria.shop/producto/nebulizador", image: "", categoryName: "Salud", price: 80000 }] }) }));
await ctx.route("**/.netlify/functions/instagram-admin", async r => {
  const q = r.request();
  const res = await admin(new Request("https://catalogo.test/.netlify/functions/instagram-admin", { method: "POST", headers: q.headers(), body: q.postData() }), { deploy: { context: "production" } });
  r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
});
const p = await ctx.newPage(); p.on("dialog", d => d.accept());
await p.goto(BASE + "/admin.html"); await p.waitForFunction(() => document.querySelectorAll("#productList .item").length > 0);
const status = () => p.textContent("#igStatus");
// Sin clave
await p.click("#igStatusBtn"); await p.waitForFunction(() => /clave de publicación/.test(document.querySelector("#igStatus").textContent));
await p.fill("#adminKey", "clave-admin-larga-123");
await p.click("#igStatusBtn"); await p.waitForFunction(() => /Falta configurar/.test(document.querySelector("#igStatus").textContent));
assert.equal(await p.evaluate(() => document.querySelector("#igSetup").open), true);
// Guardar configuración
await p.fill("#igSecret", "0123456789abcdef0123456789abcdef"); await p.fill("#igToken", "TOKEN");
await p.click("#igSaveBtn"); await p.waitForFunction(() => /Conectado a @cestoriashop/.test(document.querySelector("#igStatus").textContent));
assert.equal(await p.inputValue("#igSecret"), "", "no deja el secreto en pantalla");
assert.match(await p.textContent("#igHookInfo"), /instagram-webhook · Token de verificación: cestoria-/);
assert.match(await status(), /Avisos de comentarios: activos/);
// Publicaciones y asociación
await p.click("#igMediaBtn"); await p.waitForSelector('[data-ig-media="18000000000000001"]');
const opts = await p.$$eval('[data-ig-media="18000000000000001"] option', os => os.map(o => o.textContent));
assert.ok(opts.some(t => t.includes("[CO tienda] Nebulizador")) && opts.some(t => t.includes("PREPHY")), "productos propios y de la tienda");
const idx = opts.findIndex(t => t.includes("Nebulizador")) - 1;
await p.selectOption('[data-ig-media="18000000000000001"]', String(idx));
await p.waitForFunction(() => /Guardado: esa publicación responderá con «Nebulizador/.test(document.querySelector("#igStatus").textContent));
assert.equal(JSON.parse(m.get("posts/18000000000000001")).url, "https://cestoria.shop/producto/nebulizador");
// En la otra publicación, el producto ya usado pasa al final con la marca «✓ ya usado»
const other = await p.$$eval('[data-ig-media="18000000000000002"] option', os => os.map(o => o.textContent));
assert.match(other[other.length - 1], /^✓ ya usado · .*Nebulizador/, "usado al final y marcado");
assert.equal(other.filter(t => t.startsWith("✓")).length, 1);
// Al asociarla, la publicación se oculta; el botón la vuelve a mostrar
assert.equal(await p.isVisible('[data-ig-media="18000000000000001"]'), false, "asociada se oculta");
assert.match(await p.textContent("#igDoneBtn"), /Ver ya asociadas \(1\)/);
await p.click("#igDoneBtn"); assert.equal(await p.isVisible('[data-ig-media="18000000000000001"]'), true, "se puede volver a ver");
// Producto propio (Amazon) -> enlace a la ficha del catálogo ?p=
const prephy = opts.findIndex(t => t.includes("PREPHY")) - 1;
await p.selectOption('[data-ig-media="18000000000000001"]', String(prephy));
await p.waitForFunction(() => /PREPHY/.test(document.querySelector("#igStatus").textContent));
const link = JSON.parse(m.get("posts/18000000000000001")).url;
assert.match(link, /\/\?p=604713012$/);
// Recargar las publicaciones conserva la elección
await p.click("#igMediaBtn"); await p.waitForTimeout(400);
assert.equal(await p.isVisible('[data-ig-media="18000000000000001"]'), true, "sigue visible con «Ver ya asociadas» activo");
await p.click("#igDoneBtn"); assert.equal(await p.isVisible('[data-ig-media="18000000000000001"]'), false, "ocultar de nuevo");
assert.match(await p.$eval('[data-ig-media="18000000000000001"]', s => s.options[s.selectedIndex].textContent), /PREPHY/);
// El enlace ?p= abre solo ese producto en el catálogo
const pub = await ctx.newPage(); await pub.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
await pub.waitForFunction(() => document.querySelectorAll("#products .product").length === 1);
assert.match(await pub.textContent("#products"), /PREPHY/);
await pub.click("#showAll"); await pub.waitForFunction(() => document.querySelectorAll("#products .product").length > 1);
console.log("OK: Instagram en navegador, 12 escenarios superados"); await b.close();
