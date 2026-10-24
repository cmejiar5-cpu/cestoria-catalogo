// Prueba de extremo a extremo del botón «Añadir a Cestoria» con páginas de Amazon simuladas.
// Requiere Playwright (preinstalado en el entorno de pruebas). Uso: node scripts/test-admin-bookmarklet.cjs [puerto]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const BASE = 'http://127.0.0.1:' + (process.argv[2] || 8765);
const desktop = `<html><head><title>Amazon.com: Botella sensorial : Toys</title></head><body>
<span id="productTitle"> Botella sensorial de brillos para niños </span>
<div id="imgTagWrapperId"><img id="landingImage" src="https://m.media-amazon.com/images/I/small.jpg" data-old-hires="https://m.media-amazon.com/images/I/big._AC_SL1500_.jpg"></div>
<div id="feature-bullets"><ul><li><span class="a-list-item"> Agua, glitter y lentejuelas </span></li><li><span class="a-list-item">Calma visual</span></li></ul></div></body></html>`;
const mobile = `<html><head><title>Amazon.com: Tablero Montessori</title></head><body>
<span id="title"> Tablero Montessori de actividades </span>
<img id="main-image" data-a-hires="https://m.media-amazon.com/images/I/mob._AC_SX679_.jpg" src="https://m.media-amazon.com/images/I/mob-s.jpg">
<div id="productDescription"><p>Tablero sensorial con hebillas y cremalleras.</p></div></body></html>`;
const evil = `<html><body><span id="productTitle">&lt;img src=x onerror=alert(1)&gt;</span><img id="landingImage" data-old-hires="https://evil.example/x.jpg"></body></html>`;

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  let dialogs = 0; p.on('dialog', d => { dialogs++; d.dismiss(); });
  await ctx.route('https://www.amazon.com/**', r => {
    const u = r.request().url();
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: u.includes('B0MOBILE01') ? mobile : u.includes('B0EVIL0001') ? evil : desktop });
  });
  await ctx.route('**/.netlify/functions/amazon-product', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    title: '', description: '', image: '', url: 'https://link.amazon/B02KjkcGI', asin: 'B0FRMK2DCW',
    productUrl: 'https://www.amazon.com/dp/B0FRMK2DCW', source: 'manual', blocked: 'captcha', note: 'Amazon pidió verificación.' }) }));
  let href;
  const runButton = async () => {
    await Promise.all([p.waitForURL(/admin\.html/), p.evaluate(code => { (0, eval)(code); }, decodeURIComponent(href.slice('javascript:'.length)))]);
    await p.waitForFunction(() => document.querySelector('#amazonStatus').textContent.length > 0);
  };

  // A. Flujo completo: pegar enlace corto -> Importar (captcha) -> Amazon -> botón -> ficha rellena con el enlace original
  await p.goto(BASE + '/admin.html');
  href = await p.evaluate(() => BOOKMARKLET);
  await p.fill('#url', 'https://link.amazon/B02KjkcGI');
  await p.click('#amazonImportBtn'); await p.waitForTimeout(300);
  await p.goto('https://www.amazon.com/dp/B0FRMK2DCW/ref=x?tag=cestoria-20');
  await runButton();
  assert.equal(await p.inputValue('#title'), 'Botella sensorial de brillos para niños');
  assert.equal(await p.inputValue('#image'), 'https://m.media-amazon.com/images/I/big._AC_SL1500_.jpg');
  assert.equal(await p.inputValue('#description'), 'Agua, glitter y lentejuelas · Calma visual');
  assert.equal(await p.inputValue('#url'), 'https://link.amazon/B02KjkcGI', 'conserva el enlace de afiliado exacto');
  assert.equal(new URL(p.url()).hash, '', 'limpia el fragmento');
  console.log('A estado:', await p.textContent('#amazonStatus'));

  // B. Guardar borrador y comprobar que sobrevive a recargar
  await p.fill('#category', 'Sensorial'); await p.click('button[type=submit]');
  await p.reload(); await p.waitForTimeout(500);
  assert.ok((await p.textContent('#productList')).includes('Botella sensorial de brillos'), 'borrador persiste');

  // C. Página móvil sin enlace pendiente del mismo producto: usa la URL con etiqueta
  await p.goto('https://www.amazon.com/gp/aw/d/B0MOBILE01?tag=cestoria-20');
  await runButton();
  assert.equal(await p.inputValue('#title'), 'Tablero Montessori de actividades');
  assert.equal(await p.inputValue('#image'), 'https://m.media-amazon.com/images/I/mob._AC_SX679_.jpg');
  assert.match(await p.inputValue('#description'), /hebillas/);
  assert.match(await p.inputValue('#url'), /tag=cestoria-20/);

  // D. Datos hostiles: imagen fuera de Amazon se descarta y el título se trata como texto
  await p.goto('https://www.amazon.com/dp/B0EVIL0001');
  await runButton();
  assert.equal(await p.inputValue('#image'), '');
  assert.equal(await p.inputValue('#url'), '', 'sin etiqueta no inventa enlace');
  assert.equal(dialogs, 0, 'no se ejecutó código inyectado');

  // E. Fuera de Amazon el botón no hace nada
  await p.goto(BASE + '/index.html');
  await p.evaluate(code => { (0, eval)(code); }, decodeURIComponent(href.slice('javascript:'.length)));
  await p.waitForTimeout(300);
  assert.equal(dialogs, 1, 'avisa de que hay que estar en Amazon'); assert.ok(p.url().includes('index.html'));

  console.log('OK: 5 escenarios del botón superados'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
