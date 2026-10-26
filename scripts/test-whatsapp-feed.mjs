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

// ---- Opción B: tres mercados ----
import { buildAllMarkets, buildCountryOverride } from "../netlify/functions/whatsapp-feed.mjs";
const r3 = (slug, price, stock = 2) => ({ price, compare_price: null, stock, products: { slug, name: "N " + slug, description: "d", image_url: "https://cdn.x/" + slug + ".jpg", image_urls: [] } });
const all = buildAllMarkets({ CO: [r3("comun", 50000), r3("solo-co", 60000)], PE: [r3("comun", 49), r3("solo-pe", 99, 0)], EC: [] });
assert.deepEqual(all.items.map(i => [i.id, i.mercados.join("+"), i.price]), [["comun", "CO+PE", "50000.00 COP"], ["solo-co", "CO", "60000.00 COP"], ["solo-pe", "PE", "99.00 PEN"]]);
const pe = buildCountryOverride(all, "PE");
assert.deepEqual(pe.map(r => [r.id, r.override, r.price, r.availability]), [["comun", "PE", "49.00 PEN", "in stock"], ["solo-co", "PE", "", "out of stock"], ["solo-pe", "PE", "99.00 PEN", "out of stock"]]);
const ec = buildCountryOverride(all, "EC");
assert.ok(ec.every(r => r.availability === "out of stock" && r.override === "EC"), "Ecuador sin productos: todo agotado");
globalThis.fetch = async url => { const c = String(url).match(/country_code=eq\.(\w+)/)[1]; return new Response(JSON.stringify(c === "CO" ? [r3("comun", 50000)] : c === "PE" ? [r3("solo-pe", 99)] : [])); };
let res = await handler(new Request("http://x/feed-whatsapp.csv?mercados=todos"));
let body = await res.text();
assert.equal(body.trim().split("\r\n").length, 3, "cabecera + 2 productos");
res = await handler(new Request("http://x/feed-whatsapp.csv?pais_override=PE"));
body = await res.text();
assert.ok(body.startsWith("id,override,price,sale_price,availability,link"));
assert.ok(body.includes("comun,PE,,,out of stock,") && body.includes("solo-pe,PE,99.00 PEN,,in stock,https://cestoria.shop/producto/solo-pe"));
assert.equal((await handler(new Request("http://x/feed-whatsapp.csv?pais_override=US"))).status, 400);
res = await handler(new Request("http://x/feed-whatsapp.csv"));
assert.equal((await res.text()).trim().split("\r\n").length, 2, "opción A sigue siendo solo Colombia");
console.log("OK: feed de tres mercados, 9 comprobaciones superadas");

// Identificadores largos: estables, únicos y de 80 caracteres o menos
import { feedId } from "../netlify/functions/whatsapp-feed.mjs";
const long = "mesa-educativa-con-proyector-didactico-para-dibujar-tablero-multifuncional-con-proyeccion-de-figuras-ds2901";
assert.ok(feedId(long).length <= 80); assert.equal(feedId(long), feedId(long));
assert.notEqual(feedId(long), feedId(long + "x")); assert.equal(feedId("corto-ds2901"), "corto-ds2901");
console.log("OK: identificadores largos, 4 comprobaciones superadas");
