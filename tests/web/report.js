// 家長回報（進程、繳費）、未繳提醒、報名名單帶進點名、集會預排項目的網頁測試（SPEC 附錄第 83 點）。測試資料一律虛構。
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
  const env = loadGas(); // 模擬時間 2026-11-14
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  call(L, 'squadSave', { type: 'add', name: '一小隊' });
  const kid = call(L, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' });
  call(L, 'cubSave', { name: '測試小狼乙', squad: '一小隊', joinDate: '2025-01-01' });
  const v = env.api({ action: 'consentText' }).version;
  env.api({ action: 'register', code: kid.code, childName: '測試小狼甲', username: 'mom01', password: 'mom01pass12', nickname: '小甲媽媽', consentVersion: v });
  call(L, 'meetingSave', { lines: '2026-11-14 團集會\n2026-11-28 冬季露營（大活動）' });
  const evId = call(L, 'eventSave', { title: '冬季露營', date: '2026-11-28', regStart: '2026-11-01T08:00', regEnd: '2026-11-20T23:59', fee: 500, questions: [] }).id;
  const newbie = env.rows('項目總表').filter((x) => x[2] === '剛入團' && !x[7]);

  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/^const GAS_URL = '[^']*';/m, `const GAS_URL = '${GAS}';`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [], dialogs = [];
  let answer = '';
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(answer) : d.accept(); });
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

  // ═════ 團長：行事曆預排今天集會的項目 ═════
  await page.goto(PAGE);
  await login('leader01', 'leaderpass1');
  await page.locator('#adminQuick').waitFor();
  await page.evaluate(() => goAdmin('calendar'));
  await page.locator('[data-plan]').first().waitFor();
  await noHScroll('行事曆');
  const todayId = env.rows('集會行事曆').find((x) => x[2] === '團集會')[0];
  await page.locator(`[data-plan="${todayId}"]`).click();
  await page.locator('.sheet #plItems [data-pi]').first().waitFor();
  await page.locator(`.sheet [data-pi="${newbie[0][0]}"]`).check();
  await page.locator(`.sheet [data-pi="${newbie[1][0]}"]`).check();
  await page.locator('.sheet #plSave').click();
  await page.getByText('這次要做的項目（2）').waitFor();
  // 簽核第 2 步自動帶出預排的項目
  await page.evaluate(() => goAdmin('sign'));
  await page.locator('#next').click();
  await page.locator('#flt').waitFor();
  assert.equal(await page.locator('#flt').inputValue(), 'plan');
  assert.equal(await page.locator('#items [data-item]').count(), 2);
  assert.match(await page.locator('#flt option:checked').innerText(), /團集會預排的項目/);
  await logout();

  // ═════ 家長：看到這次要做的任務、回報進程、報名後的繳費提醒與回報 ═════
  await login('mom01', 'mom01pass12');
  await page.locator('.hero').waitFor();
  await page.evaluate(() => { state.seg = 'attendance'; state.view = 'progress'; renderParent(true); });
  await page.getByText('這次要做的任務（2 項）').waitFor();
  await page.evaluate(() => { state.seg = 'map'; state.view = 'progress'; renderParent(true); });
  await page.locator(`[data-rep="${newbie[0][0]}"]`).waitFor();
  await noHScroll('闖關');
  answer = '在家背給爸爸聽';
  await page.locator(`[data-rep="${newbie[0][0]}"]`).click();
  await page.getByText('已回報，等服務員確認').first().waitFor();
  assert.equal(env.rows('完成紀錄')[0][6], '待確認');
  assert.equal(await page.locator(`[data-unrep="${newbie[0][0]}"]`).count(), 1);
  // 報名活動 → 繳費列
  await page.evaluate((id) => renderEventForm(id), evId);
  await page.locator('form#fev').waitFor();
  await page.fill('[data-person] [data-f=name]', '測試小狼甲');
  await page.selectOption('[data-person] [data-f=identity]', '小狼');
  await page.click('form#fev button[type=submit]');
  await page.locator('#payBar').waitFor();
  assert.match(await page.locator('#payBar').innerText(), /還沒繳費：1 位，共 500 元/);
  // 首頁提醒
  await page.evaluate(() => { siteData = null; state.view = 'home'; renderParent(true); });
  await page.locator('#payCard').waitFor();
  assert.match(await page.locator('#payCard').innerText(), /冬季露營[\s\S]*1 位，共 500 元/);
  await noHScroll('家長首頁');
  await page.locator('[data-payev]').click();
  answer = '11/15 轉帳';
  await page.locator('#payRep').click();
  await page.getByText('已經回報，等團長確認').waitFor();
  assert.equal(env.rows('活動報名')[0][13], '11/15 轉帳');
  await page.evaluate(() => { siteData = null; state.view = 'home'; renderParent(true); });
  await page.locator('#evCard').waitFor(); await page.waitForTimeout(600);
  assert.equal(await page.locator('#payCard').count(), 0, '回報後首頁不再提醒');
  await logout();

  // ═════ 團長：首頁提醒 → 確認家長回報；名單看到家長說已繳、複製未繳名單；點名只列報名的人 ═════
  await login('leader01', 'leaderpass1');
  await page.locator('#toRep').waitFor();
  await page.locator('#toRep').click();
  await page.locator('[data-ri]').first().waitFor();
  assert.match(await text(), /測試小狼甲[\s\S]*小甲媽媽回報：在家背給爸爸聽/);
  await noHScroll('家長回報');
  await page.locator('#repAll').check();
  await page.locator('#repOk').click();
  await page.getByText('目前沒有等待確認的回報').waitFor();
  assert.equal(env.rows('完成紀錄')[0][6], '已確認');
  await page.evaluate((id) => goAdmin('events', { regs: id }), evId);
  await page.getByText('家長說已繳：11/15 轉帳').waitFor();
  await page.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await page.locator('#evUnpaid').click();
  await page.waitForFunction(() => window.__copied);
  assert.match(await page.evaluate(() => window.__copied), /【冬季露營】還沒繳費的有 1 位[\s\S]*測試小狼甲（小甲媽媽）500 元（家長說已繳，待確認）/);
  const campId = env.rows('集會行事曆').find((x) => /冬季露營/.test(x[2]))[0];
  await page.evaluate((id) => goAdmin('roll', { meetingId: id }), campId);
  await page.locator('#onlyReg').waitFor();
  assert.equal(await page.locator('.roll-btn').count(), 2);
  await page.locator('#onlyReg').check();
  assert.equal(await page.locator('.roll-btn').count(), 1);
  assert.match(await page.locator('#rows').innerText(), /測試小狼甲[\s\S]*有報名/);
  await page.locator('#allIn').click();
  await page.locator('#save').click();
  await page.getByText('已儲存 1 筆點名').waitFor();

  assert.deepEqual(errors, [], '網頁沒有錯誤');
  await browser.close();
  console.log('回報與預排網頁測試通過（集會預排、簽核帶出、家長回報進程、繳費提醒與回報、確認回報、未繳名單、點名只列報名的人）');
})().catch((e) => { console.error(e); process.exit(1); });
