// 家長回報（進程、繳費）、未繳名單、報名名單帶進點名、集會預排項目（SPEC 附錄第 83 點）。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./gas-mock.js');

function world() {
  const env = loadGas(); // 模擬時間 2026-11-14 10:00
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const help = call(O, 'inviteCreate', { section: '小狼', role: '服務員', name: '小狼服務員' });
  const A = env.api({ action: 'register', code: help.code, childName: '', username: 'helper01', password: 'helperpass1', nickname: '小狼服務員' }).token;
  call(L, 'squadSave', { type: 'add', name: '一小隊' });
  const v = env.api({ action: 'consentText' }).version;
  const kid = (name, u) => {
    const k = call(L, 'cubSave', { name, squad: '一小隊', joinDate: '2025-01-01' });
    const P = env.api({ action: 'register', code: k.code, childName: name, username: u, password: u + 'pass12', nickname: name + '媽媽', consentVersion: v }).token;
    return { id: k.cubId, P };
  };
  const a = kid('測試小狼甲', 'mom01'), b = kid('測試小狼乙', 'mom02');
  const items = (unit) => env.rows('項目總表').filter((x) => x[2] === unit && !x[7]).map((x) => x[0]);
  return { env, call, L, O, A, a, b, items };
}

test('家長回報進程：待確認不算完成；服務員確認後才算；可以取消、退回', () => {
  const { env, call, L, O, A, a, b, items } = world();
  const ids = items('剛入團');
  const view = () => call(a.P, 'cubDetail', { cubId: a.id });
  const unit = () => view().units.find((u) => u.unit === '剛入團');
  assert.equal(view().canReport, true);
  assert.ok(unit().items.every((i) => i.id && !i.pending), '還沒完成的項目帶項目ID');
  // 只能回報自己的孩子、存在的項目
  assert.equal(call(b.P, 'itemReport', { cubId: a.id, itemIds: [ids[0]] }).code, 'NOT_FOUND');
  assert.equal(call(a.P, 'itemReport', { cubId: a.id, itemIds: ['P-不存在-1'] }).code, 'BAD_INPUT');
  assert.equal(call(a.P, 'itemReport', { cubId: a.id, itemIds: [] }).code, 'BAD_INPUT');
  const r = call(a.P, 'itemReport', { cubId: a.id, itemIds: [ids[0], ids[1], ids[0]], note: '在家背給爸爸聽' });
  assert.equal(r.added, 2, JSON.stringify(r));
  assert.equal(call(a.P, 'itemReport', { cubId: a.id, itemIds: [ids[0]] }).added, 0, '重複回報不會多一筆');
  const row = env.rows('完成紀錄').find((x) => x[1] === ids[0]);
  assert.deepEqual([row[0], row[3], row[4], row[6]], [a.id, '', '在家背給爸爸聽', '待確認']);
  let u = unit();
  assert.equal(u.done, 0, '待確認不算完成');
  assert.deepEqual(u.items.filter((i) => i.pending).length, 2);
  // 家長取消一筆
  assert.equal(call(b.P, 'itemReportCancel', { cubId: a.id, itemId: ids[1] }).code, 'NOT_FOUND');
  assert.equal(call(a.P, 'itemReportCancel', { cubId: a.id, itemId: ids[1] }).removed, 1);
  // 後台：首頁提醒、清單（服務員也能確認）
  assert.equal(call(L, 'adminHome').alerts.pendingReports, 1);
  const list = call(A, 'reportList');
  assert.equal(list.reports.length, 1);
  assert.deepEqual([list.reports[0].name, list.reports[0].itemId, list.reports[0].note, list.reports[0].by], ['測試小狼甲', ids[0], '在家背給爸爸聽', '測試小狼甲媽媽']);
  assert.equal(JSON.stringify(list).includes(env.rows('帳號').find((x) => x[1] === 'mom01')[0]), false, '不回傳家長的帳號ID');
  assert.equal(call(a.P, 'reportList').code, 'FORBIDDEN');
  // 確認 → 算完成，簽核人是確認的人
  assert.equal(call(A, 'reportReview', { entries: [{ cubId: a.id, itemId: ids[0] }] }).changed, 1);
  const done = env.rows('完成紀錄').find((x) => x[1] === ids[0]);
  assert.equal(done[6], '已確認');
  assert.equal(done[4], '家長回報：在家背給爸爸聽');
  assert.equal(done[3], env.rows('帳號').find((x) => x[1] === 'helper01')[0]);
  u = unit();
  assert.equal(u.done, 1);
  assert.equal(u.items.find((i) => i.done).signer, '小狼服務員');
  assert.equal(call(A, 'reportReview', { entries: [{ cubId: a.id, itemId: ids[0] }] }).code, 'NOT_FOUND', '已經處理過');
  // 退回 → 那一筆待確認不見，家長可以再回報
  call(a.P, 'itemReport', { cubId: a.id, itemIds: [ids[2]] });
  assert.equal(call(L, 'reportReview', { entries: [{ cubId: a.id, itemId: ids[2] }], ok: false }).changed, 1);
  assert.equal(env.rows('完成紀錄').some((x) => x[1] === ids[2]), false);
  assert.equal(unit().items.some((i) => i.pending), false);
  // 回報後服務員直接簽核：待確認那筆不再出現在清單
  call(a.P, 'itemReport', { cubId: a.id, itemIds: [ids[3]] });
  call(A, 'signoff', { cubIds: [a.id], itemIds: [ids[3]], date: '2026-11-14' });
  assert.equal(call(A, 'reportList').reports.length, 0);
  assert.equal(unit().items.some((i) => i.pending), false);
  // 關掉設定就不能回報
  assert.equal(call(O, 'settingsSave', { changes: { 開放家長回報進程: '否' } }).ok, true, '全團設定由總團或最高管理員改');
  assert.equal(view().canReport, false);
  assert.equal(call(a.P, 'itemReport', { cubId: a.id, itemIds: [ids[4]] }).code, 'FORBIDDEN');
});

