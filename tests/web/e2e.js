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
  const dialogs = [];
  let dialogAnswer = true; // confirm／prompt 預設按確定（prompt 用預設值）
  page.on('dialog', (d) => { dialogs.push(d.message()); dialogAnswer ? d.accept(d.type() === 'prompt' ? d.defaultValue() : undefined) : d.dismiss(); });
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
  /** 家長「進度」分頁裡的切換：map（闖關）、badges（徽章）、attendance（出席） */
  const seg = async (k) => { await page.locator('nav.tabs button[data-v=progress]').click(); await page.locator(`#pseg button[data-seg=${k}]`).click(); };

  // ═════ 公開首頁與兩個查詢頁（不用登入） ═════
  await page.goto(PAGE);
  await page.getByText('什麼是「進程」？').waitFor();
  assert.equal(new URL(page.url()).hash, '#home', '沒登入時打開網站是首頁');
  assert.equal(await page.locator('nav.tabs button').first().getAttribute('data-v'), 'home', '導覽列第一個是首頁');
  assert.match(await page.locator('nav.tabs button').first().innerText(), /首頁/);
  // 按標題「22團幼童軍」回首頁
  await tab('badges'); await page.locator('.badge').first().waitFor();
  await page.click('#title');
  await page.getByText('什麼是「進程」？').waitFor();
  assert.equal(new URL(page.url()).hash, '#home', '按標題回首頁');
  // 手機：分頁固定在螢幕下方（SPEC 附錄第 44 點），不會跟著內容捲走
  const vh = page.viewportSize().height;
  const nbb = await page.locator('nav.tabs').boundingBox();
  assert.ok(nbb.y > vh - 110 && nbb.y + nbb.height <= vh + 1, '手機分頁在螢幕下方：' + JSON.stringify(nbb));
  await tab('home');
  await page.getByText('什麼是「進程」？').waitFor();
  const hp = await text();
  assert.match(hp, /什麼是「技能章」？[\s\S]*3 類 26 個/);
  assert.match(hp, /家長、團長、服務員都從這裡登入[\s\S]*直接進入管理員後台/);
  assert.equal(new URL(page.url()).hash, '#home');
  await shot('00-home'); await noHScroll('公開首頁');

  await tab('progress');
  await page.locator('.stage').first().waitFor();
  assert.equal(new URL(page.url()).hash, '#progress', '進程查詢有自己的網址');
  assert.equal(await page.locator('.stage').count(), 5, '剛入團＋四級');
  assert.equal(await page.locator('.stage').first().getAttribute('data-unit'), '剛入團');
  assert.equal(await page.locator('.badge').count(), 0, '進程頁不混入技能章');
  assert.match(await page.locator('#lvPanel').innerText(), /剛入團任務（5 項）[\s\S]*背誦與了解諾言規律/);
  // 本團細項：收合在官方項目下面，點開才看到細項與通過標準
  const sub = page.locator('#lvPanel details.sub').first();
  assert.match(await sub.locator('summary').innerText(), /本團細項 4 條/);
  assert.ok(!(await sub.locator('li').first().isVisible()), '預設收合');
  await sub.locator('summary').click();
  assert.match(await sub.innerText(), /能完整背出諾言[\s\S]*通過標準：不看稿背誦＋口述舉例[\s\S]*生活應用：/);
  await shot('00a1-details'); await noHScroll('細項展開');
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
  await page.getByText('我有綁定碼').waitFor();
  assert.equal(await page.locator('nav.tabs button.on').getAttribute('data-v'), 'login', '登入頁仍有導覽列，可以回到查詢頁');
  await shot('01-login'); await noHScroll('登入頁');

  // 註冊：錯誤代碼 → 正確代碼 → 不同意
  await page.getByText('我有綁定碼').click();
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
  await page.getByText('我有綁定碼').click();
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
  assert.match(home, /20／32\s*狼級進度[\s\S]*1\s*技能章[\s\S]*28%\s*出席率/, '首頁三個數字：這一級進度、技能章、出席率');
  assert.match(home, /下次集會[\s\S]*12\/6 團集會/, '首頁就看得到下次集會');
  await shot('03-home'); await noHScroll('首頁');
  await page.locator('#toMap').click();
  await page.locator('#lvPanel').waitFor();
  assert.match(await page.locator('#lvPanel').innerText(), /狼級任務[\s\S]*請團長或服務員幫你簽核/, '首頁「看全部任務」跳到闖關地圖的那一關');
  await tab('home');
  await page.getByText('下一步挑戰').waitFor();

  // 闖關地圖
  await tab('progress');
  await page.locator('.stage').first().waitFor();
  assert.equal(await page.locator('.stage').count(), 5);
  assert.match(await page.locator('.stage[data-unit=剛入團]').getAttribute('class'), /done/, '已拿到羚羊，視為通過剛入團');
  assert.match(await page.locator('.stage[data-unit=剛入團]').innerText(), /已晉級/, '沒有頒發日期時不顯示空白日期');
  // 手機版：所有分頁都看得到，最後一個不會被切掉
  const last = await page.locator('nav.tabs button').last().boundingBox();
  assert.ok(last.x + last.width <= 391, '最後一個分頁沒有被切掉：' + JSON.stringify(last));
  assert.match(await page.locator('.stage[data-unit=羚羊]').getAttribute('class'), /done/);
  assert.match(await page.locator('.stage[data-unit=狼]').getAttribute('class'), /active/);
  assert.match(await page.locator('.stage[data-unit=鹿]').getAttribute('class'), /locked/);
  const panel = await page.locator('#lvPanel').innerText();
  assert.match(panel, /狼級任務/, '預設打開正在挑戰的那一關');
  assert.match(panel, /晉級條件：參與羚羊級幼童軍6個月以上/);
  assert.match(panel, /完成！2026\/1\/10/);
  assert.match(panel, /待挑戰/);
  assert.ok(await page.locator('#lvPanel details.sub').count() > 10, '家長的闖關地圖也看得到本團細項');
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

  // 徽章收藏冊（進度 → 徽章）
  assert.equal(await page.locator('nav.tabs button').count(), 3, '家長只有三個分頁：首頁、進度、我的');
  await seg('badges');
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

  // 出席集點卡（進度 → 出席）
  await seg('attendance');
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
  // 新增孩子：送出申請（新方式）
  await page.getByText('＋ 新增孩子').click();
  await page.fill('#kidBox2 input[name=child]', '測試小狼己');
  await page.locator('#fr button[type=submit]').click();
  assert.match(await page.locator('#fr .msg.err').innerText(), /請先勾選同意/);
  await page.check('#fr input[name=agree]');
  await page.locator('#fr button[type=submit]').click();
  await page.getByText('等待團長審核').first().waitFor();
  assert.ok(env.rows('註冊申請').some((r) => r[3] === '測試小狼己' && r[5] === '待審核'));
  await tab('mine');
  await page.getByText('綁定的孩子').waitFor();
  // 舊方式：團長給的綁定碼仍可用
  await page.getByText('我有綁定碼').click();
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
  await page.locator('#adminQuick').waitFor();
  await page.locator('#sysTips').evaluate((el) => { el.parentNode.open = true; });
  const ah = await text();
  assert.match(ah, /今天沒有集會/);
  // 後台首頁上半部和網站首頁一樣，下面才是後台（附錄第 48 點）
  assert.match(ah, /進程查詢[\s\S]*技能章查詢[\s\S]*什麼是「進程」？[\s\S]*後台：今天要做的事[\s\S]*今天沒有集會[\s\S]*系統提示/);
  assert.ok(!/怎麼登入？/.test(ah), '已登入不用再看怎麼登入');
  assert.match(ah, /測試小狼甲[\s\S]*環保/, '待頒章列出環保章');
  assert.match(ah, /還沒有備份紀錄/, 'setup 已自動建立備份資料夾，只是還沒備份過');
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
  // 未儲存就要離開：選「留下」會停在點名頁
  dialogAnswer = false;
  await tab('sign');
  assert.match(dialogs[dialogs.length - 1], /點名還沒儲存/);
  assert.ok(await page.locator('#save').isVisible(), '選擇留下仍在點名頁');
  dialogAnswer = true;
  await page.locator('#save').click();
  await page.waitForFunction(() => !/尚未儲存/.test(document.querySelector('#sum').textContent));
  assert.equal(env.rows('出席紀錄').length, 6);
  // 全部出席：空白的變出席、請假的不變
  await page.locator('.roll-btn[data-id=C1]').click(); // 出席 → 請假
  await page.locator('.roll-btn[data-id=C1]').click(); // 請假 → 空白
  await page.locator('#allIn').click();
  assert.equal(await page.locator('.roll-btn[data-id=C1]').innerText(), '🐾 出席');
  assert.equal(await page.locator('.roll-btn[data-id=C2]').innerText(), '🌙 請假');
  await tab('home');
  await page.getByText('已點名出席 1 人').waitFor();
  assert.match(await text(), /今天：團集會/, '後台首頁顯示今天的集會');

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
  // 三步驟：① 小隊 → ② 項目 → ③ 小狼與日期
  await page.locator('#squads .chip[data-s=二小隊]').click();
  assert.match(await page.locator('#sqInfo').innerText(), /共 2 位小狼/);
  await page.locator('#next').click();
  await page.locator('#next').click();
  assert.match(dialogs[dialogs.length - 1], /請至少選一個項目/, '沒選項目不能往下');
  await page.selectOption('#flt', '進程|羚羊');
  await page.locator('#items input').nth(0).check();
  await page.locator('#items input').nth(1).check();
  assert.match(await page.locator('#sum').innerText(), /2 個項目 × 2 位小狼：將新增 4 筆/);
  assert.match(await page.locator('#items').innerText(), /已完成 0／2 位/, '每個項目顯示已完成幾位');
  await shot('13-sign'); await noHScroll('簽核第 2 步');
  await page.locator('#next').click();
  assert.equal(await page.locator('#cubs input:checked').count(), 2, '預設全選該小隊');
  await page.locator('#prev').click();
  assert.equal(await page.locator('#items input:checked').count(), 2, '回上一步保留已選的項目');
  await page.locator('#next').click();
  await page.locator('#go').click();
  await page.getByText('新增 4 筆、略過 0 筆').waitFor();
  await page.selectOption('#flt', '進程|羚羊');
  assert.match(await page.locator('#items').innerText(), /已完成 2／2 位 ✅/, '送出後項目顯示全部完成');
  await page.locator('#undo').click();
  await page.getByText('已復原 4 筆').waitFor();

  // 頒章：首頁 → 前往頒章 → 確定
  await tab('home');
  await page.getByText('前往頒章').click();
  await page.fill('input[name=occasion]', '11 月團集會');
  await page.click('form#f button[type=submit]');
  await page.getByText('目前沒有待頒章的小狼', { exact: false }).waitFor();
  assert.ok(env.rows('頒章紀錄').some((r) => r[1] === '環保' && r[3] === '11 月團集會'));

  // 進程總覽
  await tab('more');
  await page.locator('.menu-grid button[data-p=overview]').click();
  await page.locator('table.tbl').waitFor();
  assert.equal(await page.locator('table.tbl tbody tr').count(), 3);
  await shot('14-overview');

  // ═════ 後台也能改密碼（修正：原本只有家長畫面的「我的」才有） ═════
  await tab('more');
  await page.locator('.menu-grid button[data-p=mine]').click();
  await page.getByText('🔒 修改密碼').click();
  await page.fill('#fp input[name=oldPassword]', 'leaderpass1');
  await page.fill('#fp input[name=newPassword]', 'leaderpass2'); await page.fill('#fp input[name=newPassword2]', 'leaderpass2');
  await page.click('#fp button[type=submit]');
  await page.getByText('密碼已修改').waitFor();
  assert.equal(env.api({ action: 'login', username: 'leader01', password: 'leaderpass2' }).ok, true);
  await page.locator('[data-back]').click();
  await page.locator('.menu-grid').first().waitFor();

  // ═════ 名單直接編輯：表格裡改小隊，一次儲存 ═════
  await tab('cubs');
  await page.locator('#editMode').click();
  await page.locator('#list table').waitFor();
  const rowB = page.locator('#list tr', { hasText: '' }).filter({ has: page.locator('input[value="測試小狼乙"]') });
  await rowB.locator('select[data-f=squad]').selectOption('一小隊');
  assert.match(await page.locator('#esum').innerText(), /已修改 1 位/);
  await shot('60-roster-edit'); await noHScroll('名單直接編輯');
  await page.locator('#esave').click();
  await page.getByText('已儲存 1 位小狼').waitFor();
  assert.equal(env.rows('小狼名單').find((r) => r[1] === '測試小狼乙')[2], '一小隊');
  await page.locator('#editMode').click();
  await page.locator('#list .list-row').first().waitFor();

  // ═════ 體驗者：新增 → 小狼頁顯示體驗進度與「轉為入團」 ═════
  await tab('cubs');
  await page.locator('#addTrial').click();
  await page.getByText('🧪 新增體驗者').waitFor();
  await page.fill('#f input[name=name]', '測試體驗丁');
  await page.click('#f button[type=submit]');
  await page.locator('#join').waitFor();
  assert.match(await text(), /一般團集會出席 0／4 次/);
  assert.ok(!/🗺️ 進程/.test(await text()), '體驗者還不顯示進程');
  await shot('50-trial'); await noHScroll('體驗者');
  await page.locator('#join').click(); // prompt 用預設日期；未滿 4 次跳確認（預設按確定）
  await page.getByText('🗺️ 進程').waitFor();
  assert.equal(env.rows('小狼名單').find((r) => r[1] === '測試體驗丁')[7], '在團');
  assert.ok(dialogs.some((m) => /0／4 次一般團集會/.test(m)), '未滿 4 次先確認');

  // ═════ 4B：項目管理與設定 ═════
  await tab('more');
  await page.locator('.menu-grid button[data-p=items]').click();
  await page.getByText('📝 項目管理').waitFor();
  assert.match(await text(), /剛入團任務|任務（5 項啟用）/);
  await page.locator('[data-cat=技能章]').click();
  await page.locator('#units [data-unit=嚮導]').click();
  await page.getByText('合格標準（2 項啟用）').waitFor();
  await page.locator('[data-add]').first().click();
  await page.fill('#fa textarea[name=text]', '能帶家人走一次自己規劃的路線');
  await page.click('#fa button[type=submit]');
  await page.getByText('合格標準（3 項啟用）').waitFor();
  assert.ok(env.rows('項目總表').some((r) => r[0] === 'B-嚮導-3'));
  await page.locator('[data-edit="B-嚮導-3"]').click();
  await page.fill('#fe textarea[name=text]', '能帶家人走一次路線（修改）');
  await page.click('#fe button[type=submit]');
  await page.getByText('能帶家人走一次路線（修改）').waitFor();
  await page.locator('[data-tog="B-嚮導-3"]').click();
  await page.getByText('已停用').first().waitFor();
  await shot('40-items'); await noHScroll('項目管理');
  await page.locator('[data-cat=進程]').click();
  await page.locator('#units [data-unit=剛入團]').click();
  await page.locator('[data-det="P-剛入團-1"]').click();
  await page.locator('.sheet [data-key]').first().waitFor();
  assert.equal(await page.locator('.sheet [data-key]').count(), 4);
  await page.locator('.sheet [data-close]').click();
  // 設定
  await page.locator('[data-back]').click();
  await page.locator('.menu-grid button[data-p=settings]').click();
  await page.getByText('⚙️ 設定').waitFor();
  const inp = page.locator('[data-k="晉級所需出席次數"]');
  assert.equal(await inp.inputValue(), '8');
  await inp.fill('6');
  await page.click('#fs button[type=submit]');
  await page.getByText('已儲存 1 項設定').waitFor();
  assert.equal(env.ctx.loadSettings_().values['晉級所需出席次數'], 6);
  await shot('41-settings'); await noHScroll('設定');
  await page.locator('[data-back]').click();
  await page.locator('.menu-grid').first().waitFor();

  // 切換到家長畫面
  await page.locator('#toParent').click();
  await page.getByText('還沒有綁定孩子').waitFor();

  // ═════ LINE 通知的「前往頒章」連結：登入中直接到頒章表單 ═════
  await page.goto('about:blank'); await page.goto(PAGE + '#award=' + encodeURIComponent('C1,狼'));
  await page.getByText('同一場儀式可勾選多位小狼').waitFor();
  assert.equal(new URL(page.url()).hash, '', '用過就清掉');
  await page.locator('[data-back]').click();
  await page.locator('#adminQuick').waitFor();
  await page.locator('#toParent').click();
  await page.getByText('還沒有綁定孩子').waitFor();

  // ═════ 電腦寬螢幕：上方導覽列、後台左側選單、四級橫排 ═════
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#toAdmin').click();
  await page.getByText('今天').first().waitFor().catch(() => {});
  const side = await page.locator('nav.tabs').boundingBox();
  assert.ok(side.x < 5 && side.width < 260 && side.height > 500, '後台在寬螢幕是左側選單：' + JSON.stringify(side));
  assert.equal(await page.locator('nav.tabs button[data-v=more]').count(), 0, '寬螢幕不需要「更多」');
  await page.locator('nav.tabs button[data-v=overview]').click();
  await page.locator('table.tbl').waitFor();
  assert.equal(await page.locator('nav.tabs button.on').getAttribute('data-v'), 'overview');
  await shot('20-desktop-admin'); await noHScroll('寬螢幕後台');
  await page.locator('#hdrLogout').click();
  await page.getByText('已登出').waitFor();
  await tab('progress');
  await page.locator('.stage').first().waitFor();
  const tops = await page.locator('.stage').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  assert.equal(new Set(tops).size, 1, '寬螢幕四級排成一列');
  const hb = await page.locator('header.top').boundingBox();
  assert.ok(hb.height < 90, '寬螢幕導覽列和標題同一排');
  const lb = await page.locator('nav.tabs button[data-v=login]').boundingBox();
  assert.ok(lb.x + lb.width > 1280 - 140, '登入在最右邊：' + JSON.stringify(lb));
  assert.ok((await page.locator('nav.tabs').boundingBox()).y < hb.height, '導覽列在頂部');
  await shot('21-desktop-progress'); await noHScroll('寬螢幕進程查詢');
  await page.locator('#lvPanel details.sub').first().locator('summary').click();
  await tab('badges'); await page.locator('.badge').first().waitFor();
  await page.locator('.badge').first().click();
  const sh = await page.locator('.sheet').boundingBox();
  assert.ok(sh.y > 20, '寬螢幕彈出視窗置中，不是貼底');
  await shot('22-desktop-badges');

  // ═════ 新的註冊方式：家長自己註冊 → 等待審核 → 團長核准 → 家長看到孩子 ═════
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('about:blank'); await page.goto(PAGE + '#progress'); await page.locator('.stage').first().waitFor();
  await tab('login');
  await page.click('#signup');
  await page.getByText('同時是家長和服務員').waitFor();
  await shot('30-signup-identity'); await noHScroll('註冊選身分');
  await page.locator('[data-id=家長]').click();
  await page.fill('input[name=nickname]', '測試小狼戊媽媽');
  await page.fill('input[name=username]', 'mom_new'); await page.fill('input[name=password]', 'mompass12'); await page.fill('input[name=password2]', 'mompass12');
  await page.click('form#f button[type=submit]');
  assert.match(await page.locator('.out').innerText(), /請填寫孩子的姓名/);
  await page.fill('#kidBox input[name=child]', '測試小狼戊');
  await page.click('#addKid');
  assert.equal(await page.locator('#kidBox input[name=child]').count(), 2);
  // 多加的孩子欄位可以刪除（修正：原本加了就刪不掉）
  await page.click('#addKid');
  assert.equal(await page.locator('#kidBox input[name=child]').count(), 3);
  await page.locator('#kidBox [data-rmkid]').nth(1).click();
  assert.equal(await page.locator('#kidBox input[name=child]').count(), 2);
  assert.equal(await page.locator('#kidBox input[name=child]').nth(1).getAttribute('placeholder'), '孩子 2 的姓名', '刪除後重新編號');
  await page.locator('#kidBox [data-rmkid]').nth(1).click();
  assert.equal(await page.locator('#kidBox input[name=child]').count(), 1);
  assert.equal(await page.locator('#kidBox [data-rmkid]').count(), 0, '只剩一格時不顯示刪除');
  assert.equal(await page.inputValue('#kidBox input[name=child]'), '測試小狼戊', '刪除其他格不影響已填的');
  await page.click('#addKid');
  await shot('31-signup-form');
  await page.click('form#f button[type=submit]');
  await page.getByText('註冊 3／3').waitFor();
  await page.check('input[name=agree]');
  await page.click('form#f button[type=submit]');
  await page.getByText('申請已送出，等待團長審核').waitFor();
  assert.match(await text(), /測試小狼戊[\s\S]*等待團長審核/);
  await shot('32-signup-waiting');
  assert.equal(env.rows('註冊申請').filter((r) => r[5] === '待審核' && r[1] === env.rows('帳號').find((x) => x[1] === 'mom_new')[0]).length, 1, '空白的第二格不送出');

  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('about:blank'); await page.goto(PAGE + '#progress'); await page.locator('.stage').first().waitFor();
  await tab('login');
  await page.fill('input[name=username]', 'leader01'); await page.fill('input[name=password]', 'leaderpass2');
  await page.click('button[type=submit]');
  await page.locator('#toReq').click();
  await page.locator('[data-req]').first().waitFor();
  assert.match(await text(), /測試小狼戊[\s\S]*申請人：測試小狼戊媽媽/);
  await shot('33-admin-requests'); await noHScroll('註冊審核');
  await page.locator('[data-req]', { hasText: '測試小狼戊' }).locator('[data-ok]').click();
  await page.getByText('已核准').waitFor();
  await page.locator('[data-req]').first().waitFor();
  assert.ok(!/測試小狼戊/.test(await text()), '核准後從清單移除');
  const newCub = env.rows('小狼名單').find((r) => r[1] === '測試小狼戊');
  assert.ok(newCub, '核准後新增小狼');

  // ═════ 公告欄、小隊輔、批次匯入、正副小隊長、升團（團長，寬螢幕） ═════
  const sideTab = (v) => page.locator(`nav.tabs button[data-v=${v}]`).click();
  await sideTab('notices');
  await page.getByText('發布公告').waitFor();
  await page.fill('form#fn input[name=title]', '12 月團集會通知');
  await page.fill('form#fn textarea[name=content]', '早上九點在活動中心集合，請穿制服。');
  await page.selectOption('form#fn select[name=meetingId]', 'M5');
  await page.check('form#fn input[name=pinned]');
  await page.click('form#fn button[type=submit]');
  await page.getByText('全部公告（1）').waitFor();
  assert.match(await text(), /📌 12 月團集會通知/);
  await shot('40-notices'); await noHScroll('公告欄');
  assert.equal(env.rows('公告').length, 1);

  await sideTab('squads');
  await page.locator('[data-staff=一小隊]').click();
  await page.locator('form#fst input[type=checkbox]').first().check();
  await page.click('form#fst button[type=submit]');
  await page.getByText('已儲存小隊輔').waitFor();
  await page.locator('[data-staff=一小隊]').waitFor();
  assert.match(await text(), /一小隊[\s\S]*小隊輔：團長[\s\S]*二小隊[\s\S]*小隊輔：未設定/);
  await shot('41-squad-staff');
  assert.equal(env.rows('小隊輔').length, 1);

  await sideTab('cubs');
  await page.locator('#importBtn').click();
  await page.fill('form#fim textarea', '測試小狼己 一小隊 2026-09-01\n測試小狼庚');
  await page.click('form#fim button[type=submit]');
  await page.getByText('已匯入 2 位').waitFor();
  assert.ok(env.rows('小狼名單').find((r) => r[1] === '測試小狼己' && r[2] === '一小隊' && r[7] === '在團'), '匯入後寫進名單');

  // 一小隊沒有狼級以上 → 羚羊級的測試小狼甲可以當小隊長
  await page.locator('#list .list-row', { hasText: '測試小狼甲' }).click();
  await page.locator('#moreBtn').click();
  await page.locator('#role').click();
  await page.selectOption('form#frl select[name=role]', '小隊長');
  await page.click('form#frl button[type=submit]');
  await page.getByText('已更新職務').waitFor();
  await page.getByText('職務紀錄（1）').waitFor();
  assert.match(await text(), /一小隊・小隊長[\s\S]*小隊輔：團長/);
  await shot('42-cub-role'); await noHScroll('小狼頁職務');
  assert.equal(env.rows('小狼名單').find((r) => r[0] === 'C1')[10], '小隊長');

  // 升團：職務自動卸任，狀態「升團」
  await sideTab('cubs');
  await page.locator('#list .list-row', { hasText: '測試小狼己' }).click();
  await page.locator('#moreBtn').click();
  await page.locator('#leave').click();
  await shot('43-leave-form');
  await page.click('form#flv button[type=submit]');
  await page.getByText('已標記升團').waitFor();
  assert.equal(env.rows('小狼名單').find((r) => r[1] === '測試小狼己')[7], '升團');

  // 匯出 CSV
  await sideTab('overview');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#csv').click()]);
  const csvText = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(csvText, /^\ufeff姓名,小隊,剛入團,羚羊,狼,鹿,豹,技能章數,出席次數\r\n/, 'CSV 有 BOM 與標題列');
  assert.match(csvText, /測試小狼甲,一小隊/);

  // 選單合併（附錄第 47 點）：總覽內切換進程／出席；行事曆內切換年度出席；帳號與權限內切換所有帳號
  assert.equal(await page.locator('nav.tabs button[data-v=attOverview], nav.tabs button[data-v=periods], nav.tabs button[data-v=accounts]').count(), 0, '合併後選單不再各自一項');
  assert.match(await page.locator('nav.tabs').innerText(), /帳號申請[\s\S]*總覽[\s\S]*列印紙本[\s\S]*帳號與權限/);
  await page.locator('#gseg button[data-g=attOverview]').click();
  await page.getByText('出席總覽').waitFor();
  assert.equal(await page.locator('nav.tabs button.on').getAttribute('data-v'), 'overview', '切到出席時選單仍亮「總覽」');
  assert.equal(await page.locator('#gseg button.on').getAttribute('data-g'), 'attOverview');
  await sideTab('calendar');
  await page.locator('#gseg button[data-g=periods]').click();
  await page.getByText('年度出席設定').waitFor();
  await shot('48-merged-menu');

  // ═════ 活動報名與章的圖片（附錄第 50 點，團長） ═════
  await sideTab('events');
  await page.locator('#newEv').click();
  await page.fill('form#fe input[name=title]', '冬季露營');
  await page.fill('form#fe textarea[name=desc]', '兩天一夜，請帶睡袋。');
  await page.fill('form#fe input[name=date]', '2026-12-12'); await page.fill('form#fe input[name=endDate]', '2026-12-13');
  await page.fill('form#fe input[name=regStart]', '2026-11-01T08:00'); await page.fill('form#fe input[name=regEnd]', '2026-12-05T23:59');
  await page.fill('form#fe input[name=fee]', '1200');
  await page.locator('#addQ').click();
  await page.fill('[data-qrow] [data-q=label]', '家長手機');
  await page.selectOption('[data-qrow] [data-q=type]', 'text');
  await page.click('form#fe button[type=submit]');
  await page.getByText('不收集「手機」').waitFor();
  await page.fill('[data-qrow] [data-q=label]', '飲食');
  await page.selectOption('[data-qrow] [data-q=type]', 'choice');
  await page.fill('[data-qrow] [data-q=options]', '葷, 素');
  await page.check('[data-qrow] [data-q=required]');
  await shot('52-event-form'); await noHScroll('活動表單');
  await page.click('form#fe button[type=submit]');
  await page.getByText('還沒有人報名。').waitFor();
  assert.equal(env.rows('活動').length, 1);
  assert.match(await page.locator('#evSheet').getAttribute('href'), /^https:\/\/docs\.google\.com\/spreadsheets\/d\/EXT-1$/, '活動建立後就有存檔試算表的連結');
  // 上傳章的圖片：項目管理 → 進程 → 第一個級別
  await sideTab('items');
  await page.locator('#uimg').setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHxcCAr7kO9IAAAAASUVORK5CYII=', 'base64') });
  await page.getByText('圖片已更新').waitFor();
  await page.locator('#uimgDel').waitFor();
  assert.equal(env.rows('章圖').length, 1);
  assert.ok(await page.locator('.uic.has img').count() >= 1, '上傳後圖示換成圖片');
  await shot('53-unit-image');

  // 最高權限鎖在 admin：一般團長看得到提示，admin 那一列沒有「管理」按鈕，指定時只能選服務員
  env.ctx.ensureDefaultAdmin_();
  await sideTab('admins');
  await page.locator('#ownerNote').waitFor();
  assert.match(await text(), /🔒 最高權限/);
  assert.equal(await page.locator('#gseg button').count(), 2, '帳號與權限：管理員｜所有帳號');
  assert.equal(await page.locator('.list-row', { hasText: '帳號 admin' }).locator('[data-ad]').count(), 0, 'admin 不能被管理');
  assert.equal(await page.locator('.list-row', { hasText: '帳號 leader01' }).locator('[data-ad]').count(), 0, '一般團長不能動團長');
  await page.locator('[data-pick]').first().click();
  assert.deepEqual(await page.locator('form#fa select[name=role] option').allInnerTexts(), ['服務員'], '一般團長只能指定服務員');
  await shot('47-admins-owner');
  await page.locator('.sheet [data-close]').click();

  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('about:blank'); await page.goto(PAGE + '#progress'); await page.locator('.stage').first().waitFor();
  await tab('login');
  await page.fill('input[name=username]', 'mom_new'); await page.fill('input[name=password]', 'mompass12');
  await page.click('button[type=submit]');
  await page.getByText('下一步挑戰').waitFor();
  assert.match(await text(), /測試小狼戊/, '家長核准後看到孩子');

  // 家長首頁看得到公告；出席頁可以先請假、也可以取消
  await page.locator('#noticeCard').waitFor();
  assert.match(await page.locator('#noticeCard').innerText(), /12 月團集會通知[\s\S]*早上九點/);
  await shot('44-parent-notice');
  await seg('attendance');
  await page.getByText('接下來的集會').waitFor();
  await page.locator('[data-leave][data-on="1"]').first().click();
  await page.getByText('已請假').first().waitFor();
  await page.locator('[data-leave][data-on="0"]').first().waitFor();
  const kid = env.rows('小狼名單').find((r) => r[1] === '測試小狼戊')[0];
  assert.equal(env.rows('出席紀錄').filter((r) => r[1] === kid && r[2] === '請假').length, 1, '請假寫進出席紀錄');
  await shot('45-parent-leave'); await noHScroll('家長請假');
  await page.locator('[data-leave][data-on="0"]').first().click();
  await page.getByText('已取消請假').waitFor();
  assert.equal(env.rows('出席紀錄').filter((r) => r[1] === kid && r[2] === '請假').length, 0, '取消後沒有請假紀錄');

  // 家長報名活動：從首頁的「活動報名」進去，一次報兩位
  await page.locator('#title').click();
  await page.locator('nav.tabs button[data-v=home]').click().catch(() => {});
  await page.evaluate(() => renderInfo('events'));
  await page.locator('[data-reg]').first().click();
  await page.locator('form#fev').waitFor();
  await page.fill('[data-person] [data-f=name]', '測試小狼戊');
  await page.selectOption('[data-person] [data-f=identity]', '小狼');
  await page.selectOption('[data-person] select[data-q]', '葷');
  await page.locator('#addP').click();
  await page.locator('[data-person]').nth(1).locator('[data-f=name]').fill('測試小狼戊媽媽');
  await page.locator('[data-person]').nth(1).locator('[data-f=identity]').selectOption('家長');
  await page.locator('[data-person]').nth(1).locator('select[data-q]').selectOption('素');
  await shot('54-event-register'); await noHScroll('報名表');
  await page.click('form#fev button[type=submit]');
  await page.getByText('我已經報名的（2 位）').waitFor();
  assert.match(await text(), /應繳 1200 元・尚未繳費/);
  assert.equal(env.rows('活動報名').filter((r) => r[9] === '有效').length, 2);
  await page.locator('[data-cancel]').nth(1).click();
  await page.getByText('我已經報名的（1 位）').waitFor();

  // LINE 圖文選單連到的三個公開頁面與首頁月曆（附錄第 49 點）
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('about:blank'); await page.goto(PAGE); await page.locator('#calCard .cal-grid').waitFor();
  assert.match(await page.locator('#calCard').innerText(), /團集會行事曆[\s\S]*年 \d+ 月/);
  assert.ok(await page.locator('#calCard .d.today').count() === 1, '月曆標出今天');
  for (let i = 0; i < 3 && !(await page.locator('#calCard').innerText()).includes('12/6 團集會'); i++) await page.locator('#calCard [data-cal]').last().click();
  assert.match(await page.locator('#calCard').innerText(), /12\/6（日）[\s\S]*12\/6 團集會/, '月曆下方列出當月集會');
  assert.match(await page.locator('#calCard').innerText(), /🔴 報名截止：冬季露營[\s\S]*🎪 冬季露營（12\/12～12\/13）/, '月曆列出活動與報名截止');
  assert.ok(await page.locator('#calCard .d.ev').count() === 2 && await page.locator('#calCard .d.regend').count() === 1, '月曆標出活動日與截止日');
  assert.ok(await page.locator('#homeLinks [data-info=events]').count() === 1);
  await shot('50-home-calendar'); await noHScroll('首頁月曆');
  await page.locator('#homeLinks [data-info=about]').click();
  await page.getByText('這是範本').waitFor();
  assert.equal(new URL(page.url()).hash, '#about');
  // 沒登入按「我要報名」→ 先登入 → 直接開報名表
  await page.goto('about:blank'); await page.goto(PAGE + '#events'); await page.locator('[data-reg]').first().waitFor();
  assert.match(await text(), /冬季露營[\s\S]*報名中[\s\S]*1200 元/);
  await shot('55-events-public');
  await page.locator('[data-reg]').first().click();
  await page.getByText('登入後會直接打開報名表').waitFor();
  await page.fill('input[name=username]', 'mom_new'); await page.fill('input[name=password]', 'mompass12');
  await page.click('button[type=submit]');
  await page.getByText('我已經報名的（1 位）').waitFor();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('about:blank'); await page.goto(PAGE + '#calendar'); await page.locator('#calCard .cal-grid').waitFor();
  await shot('51-info-calendar');
  await page.goto('about:blank'); await page.goto(PAGE + '#notices'); await page.locator('#noticeCard').waitFor();
  assert.match(await page.locator('#noticeCard').innerText(), /12 月團集會通知/);
  await page.locator('#infoBack').click();
  await page.getByText('什麼是「進程」？').waitFor();

  // 沒登入的首頁也看得到公告
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('about:blank'); await page.goto(PAGE); await page.locator('#noticeCard').waitFor();
  assert.match(await page.locator('#noticeCard').innerText(), /12 月團集會通知/);
  await shot('46-public-notice'); await noHScroll('公開首頁公告');

  assert.deepEqual(errors, [], '頁面不可有 JavaScript 錯誤');
  console.log(`前端端對端測試全部通過（共呼叫後端 ${calls} 次）`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
