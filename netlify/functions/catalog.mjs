// Catálogo publicado de Cestoria, guardado en Netlify Blobs (incluido en el plan gratuito).
// GET  /.netlify/functions/catalog  -> catálogo publicado (público, solo lectura).
// POST /.netlify/functions/catalog  -> publica (requiere la clave CATALOG_ADMIN_KEY).
// Publicar no genera un deploy, así que no consume los créditos de "production deploy".
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const KEY = "publicado";
const HISTORY_PREFIX = "historial/";
const HISTORY_KEEP = 20;
const MAX_BODY = 2_000_000;
const TYPES = ["AMAZON_PRODUCT", "CLASSIC", "COMMERCE_PRODUCT"];

let storeFactory = name => getStore({ name, consistency: "strong" });
export function __setStoreFactoryForTests(fn) { storeFactory = fn; }

// Las vistas previas (deploy previews / ramas) usan otro almacén para no tocar el catálogo real.
function storeFor(context) {
  const ctx = context?.deploy?.context;
  return storeFactory(!ctx || ctx === "production" ? "catalogo" : "catalogo-" + String(ctx).replace(/[^a-z0-9-]/gi, ""));
}

const json = (status, data, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
});

const digest = v => createHash("sha256").update(String(v)).digest();
function authorized(request) {
  const expected = (globalThis.Netlify?.env?.get("CATALOG_ADMIN_KEY") ?? process.env.CATALOG_ADMIN_KEY ?? "").trim();
  if (!expected) return { ok: false, status: 503, error: "Falta configurar la variable CATALOG_ADMIN_KEY en Netlify." };
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!given || !timingSafeEqual(digest(given), digest(expected))) return { ok: false, status: 401, error: "Clave de publicación incorrecta." };
  return { ok: true };
}

const str = (v, n) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "";
const longStr = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "";
function httpsUrl(v) {
  if (typeof v !== "string" || !v.trim()) return "";
  try { const u = new URL(v.trim()); return u.protocol === "https:" ? u.href : null; } catch { return null; }
}

// Valida y limpia el catálogo. Lanza un error con mensaje en español si algo no es válido.
export function sanitizeCatalog(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.categories)) throw new Error("El catálogo debe tener una lista de categorías.");
  if (input.categories.length > 100) throw new Error("Máximo 100 categorías.");
  const out = {
    store_name: str(input.store_name, 80) || "Cestoria",
    username: str(input.username, 80),
    avatar: httpsUrl(input.avatar) || "",
    bio: longStr(input.bio, 600),
    socials: (Array.isArray(input.socials) ? input.socials : []).slice(0, 10).map(s => ({
      name: str(s?.name, 40), url: httpsUrl(s?.url) || "", icon: str(s?.icon, 20)
    })).filter(s => s.name && s.url),
    categories: []
  };
  let total = 0;
  const ids = new Set();
  input.categories.forEach((c, ci) => {
    const name = str(c?.name, 80);
    if (!name) throw new Error("La categoría número " + (ci + 1) + " no tiene nombre.");
    const items = Array.isArray(c.items) ? c.items : [];
    total += items.length;
    if (total > 2000) throw new Error("Máximo 2000 productos.");
    out.categories.push({
      id: str(c.id, 64) || "cat-" + (ci + 1),
      name,
      items: items.map((p, pi) => {
        const where = "«" + (str(p?.title, 60) || "producto " + (pi + 1)) + "» (" + name + ")";
        const title = str(p?.title, 300);
        if (!title) throw new Error("Falta el nombre del producto " + (pi + 1) + " en " + name + ".");
        const url = httpsUrl(p?.url);
        if (!url) throw new Error("El enlace de " + where + " debe empezar por https://.");
        const image = httpsUrl(p?.image);
        if (image === null) throw new Error("La imagen de " + where + " debe ser un enlace https://.");
        let id = str(p?.id, 64) || "p-" + Date.now().toString(36) + "-" + ci + "-" + pi;
        while (ids.has(id)) id += "-b";
        ids.add(id);
        const item = { id, title, url, image: image || "", type: TYPES.includes(p?.type) ? p.type : "CLASSIC" };
        const original = str(p?.original_title, 400); if (original) item.original_title = original;
        const description = longStr(p?.description, 1000); if (description) item.description = description;
        if (p?.featured === true) item.featured = true;
        return item;
      })
    });
  });
  return out;
}

export default async function handler(request, context) {
  const store = storeFor(context);

  if (request.method === "GET") {
    const entry = await store.getWithMetadata(KEY, { type: "json" });
    if (!entry || !entry.data) return json(404, { error: "Aún no hay un catálogo publicado." });
    return json(200, entry.data, { ETag: entry.etag || "", "X-Saved-At": String(entry.metadata?.savedAt || "") });
  }

  if (request.method !== "POST") return json(405, { error: "Método no permitido." });

  const auth = authorized(request);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: "El catálogo es demasiado grande." });
  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "Solicitud JSON no válida." }); }

  if (body && body.verify === true) return json(200, { ok: true });

  let catalog;
  try { catalog = sanitizeCatalog(body?.catalog); } catch (e) { return json(400, { error: e.message }); }

  const savedAt = new Date().toISOString();
  const previous = await store.getWithMetadata(KEY, { type: "json" });
  const baseEtag = typeof body.baseEtag === "string" && body.baseEtag ? body.baseEtag : null;
  if (previous && baseEtag && previous.etag !== baseEtag) {
    return json(409, { error: "El catálogo se publicó desde otro dispositivo después de que abrieras esta página. Recarga para ver la versión actual y vuelve a aplicar tus cambios." });
  }
  if (previous && !baseEtag && body.overwrite !== true) {
    return json(409, { error: "Ya existe un catálogo publicado. Recarga la página para partir de él." });
  }

  if (previous?.data) {
    await store.setJSON(HISTORY_PREFIX + (previous.metadata?.savedAt || savedAt), previous.data, { metadata: previous.metadata || {} });
  }
  const result = await store.setJSON(KEY, catalog, {
    metadata: { savedAt },
    ...(previous ? (baseEtag ? { onlyIfMatch: baseEtag } : {}) : { onlyIfNew: true })
  });
  if (result && result.modified === false) {
    return json(409, { error: "El catálogo cambió mientras se publicaba. Recarga y vuelve a intentarlo." });
  }

  try {
    const { blobs } = await store.list({ prefix: HISTORY_PREFIX });
    const old = blobs.map(b => b.key).sort().reverse().slice(HISTORY_KEEP);
    await Promise.all(old.map(k => store.delete(k)));
  } catch (e) { console.error("No se pudo limpiar el historial", e); }

  const items = catalog.categories.reduce((n, c) => n + c.items.length, 0);
  return json(200, { ok: true, savedAt, etag: result?.etag || "", categories: catalog.categories.length, items });
}
