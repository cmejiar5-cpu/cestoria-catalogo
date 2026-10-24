// Lee los productos REALES de la tienda (solo lectura) y muestra qué entraría en el feed.
import { buildItems, toCsv, fetchStoreRows } from "../netlify/functions/whatsapp-feed.mjs";
for (const country of (process.argv[2] || "CO").split(",")) {
  const rows = await fetchStoreRows(country);
  const { items, skipped } = buildItems(rows, country);
  console.log(`\n== ${country}: ${rows.length} productos activos, ${items.length} en el feed, ${skipped.length} excluidos`);
  for (const it of items) console.log(" +", it.title.slice(0, 70), "|", it.price, it.sale_price ? "(oferta " + it.sale_price + ")" : "", "|", it.availability);
  for (const s of skipped) console.log(" -", s.name.slice(0, 70), "→", s.reason);
  if (country === "CO") console.log("\nPrimeras líneas del CSV:\n" + toCsv(items).split("\r\n").slice(0, 3).map(l => l.slice(0, 300)).join("\n"));
}
