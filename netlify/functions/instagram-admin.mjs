// Gestión de Instagram desde el administrador (requiere la clave de publicación).
// POST /.netlify/functions/instagram-admin  { action, ... }
//   status · save-config · subscribe · media · map · refresh-token
import { igStore, getConfig, saveConfig, newVerifyToken, igApi, refreshToken, recentLog, adminAuthorized, json, DEFAULT_WHATSAPP } from "../lib/instagram.mjs";

const str = (v, n) => typeof v === "string" ? v.trim().slice(0, n) : "";
const https = v => { try { const u = new URL(String(v)); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };

export default async function handler(request, context) {
  if (request.method !== "POST") return json(405, { error: "Método no permitido." });
  const auth = adminAuthorized(request);
  if (!auth.ok) return json(auth.status, { error: auth.error });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Solicitud no válida." }); }
  const store = igStore(context);
  const cfg = await getConfig(store);
  const origin = new URL(request.url).origin;

  try {
    switch (body.action) {
      case "status": {
        const { blobs } = await store.list({ prefix: "posts/" });
        const mappings = (await Promise.all(blobs.map(async b => ({ mediaId: b.key.slice(6), ...(await store.get(b.key, { type: "json" })) }))));
        let subscribed = null;
        if (cfg.accessToken && body.checkSubscription) {
          try { const s = await igApi.subscriptions(cfg.accessToken); subscribed = JSON.stringify(s).includes("comments"); } catch { subscribed = false; }
        }
        return json(200, {
          configured: Boolean(cfg.appSecret && cfg.accessToken && cfg.igUserId),
          hasAppSecret: Boolean(cfg.appSecret), hasToken: Boolean(cfg.accessToken),
          username: cfg.username || "", igUserId: cfg.igUserId || "",
          tokenExpiresAt: cfg.tokenExpiresAt || "", whatsapp: cfg.whatsapp || DEFAULT_WHATSAPP,
          verifyToken: cfg.verifyToken || "", webhookUrl: origin + "/instagram-webhook",
          subscribed, mappings, log: (await recentLog(store)).filter(Boolean)
        });
      }
      case "save-config": {
        const next = { ...cfg };
        if (!next.verifyToken) next.verifyToken = newVerifyToken();
        const secret = str(body.appSecret, 200);
        if (secret) { if (!/^[0-9a-f]{20,64}$/i.test(secret)) return json(400, { error: "El secreto de la app no tiene el formato esperado (letras a-f y números)." }); next.appSecret = secret; }
        const wa = https(body.whatsapp);
        if (body.whatsapp && !wa) return json(400, { error: "El enlace de WhatsApp debe empezar por https://" });
        if (wa) next.whatsapp = wa;
        const token = str(body.accessToken, 1000);
        if (token) {
          const me = await igApi.me(token); // comprueba que la llave funciona
          next.accessToken = token;
          next.igUserId = String(me.user_id || me.id || "");
          next.username = String(me.username || "");
          next.tokenUpdatedAt = new Date().toISOString();
          next.tokenExpiresAt = new Date(Date.now() + 60 * 86400e3).toISOString();
        }
        await saveConfig(store, next);
        return json(200, { ok: true, username: next.username || "", verifyToken: next.verifyToken });
      }
      case "subscribe": {
        if (!cfg.accessToken) return json(400, { error: "Primero guarda la llave de acceso de Instagram." });
        await igApi.subscribe(cfg.accessToken);
        return json(200, { ok: true });
      }
      case "media": {
        if (!cfg.accessToken) return json(400, { error: "Primero guarda la llave de acceso de Instagram." });
        const r = await igApi.media(cfg.accessToken);
        return json(200, { items: (r.data || []).map(m => ({ id: m.id, caption: str(m.caption, 200), type: m.media_type, image: https(m.thumbnail_url || m.media_url), permalink: https(m.permalink), timestamp: m.timestamp })) });
      }
      case "map": {
        const mediaId = str(body.mediaId, 40);
        if (!/^\d{5,40}$/.test(mediaId)) return json(400, { error: "Publicación no válida." });
        if (body.remove) { await store.delete("posts/" + mediaId); return json(200, { ok: true }); }
        const p = body.product || {};
        const title = str(p.title, 200), url = https(p.url);
        if (!title || !url) return json(400, { error: "Elige un producto con nombre y enlace." });
        await store.setJSON("posts/" + mediaId, { productId: str(p.id, 80), title, url, image: https(p.image), permalink: https(body.permalink), updatedAt: new Date().toISOString() });
        return json(200, { ok: true });
      }
      case "refresh-token": {
        return json(200, await refreshToken(store, { force: true }));
      }
      default: return json(400, { error: "Acción desconocida." });
    }
  } catch (e) {
    return json(502, { error: "Meta respondió: " + String(e.message).slice(0, 300) });
  }
}
