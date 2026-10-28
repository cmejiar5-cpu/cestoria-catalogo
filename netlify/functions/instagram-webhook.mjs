// Recibe los avisos de comentarios de Instagram (webhook de Meta) y responde con un
// mensaje privado: enlace del producto de esa publicación + WhatsApp de Cestoria.
//   GET  /instagram-webhook  -> verificación de Meta (hub.challenge)
//   POST /instagram-webhook  -> avisos firmados con X-Hub-Signature-256
import { igStore, catalogStore, refreshPost, getConfig, validSignature, extractComments, buildMessage, igApi, addLog, json } from "../lib/instagram.mjs";
import { findRefInText, resolveRef, storeSlugFromUrl, STORE_REFS_KEY } from "../lib/refs.mjs";

// Productos de la tienda: enlace corto del catálogo (/t/T3 o /t/<slug>) que redirige a cestoria.shop.
// Instagram resalta mejor los enlaces cortos de este dominio.
export function shortStoreLink(post, origin) {
  const slug = post?.url ? storeSlugFromUrl(post.url) : "";
  if (!slug) return post;
  return { ...post, url: origin + "/t/" + (/^T\d+$/.test(post.ref || "") ? post.ref : encodeURIComponent(slug)) };
}

// Publicación sin producto asociado: si su texto trae «Ref. C27» (lo pone la app Creativos),
// se asocia sola y queda guardada como si se hubiera elegido en el administrador.
async function matchByRef(store, cfg, mediaId, currentCatalog, context) {
  if (!mediaId || !cfg.accessToken) return null;
  let media;
  try { media = await igApi.caption(cfg.accessToken, mediaId); } catch { return null; }
  const code = findRefInText(media?.caption);
  if (!code) return null;
  let storeRefs = null;
  if (code.startsWith("T")) { try { storeRefs = await catalogStore(context).get(STORE_REFS_KEY, { type: "json" }); } catch {} }
  const post = resolveRef(code, await currentCatalog(), storeRefs);
  if (!post) return { code, post: null };
  const saved = { ...post, permalink: /^https:\/\//.test(media?.permalink || "") ? media.permalink : "", auto: true, updatedAt: new Date().toISOString() };
  await store.setJSON("posts/" + mediaId, saved);
  return { code, post: saved };
}

export default async function handler(request, context) {
  const store = igStore(context);
  const cfg = await getConfig(store);

  if (request.method === "GET") {
    const p = new URL(request.url).searchParams;
    if (p.get("hub.mode") === "subscribe" && cfg.verifyToken && p.get("hub.verify_token") === cfg.verifyToken) {
      return new Response(p.get("hub.challenge") || "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Verificación no válida", { status: 403 });
  }
  if (request.method !== "POST") return new Response("Método no permitido", { status: 405 });

  const raw = await request.text();
  if (!cfg.appSecret) return json(503, { error: "Instagram aún no está configurado." });
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"), cfg.appSecret)) return json(401, { error: "Firma no válida." });

  let body;
  try { body = JSON.parse(raw); } catch { return json(400, { error: "JSON no válido." }); }

  const results = [];
  let catalog;
  const currentCatalog = async () => {
    if (catalog === undefined) { try { catalog = await catalogStore(context).get("publicado", { type: "json" }); } catch { catalog = null; } }
    return catalog;
  };
  for (const c of extractComments(body)) {
    const own = c.fromId && (c.fromId === cfg.igUserId || c.fromId === c.accountId);
    if (own) { results.push({ commentId: c.commentId, result: "propio" }); continue; }
    // Un solo mensaje por comentario (Meta puede repetir avisos) y por persona en cada publicación.
    const first = await store.setJSON("done/" + c.commentId, { at: Date.now() }, { onlyIfNew: true });
    if (first && first.modified === false) { results.push({ commentId: c.commentId, result: "repetido" }); continue; }
    const personKey = "sent/" + (c.mediaId || "sin-publicacion") + "/" + (c.fromId || c.username || c.commentId);
    if (await store.get(personKey)) {
      await addLog(store, { ...c, result: "ya se le había enviado en esta publicación" });
      results.push({ commentId: c.commentId, result: "ya enviado" }); continue;
    }
    let saved = c.mediaId ? await store.get("posts/" + c.mediaId, { type: "json" }) : null;
    let auto = null;
    if (!saved) { auto = await matchByRef(store, cfg, c.mediaId, currentCatalog, context); saved = auto?.post || null; }
    const post = shortStoreLink(refreshPost(saved, saved ? await currentCatalog() : null), new URL(request.url).origin);
    const text = buildMessage({ username: c.username, post, whatsapp: cfg.whatsapp });
    try {
      if (!cfg.accessToken || !cfg.igUserId) throw new Error("Falta la llave de acceso de Instagram.");
      await igApi.privateReply(cfg.accessToken, cfg.igUserId, c.commentId, text);
      await store.setJSON(personKey, { at: Date.now() });
      await addLog(store, { ...c, product: post?.title || "", result: post ? (auto?.post ? "enviado (asociado solo por Ref. " + auto.code + ")" : "enviado")
        : auto?.code ? "enviado (la Ref. " + auto.code + " no existe en el catálogo: se envió el catálogo)" : "enviado (sin producto asociado: catálogo)" });
      results.push({ commentId: c.commentId, result: "enviado" });
    } catch (e) {
      await addLog(store, { ...c, product: post?.title || "", result: "error: " + String(e.message).slice(0, 200) });
      results.push({ commentId: c.commentId, result: "error" });
    }
  }
  // Siempre 200 si la firma es válida, para que Meta no reintente sin fin.
  return json(200, { ok: true, results });
}

export const config = { path: "/instagram-webhook" };
