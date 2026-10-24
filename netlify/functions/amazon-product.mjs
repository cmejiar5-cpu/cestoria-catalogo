const reply = (statusCode, data) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  body: JSON.stringify(data)
});

const isAmazonHost = host => /(^|\\.)amazon\\.(com|co\\.uk|ca|es|com\\.mx|de|fr|it|co\\.jp|in|com\\.au|com\\.br)$/i.test(host);
const isShortHost = host => host.toLowerCase() === "amzn.to";

function decodeEntities(s = "") {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function meta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
  const patterns = [
    new RegExp('<meta[^>]+(?:property|name)=[\\"\\']' + escaped + '[\\"\\'][^>]+content=[\\"\\']([^\\"\\']*)[\\"\\'][^>]*>', "i"),
    new RegExp('<meta[^>]+content=[\\"\\']([^\\"\\']*)[\\"\\'][^>]+(?:property|name)=[\\"\\']' + escaped + '[\\"\\'][^>]*>', "i")
  ];
  for (const p of patterns) { const m = html.match(p); if (m) return decodeEntities(m[1].trim()); }
  return "";
}
function cleanText(s) { return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ")).trim(); }

async function getAllowedPage(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Introduce un enlace válido."); }
  if (!["https:", "http:"].includes(url.protocol) || !(isAmazonHost(url.hostname) || isShortHost(url.hostname))) throw new Error("Solo se aceptan enlaces de Amazon o amzn.to.");
  let response;
  for (let i = 0; i < 7; i++) {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CestoriaCatalog/1.0)", "Accept": "text/html,application/xhtml+xml" }
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Amazon devolvió una redirección sin destino.");
      const next = new URL(location, url);
      if (!isAmazonHost(next.hostname) && !isShortHost(next.hostname)) throw new Error("El enlace redirige fuera de Amazon; se detuvo por seguridad.");
      url = next;
      continue;
    }
    break;
  }
  if (!response || response.status < 200 || response.status >= 300) {
    const e = new Error("Amazon no permitió leer la página automáticamente. Puedes completar los campos manualmente o abrir la búsqueda web sugerida.");
    e.statusCode = 502;
    throw e;
  }
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) throw new Error("La página de destino no devolvió HTML de producto.");
  const html = (await response.text()).slice(0, 1_500_000);
  return { url, html, status: response.status };
}

export default async function handler(event) {
  if (event.httpMethod !== "POST") return reply(405, { error: "Método no permitido." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Solicitud JSON no válida." }); }
  if (typeof body.url !== "string" || body.url.length > 2048) return reply(400, { error: "Introduce un enlace válido." });
  try {
    const { url, html } = await getAllowedPage(body.url);
    const title = meta(html, "og:title") || meta(html, "twitter:title") || cleanText((html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i) || [])[1] || "");
    const description = meta(html, "og:description") || meta(html, "description") || meta(html, "twitter:description");
    let image = meta(html, "og:image") || meta(html, "twitter:image");
    if (image) { try { image = new URL(image, url).href; } catch { image = ""; } }
    if (!title && !description && !image) {
      const e = new Error("Amazon cargó una página sin metadatos legibles; probablemente bloqueó la consulta automatizada. Completa la ficha manualmente o usa la búsqueda web.");
      e.statusCode = 502;
      throw e;
    }
    return reply(200, {
      title: cleanText(title),
      description: cleanText(description).slice(0, 500),
      image,
      url: body.url,
      source: "metadata",
      note: "Datos recuperados de metadatos públicos; verifica su exactitud antes de publicar."
    });
  } catch (e) {
    const searchUrl = "https://www.google.com/search?q=" + encodeURIComponent(body.url + " producto descripción");
    return reply(Number.isInteger(e.statusCode) ? e.statusCode : 400, { error: e.message || "No fue posible recuperar los datos.", searchUrl });
  }
}
