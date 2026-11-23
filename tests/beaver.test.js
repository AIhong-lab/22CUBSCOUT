// 全團上線第 2 期（SPEC 附錄第 75 點）：通用進程模組＋稚齡進程與技能章。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../gas/Logic.js');
const { loadGas } = require('./gas-mock.js');

// ───────────── 純邏輯 ─────────────

const header = ['項目ID', '類別', '級別或章名', '大項', '項目內容', '排序', '啟用', '分團'];
const beaverItems = () => L.parseItems([header,
  ['稚齡-P-地球-1', '進程', '地球', '－', '背誦諾言', 10, '是', '稚齡'],
  ['稚齡-P-地球-2', '進程', '地球', '－', '吼聲與敬禮', 20, '是', '稚齡'],
  ['稚齡-P-星星-1', '進程', '星星', '－', '參加團集會', 30, '是', '稚齡'],
  ['稚齡-B-種植-1', '技能章', '種植', '－', '種豆子', 40, '是', '稚齡'],
  ['B-種植-1', '技能章', '種植', '－', '小狼的種植', 50, '是', ''],
  ['P-羚羊-1', '進程', '羚羊', '－', '小狼的羚羊', 60, '是', '']
]).items;
const done = (id, date) => ({ cubId: 'K1', itemId: id, date, signer: 'A1' });

test('進程模組：小狼、稚齡各自的級別、ID 前綴與技能章分類', () => {
  assert.deepEqual(L.PROGRESS_SECTIONS, ['稚齡', '小狼']);
  assert.deepEqual(L.levelsOf('稚齡'), ['地球', '星星', '月亮', '太陽']);
  assert.deepEqual(L.levelsOf(''), L.LEVELS, '空白＝小狼');
  assert.deepEqual(L.levelsOf('童軍'), [], '童軍還沒有進程模組');
  assert.equal(L.progressModule('稚齡').badgeGroups.join(), '服務類,運動類,技巧類');
  assert.equal(L.isLevelOf('稚齡', '地球'), true);
  assert.equal(L.isLevelOf('小狼', '地球'), false);
  assert.equal(L.nextItemId(['稚齡-B-種植-1', 'B-種植-3'], '技能章', '種植', '－', '稚齡'), '稚齡-B-種植-2', '稚齡和小狼的序號分開');
  assert.equal(L.nextItemId(['稚齡-B-種植-1', 'B-種植-3'], '技能章', '種植', '－', '小狼'), 'B-種植-4');
  assert.equal(L.nextItemId([], '進程', '地球', '－', '稚齡'), '稚齡-P-地球-1');
});

test('項目總表：分團欄空白＝小狼；稚齡的級別依稚齡檢查；沒有進程的分團報錯', () => {
  const r = L.parseItems([header,
    ['稚齡-P-地球-1', '進程', '地球', '－', 'a', 1, '是', '稚齡'],
    ['X-1', '進程', '地球', '－', 'b', 2, '是', ''],
    ['X-2', '進程', '羚羊', '－', 'c', 3, '是', '稚齡'],
    ['X-3', '技能章', '露營', '－', 'd', 4, '是', '童軍'],
    ['X-4', '技能章', '露營', '－', 'e', 5, '是', '火星']
  ]);
  assert.deepEqual(r.items.map((i) => [i.id, i.sec]), [['稚齡-P-地球-1', '稚齡']]);
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4, 5, 6]);
  assert.match(r.errors[0].reason, /小狼的進程級別/);
  assert.match(r.errors[2].reason, /童軍還沒有進程模組/);
  assert.match(r.errors[3].reason, /分團只能是/);
});

