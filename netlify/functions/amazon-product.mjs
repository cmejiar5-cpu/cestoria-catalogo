const reply = (statusCode, data) => new Response(JSON.stringify(data), {
  status: statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

const isAmazonHost = host => /(^|\\.)amazon\\.(com|co\\.uk|ca|es|com\\.mx|de|fr|it|co\\.jp|in|com\\.au|com\\.br)$/i.test(host);
const isShortHost = host => ["amzn.to", "link.amazon"].includes(host.toLowerCase());
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function decode(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([\\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function attr(tag, name) {
  const pattern = new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = tag.match(pattern);
  return match ? decode(match[1] || match[2] || match[3] || "").trim() : "";
}
function cleanText(value) {
  return decode(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\\s+/g, " ").trim();
}
function meta(html, property) {
  const tags = html.match(/<meta\\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = attr(tag, "property") || attr(tag, "name");
    if (key.toLowerCase() === property.toLowerCase()) {
      const value = attr(tag, "content");
      if (value) return value;
    }
  }
  return "";
}
function visibleText(html) {
  return cleanText(html
    .replace(/<(script|style|noscript|svg|head|nav|footer)[\\s\\S]*?<\\/\\1>/gi, " ")
    .replace(/<br\\s*\\/?\\s*>|<\\/(p|div|li|h[1-6]|tr)>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}
async function getAllowedPage(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Introduce un enlace válido."); }
  if (url.protocol !== "https:" || !(isAmazonHost(url.hostname) || isShortHost(url.hostname))) {
    throw new Error("Solo se aceptan enlaces HTTPS de Amazon o amzn.to.");
  }
  let response;
  for (let i = 0; i < 7; i++) {
    response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Amazon devolvió una redirección sin destino.");
      const next = new URL(location, url);
      if (next.protocol !== "https:" || !(isAmazonHost(next.hostname) || isShortHost(next.hostname))) {
        throw new Error("La redirección sale de los dominios permitidos; se detuvo por seguridad.");
      }
      url = next;
      continue;
    }
    break;
  }
  if (!response) throw new Error("Amazon no respondió.");
  if (response.status < 200 || response.status >= 300) throw new Error("Amazon respondió con estado " + response.status + ".");
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
    throw new Error("La página de destino no devolvió HTML.");
  }
  return { url, statusCode: response.status, html: (await response.text()).slice(0, 1500000) };
}
export default async function handler(request) {
  if (request.method !== "POST") return reply(405, { error: "Método no permitido." });
  let body;
  try { body = await request.json(); }
  catch { return reply(400, { error: "Solicitud JSON no válida." }); }
  if (!body || typeof body.url !== "string" || body.url.length > 2048) {
    return reply(400, { error: "Introduce un enlace válido." });
  }
  try {
    const input = new URL(body.url);
    if (input.protocol !== "https:" || !(isAmazonHost(input.hostname) || isShortHost(input.hostname))) {
      return reply(400, { error: "Solo se aceptan enlaces HTTPS de Amazon o amzn.to." });
    }
  } catch {
    return reply(400, { error: "Introduce un enlace válido." });
  }

  try {
    const page = await getAllowedPage(body.url);
    const titleTag = (page.html.match(/<title\\b[^>]*>([\\s\\S]*?)<\\/title>/i) || [])[1] || "";
    const title = meta(page.html, "og:title") ||
      meta(page.html, "twitter:title") ||
      meta(page.html, "title") ||
      cleanText(titleTag);
    const description = meta(page.html, "og:description") ||
      meta(page.html, "description") ||
      meta(page.html, "twitter:description");
    let image = meta(page.html, "og:image") ||
      meta(page.html, "twitter:image") ||
      meta(page.html, "image");
    if (image) {
      try {
        const imageUrl = new URL(image, page.url);
        image = imageUrl.protocol === "https:" ? imageUrl.href : "";
      } catch { image = ""; }
    }
    const text = visibleText(page.html);
    const finalDescription = cleanText(description).slice(0, 500) ||
      (text ? text.slice(0, 500) : "");
    const hasData = Boolean(title || finalDescription || image);
    return reply(200, {
      title: cleanText(title).slice(0, 240),
      description: finalDescription,
      image,
      url: body.url,
      source: hasData ? "metadata" : "manual",
      statusCode: page.statusCode,
      markdown: text.slice(0, 20000),
      note: hasData
        ? "Se recuperaron datos de la página. Amazon puede devolver una página de bloqueo; verifica que los datos correspondan al producto antes de guardar."
        : "Amazon no expuso metadatos suficientes. Completa los campos manualmente; el enlace original se conserva."
    });
  } catch (error) {
    return reply(200, {
      title: "", description: "", image: "", url: body.url,
      source: "manual",
      statusCode: 599,
      note: "No fue posible leer la página de Amazon automáticamente. " + String(error?.message || error) + " El enlace original se conserva."
    });
  }
}
