// 多分團骨架的網頁測試（SPEC 附錄第 68 點）：admin 在「分團身分與邀請碼」產生邀請碼，
// 童軍服務員用邀請碼註冊後只看到「分團功能準備中」，進不了小狼後台。測試資料一律虛構。
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadGas } = require('../gas-mock.js');

const ROOT = path.join(__dirname, '..', '..');
const GAS = 'https://script.google.com/macros/s/TEST/exec';
const PAGE = 'https://pages.test/web/';

(async () => {
  const env = loadGas();
  env.ctx.setupCore_();
  const invite = env.ctx.loadInvites_()[0].code;
  env.api({ action: 'register', code: invite, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' });
  const made = env.ctx.ensureDefaultAdmin_();
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/^const GAS_URL = '[^']*';/m, `const GAS_URL = '${GAS}';`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://pages.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.route(GAS, (r) => {
    const body = env.ctx.doPost({ parameter: {}, postData: { contents: r.request().postData() } }).t;
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  });
  const text = () => page.locator('#app').innerText();
  const login = async (u, p) => {
    await page.locator('nav.tabs button[data-v=login]').click();
    await page.fill('input[name=username]', u); await page.fill('input[name=password]', p);
    await page.click('button[type=submit]');
  };

  // ═════ admin：產生童軍服務員的邀請碼 ═════
  await page.goto(PAGE);
  await login(made.username, made.password);
  await page.locator('nav.tabs button[data-v=staff]').click();
  await page.getByText('🎟️ 產生邀請碼').waitFor();
  assert.match(await text(), /小狼[\s\S]*團長/, '列出小狼的團長');
  await page.selectOption('#fi select[name=section]', '童軍');
  await page.fill('#fi input[name=title]', '副團長');
  await page.fill('#fi input[name=name]', '王童軍');
  await page.click('#fi button[type=submit]');
  await page.locator('#invOut .codebox').waitFor();
  const code = (await page.locator('#invOut .codebox').innerText()).trim();
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.match(await page.locator('#invOut pre').innerText(), /童軍／服務員/);
  await page.locator('#hdrLogout').click();
  await page.getByText('已登出').waitFor();

  // ═════ 童軍服務員：用邀請碼註冊 → 準備中，沒有後台 ═════
  env.api({ action: 'register', code, childName: '', username: 'scout01', password: 'scoutpass1', nickname: '王' });
  await login('scout01', 'scoutpass1');
  await page.getByText('分團功能準備中').waitFor();
  assert.match(await text(), /童軍／服務員（副團長）/);
  assert.equal(await page.locator('#toAdmin').count(), 0, '沒有後台入口');

  assert.deepEqual(errors, [], '網頁沒有錯誤');
  await browser.close();
  console.log('多分團網頁測試通過（分團身分頁、邀請碼、其他分團準備中畫面）');
})().catch((e) => { console.error(e); process.exit(1); });
