// Recibe productos desde la app «Creativos para producto» y devuelve su código de referencia.
//   POST /.netlify/functions/catalog-ingest   { url, title, image?, imageData?, description?, category? }
//        Cabecera Authorization: Bearer <clave>. Usa CATALOG_INGEST_KEY si existe; si no, la clave de publicación.
//        - Enlace de cestoria.shop: no se agrega al catálogo (ya sale solo); se le da un código «T…».
//        - Otro enlace ya publicado: devuelve su código sin duplicarlo.
//        - Otro enlace nuevo: lo agrega al catálogo publicado (categoría «Novedades») y devuelve su código «C…».
//   GET  /.netlify/functions/catalog-ingest   -> códigos de los productos de la tienda (para el administrador).
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { storeFor, sanitizeCatalog, authorized, json } from "./catalog.mjs";
import { STORE_REFS_KEY, storeSlugFromUrl } from "../lib/refs.mjs";
import { fetchStoreRows, COUNTRIES } from "../lib/store.mjs";

const KEY = "publicado";
const HISTORY_PREFIX = "historial/";
const MAX_BODY = 3_000_000;
const MAX_IMAGE = 1_500_000;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const DEFAULT_CATEGORY = "Novedades";

let fetchStore = fetchStoreRows;
export function __setFetchStoreForTests(fn) { fetchStore = fn; }

const env = k => globalThis.Netlify?.env?.get(k) ?? process.env[k];
const str = (v, n) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "";
function httpsUrl(v) {
  try { const u = new URL(String(v || "").trim()); return u.protocol === "https:" ? u.href : ""; } catch { return ""; }
}
// Mismo producto aunque cambie una barra final o mayúsculas en el dominio.
export function sameUrl(a, b) {
  const n = v => { try { const u = new URL(v); u.hash = ""; return (u.protocol + "//" + u.host.toLowerCase() + u.pathname.replace(/\/+$/, "") + u.search); } catch { return String(v || ""); } };
  return n(a) === n(b);
}
const isAmazonUrl = url => {
  try { const h = new URL(url).hostname.toLowerCase(); return /(^|\.)amazon\.[a-z.]+$/.test(h) || ["amzn.to", "link.amazon", "amzlinks.in", "a.co", "amzn.eu"].includes(h); } catch { return false; }
};

// Fotos subidas desde Creativos; se sirven en /img/<nombre> (netlify/functions/img.mjs).
export function imagesStore(context) {
  const ctx = context?.deploy?.context;
  return imageStoreFactory(!ctx || ctx === "production" ? "imagenes" : "imagenes-" + String(ctx).replace(/[^a-z0-9-]/gi, ""));
}
let imageStoreFactory = name => getStore({ name, consistency: "strong" });
export function __setImageStoreFactoryForTests(fn) { imageStoreFactory = fn; }

async function saveImage(dataUrl, context, origin) {
  const m = String(dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return "";
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE) return "";
  const name = createHash("sha256").update(bytes).digest("hex").slice(0, 32) + "." + IMAGE_TYPES[m[1]];
  const store = imagesStore(context);
  if (!(await store.getMetadata(name))) {
    await store.set(name, new Blob([bytes], { type: m[1] }), { metadata: { type: m[1] } });
  }
  return origin + "/img/" + name;
}

async function storeProduct(slug) {
  for (const country of Object.keys(COUNTRIES)) {
    try {
      const rows = await fetchStore(country);
      const r = rows.find(x => String(x.products?.slug || "").toLowerCase() === slug);
      if (r) {
        const p = r.products;
        const image = [p.image_url, ...(Array.isArray(p.image_urls) ? p.image_urls : [])].map(httpsUrl).find(Boolean) || "";
        return { title: str(p.name, 240), image };
      }
    } catch { /* si la tienda no responde se usa el nombre enviado */ }
  }
  return null;
}

