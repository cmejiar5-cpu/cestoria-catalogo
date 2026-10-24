const reply = (statusCode, data) => new Response(JSON.stringify(data), {
  status: statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

const isAmazonHost = host => /(^|\.)amazon\.(com|co\.uk|ca|es|com\.mx|de|fr|it|co\.jp|in|com\.au|com\.br)$/i.test(host);
const isShortHost = host => ["amzn.to", "link.amazon"].includes(host.toLowerCase());

function attr(tag, name) {
  const pattern = new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = tag.match(pattern);
  return match ? (match[1] || match[2] || match[3] || "").trim() : "";
}
function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
function meta(html, property) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = attr(tag, "property") || attr(tag, "name");
    if (key.toLowerCase() === property.toLowerCase()) return cleanText(attr(tag, "content"));
  }
  return "";
}
function getAsin(url) {
  const match = url.match(/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i) || url.match(/[?&]asin=([A-Z0-9]{10})/i);
  return match ? match[1].toUpperCase() : "";
}
async function getAllowedPage(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Introduce un enlace válido."); }
  if (!["https:", "http:"].includes(url.protocol) || !(isAmazonHost(url.hostname) || isShortHost(url.hostname))) {
    throw new Error("Solo se aceptan enlaces de Amazon o amzn.to.");
  }
  let response;
  for (let i = 0; i < 7; i++) {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CestoriaCatalog/1.0)", "Accept": "text/html,application/xhtml+xml" }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Amazon devolvió una redirección sin destino.");
      const next = new URL(location, url);
      if (!isAmazonHost(next.hostname) && !isShortHost(next.hostname)) {
        throw new Error("El enlace redirige fuera de Amazon; se detuvo por seguridad.");
      }
      url = next;
      continue;
    }
    break;
  }
  if (!response || response.status < 200 || response.status >= 300) throw new Error("Amazon no permitió leer la página automáticamente.");
  if (!(response.headers.get("content-type") || "").includes("text/html")) throw new Error("La página de destino no devolvió HTML de producto.");
  return { url, html: (await response.text()).slice(0, 1500000) };
}
export default async function handler(request) {
  if (request.method !== "POST") return reply(405, { error: "Método no permitido." });
  let body;
  try { body = await request.json(); }
  catch { return reply(400, { error: "Solicitud JSON no válida." }); }
  if (!body || typeof body.url !== "string" || body.url.length > 2048) return reply(400, { error: "Introduce un enlace válido." });

  try {
    const input = new URL(body.url);
    if (!["https:", "http:"].includes(input.protocol) || !(isAmazonHost(input.hostname) || isShortHost(input.hostname))) {
      return reply(400, { error: "Solo se aceptan enlaces de Amazon o amzn.to." });
    }
  } catch {
    return reply(400, { error: "Introduce un enlace válido." });
  }

  try {
    const page = await getAllowedPage(body.url);
    const titleTag = (page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    const title = meta(page.html, "og:title") || meta(page.html, "twitter:title") || cleanText(titleTag);
    const description = meta(page.html, "og:description") || meta(page.html, "description") || meta(page.html, "twitter:description");
    let image = meta(page.html, "og:image") || meta(page.html, "twitter:image");
    if (image) { try { image = new URL(image, page.url).href; } catch { image = ""; } }
    if (title || description || image) {
      return reply(200, {
        title, description: cleanText(description).slice(0, 500), image, url: body.url,
        source: "metadata",
        note: "Datos recuperados de metadatos públicos; verifica antes de guardar."
      });
    }
    return reply(200, {
      title: "", description: "", image: "", url: body.url,
      source: "manual",
      note: "Amazon no expuso metadatos suficientes. Completa el título, la descripción y la imagen manualmente; el enlace original se conserva."
    });
  } catch (error) {
    return reply(200, {
      title: "", description: "", image: "", url: body.url,
      source: "manual",
      note: "No fue posible leer la página de Amazon automáticamente. Puede bloquear consultas automatizadas. Completa los campos manualmente; el enlace original se conserva."
    });
  }
}
