// PWA 測試（SPEC 附錄第 62 點）：用本機伺服器提供 web/，確認 manifest 與圖示正確、
// Service Worker 會安裝、沒網路時網頁仍打得開，而且呼叫後端（POST）不會被快取。
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/manifest+json', '.js': 'text/javascript', '.png': 'image/png' };

(async () => {
  // manifest 內容與圖示檔
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/manifest.json'), 'utf8'));
  assert.equal(mf.display, 'standalone');
  assert.equal(mf.start_url, './');
  for (const ic of mf.icons) {
    const buf = fs.readFileSync(path.join(ROOT, 'web', ic.src));
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, ic.sizes, ic.src + ' 尺寸');
  }
  assert.ok(mf.icons.some((i) => i.purpose === 'maskable'));

  // 本機伺服器（localhost 算安全環境，Service Worker 可以用）；後端網址改成不存在的位址
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/^const GAS_URL = '[^']*';/m, "const GAS_URL = 'https://script.google.com/macros/s/PWA-TEST/exec';");
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/web\/?/, '');
    if (!rel || rel === 'index.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(html); }
    const file = path.join(ROOT, 'web', rel);
    if (rel.includes('..') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  }).listen(0);
  const url = `http://localhost:${server.address().port}/web/`;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/Content Security Policy|Refused to|Manifest/.test(m.text())) errors.push(m.text()); });
  // 後端：一律回「首頁需要的空資料」，並記錄 POST 次數
  let posts = 0;
  await context.route('https://script.google.com/**', (r) => { posts++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, notices: [], images: {}, meetings: [], events: [], units: [], items: [] }) }); });

  await page.goto(url);
  await page.getByText('什麼是「進程」？').waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('link[rel=manifest]').href.endsWith('/web/manifest.json')), true);
  // Service Worker 安裝完成並接管頁面
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByText('什麼是「進程」？').waitFor();
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true, 'Service Worker 已接管');
  const cached = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url); return out; });
  assert.ok(cached.some((u) => u.endsWith('/web/')), '網頁有存在手機裡');
  assert.ok(!cached.some((u) => /script\.google/.test(u)), '後端資料沒有被快取');

  // 沒網路：網頁仍打得開（資料會顯示連線失敗，不會是瀏覽器的離線錯誤頁）
  await context.setOffline(true);
  await page.reload();
  await page.getByText('什麼是「進程」？').waitFor();
  await context.setOffline(false);

  assert.deepEqual(errors, [], '沒有錯誤或內容安全政策阻擋');
  assert.ok(posts > 0);
  await browser.close();
  server.close();
  console.log('PWA 測試通過（manifest、圖示、Service Worker、離線開啟）');
})().catch((e) => { console.error(e); process.exit(1); });