test('稚齡設定：各分團一組，只有稚齡有完成期限；小狼的設定不變', () => {
  const v = L.parseSettings([['鍵', '值', '說明'], ['完成期限月數：星星（稚齡）', '3', ''], ['晉級所需出席次數（稚齡）', '2', '']]).values;
  const p = L.progressParams(v, '稚齡');
  assert.deepEqual(p.deadlines, { '地球': 6, '星星': 3, '月亮': 12, '太陽': 12 });
  assert.equal(p.deadlineWarnDays, 30);
  assert.equal(p.levelAttendCount, 2);
  assert.equal(p.intervalMonths, 0, '稚齡沒有晉級間隔');
  assert.equal(p.autoItemId, undefined, '稚齡沒有出席自動完成（團長決定手動簽核）');
  const c = L.progressParams(v, '小狼');
  assert.equal(c.intervalMonths, 6);
  assert.equal(c.levelAttendCount, 8);
  assert.equal(c.autoItemId, 'P-羚羊-7');
  assert.equal(c.deadlines, undefined);
  assert.equal(L.progressParams(v, '童軍'), null);
  assert.equal(L.validateSettingValue('完成期限月數：地球（稚齡）', '61').ok, false);
  assert.equal(L.validateSettingValue('完成期限月數：地球（稚齡）', '0').ok, true, '0＝不提醒');
  // 稚齡的鍵沒填不算錯誤（setup 不會補）
  assert.ok(!L.defaultSettingsRows().some((r) => /（稚齡）/.test(r[0])));
});

test('稚齡進度：只算稚齡的項目與頒章；同名的小狼種植章互不影響；沒有剛入團', () => {
  const base = Object.assign(L.progressParams(L.parseSettings([]).values, '稚齡'), { cubId: 'K1', items: beaverItems(), today: '2026-11-14', joinDate: '2026-06-01' });
  let p = L.computeCubProgress(Object.assign({}, base, {
    completions: [done('稚齡-B-種植-1', '2026-10-01')],
    awards: [{ cubId: 'K1', unit: '種植', date: '2026-09-01', sec: '' }] // 小狼的種植章（例如資料搬移）不算稚齡的
  }));
  assert.equal(p.section, '稚齡');
  assert.deepEqual(p.units.filter((u) => u.category === '進程').map((u) => u.unit), ['地球', '星星', '月亮', '太陽']);
  assert.ok(!p.units.some((u) => u.unit === '剛入團' || u.unit === '羚羊'));
  const plant = p.units.find((u) => u.unit === '種植');
  assert.equal(plant.total, 1, '只有稚齡的種植項目');
  assert.equal(plant.status, '已完成待頒發');
  assert.equal(plant.eligible, true);
  assert.equal(p.nextLevel, '地球');
  // 地球：入團日 + 6 個月 = 2026-12-01，剩不到 30 天 → 快到期
  const earth = p.units.find((u) => u.unit === '地球');
  assert.equal(earth.deadline, '2026-12-01');
  assert.equal(earth.deadlineState, 'soon');
  // 頒了地球之後：星星從地球頒發日起算 6 個月；地球不再有期限
  p = L.computeCubProgress(Object.assign({}, base, {
    completions: [done('稚齡-P-地球-1', '2026-03-01'), done('稚齡-P-地球-2', '2026-03-01')],
    awards: [{ cubId: 'K1', unit: '地球', date: '2026-04-01', sec: '稚齡' }]
  }));
  assert.equal(p.currentLevel, '地球');
  assert.equal(p.units.find((u) => u.unit === '地球').deadline, undefined);
  const star = p.units.find((u) => u.unit === '星星');
  assert.equal(star.deadline, '2026-10-01');
  assert.equal(star.deadlineState, 'over', '已超過期限，只提醒');
  // 期限只提醒、不擋頒章：星星做完就達標
  p = L.computeCubProgress(Object.assign({}, base, {
    completions: [done('稚齡-P-星星-1', '2026-11-01')],
    awards: [{ cubId: 'K1', unit: '地球', date: '2026-04-01', sec: '稚齡' }]
  }));
  assert.equal(p.units.find((u) => u.unit === '星星').eligible, true);
  // 期限月數設 0 或沒有入團日 → 不提醒
  p = L.computeCubProgress(Object.assign({}, base, { joinDate: '', completions: [], awards: [] }));
  assert.equal(p.units.find((u) => u.unit === '地球').deadline, undefined);
});

