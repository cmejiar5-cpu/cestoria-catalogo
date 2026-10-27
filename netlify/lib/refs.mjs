// Códigos de referencia de productos («Ref. C27» / «Ref. T3»).
//   C = producto del catálogo propio (Amazon, aliados, otros).
//   T = producto de la tienda cestoria.shop (no vive en el catálogo; se guarda aparte).
import { CATALOG_BASE } from "./instagram.mjs";

export const STORE_REFS_KEY = "refs-tienda";
export const STORE_HOST_RE = /(^|\.)cestoria\.shop$/i;

// Busca el código en el texto de una publicación. Acepta «Ref. C27», «REF C27», «Ref: c-27».
export function findRefInText(text) {
  const m = String(text || "").match(/\bref\.?\s*[:#]?\s*([ct])\s*-?\s*(\d{1,6})\b/i);
  return m ? m[1].toUpperCase() + Number(m[2]) : "";
}

export function storeSlugFromUrl(url) {
  try {
    const u = new URL(url);
    if (!STORE_HOST_RE.test(u.hostname)) return "";
    const m = u.pathname.match(/^\/producto\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]).trim().toLowerCase() : "";
  } catch { return ""; }
}

// Convierte un código en el producto que se envía por mensaje directo (misma forma que posts/<id>).
export function resolveRef(code, catalog, storeRefs) {
  code = String(code || "").toUpperCase();
  if (/^C\d+$/.test(code)) {
    for (const c of catalog?.categories || []) for (const it of c.items || []) {
      if (it.ref === code) {
        return { productId: String(it.id), kind: it.type === "ALLY_CONTENT" ? "ally" : "product", title: it.title,
          url: CATALOG_BASE + "/?p=" + encodeURIComponent(it.id), image: it.image || "", ref: code };
      }
    }
  }
  if (/^T\d+$/.test(code)) {
    const hit = Object.entries(storeRefs?.items || {}).find(([, v]) => v.ref === code);
    if (hit) return { productId: "tienda-" + hit[0], kind: "product", title: hit[1].title, url: hit[1].url, image: hit[1].image || "", ref: code };
  }
  return null;
}
