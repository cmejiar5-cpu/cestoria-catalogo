// Pruebas sin red de la respuesta automática de Instagram (Meta simulado).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import webhook from "../netlify/functions/instagram-webhook.mjs";
import admin from "../netlify/functions/instagram-admin.mjs";
import { __setInstagramStoreForTests, __setInstagramFetchForTests, extractComments, buildMessage, validSignature } from "../netlify/lib/instagram.mjs";

const stores = {};
__setInstagramStoreForTests(name => {
  const m = stores[name] ||= new Map();
  return {
    async get(k, o) { const v = m.get(k); return v === undefined ? null : (o?.type === "json" ? JSON.parse(v) : v); },
    async setJSON(k, v, o = {}) { if (o.onlyIfNew && m.has(k)) return { modified: false }; m.set(k, JSON.stringify(v)); return { modified: true }; },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
    async delete(k) { m.delete(k); }
  };
});
const calls = [];
__setInstagramFetchForTests(async (url, init = {}) => {
  calls.push({ url: String(url), init });
  const u = String(url);
  if (u.includes("/me?fields=user_id,username")) return Response.json(init.headers.Authorization === "Bearer BUENA" ? { user_id: "17841424417134943", username: "cestoriashop" } : { error: { message: "Invalid OAuth access token" } }, { status: init.headers.Authorization === "Bearer BUENA" ? 200 : 400 });
  if (u.includes("/messages")) return Response.json({ recipient_id: "x", message_id: "m1" });
  if (u.includes("/me/media")) return Response.json({ data: [{ id: "18000000000000001", caption: "Botella sensorial ✨", media_type: "VIDEO", thumbnail_url: "https://cdn.ig/t.jpg", permalink: "https://www.instagram.com/reel/abc/", timestamp: "2026-10-24T11:34:00+0000" }] });
  if (u.includes("/subscribed_apps")) return Response.json({ success: true });
  if (u.includes("refresh_access_token")) return Response.json({ access_token: "NUEVA", token_type: "bearer", expires_in: 5183944 });
  return new Response("{}", { status: 404 });
});
process.env.CATALOG_ADMIN_KEY = "clave-admin-larga-123";
const prod = { deploy: { context: "production" } };
const adm = async (body, key = "clave-admin-larga-123") => {
  const r = await admin(new Request("https://catalogo.test/.netlify/functions/instagram-admin", { method: "POST", headers: { authorization: "Bearer " + key }, body: JSON.stringify(body) }), prod);
  return { status: r.status, data: await r.json() };
};
const SECRET = "0123456789abcdef0123456789abcdef";
const hook = async (payload, secret = SECRET) => {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const r = await webhook(new Request("https://catalogo.test/instagram-webhook", { method: "POST", headers: { "x-hub-signature-256": sig }, body: raw }), prod);
  return { status: r.status, data: await r.json() };
};
const comment = (id, from, media, field = "comments", changes = true) => {
  const value = { id, text: "info", from: { id: from, username: "maria.p" }, media: { id: media } };
  return { object: "instagram", entry: [changes ? { id: "17841424417134943", time: 1, changes: [{ field, value }] } : { id: "17841424417134943", field, value }] };
};

