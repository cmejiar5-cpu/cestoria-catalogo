// Productos de la tienda cestoria.shop para el catálogo general, según el país del visitante.
// Solo lectura. El país sale de la ubicación que detecta Netlify; se puede forzar con ?pais=CO|PE|EC.
import { STORE_PRODUCT_BASE } from "../lib/cestoria-store-public.mjs";
import { COUNTRIES, resolveCountry, fetchStoreRows } from "../lib/store.mjs";

const clean = (v, n) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const https = v => { try { const u = new URL(String(v ?? "")); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };

export function toCatalogItems(rows) {
  const out = [];
  for (const r of rows || []) {
    const p = r.products || {};
    const slug = String(p.slug || "").trim(), title = clean(p.name, 240);
    const price = Number(r.price);
    if (!slug || !title || !(price > 0) || !(Number(r.stock) > 0)) continue;
    const image = [p.image_url, ...(Array.isArray(p.image_urls) ? p.image_urls : [])].map(https).find(Boolean) || "";
    const compare = Number(r.compare_price);
    const category = (p.product_categories || []).map(c => clean(c?.categories?.name, 60)).find(Boolean) || "Tienda Cestoria";
    out.push({
      id: "tienda-" + slug, title, url: STORE_PRODUCT_BASE + encodeURIComponent(slug), image,
      categoryName: category, price, compare_price: compare > price ? compare : null,
      type: "COMMERCE_PRODUCT", source: "tienda"
    });
  }
  return out;
}

export default async function handler(request, context) {
  const forced = new URL(request.url).searchParams.get("pais");
  const country = resolveCountry(forced || context?.geo?.country?.code);
  const info = { country, countryName: COUNTRIES[country].name, currency: COUNTRIES[country].currency, detected: !forced };
  try {
    const items = toCatalogItems(await fetchStoreRows(country));
    return Response.json({ ...info, items }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    // Si la tienda no responde, el catálogo sigue mostrando sus propios productos.
    return Response.json({ ...info, items: [], error: "No se pudieron cargar los productos de la tienda." }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
