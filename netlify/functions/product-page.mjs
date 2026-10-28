// /p/<id>: página corta de un producto del catálogo para los mensajes de Instagram.
// Instagram lee aquí la foto, el nombre y la descripción para armar la tarjeta del mensaje;
// la persona pasa enseguida a la ficha del producto en el catálogo (/?p=<id>).
import { catalogStore } from "../lib/instagram.mjs";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cut = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };

export function productHtml(item, origin) {
  const target = origin + "/?p=" + encodeURIComponent(item.id);
  const title = cut(item.title, 90) + " | Cestoria";
  const desc = cut(item.description || "Producto de la selección Cestoria: juguetes educativos, Montessori, creativos y sensoriales.", 200);
  const img = /^https:\/\//.test(item.image || "") ? item.image : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:type" content="product"><meta property="og:site_name" content="Cestoria">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + "/p/" + encodeURIComponent(item.id))}">${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<link rel="canonical" href="${esc(origin + "/p/" + encodeURIComponent(item.id))}"><meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body><p><a href="${esc(target)}">Ver ${esc(cut(item.title, 90))}</a></p>
<script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")})</script></body></html>`;
}

export default async function handler(request, context) {
  const origin = new URL(request.url).origin;
  const id = decodeURIComponent(String(context?.params?.id || new URL(request.url).pathname.split("/").pop() || ""));
  let catalog = null;
  try { catalog = await catalogStore(context).get("publicado", { type: "json" }); } catch {}
  for (const c of catalog?.categories || []) for (const it of c.items || []) {
    if (String(it.id) === id) {
      return new Response(productHtml(it, origin), { status: 200, headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "Netlify-CDN-Cache-Control": "public, max-age=300"
      } });
    }
  }
  // Producto que ya no existe: catálogo completo.
  return Response.redirect(origin + "/", 302);
}

export const config = { path: "/p/:id" };
