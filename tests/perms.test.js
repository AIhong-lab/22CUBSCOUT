// 權限設定、移交中心、童軍本人帳號（SPEC 附錄第 76 點）。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Logic = require('../gas/Logic.js');
const { loadGas } = require('./gas-mock.js');

// ───────────── 純邏輯 ─────────────

test('parsePermRules：讀試算表的二維陣列（含標題列）、無效值退回預設、共用功能沿用「共用功能權限」設定', () => {
  const rows = Logic.defaultPermRows();
  rows.find((r) => r[0] === 'tab_events')[3] = '服務員';
  rows.find((r) => r[0] === 'tab_notices')[4] = '童軍、亂寫';
  rows.find((r) => r[0] === 'tab_roster')[3] = '亂寫';
  rows.find((r) => r[0] === 'tab_permissions')[4] = '小狼';
  const rules = Logic.parsePermRules(rows, {});
  assert.equal(rules.tab_events.level, '服務員', '試算表的值有效');
  assert.deepEqual(rules.tab_notices.disabledSections, ['童軍'], '只留有效的分團');
  assert.equal(rules.tab_roster.level, '服務員', '無效值退回預設');
  assert.deepEqual(rules.tab_permissions.disabledSections, [], '鎖定項不能停用分團');
  // 沒有權限設定分頁時：共用功能沿用設定分頁的「共用功能權限」
  const fromSettings = Logic.parsePermRules([], { '共用功能權限：帳號管理': '團長' });
  assert.equal(fromSettings.tab_accounts.level, '團長');
  assert.equal(fromSettings.tab_settings.level, '總團');
});

test('allowsFeature：六層角色、停用分團、沒有最高管理員時照舊由團長', () => {
  const rules = Logic.parsePermRules([], {});
  const R = (id, patch) => Object.assign({}, rules[id], patch || {});
  const owner = { loggedIn: true, isOwner: true, ownerExists: true, section: '童軍' };
  const central = { loggedIn: true, isCentral: true, ownerExists: true, role: '團長', section: '童軍' };
  const leader = { loggedIn: true, role: '團長', ownerExists: true, section: '童軍' };
  const helper = { loggedIn: true, role: '服務員', ownerExists: true, section: '童軍' };
  const parent = { loggedIn: true, isParent: true, ownerExists: true, section: '童軍' };
  const self = { loggedIn: true, isScoutSelf: true, ownerExists: true, section: '童軍' };
  const guest = { loggedIn: false };
  // 分團日常：服務員可點名、團長才能管活動
  assert.equal(Logic.allowsFeature(rules.tab_attendance, helper), true);
  assert.equal(Logic.allowsFeature(rules.tab_events, helper), false);
  assert.equal(Logic.allowsFeature(rules.tab_events, leader), true);
  assert.equal(Logic.allowsFeature(rules.tab_events, parent), false, '家長不能進後台');
  // 總團管理：預設只有 admin 與總團
  assert.equal(Logic.allowsFeature(rules.tab_accounts, leader), false);
  assert.equal(Logic.allowsFeature(rules.tab_accounts, central), true);
  assert.equal(Logic.allowsFeature(rules.tab_permissions, owner), true);
  assert.equal(Logic.allowsFeature(rules.tab_permissions, leader), false);
  // 還沒有最高管理員帳號：照舊團長可以
  assert.equal(Logic.allowsFeature(rules.tab_accounts, Object.assign({}, leader, { ownerExists: false })), true);
  // 停用分團：童軍的團長被擋，小狼的團長不受影響，總團、admin 不受限
  const off = R('tab_notices', { disabledSections: ['童軍'] });
  assert.equal(Logic.allowsFeature(off, leader), false);
  assert.equal(Logic.allowsFeature(off, Object.assign({}, leader, { section: '小狼' })), true);
  assert.equal(Logic.allowsFeature(off, central), true);
  assert.equal(Logic.allowsFeature(off, owner), true);
  // 家長與童軍本人
  assert.equal(Logic.allowsFeature(rules.member_progress, self), true, '預設童軍本人可看自己的進度');
  assert.equal(Logic.allowsFeature(rules.parent_leave, self), false, '請假預設只有家長');
  assert.equal(Logic.allowsFeature(rules.parent_leave, parent), true);
  // 公開內容
  assert.equal(Logic.allowsFeature(rules.pub_notices, guest), true);
  assert.equal(Logic.allowsFeature(R('pub_notices', { level: '已登入' }), guest), false);
  assert.equal(Logic.allowsFeature(R('pub_notices', { level: '停用' }), owner), false);
});

test('validatePermUpdate：擋無效功能與選項；鎖定項不接受停用分團', () => {
  assert.equal(Logic.validatePermUpdate('nope', '團長').ok, false);
  assert.equal(Logic.validatePermUpdate('tab_permissions', '團長').ok, false, '權限設定只能是管理員或總團');
  const v = Logic.validatePermUpdate('tab_permissions', '總團', ['童軍']);
  assert.deepEqual([v.ok, v.disabledSections], [true, []]);
  assert.deepEqual(Logic.validatePermUpdate('tab_notices', '團長', '童軍、童軍、外星').disabledSections, ['童軍']);
});

