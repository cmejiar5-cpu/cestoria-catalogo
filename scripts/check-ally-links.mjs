// Comprueba enlaces de aliados (solo lectura): estado, título, descripción e imagen de vista previa.
const urls = ["https://clubanimalitos.art", "https://www.youtube.com/@Clubanimalitos", "https://www.youtube.com/@FamiliaSinSorpresas"];
const meta = (h, k) => (h.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + k + '["\'][^>]*content=["\']([^"\']*)', "i")) || [])[1] || "";
for (const u of urls) {
  try {
    const r = await fetch(u, { redirect: "follow", headers: { "Accept-Language": "es-CO,es;q=0.9" }, signal: AbortSignal.timeout(20000) });
    const h = await r.text();
    console.log(JSON.stringify({ url: u, final: r.url, status: r.status, title: meta(h, "og:title") || (h.match(/<title>([^<]*)/i) || [])[1] || "", description: meta(h, "og:description") || meta(h, "description"), image: meta(h, "og:image") }));
  } catch (e) { console.log(JSON.stringify({ url: u, error: e.message })); }
}