// 1. Sin clave de administrador no se puede configurar
assert.equal((await adm({ action: "status" }, "mala")).status, 401);
// 2. Sin configurar, el webhook rechaza
assert.equal((await hook(comment("c0", "u1", "18000000000000001"))).status, 503);
// 3. Llave de Instagram inválida -> error claro, no se guarda
let r = await adm({ action: "save-config", appSecret: SECRET, accessToken: "MALA" });
assert.equal(r.status, 502); assert.match(r.data.error, /Invalid OAuth/);
// 4. Configuración correcta
r = await adm({ action: "save-config", appSecret: SECRET, accessToken: "BUENA" });
assert.equal(r.status, 200); assert.equal(r.data.username, "cestoriashop"); assert.match(r.data.verifyToken, /^cestoria-[0-9a-f]{32}$/);
const verify = r.data.verifyToken;
r = await adm({ action: "status" });
assert.equal(r.data.configured, true); assert.equal(r.data.webhookUrl, "https://catalogo.test/instagram-webhook");
assert.ok(!JSON.stringify(r.data).includes(SECRET) && !JSON.stringify(r.data).includes("BUENA"), "nunca devuelve secretos");
// 5. Verificación de Meta
let v = await webhook(new Request("https://catalogo.test/instagram-webhook?hub.mode=subscribe&hub.verify_token=" + verify + "&hub.challenge=12345"), prod);
assert.equal(v.status, 200); assert.equal(await v.text(), "12345");
v = await webhook(new Request("https://catalogo.test/instagram-webhook?hub.mode=subscribe&hub.verify_token=otra&hub.challenge=1"), prod);
assert.equal(v.status, 403);
// 6. Publicaciones y asociación con producto
r = await adm({ action: "media" }); assert.equal(r.data.items[0].id, "18000000000000001");
r = await adm({ action: "map", mediaId: "18000000000000001", permalink: "https://www.instagram.com/reel/abc/", product: { id: "tienda-tensiometro", title: "Tensiómetro de muñeca", url: "https://cestoria.shop/producto/tensiometro" } });
assert.equal(r.status, 200);
assert.equal((await adm({ action: "map", mediaId: "18000000000000001", product: { title: "x", url: "javascript:alert(1)" } })).status, 400);
// 7. Firma inválida -> 401 y no envía nada
const before = calls.length;
assert.equal((await hook(comment("c1", "u1", "18000000000000001"), "ffffffffffffffffffffffffffffffff")).status, 401);
assert.equal(calls.length, before);
// 8. Comentario en publicación asociada -> mensaje privado con producto y WhatsApp
r = await hook(comment("c1", "u1", "18000000000000001"));
assert.equal(r.data.results[0].result, "enviado");
const sent = calls.at(-1);
assert.match(sent.url, /\/17841424417134943\/messages$/);
const msg = JSON.parse(sent.init.body);
assert.deepEqual(msg.recipient, { comment_id: "c1" });
assert.match(msg.message.text, /@maria\.p/); assert.match(msg.message.text, /Tensiómetro de muñeca\nhttps:\/\/cestoria\.shop\/producto\/tensiometro/); assert.match(msg.message.text, /wa\.me\/573152424445/);
// 9. Aviso repetido de Meta -> no duplica
assert.equal((await hook(comment("c1", "u1", "18000000000000001"))).data.results[0].result, "repetido");
// 10. Misma persona, otro comentario en la misma publicación -> no vuelve a escribir
assert.equal((await hook(comment("c2", "u1", "18000000000000001"))).data.results[0].result, "ya enviado");
// 11. Comentario de la propia cuenta -> se ignora
assert.equal((await hook(comment("c3", "17841424417134943", "18000000000000001"))).data.results[0].result, "propio");
// 12. Publicación sin producto asociado -> envía el catálogo; forma alternativa del aviso (sin "changes")
const n = calls.length;
r = await hook(comment("c4", "u2", "18999999999999999", "comments", false));
assert.equal(r.data.results[0].result, "enviado");
assert.match(JSON.parse(calls.at(-1).init.body).message.text, /nuestro catálogo: https:\/\/catalogo-cestoriashop-git\.netlify\.app/);
assert.equal(calls.length, n + 1);
// 13. Otros campos (menciones, mensajes) se ignoran
assert.deepEqual(extractComments(comment("c5", "u3", "1", "mentions")), []);
// 14. Registro de actividad y renovación de llave
r = await adm({ action: "status" }); assert.ok(r.data.log.length >= 3); assert.equal(r.data.mappings[0].title, "Tensiómetro de muñeca");
r = await adm({ action: "refresh-token" }); assert.equal(r.data.ok, true);
assert.equal(JSON.parse(stores.instagram.get("config")).accessToken, "NUEVA");
// 15. Vistas previas usan otro almacén
const preview = await admin(new Request("https://x/", { method: "POST", headers: { authorization: "Bearer clave-admin-larga-123" }, body: JSON.stringify({ action: "status" }) }), { deploy: { context: "deploy-preview" } });
assert.equal((await preview.json()).configured, false);
// 16. Utilidades
assert.equal(validSignature("x", "sha256=zz", SECRET), false);
assert.match(buildMessage({ username: "", post: null }), /^¡Hola! 😊/);
console.log("OK: Instagram, 16 escenarios superados");
