export default async function handler(event) {
  const reply = (statusCode, data) => ({
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(data)
  });
  if (event.httpMethod !== "POST") return reply(405, { error: "Método no permitido." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Solicitud JSON no válida." }); }
  if (typeof body.url !== "string" || body.url.length > 2048) return reply(400, { error: "Introduce un enlace válido." });
  let url;
  try { url = new URL(body.url); } catch { return reply(400, { error: "Introduce una URL válida." }); }
  const host = url.hostname.toLowerCase();
  if (!["https:", "http:"].includes(url.protocol) || !(host.endsWith("amazon.com") || host.endsWith("amazon.co.uk") || host.endsWith("amazon.ca") || host.endsWith("amazon.es") || host.endsWith("amazon.com.mx") || host === "amzn.to")) {
    return reply(400, { error: "Solo se aceptan enlaces de Amazon o amzn.to." });
  }
  if (!process.env.AMAZON_ACCESS_KEY || !process.env.AMAZON_SECRET_KEY || !process.env.AMAZON_PARTNER_TAG) {
    return reply(503, { error: "La consulta automática está pendiente de configurar las credenciales oficiales de Amazon Product Advertising API en Netlify." });
  }
  return reply(501, { error: "Las credenciales están presentes, pero falta completar y probar la integración con Amazon Product Advertising API antes de activar la importación." });
}
