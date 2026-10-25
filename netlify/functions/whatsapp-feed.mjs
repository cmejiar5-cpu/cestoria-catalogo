// Feed de productos para el catálogo de Meta (Commerce Manager) que se conecta a WhatsApp Business.
// Lee (solo lectura) los productos activos de la tienda cestoria.shop y los entrega en CSV.
// No escribe nada en la tienda.
//   /feed-whatsapp.csv              -> CSV para Commerce Manager (feed programado)
//   /feed-whatsapp.csv?formato=json -> revisión: productos incluidos y excluidos con el motivo
import { STORE_PRODUCT_BASE } from "../lib/cestoria-store-public.mjs";
import { fetchStoreRows } from "../lib/store.mjs";
export { fetchStoreRows };

const COUNTRIES = { CO: "COP", PE: "PEN", EC: "USD" };
const BRAND = "Cestoria";


// Identificador para Meta: el slug si es corto; si no, un recorte estable con huella.
// (Meta rechazó en el feed de país un identificador de exactamente 100 caracteres.)
export function feedId(slug) {
  if (slug.length <= 80) return slug;
  let h = 2166136261;
  for (const ch of slug) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return slug.slice(0, 70).replace(/-+$/, "") + "-" + h.toString(36);
}
function cleanText(v, max) {
  return String(v ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim().slice(0, max);
}
function httpsUrl(v) {
  try { const u = new URL(String(v ?? "").trim()); return u.protocol === "https:" ? u.href : ""; } catch { return ""; }
}
const money = (n, cur) => (Math.round(Number(n) * 100) / 100).toFixed(2) + " " + cur;
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Convierte las filas de la tienda en artículos del catálogo de Meta.
export function buildItems(rows, country = "CO") {
  const currency = COUNTRIES[country];
  const items = [], skipped = [];
  for (const r of rows || []) {
    const p = r.products || {};
    const name = cleanText(p.name, 150);
    const slug = String(p.slug || "").trim();
    if (!name || !slug) { skipped.push({ name: name || "(sin nombre)", reason: "sin nombre o sin identificador" }); continue; }
    const price = Number(r.price);
    if (!Number.isFinite(price) || price <= 0) { skipped.push({ name, reason: "sin precio" }); continue; }
    const images = [p.image_url, ...(Array.isArray(p.image_urls) ? p.image_urls : [])].map(httpsUrl).filter(Boolean);
    const unique = [...new Set(images)];
    if (!unique.length) { skipped.push({ name, reason: "sin foto con enlace https (la tienda usa una imagen interna)" }); continue; }
    const compare = Number(r.compare_price);
    const onSale = Number.isFinite(compare) && compare > price;
    const cats = (p.product_categories || []).map(c => cleanText(c?.categories?.name, 60)).filter(Boolean);
    items.push({
      id: feedId(slug),
      title: name,
      description: cleanText(p.description, 5000) || name,
      availability: Number(r.stock) > 0 ? "in stock" : "out of stock",
      condition: "new",
      price: money(onSale ? compare : price, currency),
      sale_price: onSale ? money(price, currency) : "",
      link: STORE_PRODUCT_BASE + encodeURIComponent(slug),
      image_link: unique[0],
      additional_image_link: unique.slice(1, 11).join(","),
      brand: BRAND,
      product_type: cats.join(" > ").slice(0, 750)
    });
  }
  return { items, skipped };
}

export const COLUMNS = ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "additional_image_link", "brand", "product_type"];
export function toCsv(items) {
  return [COLUMNS.join(","), ...items.map(it => COLUMNS.map(c => csvCell(it[c])).join(","))].join("\r\n") + "\r\n";
}

// ---------- Opción B: un catálogo con los tres mercados ----------
// Catálogo principal: todos los productos de CO, PE y EC (un artículo por producto; los datos
// base salen del primer mercado donde se vende, en orden CO, PE, EC).
// Feeds de país (columna "override"): para cada país, precio, oferta, disponibilidad y enlace;
// lo que no se vende en ese país queda "out of stock". Meta elige la versión según la ubicación
// de quien mira (documentación oficial de catálogos localizados de Meta).
export const MARKETS = ["CO", "PE", "EC"];