test('家長回報已繳費：團長名單看得到，勾已繳才算；已繳的不能再回報', () => {
  const { env, call, L, a, b } = world();
  const id = call(L, 'eventSave', { title: '冬季露營', date: '2026-12-12', endDate: '2026-12-13', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 500, questions: [] }).id;
  call(a.P, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '小狼', answers: {} }, { name: '測試媽媽', identity: '家長', answers: {} }] });
  const mine = () => call(a.P, 'eventList').events[0].mine;
  const regIds = mine().map((m) => m.regId);
  assert.equal(call(b.P, 'eventPayReport', { regIds }).code, 'NOT_FOUND', '不能回報別人的報名');
  assert.match(call(a.P, 'eventPayReport', { regIds, note: '帳號 12345678' }).message, /不要寫帳號/);
  assert.equal(call(a.P, 'eventPayReport', { regIds, note: '11/20 轉帳' }).changed, 2);
  assert.deepEqual(mine().map((m) => [m.reported, m.reportNote, m.paid]), [[true, '11/20 轉帳', false], [true, '11/20 轉帳', false]]);
  const regs = call(L, 'eventRegs', { eventId: id }).regs;
  assert.deepEqual(regs.map((x) => [x.name, x.reported, x.reportNote]), [['測試小狼甲', true, '11/20 轉帳'], ['測試媽媽', true, '11/20 轉帳']]);
  // 取消回報
  assert.equal(call(a.P, 'eventPayReport', { regIds: [regIds[1]], cancel: true }).changed, 1);
  assert.equal(mine()[1].reported, false);
  // 團長勾已繳後，不能再回報
  call(L, 'eventPay', { updates: [{ regId: regIds[0], amount: 500, paid: true }] });
  assert.equal(call(a.P, 'eventPayReport', { regIds: [regIds[0]] }).code, 'BAD_INPUT');
  assert.deepEqual(env.rows('活動報名')[0].slice(7, 8), ['是']);
});

