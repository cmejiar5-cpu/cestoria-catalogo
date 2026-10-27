// Solo lectura: todos los productos de cestoria.shop y en qué países tienen precio activo.
import { STORE_SUPABASE_URL, STORE_SUPABASE_PUBLISHABLE_KEY as key } from "../netlify/lib/cestoria-store-public.mjs";
const h = { apikey: key, Authorization: "Bearer " + key };
const prods = await (await fetch(STORE_SUPABASE_URL + "/rest/v1/products?select=id,slug,name,created_at&order=created_at", { headers: h })).json();
const prices = await (await fetch(STORE_SUPABASE_URL + "/rest/v1/product_prices?select=product_id,country_code,stock", { headers: h })).json();
const act = {}; for (const p of prices) (act[p.product_id] ||= []).push(p.country_code + ":" + p.stock);
console.log("TODOS_LOS_PRODUCTOS", prods.length, "| con precio activo:", Object.keys(act).length);
for (const p of prods) console.log(" -", (act[p.id] || ["SIN PRECIO ACTIVO"]).join(","), "|", (p.created_at || "").slice(0, 10), "|", p.name.slice(0, 80), "|", p.slug);
