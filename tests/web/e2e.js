// 前端端對端測試：用 Playwright 開 web/index.html，後端接到模擬試算表（tests/gas-mock.js）。
// 執行：npm run test:web（需要 Playwright 與 Chromium；不在 npm test 內）
// 截圖存到環境變數 SHOT_DIR 指定的資料夾（未指定則不存）。測試資料一律虛構。
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');
const { loadGas } = require('../gas-mock.js');

const ROOT = path.join(__dirname, '..', '..');
const GAS = 'https://script.google.com/macros/s/TEST/exec';
const PAGE = 'https://pages.test/web/';
const SHOT = process.env.SHOT_DIR;

function seed(env) {
  env.ctx.setup();
  const invite = env.ctx.loadInvites_()[0].code;
  const leader = env.api({ action: 'register', code: invite, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' });
  const leaderId = env.rows('管理員')[0][0];
  const put = (sheet, rows) => { const sh = env.sheet(sheet); sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows); };
  put('小狼名單', [['C1', '測試小狼甲', '一小隊', '2025-03-01', '羚羊', 'AB2CDE', 3, '在團', ''], ['C2', '測試小狼乙', '二小隊', '2025-09-01', '', 'FG3HJK', 3, '在團', '']]);
  const items = env.rows('項目總表');
  const lion = items.filter((r) => r[2] === '羚羊');
  const wolf = items.filter((r) => r[2] === '狼').slice(0, 20);
  const eco = items.filter((r) => r[2] === '環保');
  const guide = items.filter((r) => r[2] === '嚮導').slice(0, 1);
  put('完成紀錄', [...lion, ...wolf, ...eco, ...guide].map((it, i) => ['C1', it[0], i < lion.length ? '2025-05-01' : '2026-0' + (1 + (i % 9)) + '-10', leaderId, '', '', '']));
  put('頒章紀錄', [['C1', '羚羊', '2025-06-01', '6 月團集會', '', leaderId, new Date()], ['C1', '嚮導', '2026-04-01', '', '', leaderId, new Date()]]);
  const dates = ['2026-09-06', '2026-09-13', '2026-09-20', '2026-10-04', '2026-10-18', '2026-12-06'];
  put('集會行事曆', dates.map((d, i) => ['M' + i, d, `${+d.slice(5, 7)}/${+d.slice(8)} 團集會`, '', '是', leaderId, new Date()]));
  put('出席紀錄', [['M0', 'C1', '出席', leaderId, ''], ['M1', 'C1', '請假', leaderId, ''], ['M2', 'C1', '出席', leaderId, ''], ['M4', 'C1', '出席', leaderId, '']]);
  put('年度出席設定', [['115學年度', '2026-08-01', '2027-07-31', 18, '']]);
  put('額外出席', [['115學年度', 'C1', 2, '露營', leaderId, new Date()]]);
  return leader;
}

(async () => {
  const env = loadGas();
  seed(env);
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/^const GAS_URL = '[^']*';/m, `const GAS_URL = '${GAS}';`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://pages.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  let calls = 0;
  await page.route(GAS, (r) => {
    const req = r.request();
    assert.equal(req.method(), 'POST');
    assert.match(req.headers()['content-type'], /^text\/plain/, '用 text/plain 避免 CORS 預檢');
    calls++;
    const body = env.ctx.doPost({ parameter: {}, postData: { contents: req.postData() } }).t;
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  const shot = async (name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name + '.png'), fullPage: true }); };
  const noHScroll = async (where) => assert.ok(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), '不可橫向捲動：' + where);
  const text = () => page.locator('#app').innerText();

  // ── 登入頁 ──
  await page.goto(PAGE);
  await page.getByText('我有代碼，要註冊').waitFor();
  await shot('01-login'); await noHScroll('登入頁');

  // ── 註冊：錯誤代碼 ──
  await page.getByText('我有代碼，要註冊').click();
  await page.fill('input[name=code]', 'ZZZZZZ'); await page.fill('input[name=childName]', '測試小狼甲');
  await page.click('button[type=submit]');
  await page.locator('.msg.err').waitFor();
  assert.match(await text(), /代碼或姓名不正確/);
  // ── 正確代碼 → 帳號 → 不同意 ──
  await page.fill('input[name=code]', 'ab2cde');
  await page.click('button[type=submit]');
  await page.getByText('註冊 2／3').waitFor();
  await page.fill('input[name=username]', 'parent01'); await page.fill('input[name=password]', 'parentpass1');
  await page.fill('input[name=password2]', 'parentpass1'); await page.fill('input[name=nickname]', '測試小狼甲媽媽');
  await page.click('button[type=submit]');
  await page.getByText('註冊 3／3').waitFor();
  await shot('02-consent');
  await page.getByText('不同意（不建立帳號）').click();
  await page.getByText('沒有建立帳號').waitFor();
  assert.equal(env.rows('帳號').length, 1, '不同意就不建立帳號');

  // ── 重新註冊並同意 ──
  await page.getByText('我有代碼，要註冊').click();
  await page.fill('input[name=code]', 'AB2CDE'); await page.fill('input[name=childName]', '測試小狼甲');
  await page.click('button[type=submit]');
  await page.fill('input[name=username]', 'parent01'); await page.fill('input[name=password]', 'parentpass1');
  await page.fill('input[name=password2]', 'parentpass1'); await page.fill('input[name=nickname]', '測試小狼甲媽媽');
  await page.click('button[type=submit]');
  await page.check('input[name=agree]');
  await page.click('button[type=submit]');

  // ── 首頁 ──
  await page.getByText('下一步挑戰').waitFor();
  const home = await text();
  assert.match(home, /測試小狼甲/); assert.match(home, /2025\/3\/1/); assert.match(home, /1 年 8 個月/); assert.match(home, /羚羊級/);
  assert.match(home, /恭喜你完成羚羊進程/);
  const order = ['下一步挑戰', '正在挑戰的', '已經拿到的', '還沒開始的'].map((t) => home.indexOf(t));
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), '首頁區塊順序');
  assert.match(home, /項目已全部完成，等待團長評核頒發/, '環保章待頒發文字');
  assert.ok(!/可晉級/.test(home));
  assert.ok(home.indexOf('嚮導') > home.indexOf('已經拿到的'), '已頒發的嚮導章在已經拿到的');
  await shot('03-home'); await noHScroll('首頁');

  // ── 進程頁與列印 ──
  await page.locator('nav.tabs button[data-v=progress]').click();
  await page.locator('details.unit').first().waitFor();
  // 用卡片標題比對（晉級條件文字裡也會出現其他級別名稱）
  const card = (lv) => page.locator('details.unit').filter({ has: page.locator('.name', { hasText: new RegExp(' ' + lv + '級$') }) });
  const wolfCard = card('狼');
  await wolfCard.locator('summary').click();
  assert.match(await wolfCard.innerText(), /晉級條件：參與羚羊級幼童軍6個月以上/);
  assert.match(await wolfCard.innerText(), /已完成 2026\/1\/10/);
  assert.match(await wolfCard.innerText(), /待挑戰/);
  await shot('04-progress');
  await wolfCard.getByText('列印這一級的簽核單').click();
  assert.equal(await page.evaluate(() => window.__printed), 1);
  const printed = await page.locator('#print').innerHTML();
  assert.match(printed, /狼級進程簽核單/); assert.match(printed, /測試小狼甲/);
  assert.equal((printed.match(/<tr>/g) || []).length, 33, '標題列＋狼級 32 項');
  assert.match(printed, /團長/, '簽核人顯示姓名');
  await page.emulateMedia({ media: 'print' });
  await shot('05-print');
  await page.emulateMedia({ media: 'screen' });
  const lionCard = card('羚羊');
  await lionCard.locator('summary').click();
  assert.match(await lionCard.innerText(), /依出席紀錄|已完成/);

  // ── 技能章頁 ──
  await page.locator('nav.tabs button[data-v=badges]').click();
  await page.getByText('服務類').waitFor();
  const b = await text();
  assert.ok(b.indexOf('服務類') < b.indexOf('健身類') && b.indexOf('健身類') < b.indexOf('技巧類'));
  assert.match(b, /已拿到 1／8 個/);
  await shot('06-badges'); await noHScroll('技能章');

  // ── 出席頁 ──
  await page.locator('nav.tabs button[data-v=attendance]').click();
  await page.getByText('出席統計').waitFor();
  const a = await text();
  assert.match(a, /28%/, '(3 出席 + 2 額外) ÷ 18');
  assert.match(a, /12\/6 團集會/, '即將到來');
  assert.match(a, /請假/); assert.match(a, /－/);
  await shot('07-attendance');

  // ── 我的資料：新增第二個孩子、切換、解除綁定 ──
  await page.locator('nav.tabs button[data-v=mine]').click();
  await page.getByText('綁定的孩子').waitFor();
  await shot('08-mine');
  await page.getByText('＋ 新增綁定').click();
  await page.fill('#fb input[name=code]', 'FG3HJK'); await page.fill('#fb input[name=childName]', '測試小狼乙');
  await page.locator('#fb button[type=submit]').click();
  await page.locator('#fb .msg.err').waitFor();
  assert.match(await page.locator('#fb .msg.err').innerText(), /請先勾選同意/);
  await page.check('#fb input[name=agree]');
  await page.locator('#fb button[type=submit]').click();
  await page.locator('#cubSel').waitFor();
  assert.match(await text(), /測試小狼乙/);
  await page.selectOption('#cubSel', 'C1');
  await page.getByText('下一步挑戰').waitFor();
  assert.match(await text(), /測試小狼甲/);
  await page.locator('nav.tabs button[data-v=mine]').click();
  page.once('dialog', (d) => d.accept());
  await page.locator('.unbind[data-id=C2]').click();
  await page.waitForFunction(() => !document.querySelector('.unbind[data-id=C2]'));
  assert.equal(env.rows('綁定紀錄').filter((r) => r[1] === 'C2').length, 0);

  // ── 登入過期：回登入畫面，登入後回到原畫面 ──
  await page.locator('nav.tabs button[data-v=attendance]').click();
  await page.getByText('出席統計').waitFor();
  await page.locator('nav.tabs button[data-v=mine]').click();
  await page.getByText('綁定的孩子').waitFor();
  env.advance(31 * 24 * 3600000);
  // 切換分頁沿用已載入的資料；下一次呼叫需要登入的後端功能時才會發現過期
  await page.getByText('修改稱呼').click();
  await page.locator('#fn button[type=submit]').click();
  await page.getByText('登入已過期').waitFor();
  await page.fill('input[name=username]', 'parent01'); await page.fill('input[name=password]', 'parentpass1');
  await page.click('button[type=submit]');
  await page.getByText('綁定的孩子').waitFor();
  assert.equal(await page.locator('nav.tabs button.on').getAttribute('data-v'), 'mine', '回到過期前要去的畫面');
  await page.locator('nav.tabs button[data-v=home]').click();
  await page.getByText('下一步挑戰').waitFor();

  // ── 告知內容改版 → 要求重新同意 ──
  env.sheet('告知同意內容').getRange(3, 1, 1, 3).setValues([[2, '第二版測試內容', '2026-12-14']]);
  await page.reload();
  await page.getByText('個資說明已更新').waitFor();
  await shot('09-reconsent');
  await page.check('input[name=agree]');
  await page.click('button[type=submit]');
  await page.getByText('下一步挑戰').waitFor();

  // ── 登出 → 錯誤密碼 → 團長登入（後台佔位頁） ──
  await page.locator('nav.tabs button[data-v=mine]').click();
  await page.getByText('登出', { exact: true }).click();
  await page.getByText('已登出').waitFor();
  await page.fill('input[name=username]', 'parent01'); await page.fill('input[name=password]', 'wrongpass');
  await page.click('button[type=submit]');
  await page.locator('.msg.err').waitFor();
  assert.match(await text(), /帳號或密碼錯誤/);
  await page.fill('input[name=username]', 'leader01'); await page.fill('input[name=password]', 'leaderpass1');
  await page.click('button[type=submit]');
  await page.getByText('團長後台').waitFor();
  await shot('10-admin');
  await page.getByText('切換到家長畫面').click();
  await page.getByText('還沒有綁定孩子').waitFor();

  // ── 忘記密碼頁 ──
  await page.locator('nav.tabs button[data-v=mine]').click();
  await page.getByText('登出', { exact: true }).click();
  await page.getByText('忘記密碼？').click();
  await page.getByText('臨時碼').first().waitFor();
  await shot('11-forgot');

  assert.deepEqual(errors, [], '頁面不可有 JavaScript 錯誤');
  console.log(`前端端對端測試全部通過（共呼叫後端 ${calls} 次）`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
