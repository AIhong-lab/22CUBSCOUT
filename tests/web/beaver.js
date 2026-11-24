// 稚齡進程與技能章的網頁測試（SPEC 附錄第 77 點）：公開查詢、家長闖關、稚齡後台（期限提醒、簽核、總覽、項目管理）。
// 測試資料一律虛構。
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
  env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' });
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const inv = call(O, 'inviteCreate', { section: '稚齡', role: '團長', title: '團長', name: '稚齡團長' });
  const B = env.api({ action: 'register', code: inv.code, childName: '', username: 'beaverlead', password: 'beaverpass1', nickname: '稚齡團長' }).token;
  call(B, 'squadSave', { type: 'add', name: '小星星' });
  const kid = call(B, 'cubSave', { name: '測試稚齡甲', squad: '小星星', joinDate: '2026-05-20' });
  const { code } = call(B, 'cubNewCode', { cubId: kid.cubId });
  env.api({ action: 'register', code, childName: '測試稚齡甲', username: 'beaverpa1', password: 'parentpass1', nickname: '稚齡家長', consentVersion: env.api({ action: 'consentText' }).version });
  const earth = env.rows('項目總表').filter((x) => x[7] === '稚齡' && x[2] === '地球').map((x) => x[0]);
  call(B, 'signoff', { cubIds: [kid.cubId], itemIds: earth.slice(0, 2), date: '2026-11-01' });

  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8').replace(/^const GAS_URL = '[^']*';/m, `const GAS_URL = '${GAS}';`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://pages.test/**', (rt) => rt.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.route(GAS, (rt) => {
    const body = env.ctx.doPost({ parameter: {}, postData: { contents: rt.request().postData() } }).t;
    rt.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  });
  const text = () => page.locator('#app').innerText();
  // 設 SHOT_DIR 時存截圖（人工檢查版面用）
  const shot = async (n) => { if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'beaver-' + n + '.png'), fullPage: true }); };
  const login = async (u, p) => {
    await page.locator('nav.tabs button[data-v=login]').click();
    await page.fill('input[name=username]', u); await page.fill('input[name=password]', p);
    await page.click('button[type=submit]');
  };

  // ═════ 公開：稚齡頁 → 進程查詢（四級）→ 技能章查詢（三類） ═════
  await page.goto(PAGE + '#beaver');
  await page.getByText('22 團稚齡童軍　進程與技能章').waitFor();
  assert.match(await text(), /地球級[\s\S]*星星級[\s\S]*月亮級[\s\S]*太陽級/);
  await page.locator('button[data-go=progress]').click();
  await page.getByText('🗺️ 稚齡童軍進程').waitFor();
  assert.equal(await page.locator('.map .stage').count(), 4);
  assert.match(await page.locator('#lvPanel').innerText(), /地球級任務（6 項）[\s\S]*能背誦稚齡童軍諾言及規律/);
  assert.match(page.url(), /#beaver\/progress$/);
  await shot('catalog');
  await page.locator('#other').click();
  await page.getByText('🎖️ 稚齡童軍技能章').waitFor();
  assert.match(await text(), /共 15 個技能章/);
  assert.match(await text(), /運動類\s*5 個/);
  // 舊網址 #progress 仍是小狼
  await page.goto('about:blank');
  await page.goto(PAGE + '#progress');
  await page.getByText('🗺️ 幼童軍進程').waitFor();
  assert.ok((await text()).includes('剛入團'));

  // ═════ 稚齡家長：闖關地圖是地球、星星；不顯示完成期限 ═════
  await page.goto(PAGE);
  await login('beaverpa1', 'parentpass1');
  await page.getByText('新入團：先挑戰地球級').waitFor();
  assert.match(await text(), /地球級的下一關任務/);
  assert.doesNotMatch(await text(), /期限/, '家長看不到完成期限');
  await page.locator('#toMap').click();
  await page.locator('.map .stage').first().waitFor();
  assert.deepEqual(await page.locator('.map .stage .lv').allInnerTexts(), ['地球級', '星星級']);
  assert.match(await text(), /終點：完成太陽級/);
  await shot('map');
  await page.locator('#pseg button[data-seg=badges]').click();
  await page.getByText('運動類').first().waitFor();
  assert.doesNotMatch(await text(), /期限/);
  await page.locator('nav.tabs button[data-v=mine]').click();
  await page.getByRole('button', { name: '登出' }).first().click();
  await page.getByText('已登出').waitFor();

  // ═════ 稚齡團長：首頁期限提醒、團員頁期限、簽核、總覽、項目管理 ═════
  await login('beaverlead', 'beaverpass1');
  await page.locator('#adminQuick').waitFor();
  assert.match(await page.locator('#title').innerText(), /稚齡童軍後台/);
  assert.match(await text(), /地球級 完成期限 2026\/11\/20（已完成 2／6）/);
  assert.match(await text(), /快到期/);
  await page.locator('[data-cub]').first().click();
  await page.getByText('📅 完成期限').waitFor();
  assert.match(await text(), /尚未頒發地球級/);
  await shot('cub');
  assert.match(await text(), /⭐ 2／6/);
  // 簽核頁有稚齡的項目
  await page.locator('nav.tabs button[data-v=sign]').click();
  await page.waitForTimeout(300);
  assert.doesNotMatch(await text(), /剛入團|羚羊/, '稚齡的簽核頁沒有小狼的級別');
  // 進程總覽：欄位是稚齡的四級
  const ov = await page.evaluate(() => { goAdmin('overview'); return true; });
  assert.ok(ov);
  await page.locator('#t table').waitFor();
  const ths = (await page.locator('#t thead th').allInnerTexts()).slice(1, 5);
  ['地球', '星星', '月亮', '太陽'].forEach((l, i) => assert.ok(ths[i].includes(l), ths.join()));
  // 項目管理：稚齡的級別與 ID
  await page.evaluate(() => goAdmin('items'));
  await page.getByText('稚齡-P-地球-1').waitFor();
  assert.doesNotMatch(await page.locator('#units').innerText(), /羚羊/);

  assert.deepEqual(errors, [], '網頁沒有錯誤');
  await browser.close();
  console.log('稚齡網頁測試通過（公開查詢、家長闖關不顯示期限、後台期限提醒、簽核、總覽、項目管理）');
})().catch((e) => { console.error(e); process.exit(1); });