test('稚齡的出席要求：預設 0（星星第一項由服務員手動簽核）；設定後依上一級頒發日之後的出席判斷', () => {
  const items = beaverItems();
  const awards = [{ cubId: 'K1', unit: '地球', date: '2026-04-01', sec: '稚齡' }];
  const att = ['2026-03-01', '2026-05-01', '2026-06-01'].map((date) => ({ date, status: '出席' }));
  const run = (n) => L.computeCubProgress(Object.assign(L.progressParams(L.parseSettings([['鍵', '值'], ['晉級所需出席次數（稚齡）', String(n)]]).values, '稚齡'),
    { cubId: 'K1', items, awards, attendance: att, completions: [done('稚齡-P-星星-1', '2026-06-01')], today: '2026-11-14' })).units.find((u) => u.unit === '星星');
  assert.equal(run(0).eligible, true);
  assert.equal(run(0).done, 1, '沒有自動完成：只算簽核的');
  assert.equal(run(2).eligible, true);
  const s = run(3);
  assert.equal(s.eligible, false);
  assert.equal(s.attendSinceLast, 2, '地球頒發前的出席不算');
});

test('補登與撤銷：只看同一分團的級別', () => {
  const plan = L.planBackfill({ cubId: 'K1', section: '稚齡', category: '進程', unit: '月亮', date: '2026-01-01', signer: 'A1', items: beaverItems(), completions: [], awards: [{ cubId: 'K1', unit: '地球', sec: '稚齡' }] });
  assert.deepEqual(plan.missingLowerLevels, ['星星']);
  assert.equal(plan.award.sec, '稚齡');
  assert.deepEqual(L.planBackfill({ cubId: 'K1', section: '稚齡', category: '進程', unit: '地球', date: '2026-01-01', signer: 'A1', items: beaverItems(), completions: [], awards: [] }).newCompletions.map((c) => c.itemId), ['稚齡-P-地球-1', '稚齡-P-地球-2']);
  const aw = [{ unit: '地球', sec: '稚齡' }, { unit: '星星', sec: '稚齡' }, { unit: '羚羊', sec: '' }];
  assert.equal(L.currentLevelOf(aw, '稚齡'), '星星');
  assert.equal(L.currentLevelOf(aw, '小狼'), '羚羊');
  assert.equal(L.levelAfterRevoke(aw, '星星', '稚齡'), '地球');
  assert.equal(L.levelAfterRevoke(aw, '羚羊', ''), null);
});

// ───────────── 後端流程 ─────────────

/** 小狼團長＋admin＋稚齡團長（admin 用邀請碼指定）＋稚齡家長 */
function world() {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const W = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const inv = call(O, 'inviteCreate', { section: '稚齡', role: '團長', title: '團長', name: '稚齡團長' });
  const B = env.api({ action: 'register', code: inv.code, childName: '', username: 'beaverlead', password: 'beaverpass1', nickname: '稚齡團長' }).token;
  call(B, 'squadSave', { type: 'add', name: '小星星' });
  const kid = call(B, 'cubSave', { name: '測試稚齡甲', squad: '小星星', joinDate: '2026-05-20' });
  const { code } = call(B, 'cubNewCode', { cubId: kid.cubId });
  const v = env.api({ action: 'consentText' }).version;
  const P = env.api({ action: 'register', code, childName: '測試稚齡甲', username: 'beaverpa1', password: 'parentpass1', nickname: '稚齡家長', consentVersion: v }).token;
  return { env, call, W, O, B, P, kidId: kid.cubId };
}
const idsOf = (env, unit, sec) => env.rows('項目總表').filter((r) => r[2] === unit && (r[7] || '') === sec).map((r) => r[0]);

