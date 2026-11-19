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

  // ═════ 後端版本檢查（附錄第 72 點）：版本一致時不提醒；後端舊版時團長首頁出現紅色提醒 ═════
  await page.goto(PAGE);
  await login('leader01', 'leaderpass1');
  await page.locator('#sysTips').waitFor();
  assert.doesNotMatch(await text(), /後端還是舊版/, '版本一致時不提醒');
  await page.locator('#hdrLogout').click();
  await page.getByText('已登出').waitFor();
  const realVersion = env.ctx.APP_VERSION;
  env.ctx.APP_VERSION = 'old-test';
  await login('leader01', 'leaderpass1');
  await page.getByText('後端還是舊版').waitFor();
  assert.match(await text(), /不要按「新增部署作業」/);
  env.ctx.APP_VERSION = realVersion;
  await page.locator('#hdrLogout').click();
  await page.getByText('已登出').waitFor();

  // ═════ admin：產生童軍服務員的邀請碼 ═════
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

  // ═════ 童軍服務員：用邀請碼註冊 → 進童軍的後台（附錄第 73 點） ═════
  env.api({ action: 'register', code, childName: '', username: 'scout01', password: 'scoutpass1', nickname: '王' });
  await login('scout01', 'scoutpass1');
  await page.locator('#adminQuick').waitFor();
  assert.match(await page.locator('#title').innerText(), /22團 童軍後台/);
  assert.equal(await page.locator('nav.tabs button[data-v=sign]').count(), 0, '童軍沒有簽核（進程第 2 期）');
  assert.equal(await page.locator('#secSel').count(), 0, '只有一個分團時沒有分團切換');
  await page.locator('#hdrLogout').click();
  await page.getByText('已登出').waitFor();

  // ═════ admin：分團切換、全團總覽、在童軍發全團公告 ═════
  await login(made.username, made.password);
  await page.locator('#allSecs').waitFor();
  assert.match(await page.locator('#allSecs').innerText(), /稚齡童軍[\s\S]*幼童軍[\s\S]*羅浮童軍/);
  await page.selectOption('#secSel', '童軍');
  await page.locator('#title', { hasText: '童軍後台' }).waitFor();
  await page.locator('nav.tabs button[data-v=notices]').click();
  await page.locator('form#fn select[name=target]').waitFor();
  await page.fill('form#fn input[name=title]', '全團團慶通知');
  await page.selectOption('form#fn select[name=target]', '全團');
  await page.click('form#fn button[type=submit]');
  await page.getByText('全團團慶通知').waitFor();
  assert.equal(env.rows('公告').find((r) => r[1] === '全團團慶通知')[8], '全團');
  await page.locator('nav.tabs button[data-v=cubs]').click();
  await page.getByText('＋ 新增團員').click();
  await page.fill('input[name=name]', '測試童軍甲');
  await page.click('button[type=submit]');
  await page.getByText('測試童軍甲').first().waitFor();
  assert.equal(env.rows('小狼名單').find((r) => r[1] === '測試童軍甲')[11], '童軍');
  await page.locator('#hdrLogout').click();
  await page.getByText('已登出').waitFor();

  // ═════ 首頁（團部入口）顯示全團公告；家長註冊時替孩子選分團 ═════
  await page.locator('nav.tabs button[data-v=home]').click();
  await page.locator('#secCards').waitFor();
  await page.getByText('全團團慶通知').waitFor();
  await page.locator('nav.tabs button[data-v=login]').click();
  await page.getByText('註冊新帳號').click();
  await page.locator('[data-id=家長]').click();
  await page.fill('input[name=child]', '測試童軍乙');
  await page.selectOption('select[name=childSec]', '童軍');
  await page.fill('input[name=nickname]', '測試童軍乙媽媽');
  await page.fill('input[name=username]', 'scoutmom');
  await page.fill('input[name=password]', 'scoutmom12'); await page.fill('input[name=password2]', 'scoutmom12');
  await page.click('button[type=submit]');
  await page.locator('input[name=agree]').check();
  await page.click('button[type=submit]');
  await page.getByText('等待團長審核').first().waitFor();
  assert.equal(env.rows('註冊申請').find((r) => r[3] === '測試童軍乙')[11], '童軍');

  assert.deepEqual(errors, [], '網頁沒有錯誤');
  await browser.close();
  console.log('多分團網頁測試通過（後端版本提醒、分團身分頁、邀請碼、童軍後台、分團切換、全團公告、註冊選分團）');
})().catch((e) => { console.error(e); process.exit(1); });
