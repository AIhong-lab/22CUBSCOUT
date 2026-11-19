// 後端很慢或沒有回應時的網頁行為（SPEC 附錄第 66 點）：
// ① 從首頁點公佈欄、了解幼童軍、活動時間：首頁已經拿到的資料馬上顯示，不用等後端；
// ② 後端一直沒回應：逾時後顯示訊息與「再試一次」，不會永遠停在「載入中」。
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { loadGas } = require('../gas-mock.js');

const ROOT = path.join(__dirname, '..', '..');
const GAS = 'https://script.google.com/macros/s/TEST/exec';
const PAGE = 'https://pages.test/web/';

(async () => {
  const env = loadGas();
  env.ctx.setupCore_();
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/^const GAS_URL = '[^']*';/m, `const GAS_URL = '${GAS}';`);
  const browser = await chromium.launch();
  const open = async (opts) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://pages.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.route(GAS, async (r) => {
      const body = r.request().postData();
      const action = JSON.parse(body).action;
      if (opts.hang && opts.hang.includes(action)) return; // 永遠不回應
      if (opts.delay) await new Promise((ok) => setTimeout(ok, opts.delay(action)));
      try { await r.fulfill({ contentType: 'application/json', body: env.ctx.doPost({ parameter: {}, postData: { contents: body } }).t }); } catch (e) { /* 頁面已關閉 */ }
    });
    if (opts.timeout) await page.addInitScript((t) => { window.__apiTimeout = t; }, opts.timeout);
    return { ctx, page, errors };
  };

  // ① 首頁載入完成後，第二次拿資料很慢：點進去仍然馬上看到內容
  {
    let slow = false;
    const { ctx, page, errors } = await open({ delay: () => (slow ? 4000 : 0) });
    await page.goto(PAGE);
    await page.locator('#calCard').waitFor();
    await page.locator('#noticeCard').waitFor();
    slow = true;
    for (const [sel, text] of [['nav.tabs button[data-v=notices]', '目前沒有公告'], ['#infoBack', null], ['#homeLinks [data-info=calendar]', '行事曆'], ['#infoBack', null], ['#homeLinks [data-info=about]', '認識 22 團']]) {
      await page.locator(sel).click();
      if (!text) { await page.locator('#homeLinks').waitFor(); continue; }
      await page.getByText(text).first().waitFor({ timeout: 1000 }); // 不用等 4 秒的後端
      assert.ok(!(await page.locator('.loading').count()), '不顯示載入中');
    }
    // 慢的回應回來時已經換頁：不可以蓋掉目前的畫面
    await page.locator('#infoBack').click();
    await page.locator('nav.tabs button[data-v=progress]').click();
    await page.waitForTimeout(4500);
    assert.ok(!(await page.locator('#infoBack').count()), '換頁後不會被舊的回應拉回去');
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ② 直接打開公佈欄，後端完全沒回應：逾時後顯示訊息與「再試一次」
  {
    const { ctx, page, errors } = await open({ hang: ['notices', 'unitImages'], timeout: 1500 });
    await page.goto(PAGE + '#notices');
    await page.getByText('系統回應太慢').waitFor({ timeout: 5000 });
    assert.ok(await page.locator('#infoRetry').isVisible());
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  await browser.close();
  console.log('慢速／無回應後端測試通過（快取先顯示、逾時有訊息）');
})().catch((e) => { console.error(e); process.exit(1); });
