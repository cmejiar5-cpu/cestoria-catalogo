// Comprueba un despliegue real de Netlify (sin publicar nada). Uso: node scripts/check-deploy.mjs https://sitio.netlify.app
import assert from "node:assert/strict";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) throw new Error("Indica la URL base");
const get = async (path, init) => { const r = await fetch(base + path, init); console.log((init?.method || "GET").padEnd(4), path.padEnd(36), r.status, r.headers.get("content-type")); return r; };
assert.equal((await get("/")).status, 200);
assert.equal((await get("/admin.html")).status, 200);
assert.equal((await get("/icons/icon.svg")).status, 200);
assert.equal((await get("/cestoria_data.json")).status, 200);
for (const hidden of ["/node_modules/@netlify/blobs/package.json", "/netlify/functions/catalog.mjs", "/package.json", "/scripts/build.mjs"]) {
  assert.notEqual((await get(hidden)).status, 200, hidden + " no debe ser público");
}
const g = await get("/.netlify/functions/catalog");
assert.ok([200, 404].includes(g.status), "la función responde"); console.log("   ", (await g.text()).slice(0, 120));
for (const enc of ["gzip, deflate, br", "identity"]) {
  const e = await fetch(base + "/.netlify/functions/catalog", { headers: { "Accept-Encoding": enc } });
  console.log("    ETag (" + enc + "):", e.headers.get("etag"), "| content-encoding:", e.headers.get("content-encoding"), "| x-saved-at:", e.headers.get("x-saved-at")); await e.arrayBuffer();
}
const p = await get("/.netlify/functions/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verify: true }) });
assert.ok([401, 503].includes(p.status), "sin clave no se puede publicar"); console.log("   ", await p.text());
const a = await get("/.netlify/functions/amazon-product", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://link.amazon/B02KjkcGI" }) });
const aj = await a.json(); console.log("    importador:", aj.source, aj.asin, (aj.title || "").slice(0, 60), aj.image ? "con imagen" : "sin imagen");
for (const q of ["", "?mercados=todos", "?pais_override=PE"]) {
  const f = await get("/feed-whatsapp.csv" + q); const t = await f.text();
  assert.equal(f.status, 200, "feed " + q); console.log("    filas:", t.trim().split("\r\n").length - 1, "|", t.split("\r\n")[0].slice(0, 80));
}
for (const c of ["CO", "PE", "EC"]) {
  const r = await get("/.netlify/functions/store-products?pais=" + c); const d = await r.json();
  console.log("    tienda " + c + ":", d.country, d.items.length, "productos", d.error || "");
}
const geo = await (await get("/.netlify/functions/store-products")).json();
console.log("    país detectado para el servidor de pruebas:", geo.country, "(detectado:", geo.detected + ")");
assert.equal((await get("/privacidad.html")).status, 200);
const v = await get("/instagram-webhook?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=1");
assert.equal(v.status, 403, "el webhook rechaza tokens de verificación incorrectos");
const w = await get("/instagram-webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
assert.ok([401, 503].includes(w.status), "el webhook rechaza avisos sin firma"); console.log("   ", await w.text());
const ia = await get("/.netlify/functions/instagram-admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) });
assert.equal(ia.status, 401, "la gestión de Instagram exige la clave");
const one = await get("/?p=604713012"); assert.equal(one.status, 200);
console.log("OK: despliegue verificado en " + base);
