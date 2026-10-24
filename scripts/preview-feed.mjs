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

// Opción B: tres mercados
import { buildAllMarkets, buildCountryOverride, MARKETS } from "../netlify/functions/whatsapp-feed.mjs";
const byC = {}; for (const c of MARKETS) byC[c] = await fetchStoreRows(c);
const all = buildAllMarkets(byC);
console.log(`\n== Tres mercados: ${all.items.length} productos en el catálogo principal`);
const both = all.items.filter(i => i.mercados.length > 1);
console.log("   compartidos entre países:", both.length, both.slice(0, 5).map(i => i.title.slice(0, 40) + " [" + i.mercados.join("+") + "]").join(" | "));
for (const c of MARKETS) { const rows = buildCountryOverride(all, c); console.log(`   feed ${c}: ${rows.filter(r => r.availability === "in stock").length} disponibles, ${rows.filter(r => r.availability !== "in stock").length} agotados/no se venden`); }
