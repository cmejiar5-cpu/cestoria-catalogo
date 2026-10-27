// Prueba en navegador del tipo «Contenido o app aliada». Requiere dist/ servido en el puerto indicado (8765 por defecto).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = "http://127.0.0.1:" + (process.argv[2] || 8765);
const catalog = { store_name: "Cestoria", categories: [
  { id: "c1", name: "Montessori", items: [{ id: "p1", title: "Tren de madera", url: "https://amzn.to/abc", type: "AMAZON_PRODUCT", image: "" }] },
  { id: "c2", name: "Aprende con nuestros aliados", items: [{ id: "a1", title: "Club Animalitos", url: "https://www.youtube.com/@clubanimalitos", type: "ALLY_CONTENT", image: "" }] }] };
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.route("**/.netlify/functions/catalog", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalog) }));
await ctx.route("**/.netlify/functions/store-products**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ country: "CO", items: [] }) }));
const p = await ctx.newPage();
await p.goto(BASE + "/?p=a1"); await p.waitForFunction(() => document.querySelectorAll("#products .product").length === 1);
const card = await p.textContent("#products");
assert.match(card, /Club Animalitos/); assert.match(card, /Ver contenido ↗/); assert.doesNotMatch(card, /Comprar en Amazon|Ver producto/);
const a = await ctx.newPage(); await a.goto(BASE + "/admin.html"); await a.waitForTimeout(500);
await a.selectOption("#type", "ALLY_CONTENT");
assert.equal(await a.inputValue("#category"), "Aprende con nuestros aliados", "categoría sugerida");
await a.fill("#category", "Otra"); await a.selectOption("#type", "CLASSIC"); await a.selectOption("#type", "ALLY_CONTENT");
assert.equal(await a.inputValue("#category"), "Otra", "no pisa una categoría escrita");
console.log("OK: contenido aliado en navegador, 6 escenarios superados"); await b.close();
