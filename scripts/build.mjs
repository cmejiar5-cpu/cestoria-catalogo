// Copia solo los archivos públicos del sitio a dist/ (no publica node_modules, scripts ni funciones).
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
const FILES = ["index.html", "admin.html", "privacidad.html", "sw.js", "manifest.webmanifest", "cestoria_data.json", "icons"];
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
for (const f of FILES) {
  if (!existsSync(f)) throw new Error("Falta " + f);
  cpSync(f, "dist/" + f, { recursive: true });
}
console.log("Sitio estático listo en dist/:", FILES.join(", "));