test('報名名單帶進點名：活動當天的集會標出有報名的團員', () => {
  const { call, L, a, b } = world();
  const id = call(L, 'eventSave', { title: '冬季露營', date: '2026-12-12', endDate: '2026-12-13', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 0, questions: [] }).id;
  call(a.P, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '小狼', answers: {} }] });
  call(L, 'meetingSave', { lines: '2026-12-12 冬季露營（大活動）\n2026-11-28 團集會' });
  const ms = call(L, 'meetingList').meetings;
  const camp = call(L, 'attendanceSheet', { meetingId: ms.find((m) => m.date === '2026-12-12').meetingId });
  assert.deepEqual(camp.event, { title: '冬季露營', count: 1 });
  assert.deepEqual(camp.cubs.map((c) => [c.cubId, c.registered]).sort(), [[a.id, true], [b.id, false]].sort());
  const normal = call(L, 'attendanceSheet', { meetingId: ms.find((m) => m.date === '2026-11-28').meetingId });
  assert.equal(normal.event, null);
  assert.ok(normal.cubs.every((c) => c.registered === false));
});

test('集會預排項目：簽核時帶出、家長看得到這次要做什麼；只換掉自己分團的部分', () => {
  const { env, call, L, A, a, items } = world();
  call(L, 'meetingSave', { lines: '2026-11-14 團集會\n2026-11-28 團集會' });
  const ms = call(L, 'meetingList').meetings;
  const today = ms.find((m) => m.date === '2026-11-14'), next = ms.find((m) => m.date === '2026-11-28');
  const wolf = items('狼').slice(0, 3);
  assert.equal(call(a.P, 'meetingPlanSave', { meetingId: today.meetingId, itemIds: wolf }).code, 'FORBIDDEN');
  assert.equal(call(A, 'meetingPlanSave', { meetingId: today.meetingId, itemIds: ['稚齡-P-地球-1'] }).code, 'BAD_INPUT', '別的分團的項目不能排');
  assert.equal(call(A, 'meetingPlanSave', { meetingId: today.meetingId, itemIds: wolf.concat(wolf[0]) }).count, 3);
  assert.equal(call(A, 'meetingPlanSave', { meetingId: next.meetingId, itemIds: wolf.slice(0, 1) }).count, 1);
  assert.deepEqual(call(L, 'meetingList').meetings.find((m) => m.meetingId === today.meetingId).plan, wolf);
  assert.equal(env.rows('集會行事曆').find((x) => x[0] === today.meetingId)[10], JSON.stringify(wolf));
  // 簽核：今天的集會預排
  const sd = call(A, 'signoffData');
  assert.deepEqual([sd.plan.meetingId, sd.plan.itemIds], [today.meetingId, wolf]);
  // 家長：接下來的集會看得到項目文字
  const up = call(a.P, 'cubDetail', { cubId: a.id }).attendance.upcoming;
  const text = env.rows('項目總表').find((x) => x[0] === wolf[0])[4];
  assert.deepEqual(up.find((m) => m.date === '2026-11-28').plan, [text]);
  assert.equal(up.find((m) => m.date === '2026-11-14').plan.length, 3);
  // 清空
  assert.equal(call(L, 'meetingPlanSave', { meetingId: today.meetingId, itemIds: [] }).count, 0);
  assert.equal(env.rows('集會行事曆').find((x) => x[0] === today.meetingId)[10], '');
  assert.equal(call(A, 'signoffData').plan, null);
});

test('舊版試算表（沒有新欄位）照舊可用', () => {
  const { env, call, L, a } = world();
  call(L, 'meetingSave', { lines: '2026-11-28 團集會' });
  for (const [name, w] of [['集會行事曆', 10], ['活動報名', 12]]) { const sh = env.sheet(name); sh.data = sh.data.map((r) => r.slice(0, w)); }
  env.ctx.clearAllCaches_();
  assert.deepEqual(call(L, 'meetingList').meetings[0].plan, []);
  assert.equal(call(a.P, 'cubDetail', { cubId: a.id }).attendance.upcoming[0].plan.length, 0);
});