test('稚齡後台：簽核、頒章寫入分團、團員頁顯示期限；小狼看不到稚齡的項目', () => {
  const { env, call, W, B, kidId } = world();
  const sd = call(B, 'signoffData');
  assert.equal(sd.ok, true);
  assert.ok(sd.items.length === 58 && sd.items.every((i) => i.id.startsWith('稚齡-')), '只有稚齡的項目');
  assert.ok(call(W, 'signoffData').items.every((i) => !i.id.startsWith('稚齡-')), '小狼看不到稚齡的項目');
  assert.equal(call(W, 'signoff', { cubIds: [kidId], itemIds: idsOf(env, '地球', '稚齡'), date: '2026-11-01' }).code, 'BAD_INPUT', '小狼團長簽不到稚齡');
  assert.equal(call(B, 'signoff', { cubIds: [kidId], itemIds: idsOf(env, '種植', ''), date: '2026-11-01' }).code, 'BAD_INPUT', '稚齡簽不到小狼的種植');
  // 團員頁：地球的完成期限＝入團日 + 6 個月；快到期
  let d = call(B, 'cubAdminDetail', { cubId: kidId });
  assert.equal(d.hasProgress, true);
  assert.deepEqual(d.levels, ['地球', '星星', '月亮', '太陽']);
  const earth = d.units.find((u) => u.unit === '地球');
  assert.equal(earth.deadline, '2026-11-20');
  assert.equal(earth.deadlineState, 'soon');
  // 首頁：快到期清單
  let h = call(B, 'adminHome');
  assert.deepEqual(h.due.map((x) => [x.name, x.unit, x.deadline, x.over]), [['測試稚齡甲', '地球', '2026-11-20', false]]);
  assert.deepEqual(h.levels, ['地球', '星星', '月亮', '太陽']);
  assert.deepEqual(call(W, 'adminHome').due, [], '小狼首頁沒有稚齡的提醒');
  // 簽完地球、種植 → 待頒章；頒章寫入分團欄
  call(B, 'signoff', { cubIds: [kidId], itemIds: idsOf(env, '地球', '稚齡').concat(idsOf(env, '種植', '稚齡')), date: '2026-11-01' });
  h = call(B, 'adminHome');
  assert.deepEqual(h.pending.map((x) => x.unit).sort(), ['地球', '種植']);
  assert.match(call(B, 'award', { date: '2026-11-10', entries: [{ cubId: kidId, unit: '星星' }] }).message, /還沒全部完成|地球級還沒有頒發紀錄/);
  assert.equal(call(B, 'award', { date: '2026-11-10', entries: [{ cubId: kidId, unit: '地球' }, { cubId: kidId, unit: '種植' }] }).added, 2);
  const rows = env.rows('頒章紀錄').filter((r) => r[0] === kidId);
  assert.deepEqual(rows.map((r) => [r[1], r[7]]), [['地球', '稚齡'], ['種植', '稚齡']]);
  assert.equal(env.rows('小狼名單').find((r) => r[0] === kidId)[4], '地球', '目前級別');
  d = call(B, 'cubAdminDetail', { cubId: kidId });
  assert.equal(d.cub.currentLevel, '地球');
  assert.equal(d.units.find((u) => u.unit === '星星').deadline, '2027-05-10', '星星從地球頒發日起算 6 個月');
  // 修改、撤銷頒章只動稚齡的紀錄
  assert.equal(call(B, 'awardEdit', { cubId: kidId, unit: '種植', date: '2026-11-11' }).ok, true);
  assert.equal(call(W, 'awardRevoke', { cubId: kidId, unit: '種植' }).code, 'NOT_FOUND', '小狼團長撤銷不到稚齡的章');
  assert.equal(call(B, 'awardRevoke', { cubId: kidId, unit: '地球' }).ok, true);
  assert.equal(env.rows('小狼名單').find((r) => r[0] === kidId)[4], '', '撤銷後退回沒有級別');
  // 補登：月亮前面缺地球、星星
  const bf = call(B, 'backfill', { cubId: kidId, unit: '月亮', date: '2026-11-01' });
  assert.deepEqual(bf.missingLowerLevels, ['地球', '星星']);
  assert.deepEqual(call(B, 'backfill', { cubId: kidId, unit: '月亮', date: '2026-11-01', includeLower: true }).awarded, ['地球', '星星', '月亮']);
  assert.equal(env.rows('小狼名單').find((r) => r[0] === kidId)[4], '月亮');
  // 總覽與列印
  const ov = call(B, 'overview');
  assert.deepEqual(ov.levels, ['地球', '星星', '月亮', '太陽']);
  assert.equal(ov.rows[0].levels['月亮'].status, '已頒發');
  assert.equal(call(B, 'printData', { unit: '太陽', cubIds: [kidId] }).ok, true);
  assert.equal(call(B, 'printData', { unit: '羚羊', cubIds: [kidId] }).code, 'BAD_INPUT');
});

