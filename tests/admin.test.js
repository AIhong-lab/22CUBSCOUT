// 後台 API 整合測試（階段 4A）。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./gas-mock.js');

const DAY = 86400000;

/** 建好系統：團長、服務員、一位家長；回傳各自的 token */
function world() {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' });
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  // 服務員：自己註冊選「服務員」，團長核准（邀請碼功能已拿掉）
  const A = env.api({ action: 'register', identity: '服務員', username: 'helper01', password: 'helperpass1', nickname: '陳服務員' });
  const reqA = call(L.token, 'requestList').items[0];
  call(L.token, 'requestApprove', { requestId: reqA.requestId });
  call(L.token, 'squadSave', { type: 'add', name: '一小隊' });
  call(L.token, 'squadSave', { type: 'add', name: '二小隊' });
  const cub = call(L.token, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-03-01' });
  const v = env.api({ action: 'consentText' }).version;
  const P = env.api({ action: 'register', code: cub.code, childName: '測試小狼甲', username: 'parent01', password: 'parentpass1', nickname: '測試小狼甲媽媽', consentVersion: v });
  return { env, call, L: L.token, A: A.token, P: P.token, cubId: cub.cubId, code: cub.code };
}
const itemsOf = (env, unit, sec = '') => env.rows('項目總表').filter((r) => r[2] === unit && (r[7] || '') === sec).map((r) => r[0]);

test('權限：家長不能呼叫後台；服務員不能做團長專屬操作', () => {
  const { call, L, A, P, cubId } = world();
  for (const a of ['adminHome', 'cubList', 'signoffData', 'overview', 'meetingList']) assert.equal(call(P, a).code, 'FORBIDDEN', '家長：' + a);
  for (const [a, d] of [['cubSave', { name: 'x', joinDate: '2025-01-01' }], ['cubLeave', { cubId, leftDate: '2026-01-01' }], ['cubNewCode', { cubId }], ['award', { date: '2026-01-01', entries: [{ cubId, unit: '羚羊' }] }],
    ['backfill', { cubId, unit: '羚羊', date: '2026-01-01' }], ['adminList'], ['requestList'], ['accountList'], ['privacyExecute', { cubId, mode: 'delete', confirmName: '測試小狼甲' }],
    ['backupNow'], ['meetingSave', { lines: '2026-11-22 團集會' }], ['periodSave', { name: 'x', start: '2026-01-01', end: '2026-12-31', total: 1 }]]) {
    assert.equal(call(A, a, d).code, 'FORBIDDEN', '服務員：' + a);
  }
  assert.equal(call(A, 'signoffData').ok, true);
  assert.equal(call(A, 'adminHome').ok, true);
  assert.equal(call(A, 'meetingList').ok, true);
  const list = call(A, 'cubList');
  assert.equal(list.cubs[0].code, undefined, '服務員看不到綁定碼');
  assert.equal(call(L, 'cubList').cubs[0].code.length, 6);
});

test('小狼管理：新增產生綁定碼、編輯、重新產生舊碼失效、離團綁定碼失效', () => {
  const { env, call, L, cubId, code } = world();
  assert.equal(call(L, 'cubSave', { name: '', joinDate: '2025-01-01' }).code, 'BAD_INPUT');
  assert.equal(call(L, 'cubSave', { name: '測試', joinDate: '2025-02-30' }).code, 'BAD_INPUT');
  assert.equal(call(L, 'cubSave', { cubId, name: '測試小狼甲', squad: '二小隊', joinDate: '2024-09-01' }).ok, true);
  assert.equal(env.rows('小狼名單')[0][2], '二小隊');
  assert.equal(env.rows('小狼名單')[0][3], '2024-09-01', '入團日可填過去日期，存成文字');
  const n = call(L, 'cubNewCode', { cubId });
  assert.notEqual(n.code, code);
  assert.equal(env.api({ action: 'checkCode', code, childName: '測試小狼甲' }).code, 'CODE_INVALID', '舊碼失效');
  assert.equal(env.api({ action: 'checkCode', code: n.code, childName: '測試小狼甲' }).ok, true);
  assert.equal(call(L, 'cubBindings', { cubId }).bindings[0].username, 'parent01');
  assert.equal(call(L, 'cubLeave', { cubId, leftDate: '2026-11-01' }).ok, true);
  assert.equal(env.api({ action: 'checkCode', code: n.code, childName: '測試小狼甲' }).code, 'CODE_INVALID', '離團後綁定碼失效');
  assert.equal(env.rows('小狼名單')[0][7], '離團');
});

test('簽核：批次略過已完成、不可未來日期、服務員只能撤銷自己的、復原整批', () => {
  const { env, call, L, A, cubId } = world();
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '一小隊', joinDate: '2025-09-01' }).cubId;
  const lion = itemsOf(env, '羚羊');
  assert.equal(call(A, 'signoff', { cubIds: [cubId], itemIds: lion.slice(0, 2), date: '2026-12-01' }).code, 'BAD_INPUT', '未來日期');
  const s1 = call(A, 'signoff', { cubIds: [cubId], itemIds: lion.slice(0, 2), date: '2026-11-01' });
  assert.equal(s1.added, 2);
  const s2 = call(L, 'signoff', { cubIds: [cubId, c2], itemIds: lion.slice(0, 3), date: '2026-11-08' });
  assert.deepEqual([s2.added, s2.skipped], [4, 2]);
  assert.equal(env.rows('完成紀錄').length, 6);
  const data = call(A, 'signoffData');
  assert.equal(data.recent[0], lion[1], '最近簽過的項目在前');
  // 服務員不能撤銷團長簽的
  const byLeader = s2.batch.find((b) => b.cubId === c2);
  assert.equal(call(A, 'signoffRevoke', { entries: [byLeader] }).code, 'FORBIDDEN');
  assert.equal(call(A, 'signoffRevoke', { entries: s1.batch }).removed, 2, '服務員撤銷自己簽的');
  assert.equal(call(L, 'signoffRevoke', { entries: s2.batch }).removed, 4, '團長復原整批');
  assert.equal(env.rows('完成紀錄').length, 0);
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '撤銷簽核'));
});

test('頒章：未完成不可頒、完成可頒並更新級別、未來日期與未滿間隔需確認、修改與撤銷', () => {
  const { env, call, L, cubId } = world();
  assert.match(call(L, 'award', { date: '2026-11-10', entries: [{ cubId, unit: '羚羊' }] }).message, /還沒全部完成/);
  call(L, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '羚羊'), date: '2026-10-01' });
  assert.match(call(L, 'award', { date: '2026-10-05', entries: [{ cubId, unit: '羚羊' }] }).message, /剛入團還沒有頒發紀錄/, '要先頒剛入團（黃領巾）');
  // 剛入團：項目完成但出席未滿 4 次 → 需確認後才頒
  call(L, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '剛入團'), date: '2026-09-01' });
  const nb = call(L, 'award', { date: '2026-09-02', entries: [{ cubId, unit: '剛入團' }] });
  assert.equal(nb.needConfirm, true);
  assert.match(nb.warnings[0], /出席 0／4 次/);
  assert.equal(call(L, 'award', { date: '2026-09-02', occasion: '黃領巾', entries: [{ cubId, unit: '剛入團' }], confirm: true }).added, 1);
  assert.equal(env.rows('小狼名單')[0][4], '剛入團');
  assert.match(call(L, 'award', { date: '2026-09-30', entries: [{ cubId, unit: '羚羊' }] }).message, /不可早於最後一個項目的完成日期/);
  const fut = call(L, 'award', { date: '2026-12-01', entries: [{ cubId, unit: '羚羊' }] });
  assert.equal(fut.needConfirm, true);
  assert.equal(env.rows('頒章紀錄').length, 1, '未確認前不寫入');
  const lw = call(L, 'award', { date: '2026-10-05', occasion: '10 月團集會', entries: [{ cubId, unit: '羚羊' }] });
  assert.match(lw.warnings[0], /出席 0／8 次/, '羚羊：剛入團頒發後要再出席 8 次');
  assert.equal(call(L, 'award', { date: '2026-10-05', occasion: '10 月團集會', entries: [{ cubId, unit: '羚羊' }], confirm: true }).added, 1);
  assert.equal(env.rows('小狼名單')[0][4], '羚羊', '目前級別更新');
  assert.match(call(L, 'award', { date: '2026-10-05', entries: [{ cubId, unit: '羚羊' }] }).message, /已經頒發過了/);
  // 狼級：項目完成但未滿 6 個月 → 需確認
  call(L, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '狼'), date: '2026-11-01' });
  const w = call(L, 'award', { date: '2026-11-10', entries: [{ cubId, unit: '狼' }] });
  assert.equal(w.needConfirm, true);
  assert.match(w.warnings[0], /出席 0／8 次/, '狼：羚羊頒發後出席未滿 8 次（晉級間隔另見純邏輯測試）');
  assert.equal(call(L, 'award', { date: '2026-11-10', entries: [{ cubId, unit: '狼' }], confirm: true }).added, 1);
  assert.equal(env.rows('小狼名單')[0][4], '狼');
  // 修改頒發日期
  assert.equal(call(L, 'awardEdit', { cubId, unit: '羚羊', date: '2026-10-06', occasion: '補辦', note: '' }).ok, true);
  assert.equal(env.rows('頒章紀錄').find((r) => r[1] === '羚羊')[2], '2026-10-06');
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '修改頒章' && String(r[4]).includes('2026-10-05')), '保留修改前的值');
  // 撤銷進程頒章 → 級別退回
  assert.equal(call(L, 'awardRevoke', { cubId, unit: '狼' }).ok, true);
  assert.equal(env.rows('小狼名單')[0][4], '羚羊');
});

test('補登：較低級別沒有紀錄先提示，一併補登後狀態正確且不發推播', () => {
  const { env, call, L, cubId } = world();
  const ask = call(L, 'backfill', { cubId, unit: '狼', date: '2025-12-01' });
  assert.deepEqual([...ask.missingLowerLevels], ['剛入團', '羚羊']);
  assert.equal(env.rows('頒章紀錄').length, 0);
  const r = call(L, 'backfill', { cubId, unit: '狼', date: '2025-12-01', includeLower: true });
  assert.deepEqual([...r.awarded], ['剛入團', '羚羊', '狼']);
  assert.equal(r.completions, 5 + 10 + 32);
  assert.ok(env.rows('完成紀錄').every((c) => c[4] === '上線補登' && c[2] === '2025-12-01'));
  assert.equal(env.rows('小狼名單')[0][4], '狼');
  assert.equal(env.sent.length, 0, '補登不推播');
  const b = call(L, 'backfill', { cubId, unit: '嚮導', date: '2025-06-01' });
  assert.equal(b.completions, 2);
  const d = call(L, 'cubAdminDetail', { cubId });
  assert.equal(d.units.find((u) => u.unit === '鹿').status, '進行中');
  assert.equal(d.units.find((u) => u.unit === '嚮導').status, '已頒發');
  assert.match(call(L, 'backfill', { cubId, unit: '嚮導', date: '2025-06-01' }).message, /已經有頒章紀錄/);
});

test('管理員：方式一指定、角色變更立即生效、最後一位團長與自己的保護、被移除後仍是家長', () => {
  const { env, call, L, A, P } = world();
  const acc = call(L, 'accountList').accounts;
  const parentId = acc.find((a) => a.username === 'parent01').accountId;
  const leaderId = acc.find((a) => a.username === 'leader01').accountId;
  const helperId = acc.find((a) => a.username === 'helper01').accountId;
  assert.equal(call(L, 'adminRemove', { accountId: leaderId }).code, 'BAD_INPUT', '不可移除自己');
  assert.equal(call(L, 'adminUpdate', { accountId: leaderId, role: '服務員' }).code, 'BAD_INPUT', '不可自行降級');
  assert.equal(call(L, 'adminAdd', { accountId: parentId, role: '服務員', name: '測試媽媽' }).ok, true);
  assert.equal(env.api({ action: 'me', token: P }).role, '服務員');
  assert.equal(call(P, 'signoffData').ok, true, '身分並存：家長兼服務員可簽核');
  assert.equal(call(L, 'adminUpdate', { accountId: helperId, role: '團長' }).ok, true);
  assert.equal(call(A, 'cubList').cubs[0].code.length, 6, '升為團長後權限立即改變');
  assert.equal(call(A, 'adminUpdate', { accountId: leaderId, role: '服務員' }).ok, true, '另一位團長可將原團長降級');
  assert.equal(call(L, 'cubSave', { name: 'x', joinDate: '2025-01-01' }).code, 'FORBIDDEN');
  assert.equal(call(L, 'adminRemove', { accountId: parentId }).code, 'FORBIDDEN');
  assert.equal(call(A, 'adminRemove', { accountId: parentId }).ok, true);
  const me = env.api({ action: 'me', token: P });
  assert.equal(me.role, null);
  assert.equal(me.cubs.length, 1, '被移除後仍可用家長身分查詢');
  assert.equal(call(A, 'adminUpdate', { accountId: helperId, role: '服務員' }).code, 'BAD_INPUT', '最後一位團長不可降級');
});

