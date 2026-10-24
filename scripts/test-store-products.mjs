// Pruebas sin red de la función store-products (productos de la tienda por país).
import assert from "node:assert/strict";
import handler, { toCatalogItems } from "../netlify/functions/store-products.mjs";
import { resolveCountry } from "../netlify/lib/store.mjs";

const row = (slug, price, extra = {}) => ({ price, compare_price: null, stock: 3, products: { slug, name: "P " + slug, image_url: "https://cdn.x/" + slug + ".jpg", image_urls: [], product_categories: [{ categories: { name: "Salud" } }] }, ...extra });
const items = toCatalogItems([row("tensiometro", 79000, { compare_price: 99000 }), row("agotado", 5000, { stock: 0 }), row("cero", 0), { price: 1, stock: 1, products: { slug: "", name: "x" } }]);
assert.equal(items.length, 1);
assert.deepEqual(items[0], { id: "tienda-tensiometro", title: "P tensiometro", url: "https://cestoria.shop/producto/tensiometro", image: "https://cdn.x/tensiometro.jpg", categoryName: "Salud", price: 79000, compare_price: 99000, type: "COMMERCE_PRODUCT", source: "tienda" });
assert.equal(resolveCountry("pe"), "PE"); assert.equal(resolveCountry("US"), "CO"); assert.equal(resolveCountry(""), "CO");

let asked = [];
globalThis.fetch = async url => { asked.push(String(url)); return new Response(JSON.stringify([row("a", 10)]), { status: 200 }); };
let r = await (await handler(new Request("http://x/"), { geo: { country: { code: "PE" } } })).json();
assert.equal(r.country, "PE"); assert.equal(r.currency, "PEN"); assert.equal(r.detected, true); assert.match(asked.at(-1), /country_code=eq\.PE/);
r = await (await handler(new Request("http://x/?pais=EC"), { geo: { country: { code: "PE" } } })).json();
assert.equal(r.country, "EC"); assert.equal(r.detected, false);
r = await (await handler(new Request("http://x/"), { geo: { country: { code: "ES" } } })).json();
assert.equal(r.country, "CO", "otros países ven Colombia, como la tienda");
globalThis.fetch = async () => new Response("x", { status: 503 });
const res = await handler(new Request("http://x/"), {}); r = await res.json();
assert.equal(res.status, 200); assert.deepEqual(r.items, []); assert.ok(r.error);
console.log("OK: productos de la tienda por país, 12 comprobaciones superadas");
