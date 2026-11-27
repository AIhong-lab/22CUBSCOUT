// 升團與離開原因（SPEC 附錄第 69、80 點）：同一筆團員改到下一個分團，紀錄跟著人走。測試資料一律虛構。
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
  const lead = (sec, u) => { const inv = call(O, 'inviteCreate', { section: sec, role: '團長', title: '團長', name: sec + '團長' }); return env.api({ action: 'register', code: inv.code, childName: '', username: u, password: u + 'pass1', nickname: sec + '團長' }).token; };
  const S = lead('童軍', 'scoutlead'), V = lead('行義', 'ventlead');
  const help = call(O, 'inviteCreate', { section: '小狼', role: '服務員', name: '小狼服務員' });
  const A = env.api({ action: 'register', code: help.code, childName: '', username: 'helper01', password: 'helperpass1', nickname: '小狼服務員' }).token;
  call(W, 'squadSave', { type: 'add', name: '一小隊' });
  return { env, call, W, O, S, V, A };
}
const row = (env, id) => env.rows('小狼名單').find((r) => r[0] === id);

test('升團：小狼→童軍，同一筆資料改分團；舊的頒章、家長綁定跟著走；寫升團紀錄', () => {
  const { env, call, W, S, A } = world();
  const kid = call(W, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2023-01-01' });
  const v = env.api({ action: 'consentText' }).version;
  const P = env.api({ action: 'register', code: kid.code, childName: '測試小狼甲', username: 'mom01', password: 'mompass12', nickname: '家長', consentVersion: v }).token;
  call(W, 'backfill', { cubId: kid.cubId, unit: '豹', date: '2026-01-01', includeLower: true });
  assert.equal(call(W, 'cubRoleSave', { cubId: kid.cubId, role: '小隊長' }).ok, true);
  assert.equal(call(A, 'cubPromote', { cubId: kid.cubId, date: '2026-05-10' }).code, 'FORBIDDEN', '服務員不能升團');
  assert.equal(call(S, 'cubPromote', { cubId: kid.cubId, date: '2026-05-10' }).code, 'NOT_FOUND', '新分團的團長不能把人拉過去');
  const r = call(W, 'cubPromote', { cubId: kid.cubId, date: '2026-05-10' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.toSection, '童軍');
  const x = row(env, kid.cubId);
  assert.deepEqual([x[11], x[2], x[3], x[4], x[7], x[10]], ['童軍', '', '2026-05-10', '', '在團', ''], '分團、小隊清空、入團日＝升團日、童軍還沒有級別、職務卸任');
  const pr = env.rows('升團紀錄')[0];
  assert.deepEqual(pr.slice(0, 7), [kid.cubId, '小狼', '童軍', '2026-05-10', '2023-01-01', '一小隊', '小隊長']);
  assert.equal(call(W, 'cubAdminDetail', { cubId: kid.cubId }).code, 'NOT_FOUND', '小狼名單裡就不見了');
  const d = call(S, 'cubAdminDetail', { cubId: kid.cubId });
  assert.equal(d.cub.section, '童軍');
  assert.deepEqual(d.history.awards.map((a) => [a.section, a.unit]).slice(-2), [['小狼', '鹿'], ['小狼', '豹']], '新分團團長看得到舊分團的章');
  assert.deepEqual(d.history.promotions.map((p) => [p.from, p.to, p.date]), [['小狼', '童軍', '2026-05-10']]);
  assert.ok(d.units.some((u) => u.unit === '初級'), '開始挑戰童軍初級');
  // 家長照樣看得到，畫面變成童軍
  const pd = call(P, 'cubDetail', { cubId: kid.cubId });
  assert.equal(pd.cub.section, '童軍');
  assert.ok(pd.history.awards.some((a) => a.unit === '豹'));
  assert.ok(env.rows('操作日誌').some((l) => l[2] === '升團'));
});

test('升團：童軍→行義進程接續（共用一套）；羅浮不能再升；不在團的不能升', () => {
  const { env, call, S, V } = world();
  const kid = call(S, 'cubSave', { name: '測試童軍甲', joinDate: '2024-01-01' });
  call(S, 'backfill', { cubId: kid.cubId, unit: '高級', date: '2026-01-01', includeLower: true });
  assert.equal(call(S, 'cubPromote', { cubId: kid.cubId, date: '2026-05-10' }).toSection, '行義');
  assert.equal(row(env, kid.cubId)[4], '高級', '行義繼續看童軍的級別');
  const d = call(V, 'cubAdminDetail', { cubId: kid.cubId });
  assert.equal(d.cub.currentLevel, '高級');
  assert.equal(d.units.find((u) => u.unit === '高級').status, '已頒發');
  const left = call(V, 'cubSave', { name: '測試行義乙', joinDate: '2024-01-01' });
  call(V, 'cubLeave', { cubId: left.cubId, leftDate: '2026-02-01', leaveReason: '不續團' });
  assert.match(call(V, 'cubPromote', { cubId: left.cubId, date: '2026-05-10' }).message, /在團/);
});

test('羅浮是最後一個分團，不能再升團', () => {
  const { env, call, O } = world();
  const inv = call(O, 'inviteCreate', { section: '羅浮', role: '團長', title: '群長', name: '群長' });
  const R = env.api({ action: 'register', code: inv.code, childName: '', username: 'roverlead', password: 'roverpass1', nickname: '群長' }).token;
  const kid = call(R, 'cubSave', { name: '測試羅浮甲', joinDate: '2024-01-01' });
  assert.match(call(R, 'cubPromote', { cubId: kid.cubId, date: '2026-05-10' }).message, /最後一個分團/);
});

test('離團記離開原因（不續團／退團／其他）；寫在名單最右邊的新欄', () => {
  const { env, call, W } = world();
  const kid = call(W, 'cubSave', { name: '測試小狼乙', squad: '一小隊', joinDate: '2024-01-01' });
  assert.match(call(W, 'cubLeave', { cubId: kid.cubId, leftDate: '2026-02-01', leaveReason: '亂寫' }).message, /離開原因/);
  assert.equal(call(W, 'cubLeave', { cubId: kid.cubId, leftDate: '2026-02-01', leaveReason: '退團' }).ok, true);
  assert.deepEqual(row(env, kid.cubId).slice(7, 9).concat(row(env, kid.cubId)[12]), ['離團', '2026-02-01', '退團']);
  assert.equal(call(W, 'cubAdminDetail', { cubId: kid.cubId }).cub.leaveReason, '退團');
  // 沒填原因照舊可以（舊網頁），原因空白
  const k2 = call(W, 'cubSave', { name: '測試小狼丙', squad: '一小隊', joinDate: '2024-01-01' });
  assert.equal(call(W, 'cubLeave', { cubId: k2.cubId, leftDate: '2026-02-01' }).ok, true);
});
