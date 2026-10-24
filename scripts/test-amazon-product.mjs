// Pruebas sin red: simula las respuestas observadas en GitHub Actions (2026-10-24).
import assert from "node:assert/strict";
import handler from "../netlify/functions/amazon-product.mjs";

const AMZ = "https://www.amazon.com/dp/B0FRMK2DCW/ref=cm_sw_r?linkCode=ml1&tag=cestoria-20";
const captcha = '<html><head><title dir="ltr">Amazon.com</title></head><body><form action="/errors/validateCaptcha">Enter the characters you see below</form></body></html>';
const product = '<html><head><title>Amazon.com: Botella sensorial</title><meta name="description" content="Desc meta"></head><body>' +
  '<span id="productTitle" class="a-size-large">  Botella sensorial de brillos  </span>' +
  '<img alt="" id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/abc._AC_SL1500_.jpg" src="x.jpg">' +
  '<div id="feature-bullets"><ul><li><span class="a-list-item"> Agua y glitter </span></li><li><span class="a-list-item">Para niños</span></li></ul></div></body></html>';

let amazonBody = captcha;
const routes = {
  "https://link.amazon/B02KjkcGI": () => new Response("{}", { status: 302, headers: { location: "https://amzlinks.in/B02KjkcGI", "content-type": "application/json" } }),
  "https://amzlinks.in/B02KjkcGI": () => new Response("", { status: 302, headers: { location: AMZ } }),
  [AMZ]: () => new Response(amazonBody, { status: 200, headers: { "content-type": "text/html" } }),
  "https://link.amazon/B0i9VFs1": () => new Response("<title>403 Forbidden</title>", { status: 403, headers: { "content-type": "text/html" } }),
  "https://link.amazon/evil": () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest" } })
};
globalThis.fetch = async (url) => {
  const r = routes[String(url)];
  if (!r) throw new Error("URL inesperada en la prueba: " + url);
  return r();
};
const call = async url => (await handler(new Request("http://x/", { method: "POST", body: JSON.stringify({ url }) }))).json();

// 1. Cadena link.amazon -> amzlinks.in -> captcha: ya no se corta, detecta el captcha y no devuelve basura.
let r = await call("https://link.amazon/B02KjkcGI");
assert.equal(r.asin, "B0FRMK2DCW");
assert.equal(r.blocked, "captcha");
assert.equal(r.title, ""); assert.equal(r.description, ""); assert.equal(r.image, "");
assert.equal(r.url, "https://link.amazon/B02KjkcGI", "se conserva el enlace de afiliado original");
assert.equal(r.productUrl, "https://www.amazon.com/dp/B0FRMK2DCW");

// 2. Si Amazon entrega la página real, se extraen título, imagen y viñetas.
amazonBody = product;
r = await call("https://link.amazon/B02KjkcGI");
assert.equal(r.title, "Botella sensorial de brillos");
assert.equal(r.image, "https://m.media-amazon.com/images/I/abc._AC_SL1500_.jpg");
assert.equal(r.description, "Agua y glitter · Para niños");
assert.equal(r.source, "metadata");

// 3. Acortador que rechaza (403) -> mensaje claro.
r = await call("https://link.amazon/B0i9VFs1");
assert.match(r.note, /acortador link\.amazon respondió con estado 403/);

// 4. Seguridad: redirecciones fuera de Amazon y dominios no permitidos se rechazan.
r = await call("https://link.amazon/evil");
assert.match(r.note, /se detuvo por seguridad/);
const bad = await handler(new Request("http://x/", { method: "POST", body: JSON.stringify({ url: "https://example.com/" }) }));
assert.equal(bad.status, 400);

console.log("OK: 4 escenarios superados");
