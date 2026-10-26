// Lógica compartida de la respuesta automática a comentarios de Instagram.
// Usa la API de Instagram con inicio de sesión de Instagram (graph.instagram.com).
// La configuración (claves de Meta) se guarda en Netlify Blobs desde el administrador,
// así no hace falta volver a publicar el sitio para cambiarla.
import { getStore } from "@netlify/blobs";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DEFAULT_WHATSAPP = "https://wa.me/573152424445";
export const CATALOG_BASE = "https://catalogo-cestoriashop-git.netlify.app";
const TOKEN_DAYS = 60;

const env = k => globalThis.Netlify?.env?.get(k) ?? process.env[k];
// Sin versión, graph.instagram.com usa la versión predeterminada de la app de Meta.
export const graphBase = () => "https://graph.instagram.com" + (env("IG_GRAPH_VERSION") ? "/" + env("IG_GRAPH_VERSION") : "");

let storeFactory = name => getStore({ name, consistency: "strong" });
export function __setInstagramStoreForTests(fn) { storeFactory = fn; }
let fetchImpl = (...a) => fetch(...a);
export function __setInstagramFetchForTests(fn) { fetchImpl = fn; }

// Las vistas previas usan otro almacén para no tocar la configuración real.
export function igStore(context) {
  const ctx = context?.deploy?.context;
  return storeFactory(!ctx || ctx === "production" ? "instagram" : "instagram-" + String(ctx).replace(/[^a-z0-9-]/gi, ""));
}

export const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

// ---------- Acceso del administrador (misma clave que para publicar el catálogo) ----------
const digest = v => createHash("sha256").update(String(v)).digest();
export function adminAuthorized(request) {
  const expected = String(env("CATALOG_ADMIN_KEY") ?? "").trim();
  if (!expected) return { ok: false, status: 503, error: "Falta configurar la variable CATALOG_ADMIN_KEY en Netlify." };
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!given || !timingSafeEqual(digest(given), digest(expected))) return { ok: false, status: 401, error: "Clave de publicación incorrecta." };
  return { ok: true };
}

// ---------- Configuración ----------
export async function getConfig(store) {
  return (await store.get("config", { type: "json" })) || {};
}
export async function saveConfig(store, cfg) {
  await store.setJSON("config", cfg);
}
export const newVerifyToken = () => "cestoria-" + randomBytes(16).toString("hex");

// Firma de Meta: cabecera X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo sin modificar, secreto de la app).
export function validSignature(rawBody, header, appSecret) {
  if (!appSecret || !header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header.slice(7).toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Extrae los comentarios de un aviso. Acepta las dos formas documentadas
// (entry[].changes[] y entry[] con field/value directo).
export function extractComments(body) {
  const out = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [entry];
    for (const ch of changes) {
      const v = ch?.value;
      if (ch?.field !== "comments" || !v || !v.id) continue;
      out.push({
        accountId: String(entry.id || ""),
        commentId: String(v.id),
        text: String(v.text || "").slice(0, 300),
        fromId: String(v.from?.id || ""),
        username: String(v.from?.username || "").replace(/[^\w.]/g, "").slice(0, 30),
        mediaId: String(v.media?.id || "")
      });
    }
  }
  return out;
}

export function buildMessage({ username, post, whatsapp }) {
  const hola = "¡Hola" + (username ? " @" + username : "") + "! 😊 Gracias por tu comentario.";
  const wa = whatsapp || DEFAULT_WHATSAPP;
  if (post?.url) {
    return hola + "\n\nAquí tienes el producto que viste:\n" + post.title + "\n" + post.url +
      "\n\n¿Tienes dudas o quieres pedirlo? Escríbenos por WhatsApp: " + wa;
  }
  return hola + "\n\nAquí tienes nuestro catálogo: " + CATALOG_BASE +
    "\n\n¿Buscas algo en especial? Escríbenos por WhatsApp: " + wa;
}

async function graph(path, { method = "GET", token, body } = {}) {
  const r = await fetchImpl(graphBase() + path, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok || data.error) {
    const msg = data?.error?.message || ("Meta respondió " + r.status);
    const err = new Error(msg); err.status = r.status; err.meta = data?.error; throw err;
  }
  return data;
}

export const igApi = {
  me: token => graph("/me?fields=user_id,username", { token }),
  media: token => graph("/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=30", { token }),
  subscribe: token => graph("/me/subscribed_apps?subscribed_fields=comments", { method: "POST", token }),
  subscriptions: token => graph("/me/subscribed_apps", { token }),
  privateReply: (token, igUserId, commentId, text) =>
    graph("/" + encodeURIComponent(igUserId) + "/messages", { method: "POST", token, body: { recipient: { comment_id: commentId }, message: { text } } }),
  refresh: token => graph("/refresh_access_token?grant_type=ig_refresh_token&access_token=" + encodeURIComponent(token), { token })
};

export async function refreshToken(store, { force = false } = {}) {
  const cfg = await getConfig(store);
  if (!cfg.accessToken) return { ok: false, reason: "sin llave de acceso" };
  const age = Date.now() - Date.parse(cfg.tokenUpdatedAt || 0);
  if (!force && age < 24 * 3600e3) return { ok: false, reason: "la llave tiene menos de 24 horas" };
  const r = await igApi.refresh(cfg.accessToken);
  cfg.accessToken = r.access_token;
  cfg.tokenUpdatedAt = new Date().toISOString();
  cfg.tokenExpiresAt = new Date(Date.now() + (Number(r.expires_in) || TOKEN_DAYS * 86400) * 1000).toISOString();
  await saveConfig(store, cfg);
  return { ok: true, expiresAt: cfg.tokenExpiresAt };
}

export async function addLog(store, item) {
  const at = new Date().toISOString();
  await store.setJSON("log/" + at + "-" + (item.commentId || Math.random().toString(36).slice(2)), { at, ...item });
}
export async function recentLog(store, n = 30) {
  const { blobs } = await store.list({ prefix: "log/" });
  const keys = blobs.map(b => b.key).sort().reverse();
  // Se guardan los 300 más recientes.
  await Promise.all(keys.slice(300).map(k => store.delete(k)));
  return Promise.all(keys.slice(0, n).map(k => store.get(k, { type: "json" })));
}