async function ingestStore(store, slug, url, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = await store.getWithMetadata(STORE_REFS_KEY, { type: "json" });
    const data = entry?.data && typeof entry.data === "object" ? entry.data : { seq: 0, items: {} };
    data.items = data.items || {};
    if (data.items[slug]) return json(200, { ok: true, ref: data.items[slug].ref, status: "existente", source: "tienda", title: data.items[slug].title });
    const found = await storeProduct(slug);
    const title = found?.title || str(body.title, 240);
    if (!title) return json(400, { error: "No encontré ese producto en cestoria.shop y no llegó su nombre." });
    data.seq = (Number(data.seq) || 0) + 1;
    const ref = "T" + data.seq;
    data.items[slug] = { ref, title, url, image: found?.image || httpsUrl(body.image) || "", at: new Date().toISOString() };
    const r = await store.setJSON(STORE_REFS_KEY, data, entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (r && r.modified === false) continue;
    return json(200, { ok: true, ref, status: "nuevo", source: "tienda", title, inStore: Boolean(found) });
  }
  return json(409, { error: "Hubo cambios al mismo tiempo. Vuelve a intentarlo." });
}

export default async function handler(request, context) {
  const store = storeFor(context);

  if (request.method === "GET") {
    const data = await store.get(STORE_REFS_KEY, { type: "json" });
    return json(200, { items: data?.items || {} });
  }
  if (request.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = authorized(request, env("CATALOG_INGEST_KEY") ? "CATALOG_INGEST_KEY" : "CATALOG_ADMIN_KEY");
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: "La solicitud es demasiado grande (imagen muy pesada)." });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "Solicitud JSON no válida." }); }

  const url = httpsUrl(body?.url);
  if (!url) return json(400, { error: "Falta el enlace del producto (debe empezar por https://)." });

  const slug = storeSlugFromUrl(url);
  if (slug) return ingestStore(store, slug, url, body);

  const title = str(body.title, 300);
  let image = httpsUrl(body.image);
  let imageSaved = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = await store.getWithMetadata(KEY, { type: "json" });
    const current = entry?.data || { store_name: "Cestoria", categories: [] };
    for (const c of current.categories || []) for (const it of c.items || []) {
      if (sameUrl(it.url, url) && it.ref) return json(200, { ok: true, ref: it.ref, status: "existente", source: "catalogo", title: it.title, id: it.id });
    }
    if (!title) return json(400, { error: "Falta el nombre del producto." });
    if (!image && !imageSaved && body.imageData) {
      imageSaved = true;
      try { image = await saveImage(body.imageData, context, new URL(request.url).origin); } catch (e) { console.error("No se pudo guardar la foto", e); image = ""; }
      if (!/^https:\/\//.test(image)) image = ""; // sin foto válida el producto igual se registra
    }
    const draft = JSON.parse(JSON.stringify(current));
    draft.categories = draft.categories || [];
    let existing = null;
    for (const c of draft.categories) for (const it of c.items || []) if (sameUrl(it.url, url)) existing = it;
    const id = existing?.id || "creativos-" + Date.now().toString(36);
    if (!existing) {
      const catName = str(body.category, 80) || DEFAULT_CATEGORY;
      let cat = draft.categories.find(c => String(c.name).toLowerCase() === catName.toLowerCase());
      if (!cat) { cat = { id: "cat-" + Date.now().toString(36), name: catName, items: [] }; draft.categories.push(cat); }
      cat.items = cat.items || [];
      cat.items.unshift({ id, title, url, image, type: isAmazonUrl(url) ? "AMAZON_PRODUCT" : "CLASSIC", description: typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "" });
    }
    let catalog;
    try { catalog = sanitizeCatalog(draft); } catch (e) { return json(400, { error: e.message }); }
    const item = catalog.categories.flatMap(c => c.items).find(it => it.id === id);

    const savedAt = new Date().toISOString();
    if (entry?.data) await store.setJSON(HISTORY_PREFIX + (entry.metadata?.savedAt || savedAt), entry.data, { metadata: entry.metadata || {} });
    const r = await store.setJSON(KEY, catalog, { metadata: { savedAt, by: "creativos" }, ...(entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true }) });
    if (r && r.modified === false) continue;
    try {
      const { blobs } = await store.list({ prefix: HISTORY_PREFIX });
      await Promise.all(blobs.map(b => b.key).sort().reverse().slice(20).map(k => store.delete(k)));
    } catch (e) { console.error("No se pudo limpiar el historial", e); }
    return json(200, { ok: true, ref: item.ref, status: existing ? "existente" : "nuevo", source: "catalogo", title: item.title, id: item.id, image: item.image });
  }
  return json(409, { error: "El catálogo cambió al mismo tiempo. Vuelve a intentarlo." });
}