test('多分團：恢復邀請碼（指定分團、身分、職稱）、其他分團的人碰不到小狼、總團（SPEC 附錄第 68 點）', () => {
  const { env, call, L, A } = world();
  // 沒有管理員（admin）時，一般團長不能設定分團身分
  assert.equal(call(L, 'inviteCreate', { section: '童軍', role: '服務員' }).code, 'FORBIDDEN');
  assert.equal(call(L, 'staffList').code, 'FORBIDDEN');
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  assert.equal(call(O, 'me').canManageStaff, true);
  // 童軍服務員：用邀請碼註冊即生效；進的是童軍的後台（附錄第 73 點），碰不到小狼
  const inv = call(O, 'inviteCreate', { section: '童軍', role: '服務員', title: '副團長', name: '王童軍' });
  assert.match(inv.code, /^[A-Z2-9]{8}$/);
  const S = env.api({ action: 'register', code: inv.code, childName: '', username: 'scout01', password: 'scoutpass1', nickname: '王' }).token;
  const me = call(S, 'me');
  assert.equal(me.role, '服務員');
  assert.equal(me.section, '童軍');
  assert.deepEqual(me.sections, [{ section: '童軍', role: '服務員' }]);
  assert.deepEqual(me.staff, [{ section: '童軍', role: '服務員', title: '副團長' }]);
  assert.deepEqual(call(S, 'cubList').cubs, [], '童軍的名單裡沒有小狼');
  assert.equal(call(S, 'cubList', { _sec: '小狼' }).cubs.length, 0, '送 _sec=小狼 也沒用，後端只認自己有身分的分團');
  assert.equal(call(S, 'cubAdminDetail', { cubId: env.rows('小狼名單')[0][0] }).code, 'NOT_FOUND', '別的分團的團員找不到');
  for (const x of ['signoffData', 'overview']) assert.equal(call(S, x).ok, true, '童軍也有進程（附錄第 80 點）：' + x);
  assert.equal(call(S, 'adminList').code, 'FORBIDDEN', '服務員不能管理管理員');
  assert.ok(!call(L, 'adminList').admins.some((a) => a.name === '王童軍'), '小狼管理員名單不列其他分團');
  // 小狼服務員另外加一個童軍團長身分：小狼權限不變
  const helperId = call(O, 'accountList').accounts.find((a) => a.username === 'helper01').accountId;
  assert.equal(call(O, 'staffSave', { type: 'add', accountId: helperId, section: '童軍', role: '團長', title: '團長' }).ok, true);
  assert.equal(call(O, 'staffSave', { type: 'add', accountId: helperId, section: '童軍', role: '服務員' }).code, 'BAD_INPUT', '同一分團不重複');
  assert.equal(call(A, 'adminList').code, 'FORBIDDEN');
  assert.equal(call(A, 'signoffData').ok, true);
  // 兼任：切到童軍就是童軍團長（分團切換，_sec）
  assert.deepEqual(call(A, 'me').sections.map((x) => x.section + x.role), ['小狼服務員', '童軍團長']);
  assert.equal(call(A, 'me', { _sec: '童軍' }).role, '團長');
  assert.equal(call(A, 'adminList', { _sec: '童軍' }).ok, true);
  assert.equal(call(O, 'staffList').staff.filter((x) => x.accountId === helperId).length, 2);
  // 總團：小狼的團長權限；小狼管理員頁不能改他
  const inv2 = call(O, 'inviteCreate', { role: '總團', title: '團部' });
  const C = env.api({ action: 'register', code: inv2.code, childName: '', username: 'central01', password: 'centralpass1', nickname: '總團' }).token;
  assert.equal(call(C, 'me').isCentral, true);
  assert.equal(call(C, 'cubList').ok, true);
  assert.equal(call(C, 'adminList').ok, true);
  const centralId = call(O, 'staffList').staff.find((x) => x.role === '總團').accountId;
  assert.equal(call(L, 'adminList').admins.find((a) => a.accountId === centralId).central, true);
  assert.equal(call(L, 'adminUpdate', { accountId: centralId, role: '服務員', name: 'x' }).code, 'BAD_INPUT');
  // 總團只能邀請服務員；總團、團長要管理員（admin）
  assert.equal(call(C, 'inviteCreate', { section: '行義', role: '服務員' }).ok, true);
  assert.equal(call(C, 'inviteCreate', { section: '行義', role: '團長' }).code, 'BAD_INPUT');
  assert.equal(call(C, 'staffSave', { type: 'remove', accountId: helperId, key: '童軍' }).code, 'BAD_INPUT');
  assert.equal(call(O, 'staffSave', { type: 'update', accountId: helperId, key: '童軍', section: '童軍', role: '服務員', title: '服務員' }).ok, true);
  assert.equal(call(C, 'staffSave', { type: 'remove', accountId: helperId, key: '童軍' }).ok, true);
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '移除分團身分'));
  // 刪除帳號時，所有分團身分一起刪除（不能只刪小狼那一列）
  const scoutId = call(O, 'staffList').staff.find((x) => x.name === '王童軍').accountId;
  assert.equal(call(O, 'staffSave', { type: 'add', accountId: scoutId, section: '行義', role: '服務員' }).ok, true);
  assert.equal(call(L, 'accountDelete', { accountId: scoutId, confirmUsername: 'scout01' }).code, 'FORBIDDEN', '有 admin 後帳號管理預設只有 admin、總團');
  assert.equal(call(O, 'accountDelete', { accountId: scoutId, confirmUsername: 'scout01' }).ok, true);
  assert.equal(env.rows('管理員').filter((r) => r[0] === scoutId).length, 0, '其他分團的身分也要刪掉');
  // 之前留下的舊邀請碼（沒有分團欄）視為小狼，可以作廢
  const sh = env.sheet('管理員邀請');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 9).setValues([['OLDCODE2', '服務員', '', 'x', new Date(), new Date(Date.now() + 86400000), '未使用', '', '']]);
  assert.ok(call(L, 'inviteList').invites.some((i) => i.code === 'OLDCODE2'));
  assert.equal(call(L, 'inviteVoid', { code: 'OLDCODE2' }).ok, true);
  assert.equal(env.api({ action: 'checkCode', code: 'OLDCODE2', childName: '' }).code, 'CODE_INVALID');
});

test('帳號管理：臨時碼重設、停用、刪除（最後一位團長保護）', () => {
  const { env, call, L, P } = world();
  const acc = call(L, 'accountList').accounts;
  const parentId = acc.find((a) => a.username === 'parent01').accountId;
  const leaderId = acc.find((a) => a.username === 'leader01').accountId;
  const t = call(L, 'accountTempCode', { accountId: parentId });
  assert.match(t.code, /^[A-Z2-9]{8}$/);
  assert.match(t.message, /parent01/);
  assert.ok(!env.rows('帳號').flat().map(String).includes(t.code), '臨時碼只存雜湊');
  assert.ok(!env.rows('操作日誌').flat().map(String).join('|').includes(t.code), '日誌不記臨時碼');
  assert.equal(env.api({ action: 'me', token: P }).code, 'SESSION_EXPIRED', '產生臨時碼後該帳號登出');
  assert.equal(env.api({ action: 'resetPassword', username: 'parent01', tempCode: t.code, newPassword: 'newpass123' }).ok, true);
  assert.equal(call(L, 'accountStatus', { accountId: parentId, status: '停用' }).ok, true);
  assert.equal(env.api({ action: 'login', username: 'parent01', password: 'newpass123' }).code, 'BAD_LOGIN');
  assert.equal(call(L, 'accountStatus', { accountId: leaderId, status: '停用' }).code, 'BAD_INPUT', '不可停用自己');
  assert.equal(call(L, 'accountDelete', { accountId: parentId, confirmUsername: 'wrong' }).code, 'BAD_INPUT');
  assert.equal(call(L, 'accountDelete', { accountId: parentId, confirmUsername: 'parent01' }).ok, true);
  assert.equal(env.rows('帳號').length, 2);
  assert.equal(env.rows('綁定紀錄').length, 0);
  assert.equal(env.rows('小狼名單').length, 1, '小狼資料不受影響');
});

test('行事曆與點名：多筆新增、只列當天在團、同時點名不互相覆蓋、空白刪除、出席自動完成羚羊項目', () => {
  const { env, call, L, A, cubId } = world();
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '二小隊', joinDate: '2026-10-01' }).cubId;
  const r = call(L, 'meetingSave', { lines: '2026-09-05 團集會\n2026/9/12\n亂打一行\n2026-10-03 露營\n2026-11-14 團集會' });
  assert.equal(r.added, 4);
  assert.equal(r.bad.length, 1);
  const ms = call(A, 'meetingList');
  assert.equal(ms.meetings.find((m) => m.meetingId === ms.defaultId).date, '2026-11-14', '預設今天的集會');
  const m0 = ms.meetings[0];
  assert.deepEqual(call(A, 'attendanceSheet', { meetingId: m0.meetingId }).cubs.map((c) => c.cubId), [cubId], '9/5 小狼乙還沒入團');
  const today = ms.meetings[3];
  call(A, 'attendanceSave', { meetingId: today.meetingId, marks: { [cubId]: '出席' } });
  call(L, 'attendanceSave', { meetingId: today.meetingId, marks: { [c2]: '請假' } });
  const sheet = call(A, 'attendanceSheet', { meetingId: today.meetingId }).cubs;
  assert.deepEqual(sheet.map((c) => c.status), ['出席', '請假'], '兩人分別點名互不覆蓋');
  call(A, 'attendanceSave', { meetingId: today.meetingId, marks: { [c2]: '' } });
  assert.equal(env.rows('出席紀錄').length, 1, '空白＝刪除，不記缺席');
  assert.equal(call(A, 'attendanceSave', { meetingId: today.meetingId, marks: { [cubId]: '缺席' } }).code, 'BAD_INPUT');
  // 遲到（附錄第 61 點）：可以點、算出席人數
  assert.equal(call(A, 'attendanceSave', { meetingId: today.meetingId, marks: { [c2]: '遲到' } }).ok, true);
  assert.equal(call(A, 'meetingList').meetings.find((m) => m.meetingId === today.meetingId).attended, 2, '遲到算出席人數');
  call(A, 'attendanceSave', { meetingId: today.meetingId, marks: { [c2]: '' } });
  ms.meetings.slice(0, 3).forEach((m) => call(A, 'attendanceSave', { meetingId: m.meetingId, marks: { [cubId]: '出席' } }));
  assert.equal(call(L, 'cubAdminDetail', { cubId }).units.find((u) => u.unit === '羚羊').items[6].done, false, '還沒頒剛入團：不自動完成（附錄第 64 點）');
  call(L, 'backfill', { cubId, unit: '剛入團', date: '2026-09-01' });
  const lion7 = call(L, 'cubAdminDetail', { cubId }).units.find((u) => u.unit === '羚羊').items[6];
  assert.equal(lion7.done, true);
  assert.equal(lion7.date, '2026-11-14', '第 4 次出席');
  // 取消集會：不刪除，出席不再計算
  call(L, 'meetingSave', { meetingId: today.meetingId, enabled: false });
  assert.equal(call(L, 'cubAdminDetail', { cubId }).units.find((u) => u.unit === '羚羊').items[6].done, false);
});

test('年度出席設定、額外出席與出席總覽', () => {
  const { call, L, cubId } = world();
  call(L, 'meetingSave', { lines: '2026-09-05\n2026-09-12\n2026-09-19' });
  const ms = call(L, 'meetingList').meetings;
  call(L, 'attendanceSave', { meetingId: ms[0].meetingId, marks: { [cubId]: '出席' } });
  call(L, 'attendanceSave', { meetingId: ms[1].meetingId, marks: { [cubId]: '請假' } });
  assert.equal(call(L, 'periodSave', { name: '115學年度', start: '2026-08-01', end: '2027-07-31', total: 4 }).ok, true);
  assert.equal(call(L, 'extraSave', { period: '115學年度', cubId, count: 1, note: '露營' }).ok, true);
  const o = call(L, 'attendanceOverview', {});
  assert.deepEqual([...o.rows[0].cells], ['出席', '請假', '']);
  assert.equal(o.rows[0].rate, '50%', '(1 + 1) ÷ 4');
  call(L, 'extraSave', { period: '115學年度', cubId, count: 9 });
  assert.equal(call(L, 'attendanceOverview', {}).rows[0].rate, '100%');
});

test('個資處理：預覽列數、姓名確認、完全刪除各分頁無殘留、日誌不記姓名', () => {
  const { env, call, L, cubId } = world();
  call(L, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '羚羊').slice(0, 3), date: '2026-11-01' });
  call(L, 'meetingSave', { lines: '2026-11-07' });
  call(L, 'attendanceSave', { meetingId: call(L, 'meetingList').meetings[0].meetingId, marks: { [cubId]: '出席' } });
  const pv = call(L, 'privacyPreview', { cubId, mode: 'delete' });
  assert.equal(pv.counts['完成紀錄'], 3);
  assert.equal(pv.counts['出席紀錄'], 1);
  assert.equal(call(L, 'privacyExecute', { cubId, mode: 'delete', confirmName: '測試小狼' }).code, 'BAD_INPUT');
  assert.equal(call(L, 'privacyExecute', { cubId, mode: 'delete', confirmName: '測試小狼甲' }).ok, true);
  for (const s of ['小狼名單', '綁定紀錄', '完成紀錄', '頒章紀錄', '通知紀錄', '出席紀錄', '額外出席']) {
    assert.ok(!env.rows(s).some((r) => r.includes(cubId)), s + ' 無殘留');
  }
  const log = env.rows('操作日誌').flat().map(String).join('|');
  assert.ok(!log.includes('測試小狼甲'), '日誌中姓名已替換');
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '個資處理：完全刪除' && r[3] === '一位小狼'));
});

test('個資處理：匿名化保留統計、刪除綁定', () => {
  const { env, call, L, P, cubId } = world();
  call(L, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '羚羊').slice(0, 2), date: '2026-11-01' });
  assert.equal(call(L, 'privacyExecute', { cubId, mode: 'anonymize', confirmName: '測試小狼甲' }).ok, true);
  assert.equal(env.rows('小狼名單')[0][1], '已離團小狼1');
  assert.equal(env.rows('小狼名單')[0][7], '已匿名');
  assert.equal(env.rows('完成紀錄').length, 2, '統計保留');
  assert.equal(env.api({ action: 'me', token: P }).cubs.length, 0, '家長綁定已刪除');
});

test('備份：未設定資料夾提示、輪替保留份數、刪除所有舊備份；權限過寬警告', () => {
  const { env, call, L } = world();
  delete env.props.BACKUP_FOLDER_ID; // 模擬資料夾設定被移除
  assert.match(call(L, 'backupNow').message, /尚未設定備份資料夾/);
  assert.equal(JSON.parse(env.props.BACKUP_LAST).ok, false);
  env.props.BACKUP_FOLDER_ID = 'FOLDER';
  env.sheet('設定').getRange(1, 1, 30, 2).getValues().forEach((r, i) => { if (r[0] === '備份保留份數') env.sheet('設定').getRange(i + 1, 2).setValues([[2]]); });
  for (let i = 0; i < 3; i++) assert.equal(call(L, 'backupNow').ok, true);
  assert.equal(env.drive.files.filter((f) => !f.trashed).length, 2, '只保留 2 份');
  assert.equal(call(L, 'backupPurge').ok, true);
  assert.equal(env.drive.files.filter((f) => !f.trashed).length, 1);
  assert.equal(call(L, 'permCheck').ok, true);
  env.drive.sharing.file = 'ANYONE_WITH_LINK';
  const p = call(L, 'permCheck');
  assert.equal(p.ok, false);
  assert.match(p.issues[0], /知道連結的任何人/);
  assert.equal(call(L, 'adminHome').alerts.permission.ok, false, '首頁顯示警告');
  env.drive.failCopy = true;
  assert.equal(call(L, 'backupNow').ok, false);
  env.ctx.installBackupTrigger_();
  env.ctx.installBackupTrigger_();
  assert.equal(env.triggers.filter((t) => t.getHandlerFunction() === 'weeklyBackup').length, 1, '重複安裝不重複');
});

