// /t/<código o slug>: enlace corto del catálogo hacia un producto de la tienda cestoria.shop.
// Se usa en los mensajes de Instagram para que el enlace sea corto y del mismo dominio que el catálogo.
//   /t/T3                -> producto con ese código (registro de Creativos)
//   /t/mesa-proyector    -> https://cestoria.shop/producto/mesa-proyector
import { catalogStore } from "../lib/instagram.mjs";
import { STORE_REFS_KEY } from "../lib/refs.mjs";
import { STORE_PRODUCT_BASE } from "../lib/cestoria-store-public.mjs";

export default async function handler(request, context) {
  const key = decodeURIComponent(String(context?.params?.key || new URL(request.url).pathname.split("/").pop() || "")).trim();
  const origin = new URL(request.url).origin;
  if (/^t\d{1,6}$/i.test(key)) {
    let refs = null;
    try { refs = await catalogStore(context).get(STORE_REFS_KEY, { type: "json" }); } catch {}
    const hit = Object.values(refs?.items || {}).find(v => v.ref === key.toUpperCase());
    if (hit && /^https:\/\/([a-z0-9-]+\.)*cestoria\.shop\//i.test(hit.url)) return Response.redirect(hit.url, 302);
    return Response.redirect(origin + "/", 302);
  }
  if (/^[a-z0-9][a-z0-9-]{0,200}$/i.test(key)) return Response.redirect(STORE_PRODUCT_BASE + encodeURIComponent(key.toLowerCase()), 302);
  return Response.redirect(origin + "/", 302);
}

export const config = { path: "/t/:key" };
