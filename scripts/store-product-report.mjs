// Solo lectura: datos públicos de productos de cestoria.shop para análisis.
import { STORE_SUPABASE_URL, STORE_SUPABASE_PUBLISHABLE_KEY as key } from "../netlify/lib/cestoria-store-public.mjs";
const sel = "price,compare_price,stock,country_code,is_active,products(slug,name,description,image_url,image_urls,created_at,product_categories(categories(name)),product_variants(country_code,title,price,stock))";
const r = await fetch(STORE_SUPABASE_URL + "/rest/v1/product_prices?select=" + encodeURIComponent(sel) + "&country_code=in.(CO,PE,EC)", { headers: { apikey: key, Authorization: "Bearer " + key } });
const rows = await r.json();
if (!Array.isArray(rows)) { console.log("error", r.status, JSON.stringify(rows).slice(0, 500)); process.exit(0); }
const out = rows.map(x => ({ pais: x.country_code, activo: x.is_active, nombre: x.products?.name, slug: x.products?.slug, precio: Number(x.price), antes: x.compare_price == null ? null : Number(x.compare_price), stock: x.stock,
  creado: (x.products?.created_at || "").slice(0, 10), fotos: 1 + (Array.isArray(x.products?.image_urls) ? x.products.image_urls.length : 0), desc: (x.products?.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().length,
  cats: (x.products?.product_categories || []).map(c => c?.categories?.name).filter(Boolean).join("|"), variantes: (x.products?.product_variants || []).filter(v => v.country_code === x.country_code).length }));
console.log("REPORTE_JSON_INICIO"); console.log(JSON.stringify(out)); console.log("REPORTE_JSON_FIN");
