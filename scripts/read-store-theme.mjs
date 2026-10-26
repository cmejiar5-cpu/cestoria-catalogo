// Lee (solo lectura) los colores que usa cestoria.shop en cada país.
import { STORE_SUPABASE_URL } from "../netlify/lib/cestoria-store-public.mjs";
import * as pub from "../netlify/lib/cestoria-store-public.mjs";
const key = Object.values(pub).find(v => typeof v === "string" && v.startsWith("sb_publishable_"));
const r = await fetch(STORE_SUPABASE_URL + "/rest/v1/market_themes?select=country_code,theme", { headers: { apikey: key, Authorization: "Bearer " + key } });
console.log("market_themes", r.status, (await r.text()).slice(0, 3000));
