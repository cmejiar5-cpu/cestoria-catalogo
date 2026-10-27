// Sirve las fotos de productos que llegan desde Creativos (guardadas en Netlify Blobs).
// El nombre es la huella del contenido, así que nunca cambia: la CDN la guarda un año.
import { imagesStore } from "./catalog-ingest.mjs";

export default async function handler(request, context) {
  const name = String(context?.params?.name || new URL(request.url).pathname.split("/").pop() || "");
  if (!/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(name)) return new Response("No encontrado", { status: 404 });
  const entry = await imagesStore(context).getWithMetadata(name, { type: "arrayBuffer" });
  if (!entry?.data) return new Response("No encontrado", { status: 404 });
  const cache = "public, max-age=31536000, immutable";
  return new Response(entry.data, { status: 200, headers: {
    "Content-Type": entry.metadata?.type || "image/jpeg",
    "Cache-Control": cache, "Netlify-CDN-Cache-Control": cache + ", durable"
  } });
}

export const config = { path: "/img/:name" };