test('連結 LINE 通知：配對碼正確才連結並回覆；錯誤不回覆', () => {
  const { env, call, A } = world();
  const { code } = call(A, 'lineLinkStart');
  const hook = (text) => env.ctx.doPost({ parameter: { key: env.props.WEBHOOK_KEY }, postData: { contents: JSON.stringify({ events: [{ type: 'message', replyToken: 'r', source: { type: 'user', userId: 'Uline123' }, message: { type: 'text', text } }] }) } });
  env.props.LINE_MESSAGING_TOKEN = 'dummy';
  hook('000000');
  assert.equal(env.sent.length, 0);
  hook(code);
  assert.equal(env.sent.length, 1);
  assert.match(env.sent[0].body.messages[0].text, /已連結/);
  const helper = env.rows('管理員').find((r) => r[1] === '陳服務員');
  assert.equal(helper[5], 'Uline123');
  assert.equal(env.api({ action: 'me', token: A }).lineLinked, true);
  hook(code);
  assert.equal(env.sent.length, 1, '配對碼只能用一次');
  assert.ok(!env.rows('操作日誌').flat().map(String).join('|').includes('Uline123'), '日誌不記 LINE userId');
  assert.equal(call(A, 'lineUnlink').ok, true);
  assert.equal(env.api({ action: 'me', token: A }).lineLinked, false);
});

test('後台首頁：待頒章、快達標、離團逾期提醒、未連結 LINE 提示', () => {
  const { env, call, L, cubId } = world();
  call(L, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '環保'), date: '2026-11-01' });
  call(L, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '嚮導').slice(0, 1), date: '2026-11-01' });
  const h = call(L, 'adminHome');
  assert.ok(h.pending.some((p) => p.unit === '環保' && p.name === '測試小狼甲'));
  assert.ok(h.near.some((p) => p.unit === '嚮導' && p.remaining === 1));
  assert.equal(h.alerts.noLineAdmin, true);
  const old = call(L, 'cubSave', { name: '測試小狼丙', joinDate: '2024-01-01' }).cubId;
  call(L, 'cubLeave', { cubId: old, leftDate: '2026-01-01' });
  assert.deepEqual(call(L, 'adminHome').alerts.privacyOverdue.map((c) => c.name), ['測試小狼丙']);
  env.sheet('項目總表').getRange(200, 1, 1, 7).setValues([['B-壞-1', '技能章', '', '', '缺章名', 1, '是']]);
  assert.equal(call(L, 'adminHome').alerts.itemErrors[0].row, 200);
});

test('列印簽核單：依小隊多位小狼、服務員可列印', () => {
  const { env, call, L, A, cubId } = world();
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '一小隊', joinDate: '2025-09-01' }).cubId;
  call(A, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '狼').slice(0, 1), date: '2026-11-01' });
  const r = call(A, 'printData', { unit: '狼', cubIds: [cubId, c2] });
  assert.equal(r.sheets.length, 2);
  assert.equal(r.sheets[0].items.length, 32);
  assert.equal(r.sheets[0].items[0].signer, '陳服務員');
  assert.equal(r.sheets[1].items[0].done, false);
  assert.match(r.rule, /參與羚羊級/);
  assert.equal(call(A, 'printData', { unit: '嚮導', cubIds: [cubId] }).code, 'BAD_INPUT');
});

test('小隊清單：新增、新增小狼只能選清單內、改名同步更新小狼、使用中不可刪', () => {
  const { env, call, L, A, cubId } = world();
  assert.match(call(L, 'cubSave', { name: '測試小狼乙', squad: '黑豹小隊', joinDate: '2025-09-01' }).message, /不在小隊清單/);
  assert.equal(call(A, 'squadSave', { type: 'add', name: '黑豹小隊' }).code, 'FORBIDDEN', '服務員不可改小隊');
  call(L, 'squadSave', { type: 'add', name: '黑豹小隊' });
  call(L, 'squadSave', { type: 'add', name: '灰狼小隊' });
  assert.equal(env.rows('設定').find((r) => r[0] === '小隊清單')[1], '一小隊、二小隊、黑豹小隊、灰狼小隊');
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '黑豹小隊', joinDate: '2025-09-01' }).cubId;
  assert.ok(c2);
  assert.deepEqual([...call(L, 'cubList').squads], ['一小隊', '二小隊', '黑豹小隊', '灰狼小隊'], '依清單順序');
  // 直接改試算表造成「不在清單」的舊名稱：仍會出現在小隊選項後面，避免小狼被藏起來
  const row = env.rows('小狼名單').findIndex((x) => x[0] === cubId) + 2;
  env.sheet('小狼名單').getRange(row, 3).setValues([['舊小隊']]);
  assert.deepEqual([...call(L, 'cubList').squads].slice(-1), ['舊小隊']);
  assert.deepEqual(call(L, 'squadList').notInList.map((x) => x.name), ['舊小隊']);
  const r = call(L, 'squadSave', { type: 'rename', name: '黑豹小隊', newName: '豹豹小隊' });
  assert.equal(r.moved, 1);
  assert.equal(env.rows('小狼名單').find((x) => x[0] === c2)[2], '豹豹小隊');
  assert.match(call(L, 'squadSave', { type: 'remove', name: '豹豹小隊' }).message, /還有在團小狼/);
  call(L, 'squadSave', { type: 'move', name: '灰狼小隊', dir: 'up' });
  assert.deepEqual([...call(L, 'squadSave', { type: 'remove', name: '灰狼小隊' }).squads], ['一小隊', '二小隊', '豹豹小隊']);
  assert.equal(call(L, 'cubSave', { cubId, name: '測試小狼甲', squad: '', joinDate: '2025-03-01' }).ok, true, '小隊可留空');
});

// ═════ 新的註冊方式：送出申請、團長審核（SPEC 附錄第 31 點） ═════
function apply(env, username, data) {
  const v = env.api({ action: 'consentText' }).version;
  return env.api({ action: 'register', username, password: 'applypass1', consentVersion: v, ...data });
}

