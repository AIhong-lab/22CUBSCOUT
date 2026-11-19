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
