// 全團：童軍、行義（共用一套）與羅浮的進程（SPEC 附錄第 80 點）。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../gas/Logic.js');
const { loadGas } = require('./gas-mock.js');

const head = ['項目ID', '類別', '級別或章名', '大項', '項目內容', '排序', '啟用', '分團'];
const done = (id, date) => ({ cubId: 'K1', itemId: id, date, signer: 'A1' });

test('童軍與行義共用一套：行義的資料記在童軍；級別、專科章分類、ID 前綴', () => {
  assert.equal(L.progressSec('行義'), '童軍');
  assert.equal(L.progressSec('童軍'), '童軍');
  assert.equal(L.progressSec(''), '小狼');
  assert.deepEqual(L.levelsOf('行義'), ['初級', '中級', '高級', '獅級', '長城', '國花']);
  assert.deepEqual(L.progressModule('行義').badgeGroups, ['服務類', '技能類', '健身類', '興趣類']);
  assert.equal(L.nextItemId([], '進程', '初級', '－', '行義'), '童軍-P-初級-1');
  assert.deepEqual(L.levelsOf('羅浮'), ['見習羅浮', '授銜羅浮', '服務羅浮']);
  // 專科章匯入時和技能章同一類
  const seed = L.buildSeed('類別,級別或章名,大項或分類,項目內容\n專科章,露營,技能類,會搭帳篷\n', {}, '童軍');
  assert.deepEqual(seed.itemRows[0].slice(0, 3), ['童軍-B-露營-1', '技能章', '露營']);
  assert.equal(seed.itemRows[0][7], '童軍');
});

test('童軍晉級間隔：初級從入團日起滿 2 個月、中級從初級頒發起滿 4 個月；未滿只是等待', () => {
  const items = L.parseItems([head,
    ['童軍-P-初級-1', '進程', '初級', '－', 'a', 1, '是', '童軍'],
    ['童軍-P-中級-1', '進程', '中級', '－', 'b', 2, '是', '童軍']]).items;
  const base = Object.assign(L.progressParams(L.parseSettings([]).values, '行義'), { cubId: 'K1', items, joinDate: '2026-10-01' });
  let u = L.computeCubProgress(Object.assign({}, base, { today: '2026-11-14', completions: [done('童軍-P-初級-1', '2026-10-20')], awards: [] })).units.find((x) => x.unit === '初級');
  assert.equal(u.status, '已完成待頒發');
  assert.equal(u.eligible, false);
  assert.equal(u.waitingUntil, '2026-12-01', '入團日 + 2 個月');
  u = L.computeCubProgress(Object.assign({}, base, { today: '2026-12-02', completions: [done('童軍-P-初級-1', '2026-10-20')], awards: [] })).units.find((x) => x.unit === '初級');
  assert.equal(u.eligible, true);
  u = L.computeCubProgress(Object.assign({}, base, { today: '2026-12-02', completions: [done('童軍-P-中級-1', '2026-11-20')], awards: [{ cubId: 'K1', unit: '初級', date: '2026-10-01', sec: '童軍' }] })).units.find((x) => x.unit === '中級');
  assert.equal(u.waitingUntil, '2027-02-01');
  const v = L.parseSettings([['鍵', '值'], ['晉級間隔月數：中級（童軍）', '1']]).values;
  assert.equal(L.progressParams(v, '行義').minMonths['中級'], 1, '行義讀童軍的設定');
});

