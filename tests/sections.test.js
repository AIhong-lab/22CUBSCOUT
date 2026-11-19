// 全團上線第 1 期（SPEC 附錄第 73 點）：各分團的名單、小隊、申請、權限。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./gas-mock.js');

/** 小狼團長＋管理員（admin）＋童軍團長（由 admin 指定） */
function world() {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const inv = call(O, 'inviteCreate', { section: '童軍', role: '團長', title: '團長', name: '童軍團長' });
  const ST = env.api({ action: 'register', code: inv.code, childName: '', username: 'scoutlead2', password: 'scoutpass1', nickname: '童軍團長' }).token;
  call(L, 'squadSave', { type: 'add', name: '一小隊' });
  return { env, call, L, O, S: ST };
}
const v = (env) => env.api({ action: 'consentText' }).version;

test('各分團名單與小隊分開：同名小隊可以並存、團員寫入分團欄、別的分團看不到也改不到', () => {
  const { env, call, L, S } = world();
  assert.equal(call(S, 'me').section, '童軍');
  assert.equal(call(S, 'me').role, '團長');
  assert.equal(call(S, 'squadSave', { type: 'add', name: '一小隊' }).ok, true, '童軍也可以有「一小隊」');
  assert.equal(call(S, 'squadSave', { type: 'add', name: '老鷹小隊' }).ok, true);
  assert.deepEqual(call(S, 'squadList').squads.map((x) => x.name), ['一小隊', '老鷹小隊']);
  assert.deepEqual(call(L, 'squadList').squads.map((x) => x.name), ['一小隊'], '小狼的小隊清單不受影響');
  assert.ok(env.rows('設定').some((r) => r[0] === '小隊清單（童軍）' && r[1] === '一小隊、老鷹小隊'));
  assert.match(call(L, 'cubSave', { name: '測試甲', squad: '老鷹小隊', joinDate: '2025-01-01' }).message, /不在小隊清單/, '小狼不能用童軍的小隊');
  const scout = call(S, 'cubSave', { name: '測試童軍甲', squad: '老鷹小隊', joinDate: '2025-01-01' });
  assert.equal(scout.ok, true);
  const wolf = call(L, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' });
  const row = env.rows('小狼名單').find((x) => x[0] === scout.cubId);
  assert.equal(row[11], '童軍', '分團欄寫入目前分團');
  assert.deepEqual(call(S, 'cubList').cubs.map((c) => c.name), ['測試童軍甲']);
  assert.deepEqual(call(L, 'cubList').cubs.map((c) => c.name), ['測試小狼甲']);
  assert.equal(call(S, 'cubSave', { cubId: wolf.cubId, name: '改名', squad: '', joinDate: '2025-01-01' }).code, 'NOT_FOUND', '改不到別的分團');
  assert.equal(call(S, 'cubLeave', { cubId: wolf.cubId, leftDate: '2026-01-01' }).code, 'NOT_FOUND');
  assert.equal(call(L, 'cubAdminDetail', { cubId: scout.cubId }).code, 'NOT_FOUND');
  // 童軍的團員頁：沒有進程（第 2 期），但可以看基本資料
  const d = call(S, 'cubAdminDetail', { cubId: scout.cubId });
  assert.equal(d.hasProgress, false);
  assert.deepEqual(d.units, []);
  // 童軍沒有級別限制，可以直接當小隊長
  assert.equal(call(S, 'cubRoleSave', { cubId: scout.cubId, role: '小隊長' }).ok, true);
  // 進程功能在童軍準備中
  assert.match(call(S, 'signoffData').message, /童軍的進程功能準備中/);
  assert.match(call(S, 'itemsTree').message, /準備中/);
  // 批次匯入寫到目前分團
  assert.equal(call(S, 'cubImport', { lines: '測試童軍乙 一小隊 2025-02-01' }).added, 1);
  assert.equal(env.rows('小狼名單').find((x) => x[1] === '測試童軍乙')[11], '童軍');
});

test('小隊輔各分團分開：只能選該分團的管理員；改名只動自己分團', () => {
  const { env, call, L, O, S } = world();
  call(S, 'squadSave', { type: 'add', name: '一小隊' });
  const accs = call(O, 'accountList').accounts;
  const scoutLead = accs.find((a) => a.username === 'scoutlead2').accountId;
  const wolfLead = accs.find((a) => a.username === 'leader01').accountId;
  assert.equal(call(S, 'squadStaffSave', { squad: '一小隊', accountIds: [wolfLead] }).code, 'BAD_INPUT', '小狼團長不是童軍的管理員');
  assert.equal(call(S, 'squadStaffSave', { squad: '一小隊', accountIds: [scoutLead] }).ok, true);
  assert.equal(call(L, 'squadStaffSave', { squad: '一小隊', accountIds: [wolfLead] }).ok, true);
  assert.deepEqual(call(S, 'squadList').squads[0].staff.map((x) => x.name), ['童軍團長']);
  assert.deepEqual(call(L, 'squadList').squads[0].staff.map((x) => x.name), ['團長']);
  assert.deepEqual(call(S, 'me').mySquads, ['一小隊']);
  call(S, 'squadSave', { type: 'rename', name: '一小隊', newName: '飛鷹小隊' });
  assert.deepEqual(env.rows('小隊輔').map((r) => [r[0], r[4]]).sort(), [['一小隊', '小狼'], ['飛鷹小隊', '童軍']]);
});

test('體驗者入團次數各分團設定；設定頁依權限分組', () => {
  const { env, call, L, O, S } = world();
  const t = call(S, 'cubSave', { name: '測試體驗', trial: true, trialStart: '2026-10-01' });
  const groups = (tk) => [...new Set(call(tk, 'settingsGet').settings.map((x) => x.group))].sort();
  assert.deepEqual(groups(S), ['分團'], '分團團長只看到自己分團的設定');
  assert.deepEqual(groups(O), ['全團', '分團', '權限'].sort());
  assert.deepEqual(groups(L), ['分團'], '有 admin 之後，系統設定預設只有 admin 與總團');
  const keys = call(S, 'settingsGet').settings.map((x) => x.key);
  assert.ok(keys.includes('體驗所需出席次數（童軍）'));
  assert.ok(!keys.includes('晉級間隔月數'), '小狼的進程設定只在小狼');
  assert.ok(call(L, 'settingsGet').settings.some((x) => x.key === '晉級間隔月數'));
  assert.equal(call(S, 'settingsSave', { changes: { '體驗所需出席次數': '2' } }).code, 'FORBIDDEN', '不能改小狼的');
  assert.equal(call(S, 'settingsSave', { changes: { '密碼最短長度': '10' } }).code, 'FORBIDDEN', '不能改全團的');
  assert.equal(call(S, 'settingsSave', { changes: { '體驗所需出席次數（童軍）': '2' } }).ok, true);
  assert.equal(call(S, 'cubAdminDetail', { cubId: t.cubId }).trial.need, 2);
  // admin 把系統設定開放給團長
  assert.equal(call(O, 'settingsSave', { changes: { '共用功能權限：系統設定': '團長' } }).ok, true);
  assert.ok(groups(S).includes('全團'));
  assert.equal(env.ctx.loadSettings_().errors.length, 0, '其他分團的設定沒填不算錯誤');
});

test('帳號申請帶分團：家長替每個孩子選分團或「不確定」；各分團團長只看自己的與未指定的', () => {
  const { env, call, L, O, S } = world();
  const mom = env.api({ action: 'register', identity: '家長', username: 'mom09', password: 'applypass1', nickname: '測試媽媽', consentVersion: v(env), childNames: ['測試哥哥', '測試妹妹', '測試弟弟'], childSections: ['童軍', '不確定', '小狼'] });
  assert.equal(mom.ok, true);
  const staff = env.api({ action: 'register', identity: '服務員', username: 'staff09', password: 'applypass1', nickname: '測試服務員', staffSection: '童軍' });
  assert.deepEqual(env.rows('註冊申請').map((r) => [r[3], r[11]]), [['測試哥哥', '童軍'], ['測試妹妹', '未指定'], ['測試弟弟', '小狼'], ['測試服務員', '童軍']]);
  const names = (tk) => call(tk, 'requestList').items.map((x) => x.name).sort();
  assert.deepEqual(names(L), ['測試妹妹', '測試弟弟'].sort());
  assert.deepEqual(names(S), ['測試哥哥', '測試妹妹', '測試服務員'].sort());
  assert.equal(call(S, 'adminHome').alerts.pendingRequests, 3);
  // 小狼團長把「不確定」的孩子指定到童軍；之後小狼看不到
  const sis = call(L, 'requestList').items.find((x) => x.name === '測試妹妹');
  assert.equal(call(L, 'requestAssign', { requestId: sis.requestId, to: '童軍' }).ok, true);
  assert.deepEqual(names(L), ['測試弟弟']);
  const bro = call(S, 'requestList').items.find((x) => x.name === '測試哥哥');
  assert.equal(call(L, 'requestApprove', { requestId: bro.requestId, name: '測試哥哥', joinDate: '2025-09-01' }).code, 'NOT_FOUND', '不能核准別的分團的申請');
  call(S, 'squadSave', { type: 'add', name: '老鷹小隊' });
  assert.equal(call(S, 'requestApprove', { requestId: bro.requestId, name: '測試哥哥', squad: '老鷹小隊', joinDate: '2025-09-01' }).ok, true);
  const cub = env.rows('小狼名單').find((r) => r[1] === '測試哥哥');
  assert.equal(cub[11], '童軍');
  // 服務員申請：核准後是童軍的服務員
  const st = call(S, 'requestList').items.find((x) => x.type === '服務員');
  assert.equal(call(S, 'requestApprove', { requestId: st.requestId }).ok, true);
  const me = call(staff.token, 'me');
  assert.deepEqual([me.section, me.role], ['童軍', '服務員']);
  // 家長：孩子在童軍 → 家長畫面帶分團、沒有進程（第 2 期）
  const pm = call(mom.token, 'me');
  assert.deepEqual(pm.cubs.map((c) => [c.name, c.section]), [['測試哥哥', '童軍']]);
  const d = call(mom.token, 'cubDetail', { cubId: pm.cubs[0].cubId });
  assert.equal(d.hasProgress, false);
  assert.deepEqual(d.units, []);
  assert.equal(d.cub.section, '童軍');
  // 已登入再加孩子也可以選分團
  assert.equal(call(mom.token, 'requestChildren', { childNames: ['測試小妹'], childSections: ['羅浮'], consentVersion: v(env) }).added, 1);
  assert.equal(env.rows('註冊申請').find((r) => r[3] === '測試小妹')[11], '羅浮');
  // 舊版網頁（沒有送分團）＝小狼
  env.api({ action: 'register', identity: '家長', username: 'dad09', password: 'applypass1', nickname: '測試爸爸', consentVersion: v(env), childNames: ['測試老么'] });
  assert.equal(env.rows('註冊申請').find((r) => r[3] === '測試老么')[11], '');
  assert.ok(names(L).includes('測試老么'));
  // 總覽：admin 看得到各分團人數
  const all = call(O, 'adminHome').allSections;
  assert.equal(all.sections.find((x) => x.section === '童軍').active, 1);
  assert.equal(call(S, 'adminHome').allSections, null, '分團團長看不到全團總覽');
  assert.equal(call(S, 'adminHome').hasProgress, false);
});

test('管理員（admin）與總團在每個分團都是團長，可以切換分團；分團團長管理自己分團的服務員', () => {
  const { env, call, O, S } = world();
  assert.deepEqual(call(O, 'me').sections.map((x) => x.section), ['稚齡', '小狼', '童軍', '行義', '羅浮']);
  assert.equal(call(O, 'me', { _sec: '羅浮' }).section, '羅浮');
  assert.equal(call(O, 'cubSave', { _sec: '羅浮', name: '測試羅浮甲', joinDate: '2025-01-01' }).ok, true);
  assert.equal(env.rows('小狼名單').find((r) => r[1] === '測試羅浮甲')[11], '羅浮');
  // 童軍團長把一個家長帳號加為童軍服務員
  const p = env.api({ action: 'register', identity: '服務員', username: 'helper09', password: 'applypass1', nickname: '測試幫手' });
  const id = call(O, 'accountList').accounts.find((a) => a.username === 'helper09').accountId;
  assert.equal(call(S, 'adminAdd', { accountId: id, role: '服務員', name: '測試幫手', title: '小隊輔' }).ok, true);
  const row = env.rows('管理員').find((r) => r[0] === id);
  assert.deepEqual([row[2], row[7], row[8]], ['服務員', '童軍', '小隊輔']);
  assert.equal(call(p.token, 'me').section, '童軍');
  assert.ok(call(S, 'adminList').admins.some((a) => a.accountId === id));
});

test('集會：分團集會由該分團團長設定；全團集會只有 admin、總團；全團集會各分團點自己的團員', () => {
  const { env, call, L, O, S } = world();
  const wolf = call(L, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' }).cubId;
  const scout = call(S, 'cubSave', { name: '測試童軍甲', joinDate: '2025-01-01' }).cubId;
  assert.equal(call(S, 'meetingSave', { lines: '2026-11-21 童軍團集會' }).added, 1);
  assert.equal(call(S, 'meetingSave', { lines: '2026-11-22 團慶', target: '全團' }).code, 'FORBIDDEN', '分團團長不能設全團集會');
  assert.equal(call(S, 'meetingSave', { lines: '2026-11-22 團集會', target: '小狼' }).code, 'FORBIDDEN', '不能設別的分團的集會');
  assert.equal(call(O, 'meetingSave', { lines: '2026-11-22 全團團慶', target: '全團' }).added, 1);
  const names = (tk) => call(tk, 'meetingList').meetings.map((m) => m.name + '／' + m.target);
  assert.deepEqual(names(S), ['童軍團集會／童軍', '全團團慶／全團']);
  assert.deepEqual(names(L), ['全團團慶／全團'], '小狼看不到童軍的集會');
  const all = call(S, 'meetingList').meetings.find((m) => m.target === '全團');
  assert.equal(all.canEdit, false);
  assert.equal(call(S, 'meetingSave', { meetingId: all.meetingId, name: '改名' }).code, 'FORBIDDEN');
  const sm = call(S, 'meetingList').meetings.find((m) => m.target === '童軍');
  assert.equal(call(L, 'attendanceSheet', { meetingId: sm.meetingId }).code, 'NOT_FOUND');
  // 全團集會：各分團的點名名單只有自己的團員
  assert.deepEqual(call(S, 'attendanceSheet', { meetingId: all.meetingId }).cubs.map((c) => c.cubId), [scout]);
  assert.deepEqual(call(L, 'attendanceSheet', { meetingId: all.meetingId }).cubs.map((c) => c.cubId), [wolf]);
  assert.equal(call(S, 'attendanceSave', { meetingId: all.meetingId, marks: { [wolf]: '出席', [scout]: '出席' } }).changed, 1, '只寫得進自己分團的團員');
  assert.equal(call(L, 'meetingList').meetings[0].attended, 0, '出席人數各分團分開算');
  assert.equal(env.rows('集會行事曆').find((r) => r[2] === '童軍團集會')[9], '童軍');
  // 公開月曆：每場集會帶對象，網頁依頁面篩選
  assert.deepEqual(env.api({ action: 'siteInfo' }).meetings.map((m) => m.target), ['童軍', '全團']);
});

test('年度出席設定：admin、總團做全團預設，各分團團長可以設自己的', () => {
  const { env, call, L, O, S } = world();
  assert.equal(call(S, 'periodSave', { name: '115學年度', start: '2026-08-01', end: '2027-07-31', total: 20, target: '全團' }).code, 'FORBIDDEN');
  assert.equal(call(O, 'periodSave', { name: '115學年度', start: '2026-08-01', end: '2027-07-31', total: 20, target: '全團' }).ok, true);
  assert.equal(call(S, 'periodList').current, '115學年度', '沒有自己的就用全團預設');
  assert.equal(call(S, 'periodList').periods[0].canEdit, false);
  assert.equal(call(S, 'periodSave', { name: '115學年度', start: '2026-09-01', end: '2027-06-30', total: 12 }).ok, true);
  const mine = call(S, 'periodList').periods.find((p) => p.target === '童軍');
  assert.equal(mine.total, 12);
  assert.equal(env.rows('年度出席設定').length, 2, '同名的全團預設與分團設定分開存');
  assert.equal(call(L, 'periodList').periods.length, 1, '小狼只看到全團預設');
  const scout = call(S, 'cubSave', { name: '測試童軍甲', joinDate: '2025-01-01' }).cubId;
  assert.equal(call(S, 'cubAdminDetail', { cubId: scout }).attendance.rate.period, '115學年度');
});

test('公告：全團公告只有 admin、總團能發；分團公告只在該分團；公開資料帶對象', () => {
  const { env, call, L, O, S } = world();
  assert.equal(call(S, 'noticeSave', { title: '童軍公告', content: '內容' }).ok, true);
  assert.equal(call(S, 'noticeSave', { title: '全團公告', content: '內容', target: '全團' }).code, 'FORBIDDEN');
  assert.equal(call(O, 'noticeSave', { title: '全團公告', content: '內容', target: '全團' }).ok, true);
  assert.deepEqual(call(L, 'noticeList').notices.map((n) => n.title), ['全團公告']);
  assert.deepEqual(call(S, 'noticeList').notices.map((n) => [n.title, n.canEdit]).sort(), [['全團公告', false], ['童軍公告', true]]);
  const g = call(S, 'noticeList').notices.find((n) => n.title === '全團公告');
  assert.equal(call(S, 'noticeSave', { id: g.id, title: '改', content: '' }).code, 'FORBIDDEN');
  assert.deepEqual(env.api({ action: 'notices' }).notices.map((n) => [n.title, n.target]).sort(), [['全團公告', '全團'], ['童軍公告', '童軍']]);
  // 舊公告（分團欄空白）＝小狼
  const sh = env.sheet('公告');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 8).setValues([['N900', '舊公告', '', '否', '', 'x', new Date(), '顯示']]);
  assert.ok(call(L, 'noticeList').notices.some((n) => n.title === '舊公告' && n.target === '小狼'));
});

test('活動：可以複選分團；全團活動只有 admin、總團；只有對象分團的家長能報名', () => {
  const { env, call, L, O, S } = world(); // 模擬時間 2026-11-14 10:00
  const base = { title: '聯合露營', desc: '', date: '2026-12-12', endDate: '2026-12-13', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 100, questions: [] };
  assert.equal(call(S, 'eventSave', { ...base, targets: ['全團'] }).code, 'FORBIDDEN');
  assert.match(call(S, 'eventSave', { ...base, targets: ['小狼'] }).message, /要包含你自己的分團/);
  const ev = call(S, 'eventSave', { ...base, targets: ['童軍', '行義'] });
  assert.equal(ev.ok, true);
  assert.equal(env.rows('活動').find((r) => r[0] === ev.id)[14], '童軍、行義');
  assert.equal(call(L, 'eventAdminList').events.length, 0, '小狼看不到');
  assert.equal(call(L, 'eventRegs', { eventId: ev.id }).code, 'NOT_FOUND');
  const g = call(O, 'eventSave', { ...base, title: '全團園遊會', targets: ['全團'] });
  assert.deepEqual(call(L, 'eventAdminList').events.map((e) => [e.title, e.canEdit]), [['全團園遊會', false]]);
  assert.equal(call(L, 'eventSave', { ...base, id: g.id, title: '改' }).code, 'FORBIDDEN');
  // 家長：小狼的孩子只看到全團活動；童軍的孩子看得到聯合露營並可報名
  const wolf = call(L, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' });
  const scout = call(S, 'cubSave', { name: '測試童軍甲', joinDate: '2025-01-01' });
  const reg = (code, child, u) => env.api({ action: 'register', code, childName: child, username: u, password: 'parentpass1', nickname: '家長', consentVersion: v(env) }).token;
  const PW = reg(wolf.code, '測試小狼甲', 'pwolf01'), PS = reg(scout.code, '測試童軍甲', 'pscout01');
  assert.deepEqual(call(PW, 'eventList').events.map((e) => e.title), ['聯合露營', '全團園遊會'].filter((t) => t === '全團園遊會'));
  assert.deepEqual(call(PS, 'eventList').events.map((e) => e.title).sort(), ['全團園遊會', '聯合露營'].sort());
  const one = (name) => ({ eventId: ev.id, people: [{ name, identity: '童軍', answers: {} }] });
  assert.match(call(PW, 'eventRegister', one('測試小狼甲')).message, /只開放給童軍、行義/);
  assert.equal(call(PS, 'eventRegister', one('測試童軍甲')).ok, true);
  assert.equal(call(S, 'eventRegs', { eventId: ev.id }).regs.length, 1);
  assert.deepEqual(env.api({ action: 'siteInfo' }).events.map((e) => e.targets.join('、')).sort(), ['全團', '童軍、行義'].sort());
});
