// Muestra los identificadores largos de los feeds publicados (diagnóstico de "RetailerID es demasiado largo").
const base = process.argv[2] || "https://catalogo-cestoriashop-git.netlify.app";
for (const q of ["?mercados=todos", "?pais_override=CO"]) {
  const t = await (await fetch(base + "/feed-whatsapp.csv" + q)).text();
  const lines = t.split("\r\n");
  console.log("\n== " + q + " · " + (lines.length - 2) + " filas");
  lines.forEach((l, i) => {
    const id = l.startsWith('"') ? l.slice(1, l.indexOf('"', 1)) : l.split(",")[0];
    if (i === 8 || id.length >= 90) console.log(" línea " + (i + 1) + " · largo " + id.length + " (bytes " + Buffer.byteLength(id) + ") · " + id);
  });
}
