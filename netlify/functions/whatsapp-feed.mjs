// Feed de productos para el catálogo de Meta (Commerce Manager) que se conecta a WhatsApp Business.
// Lee (solo lectura) los productos activos de la tienda cestoria.shop y los entrega en CSV.
// No escribe nada en la tienda.
//   /feed-whatsapp.csv              -> CSV para Commerce Manager (feed programado)
//   /feed-whatsapp.csv?formato=json -> revisión: productos incluidos y excluidos con el motivo
import { STORE_SUPABASE_URL, STORE_SUPABASE_PUBLISHABLE_KEY, STORE_PRODUCT_BASE } from "../lib/cestoria-store-public.mjs";

const COUNTRIES = { CO: "COP", PE: "PEN", EC: "USD" };
const BRAND = "Cestoria";

const env = k => globalThis.Netlify?.env?.get(k) ?? process.env[k];

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
      id: slug.slice(0, 100),
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

export async function fetchStoreRows(country, fetchImpl = fetch) {
  const base = (env("CESTORIA_SUPABASE_URL") || STORE_SUPABASE_URL).replace(/\/+$/, "");
  const key = env("CESTORIA_SUPABASE_KEY") || STORE_SUPABASE_PUBLISHABLE_KEY;
  const select = "price,compare_price,stock,country_code,products(slug,name,description,image_url,image_urls,product_categories(categories(name)))";
  const url = base + "/rest/v1/product_prices?select=" + encodeURIComponent(select) +
    "&country_code=eq." + country + "&is_active=eq.true&order=product_id";
  const r = await fetchImpl(url, { headers: { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("La tienda respondió " + r.status);
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error("Respuesta inesperada de la tienda");
  return rows;
}

export default async function handler(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Método no permitido", { status: 405 });
  const params = new URL(request.url).searchParams;
  const country = (params.get("pais") || "CO").toUpperCase();
  if (!COUNTRIES[country]) return new Response("País no soportado", { status: 400 });
  let rows;
  try { rows = await fetchStoreRows(country); }
  catch (e) {
    // Error: Meta conserva la última versión buena del catálogo.
    return new Response("No se pudo leer la tienda: " + e.message, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const { items, skipped } = buildItems(rows, country);
  if (params.get("formato") === "json") {
    return Response.json({ pais: country, incluidos: items.length, excluidos: skipped, productos: items }, { headers: { "Cache-Control": "no-store" } });
  }
  return new Response(toCsv(items), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=300", "Content-Disposition": 'inline; filename="cestoria-whatsapp-' + country.toLowerCase() + '.csv"' }
  });
}

export const config = { path: "/feed-whatsapp.csv" };
