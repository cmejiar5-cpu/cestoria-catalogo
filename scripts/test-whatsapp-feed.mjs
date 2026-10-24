// Pruebas sin red del feed para WhatsApp/Meta.
import assert from "node:assert/strict";
import handler, { buildItems, toCsv, fetchStoreRows } from "../netlify/functions/whatsapp-feed.mjs";

const rows = [
  { price: 89900, compare_price: 119900, stock: 5, products: { slug: "tensiometro-digital", name: "Tensiómetro digital de brazo", description: "<p>Mide la presión, &amp; pulso</p>", image_url: "https://cdn.x/t1.jpg", image_urls: ["https://cdn.x/t1.jpg", "https://cdn.x/t2.jpg"], product_categories: [{ categories: { name: "Salud" } }] } },
  { price: 50000, compare_price: null, stock: 0, products: { slug: "lampara", name: "Lámpara, sensor \"LED\"", description: "", image_url: "https://cdn.x/l.jpg", image_urls: [] } },
  { price: 30000, stock: 3, products: { slug: "sin-foto", name: "Sin foto", description: "x", image_url: null, image_urls: [] } },
  { price: 30000, stock: 3, products: { slug: "foto-relativa", name: "Foto interna", description: "x", image_url: "/assets/a.jpg", image_urls: [] } },
  { price: 0, stock: 3, products: { slug: "gratis", name: "Precio cero", image_url: "https://cdn.x/g.jpg" } }
];
const { items, skipped } = buildItems(rows, "CO");
assert.equal(items.length, 2);
assert.deepEqual(skipped.map(s => s.name), ["Sin foto", "Foto interna", "Precio cero"]);
const t = items[0];
assert.equal(t.price, "119900.00 COP"); assert.equal(t.sale_price, "89900.00 COP");
assert.equal(t.availability, "in stock"); assert.equal(t.link, "https://cestoria.shop/producto/tensiometro-digital");
assert.equal(t.description, "Mide la presión, & pulso"); assert.equal(t.additional_image_link, "https://cdn.x/t2.jpg");
assert.equal(t.product_type, "Salud");
assert.equal(items[1].availability, "out of stock"); assert.equal(items[1].sale_price, ""); assert.equal(items[1].description, items[1].title);
const csv = toCsv(items);
assert.ok(csv.startsWith("id,title,description,availability,condition,price,sale_price,link,image_link"));
assert.ok(csv.includes('"Lámpara, sensor ""LED"""'), "comillas y comas escapadas");
assert.equal(csv.trim().split("\r\n").length, 3);

// La consulta a la tienda es solo lectura (GET) y filtra activos de Colombia
let seen;
await fetchStoreRows("CO", async (url, init) => { seen = { url, init }; return new Response("[]", { status: 200 }); });
assert.equal(seen.init.method, undefined, "GET");
assert.match(seen.url, /\/rest\/v1\/product_prices\?select=.*&country_code=eq\.CO&is_active=eq\.true/);
await assert.rejects(fetchStoreRows("CO", async () => new Response("x", { status: 500 })), /500/);

// Handler: país inválido y método
assert.equal((await handler(new Request("http://x/feed-whatsapp.csv?pais=XX"))).status, 400);
assert.equal((await handler(new Request("http://x/feed-whatsapp.csv", { method: "POST" }))).status, 405);
console.log("OK: feed de WhatsApp, 17 comprobaciones superadas");