test('註冊申請：家長選身分、填孩子姓名；需同意；送出後可登入但看不到孩子，等待審核', () => {
  const { env, call } = world();
  assert.match(apply(env, 'mom02', { nickname: '王小明媽媽', childNames: ['王小明'] }).message, /請選擇身分/);
  assert.match(apply(env, 'mom02', { identity: '家長', nickname: '王小明媽媽', childNames: [' ', ''] }).message, /孩子的姓名/);
  const noConsent = env.api({ action: 'register', identity: '家長', username: 'mom02', password: 'applypass1', nickname: '王小明媽媽', childNames: ['王小明'] });
  assert.equal(noConsent.code, 'NEED_CONSENT');
  assert.equal(env.rows('帳號').filter((r) => r[1] === 'mom02').length, 0, '沒同意不建立任何資料');

  const r = apply(env, 'mom02', { identity: '家長', nickname: '王小明媽媽', childNames: ['王小明', '王 小 華', '王小明'] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = env.rows('註冊申請').filter((x) => x[5] === '待審核');
  assert.deepEqual(rows.map((x) => [x[2], x[3], x[5]]), [['孩子', '王小明', '待審核'], ['孩子', '王小華', '待審核']], '去空白、去重複');
  assert.ok(rows.every((x) => x[9] >= 1), '記錄同意版本');
  const me = call(r.token, 'me');
  assert.deepEqual(me.cubs, []);
  assert.equal(me.role, null);
  assert.deepEqual(me.requests.map((x) => [x.type, x.name, x.status]), [['孩子', '王小明', '待審核'], ['孩子', '王小華', '待審核']]);
  assert.ok(!JSON.stringify(me.requests).includes('U'), '不回傳帳號ID');
  assert.equal(env.rows('綁定紀錄').filter((b) => b[0] === env.rows('帳號').find((a) => a[1] === 'mom02')[0]).length, 0, '核准前沒有綁定');
});

test('註冊申請：團長審核——新增小狼、同名孩子連結到同一位、退回；服務員看不到審核', () => {
  const { env, call, L, A } = world();
  const mom = apply(env, 'mom02', { identity: '家長', nickname: '王小明媽媽', childNames: ['王小明'] });
  const dad = apply(env, 'dad02', { identity: '家長', nickname: '王小明爸爸', childNames: ['王小明'] });
  const fake = apply(env, 'fake02', { identity: '家長', nickname: '路人', childNames: ['不認識'] });
  assert.equal(call(A, 'requestList').code, 'FORBIDDEN', '服務員不能審核');
  assert.equal(call(A, 'requestApprove', { requestId: 'x' }).code, 'FORBIDDEN');
  assert.equal(call(L, 'adminHome').alerts.pendingRequests, 3);
  assert.equal(call(A, 'adminHome').alerts.pendingRequests, 0);

  let list = call(L, 'requestList');
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.squads, ['一小隊', '二小隊']);
  const [m, d, f] = list.items;
  assert.equal(m.nickname, '王小明媽媽');
  assert.equal(m.accountId, undefined, '不回傳帳號ID');
  assert.match(call(L, 'requestApprove', { requestId: m.requestId, mode: 'new', name: '王小明', squad: '不存在小隊', joinDate: '2026-11-01' }).message, /不在小隊清單/);
  const ok = call(L, 'requestApprove', { requestId: m.requestId, mode: 'new', name: '王小明', squad: '一小隊', joinDate: '2026-11-01' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const cub = env.rows('小狼名單').find((c) => c[1] === '王小明');
  assert.deepEqual([cub[2], cub[3], cub[7]], ['一小隊', '2026-11-01', '在團']);
  assert.equal(call(mom.token, 'me').cubs[0].name, '王小明', '家長核准後看得到孩子');
  assert.equal(call(mom.token, 'cubDetail', { cubId: cub[0] }).ok, true);
  const req = env.rows('註冊申請').find((x) => x[8] === cub[0]);
  assert.deepEqual([req[3], req[5], req[8]], ['', '已核准', cub[0]], '結案後清掉填寫姓名，只留小狼ID');
  assert.equal(call(L, 'requestApprove', { requestId: m.requestId, mode: 'new', squad: '一小隊', joinDate: '2026-11-01' }).code, 'NOT_FOUND', '不可重複核准');

  // 爸爸申請同一個孩子：列表提示同名小狼，連結到同一位
  list = call(L, 'requestList');
  assert.deepEqual(list.items.find((x) => x.requestId === d.requestId).sameName, [cub[0]]);
  assert.equal(call(L, 'requestApprove', { requestId: d.requestId, mode: 'link', cubId: cub[0] }).ok, true);
  assert.equal(env.rows('小狼名單').filter((c) => c[1] === '王小明').length, 1, '沒有重複建立');
  assert.equal(call(dad.token, 'me').cubs[0].cubId, cub[0]);

  // 退回：清掉姓名，申請人看得到團長的備註
  assert.equal(call(L, 'requestReject', { requestId: f.requestId, note: '本團沒有這位小狼，請聯絡團長' }).ok, true);
  const me = call(fake.token, 'me');
  assert.deepEqual(me.requests.map((x) => [x.status, x.name, x.note]), [['已退回', '', '本團沒有這位小狼，請聯絡團長']]);
  assert.equal(call(L, 'adminHome').alerts.pendingRequests, 0);
  assert.ok(env.rows('操作日誌').some((x) => x[2] === '核准孩子申請') && env.rows('操作日誌').some((x) => x[2] === '退回註冊申請'));
});

test('註冊申請：服務員（含家長服務員）核准後成為服務員；也可以同時申請孩子', () => {
  const { env, call, L } = world();
  const s = env.api({ action: 'register', identity: '服務員', username: 'staff02', password: 'applypass1', nickname: '林服務員' });
  assert.equal(s.ok, true, '服務員沒有填孩子時不需要同意個資告知：' + JSON.stringify(s));
  const both = apply(env, 'staff03', { identity: '服務員', nickname: '李服務員', childNames: ['李小美'] });
  assert.equal(both.ok, true);
  const list = call(L, 'requestList').items;
  assert.deepEqual(list.map((x) => [x.type, x.name]), [['服務員', '林服務員'], ['孩子', '李小美'], ['服務員', '李服務員']]);
  assert.equal(call(L, 'requestApprove', { requestId: list[0].requestId, name: '林老師' }).ok, true);
  const me = call(s.token, 'me');
  assert.deepEqual([me.role, me.adminName], ['服務員', '林老師']);
  assert.equal(call(s.token, 'signoffData').ok, true, '核准後可以用後台');
  // 團長也可以把「家長」帳號改成服務員（沿用管理員指定），之後再送的服務員申請直接結案
  call(L, 'requestApprove', { requestId: list[2].requestId });
  assert.equal(call(both.token, 'me').role, '服務員');
});

test('註冊申請：已登入家長申請第二個孩子、24 小時上限、刪除帳號一併刪除申請', () => {
  const { env, call, L, P } = world();
  const v = env.api({ action: 'consentText' }).version;
  assert.equal(call(P, 'requestChildren', { childNames: ['測試小狼乙'] }).code, 'NEED_CONSENT');
  assert.equal(call(P, 'requestChildren', { childNames: ['測試小狼乙'], consentVersion: v }).added, 1);
  assert.match(call(P, 'requestChildren', { childNames: ['測試小狼乙'], consentVersion: v }).message, /已經在等待審核/);
  assert.equal(call(P, 'me').requests.length, 1);

  env.sheet('設定').getRange(env.rows('設定').findIndex((r) => r[0] === '每日註冊申請上限') + 2, 2).setValues([['5']]);
  for (let i = 0; i < 3; i++) assert.equal(apply(env, 'many0' + i, { identity: '家長', nickname: '家長' + i, childNames: ['孩子' + i] }).ok, true);
  assert.equal(apply(env, 'many09', { identity: '家長', nickname: '家長9', childNames: ['孩子9'] }).code, 'LOCKED', '24 小時內第 6 個帳號被擋（服務員、家長甲申請孩子也各算一個）');
  const acc = call(L, 'accountList').accounts.find((a) => a.username === 'many00');
  assert.equal(call(L, 'accountDelete', { accountId: acc.accountId, confirmUsername: 'many00' }).ok, true);
  assert.equal(env.rows('註冊申請').filter((r) => r[1] === acc.accountId).length, 0, '刪除帳號一併刪除申請');

  env.advance(86400000 + 1000);
  assert.equal(apply(env, 'many09', { identity: '家長', nickname: '家長9', childNames: ['孩子9'] }).ok, true, '過 24 小時恢復');
});

test('註冊申請：舊的代碼註冊仍可用（第一位團長邀請碼、既有綁定碼）', () => {
  const { env, code } = world();
  const v = env.api({ action: 'consentText' }).version;
  const r = env.api({ action: 'register', code, childName: '測試小狼甲', username: 'parent09', password: 'parentpass1', nickname: '測試小狼甲爸爸', consentVersion: v });
  assert.equal(r.ok, true);
});


test('設定頁：讀取、修改（檢查範圍、寫操作日誌）、服務員不能改、個資說明改版', () => {
  const { env, call, L, A, P } = world();
  assert.equal(call(A, 'settingsGet').code, 'FORBIDDEN');
  assert.equal(call(A, 'settingsSave', { changes: { '晉級所需出席次數': '8' } }).code, 'FORBIDDEN');
  const g = call(L, 'settingsGet');
  assert.ok(!g.settings.some((x) => x.key === '小隊清單'), '小隊清單在專屬頁面改');
  assert.equal(g.settings.find((x) => x.key === '晉級所需出席次數').value, '8');
  assert.match(call(L, 'settingsSave', { changes: { '晉級所需出席次數': '999' } }).message, /0～100 的整數/);
  assert.match(call(L, 'settingsSave', { changes: { '每週備份': '好' } }).message, /是」或「否/);
  assert.match(call(L, 'settingsSave', { changes: { '不存在': '1' } }).message, /不支援/);
  const r = call(L, 'settingsSave', { changes: { '晉級所需出席次數': '6', '每週備份': '否', '剛入團所需出席次數': '4' } });
  assert.equal(r.changed, 2, '沒變的不算');
  const v = env.ctx.loadSettings_().values;
  assert.deepEqual([v['晉級所需出席次數'], v['每週備份']], [6, false]);
  assert.ok(env.rows('操作日誌').some((x) => x[2] === '修改設定' && x[3] === '晉級所需出席次數' && String(x[4]) === '8' && String(x[5]) === '6'), '記錄修改前後');
  // 個資說明改版：家長下次要重新同意
  assert.match(call(L, 'consentSave', { content: '太短' }).message, /太短/);
  const c = call(L, 'consentSave', { content: '親愛的家長您好：這是第二版的個資說明，內容有更新，請重新閱讀。' });
  assert.equal(c.version, 2);
  assert.equal(env.rows('告知同意內容').length, 3, '舊版保留（另有羅浮本人版一列）');
  assert.equal(call(P, 'me').needsConsent, true);
  assert.match(call(L, 'consentSave', { content: '親愛的家長您好：這是第二版的個資說明，內容有更新，請重新閱讀。' }).message, /沒有變更/);
});

// ═════ 項目管理（SPEC 7.7，階段 4B） ═════
test('項目管理：樹狀資料、改文字（ID 不變）、新增（自動 ID、影響預覽）、停用與重新啟用、排序', () => {
  const { env, call, L, A, cubId } = world();
  assert.equal(call(A, 'itemsTree').code, 'FORBIDDEN', '服務員不能管理項目');
  const t = call(L, 'itemsTree');
  assert.equal(t.items.length, 168);
  assert.ok(t.units.some((u) => u.unit === '剛入團') && t.units.some((u) => u.unit === '嚮導' && u.group === '服務類'));
  assert.ok(t.details.length >= 375);
  // 改文字：ID 不變、寫日誌
  assert.equal(call(L, 'itemSave', { id: 'P-狼-國旗-1', text: '能說出升降旗的禮節（團改寫）' }).changed, 1);
  const row = env.rows('項目總表').find((r) => r[0] === 'P-狼-國旗-1');
  assert.equal(row[4], '能說出升降旗的禮節（團改寫）');
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '修改項目' && /參與升降旗/.test(r[4])), '記錄修改前');
  // 讓小狼的嚮導全部完成 → 已完成待頒發；新增嚮導項目要先看到影響預覽
  const guide = env.rows('項目總表').filter((r) => r[2] === '嚮導' && !r[7]).map((r) => r[0]);
  call(L, 'signoff', { cubIds: [cubId], itemIds: guide, date: '2026-10-01' });
  const add = call(L, 'itemSave', { category: '技能章', unit: '嚮導', text: '能帶家人走一次自己規劃的路線' });
  assert.equal(add.needConfirm, true);
  assert.match(add.warnings[0], /1 位團員的「嚮導」從「已完成待頒發」變成「進行中」：測試小狼甲/);
  assert.equal(env.rows('項目總表').filter((r) => r[2] === '嚮導' && !r[7]).length, 2, '未確認前不寫入');
  const ok = call(L, 'itemSave', { category: '技能章', unit: '嚮導', text: '能帶家人走一次自己規劃的路線', confirm: true });
  assert.equal(ok.id, 'B-嚮導-3', '序號取最大 + 1');
  // 停用剛新增的 → 又回到已完成待頒發（預覽提示）
  const off = call(L, 'itemToggle', { id: 'B-嚮導-3', enabled: false });
  assert.match(off.warnings[0], /從「進行中」變成「已完成待頒發」/);
  assert.equal(call(L, 'itemToggle', { id: 'B-嚮導-3', enabled: false, confirm: true }).changed, 1);
  assert.equal(env.rows('項目總表').find((r) => r[0] === 'B-嚮導-3')[6], '否', '只停用不刪除');
  // 停用後再新增，序號不重用
  assert.equal(call(L, 'itemSave', { category: '技能章', unit: '嚮導', text: '另一項', confirm: true }).id, 'B-嚮導-4');
  // 排序：同一大項內上移
  const wolfFlag = () => call(L, 'itemsTree').items.filter((i) => i.unit === '狼' && i.section === '國旗').sort((a, b) => a.order - b.order).map((i) => i.id);
  const before = wolfFlag();
  call(L, 'itemMove', { id: before[1], dir: 'up' });
  assert.deepEqual(wolfFlag(), [before[1], before[0], ...before.slice(2)]);
  assert.equal(call(L, 'itemMove', { id: before[1], dir: 'up' }).changed, 0, '已經在最上面');
  // 公開查詢立即看到新文字（清快取）
  const cat = env.api({ action: 'catalog' });
  assert.ok(cat.units.find((u) => u.unit === '狼').items.some((i) => i.text === '能說出升降旗的禮節（團改寫）'));
});

test('項目管理：大項改名、技能章新增與改名（有頒章紀錄不能改）、說明、本團細項、匯出', () => {
  const { env, call, L, cubId } = world();
  assert.equal(call(L, 'sectionRename', { category: '進程', unit: '狼', section: '蒐集', newName: '收藏' }).changed, 1);
  assert.equal(env.rows('項目總表').find((r) => r[0] === 'P-狼-蒐集-1')[3], '收藏', 'ID 不變');
  assert.match(call(L, 'sectionRename', { category: '進程', unit: '狼', section: '收藏', newName: '國旗' }).message, /已經有/);
  // 新增技能章 → 新增項目
  assert.match(call(L, 'unitSave', { category: '技能章', unit: '露營', isNew: true, group: '不存在' }).message, /分類/);
  assert.equal(call(L, 'unitSave', { category: '技能章', unit: '露營', isNew: true, group: '技巧類', desc: '本團自訂' }).unit, '露營');
  assert.equal(call(L, 'itemSave', { category: '技能章', unit: '露營', text: '能自己打包過夜裝備' }).id, 'B-露營-1');
  assert.equal(call(L, 'unitSave', { category: '技能章', unit: '露營', group: '技巧類', newName: '野營' }).unit, '野營');
  assert.equal(env.rows('項目總表').find((r) => r[0] === 'B-露營-1')[2], '野營', '項目跟著改章名、ID 不變');
  call(L, 'backfill', { cubId, unit: '嚮導', date: '2025-06-01' });
  assert.match(call(L, 'unitSave', { category: '技能章', unit: '嚮導', group: '服務類', newName: '導遊' }).message, /已經有頒章紀錄/);
  assert.match(call(L, 'unitSave', { category: '進程', unit: '狼', newName: '大狼' }).message, /不能改名/);
  // 晉級條件與說明
  call(L, 'unitSave', { category: '進程', unit: '剛入團', desc: '新的說明', rule: '新的晉級條件' });
  const nb = env.rows('級別與章說明').find((r) => r[0] === '剛入團');
  assert.deepEqual([nb[3], nb[4]], ['新的說明', '新的晉級條件']);
  // 本團細項：新增、修改（核對原內容）、停用
  call(L, 'detailSave', { itemId: 'P-狼-國旗-1', group: '國旗禮節', text: '升旗時立正', standard: '連續 3 次', life: '學校升旗' });
  let d = call(L, 'itemsTree').details.find((x) => x.text === '升旗時立正');
  assert.ok(d && d.enabled);
  assert.match(call(L, 'detailSave', { key: d.key, origItemId: d.itemId, origText: '別的內容', itemId: d.itemId, text: 'x' }).message, /剛剛被修改過/);
  call(L, 'detailSave', { key: d.key, origItemId: d.itemId, origText: d.text, itemId: d.itemId, group: '國旗禮節', text: '升旗時立正並注目' });
  call(L, 'detailToggle', { key: d.key, origItemId: d.itemId, origText: '升旗時立正並注目', enabled: false });
  d = call(L, 'itemsTree').details.find((x) => x.key === d.key);
  assert.deepEqual([d.text, d.enabled], ['升旗時立正並注目', false]);
  // 匯出
  const ex = call(L, 'itemsExport');
  assert.match(ex.csv, /^項目ID,類別/);
  assert.match(ex.csv, /B-露營-1,技能章,野營/);
  assert.ok(env.rows('操作日誌').filter((r) => ['大項改名', '新增技能章', '技能章改名', '修改說明', '新增細項', '修改細項', '停用細項'].includes(r[2])).length >= 7);
});

// ═════ 體驗者（SPEC 附錄第 40 點） ═════
test('體驗者：團長新增 → 只算一般團集會 → 滿 4 次提醒 → 轉為入團 → 剛入團出席只算入團後', () => {
  const { env, call, L, A } = world();
  const t = call(L, 'cubSave', { trial: true, name: '測試體驗丙', squad: '一小隊', trialStart: '2026-09-01' });
  assert.equal(t.ok, true, JSON.stringify(t));
  const cub = env.rows('小狼名單').find((r) => r[1] === '測試體驗丙');
  assert.deepEqual([cub[3], cub[7], cub[9]], ['', '體驗', '2026-09-01'], '沒有入團日、狀態體驗、記錄體驗開始日');
  // 行事曆：名稱有「大活動」自動標成大活動
  call(L, 'meetingSave', { lines: '2026-09-06 團集會\n2026-09-13 團集會\n2026-09-20 秋季露營大活動\n2026-09-27 團集會\n2026-10-04 團集會\n2026-10-11 團集會\n2026-10-18 團集會' });
  const ms = call(L, 'meetingList').meetings.filter((m) => m.date >= '2026-09-06' && m.date <= '2026-10-18');
  assert.deepEqual(ms.map((m) => m.type), ['一般', '一般', '大活動', '一般', '一般', '一般', '一般']);
  const big = ms[2];
  assert.ok(!call(A, 'attendanceSheet', { meetingId: big.meetingId }).cubs.some((c) => c.cubId === cub[0]), '大活動點名不列體驗者');
  const s1 = call(A, 'attendanceSheet', { meetingId: ms[0].meetingId });
  assert.equal(s1.cubs.find((c) => c.cubId === cub[0]).trial, true, '一般團集會列出體驗者並標示');
  // 出席 3 次一般 + 1 次請假
  [0, 1, 3].forEach((i) => call(A, 'attendanceSave', { meetingId: ms[i].meetingId, marks: { [cub[0]]: '出席' } }));
  call(A, 'attendanceSave', { meetingId: ms[4].meetingId, marks: { [cub[0]]: '請假' } });
  let home = call(L, 'adminHome');
  let tr = home.trials.find((x) => x.cubId === cub[0]);
  assert.deepEqual([tr.count, tr.need, tr.ready], [3, 4, false]);
  const early = call(L, 'cubJoin', { cubId: cub[0], joinDate: '2026-10-05' });
  assert.equal(early.needConfirm, true);
  assert.match(early.warnings[0], /3／4 次一般團集會/);
  assert.equal(call(A, 'cubJoin', { cubId: cub[0] }).code, 'FORBIDDEN', '服務員不能轉入團');
  call(A, 'attendanceSave', { meetingId: ms[5].meetingId, marks: { [cub[0]]: '出席' } });
  home = call(L, 'adminHome');
  assert.equal(home.trials.find((x) => x.cubId === cub[0]).ready, true, '滿 4 次可以入團');
  // 家長端（綁定後）看得到體驗進度
  const v = env.api({ action: 'consentText' }).version;
  const pa = env.api({ action: 'register', identity: '家長', username: 'trialmom', password: 'trialpass1', nickname: '體驗丙媽媽', childNames: ['測試體驗丙'], consentVersion: v });
  const rq = call(L, 'requestList').items.find((x) => x.name === '測試體驗丙');
  assert.deepEqual(rq.sameName, [cub[0]], '審核時可連結到體驗者');
  call(L, 'requestApprove', { requestId: rq.requestId, mode: 'link', cubId: cub[0] });
  const pv = call(pa.token, 'cubDetail', { cubId: cub[0] });
  assert.equal(pv.cub.status, '體驗');
  assert.deepEqual([pv.trial.count, pv.trial.need], [4, 4]);
  assert.ok(!pv.attendance.meetings.some((m) => m.name.includes('大活動')), '體驗者的出席紀錄不列大活動');
  // 轉為入團
  assert.match(call(L, 'cubJoin', { cubId: cub[0], joinDate: '2026-08-01' }).message, /不可早於體驗開始日/);
  assert.equal(call(L, 'cubJoin', { cubId: cub[0], joinDate: '2026-10-12' }).joinDate, '2026-10-12');
  const joined = env.rows('小狼名單').find((r) => r[0] === cub[0]);
  assert.deepEqual([joined[3], joined[7]], ['2026-10-12', '在團']);
  assert.equal(call(L, 'cubJoin', { cubId: cub[0] }).message, '這位小狼不是體驗者。');
  // 剛入團：體驗期間的出席不算，入團後要再出席 4 次
  call(L, 'signoff', { cubIds: [cub[0]], itemIds: itemsOf(env, '剛入團'), date: '2026-10-18' });
  call(A, 'attendanceSave', { meetingId: ms[6].meetingId, marks: { [cub[0]]: '出席' } });
  const nb = call(L, 'cubAdminDetail', { cubId: cub[0] }).units.find((u) => u.unit === '剛入團');
  assert.deepEqual([nb.status, nb.eligible, nb.attendSinceLast, nb.attendRequired], ['已完成待頒發', false, 1, 4], '只算入團後的 1 次');
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '體驗者轉為入團'));
});