test('稚齡項目管理：只看得到、改得到稚齡的；新增項目用稚齡的 ID；分類是服務類／運動類／技巧類', () => {
  const { env, call, W, B } = world();
  const t = call(B, 'itemsTree');
  assert.equal(t.items.length, 58);
  assert.deepEqual(t.levels, ['地球', '星星', '月亮', '太陽']);
  assert.deepEqual(t.groups, ['服務類', '運動類', '技巧類']);
  assert.equal(t.units.filter((u) => u.category === '技能章').length, 15);
  assert.ok(t.units.find((u) => u.unit === '地球').rule.startsWith('凡年滿五歲兒童'), '晉級條件為官方原文（去掉「進程內容：」）');
  assert.ok(!/進程內容：$/.test(t.units.find((u) => u.unit === '地球').rule));
  const add = call(B, 'itemSave', { category: '技能章', unit: '種植', text: '測試新增項目', confirm: true });
  assert.equal(add.id, '稚齡-B-種植-4');
  assert.equal(env.rows('項目總表').find((r) => r[0] === add.id)[7], '稚齡');
  assert.equal(call(W, 'itemSave', { id: add.id, text: '小狼改稚齡' }).code, 'NOT_FOUND', '小狼團長改不到稚齡的項目');
  assert.equal(call(B, 'itemSave', { id: 'B-種植-1', text: '稚齡改小狼' }).code, 'NOT_FOUND');
  assert.match(call(B, 'unitSave', { category: '技能章', unit: '畫畫', isNew: true, group: '健身類' }).message, /服務類／運動類／技巧類/);
  assert.equal(call(B, 'unitSave', { category: '技能章', unit: '畫畫', isNew: true, group: '技巧類' }).ok, true);
  assert.equal(env.rows('級別與章說明').find((r) => r[0] === '畫畫')[6], '稚齡');
  assert.equal(call(B, 'unitSave', { category: '技能章', unit: '種植', group: '服務類', desc: '稚齡的種植說明' }).ok, true);
  assert.equal(env.rows('級別與章說明').find((r) => r[0] === '種植' && !r[6])[3], '', '小狼的種植說明不受影響');
  assert.equal(call(W, 'itemsTree').items.length, 168, '小狼的項目數不變');
  assert.match(call(B, 'itemsExport').filename, /項目總表_稚齡_/);
  assert.equal(call(B, 'itemsExport').csv.trim().split('\n').length, 1 + 59);
});

