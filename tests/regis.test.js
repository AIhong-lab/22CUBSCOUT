// 續團確認與三項登記（SPEC 附錄第 69、70、80 點）。測試資料一律虛構。模擬時間 2026-11-14 → 預設登記年度 2027。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./gas-mock.js');

function world() {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const W = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const inv = call(O, 'inviteCreate', { section: '童軍', role: '團長', title: '團長', name: '童軍團長' });
  const S = env.api({ action: 'register', code: inv.code, childName: '', username: 'scoutlead', password: 'scoutpass1', nickname: '童軍團長' }).token;
  const help = call(O, 'inviteCreate', { section: '小狼', role: '服務員', name: '小狼服務員' });
  const A = env.api({ action: 'register', code: help.code, childName: '', username: 'helper01', password: 'helperpass1', nickname: '小狼服務員' }).token;
  call(W, 'squadSave', { type: 'add', name: '一小隊' });
  const k1 = call(W, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' }).cubId;
  const k2 = call(W, 'cubSave', { name: '測試小狼乙', squad: '一小隊', joinDate: '2025-01-01' }).cubId;
  const s1 = call(S, 'cubSave', { name: '測試童軍甲', joinDate: '2025-01-01' }).cubId;
  return { env, call, W, O, S, A, k1, k2, s1 };
}

test('續團確認：各分團團長只看得到、只能勾自己分團的團員與服務員；預設年度是下一年', () => {
  const { env, call, W, S, A, k1, k2, s1 } = world();
  const l = call(W, 'renewList');
  assert.equal(l.year, 2027);
  assert.deepEqual(l.people.filter((p) => p.type === '童軍').map((p) => p.name).sort(), ['測試小狼乙', '測試小狼甲']);
  assert.ok(l.people.some((p) => p.type === '服務員' && p.name === '小狼服務員'));
  assert.ok(!l.people.some((p) => p.name === '測試童軍甲'), '看不到童軍');
  assert.equal(call(A, 'renewList').code, 'FORBIDDEN', '服務員不能確認續團');
  assert.equal(call(W, 'renewSave', { entries: [{ type: '童軍', id: s1, renew: '是' }] }).code, 'NOT_FOUND', '不能勾別的分團');
  assert.equal(call(W, 'renewSave', { entries: [{ type: '童軍', id: k1, renew: '是' }, { type: '童軍', id: k2, renew: '否' }] }).changed, 2);
  assert.deepEqual(env.rows('年度登記').map((r) => [r[0], r[1], r[2], r[3], r[4]]).sort(), [[2027, '童軍', k1, '小狼', '是'], [2027, '童軍', k2, '小狼', '否']].sort());
  assert.equal(call(W, 'regisList').code, 'FORBIDDEN', '分團團長看不到三項登記（有最高管理員時）');
  assert.equal(call(S, 'renewSave', { entries: [{ type: '童軍', id: s1, renew: '是' }] }).changed, 1);
});

test('三項登記：總團設定登記費、勾已登記已繳、應繳自動帶入；不續團的不列入匯出', () => {
  const { env, call, W, O, k1, k2 } = world();
  call(W, 'renewSave', { entries: [{ type: '童軍', id: k1, renew: '是' }, { type: '童軍', id: k2, renew: '否' }] });
  assert.equal(call(O, 'regisFeesSave', { year: 2027, scout: 300, staff: 400, troop: 1000, note: '依縣市公告' }).ok, true);
  let d = call(O, 'regisList', { year: 2027 });
  assert.deepEqual(d.fees, { scout: 300, staff: 400, troop: 1000, note: '依縣市公告' });
  const kid = d.people.find((p) => p.id === k1);
  assert.deepEqual([kid.renew, kid.amount, kid.registered, kid.paid], ['是', 300, false, false]);
  assert.ok(d.people.some((p) => p.type === '團' && p.id === '小狼' && p.amount === 1000), '分團的團登記');
  assert.ok(d.people.some((p) => p.type === '服務員' && p.amount === 400));
  assert.equal(call(O, 'regisSave', { year: 2027, entries: [{ type: '童軍', id: k1, section: '小狼', registered: true, paid: true }, { type: '團', id: '小狼', section: '小狼', registered: true, amount: 1200 }] }).changed, 2);
  d = call(O, 'regisList', { year: 2027 });
  assert.deepEqual([d.people.find((p) => p.id === k1).registered, d.people.find((p) => p.id === k1).paid], [true, true]);
  assert.equal(d.people.find((p) => p.type === '團' && p.id === '小狼').amount, 1200, '可以改單一列的應繳金額');
  // 已登記的不能被分團團長改成不續團
  assert.match(call(W, 'renewSave', { year: 2027, entries: [{ type: '童軍', id: k1, renew: '否' }] }).message, /已經登記/);
  const csv = call(O, 'regisExport', { year: 2027 });
  assert.match(csv.filename, /三項登記_2027/);
  assert.match(csv.csv, /^姓名,分團,身分,續團,是否已登記,應繳,已繳/);
  assert.match(csv.csv, /測試小狼甲,幼童軍,童軍,是,是,300,是/);
  assert.doesNotMatch(csv.csv, /測試小狼乙/, '不續團的不列');
  assert.match(call(O, 'regisFeesSave', { year: 2027, scout: -1, staff: 0, troop: 0 }).message, /0～100000/);
  assert.match(call(O, 'regisList', { year: 1999 }).message, /年度/);
  assert.ok(!JSON.stringify(env.rows('年度登記')).match(/身分證|生日|電話/));
});

test('完全刪除團員時，年度登記與升團紀錄一起刪', () => {
  const { env, call, W, O, k1 } = world();
  call(W, 'renewSave', { entries: [{ type: '童軍', id: k1, renew: '是' }] });
  call(W, 'cubLeave', { cubId: k1, leftDate: '2026-11-01', leaveReason: '不續團' });
  const r = call(O, 'privacyExecute', { cubId: k1, mode: 'delete', confirmName: '測試小狼甲' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!env.rows('年度登記').some((x) => x[2] === k1));
});

test('LINE 推播額度（附錄第 73 點㉑）：總團、最高管理員在後台首頁看到本月已推播則數，接近上限提醒', () => {
  const { env, call, W, O } = world();
  env.props.LINE_MESSAGING_TOKEN = 'dummy';
  env.net.handler = (url) => (/quota\/consumption/.test(url) ? { body: { totalUsage: 170 } } : /message\/quota$/.test(url) ? { body: { type: 'limited', value: 200 } } : null);
  const q = call(O, 'adminHome').alerts.lineQuota;
  assert.deepEqual([q.used, q.limit, q.near], [170, 200, true]);
  assert.equal(call(W, 'adminHome').alerts.lineQuota, null, '分團團長不顯示（有最高管理員時）');
  // 一小時內不重複查詢
  const n = env.sent.filter((s) => /quota/.test(s.url)).length;
  call(O, 'adminHome');
  assert.equal(env.sent.filter((s) => /quota/.test(s.url)).length, n);
  // 沒有 token 或查詢失敗：不顯示、不出錯
  const env2 = world().env;
  assert.equal(env2.api({ action: 'adminHome', token: env2.api({ action: 'login', username: 'leader01', password: 'leaderpass1' }).token }).ok, true);
});