test('名單直接編輯：一次改多位的姓名、小隊、入團日；全部檢查通過才寫入；服務員不能改', () => {
  const { env, call, L, A, cubId } = world();
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '', joinDate: '2025-09-01' }).cubId;
  assert.equal(call(A, 'cubBatchSave', { changes: [{ cubId, squad: '二小隊' }] }).code, 'FORBIDDEN');
  assert.match(call(L, 'cubBatchSave', { changes: [{ cubId, squad: '二小隊' }, { cubId: c2, squad: '不存在小隊' }] }).message, /不在小隊清單/);
  assert.equal(env.rows('小狼名單').find((r) => r[0] === cubId)[2], '一小隊', '有錯就整批不寫入');
  const r = call(L, 'cubBatchSave', { changes: [{ cubId, squad: '二小隊' }, { cubId: c2, squad: '一小隊', name: '測試小狼乙乙', joinDate: '2025-10-01' }, { cubId, squad: '二小隊' }] });
  assert.equal(r.changed, 2);
  const rows = env.rows('小狼名單');
  assert.equal(rows.find((x) => x[0] === cubId)[2], '二小隊');
  assert.deepEqual(rows.find((x) => x[0] === c2).slice(1, 4), ['測試小狼乙乙', '一小隊', '2025-10-01']);
  assert.ok(env.rows('操作日誌').some((x) => x[2] === '編輯小狼' && x[3] === c2 && /測試小狼乙／／2025-09-01/.test(x[4])), '記錄修改前');
  assert.match(call(L, 'cubBatchSave', { changes: [{ cubId, name: ' ' }] }).message, /姓名不可空白/);
});

// ═════ 2026-11-15 全面檢查發現的問題 ═════
test('體驗者的綁定碼可以用（修正：後台顯示了綁定碼，家長輸入卻被拒絕）', () => {
  const { env, call, L } = world();
  const t = call(L, 'cubSave', { trial: true, name: '測試體驗戊', squad: '', trialStart: '2026-09-01' });
  const v = env.api({ action: 'consentText' }).version;
  const r = env.api({ action: 'register', code: t.code, childName: '測試體驗戊', username: 'trialdad', password: 'trialpass1', nickname: '體驗戊爸爸', consentVersion: v });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(call(r.token, 'me').cubs[0].name, '測試體驗戊');
});

test('admin 是保留帳號：不能用公開註冊搶先註冊；選單重設密碼時一併解除登入鎖定', () => {
  const { env, call } = world();
  for (const u of ['admin', 'Admin', 'ADMIN']) {
    assert.equal(env.api({ action: 'register', identity: '服務員', username: u, password: 'whatever12', nickname: '路人' }).code, 'NAME_TAKEN', u);
  }
  env.ctx.menuDefaultAdmin();
  // 有人故意輸錯密碼把 admin 鎖住
  for (let i = 0; i < 6; i++) env.api({ action: 'login', username: 'admin', password: 'wrongwrong' });
  env.ctx.menuDefaultAdmin();
  const pw = /密碼：(\S+)/.exec(env.ui.alerts.at(-1))[1];
  const r = env.api({ action: 'login', username: 'admin', password: pw });
  assert.equal(r.ok, true, '重設後可以馬上登入：' + JSON.stringify(r));
});

// ═════ 階段 5：LINE 主動通知（SPEC 第八節） ═════
function linkLine(env, call, token, userId) {
  const code = call(token, 'lineLinkStart').code;
  env.ctx.doPost({ parameter: { key: env.props.WEBHOOK_KEY }, postData: { contents: JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text: code }, source: { type: 'user', userId }, replyToken: 'r' }] }) } });
}
const say = (env, text, userId) => env.ctx.doPost({ parameter: { key: env.props.WEBHOOK_KEY }, postData: { contents: JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text }, source: { type: 'user', userId }, replyToken: 'rt' }] }) } });
const pushes = (env) => env.sent.filter((x) => /multicast/.test(x.url));

test('LINE 通知：新達標推播一次（Flex＋前往頒章）、不重複、撤銷後清除可再通知、頒章後清除', () => {
  const { env, call, L, A, cubId } = world();
  env.props.LINE_MESSAGING_TOKEN = 'test-token';
  const guide = itemsOf(env, '嚮導');
  call(A, 'signoff', { cubIds: [cubId], itemIds: guide, date: '2026-10-01' });
  assert.equal(pushes(env).length, 0, '沒有人連結 LINE：不推播');
  assert.equal(env.rows('通知紀錄').length, 0, '也不寫紀錄，之後連結了才通知');
  linkLine(env, call, L, 'Uleader');
  env.ctx.runDaily_();
  assert.equal(pushes(env).length, 1);
  const m = pushes(env)[0].body;
  assert.deepEqual(m.to, ['Uleader']);
  assert.equal(m.messages[0].type, 'flex');
  const json = JSON.stringify(m.messages[0]);
  assert.match(json, /測試小狼甲/); assert.match(json, /嚮導技能章/); assert.match(json, /前往頒章/);
  assert.match(json, new RegExp('#award=' + encodeURIComponent(cubId + ',嚮導')));
  assert.deepEqual(env.rows('通知紀錄').map((r) => [r[0], r[1], r[2]]), [[cubId, '嚮導', '達標']]);
  env.ctx.runDaily_();
  call(A, 'signoff', { cubIds: [cubId], itemIds: guide, date: '2026-10-01' });
  assert.equal(pushes(env).length, 1, '同一小狼同一章只通知一次');
  // 撤銷 → 清除紀錄；重新簽核 → 再通知
  call(L, 'signoffRevoke', { entries: [{ cubId, itemId: guide[0] }] });
  assert.equal(env.rows('通知紀錄').length, 0);
  call(A, 'signoff', { cubIds: [cubId], itemIds: [guide[0]], date: '2026-10-02' });
  assert.equal(pushes(env).length, 2, '簽核後即時通知');
  // 頒章後不再達標 → 清除
  call(L, 'award', { date: '2026-10-05', entries: [{ cubId, unit: '嚮導' }] });
  assert.equal(env.rows('通知紀錄').length, 0);
  assert.equal(pushes(env).length, 2);
});

test('LINE 通知：多位合併一則、再提醒只一次、推播失敗記錄並在首頁標示、家長不會收到', () => {
  const { env, call, L, A, cubId } = world();
  env.props.LINE_MESSAGING_TOKEN = 'test-token';
  linkLine(env, call, L, 'Uleader'); linkLine(env, call, A, 'Uhelper');
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '二小隊', joinDate: '2025-09-01' }).cubId;
  env.net.code = 400;
  call(A, 'signoff', { cubIds: [cubId, c2], itemIds: itemsOf(env, '環保'), date: '2026-10-01' });
  assert.equal(env.rows('通知紀錄').length, 0, '失敗不寫紀錄，下次再試');
  assert.equal(call(L, 'adminHome').alerts.notifyFailed, 1);
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '通知未送達'));
  env.net.code = 200;
  env.ctx.runDaily_();
  const ok = pushes(env).at(-1).body;
  assert.deepEqual([...ok.to].sort(), ['Uhelper', 'Uleader'], '只發給已連結的管理員');
  assert.equal(ok.messages.length, 1);
  assert.equal(ok.messages[0].contents.type, 'carousel');
  assert.equal(ok.messages[0].contents.contents.length, 2, '兩位合併成一則');
  assert.equal(call(L, 'adminHome').alerts.notifyFailed, 0);
  // 再提醒：預設 14 天後一次
  const n = pushes(env).length;
  env.advance(13 * DAY); env.ctx.runDaily_();
  assert.equal(pushes(env).length, n);
  env.advance(2 * DAY); env.ctx.runDaily_();
  assert.equal(pushes(env).length, n + 1);
  assert.match(JSON.stringify(pushes(env).at(-1).body), /還沒頒章的提醒/);
  env.advance(30 * DAY); env.ctx.runDaily_();
  assert.equal(pushes(env).length, n + 1, '之後不再提醒');
});

test('LINE 關鍵字：可晉級／快達標只回已連結的管理員；進度任何人都只回網址', () => {
  const { env, call, L, A, cubId } = world();
  env.props.LINE_MESSAGING_TOKEN = 'test-token';
  linkLine(env, call, L, 'Uleader');
  call(A, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '環保'), date: '2026-10-01' });
  call(A, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '嚮導').slice(0, 1), date: '2026-10-01' });
  const replies = () => env.sent.filter((x) => /reply/.test(x.url));
  let n = replies().length;
  say(env, '可晉級', 'Ustranger'); say(env, '快達標', 'Ustranger');
  assert.equal(replies().length, n, '未連結的人不回名單');
  say(env, '進度', 'Ustranger');
  assert.equal(replies().length, n + 1);
  assert.ok(!/測試小狼/.test(JSON.stringify(replies().at(-1).body)), '不含任何個資');
  assert.match(replies().at(-1).body.messages[0].text, /aihong-lab\.github\.io\/22CUBSCOUT\//, '沒設定 WEB_URL 時用 GitHub 正式網站（附錄第 59 點）');
  say(env, '可晉級', 'Uleader');
  assert.match(replies().at(-1).body.messages[0].text, /測試小狼甲：環保技能章/);
  say(env, '快達標', 'Uleader');
  assert.match(replies().at(-1).body.messages[0].text, /測試小狼甲：嚮導技能章（還差 1 項）/);
});

test('每日排程：setup 自動安裝；改設定的時間會重裝；不重複', () => {
  const { env, call, L } = world();
  const daily = () => env.triggers.filter((t) => t.getHandlerFunction() === 'dailyJob').length;
  assert.equal(daily(), 1);
  env.ctx.setupCore_();
  assert.equal(daily(), 1);
  call(L, 'settingsSave', { changes: { '每日排程時間（幾點）': '20' } });
  assert.equal(daily(), 1);
  assert.equal(env.props.DAILY_HOUR, '20');
});

test('弱密碼被擋：常見密碼、跟帳號一樣、重複或連續字元', () => {
  const { env, call, P } = world();
  for (const pw of ['12345678', 'password1', 'abcd1234', 'aaaaaaaa', 'weakuser01', '12341234', 'Qwer1234']) {
    const r = env.api({ action: 'register', identity: '服務員', username: 'weakuser01', password: pw, nickname: '測試' });
    assert.equal(r.code, 'BAD_INPUT', pw);
    assert.match(r.message, /太常見或太簡單/);
  }
  assert.equal(env.api({ action: 'register', identity: '服務員', username: 'weakuser01', password: 'tiger-walk-27', nickname: '測試' }).ok, true);
  assert.match(call(P, 'changePassword', { oldPassword: 'parentpass1', newPassword: 'parent01' }).message, /太常見或太簡單/);
});

test('註冊審核可以直接核准為體驗者', () => {
  const { env, call, L } = world();
  const mom = apply(env, 'trialmom2', { identity: '家長', nickname: '體驗己媽媽', childNames: ['測試體驗己'] });
  const rq = call(L, 'requestList').items.find((x) => x.name === '測試體驗己');
  assert.equal(call(L, 'requestApprove', { requestId: rq.requestId, mode: 'trial', squad: '一小隊', joinDate: '2026-11-01' }).ok, true);
  const cub = env.rows('小狼名單').find((r) => r[1] === '測試體驗己');
  assert.deepEqual([cub[3], cub[7], cub[9]], ['', '體驗', '2026-11-01']);
  const v = call(mom.token, 'cubDetail', { cubId: cub[0] });
  assert.equal(v.cub.status, '體驗');
  assert.deepEqual([v.trial.count, v.trial.need], [0, 4]);
});

// ═════ 小隊輔、正副小隊長、公告欄、匯入、家長請假、升團（SPEC 附錄第 45 點） ═════
test('小隊輔：團長指定、me 帶出自己的小隊、家長看得到姓名、小隊改名與刪除會同步', () => {
  const { env, call, L, A, P, cubId } = world();
  const ids = Object.fromEntries(call(L, 'squadList').admins.map((a) => [a.name, a.accountId]));
  assert.equal(call(A, 'squadStaffSave', { squad: '一小隊', accountIds: [ids['陳服務員']] }).code, 'FORBIDDEN');
  assert.match(call(L, 'squadStaffSave', { squad: '一小隊', accountIds: ['U不存在'] }).message, /只能選團長或服務員/);
  assert.equal(call(L, 'squadStaffSave', { squad: '一小隊', accountIds: [ids['陳服務員'], ids['陳服務員']] }).count, 1);
  assert.deepEqual([...call(A, 'me').mySquads], ['一小隊']);
  assert.deepEqual([...call(L, 'me').mySquads], []);
  assert.deepEqual(call(L, 'squadList').squads.find((x) => x.name === '一小隊').staff.map((x) => x.name), ['陳服務員']);
  const pv = call(P, 'cubDetail', { cubId });
  assert.deepEqual([...pv.cub.squadStaff], ['陳服務員']);
  assert.ok(!JSON.stringify(pv).includes(ids['陳服務員']), '家長端不含帳號ID');
  call(L, 'squadSave', { type: 'rename', name: '一小隊', newName: '黑豹小隊' });
  assert.deepEqual([...call(A, 'me').mySquads], ['黑豹小隊']);
});

