// Lectura (solo lectura) de los productos activos de cestoria.shop por país.
import { STORE_SUPABASE_URL, STORE_SUPABASE_PUBLISHABLE_KEY } from "./cestoria-store-public.mjs";

export const COUNTRIES = { CO: { currency: "COP", name: "Colombia" }, PE: { currency: "PEN", name: "Perú" }, EC: { currency: "USD", name: "Ecuador" } };
export const DEFAULT_COUNTRY = "CO";
const env = k => globalThis.Netlify?.env?.get(k) ?? process.env[k];

// Igual que cestoria.shop: si el país no es CO, PE o EC, se usa Colombia.
export const resolveCountry = code => (COUNTRIES[String(code || "").toUpperCase()] ? String(code).toUpperCase() : DEFAULT_COUNTRY);

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
