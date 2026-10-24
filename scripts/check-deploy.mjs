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
const p = await get("/.netlify/functions/catalog", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verify: true }) });
assert.ok([401, 503].includes(p.status), "sin clave no se puede publicar"); console.log("   ", await p.text());
const a = await get("/.netlify/functions/amazon-product", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://link.amazon/B02KjkcGI" }) });
const aj = await a.json(); console.log("    importador:", aj.source, aj.asin, (aj.title || "").slice(0, 60), aj.image ? "con imagen" : "sin imagen");
console.log("OK: despliegue verificado en " + base);
