// Prueba en navegador: el catálogo general muestra los productos de la tienda según el país.
// Requiere Playwright y un servidor estático de dist/ en el puerto indicado.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import handler from "../netlify/functions/store-products.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = "http://127.0.0.1:" + (process.argv[2] || 8765);
const row = (slug, name, price, cat) => ({ price, compare_price: null, stock: 4, products: { slug, name, image_url: "https://cdn.x/" + slug + ".jpg", image_urls: [], product_categories: [{ categories: { name: cat } }] } });
let geo0;const DATA = {
  CO: [row("tensiometro-de-muneca-mas-oximetro-ds2901", "Tensiometro de muñeca mas Oximetro", 79000, "Salud"), row("nebulizador-ultrasonico", "Nebulizador ultrasónico", 80000, "Salud")],
  PE: [row("smartwatch-hk11", "Smartwatch HK11 Pro Max", 99, "Tecnología")],
  EC: []
};
const realFetch = globalThis.fetch;
globalThis.fetch = async url => { const c = String(url).match(/country_code=eq\.(\w+)/)[1]; return new Response(JSON.stringify(DATA[c])); };
let geo = "CO";
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.route("**/.netlify/functions/catalog", r => r.fulfill({ status: 404, body: "{}" }));
await ctx.route("**/.netlify/functions/store-products*", async r => {
  const res = await handler(new Request(r.request().url()), { geo: { country: { code: geo } } });
  r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
});
const p = await ctx.newPage();
const cards = () => p.locator("#products .product").count();
const waitStore = name => p.waitForFunction(n => document.querySelector("#products").textContent.includes(n), name);

// Visitante en Colombia
await p.goto(BASE + "/index.html"); await waitStore("Nebulizador");
assert.equal(await cards(), 33, "32 propios + 1 de la tienda (el tensiómetro no se duplica)");
const tens = p.locator("#products .product", { hasText: "Tensiometro de muñeca" });
assert.equal(await tens.count(), 1); assert.match(await tens.locator(".price").textContent(), /79\.000/);
const neb = p.locator("#products .product", { hasText: "Nebulizador" });
assert.match(await neb.locator("a.btn").textContent(), /pago contra entrega/i);
assert.ok((await p.textContent("#chips")).includes("Salud"));
assert.equal(await p.locator("#country").count(), 0, "sin selector manual");

// Visitante en Perú: solo ve los productos de la tienda de Perú
geo = "PE"; await p.reload(); await waitStore("Smartwatch");
assert.equal(await cards(), 32, "31 propios (sin el tensiómetro) + smartwatch");
assert.equal(await p.locator("#products .product", { hasText: "Tensiometro de muñeca" }).count(), 0);
assert.match(await p.locator("#products .product", { hasText: "Smartwatch" }).locator(".price").textContent(), /S\/\s?99/);

assert.equal(await p.locator("#products .product", { hasText: "Nebulizador" }).count(), 0);
// Visitante de otro país (España): ve Colombia, como en la tienda
geo = "ES"; await p.reload(); await waitStore("Nebulizador");
assert.equal(await p.locator("#products .product", { hasText: "Smartwatch" }).count(), 0);

// ?pais= solo para pruebas
const ctx2 = await b.newContext(); geo = "PE";
await ctx2.route("**/.netlify/functions/catalog", r => r.fulfill({ status: 404, body: "{}" }));
await ctx2.route("**/.netlify/functions/store-products*", async r => { const res = await handler(new Request(r.request().url()), { geo: { country: { code: geo } } }); r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() }); });
geo = "CO"; const p2 = await ctx2.newPage(); await p2.goto(BASE + "/index.html?pais=PE");
await p2.waitForFunction(() => document.querySelector("#products").textContent.includes("Smartwatch"));

// Si la tienda falla, el catálogo sigue con sus productos
globalThis.fetch = async () => new Response("x", { status: 500 });
const p3 = await (await b.newContext()).newPage();
await p3.route("**/.netlify/functions/catalog", r => r.fulfill({ status: 404, body: "{}" }));
await p3.route("**/.netlify/functions/store-products*", async r => { const res = await handler(new Request(r.request().url()), {}); r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() }); });
await p3.goto(BASE + "/index.html"); await p3.waitForFunction(() => document.querySelectorAll("#products .product").length > 0); await p3.waitForTimeout(500);
assert.equal(await p3.locator("#products .product").count(), 32);
globalThis.fetch = realFetch;
console.log("OK: catálogo por país en navegador, 6 escenarios superados"); await b.close();