export function buildAllMarkets(rowsByCountry) {
  const byId = new Map(), skipped = [], perCountry = {};
  for (const c of MARKETS) {
    const { items, skipped: sk } = buildItems(rowsByCountry[c] || [], c);
    perCountry[c] = new Map(items.map(it => [it.id, it]));
    for (const it of items) if (!byId.has(it.id)) byId.set(it.id, { ...it, mercados: [] });
    for (const it of items) byId.get(it.id).mercados.push(c);
    for (const s of sk) skipped.push({ ...s, pais: c });
  }
  return { items: [...byId.values()], perCountry, skipped };
}

export const OVERRIDE_COLUMNS = ["id", "override", "price", "sale_price", "availability", "link"];
export function buildCountryOverride(all, country) {
  const own = all.perCountry[country] || new Map();
  return all.items.map(base => {
    const it = own.get(base.id);
    return it
      ? { id: base.id, override: country, price: it.price, sale_price: it.sale_price, availability: it.availability, link: it.link }
      : { id: base.id, override: country, price: "", sale_price: "", availability: "out of stock", link: "" };
  });
}
const csvOf = (cols, rows) => [cols.join(","), ...rows.map(r => cols.map(c => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";

async function fetchAll() {
  const res = await Promise.all(MARKETS.map(c => fetchStoreRows(c)));
  return Object.fromEntries(MARKETS.map((c, i) => [c, res[i]]));
}
const csvResponse = (body, name) => new Response(body, {
  headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=300", "Content-Disposition": 'inline; filename="' + name + '"' }
});
const failResponse = e => new Response("No se pudo leer la tienda: " + e.message, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

// Direcciones:
//   Opción A (solo un país):   /feed-whatsapp.csv            (Colombia)   ·  ?pais=PE|EC
//   Opción B (tres mercados):  /feed-whatsapp.csv?mercados=todos         (catálogo principal)
//                              /feed-whatsapp.csv?pais_override=CO|PE|EC (feed de país)
//   Revisión: añadir &formato=json
export default async function handler(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Método no permitido", { status: 405 });
  const params = new URL(request.url).searchParams;
  const json = params.get("formato") === "json";
  const override = (params.get("pais_override") || "").toUpperCase();
  if (params.get("mercados") === "todos" || override) {
    if (override && !MARKETS.includes(override)) return new Response("País no soportado", { status: 400 });
    let all;
    try { all = buildAllMarkets(await fetchAll()); } catch (e) { return failResponse(e); }
    if (override) {
      const rows = buildCountryOverride(all, override);
      if (json) return Response.json({ pais: override, disponibles: rows.filter(r => r.availability === "in stock").length, filas: rows }, { headers: { "Cache-Control": "no-store" } });
      return csvResponse(csvOf(OVERRIDE_COLUMNS, rows), "cestoria-pais-" + override.toLowerCase() + ".csv");
    }
    if (json) return Response.json({ mercados: MARKETS, incluidos: all.items.length, excluidos: all.skipped, productos: all.items }, { headers: { "Cache-Control": "no-store" } });
    return csvResponse(toCsv(all.items), "cestoria-whatsapp-todos.csv");
  }
  const country = (params.get("pais") || "CO").toUpperCase();
  if (!COUNTRIES[country]) return new Response("País no soportado", { status: 400 });
  let rows;
  try { rows = await fetchStoreRows(country); } catch (e) { return failResponse(e); } // Meta conserva la última versión buena
  const { items, skipped } = buildItems(rows, country);
  if (json) return Response.json({ pais: country, incluidos: items.length, excluidos: skipped, productos: items }, { headers: { "Cache-Control": "no-store" } });
  return csvResponse(toCsv(items), "cestoria-whatsapp-" + country.toLowerCase() + ".csv");
}

export const config = { path: "/feed-whatsapp.csv" };
