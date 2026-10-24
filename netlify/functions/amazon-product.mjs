const reply = (statusCode, data) => new Response(JSON.stringify(data), {
  status: statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

const isAmazonHost = host => /(^|\.)amazon\.(com|co\.uk|ca|es|com\.mx|de|fr|it|co\.jp|in|com\.au|com\.br)$/i.test(host);
// Acortadores oficiales de Amazon. link.amazon redirige a amzlinks.in y luego a amazon.com
// (comprobado en GitHub Actions el 2026-10-24 con https://link.amazon/B02KjkcGI).
const isShortHost = host => ["amzn.to", "link.amazon", "amzlinks.in", "a.co", "amzn.eu"].includes(host.toLowerCase());
const ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
const asinFrom = url => { const m = String(url).match(ASIN_RE); return m ? m[1].toUpperCase() : ""; };
// Página de verificación anti-robots de Amazon: no es el producto, nunca se usa como dato.
const isBlockedPage = html => /validateCaptcha|\/errors\/validateCaptcha|captcha|api-services-support@amazon\.com|Robot Check/i.test(html) &&
  !/id=["']productTitle["']/i.test(html);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function decode(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function attr(tag, name) {
  const pattern = new RegExp(name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = tag.match(pattern);
  return match ? decode(match[1] || match[2] || match[3] || "").trim() : "";
}
function cleanText(value) {
  return decode(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function meta(html, property) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = attr(tag, "property") || attr(tag, "name");
    if (key.toLowerCase() === property.toLowerCase()) {
      const value = attr(tag, "content");
      if (value) return value;
    }
  }
  return "";
}
// Corta sin dejar palabras o frases a medias.
function trimAtBoundary(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" · "));
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1).trim();
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:·–-]+$/, "") + "…";
}
function visibleText(html) {
  return cleanText(html
    .replace(/<(script|style|noscript|svg|head|nav|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|h[1-6]|tr)>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}
async function getAllowedPage(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Introduce un enlace válido."); }
  if (url.protocol !== "https:" || !(isAmazonHost(url.hostname) || isShortHost(url.hostname))) {
    throw new Error("Solo se aceptan enlaces HTTPS de Amazon o amzn.to.");
  }
  let response;
  let asin = asinFrom(url);
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
      asin = asin || asinFrom(url);
      continue;
    }
    break;
  }
  if (!response) throw new Error("Amazon no respondió.");
  if (response.status < 200 || response.status >= 300) {
    const err = new Error(isShortHost(url.hostname)
      ? "El acortador " + url.hostname + " respondió con estado " + response.status + " (no redirigió al producto). Comprueba que el enlace abre en tu navegador."
      : "Amazon respondió con estado " + response.status + ".");
    err.asin = asin; err.resolvedUrl = url.href;
    throw err;
  }
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
    throw new Error("La página de destino no devolvió HTML.");
  }
  return { url, asin, statusCode: response.status, html: (await response.text()).slice(0, 1500000) };
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
    const productUrl = page.asin ? "https://" + page.url.hostname + "/dp/" + page.asin : "";
    if (isBlockedPage(page.html)) {
      return reply(200, {
        title: "", description: "", image: "", url: body.url,
        asin: page.asin, productUrl,
        source: "manual", blocked: "captcha", statusCode: page.statusCode,
        note: "Amazon respondió con su página de verificación anti-robots en lugar del producto" +
          (page.asin ? " (ASIN " + page.asin + ")" : "") +
          ". No se usan esos datos. Abre el producto, copia título, imagen y descripción, y pégalos aquí; el enlace de afiliado original se conserva."
      });
    }
    const html = page.html;
    const titleTag = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    const productTitle = (html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "";
    const title = cleanText(productTitle) ||
      meta(html, "og:title") ||
      meta(html, "twitter:title") ||
      meta(html, "title") ||
      cleanText(titleTag).replace(/^Amazon\.[a-z.]+\s*:\s*/i, "");
    const bulletsBlock = (html.match(/id=["']feature-bullets["'][\s\S]*?<\/ul>/i) || [])[0] || "";
    const bullets = (bulletsBlock.match(/<span class=["']a-list-item["'][^>]*>([\s\S]*?)<\/span>/gi) || [])
      .map(cleanText).filter(Boolean).slice(0, 5);
    const description = bullets.join(" · ") ||
      meta(html, "og:description") ||
      meta(html, "description") ||
      meta(html, "twitter:description");
    let image = attr((html.match(/<img\b[^>]*id=["']landingImage["'][^>]*>/i) || [])[0] || "", "data-old-hires") ||
      ((html.match(/"hiRes"\s*:\s*"(https:[^"]+)"/) || [])[1] || "") ||
      meta(html, "og:image") ||
      meta(html, "twitter:image") ||
      meta(html, "image");
    if (image) {
      try {
        const imageUrl = new URL(image, page.url);
        image = imageUrl.protocol === "https:" ? imageUrl.href : "";
      } catch { image = ""; }
    }
    const text = visibleText(html);
    const finalDescription = trimAtBoundary(cleanText(description), 500);
    const finalTitle = /^amazon(\.[a-z.]+)?$/i.test(cleanText(title)) ? "" : cleanText(title).slice(0, 240);
    const hasData = Boolean(finalTitle || finalDescription || image);
    return reply(200, {
      title: finalTitle,
      description: finalDescription,
      image,
      url: body.url,
      asin: page.asin, productUrl,
      source: hasData ? "metadata" : "manual",
      statusCode: page.statusCode,
      markdown: text.slice(0, 20000),
      note: hasData
        ? "Se recuperaron datos de la página del producto. Verifica que correspondan antes de guardar."
        : "Amazon no expuso datos del producto. Completa los campos manualmente; el enlace original se conserva."
    });
  } catch (error) {
    return reply(200, {
      title: "", description: "", image: "", url: body.url,
      asin: error?.asin || "", productUrl: error?.asin ? "https://www.amazon.com/dp/" + error.asin : "",
      source: "manual",
      statusCode: 599,
      note: "No fue posible leer la página de Amazon automáticamente. " + String(error?.message || error) + " El enlace original se conserva."
    });
  }
}
