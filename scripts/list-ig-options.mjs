// Lista (solo lectura) las opciones que el administrador ofrece para emparejar publicaciones de Instagram.
const base = "https://catalogo-cestoriashop-git.netlify.app";
const cat = await (await fetch(base + "/.netlify/functions/catalog")).json();
const own = (cat.categories || []).flatMap(c => (c.items || []).map(p => ({ cat: c.name, title: p.title, url: p.url, type: p.type })));
console.log("CATALOGO_PROPIO", own.length);
for (const p of own) console.log(" -", p.type, "|", p.cat, "|", p.title.slice(0, 90), "|", p.url);
for (const c of ["CO", "PE", "EC"]) {
  const d = await (await fetch(base + "/.netlify/functions/store-products?pais=" + c)).json();
  console.log("TIENDA_" + c, (d.items || []).length, d.error || "");
}