test('正副小隊長：狼級以上才能擔任、每小隊各一位（換人先確認）、任期紀錄、換小隊或離團自動卸任', () => {
  const { env, call, L, A, cubId } = world();
  assert.equal(call(A, 'cubRoleSave', { cubId, role: '小隊長' }).code, 'FORBIDDEN');
  assert.match(call(L, 'cubRoleSave', { cubId, role: '小隊長' }).message, /狼級以上才能擔任/, '還沒晉級不能擔任');
  // 小隊沒有狼級以上時，羚羊級也可以擔任（本團現況）
  const lionId = call(L, 'cubSave', { name: '測試小狼羚', squad: '二小隊', joinDate: '2025-03-01' }).cubId;
  call(L, 'backfill', { cubId: lionId, unit: '羚羊', date: '2026-01-01', includeLower: true });
  assert.equal(call(L, 'cubAdminDetail', { cubId: lionId }).cub.canLead, true);
  assert.equal(call(L, 'cubRoleSave', { cubId: lionId, role: '小隊長' }).changed, 1, '二小隊沒有狼級以上，羚羊可以當小隊長');
  const wolfId = call(L, 'cubSave', { name: '測試小狼狼', squad: '二小隊', joinDate: '2025-03-01' }).cubId;
  call(L, 'backfill', { cubId: wolfId, unit: '狼', date: '2026-01-01', includeLower: true });
  const lion2 = call(L, 'cubSave', { name: '測試小狼羚二', squad: '二小隊', joinDate: '2025-03-01' }).cubId;
  call(L, 'backfill', { cubId: lion2, unit: '羚羊', date: '2026-01-01', includeLower: true });
  assert.match(call(L, 'cubRoleSave', { cubId: lion2, role: '副小隊長' }).message, /有狼級以上的小狼（測試小狼狼）/, '小隊有狼級以上時，羚羊不能擔任');
  call(L, 'cubBatchSave', { changes: [{ cubId: lionId, squad: '' }, { cubId: wolfId, squad: '' }, { cubId: lion2, squad: '' }] });
  call(L, 'backfill', { cubId, unit: '狼', date: '2026-01-01', includeLower: true });
  assert.equal(call(L, 'cubRoleSave', { cubId, role: '小隊長', date: '2026-09-01' }).changed, 1);
  assert.equal(env.rows('小狼名單').find((r) => r[0] === cubId)[10], '小隊長');
  // 同小隊第二位狼級小狼要當小隊長 → 先確認，確定後原本那位卸任
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '一小隊', joinDate: '2025-03-01' }).cubId;
  call(L, 'backfill', { cubId: c2, unit: '狼', date: '2026-01-01', includeLower: true });
  const ask = call(L, 'cubRoleSave', { cubId: c2, role: '小隊長', date: '2026-11-01' });
  assert.equal(ask.needConfirm, true);
  assert.match(ask.warnings[0], /目前是 測試小狼甲/);
  call(L, 'cubRoleSave', { cubId: c2, role: '小隊長', date: '2026-11-01', confirm: true });
  assert.equal(env.rows('小狼名單').find((r) => r[0] === cubId)[10], '');
  const d1 = call(L, 'cubAdminDetail', { cubId });
  assert.deepEqual(d1.roles.map((x) => [x.role, x.start, x.end]), [['小隊長', '2026-09-01', '2026-11-01']], '任期有起訖');
  assert.equal(call(L, 'cubAdminDetail', { cubId: c2 }).cub.role, '小隊長');
  call(L, 'cubRoleSave', { cubId, role: '副小隊長' });
  // 換小隊 → 自動卸任
  call(L, 'cubBatchSave', { changes: [{ cubId, squad: '二小隊' }] });
  assert.equal(env.rows('小狼名單').find((r) => r[0] === cubId)[10], '');
  assert.ok(call(L, 'cubAdminDetail', { cubId }).roles.every((x) => x.end), '任期都已結束');
  // 升團 → 卸任、狀態「升團」
  assert.equal(call(L, 'cubLeave', { cubId: c2, leftDate: '2026-11-10', reason: '升團' }).status, '升團');
  const g = env.rows('小狼名單').find((r) => r[0] === c2);
  assert.deepEqual([g[7], g[10]], ['升團', '']);
  assert.ok(!call(L, 'signoffData').cubs.some((c) => c.cubId === c2), '升團後不在簽核名單');
});

test('公告欄：團長與服務員可發、不用登入就看得到、置頂在前、下架不顯示、不含帳號ID', () => {
  const { env, call, L, A, P } = world();
  assert.equal(call(P, 'noticeSave', { title: 'x', content: 'y' }).code, 'FORBIDDEN');
  call(L, 'meetingSave', { lines: '2026-12-06 團集會' });
  const m = call(L, 'noticeList').meetings[0];
  const n1 = call(A, 'noticeSave', { title: '12/6 團集會通知', content: '請穿制服、帶水壺', meetingId: m.meetingId });
  env.advance(1000);
  const n2 = call(L, 'noticeSave', { title: '一般公告', content: '內容' });
  env.advance(1000);
  call(L, 'noticeSave', { title: '重要：場地更改', content: '改到活動中心', pinned: true });
  const pub = env.api({ action: 'notices' });
  assert.equal(pub.ok, true);
  assert.deepEqual(pub.notices.map((x) => x.title), ['重要：場地更改', '一般公告', '12/6 團集會通知']);
  assert.deepEqual(pub.notices[2].meeting, { date: '2026-12-06', name: '團集會' });
  assert.deepEqual(Object.keys(pub.notices[0]).sort(), ['content', 'date', 'id', 'meeting', 'pinned', 'target', 'title']);
  assert.ok(!/U[A-Z2-9]{8}/.test(JSON.stringify(pub)), '公開資料不含帳號ID');
  call(L, 'noticeSave', { id: n2.id, title: '一般公告', content: '內容', visible: false });
  assert.equal(env.api({ action: 'notices' }).notices.length, 2);
  assert.equal(call(L, 'noticeList').notices.length, 3, '後台看得到下架的');
  assert.match(call(L, 'noticeSave', { title: '', content: 'x' }).message, /標題/);
  assert.ok(n1.id);
});

test('批次匯入名單：全部正確才寫入、同名先確認、每位都有綁定碼', () => {
  const { env, call, L, A } = world();
  assert.equal(call(A, 'cubImport', { lines: '測試小狼丙' }).code, 'FORBIDDEN');
  const bad = call(L, 'cubImport', { lines: '測試小狼丙 一小隊 2025-09-01\n測試小狼丁 不存在小隊\n測試小狼戊 2099-01-01' });
  assert.match(bad.message, /第 2 行[\s\S]*第 3 行/);
  assert.equal(env.rows('小狼名單').length, 1, '有錯整批不寫');
  const dup = call(L, 'cubImport', { lines: '測試小狼甲 一小隊' });
  assert.equal(dup.needConfirm, true);
  const r = call(L, 'cubImport', { lines: '測試小狼丙 一小隊 2025/9/1\n測試小狼丁,二小隊\n測試小狼戊' });
  assert.equal(r.added, 3, JSON.stringify(r));
  const rows = env.rows('小狼名單');
  assert.deepEqual(rows.find((x) => x[1] === '測試小狼丙').slice(2, 4), ['一小隊', '2025-09-01']);
  assert.equal(rows.find((x) => x[1] === '測試小狼丁')[2], '二小隊');
  assert.equal(new Set(rows.map((x) => x[5])).size, rows.length, '綁定碼不重複');
});

test('家長線上請假：只能幫自己的孩子、只能請未來的集會、已點名出席不能改、可取消；點名頁看得到', () => {
  const { env, call, L, A, P, cubId } = world();
  call(L, 'meetingSave', { lines: '2026-11-01 團集會\n2026-11-22 團集會\n2026-11-29 團集會' });
  const up = call(P, 'cubDetail', { cubId }).attendance.upcoming;
  assert.deepEqual(up.map((m) => [m.date, m.leave]), [['2026-11-22', false], ['2026-11-29', false]]);
  assert.equal(call(P, 'parentLeave', { cubId, meetingId: up[0].meetingId }).leave, true);
  assert.equal(call(P, 'cubDetail', { cubId }).attendance.upcoming[0].leave, true);
  assert.equal(call(A, 'attendanceSheet', { meetingId: up[0].meetingId }).cubs.find((c) => c.cubId === cubId).status, '請假', '點名時直接帶出請假');
  assert.equal(call(P, 'parentLeave', { cubId, meetingId: up[0].meetingId, leave: false }).leave, false);
  assert.equal(env.rows('出席紀錄').length, 0);
  // 不是自己的孩子
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '二小隊', joinDate: '2025-09-01' }).cubId;
  assert.equal(call(P, 'parentLeave', { cubId: c2, meetingId: up[0].meetingId }).code, 'NOT_FOUND');
  // 過去的集會、已點名出席
  const past = call(L, 'meetingList').meetings.find((m) => m.date === '2026-11-01');
  assert.match(call(P, 'parentLeave', { cubId, meetingId: past.meetingId }).message, /已經過了/);
  call(A, 'attendanceSave', { meetingId: up[1].meetingId, marks: { [cubId]: '出席' } });
  assert.match(call(P, 'parentLeave', { cubId, meetingId: up[1].meetingId }).message, /已經點名為出席/);
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '家長請假'));
});

test('最高權限鎖在 admin：只有 admin 能指定或取消團長，admin 本身不能被別人更動', () => {
  const { env, call, L } = world();
  const acc = (name) => env.rows('帳號').find((r) => r[1] === name)[0];
  const helper = acc('helper01'), parent = acc('parent01');
  // 還沒有 admin 帳號時維持原本規則（否則沒有人能指定團長）
  assert.equal(call(L, 'me').isOwner, false);
  assert.equal(call(L, 'adminList').ownerExists, false);
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  const owner = acc('admin');
  assert.equal(call(O, 'me').isOwner, true);
  assert.equal(call(L, 'me').isOwner, false);
  // 有 admin 之後，帳號管理預設只有 admin 與總團（附錄第 73 點）；admin 可以開放給各分團團長
  assert.equal(call(L, 'accountList').code, 'FORBIDDEN');
  assert.equal(call(L, 'settingsSave', { changes: { '共用功能權限：帳號管理': '團長' } }).code, 'FORBIDDEN', '只有 admin 能改共用功能權限');
  assert.equal(call(O, 'settingsSave', { changes: { '共用功能權限：帳號管理': '團長' } }).ok, true);
  assert.equal(call(L, 'accountList').ok, true);
  const list = call(L, 'adminList');
  assert.equal(list.ownerExists, true);
  assert.equal(list.admins.find((a) => a.accountId === owner).owner, true);
  assert.equal(list.admins.find((a) => a.accountId === helper).owner, false);
  // 一般團長：不能指定、升、降、移除團長
  assert.match(call(L, 'adminUpdate', { accountId: helper, role: '團長' }).message, /只有最高管理員/);
  assert.match(call(L, 'adminAdd', { accountId: parent, role: '團長', name: '測試家長' }).message, /只有最高管理員/);
  assert.equal(call(O, 'adminUpdate', { accountId: helper, role: '團長' }).ok, true, 'admin 可以指定團長');
  assert.match(call(L, 'adminUpdate', { accountId: helper, role: '服務員' }).message, /只有最高管理員/);
  assert.match(call(L, 'adminRemove', { accountId: helper }).message, /只有最高管理員/);
  assert.match(call(L, 'accountStatus', { accountId: helper, status: '停用' }).message, /只有最高管理員/, '不能用停用帳號繞過');
  assert.match(call(L, 'accountDelete', { accountId: helper, confirmUsername: 'helper01' }).message, /只有最高管理員/, '不能用刪除帳號繞過');
  assert.match(call(L, 'accountTempCode', { accountId: helper }).message, /只有最高管理員/, '不能重設其他團長的密碼');
  // 一般團長：仍可管理服務員
  assert.equal(call(L, 'adminAdd', { accountId: parent, role: '服務員', name: '測試家長' }).ok, true);
  assert.equal(call(L, 'adminUpdate', { accountId: parent, name: '測試家長乙' }).ok, true);
  assert.equal(call(L, 'adminRemove', { accountId: parent }).ok, true);
  // admin 本身：任何人都不能更動
  for (const T of [L, O]) {
    assert.equal(call(T, 'adminUpdate', { accountId: owner, role: '服務員' }).ok, false);
    assert.equal(call(T, 'adminRemove', { accountId: owner }).ok, false);
    assert.equal(call(T, 'accountStatus', { accountId: owner, status: '停用' }).ok, false);
    assert.equal(call(T, 'accountDelete', { accountId: owner, confirmUsername: 'admin' }).ok, false);
  }
  assert.match(call(L, 'adminUpdate', { accountId: owner, name: '改名' }).message, /最高管理員/);
  assert.match(call(L, 'accountTempCode', { accountId: owner }).message, /最高管理員/);
  assert.equal(env.rows('管理員').find((r) => r[0] === owner)[2], '團長');
  // admin 可以取消團長
  assert.equal(call(O, 'adminUpdate', { accountId: helper, role: '服務員' }).ok, true);
  assert.equal(call(O, 'adminRemove', { accountId: acc('leader01') }).ok, true);
});

test('刪除小狼只有 admin 可以；其他團長只能匿名化（附錄第 48 點）', () => {
  const { env, call, L, cubId } = world();
  assert.equal(call(L, 'me').ownerExists, false);
  const made = env.ctx.ensureDefaultAdmin_();
  const O = env.api({ action: 'login', username: made.username, password: made.password }).token;
  assert.equal(call(L, 'me').ownerExists, true);
  call(L, 'cubLeave', { cubId, leftDate: '2026-01-01' });
  assert.match(call(L, 'privacyExecute', { cubId, mode: 'delete', confirmName: '測試小狼甲' }).message, /只有最高管理員可以完全刪除/);
  assert.ok(env.rows('小狼名單').some((r) => r[0] === cubId), '被拒絕時資料還在');
  assert.equal(call(O, 'privacyExecute', { cubId, mode: 'delete', confirmName: '測試小狼甲' }).ok, true);
  assert.ok(!env.rows('小狼名單').some((r) => r[0] === cubId));
});

test('網站內容（附錄第 49 點）：公開的活動時間與了解幼童軍、只有團長能改、FB 網址要檢查', () => {
  const { env, call, L, A } = world();
  const pub = () => env.api({ action: 'siteInfo' });
  const d0 = pub();
  assert.equal(d0.ok, true, '不用登入');
  assert.match(d0.about, /幼童軍/, '還沒設定時有範本');
  assert.equal(d0.fb, '');
  call(L, 'meetingSave', { lines: '2020-01-05 很久以前的集會\n2099-03-07 三月團集會\n2099-03-21 露營\n2099-04-04 停辦的集會' });
  const off = call(L, 'meetingList').meetings.find((m) => m.date === '2099-04-04');
  call(L, 'meetingSave', { meetingId: off.meetingId, enabled: false });
  const d1 = pub();
  assert.deepEqual(d1.meetings.filter((m) => m.date > '2099').map((m) => [m.date, m.name]), [['2099-03-07', '三月團集會'], ['2099-03-21', '露營']]);
  assert.ok(!d1.meetings.some((m) => m.date === '2020-01-05'), '本月以前的不列');
  assert.deepEqual(Object.keys(d1.meetings[0]).sort(), ['date', 'name', 'note', 'target', 'type'], '只回白名單欄位，不含集會ID 與建立人');
  assert.ok(!d1.meetings.some((m) => m.date === '2099-04-04'), '停用的不列');
  // 權限與檢查
  assert.equal(call(A, 'siteContentSave', { about: 'x' }).code, 'FORBIDDEN');
  assert.equal(env.api({ action: 'siteContentSave', about: 'x' }).ok, false);
  assert.match(call(L, 'siteContentSave', { about: '我們是 22 團', activity: '每月第一、三週日', fb: 'http://evil.example/x' }).message, /Facebook/);
  assert.equal(call(L, 'siteContentSave', { about: '我們是 22 團', activity: '每月第一、三週日 9:00', fb: 'https://www.facebook.com/example22' }).ok, true);
  const d2 = pub();
  assert.equal(d2.about, '我們是 22 團');
  assert.equal(d2.activity, '每月第一、三週日 9:00');
  assert.equal(d2.fb, 'https://www.facebook.com/example22');
  assert.equal(call(L, 'siteContentGet').about, '我們是 22 團');
  // 再存一次是更新同一列，不會越存越多
  call(L, 'siteContentSave', { about: '改過了', activity: '', fb: '' });
  assert.equal(env.rows('網站內容').length, 3);
  assert.equal(pub().about, '改過了');
  assert.equal(pub().fb, '');
});

