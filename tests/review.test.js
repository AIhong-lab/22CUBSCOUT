// 2026-11-25 外部程式檢查回報的問題（SPEC 附錄第 78 點）：每一項先寫成會失敗的測試再修。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../gas/Logic.js');
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
  call(W, 'squadSave', { type: 'add', name: '一小隊' });
  const v = env.api({ action: 'consentText' }).version;
  return { env, call, W, O, S, v, adminPassword: made.password };
}
const acc = (env, name) => env.rows('帳號').find((r) => r[1] === name)[0];
const say = (env, text, userId) => env.ctx.doPost({ parameter: { key: env.props.WEBHOOK_KEY }, postData: { contents: JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text }, source: { type: 'user', userId }, replyToken: 'rt' }] }) } });
const link = (env, call, token, userId) => { const { code } = call(token, 'lineLinkStart'); say(env, code, userId); };

test('移交：取消「保留總團」會移除原管理員的總團身分；接任者必須是啟用中的總團或團長', () => {
  const { env, call, O, v, adminPassword } = world();
  const owner = acc(env, 'admin');
  // admin 原本也有總團身分
  const cg = call(O, 'inviteCreate', { role: '總團', name: '總團甲' });
  assert.equal(cg.ok, true);
  env.sheet('管理員').getRange(env.sheet('管理員').getLastRow() + 1, 1, 1, 9).setValues([[owner, '管理員', '總團', new Date(), owner, '', '', '', '總團']]);
  // 一般家長不能接任
  const kid = call(O, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' });
  env.api({ action: 'register', code: kid.code, childName: '測試小狼甲', username: 'mom01', password: 'mompass12', nickname: '家長', consentVersion: v });
  assert.match(call(O, 'handoverTransfer', { targetAccountId: acc(env, 'mom01'), confirmUsername: 'mom01', password: adminPassword }).message, /只能移交給/);
  const r = call(O, 'handoverTransfer', { targetAccountId: acc(env, 'scoutlead'), confirmUsername: 'scoutlead', password: adminPassword, keepAsCentral: false });
  assert.equal(r.ok, true);
  assert.ok(!env.rows('管理員').some((x) => x[0] === owner && x[2] === '總團'), '原管理員的總團身分已移除');
  assert.ok(env.rows('管理員').some((x) => x[0] === acc(env, 'scoutlead') && x[2] === '總團'));
});

test('活動報名：家長有多個孩子時，只要有一個在團孩子的分團開放報名就可以（不只看第一個孩子）', () => {
  const { env, call, W, O, S, v } = world();
  const wolf = call(W, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' });
  const scout = call(S, 'cubSave', { name: '測試童軍甲', joinDate: '2025-01-01' });
  const P = env.api({ action: 'register', code: wolf.code, childName: '測試小狼甲', username: 'mom01', password: 'mompass12', nickname: '家長', consentVersion: v }).token;
  call(P, 'bind', { code: scout.code, childName: '測試童軍甲', consentVersion: v });
  // 小狼停用家長線上報名，童軍照常
  assert.equal(call(O, 'permSettingsSave', { updates: [{ id: 'parent_events', level: '家長', disabledSections: ['小狼'] }] }).ok, true);
  const ev = call(S, 'eventSave', { title: '童軍露營', desc: '', date: '2026-12-12', endDate: '2026-12-13', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 0, questions: [], targets: ['童軍'] });
  const r = call(P, 'eventRegister', { eventId: ev.id, people: [{ name: '測試童軍甲', identity: '童軍' }], answers: {} });
  assert.notEqual(r.code, 'FORBIDDEN', JSON.stringify(r));
});

test('補登頒章不觸發 LINE 推播（SPEC 7.6）', () => {
  const { env, call, W } = world();
  env.props.LINE_MESSAGING_TOKEN = 'dummy';
  link(env, call, W, 'Uwolf');
  const kid = call(W, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' });
  // 種植章項目全完成（待頒章）但還沒推播過；補登另一個章不應順便推播
  const plant = env.rows('項目總表').filter((r) => r[2] === '種植' && !r[7]).map((r) => r[0]);
  const comp = env.sheet('完成紀錄');
  comp.getRange(comp.getLastRow() + 1, 1, plant.length, 7).setValues(plant.map((id) => [kid.cubId, id, '2026-11-01', 'x', '', '', '']));
  env.sent.length = 0;
  assert.equal(call(W, 'backfill', { cubId: kid.cubId, unit: '嚮導', date: '2026-11-01' }).ok, true);
  assert.equal(env.sent.filter((s) => /multicast/.test(s.url)).length, 0);
});

test('童軍本人帳號不能解除自己的綁定、不能申請新增孩子', () => {
  const { env, call, S, v } = world();
  const scout = call(S, 'cubSave', { name: '測試童軍甲', joinDate: '2025-01-01' });
  const P = env.api({ action: 'register', code: scout.code, childName: '測試童軍甲', username: 'mom01', password: 'mompass12', nickname: '家長', consentVersion: v }).token;
  call(P, 'parentCreateScoutAccount', { cubId: scout.cubId, username: 'kid_scout', password: 'kidpass12' });
  const K = env.api({ action: 'login', username: 'kid_scout', password: 'kidpass12' }).token;
  assert.equal(call(K, 'unbind', { cubId: scout.cubId }).code, 'FORBIDDEN');
  assert.equal(call(K, 'requestChildren', { childNames: ['測試小狼乙'], consentVersion: v }).code, 'FORBIDDEN');
  assert.ok(env.rows('綁定紀錄').some((r) => r[1] === scout.cubId && r[5] === '本人'));
});

test('修改密碼：舊密碼錯太多次會鎖定', () => {
  const { call, W } = world();
  for (let i = 0; i < 5; i++) assert.match(call(W, 'changePassword', { oldPassword: 'wrong-' + i, newPassword: 'newpass123x' }).message, /目前的密碼不正確/);
  assert.equal(call(W, 'changePassword', { oldPassword: 'leaderpass1', newPassword: 'newpass123x' }).code, 'LOCKED');
});

test('LINE 關鍵字：帳號停用後即使沒解除 LINE 也不回覆名單', () => {
  const { env, call, O, S } = world();
  env.props.LINE_MESSAGING_TOKEN = 'dummy';
  link(env, call, S, 'Uscout');
  env.sent.length = 0;
  say(env, '可晉級', 'Uscout');
  assert.equal(env.sent.length, 1, '啟用時有回覆');
  assert.equal(call(O, 'accountStatus', { accountId: acc(env, 'scoutlead'), status: '停用' }).ok, true);
  env.sent.length = 0;
  say(env, '可晉級', 'Uscout');
  say(env, '點名', 'Uscout');
  assert.equal(env.sent.length, 0);
});

test('LINE「前往頒章」連結帶分團，切到正確的分團', () => {
  const { env, call, O } = world();
  const inv = call(O, 'inviteCreate', { section: '稚齡', role: '團長', title: '團長', name: '稚齡團長' });
  const B = env.api({ action: 'register', code: inv.code, childName: '', username: 'beaverlead', password: 'beaverpass1', nickname: '稚齡團長' }).token;
  env.props.LINE_MESSAGING_TOKEN = 'dummy';
  link(env, call, B, 'Ubeaver');
  call(B, 'squadSave', { type: 'add', name: '小星星' });
  const kid = call(B, 'cubSave', { name: '測試稚齡甲', squad: '小星星', joinDate: '2026-06-01' });
  env.sent.length = 0;
  call(B, 'signoff', { cubIds: [kid.cubId], itemIds: env.rows('項目總表').filter((r) => r[2] === '種植' && r[7] === '稚齡').map((r) => r[0]), date: '2026-11-01' });
  const body = JSON.stringify(env.sent.find((s) => /multicast/.test(s.url)).body);
  assert.match(body, new RegExp('#award=' + encodeURIComponent(kid.cubId + ',種植,稚齡').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('個資處理：只替換這位團員的姓名，不動包含這個名字的其他人（例如「陳宇」與「陳宇軒」）', () => {
  const data = {
    '小狼名單': [['小狼ID', '姓名', '小隊', '入團日', '目前級別', '綁定碼', '綁定碼剩餘次數', '狀態', '離團日'],
      ['C1', '陳宇', '一小隊', '2025-01-01', '狼', '', 0, '離團', '2026-01-01'],
      ['C2', '陳宇軒', '一小隊', '2025-01-01', '狼', '', 0, '在團', '']],
    '綁定紀錄': [['帳號ID', '小狼ID']], '完成紀錄': [['小狼ID']], '頒章紀錄': [['小狼ID']], '通知紀錄': [['小狼ID']],
    '出席紀錄': [['集會ID', '小狼ID']], '額外出席': [['年度名稱', '小狼ID']], '註冊申請': [['申請ID']], '職務紀錄': [['小狼ID']],
    '操作日誌': [['時間', '操作人', '動作', '對象', '修改前', '修改後'],
      ['t', 'A1', '新增小狼', '陳宇', '', '陳宇／一小隊'],
      ['t', 'A1', '新增小狼', '陳宇軒', '', '陳宇軒／一小隊'],
      ['t', 'A1', '頒章', 'C1', '', '陳宇・狼、陳宇軒・狼']]
  };
  const plan = L.planPrivacy(data, 'C1', 'anonymize');
  assert.equal(plan.ok, true);
  const byRow = {};
  plan.updateRows['操作日誌'].forEach((u) => { byRow[u.row] = u.values; });
  assert.ok(!byRow[3], '陳宇軒的那一列不動');
  assert.equal(byRow[4][5], '已離團小狼1・狼、陳宇軒・狼');
  assert.equal(byRow[2][3], '已離團小狼1');
});

test('startup：點名清單沒有權限時，後台首頁的預載還在', () => {
  const { call, O, S } = world();
  call(O, 'permSettingsSave', { updates: [{ id: 'tab_attendance', level: '團長', disabledSections: ['童軍'] }] });
  const st = call(S, 'startup');
  assert.ok(st.prefetch && st.prefetch.adminHome && st.prefetch.adminHome.ok, JSON.stringify(Object.keys(st.prefetch || {})));
});

test('姓名、稱呼等使用者輸入的欄位設成純文字，避免被當成公式', () => {
  const { env } = world();
  const T = env.ctx.TEXT_COLUMNS, S = env.ctx.SHEET;
  assert.ok(T[S.CUBS].includes(2), '小狼名單姓名');
  assert.ok(T[S.ACCOUNTS].includes(3), '帳號稱呼');
  assert.ok(T[S.REQUESTS].includes(4), '註冊申請填寫姓名');
});

test('setup、安裝排程等公開函式：GAS 網頁版的匿名訪客呼叫會被擋下，擁有者在編輯器執行照常', () => {
  const env = loadGas();
  env.flags.activeUser = '';
  for (const fn of ['setup', 'cleanup0B', 'installDailyTrigger', 'installBackupTrigger']) {
    assert.throws(() => env.ctx[fn](), /編輯器/, fn);
  }
  assert.ok(!env.sheet('設定'), '沒有執行 setup');
  env.flags.activeUser = 'owner@example.test';
  env.ctx.setup();
  assert.ok(env.rows('設定').length > 0);
});

test('管理員姓名也設成純文字', () => {
  const { env } = world();
  assert.ok(env.ctx.TEXT_COLUMNS[env.ctx.SHEET.ADMINS].includes(2));
});

