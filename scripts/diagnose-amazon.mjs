// Diagnóstico: compara la lectura estilo Lovable (fetch + redirect follow)
// con la función de Netlify del repo y con la función desplegada.
import handler from "../netlify/functions/amazon-product.mjs";

const links = process.argv.slice(2);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DEPLOYED = "https://catalogo-cestoriashop-git.netlify.app/.netlify/functions/amazon-product";

function summarize(html) {
  const m = re => (html.match(re) || [])[1] || "";
  return {
    length: html.length,
    title: m(/<title[^>]*>([\s\S]*?)<\/title>/i).trim().slice(0, 160),
    ogTitle: m(/property=["']og:title["'][^>]*content=["']([^"']*)/i).slice(0, 160),
    ogImage: m(/property=["']og:image["'][^>]*content=["']([^"']*)/i).slice(0, 200),
    productTitle: m(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i).replace(/\s+/g, " ").trim().slice(0, 160),
    landingImage: m(/id=["']landingImage["'][^>]*data-old-hires=["']([^"']+)/i) || m(/"hiRes":"([^"]+)"/),
    captcha: /captcha|robot check|validateCaptcha|api-services-support@amazon/i.test(html),
    metaRefresh: m(/http-equiv=["']refresh["'][^>]*content=["']([^"']*)/i),
    jsLocation: m(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)/i).slice(0, 200)
  };
}

async function chain(url, headers) {
  const hops = [];
  let u = new URL(url);
  for (let i = 0; i < 8; i++) {
    const r = await fetch(u, { redirect: "manual", headers });
    const loc = r.headers.get("location");
    hops.push({ url: u.href.slice(0, 200), status: r.status, type: r.headers.get("content-type"), location: loc && loc.slice(0, 200) });
    if (loc && r.status >= 300 && r.status < 400) { u = new URL(loc, u); continue; }
    const html = await r.text();
    return { hops, final: summarize(html), snippet: html.replace(/\s+/g, " ").slice(0, 600) };
  }
  return { hops };
}

for (const link of links) {
  console.log("\n==================== " + link);
  for (const [name, headers] of Object.entries({
    lovable: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "es-CO,es;q=0.9,en;q=0.8" },
    noUA: {}
  })) {
    try { console.log("-- chain/" + name, JSON.stringify(await chain(link, headers), null, 1)); }
    catch (e) { console.log("-- chain/" + name + " ERROR", String(e)); }
  }
  try {
    const res = await handler(new Request("http://local/fn", { method: "POST", body: JSON.stringify({ url: link }) }));
    const j = await res.json(); delete j.markdown;
    console.log("-- repo handler (runner)", JSON.stringify(j, null, 1));
  } catch (e) { console.log("-- repo handler ERROR", String(e)); }
  try {
    const res = await fetch(DEPLOYED, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link }) });
    const t = await res.text();
    let j; try { j = JSON.parse(t); delete j.markdown; } catch { j = t.slice(0, 500); }
    console.log("-- deployed Netlify (" + res.status + ")", JSON.stringify(j, null, 1));
  } catch (e) { console.log("-- deployed ERROR", String(e)); }
}