test('parseCsv 去掉 UTF-8 BOM', () => {
  assert.deepEqual(Logic.parseCsv('﻿a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

// ───────────── 後端整合 ─────────────

function world() {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '小狼團長' }).token;
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const inv = call(O, 'inviteCreate', { section: '童軍', role: '團長', title: '團長', name: '童軍團長' });
  const S = env.api({ action: 'register', code: inv.code, childName: '', username: 'scoutlead', password: 'scoutpass1', nickname: '童軍團長' }).token;
  const inv2 = call(O, 'inviteCreate', { section: '童軍', role: '服務員', name: '童軍服務員' });
  const SA = env.api({ action: 'register', code: inv2.code, childName: '', username: 'scouthelp', password: 'scoutpass2', nickname: '童軍服務員' }).token;
  return { env, call, L, O, S, SA, adminPassword: made.password };
}
const acc = (env, name) => env.rows('帳號').find((r) => r[1] === name)[0];

test('權限設定：只有 admin、總團能改；改了立刻影響後端權限；停用分團只擋該分團', () => {
  const { env, call, L, O, S, SA } = world();
  assert.equal(call(S, 'permSettingsGet').code, 'FORBIDDEN', '分團團長不能看權限設定');
  assert.equal(call(O, 'permSettingsGet').features.length, Logic.PERM_FEATURES.length);
  // 童軍停用公告管理
  assert.equal(call(O, 'permSettingsSave', { updates: [{ id: 'tab_notices', level: '服務員', disabledSections: ['童軍'] }] }).changed, 1);
  assert.equal(call(S, 'noticeList').code, 'FORBIDDEN', '童軍團長被停用');
  assert.equal(call(L, 'noticeList').ok, true, '小狼不受影響');
  assert.equal(call(O, 'noticeList', { _sec: '童軍' }).ok, true, 'admin 不受停用分團限制');
  assert.equal(call(S, 'me').tabs.tab_notices, false, 'me.tabs 給網頁隱藏分頁');
  // 點名改成只有團長
  assert.equal(call(SA, 'attendanceSheet', { meetingId: 'x' }).code, 'NOT_FOUND', '原本服務員可以點名（找不到集會）');
  call(O, 'permSettingsSave', { updates: [{ id: 'tab_attendance', level: '團長' }] });
  assert.equal(call(SA, 'attendanceSheet', { meetingId: 'x' }).code, 'FORBIDDEN');
  assert.ok(env.rows('權限設定').some((r) => r[0] === 'tab_attendance' && r[3] === '團長'));
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '修改權限設定'));
  // 共用功能：權限設定與「共用功能權限」兩邊同步
  call(O, 'permSettingsSave', { updates: [{ id: 'tab_accounts', level: '團長' }] });
  assert.equal(env.rows('設定').find((r) => r[0] === '共用功能權限：帳號管理')[1], '團長');
  assert.equal(call(L, 'accountList').ok, true);
  call(O, 'settingsSave', { changes: { '共用功能權限：帳號管理': '總團' } });
  assert.equal(env.rows('權限設定').find((r) => r[0] === 'tab_accounts')[3], '總團');
  assert.equal(call(L, 'accountList').code, 'FORBIDDEN');
  // 分團團長仍然可以改自己分團的設定（全團系統設定預設只有 admin、總團）
  assert.equal(call(S, 'settingsSave', { changes: { '體驗所需出席次數（童軍）': '3' } }).ok, true);
  assert.equal(call(S, 'settingsSave', { changes: { '密碼最短長度': '10' } }).code, 'FORBIDDEN');
});

test('移交中心：admin 用密碼二次確認把最高管理權移交給別人，接任者成為總團與最高管理員', () => {
  const { env, call, L, O, S, adminPassword } = world();
  assert.equal(call(S, 'handoverSummary').code, 'FORBIDDEN', '分團團長看不到移交中心');
  const sum = call(O, 'handoverSummary');
  assert.equal(sum.isOwner, true);
  assert.ok(sum.candidates.some((c) => c.username === 'scoutlead'));
  const target = acc(env, 'scoutlead');
  assert.match(call(O, 'handoverTransfer', { targetAccountId: target, confirmUsername: 'scoutlead', password: 'wrongpass' }).message, /密碼不正確/);
  assert.match(call(O, 'handoverTransfer', { targetAccountId: target, confirmUsername: 'leader01', password: adminPassword }).message, /帳號名稱/);
  assert.equal(call(L, 'handoverTransfer', { targetAccountId: target, confirmUsername: 'scoutlead', password: 'leaderpass1' }).code, 'FORBIDDEN');
  const r = call(O, 'handoverTransfer', { targetAccountId: target, confirmUsername: 'scoutlead', password: adminPassword });
  assert.equal(r.newOwnerUsername, 'scoutlead');
  assert.equal(env.rows('設定').find((x) => x[0] === '最高管理員帳號ID')[1], target);
  assert.equal(call(S, 'me').isOwner, true, '接任者是新的最高管理員');
  assert.equal(call(S, 'me').isCentral, true);
  assert.equal(call(O, 'me').isOwner, false, '原本的 admin 不再是最高管理員');
  assert.equal(call(O, 'me').isCentral, true, '原管理員保留總團（交接顧問）');
  assert.equal(call(S, 'permSettingsGet').ok, true);
  assert.ok(env.rows('操作日誌').some((x) => x[2] === '移交最高管理權'));
  assert.equal(call(S, 'settingsGet').settings.some((x) => x.key === '最高管理員帳號ID'), false, '設定頁不能直接改最高管理員');
});

