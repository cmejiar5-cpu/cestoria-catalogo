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
// El CSV de aliados se importa como «Contenido o app aliada»
a.on("dialog", d => d.accept());
await a.setInputFiles("#csvInput", new URL("../docs/aliados_cestoria.csv", import.meta.url).pathname);
await a.waitForFunction(() => /Club Animalitos – Juego/.test(document.querySelector("#productList").textContent));
const drafts = JSON.parse(await a.evaluate(() => localStorage.getItem("cestoria-drafts")) || "[]");
const allies = drafts.filter(d => d.type === "ALLY_CONTENT");
assert.equal(allies.length, 3, "3 aliados importados"); assert.ok(allies.every(d => d.categoryName === "Aprende con nuestros aliados"));
// «Ver/editar» lleva al formulario (no al principio de la página)
await a.setViewportSize({ width: 390, height: 700 });
await a.click('[data-edit]');
await a.waitForTimeout(800);
const box = await a.$eval("#formTitle", e => e.getBoundingClientRect().top);
assert.ok(box >= -5 && box < 700, "el formulario queda a la vista");
assert.equal(await a.textContent("#formTitle"), "Revisar producto");
console.log("OK: contenido aliado en navegador, 10 escenarios superados"); await b.close();