test('活動報名與繳費紀錄（附錄第 50 點）：團長設定、登入後報名、取消、登記繳費、公開月曆只有活動資訊', () => {
  const { env, call, L, A, P } = world(); // 模擬時間 2026-11-14 10:00
  const base = { title: '冬季露營', desc: '兩天一夜', date: '2026-12-12', endDate: '2026-12-13', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 1200,
    questions: [{ label: '飲食', type: 'choice', options: ['葷', '素'], required: true }, { label: '想說的話', type: 'text' }] };
  // 權限與檢查
  assert.equal(call(A, 'eventSave', base).code, 'FORBIDDEN', '服務員不能設定活動');
  assert.equal(call(P, 'eventAdminList').code, 'FORBIDDEN');
  assert.match(call(L, 'eventSave', { ...base, regEnd: '2026-11-01T00:00' }).message, /結束報名時間要晚於/);
  assert.match(call(L, 'eventSave', { ...base, questions: [{ label: '家長手機號碼', type: 'text' }] }).message, /不收集「手機」/);
  assert.match(call(L, 'eventSave', { ...base, questions: [{ label: '交通', type: 'choice', options: ['自行前往'] }] }).message, /2～10 個選項/);
  const id = call(L, 'eventSave', base).id;
  assert.ok(id);
  // 公開資料：有起訖時間與費用，沒有題目和報名名單
  const pub = env.api({ action: 'siteInfo' }).events;
  assert.deepEqual(Object.keys(pub[0]).sort(), ['capacity', 'date', 'desc', 'endDate', 'fee', 'id', 'identityFees', 'regEnd', 'regStart', 'state', 'targets', 'title']);
  assert.equal(pub[0].state, '報名中');
  // 報名要登入
  assert.equal(env.api({ action: 'eventList' }).ok, false);
  const ev = call(P, 'eventList').events[0];
  assert.deepEqual(call(P, 'eventList').identities, ['小狼', '稚齡', '童軍', '家長', '服務員']);
  const q1 = ev.questions[0].id, q2 = ev.questions[1].id;
  assert.match(call(P, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '幼童軍', answers: { [q1]: '葷' } }] }).message, /請選擇身分別/);
  assert.match(call(P, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '小狼', answers: {} }] }).message, /請回答「飲食」/);
  assert.match(call(P, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '小狼', answers: { [q1]: '生酮' } }] }).message, /請從選項中選擇/);
  assert.equal(call(P, 'eventRegister', { eventId: id, people: [
    { name: '測試小狼甲', identity: '小狼', answers: { [q1]: '葷', [q2]: '期待' } }, { name: '測試小狼甲媽媽', identity: '家長', answers: { [q1]: '素' } }] }).added, 2);
  assert.match(call(P, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '小狼', answers: { [q1]: '葷' } }] }).message, /已經報名過了/);
  assert.equal(call(A, 'eventRegister', { eventId: id, people: [{ name: '陳服務員', identity: '服務員', answers: { [q1]: '葷' } }] }).added, 1, '服務員也能報名');
  const mine = call(P, 'eventList').events[0].mine;
  assert.equal(mine.length, 2);
  assert.equal(mine[0].amount, 1200, '應繳金額預設帶活動費用');
  assert.equal(call(A, 'eventList').events[0].mine.length, 1, '只看得到自己送出的報名');
  // 團長看名單、登記繳費
  const regs = call(L, 'eventRegs', { eventId: id }).regs;
  assert.equal(regs.length, 3);
  assert.equal(regs[0].by, '測試小狼甲媽媽');
  assert.equal(regs[0].accountId, undefined, '不回傳帳號ID');
  assert.match(call(L, 'eventPay', { updates: [{ regId: regs[0].regId, amount: -5, paid: true }] }).message, /金額/);
  assert.equal(call(L, 'eventPay', { updates: [{ regId: regs[0].regId, amount: 1200, paid: true }, { regId: regs[1].regId, amount: 600, paid: false }] }).changed, 2);
  const after = call(L, 'eventRegs', { eventId: id }).regs;
  assert.deepEqual(after.map((r) => [r.amount, r.paid]), [[1200, true], [600, false], [1200, false]]);
  assert.equal(call(L, 'eventAdminList').events[0].paidCount, 1);
  assert.equal(call(A, 'eventPay', { updates: [{ regId: regs[2].regId, amount: 0, paid: true }] }).code, 'FORBIDDEN');
  // 取消：已繳的不能自己取消；沒繳的可以；別人的不行
  assert.match(call(P, 'eventCancel', { regId: mine[0].regId }).message, /已經登記繳費/);
  assert.equal(call(A, 'eventCancel', { regId: mine[1].regId }).code, 'NOT_FOUND');
  assert.equal(call(P, 'eventCancel', { regId: mine[1].regId }).ok, true);
  assert.equal(call(L, 'eventRegs', { eventId: id }).regs.length, 2);
  // 截止後不能報名；關閉後公開頁面不顯示
  env.setNow(Date.parse('2026-12-01T02:00:00Z'));
  const P2 = env.api({ action: 'login', username: 'parent01', password: 'parentpass1' }).token; // 時間快轉後原本的登入已過期
  const L2 = env.api({ action: 'login', username: 'leader01', password: 'leaderpass1' }).token;
  assert.match(call(P2, 'eventRegister', { eventId: id, people: [{ name: '測試小狼乙', identity: '小狼', answers: { [q1]: '葷' } }] }).message, /已經截止報名/);
  assert.equal(env.api({ action: 'siteInfo' }).events[0].state, '已截止');
  assert.equal(call(L2, 'eventSave', { ...base, id, enabled: false }).id, id);
  assert.equal(env.api({ action: 'siteInfo' }).events.length, 0);
  // 刪除帳號時報名一併刪除
  const pid = env.rows('帳號').find((r) => r[1] === 'parent01')[0];
  assert.equal(call(L2, 'accountDelete', { accountId: pid, confirmUsername: 'parent01' }).ok, true);
  assert.ok(!env.rows('活動報名').some((r) => r[2] === pid));
});

test('章的圖片（附錄第 50 點）：團長上傳、公開讀取、格式與大小檢查、可移除', () => {
  const { env, call, L, A } = world();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.deepEqual(env.api({ action: 'unitImages' }).images, {});
  assert.equal(call(A, 'unitImageSave', { category: '進程', unit: '狼', image: png }).code, 'FORBIDDEN');
  assert.match(call(L, 'unitImageSave', { category: '進程', unit: '狼', image: 'https://example.com/a.png' }).message, /圖片格式不正確/);
  assert.match(call(L, 'unitImageSave', { category: '進程', unit: '狼', image: 'data:image/svg+xml;base64,PHN2Zz4=' }).message, /圖片格式不正確/, '不收 SVG');
  assert.match(call(L, 'unitImageSave', { category: '進程', unit: '狼', image: 'data:image/png;base64,' + 'A'.repeat(50000) }).message, /太大/);
  assert.equal(call(L, 'unitImageSave', { category: '進程', unit: '不存在', image: png }).code, 'NOT_FOUND');
  assert.equal(call(L, 'unitImageSave', { category: '進程', unit: '狼', image: png }).ok, true);
  assert.equal(call(L, 'unitImageSave', { category: '技能章', unit: '嚮導', image: png }).ok, true);
  assert.deepEqual(Object.keys(env.api({ action: 'unitImages' }).images).sort(), ['技能章|嚮導', '進程|狼']);
  call(L, 'unitImageSave', { category: '進程', unit: '狼', image: png });
  assert.equal(env.rows('章圖').length, 2, '重傳是更新同一列');
  call(L, 'unitImageSave', { category: '進程', unit: '狼', image: '' });
  assert.deepEqual(Object.keys(env.api({ action: 'unitImages' }).images), ['技能章|嚮導']);
});

test('每個活動一份獨立的存檔試算表（附錄第 51 點）：建立活動時產生，報名、取消、繳費後自動更新', () => {
  const { env, call, L, A, P } = world();
  const base = { title: '春季健行', date: '2026-12-20', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 300, questions: [{ label: '飲食', type: 'choice', options: ['葷', '素'] }] };
  const id = call(L, 'eventSave', base).id;
  const book = Object.values(env.ext.books)[0];
  assert.ok(book, '建立活動時就產生試算表');
  assert.match(book.getName(), /春季健行/);
  assert.equal(env.drive.moved.length, 1, '放進存檔資料夾');
  assert.ok(env.props.EVENT_FOLDER_ID);
  const list = () => { const sh = book.getSheetByName('報名名單'); return sh.getRange(1, 1, sh.getLastRow(), 9).getValues(); };
  assert.deepEqual(list()[0], ['姓名', '身分別', '飲食', '報名人', '應繳金額', '已繳', '報名時間', '狀態', '最後更新']);
  assert.equal(list().length, 1);
  const q = call(P, 'eventList').events[0].questions[0].id;
  call(P, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '小狼', answers: { [q]: '葷' } }, { name: '=HYPERLINK("x")', identity: '家長', answers: {} }] });
  let rows = list();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].slice(0, 6), ['測試小狼甲', '小狼', '葷', '測試小狼甲媽媽', 300, '否']);
  assert.equal(rows[2][0], "'=HYPERLINK(\"x\")", '等號開頭的內容不會被當成公式');
  const regs = call(L, 'eventRegs', { eventId: id });
  assert.equal(regs.sheetUrl, book.getUrl(), '團長拿得到存檔試算表的連結');
  assert.equal(call(P, 'eventList').events[0].sheetUrl, undefined, '家長拿不到');
  call(L, 'eventPay', { updates: [{ regId: regs.regs[0].regId, amount: 250, paid: true }] });
  call(P, 'eventCancel', { regId: regs.regs[1].regId });
  rows = list();
  assert.deepEqual(rows[1].slice(4, 6), [250, '是']);
  assert.equal(rows[2][7], '取消', '取消的也留在存檔裡');
  const info = book.getSheetByName('活動資訊');
  assert.match(JSON.stringify(info.getRange(1, 1, info.getLastRow(), 2).getValues()), /春季健行.*已收金額.*250/);
  // 只有一份，不會每次同步都新增檔案；手動同步只有團長可以
  assert.equal(list().length, 3);
  assert.equal(Object.keys(env.ext.books).length, 1);
  assert.equal(call(A, 'eventSheetSync', { eventId: id }).code, 'FORBIDDEN');
  assert.equal(call(L, 'eventSheetSync', { eventId: id }).sheetUrl, book.getUrl());
  // 建立試算表失敗不影響建立活動與報名，之後可以手動補
  env.ext.fail = true;
  const id2 = call(L, 'eventSave', { ...base, title: '第二個活動' }).id;
  assert.ok(id2);
  assert.equal(call(P, 'eventRegister', { eventId: id2, people: [{ name: '測試小狼甲', identity: '小狼', answers: {} }] }).added, 1);
  assert.equal(call(L, 'eventRegs', { eventId: id2 }).sheetUrl, '');
  assert.equal(call(L, 'eventSheetSync', { eventId: id2 }).ok, false);
  env.ext.fail = false;
  assert.match(call(L, 'eventSheetSync', { eventId: id2 }).sheetUrl, /EXT-2/);
});

test('技能章改名後，上傳過的圖片跟著新名字（附錄第 50 點）', () => {
  const { env, call, L } = world();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  call(L, 'unitSave', { category: '技能章', unit: '露營', isNew: true, group: '技巧類' });
  assert.equal(call(L, 'unitImageSave', { category: '技能章', unit: '露營', image: png }).ok, true);
  call(L, 'unitSave', { category: '技能章', unit: '露營', group: '技巧類', newName: '野營' });
  assert.deepEqual(Object.keys(env.api({ action: 'unitImages' }).images), ['技能章|野營'], '改名後圖片還在');
});

test('活動報名只開放 22 團（附錄第 52 點）：管理員、有在團或體驗中孩子的家長；其他帳號不行', () => {
  const { env, call, L, A, P, cubId } = world();
  const id = call(L, 'eventSave', { title: '團內健行', date: '2026-12-20', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 0 }).id;
  const one = (name, identity) => ({ eventId: id, people: [{ name, identity, answers: {} }] });
  // 還沒審核（或被退回）的帳號
  const v = env.api({ action: 'consentText' }).version;
  const O = env.api({ action: 'register', identity: '家長', childNames: ['外團孩子'], username: 'other01', password: 'otherpass1', nickname: '外團家長', consentVersion: v, agree: true }).token;
  assert.equal(call(O, 'eventList').eligible, false);
  assert.equal(call(O, 'eventList').events[0].questions, undefined, '不能報名的人看不到題目');
  assert.match(call(O, 'eventRegister', one('外團孩子', '小狼')).message, /只開放 22 團/);
  // 團長、服務員、在團孩子的家長可以
  assert.equal(call(L, 'eventList').eligible, true);
  assert.equal(call(A, 'eventRegister', one('陳服務員', '服務員')).added, 1);
  assert.equal(call(P, 'eventRegister', one('測試小狼甲', '小狼')).added, 1);
  // 孩子離團後，家長就不能再報名
  call(L, 'cubLeave', { cubId, leftDate: '2026-11-14' });
  assert.equal(call(P, 'eventList').eligible, false);
  assert.match(call(P, 'eventRegister', one('測試小狼甲媽媽', '家長')).message, /只開放 22 團/);
});