test('童軍本人帳號：童軍以上孩子的家長可以建立；本人只看得到自己、不能再綁別人、預設不能請假', () => {
  const { env, call, L, O, S } = world();
  const v = env.api({ action: 'consentText' }).version;
  const scout = call(S, 'cubSave', { name: '測試童軍甲', joinDate: '2025-01-01' });
  call(L, 'squadSave', { type: 'add', name: '一小隊' });
  const wolf = call(L, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' });
  const P = env.api({ action: 'register', code: scout.code, childName: '測試童軍甲', username: 'mom01', password: 'mompass12', nickname: '測試媽媽', consentVersion: v }).token;
  call(P, 'bind', { code: wolf.code, childName: '測試小狼甲', consentVersion: v });
  assert.equal(call(P, 'parentCreateScoutAccount', { cubId: wolf.cubId, username: 'kid_wolf', password: 'kidpass12' }).code, 'BAD_INPUT', '小狼不能建本人帳號');
  const made = call(P, 'parentCreateScoutAccount', { cubId: scout.cubId, username: 'kid_scout', password: 'kidpass12' });
  assert.equal(made.username, 'kid_scout');
  assert.equal(env.rows('綁定紀錄').find((r) => r[1] === scout.cubId && r[0] === made.accountId)[5], '本人');
  const K = env.api({ action: 'login', username: 'kid_scout', password: 'kidpass12' }).token;
  const me = call(K, 'me');
  assert.deepEqual([me.isScoutSelf, me.accountType, me.cubs.length], [true, 'scout_self', 1]);
  assert.equal(call(K, 'cubDetail', { cubId: scout.cubId }).cub.name, '測試童軍甲');
  assert.equal(call(K, 'cubDetail', { cubId: wolf.cubId }).code, 'NOT_FOUND', '看不到弟弟妹妹');
  assert.match(call(K, 'bind', { code: wolf.code, childName: '測試小狼甲', consentVersion: v }).message, /本人帳號僅限綁定自己/);
  assert.equal(call(K, 'parentCreateScoutAccount', { cubId: scout.cubId, username: 'kid2', password: 'kidpass12' }).code, 'FORBIDDEN', '本人帳號不能再建帳號');
  call(S, 'meetingSave', { lines: '2026-11-28 童軍團集會' });
  const m = call(S, 'meetingList').meetings[0];
  assert.equal(call(K, 'parentLeave', { cubId: scout.cubId, meetingId: m.meetingId }).code, 'FORBIDDEN', '請假預設只有家長');
  assert.equal(call(P, 'parentLeave', { cubId: scout.cubId, meetingId: m.meetingId }).leave, true);
  // 總團關掉後家長就不能建立
  call(O, 'permSettingsSave', { updates: [{ id: 'parent_create_scout', level: '停用' }] });
  assert.equal(call(P, 'parentCreateScoutAccount', { cubId: scout.cubId, username: 'kid_scout2', password: 'kidpass12' }).code, 'FORBIDDEN');
});

test('跨分團越權修補：綁定、個資處理、頒章紀錄只能處理目前分團的團員', () => {
  const { call, L, S } = world();
  call(L, 'squadSave', { type: 'add', name: '一小隊' });
  const wolf = call(L, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-01-01' }).cubId;
  assert.equal(call(S, 'cubBindings', { cubId: wolf }).code, 'NOT_FOUND');
  assert.equal(call(S, 'cubUnbind', { cubId: wolf, accountId: 'x' }).code, 'NOT_FOUND');
  assert.equal(call(S, 'privacyPreview', { cubId: wolf, mode: 'anonymize' }).code, 'NOT_FOUND');
  assert.equal(call(S, 'privacyExecute', { cubId: wolf, mode: 'anonymize', confirmName: '測試小狼甲' }).code, 'NOT_FOUND');
  assert.equal(call(L, 'cubBindings', { cubId: wolf }).ok, true);
});
