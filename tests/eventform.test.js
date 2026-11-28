// 活動報名表設計（SPEC 附錄第 81 點）：複選題、選項另加費用、不同身分不同費用、人數上限與候補。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Logic = require('../gas/Logic.js');
const { loadGas } = require('./gas-mock.js');

function world() {
  const env = loadGas(); // 模擬時間 2026-11-14 10:00
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  call(L, 'squadSave', { type: 'add', name: '一小隊' });
  const v = env.api({ action: 'consentText' }).version;
  const parent = (name, u) => {
    const kid = call(L, 'cubSave', { name, squad: '一小隊', joinDate: '2025-01-01' });
    return env.api({ action: 'register', code: kid.code, childName: name, username: u, password: u + 'pass12', nickname: '家長', consentVersion: v }).token;
  };
  return { env, call, L, P1: parent('測試小狼甲', 'mom01'), P2: parent('測試小狼乙', 'dad02') };
}

const base = {
  title: '冬季露營', desc: '兩天一夜', date: '2026-12-12', endDate: '2026-12-13', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 1000,
  identityFees: { 家長: 600, 服務員: '0', 小狼: '' }, capacity: 3,
  questions: [
    { label: '參加哪幾天', type: 'multi', options: ['週六', '週日'], required: true },
    { label: '帳篷', type: 'choice', options: ['自備', '租帳篷'], fees: [0, 200], required: true },
    { label: '加購', type: 'multi', options: ['團服', '領巾'], fees: [350, 80] },
  ],
};

test('Logic：檢查活動設定（身分費用、人數上限、複選與選項金額）', () => {
  const v = Logic.validateEvent(base);
  assert.equal(v.ok, true, v.error);
  assert.deepEqual(v.event.identityFees, { 家長: 600, 服務員: 0 }, '空白＝同每人費用，不存');
  assert.equal(v.event.capacity, 3);
  assert.equal(v.event.questions[0].type, 'multi');
  assert.equal(v.event.questions[0].fees, undefined, '沒有另加金額就不存 fees');
  assert.deepEqual(v.event.questions[1].fees, [0, 200]);
  assert.match(Logic.validateEvent({ ...base, capacity: -1 }).error, /人數上限/);
  assert.match(Logic.validateEvent({ ...base, capacity: 2.5 }).error, /人數上限/);
  assert.match(Logic.validateEvent({ ...base, identityFees: { 家長: 'abc' } }).error, /「家長」的費用/);
  assert.match(Logic.validateEvent({ ...base, questions: [{ label: '加購', type: 'choice', options: ['a', 'b'], fees: [-5, 0] }] }).error, /另加的金額/);
  assert.match(Logic.validateEvent({ ...base, questions: [{ label: '天數', type: 'multi', options: ['週六、週日', '週日'] }] }).error, /不能有「、」/);
  assert.match(Logic.validateEvent({ ...base, questions: [{ label: '天數', type: 'multi', options: ['週六'] }] }).error, /複選題要有 2～10 個選項/);
  assert.equal(Logic.validateEvent({ ...base, capacity: '' }).event.capacity, 0, '空白＝不限');
  // 金額：身分別費用＋選項另加；複選每個都加
  const ev = v.event;
  const amt = (identity, answers) => Logic.eventAmount(ev, { identity, answers });
  assert.equal(amt('小狼', { q2: '租帳篷' }), 1000 + 200);
  assert.equal(amt('家長', { q2: '自備', q3: '團服、領巾' }), 600 + 350 + 80);
  assert.equal(amt('服務員', {}), 0);
  // 名額
  assert.equal(Logic.eventSeats(0, 50, 3), 3, '不限');
  assert.equal(Logic.eventSeats(3, 1, 3), 2);
  assert.equal(Logic.eventSeats(3, 3, 2), 0);
  assert.equal(Logic.eventSeats(3, 5, 1), 0, '轉正取後超額也不會變負的');
  // 複選答案
  const qs = v.event.questions;
  assert.deepEqual(Logic.validateEventPeople([{ name: '甲', identity: '小狼', answers: { [qs[0].id]: ['週日', '週六'], [qs[1].id]: '自備' } }], qs).people[0].answers[qs[0].id], '週六、週日', '依選項順序');
  assert.match(Logic.validateEventPeople([{ name: '甲', identity: '小狼', answers: { [qs[0].id]: ['週一'], [qs[1].id]: '自備' } }], qs).error, /請從選項中選擇/);
  assert.match(Logic.validateEventPeople([{ name: '甲', identity: '小狼', answers: { [qs[0].id]: [], [qs[1].id]: '自備' } }], qs).error, /請回答「參加哪幾天」/);
});