test('羅浮擇一規則：見習羅浮途徑一或途徑二擇一；服務羅浮基本要求全部＋主題活動任選一項', () => {
  const items = L.parseItems([head,
    ['羅浮-P-見習羅浮-途徑1-1', '進程', '見習羅浮', '途徑1', 'a', 1, '是', '羅浮'],
    ['羅浮-P-見習羅浮-途徑1-2', '進程', '見習羅浮', '途徑1', 'b', 2, '是', '羅浮'],
    ['羅浮-P-見習羅浮-途徑2-1', '進程', '見習羅浮', '途徑2', 'c', 3, '是', '羅浮'],
    ['羅浮-P-服務羅浮-基本要求-1', '進程', '服務羅浮', '基本要求', 'd', 4, '是', '羅浮'],
    ['羅浮-P-服務羅浮-主題活動-1', '進程', '服務羅浮', '主題活動', 'e', 5, '是', '羅浮'],
    ['羅浮-P-服務羅浮-主題活動-2', '進程', '服務羅浮', '主題活動', 'f', 6, '是', '羅浮']]).items;
  const run = (comps, awards = []) => L.computeCubProgress(Object.assign(L.progressParams(L.parseSettings([]).values, '羅浮'),
    { cubId: 'K1', items, today: '2027-12-01', joinDate: '2026-01-01', completions: comps, awards }));
  let p = run([done('羅浮-P-見習羅浮-途徑2-1', '2026-03-01')]);
  let u = p.units.find((x) => x.unit === '見習羅浮');
  assert.equal(u.status, '已完成待頒發', '途徑2 全部完成就可以');
  assert.deepEqual([u.done, u.total], [1, 1]);
  u = run([done('羅浮-P-見習羅浮-途徑1-1', '2026-03-01')]).units.find((x) => x.unit === '見習羅浮');
  assert.equal(u.status, '進行中');
  assert.deepEqual([u.done, u.total], [1, 2], '顯示最接近完成的那一條');
  const aw = [{ cubId: 'K1', unit: '見習羅浮', date: '2026-01-01', sec: '羅浮' }, { cubId: 'K1', unit: '授銜羅浮', date: '2026-06-01', sec: '羅浮' }];
  u = run([done('羅浮-P-服務羅浮-基本要求-1', '2026-08-01')], aw).units.find((x) => x.unit === '服務羅浮');
  assert.deepEqual([u.done, u.total, u.status], [1, 2, '進行中'], '還差一項主題活動');
  u = run([done('羅浮-P-服務羅浮-基本要求-1', '2026-08-01'), done('羅浮-P-服務羅浮-主題活動-2', '2026-09-01')], aw).units.find((x) => x.unit === '服務羅浮');
  assert.deepEqual([u.done, u.total, u.status], [2, 2, '已完成待頒發']);
  assert.equal(u.eligible, true, '授銜後滿 12 個月（2027-06-01）之後');
  assert.equal(u.eligibleDate, '2027-06-01');
});

function world() {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' });
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const lead = (sec, u) => { const inv = call(O, 'inviteCreate', { section: sec, role: '團長', title: '團長', name: sec + '團長' }); return env.api({ action: 'register', code: inv.code, childName: '', username: u, password: u + 'pass1', nickname: sec + '團長' }).token; };
  return { env, call, O, S: lead('童軍', 'scoutlead'), V: lead('行義', 'ventlead'), R: lead('羅浮', 'roverlead') };
}
const ids = (env, unit, sec) => env.rows('項目總表').filter((r) => r[2] === unit && (r[7] || '') === sec).map((r) => r[0]);

test('setup 匯入童軍行義（進程 145、專科章 95 章 513 項）與羅浮（22 項）', () => {
  const { env } = world();
  assert.equal(env.rows('項目總表').filter((r) => r[7] === '童軍').length, 658);
  assert.equal(env.rows('項目總表').filter((r) => r[7] === '羅浮').length, 22);
  assert.equal(env.rows('項目總表').filter((r) => r[7] === '童軍' && r[1] === '技能章').length, 513);
  assert.ok(!env.rows('項目總表').some((r) => r[7] === '行義'), '行義不另外匯入');
  assert.equal(env.rows('級別與章說明').filter((r) => r[6] === '童軍' && r[1] === '技能章').length, 95);
  assert.match(env.rows('級別與章說明').find((r) => r[6] === '童軍' && r[0] === '初級')[4], /經2個月以上/);
});

test('行義團長簽核、頒章：記在童軍；童軍團長看得到同一套項目；設定共用', () => {
  const { env, call, S, V, R } = world();
  const kid = call(V, 'cubSave', { name: '測試行義甲', joinDate: '2025-01-01' });
  assert.equal(kid.ok, true, JSON.stringify(kid));
  const t = call(V, 'itemsTree');
  assert.deepEqual(t.levels, ['初級', '中級', '高級', '獅級', '長城', '國花']);
  assert.equal(t.items.length, 658);
  assert.equal(call(S, 'itemsTree').items.length, 658);
  assert.equal(call(R, 'itemsTree').items.length, 22);
  // 補登初級、中級，再簽高級 → 頒高級
  assert.deepEqual(call(V, 'backfill', { cubId: kid.cubId, unit: '中級', date: '2026-01-01', includeLower: true }).awarded, ['初級', '中級']);
  call(V, 'signoff', { cubIds: [kid.cubId], itemIds: ids(env, '高級', '童軍'), date: '2026-11-01' });
  const a = call(V, 'award', { date: '2026-11-10', entries: [{ cubId: kid.cubId, unit: '高級' }], confirm: true });
  assert.equal(a.added, 1, JSON.stringify(a));
  assert.ok(env.rows('頒章紀錄').filter((r) => r[0] === kid.cubId).every((r) => r[7] === '童軍'));
  assert.equal(env.rows('小狼名單').find((r) => r[0] === kid.cubId)[4], '高級');
  assert.equal(call(V, 'cubAdminDetail', { cubId: kid.cubId }).cub.currentLevel, '高級');
  const keys = call(V, 'settingsGet').settings.map((x) => x.key);
  assert.ok(keys.includes('晉級間隔月數：獅級（童軍）'), '行義團長也能改共用的童軍設定');
  assert.equal(env.api({ action: 'catalog', section: '羅浮' }).levels.length, 3);
});
