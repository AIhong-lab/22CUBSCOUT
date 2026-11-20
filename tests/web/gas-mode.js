// 網頁直接由 GAS 提供時的冒煙測試（SPEC 附錄第 56 點）：模擬 google.script.run／url／history，後端接 tests/gas-mock.js。
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { loadGas } = require('../gas-mock.js');

(async () => {
  const env = loadGas();
  env.ctx.setupCore_();
  const invite = env.ctx.loadInvites_()[0].code;
  env.api({ action: 'register', code: invite, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' });
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'Index.html'), 'utf8');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
  assert.equal(html, src.split('\n').filter((l) => !l.includes('http-equiv="Content-Security-Policy"')).join('\n'), 'dist/Index.html 只比 web/index.html 少了內容安全政策那一行');
  assert.ok(src.includes('Content-Security-Policy'));
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let calls = 0, fetches = 0;
  env.html.Index = html;
  // 頁面內容來自 doGet：首頁要用的公開資料已經內嵌在網頁裡
  await page.route('https://gas.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: env.ctx.doGet({ parameter: {} }).content }));
  await page.route('https://script.google.com/**', (r) => { fetches++; r.abort(); });
  await page.exposeFunction('__apiFromPage', (body) => { calls++; return env.ctx.apiFromPage(body); });
  const open = async (loc) => {
    await page.addInitScript((l) => {
      window.__hist = [];
      const run = (ok, no) => ({
        withSuccessHandler: (f) => run(f, no), withFailureHandler: (f) => run(ok, f),
        apiFromPage: (body) => { window.__apiFromPage(body).then((r) => ok && ok(r), (e) => no && no(e)); },
      });
      window.google = { script: { run: run(null, null), url: { getLocation: (cb) => setTimeout(() => cb(l), 0) }, history: { replace: (a, b, h) => window.__hist.push(h) } } };
    }, loc);
    await page.goto('about:blank'); await page.goto('https://gas.test/exec');
  };

  // 首頁：用 google.script.run 取得資料，沒有任何 fetch
  await open({ hash: '', parameter: {} });
  await page.locator('#secCards').waitFor();
  await page.locator('#noticeCard').waitFor();
  await page.locator('#calCard .cal-grid').waitFor();
  assert.equal(fetches, 0, '由 GAS 提供時不用 fetch');
  assert.equal(calls, 0, '開首頁不用再向後端要資料（公佈欄、月曆、項目、章圖都已內嵌）');
  assert.match(await page.locator('#noticeCard').innerText(), /目前沒有公告/);
  // 登入進後台
  await page.locator('nav.tabs button[data-v=login]').click();
  await page.fill('input[name=username]', 'leader01'); await page.fill('input[name=password]', 'leaderpass1');
  await page.click('button[type=submit]');
  await page.locator('#adminQuick').waitFor();
  // LINE 選單的連結：?p=notices 與 #calendar 都能直接開到那一頁
  await open({ hash: '', parameter: { p: 'notices' } });
  await page.locator('#infoBack').waitFor();
  assert.match(await page.locator('#app').innerText(), /公佈欄/);
  assert.ok((await page.evaluate(() => window.__hist)).includes('notices'), '網址的 # 透過 google.script.history 更新');
  await open({ hash: 'calendar', parameter: {} });
  await page.locator('#calCard .cal-grid').waitFor();
  assert.deepEqual(errors, [], '頁面不可有 JavaScript 錯誤');
  console.log(`GAS 模式冒煙測試通過（透過 google.script.run 呼叫後端 ${calls} 次）`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