test('稚齡家長與公開頁：逐項顯示稚齡的進程與章、不顯示期限；公開查詢可選分團', () => {
  const { env, call, B, P, kidId } = world();
  const d = call(P, 'cubDetail', { cubId: kidId });
  assert.equal(d.ok, true);
  assert.equal(d.hasProgress, true);
  assert.deepEqual(d.levels, ['地球', '星星', '月亮', '太陽']);
  assert.deepEqual(d.units.filter((u) => u.category === '進程').map((u) => u.unit), ['地球', '星星', '月亮', '太陽']);
  assert.equal(d.units.filter((u) => u.category === '技能章').length, 15);
  assert.ok(!JSON.stringify(d).includes('deadline'), '家長畫面不帶完成期限');
  assert.equal(d.nextChallenge.level, '地球');
  assert.ok(d.units.find((u) => u.unit === '球類').group === '運動類');
  // 公開查詢
  const c = env.api({ action: 'catalog', section: '稚齡' });
  assert.deepEqual(c.levels, ['地球', '星星', '月亮', '太陽']);
  assert.equal(c.units.reduce((s, u) => s + u.items.length, 0), 58);
  const wolf = env.api({ action: 'catalog' });
  assert.equal(wolf.units.reduce((s, u) => s + u.items.length, 0), 168, '沒帶分團＝小狼（舊網址）');
  assert.deepEqual(env.api({ action: 'catalog', section: '童軍' }).units, [], '童軍還沒有進程');
  // 章圖：稚齡的種植和小狼的種植分開
  const img = 'data:image/png;base64,AAAA';
  assert.equal(call(B, 'unitImageSave', { category: '技能章', unit: '種植', image: img }).ok, true);
  const imgs = env.api({ action: 'unitImages' }).images;
  assert.equal(imgs['稚齡|技能章|種植'], img);
  assert.equal(imgs['技能章|種植'], undefined);
  assert.equal(env.rows('章圖')[0][5], '稚齡');
});

test('稚齡的設定頁：稚齡團長看得到稚齡的進程設定，看不到小狼的', () => {
  const { call, W, B } = world();
  const keys = (tk) => call(tk, 'settingsGet').settings.map((x) => x.key);
  const bk = keys(B);
  assert.ok(bk.includes('完成期限月數：地球（稚齡）'));
  assert.ok(bk.includes('晉級所需出席次數（稚齡）'));
  assert.ok(!bk.includes('晉級間隔月數（稚齡）'), '稚齡沒有晉級間隔');
  assert.ok(!bk.includes('晉級間隔月數'));
  assert.ok(!keys(W).some((k) => /（稚齡）/.test(k)));
  assert.equal(call(B, 'settingsSave', { changes: { '完成期限月數：地球（稚齡）': '3' } }).ok, true);
  assert.equal(call(W, 'settingsSave', { changes: { '完成期限月數：地球（稚齡）': '3' } }).code, 'FORBIDDEN');
});

test('稚齡達標通知只推給稚齡已連結 LINE 的人；LINE 關鍵字只列自己分團', () => {
  const { env, call, W, B, kidId } = world();
  env.props.LINE_MESSAGING_TOKEN = 'dummy';
  const link = (tk, uid) => {
    const { code } = call(tk, 'lineLinkStart');
    env.ctx.doPost({ parameter: { key: env.props.WEBHOOK_KEY }, postData: { contents: JSON.stringify({ events: [{ type: 'message', replyToken: 'r', source: { type: 'user', userId: uid }, message: { type: 'text', text: code } }] }) } });
  };
  link(B, 'Ubeaver');
  link(W, 'Uwolf');
  env.sent.length = 0;
  call(B, 'signoff', { cubIds: [kidId], itemIds: idsOf(env, '種植', '稚齡'), date: '2026-11-01' });
  const pushes = env.sent.filter((s) => /multicast/.test(s.url));
  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0].body.to, ['Ubeaver']);
  assert.match(JSON.stringify(pushes[0].body), /測試稚齡甲/);
  env.sent.length = 0;
  const hook = (uid, text) => env.ctx.doPost({ parameter: { key: env.props.WEBHOOK_KEY }, postData: { contents: JSON.stringify({ events: [{ type: 'message', replyToken: 'r', source: { type: 'user', userId: uid }, message: { type: 'text', text } }] }) } });
  hook('Ubeaver', '可晉級');
  assert.match(env.sent[0].body.messages[0].text, /測試稚齡甲/);
  hook('Uwolf', '可晉級');
  assert.doesNotMatch(env.sent[1].body.messages[0].text, /測試稚齡甲/, '小狼的人看不到稚齡');
});