test('活動結束後，網站上的報名資料自動清除，存檔試算表保留（附錄第 52 點）', () => {
  const { env, call, L, P } = world();
  const id = call(L, 'eventSave', { title: '冬季露營', date: '2026-12-12', endDate: '2026-12-13', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59', fee: 500 }).id;
  call(P, 'eventRegister', { eventId: id, people: [{ name: '測試小狼甲', identity: '小狼', answers: {} }, { name: '測試小狼甲媽媽', identity: '家長', answers: {} }] });
  const regs = call(L, 'eventRegs', { eventId: id }).regs;
  call(L, 'eventPay', { updates: [{ regId: regs[0].regId, amount: 500, paid: true }] });
  const book = Object.values(env.ext.books)[0];
  const list = () => { const sh = book.getSheetByName('報名名單'); return sh.getRange(1, 1, sh.getLastRow(), 6).getValues(); };
  // 活動最後一天還不清
  env.setNow(Date.parse('2026-12-13T10:00:00Z'));
  env.ctx.runDaily_();
  assert.equal(env.rows('活動報名').length, 2);
  // 結束後隔天清除；存檔還在
  env.setNow(Date.parse('2026-12-14T10:00:00Z'));
  env.ctx.runDaily_();
  assert.equal(env.rows('活動報名').length, 0, '網站上的報名資料清掉');
  assert.equal(list().length, 3, '存檔試算表的名單還在');
  assert.deepEqual(list()[1].slice(3, 5), [500, '是'], '沒有自訂題目時：姓名、身分別、報名人、金額、已繳');
  const L2 = env.api({ action: 'login', username: 'leader01', password: 'leaderpass1' }).token;
  const ev = call(L2, 'eventAdminList').events.find((e) => e.id === id);
  assert.equal(ev.archived, true);
  assert.equal(call(L2, 'eventRegs', { eventId: id }).sheetUrl, book.getUrl(), '還拿得到存檔連結');
  // 封存後不會再改寫存檔，也不能修改活動
  assert.match(call(L2, 'eventSheetSync', { eventId: id }).message, /已經封存/);
  assert.match(call(L2, 'eventSave', { id, title: '改名', date: '2026-12-12', regStart: '2026-11-10T08:00', regEnd: '2026-11-30T23:59' }).message, /已經結束並封存/);
  assert.equal(list().length, 3);
  // 存檔建立失敗的活動不清除（避免資料不見）
  env.ext.fail = true;
  const id2 = call(L2, 'eventSave', { title: '沒有存檔的活動', date: '2026-12-20', regStart: '2026-12-14T08:00', regEnd: '2026-12-18T23:59' }).id;
  const P2 = env.api({ action: 'login', username: 'parent01', password: 'parentpass1' }).token;
  assert.equal(call(P2, 'eventRegister', { eventId: id2, people: [{ name: '測試小狼甲', identity: '小狼', answers: {} }] }).added, 1);
  env.setNow(Date.parse('2026-12-22T10:00:00Z'));
  env.ctx.runDaily_();
  assert.equal(env.rows('活動報名').length, 1, '沒有存檔就不清除');
  env.ext.fail = false;
  env.ctx.runDaily_();
  assert.equal(env.rows('活動報名').length, 0, '存檔補建成功後才清除');
});

test('startup：一次取得登入資料與第一個畫面（附錄第 58 點）', () => {
  const { call, L, P, A, cubId } = world();
  const a = call(L, 'startup');
  assert.equal(a.me.role, '團長');
  assert.ok(a.prefetch.adminHome.alerts, '團長：後台首頁資料');
  assert.ok(Array.isArray(a.prefetch.meetingList.meetings));
  const s = call(A, 'startup');
  assert.equal(s.me.role, '服務員');
  assert.ok(s.prefetch.adminHome);
  const p = call(P, 'startup');
  assert.equal(p.me.role, null);
  assert.equal(p.prefetch.adminHome, undefined, '家長拿不到後台資料');
  assert.equal(p.prefetch.cubDetail.cub.cubId, cubId, '家長：第一個孩子的資料');
  assert.equal(call('bad-token', 'startup').code, 'SESSION_EXPIRED');
});

test('LINE 圖文選單一鍵安裝（附錄第 60 點）：建立、上傳圖片、設為預設、刪掉舊的', () => {
  const { env, L, call } = world();
  const rm = () => env.sent.filter((x) => /richmenu/.test(x.url));
  // 沒有 token：不呼叫 LINE，跳出說明
  env.ctx.menuInstallRichMenu();
  assert.match(env.ui.alerts.at(-1), /LINE_MESSAGING_TOKEN/);
  assert.equal(rm().length, 0);

  env.props.LINE_MESSAGING_TOKEN = 'tok-test';
  call(L, 'siteContentSave', { about: '我們是 22 團', fb: 'https://www.facebook.com/test22' });
  let n = 0;
  env.net.handler = (url, o) => {
    if (/richmenu\/list$/.test(url)) return { body: { richmenus: [{ richMenuId: 'old-1', name: '22團選單' }, { richMenuId: 'other', name: '別人的選單' }] } };
    if (/\/v2\/bot\/richmenu$/.test(url)) return { body: { richMenuId: 'new-' + (++n) } };
    if (/line-richmenu\.jpg$/.test(url)) return { blob: { kind: 'jpg' } };
    return { body: {} };
  };
  env.ctx.menuInstallRichMenu();
  assert.match(env.ui.alerts.at(-1), /完成/);
  const calls = rm();
  const create = calls.find((x) => /\/v2\/bot\/richmenu$/.test(x.url));
  assert.equal(create.method, 'post');
  assert.equal(create.headers.Authorization, 'Bearer tok-test');
  assert.deepEqual(create.body.size, { width: 2500, height: 1686 });
  assert.equal(create.body.name, '22團選單');
  const uris = create.body.areas.map((a) => a.action.uri);
  assert.deepEqual(uris, ['https://aihong-lab.github.io/22CUBSCOUT/web/#notices', 'https://aihong-lab.github.io/22CUBSCOUT/web/#progress',
    'https://aihong-lab.github.io/22CUBSCOUT/web/#badges', 'https://aihong-lab.github.io/22CUBSCOUT/web/#about',
    'https://aihong-lab.github.io/22CUBSCOUT/web/#calendar', 'https://www.facebook.com/test22']);
  // 六格剛好鋪滿整張圖、不重疊
  const area = create.body.areas.reduce((t, a) => t + a.bounds.width * a.bounds.height, 0);
  assert.equal(area, 2500 * 1686);
  create.body.areas.forEach((a) => assert.ok(a.action.label.length <= 20));
  const up = calls.find((x) => /api-data\.line\.me\/v2\/bot\/richmenu\/new-1\/content/.test(x.url));
  assert.equal(up.contentType, 'image/jpeg');
  assert.deepEqual(up.body, { kind: 'jpg' });
  assert.ok(calls.some((x) => /user\/all\/richmenu\/new-1$/.test(x.url) && x.method === 'post'), '設為所有人的預設選單');
  assert.ok(calls.some((x) => /richmenu\/old-1$/.test(x.url) && x.method === 'delete'), '刪掉舊的 22團選單');
  assert.ok(!calls.some((x) => /richmenu\/other$/.test(x.url) && x.method === 'delete'), '別的選單不動');
  assert.ok(!JSON.stringify(env.logs).includes('tok-test') && !env.ui.alerts.join('').includes('tok-test'), 'token 不出現在日誌或視窗');

  // 沒填 FB：右下角直接開 22 團的 FB 粉絲專頁（附錄第 67 點）
  call(L, 'siteContentSave', { about: '我們是 22 團', fb: '' });
  env.ctx.menuInstallRichMenu();
  const c2 = rm().filter((x) => /\/v2\/bot\/richmenu$/.test(x.url)).at(-1);
  assert.equal(c2.body.areas[5].action.uri, 'https://www.facebook.com/profile.php?id=100064559625116');

  // LINE 回錯誤：說明失敗、不設預設、刪掉做到一半的選單
  const before = rm().length;
  env.net.handler = (url) => (/\/v2\/bot\/richmenu$/.test(url) ? { body: { richMenuId: 'bad' } } : /content$/.test(url) ? { code: 400, body: { message: 'image too large' } } : { body: { richmenus: [] } });
  env.ctx.menuInstallRichMenu();
  assert.match(env.ui.alerts.at(-1), /失敗[\s\S]*image too large/);
  const after = rm().slice(before);
  assert.ok(!after.some((x) => /user\/all/.test(x.url)));
  assert.ok(after.some((x) => /richmenu\/bad$/.test(x.url) && x.method === 'delete'));

  // 網頁訪客（GAS 模式）呼叫不到：沒有試算表視窗就直接失敗、不呼叫 LINE
  env.ui.unavailable = true;
  const b2 = rm().length;
  assert.throws(() => env.ctx.menuInstallRichMenu());
  assert.equal(rm().length, b2);
});

test('集會「計入進程」開關與遲到（附錄第 61 點）', () => {
  const { env, call, L, A, cubId } = world();
  call(L, 'meetingSave', { lines: '2026-09-05\n2026-09-12\n2026-09-19\n2026-09-26' });
  call(L, 'backfill', { cubId, unit: '剛入團', date: '2026-09-01' });
  const ms = call(L, 'meetingList').meetings;
  assert.ok(ms.every((m) => m.counts === true), '新增的集會預設計入');
  assert.equal(env.rows('集會行事曆')[0][8], '是');
  ms.forEach((m, i) => call(A, 'attendanceSave', { meetingId: m.meetingId, marks: { [cubId]: i === 1 ? '遲到' : '出席' } }));
  const lion7 = () => call(L, 'cubAdminDetail', { cubId }).units.find((u) => u.unit === '羚羊').items[6];
  assert.equal(lion7().done, true, '遲到也算 4 次');
  assert.equal(call(A, 'meetingSave', { meetingId: ms[3].meetingId, counts: false }).code, 'FORBIDDEN', '服務員不能改行事曆');
  assert.equal(call(L, 'meetingSave', { meetingId: ms[3].meetingId, counts: false }).ok, true);
  assert.equal(call(L, 'meetingList').meetings[3].counts, false);
  assert.equal(env.rows('集會行事曆')[3][8], '否');
  assert.equal(lion7().done, false, '不計入進程的集會不算');
  const d = call(L, 'cubAdminDetail', { cubId });
  assert.equal(d.attendance.counts.attended, 4, '出席統計照算');
  assert.equal(d.attendance.counts.late, 1);
  call(L, 'meetingSave', { meetingId: ms[3].meetingId, counts: true });
  assert.equal(lion7().done, true);
  // 舊資料（沒有這一欄）視為計入
  env.sheet('集會行事曆').getRange(2, 9).setValues([['']]);
  assert.equal(call(L, 'meetingList').meetings[0].counts, true);
});


test('LINE 關鍵字「點名」（附錄第 63 點）：只回已連結的管理員；下一場集會、已請假名單、直達點名頁', () => {
  const { env, call, L, A, cubId } = world();
  env.props.LINE_MESSAGING_TOKEN = 'test-token';
  const replies = () => env.sent.filter((x) => /reply/.test(x.url));
  linkLine(env, call, L, 'Uleader');
  let n = replies().length;
  say(env, '點名', 'Uleader');
  assert.match(replies().at(-1).body.messages[0].text, /接下來沒有排定的集會/);
  const c2 = call(L, 'cubSave', { name: '測試小狼乙', squad: '二小隊', joinDate: '2026-10-01' }).cubId;
  call(L, 'meetingSave', { lines: '2026-11-07 團集會\n2026-11-21 團集會\n2026-11-28 露營' });
  const next = call(L, 'meetingList').meetings.find((m) => m.date === '2026-11-21');
  call(A, 'attendanceSave', { meetingId: next.meetingId, marks: { [c2]: '請假' } });
  n = replies().length;
  say(env, '點名', 'Ustranger');
  assert.equal(replies().length, n, '沒連結的人不回');
  say(env, '點名', 'Uleader');
  const t = replies().at(-1).body.messages[0].text;
  assert.match(t, /11\/21（六）團集會/);
  assert.match(t, /已請假 1 位[\s\S]*測試小狼乙（二小隊）/);
  assert.ok(!t.includes('測試小狼甲'), '沒請假的不列');
  assert.ok(t.includes('https://aihong-lab.github.io/22CUBSCOUT/web/#roll=' + encodeURIComponent(next.meetingId)), '直達點名頁');
  // 今天有集會就回今天的，並顯示已點名人數
  call(L, 'meetingSave', { lines: '2026-11-14 團集會' });
  const today = call(L, 'meetingList').meetings.find((m) => m.date === '2026-11-14');
  call(A, 'attendanceSave', { meetingId: today.meetingId, marks: { [cubId]: '遲到' } });
  say(env, '點名', 'Uleader');
  assert.match(replies().at(-1).body.messages[0].text, /今天[\s\S]*11\/14（六）團集會[\s\S]*已點名出席 1 位[\s\S]*沒有人請假/);
});

test('後台首頁提醒：個資說明與「了解幼童軍」還有【請填寫】範本文字（附錄第 65 點）', () => {
  const { call, L, A } = world();
  let al = call(L, 'adminHome').alerts;
  assert.deepEqual(al.placeholders, ['個資告知內容', '個資告知內容（羅浮本人版）', '認識 22 團'], '預設文字還沒改');
  assert.deepEqual(call(A, 'adminHome').alerts.placeholders, [], '服務員不顯示（改不了）');
  call(L, 'consentSave', { content: '親愛的家長您好：資料保存到離團後 180 天，備份 8 週後刪除。聯絡團長：LINE 官方帳號。' });
  call(L, 'consentSave', { audience: '羅浮本人', content: '您好：資料保存到離團後 180 天，備份 8 週後刪除。聯絡群長：LINE 官方帳號。' });
  call(L, 'siteContentSave', { about: '我們是 22 團，歡迎來體驗。', activity: '', fb: '' });
  al = call(L, 'adminHome').alerts;
  assert.deepEqual(al.placeholders, []);
});

test('後端版本檢查（SPEC 附錄第 72 點）：網頁與後端版本號必須一致，me 與 ping 回傳版本', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const web = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8').match(/^const APP_VERSION = '([^']+)';/m);
  const gas = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Config.js'), 'utf8').match(/^var APP_VERSION = '([^']+)';/m);
  assert.ok(web && gas, '兩邊都要有 APP_VERSION');
  assert.equal(web[1], gas[1], '改了後端就要同時更新 web/index.html 與 gas/Config.js 的 APP_VERSION');
  const { env, call, L } = world();
  assert.equal(call(L, 'me').serverVersion, gas[1]);
  assert.equal(env.api({ action: 'ping' }).version, gas[1]);
});
