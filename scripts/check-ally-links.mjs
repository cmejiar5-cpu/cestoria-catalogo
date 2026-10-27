// Diagnóstico (solo lectura): qué producto de Amazon hay detrás de cada enlace.
import handler from "../netlify/functions/amazon-product.mjs";
for (const url of ["https://link.amazon/B04eNoXkk", "https://amzn.to/3VOByHx"]) {
  const r = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }));
  const d = await r.json();
  console.log("ENLACE", url, "| asin:", d.asin, "| fuente:", d.source, d.blocked || "", "| titulo:", (d.title || "").slice(0, 150), "| imagen:", d.image || "");
}
