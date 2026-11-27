// 活動報名表設計的網頁測試（SPEC 附錄第 81 點）：後台設計複選題、選項加價、身分費用、人數上限；家長報名看到預估金額與候補；團長轉正取。測試資料一律虛構。
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
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  call(L, 'squadSave', { type: 'add', name: '一小隊' });
  const kid = call(L, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' });
  const v = env.api({ action: 'consentText' }).version;
  env.api({ action: 'register', code: kid.code, childName: '測試小狼甲', username: 'mom01', password: 'mom01pass12', nickname: '家長', consentVersion: v });

  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/^const GAS_URL = '[^']*';/m, `const GAS_URL = '${GAS}';`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
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
  const logout = async () => { await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.goto('about:blank'); await page.goto(PAGE); await page.locator('nav.tabs button[data-v=login]').waitFor(); };
  const noHScroll = async (what) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), what + '：不可以左右捲動');

  // ═════ 團長設計報名表 ═════
  await page.goto(PAGE);
  await login('leader01', 'leaderpass1');
  await page.locator('#adminQuick').waitFor();
  await page.evaluate(() => goAdmin('events', { edit: 'new' }));
  await page.locator('form#fe').waitFor();
  await page.fill('form#fe input[name=title]', '冬季露營');
  await page.fill('form#fe input[name=date]', '2026-12-12'); await page.fill('form#fe input[name=endDate]', '2026-12-13');
  await page.fill('form#fe input[name=regStart]', '2026-11-01T08:00'); await page.fill('form#fe input[name=regEnd]', '2026-12-05T23:59');
  await page.fill('form#fe input[name=fee]', '1000');
  await page.locator('form#fe details summary').click();
  await page.fill('[data-idf=家長]', '600');
  await page.fill('form#fe input[name=capacity]', '2');
  await page.locator('#addQ').click(); await page.locator('#addQ').click();
  const q = (i) => page.locator('[data-qrow]').nth(i);
  await q(0).locator('[data-q=label]').fill('參加哪幾天');
  await q(0).locator('[data-q=type]').selectOption('multi');
  await q(0).locator('[data-q=options]').fill('週六, 週日');
  await q(0).locator('[data-q=required]').check();
  await q(1).locator('[data-q=label]').fill('帳篷');
  await q(1).locator('[data-q=type]').selectOption('choice');
  await q(1).locator('[data-q=options]').fill('自備, 租帳篷+200');
  await noHScroll('活動表單');
  await page.click('form#fe button[type=submit]');
  await page.getByText('還沒有人報名。').waitFor();
  const er = env.rows('活動')[0];
  assert.deepEqual([er[15], er[16]], [2, '{"家長":600}']);
  assert.deepEqual(JSON.parse(er[8]).map((x) => [x.type, x.options, x.fees]), [['multi', ['週六', '週日'], undefined], ['choice', ['自備', '租帳篷'], [0, 200]]]);
  assert.match(await text(), /家長 600 元；其他 1000 元/);
  // 修改時選項照樣帶「+200」
  await page.locator('#evEdit').click();
  assert.equal(await q(1).locator('[data-q=options]').inputValue(), '自備, 租帳篷+200');
  await logout();

  // ═════ 家長報名：預估金額、名額 2 位，報 3 位 → 1 位候補 ═════
  await login('mom01', 'mom01pass12');
  await page.waitForTimeout(500);
  await page.evaluate(() => renderInfo('events'));
  await page.locator('[data-reg]').first().click();
  await page.locator('form#fev').waitFor();
  assert.match(await text(), /名額\s*2 位・剩 2 位/);
  const p = (i) => page.locator('[data-person]').nth(i);
  await p(0).locator('[data-f=name]').fill('測試小狼甲');
  await p(0).locator('[data-f=identity]').selectOption('小狼');
  await p(0).locator('[data-qm] input[value=週六]').check(); await p(0).locator('[data-qm] input[value=週日]').check();
  await p(0).locator('select[data-q]').selectOption('租帳篷');
  assert.equal(await p(0).locator('[data-amt-est]').innerText(), '這一位預估應繳 1200 元');
  await page.locator('#addP').click(); await page.locator('#addP').click();
  await p(1).locator('[data-f=name]').fill('測試媽媽');
  await p(1).locator('[data-f=identity]').selectOption('家長');
  await p(1).locator('[data-qm] input[value=週六]').check();
  await p(1).locator('select[data-q]').selectOption('自備');
  assert.equal(await p(1).locator('[data-amt-est]').innerText(), '這一位預估應繳 600 元');
  await p(2).locator('[data-f=name]').fill('測試爸爸');
  await p(2).locator('[data-f=identity]').selectOption('家長');
  await p(2).locator('[data-qm] input[value=週日]').check();
  await p(2).locator('select[data-q]').selectOption('自備');
  await noHScroll('報名表');
  await page.click('form#fev button[type=submit]');
  await page.getByText('我已經報名的（3 位）').waitFor();
  assert.ok(dialogs.some((m) => /已報名 2 位；名額已滿，另外 1 位排在候補/.test(m)), dialogs.join('|'));
  assert.match(await text(), /測試爸爸[\s\S]*候補中/);
  assert.match(await text(), /已額滿，送出會排候補/);
  assert.deepEqual(env.rows('活動報名').map((x) => [x[3], x[6], x[9]]), [['測試小狼甲', 1200, '有效'], ['測試媽媽', 600, '有效'], ['測試爸爸', 600, '候補']]);
  await logout();

  // ═════ 團長：名單裡候補、轉正取 ═════
  await login('leader01', 'leaderpass1');
  await page.locator('#adminQuick').waitFor();
  await page.evaluate(() => goAdmin('events'));
  await page.getByText('報名 2 位／2・候補 1 位').waitFor();
  await page.locator('[data-ev]').first().click();
  await page.locator('[data-promote]').waitFor();
  assert.match(await text(), /報名 2 位／名額 2 位[\s\S]*候補 1 位[\s\S]*應收 1800 元/);
  await page.locator('[data-promote]').click();
  await page.getByText('已轉為正取').waitFor();
  assert.ok(dialogs.some((m) => /名額 2 位已經滿了/.test(m)));
  await page.getByText('應收 2400 元').waitFor();
  assert.equal(env.rows('活動報名')[2][9], '有效');

  assert.deepEqual(errors, [], '網頁沒有錯誤');
  await browser.close();
  console.log('活動報名表設計網頁測試通過（複選、選項加價、身分費用、人數上限與候補、轉正取）');
})().catch((e) => { console.error(e); process.exit(1); });
