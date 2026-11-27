// 全團其餘功能的網頁測試（SPEC 附錄第 80 點）：羅浮本人註冊、升團、續團確認、三項登記、童軍專科章。測試資料一律虛構。
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
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const W = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const inv = call(O, 'inviteCreate', { section: '羅浮', role: '團長', title: '群長', name: '群長' });
  const R = env.api({ action: 'register', code: inv.code, childName: '', username: 'roverlead', password: 'roverpass1', nickname: '群長' }).token;
  call(W, 'squadSave', { type: 'add', name: '一小隊' });
  const kid = call(W, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2023-01-01' });
  call(W, 'backfill', { cubId: kid.cubId, unit: '豹', date: '2026-01-01', includeLower: true });
  const kid2 = call(W, 'cubSave', { name: '測試小狼乙', squad: '一小隊', joinDate: '2025-01-01' });

  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/^const GAS_URL = '[^']*';/m, `const GAS_URL = '${GAS}';`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.route('https://pages.test/**', (rt) => rt.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.route(GAS, (rt) => {
    const body = env.ctx.doPost({ parameter: {}, postData: { contents: rt.request().postData() } }).t;
    rt.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  });
  const text = () => page.locator('#app').innerText();
  const login = async (u, p) => {
    await page.locator('nav.tabs button[data-v=login]').click();
    await page.fill('input[name=username]', u); await page.fill('input[name=password]', p);
    await page.click('button[type=submit]');
  };
  const logout = async () => { await page.locator('#hdrLogout').click(); await page.getByText('已登出').waitFor(); };

  // ═════ 羅浮本人自己註冊：成年人版個資說明 → 等群長審核 ═════
  await page.goto(PAGE);
  await page.locator('nav.tabs button[data-v=login]').click();
  await page.getByText('註冊新帳號').click();
  await page.locator('[data-id=羅浮本人]').click();
  await page.fill('input[name=selfName]', '測試羅浮甲');
  await page.fill('input[name=username]', 'rover01');
  await page.fill('input[name=password]', 'roverpass9'); await page.fill('input[name=password2]', 'roverpass9');
  await page.click('button[type=submit]');
  await page.locator('.consent').waitFor();
  assert.match(await page.locator('.consent').innerText(), /^您好/);
  assert.doesNotMatch(await page.locator('.consent').innerText(), /家長/);
  await page.locator('input[name=agree]').check();
  await page.click('button[type=submit]');
  await page.getByText('羅浮本人申請').first().waitFor();
  const req = env.rows('註冊申請').find((x) => x[3] === '測試羅浮甲');
  assert.deepEqual([req[2], req[11]], ['本人', '羅浮']);
  const rid = call(R, 'requestList').items[0].requestId;
  assert.equal(call(R, 'requestApprove', { requestId: rid, name: '測試羅浮甲', squad: '', joinDate: '2026-11-01' }).ok, true);
  await page.reload();
  await page.getByText('測試羅浮甲').first().waitFor();
  await page.locator('nav.tabs button[data-v=mine]').click();
  await page.getByText('羅浮童軍本人').waitFor();
  await page.getByRole('button', { name: '登出' }).first().click();
  await page.getByText('已登出').waitFor();

  // ═════ 小狼團長：升團、續團確認 ═════
  await login('leader01', 'leaderpass1');
  await page.locator('#adminQuick').waitFor();
  await page.evaluate((id) => goAdmin('cub', { cubId: id }), kid.cubId);
  await page.locator('#moreBtn').click();
  await page.locator('#promote').click();
  await page.locator('#fpm button[type=submit]').click();
  await page.getByText('已升團到童軍').waitFor();
  assert.equal(env.rows('小狼名單').find((x) => x[0] === kid.cubId)[11], '童軍');
  await page.evaluate(() => goAdmin('renew'));
  await page.getByText('2027 年度續團確認').waitFor();
  await page.locator(`[data-k="童軍|${kid2.cubId}"] [data-v=是]`).click();
  await page.locator('#save').click();
  await page.getByText('已儲存 1 位').waitFor();
  assert.equal(env.rows('年度登記').find((x) => x[2] === kid2.cubId)[4], '是');
  await logout();

  // ═════ admin：三項登記 ═════
  await login(made.username, made.password);
  await page.locator('#adminQuick').waitFor();
  await page.evaluate(() => goAdmin('regis'));
  await page.getByText('2027 年度三項登記').waitFor();
  await page.fill('#ff input[name=scout]', '300'); await page.fill('#ff input[name=staff]', '400'); await page.fill('#ff input[name=troop]', '1000');
  await page.click('#ff button[type=submit]');
  await page.getByText('登記費已儲存').waitFor();
  await page.locator(`tr[data-k="童軍|${kid2.cubId}"] [data-f=amount]`).waitFor();
  assert.equal(await page.locator(`tr[data-k="童軍|${kid2.cubId}"] [data-f=amount]`).inputValue(), '300');
  await page.locator(`tr[data-k="童軍|${kid2.cubId}"] [data-f=registered]`).check();
  await page.locator('#save').click();
  await page.getByText('已儲存').first().waitFor();
  await page.waitForTimeout(300);
  assert.equal(env.rows('年度登記').find((x) => x[2] === kid2.cubId)[5], '是');
  const dl = page.waitForEvent('download');
  await page.locator('#exp').click();
  const csvText = fs.readFileSync(await (await dl).path(), 'utf8');
  assert.match(csvText, /姓名,分團,身分,續團,是否已登記,應繳,已繳/);
  assert.match(csvText, /測試小狼乙,幼童軍,童軍,是,是,300,否/);
  // 升到童軍的孩子：童軍後台看得到之前的紀錄、專科章的稱呼
  await page.selectOption('#secSel', '童軍');
  await page.locator('#title', { hasText: '童軍後台' }).waitFor();
  await page.evaluate((id) => goAdmin('cub', { cubId: id }), kid.cubId);
  await page.getByText('之前分團的紀錄').waitFor();
  assert.match(await text(), /專科章/);

  assert.deepEqual(errors, [], '網頁沒有錯誤');
  await browser.close();
  console.log('全團其餘功能網頁測試通過（羅浮本人註冊、升團、續團確認、三項登記、之前分團的紀錄）');
})().catch((e) => { console.error(e); process.exit(1); });