test('報名：自動算應繳金額；額滿後排候補；團長轉正取；候補不算報名人數', () => {
  const { env, call, L, P1, P2 } = world();
  const saved = call(L, 'eventSave', base);
  assert.ok(saved.id, JSON.stringify(saved));
  const id = saved.id;
  assert.equal(env.api({ action: 'siteInfo' }).events[0].left, 3, '先讀一次，公開資料進快取');
  const ev = call(P1, 'eventList').events[0];
  assert.equal(ev.capacity, 3);
  assert.equal(ev.left, 3);
  assert.deepEqual(ev.identityFees, { 家長: 600, 服務員: 0 });
  const [qd, qt, qb] = ev.questions.map((q) => q.id);
  // 家長一次報 2 位：小狼租帳篷＋加購團服、家長自備
  const r1 = call(P1, 'eventRegister', { eventId: id, people: [
    { name: '測試小狼甲', identity: '小狼', answers: { [qd]: ['週六', '週日'], [qt]: '租帳篷', [qb]: ['團服'] } },
    { name: '測試媽媽', identity: '家長', answers: { [qd]: ['週六'], [qt]: '自備' } },
  ] });
  assert.deepEqual([r1.added, r1.waitlisted], [2, 0], JSON.stringify(r1));
  // 另一位家長報 2 位，只剩 1 個名額 → 1 正取、1 候補
  const r2 = call(P2, 'eventRegister', { eventId: id, people: [
    { name: '測試小狼乙', identity: '小狼', answers: { [qd]: ['週日'], [qt]: '自備' } },
    { name: '測試爸爸', identity: '家長', answers: { [qd]: ['週日'], [qt]: '租帳篷' } },
  ] });
  assert.deepEqual([r2.added, r2.waitlisted], [1, 1]);
  const rows = env.rows('活動報名');
  const byName = (n) => rows.find((x) => x[3] === n);
  assert.deepEqual([byName('測試小狼甲')[6], byName('測試媽媽')[6], byName('測試小狼乙')[6], byName('測試爸爸')[6]], [1550, 600, 1000, 800], '應繳金額');
  assert.equal(byName('測試小狼甲')[5], JSON.stringify({ [qd]: '週六、週日', [qt]: '租帳篷', [qb]: '團服' }));
  assert.deepEqual(rows.map((x) => x[9]), ['有效', '有效', '有效', '候補']);
  assert.equal(call(P2, 'eventList').events[0].left, 0);
  // 公開首頁的剩餘名額跟著更新（報名不是後台動作，也要清公開快取）
  assert.equal(env.api({ action: 'siteInfo' }).events[0].left, 0);
  assert.equal(call(P2, 'eventList').events[0].mine.find((m) => m.name === '測試爸爸').wait, true);
  // 後台：報名 3 位、候補 1 位
  const list = call(L, 'eventAdminList').events[0];
  assert.deepEqual([list.count, list.waitCount], [3, 1]);
  const regs = call(L, 'eventRegs', { eventId: id }).regs;
  const w = regs.find((x) => x.wait);
  assert.equal(w.name, '測試爸爸');
  // 有人取消 → 名額空出來，但候補不會自動轉正
  const momReg = call(P1, 'eventList').events[0].mine.find((m) => m.name === '測試媽媽');
  assert.equal(call(P1, 'eventCancel', { regId: momReg.regId }).ok, true);
  assert.equal(call(P1, 'eventList').events[0].left, 1);
  assert.equal(env.rows('活動報名').find((x) => x[3] === '測試爸爸')[9], '候補');
  // 團長轉正取（家長不能自己轉）
  assert.equal(call(P2, 'eventRegPromote', { regId: w.regId }).ok, false);
  const pr = call(L, 'eventRegPromote', { regId: w.regId });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  assert.equal(pr.taken, 3);
  assert.equal(env.rows('活動報名').find((x) => x[3] === '測試爸爸')[9], '有效');
  assert.equal(call(L, 'eventRegPromote', { regId: w.regId }).code, 'NOT_FOUND', '已經是正取');
  assert.ok(env.rows('操作日誌').some((x) => x[2] === '候補轉正取'));
  // 改活動：人數上限、身分費用寫在最右邊兩欄
  assert.equal(call(L, 'eventSave', { ...base, id, capacity: 10, identityFees: {} }).ok, true);
  const er = env.rows('活動').find((x) => x[0] === id);
  assert.deepEqual([er[15], er[16]], [10, '{}']);
  assert.equal(call(P1, 'eventList').events[0].left, 7);
});

test('沒有設人數上限、身分費用、選項金額的舊活動照舊：每人費用、全部正取', () => {
  const { env, call, L, P1 } = world();
  const id = call(L, 'eventSave', { ...base, identityFees: undefined, capacity: undefined, questions: [{ label: '飲食', type: 'choice', options: ['葷', '素'] }] }).id;
  const ev = call(P1, 'eventList').events[0];
  assert.equal(ev.capacity, 0);
  assert.equal(ev.left, undefined, '不限名額就不顯示剩幾位');
  const r = call(P1, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '家長', answers: { [ev.questions[0].id]: '葷' } }] });
  assert.deepEqual([r.added, r.waitlisted], [1, 0]);
  assert.equal(env.rows('活動報名')[0][6], 1000);
  // 舊版試算表沒有最右邊兩欄也能讀
  const sh = env.sheet('活動');
  sh.data = sh.data.map((row) => row.slice(0, 15));
  env.ctx.clearAllCaches_();
  assert.equal(call(P1, 'eventList').events[0].capacity, 0);
});
