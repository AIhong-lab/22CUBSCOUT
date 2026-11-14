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
  env.api({ action: 'register', code: invite, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' });
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
  const sr = env.rows('設定').findIndex((r) => r[0] === '小隊清單') + 2;
  env.sheet('設定').getRange(sr, 2).setValues([['一小隊、二小隊']]);
  put('額外出席', [['115學年度', 'C1', 2, '露營', leaderId, new Date()]]);
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
  page.on('dialog', (d) => d.accept()); // confirm／prompt 一律按確定（prompt 用預設值）
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
  const tab = (v) => page.locator(`nav.tabs button[data-v=${v}]`).click();

  // ═════ 公開首頁與兩個查詢頁（不用登入） ═════
  await page.goto(PAGE);
  await page.getByText('什麼是「進程」？').waitFor();
  const hp = await text();
  assert.match(hp, /什麼是「技能章」？[\s\S]*3 類 26 個/);
  assert.match(hp, /家長／團長登入/);
  assert.equal(new URL(page.url()).hash, '#home');
  await shot('00-home'); await noHScroll('公開首頁');

  await page.locator('[data-go=progress]').click();
  await page.locator('.stage').first().waitFor();
  assert.equal(new URL(page.url()).hash, '#progress', '進程查詢有自己的網址');
  assert.equal(await page.locator('.stage').count(), 4);
  assert.equal(await page.locator('.badge').count(), 0, '進程頁不混入技能章');
  assert.match(await page.locator('#lvPanel').innerText(), /羚羊級任務（10 項）[\s\S]*能背誦並說明幼童軍諾言/);
  await page.locator('.stage[data-unit=豹]').click();
  assert.match(await page.locator('#lvPanel').innerText(), /豹級任務（26 項）[\s\S]*晉級條件：參與鹿級/);
  await page.fill('#q', '結繩');
  assert.match(await page.locator('#hits').innerText(), /找到 6 項/);
  await shot('00a-progress'); await noHScroll('進程查詢');

  await tab('badges');
  await page.locator('.badge').first().waitFor();
  assert.equal(new URL(page.url()).hash, '#badges', '技能章查詢有自己的網址');
  assert.equal(await page.locator('.badge').count(), 26);
  assert.equal(await page.locator('.stage').count(), 0, '技能章頁不混入進程');
  await page.fill('#q', '游泳');
  assert.match(await page.locator('#hits').innerText(), /找到 2 項/);
  await page.locator('.badge[data-unit=音樂]').click();
  assert.match(await page.locator('.sheet').innerText(), /合格標準（3 項）[\s\S]*五線譜/);
  await shot('00b-badges');
  await page.locator('.sheet [data-close]').click();
  assert.ok(!/測試小狼/.test(await page.content()), '公開頁不含任何孩子的資料');

  // 分享的網址直接打開對應頁
  await page.goto(PAGE + '#badges');
  await page.locator('.badge').first().waitFor();
  await tab('login');

  // ═════ 家長 ═════
  await page.getByText('我有代碼，要註冊').waitFor();
  assert.equal(await page.locator('nav.tabs').isVisible(), false, '登入頁不顯示底部分頁列');
  await shot('01-login'); await noHScroll('登入頁');

  // 註冊：錯誤代碼 → 正確代碼 → 不同意
  await page.getByText('我有代碼，要註冊').click();
  await page.fill('input[name=code]', 'ZZZZZZ'); await page.fill('input[name=childName]', '測試小狼甲');
  await page.click('button[type=submit]');
  await page.locator('.msg.err').waitFor();
  assert.match(await text(), /代碼或姓名不正確/);
  await page.fill('input[name=code]', 'ab2cde');
  await page.click('button[type=submit]');
  await page.getByText('註冊 2／3').waitFor();
  const fillAccount = async () => {
    await page.fill('input[name=username]', 'parent01'); await page.fill('input[name=password]', 'parentpass1');
    await page.fill('input[name=password2]', 'parentpass1'); await page.fill('input[name=nickname]', '測試小狼甲媽媽');
    await page.click('button[type=submit]');
  };
  await fillAccount();
  await page.getByText('註冊 3／3').waitFor();
  await shot('02-consent');
  await page.getByText('不同意（不建立帳號）').click();
  await page.getByText('沒有建立帳號').waitFor();
  assert.equal(env.rows('帳號').length, 1, '不同意就不建立帳號');

  // 重新註冊並同意
  await page.getByText('我有代碼，要註冊').click();
  await page.fill('input[name=code]', 'AB2CDE'); await page.fill('input[name=childName]', '測試小狼甲');
  await page.click('button[type=submit]');
  await fillAccount();
  await page.check('input[name=agree]');
  await page.click('button[type=submit]');

  // 首頁（冒險）
  await page.getByText('下一步挑戰').waitFor();
  const home = await text();
  assert.match(home, /測試小狼甲/); assert.match(home, /2025\/3\/1/); assert.match(home, /1 年 8 個月/); assert.match(home, /目前級別：羚羊級/);
  assert.match(home, /恭喜你完成羚羊進程/);
  const order = ['下一步挑戰', '正在挑戰的', '已經拿到的', '還沒開始的'].map((t) => home.indexOf(t));
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), '首頁區塊順序');
  assert.match(home, /項目已全部完成，等待團長評核頒發/, '環保章待頒發文字');
  assert.ok(!/可晉級/.test(home));
  assert.ok(home.indexOf('嚮導') > home.indexOf('已經拿到的'), '已頒發的嚮導章在已經拿到的');
  assert.match(home, /⭐ 36/, '星星數＝完成項目數（羚羊 10＋狼 20＋環保 5＋嚮導 1）');
  await shot('03-home'); await noHScroll('首頁');

  // 闖關地圖
  await tab('progress');
  await page.locator('.stage').first().waitFor();
  assert.equal(await page.locator('.stage').count(), 4);
  assert.match(await page.locator('.stage[data-unit=羚羊]').getAttribute('class'), /done/);
  assert.match(await page.locator('.stage[data-unit=狼]').getAttribute('class'), /active/);
  assert.match(await page.locator('.stage[data-unit=鹿]').getAttribute('class'), /locked/);
  const panel = await page.locator('#lvPanel').innerText();
  assert.match(panel, /狼級任務/, '預設打開正在挑戰的那一關');
  assert.match(panel, /晉級條件：參與羚羊級幼童軍6個月以上/);
  assert.match(panel, /完成！2026\/1\/10/);
  assert.match(panel, /待挑戰/);
  await shot('04-map'); await noHScroll('闖關地圖');
  await page.locator('#printBtn').click();
  assert.equal(await page.evaluate(() => window.__printed), 1);
  const printed = await page.locator('#print').innerHTML();
  assert.match(printed, /狼級進程簽核單/); assert.match(printed, /測試小狼甲/);
  assert.equal((printed.match(/<tr>/g) || []).length, 33, '標題列＋狼級 32 項');
  assert.match(printed, /團長/, '簽核人顯示姓名');
  await page.emulateMedia({ media: 'print' });
  await shot('05-print');
  await page.emulateMedia({ media: 'screen' });
  await page.locator('.stage[data-unit=羚羊]').click();
  assert.match(await page.locator('#lvPanel').innerText(), /羚羊級任務[\s\S]*6 月團集會/);

  // 徽章收藏冊
  await tab('badges');
  await page.getByText('我的徽章收藏冊').waitFor();
  const b = await text();
  assert.ok(b.indexOf('服務類') < b.indexOf('健身類') && b.indexOf('健身類') < b.indexOf('技巧類'));
  assert.match(b, /已收藏 1／8 個/);
  assert.equal(await page.locator('.badge').count(), 26);
  assert.match(await page.locator('.badge[data-unit=嚮導]').getAttribute('class'), /got/);
  assert.match(await page.locator('.badge[data-unit=環保]').getAttribute('class'), /pending/);
  await shot('06-badges'); await noHScroll('徽章');
  await page.locator('.badge[data-unit=環保]').click();
  await page.locator('.sheet').waitFor();
  assert.match(await page.locator('.sheet').innerText(), /合格標準[\s\S]*能說出環境保護的意義/);
  await shot('06b-badge-sheet');
  await page.locator('.sheet [data-close]').click();

  // 出席集點卡
  await tab('attendance');
  await page.getByText('出席集點卡').waitFor();
  const a = await text();
  assert.match(a, /28%/, '(3 出席 + 2 額外) ÷ 18');
  assert.match(a, /12\/6 團集會/, '即將到來');
  assert.equal(await page.locator('.stamp').count(), 5);
  assert.equal(await page.locator('.stamp.出席').count(), 3);
  assert.equal(await page.locator('.stamp.請假').count(), 1);
  await shot('07-stamps'); await noHScroll('集點卡');

  // 我的：新增第二個孩子、切換、解除綁定
  await tab('mine');
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
  await tab('mine');
  await page.locator('.unbind[data-id=C2]').click();
  await page.waitForFunction(() => !document.querySelector('.unbind[data-id=C2]'));
  assert.equal(env.rows('綁定紀錄').filter((r) => r[1] === 'C2').length, 0);

  // 登入過期：回登入畫面，登入後回到原畫面
  await page.getByText('綁定的孩子').waitFor();
  env.advance(31 * 24 * 3600000);
  await page.getByText('修改稱呼').click();
  await page.locator('#fn button[type=submit]').click();
  await page.getByText('登入已過期').waitFor();
  await page.fill('input[name=username]', 'parent01'); await page.fill('input[name=password]', 'parentpass1');
  await page.click('button[type=submit]');
  await page.getByText('綁定的孩子').waitFor();
  assert.equal(await page.locator('nav.tabs button.on').getAttribute('data-v'), 'mine', '回到過期前的畫面');
  env.advance(-31 * 24 * 3600000); // 時鐘撥回「今天」，後面的點名才會預設今天的集會

  // 告知內容改版 → 要求重新同意
  env.sheet('告知同意內容').getRange(3, 1, 1, 3).setValues([[2, '第二版測試內容', '2026-12-14']]);
  await page.reload();
  await page.getByText('個資說明已更新').waitFor();
  await page.check('input[name=agree]');
  await page.click('button[type=submit]');
  await page.getByText('下一步挑戰').waitFor();

  // 登出 → 錯誤密碼
  await tab('mine');
  await page.getByText('登出', { exact: true }).click();
  await page.getByText('已登出').waitFor();
  await page.fill('input[name=username]', 'parent01'); await page.fill('input[name=password]', 'wrongpass');
  await page.click('button[type=submit]');
  await page.locator('.msg.err').waitFor();
  assert.match(await text(), /帳號或密碼錯誤/);

  // ═════ 團長後台 ═════
  await page.fill('input[name=username]', 'leader01'); await page.fill('input[name=password]', 'leaderpass1');
  await page.click('button[type=submit]');
  await page.getByText('待頒章').waitFor();
  const ah = await text();
  assert.match(ah, /測試小狼甲[\s\S]*環保/, '待頒章列出環保章');
  assert.match(ah, /尚未設定備份資料夾/);
  await shot('10-admin-home'); await noHScroll('後台首頁');

  // 行事曆：新增今天的集會
  await tab('more');
  await page.locator('.menu-grid button[data-p=calendar]').click();
  await page.fill('textarea[name=lines]', '2026-11-14 團集會\n2026-11-21 露營');
  await page.click('form#f button[type=submit]');
  await page.getByText('露營').first().waitFor();
  assert.equal(env.rows('集會行事曆').length, 8);

  // 點名：預設今天的集會、切換狀態、儲存
  await tab('roll');
  await page.locator('.roll-btn').first().waitFor();
  assert.match(await page.locator('#mSel option:checked').innerText(), /2026\/11\/14/, '預設今天的集會');
  await page.locator('.roll-btn[data-id=C1]').click();
  await page.locator('.roll-btn[data-id=C2]').click();
  await page.locator('.roll-btn[data-id=C2]').click();
  assert.match(await page.locator('#sum').innerText(), /出席 1 人・請假 1 人・尚未儲存 2 筆/);
  await shot('11-roll'); await noHScroll('點名');
  await page.locator('#save').click();
  await page.waitForFunction(() => !/尚未儲存/.test(document.querySelector('#sum').textContent));
  assert.equal(env.rows('出席紀錄').length, 6);

  // 小狼：新增
  await tab('cubs');
  await page.getByText('＋ 新增小狼').click();
  await page.fill('input[name=name]', '測試小狼丙'); await page.selectOption('select[name=squad]', '二小隊'); await page.fill('input[name=joinDate]', '2026-09-01');
  await page.click('form#f button[type=submit]');
  await page.locator('.codebox').waitFor();
  assert.match(await page.locator('.codebox').innerText(), /^[A-Z2-9]{6}$/);
  await shot('12-cub'); await noHScroll('小狼頁');

  // 小隊設定：新增
  await tab('more');
  await page.locator('.menu-grid button[data-p=squads]').click();
  await page.locator('[data-rn=二小隊]').waitFor();
  assert.match(await text(), /一小隊[\s\S]*在團 1 位[\s\S]*二小隊[\s\S]*在團 2 位/);
  await page.fill('form#f input[name=name]', '黑豹小隊');
  await page.click('form#f button[type=submit]');
  await page.locator('[data-rn=黑豹小隊]').waitFor();
  await shot('12b-squads'); await noHScroll('小隊設定');
  assert.equal(env.rows('設定').find((r) => r[0] === '小隊清單')[1], '一小隊、二小隊、黑豹小隊');

  // 簽核：小隊批次（選二小隊 → 進程・羚羊級 → 兩項）→ 復原
  await tab('sign');
  await page.locator('#flt').waitFor();
  await page.locator('#squads .chip[data-s=二小隊]').click();
  await page.selectOption('#flt', '進程|羚羊');
  await page.locator('#items input').nth(0).check();
  await page.locator('#items input').nth(1).check();
  assert.match(await page.locator('#sum').innerText(), /2 個項目 × 2 位小狼：將新增 4 筆/);
  await shot('13-sign');
  await page.locator('#go').click();
  await page.getByText('新增 4 筆、略過 0 筆').waitFor();
  await page.locator('#undo').click();
  await page.getByText('已復原 4 筆').waitFor();

  // 頒章：首頁 → 前往頒章 → 確定
  await tab('home');
  await page.getByText('前往頒章').click();
  await page.fill('input[name=occasion]', '11 月團集會');
  await page.click('form#f button[type=submit]');
  await page.getByText('目前沒有待頒章的小狼').waitFor();
  assert.ok(env.rows('頒章紀錄').some((r) => r[1] === '環保' && r[3] === '11 月團集會'));

  // 進程總覽
  await tab('more');
  await page.locator('.menu-grid button[data-p=overview]').click();
  await page.locator('table.tbl').waitFor();
  assert.equal(await page.locator('table.tbl tbody tr').count(), 3);
  await shot('14-overview');

  // 切換到家長畫面
  await page.getByText('家長畫面').click();
  await page.getByText('還沒有綁定孩子').waitFor();

  assert.deepEqual(errors, [], '頁面不可有 JavaScript 錯誤');
  console.log(`前端端對端測試全部通過（共呼叫後端 ${calls} 次）`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
