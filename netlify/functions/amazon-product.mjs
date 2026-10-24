const reply = (statusCode, data) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  },
  body: JSON.stringify(data)
});

const isAmazonHost = host => /(^|\\.)amazon\\.(com|co\\.uk|ca|es|com\\.mx|de|fr|it|co\\.jp|in|com\\.au|com\\.br)$/i.test(host);
const isShortHost = host => ["amzn.to", "link.amazon"].includes(host.toLowerCase());

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function meta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
  const patterns = [
    new RegExp('<meta[^>]+(?:property|name)=["\\']' + escaped + '["\\'][^>]+content=["\\']([^"\\']*)["\\'][^>]*>', "i"),
    new RegExp('<meta[^>]+content=["\\']([^"\\']*)["\\'][^>]+(?:property|name)=["\\']' + escaped + '["\\'][^>]*>', "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1].trim());
  }
  return "";
}
function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ")).trim();
}
function getAsin(url) {
  const match = url.match(/(?:dp|gp\\/product|product)\\/([A-Z0-9]{10})/i) || url.match(/[?&]asin=([A-Z0-9]{10})/i);
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
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error("Amazon no permitió leer la página automáticamente.");
  }
  if (!(response.headers.get("content-type") || "").includes("text/html")) {
    throw new Error("La página de destino no devolvió HTML de producto.");
  }
  return { url, html: (await response.text()).slice(0, 1500000) };
}
async function braveSearch(originalUrl) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error("Falta configurar BRAVE_SEARCH_API_KEY en Netlify.");
  const asin = getAsin(originalUrl);
  const query = asin ? `Amazon product ${asin}` : `${originalUrl} Amazon product title description`;
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("country", "US");
  endpoint.searchParams.set("search_lang", "en");
  endpoint.searchParams.set("count", "5");
  const response = await fetch(endpoint, {
    headers: { "Accept": "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const err = new Error(response.status === 401 || response.status === 403
      ? "Brave rechazó la clave. Verifica BRAVE_SEARCH_API_KEY y vuelve a publicar en Netlify."
      : `Brave Search respondió con el estado ${response.status}.`);
    err.statusCode = 502;
    throw err;
  }
  const data = await response.json();
  const results = data.web?.results || [];
  const chosen = results.find(item => {
    try { const host = new URL(item.url).hostname; return isAmazonHost(host) || isShortHost(host); }
    catch { return false; }
  }) || results[0];
  if (!chosen) {
    const err = new Error("Brave no encontró resultados útiles para este enlace. Completa los datos manualmente.");
    err.statusCode = 404;
    throw err;
  }
  return {
    title: cleanText(chosen.title || ""),
    description: cleanText(chosen.description || "").slice(0, 500),
    image: "",
    source: "brave-search",
    note: "Datos sugeridos por resultados de búsqueda web. Verifica el nombre y la descripción antes de publicar."
  };
}

export default async function handler(event) {
  if (event.httpMethod !== "POST") return reply(405, { error: "Método no permitido." });
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return reply(400, { error: "Solicitud JSON no válida." }); }
  if (typeof body.url !== "string" || body.url.length > 2048) return reply(400, { error: "Introduce un enlace válido." });
  let inputUrl;
  try {
    inputUrl = new URL(body.url);
    if (!["https:", "http:"].includes(inputUrl.protocol) || !(isAmazonHost(inputUrl.hostname) || isShortHost(inputUrl.hostname))) {
      return reply(400, { error: "Solo se aceptan enlaces de Amazon o amzn.to." });
    }
  } catch { return reply(400, { error: "Introduce un enlace válido." }); }

  try {
    try {
      const { url, html } = await getAllowedPage(body.url);
      const title = meta(html, "og:title") || meta(html, "twitter:title") || cleanText((html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i) || [])[1] || "");
      const description = meta(html, "og:description") || meta(html, "description") || meta(html, "twitter:description");
      let image = meta(html, "og:image") || meta(html, "twitter:image");
      if (image) { try { image = new URL(image, url).href; } catch { image = ""; } }
      if (title || description || image) {
        return reply(200, {
          title: cleanText(title), description: cleanText(description).slice(0, 500),
          image, url: body.url, source: "metadata",
          note: "Datos recuperados de metadatos públicos; verifica su exactitud antes de publicar."
        });
      }
    } catch (pageError) {
      // If Amazon blocks or fails, try public web search below.
    }
    const result = await braveSearch(body.url);
    return reply(200, { ...result, url: body.url });
  } catch (error) {
    const searchUrl = "https://search.brave.com/search?q=" + encodeURIComponent(body.url + " Amazon product");
    return reply(Number.isInteger(error.statusCode) ? error.statusCode : 502, {
      error: error.message || "No fue posible recuperar los datos.",
      searchUrl
    });
  }
}
