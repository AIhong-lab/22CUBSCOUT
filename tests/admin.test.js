// 後台 API 整合測試（階段 4A）。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGas } = require('./gas-mock.js');

const DAY = 86400000;

/** 建好系統：團長、服務員、一位家長；回傳各自的 token */
function world() {
  const env = loadGas();
  const r = env.ctx.setup();
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' });
  const call = (token, action, data = {}) => env.api({ action, token, ...data });
  const inv = call(L.token, 'inviteCreate', { role: '服務員', name: '陳服務員' });
  const A = env.api({ action: 'register', code: inv.code, childName: '', username: 'helper01', password: 'helperpass1', nickname: '陳服務員' });
  call(L.token, 'squadSave', { type: 'add', name: '一小隊' });
  call(L.token, 'squadSave', { type: 'add', name: '二小隊' });
  const cub = call(L.token, 'cubSave', { name: '測試小狼甲', squad: '一小隊', joinDate: '2025-03-01' });
  const v = env.api({ action: 'consentText' }).version;
  const P = env.api({ action: 'register', code: cub.code, childName: '測試小狼甲', username: 'parent01', password: 'parentpass1', nickname: '測試小狼甲媽媽', consentVersion: v });
  return { env, call, L: L.token, A: A.token, P: P.token, cubId: cub.cubId, code: cub.code };
}
const itemsOf = (env, unit) => env.rows('項目總表').filter((r) => r[2] === unit).map((r) => r[0]);

test('權限：家長不能呼叫後台；服務員不能做團長專屬操作', () => {
  const { call, L, A, P, cubId } = world();
  for (const a of ['adminHome', 'cubList', 'signoffData', 'overview', 'meetingList']) assert.equal(call(P, a).code, 'FORBIDDEN', '家長：' + a);
  for (const [a, d] of [['cubSave', { name: 'x', joinDate: '2025-01-01' }], ['cubLeave', { cubId, leftDate: '2026-01-01' }], ['cubNewCode', { cubId }], ['award', { date: '2026-01-01', entries: [{ cubId, unit: '羚羊' }] }],
    ['backfill', { cubId, unit: '羚羊', date: '2026-01-01' }], ['adminList'], ['inviteCreate', { role: '服務員', name: 'x' }], ['accountList'], ['privacyExecute', { cubId, mode: 'delete', confirmName: '測試小狼甲' }],
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
  assert.match(call(L, 'award', { date: '2026-09-30', entries: [{ cubId, unit: '羚羊' }] }).message, /不可早於最後一個項目的完成日期/);
  const fut = call(L, 'award', { date: '2026-12-01', entries: [{ cubId, unit: '羚羊' }] });
  assert.equal(fut.needConfirm, true);
  assert.equal(env.rows('頒章紀錄').length, 0, '未確認前不寫入');
  assert.equal(call(L, 'award', { date: '2026-10-05', occasion: '10 月團集會', entries: [{ cubId, unit: '羚羊' }] }).added, 1);
  assert.equal(env.rows('小狼名單')[0][4], '羚羊', '目前級別更新');
  assert.match(call(L, 'award', { date: '2026-10-05', entries: [{ cubId, unit: '羚羊' }] }).message, /已經頒發過了/);
  // 狼級：項目完成但未滿 6 個月 → 需確認
  call(L, 'signoff', { cubIds: [cubId], itemIds: itemsOf(env, '狼'), date: '2026-11-01' });
  const w = call(L, 'award', { date: '2026-11-10', entries: [{ cubId, unit: '狼' }] });
  assert.equal(w.needConfirm, true);
  assert.match(w.warnings[0], /晉級間隔要到 2027-04-05 才滿/);
  assert.equal(call(L, 'award', { date: '2026-11-10', entries: [{ cubId, unit: '狼' }], confirm: true }).added, 1);
  assert.equal(env.rows('小狼名單')[0][4], '狼');
  // 修改頒發日期
  assert.equal(call(L, 'awardEdit', { cubId, unit: '羚羊', date: '2026-10-06', occasion: '補辦', note: '' }).ok, true);
  assert.equal(env.rows('頒章紀錄')[0][2], '2026-10-06');
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '修改頒章' && String(r[4]).includes('2026-10-05')), '保留修改前的值');
  // 撤銷進程頒章 → 級別退回
  assert.equal(call(L, 'awardRevoke', { cubId, unit: '狼' }).ok, true);
  assert.equal(env.rows('小狼名單')[0][4], '羚羊');
});

test('補登：較低級別沒有紀錄先提示，一併補登後狀態正確且不發推播', () => {
  const { env, call, L, cubId } = world();
  const ask = call(L, 'backfill', { cubId, unit: '狼', date: '2025-12-01' });
  assert.deepEqual([...ask.missingLowerLevels], ['羚羊']);
  assert.equal(env.rows('頒章紀錄').length, 0);
  const r = call(L, 'backfill', { cubId, unit: '狼', date: '2025-12-01', includeLower: true });
  assert.deepEqual([...r.awarded], ['羚羊', '狼']);
  assert.equal(r.completions, 10 + 32);
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

test('邀請碼：後台產生、說明文字、作廢後不能用', () => {
  const { env, call, L } = world();
  const inv = call(L, 'inviteCreate', { role: '服務員', name: '林服務員' });
  assert.match(inv.message, new RegExp(inv.code));
  assert.ok(call(L, 'inviteList').invites.some((i) => i.code === inv.code));
  assert.equal(call(L, 'inviteVoid', { code: inv.code }).ok, true);
  assert.equal(env.api({ action: 'checkCode', code: inv.code, childName: '' }).code, 'CODE_INVALID');
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
  ms.meetings.slice(0, 3).forEach((m) => call(A, 'attendanceSave', { meetingId: m.meetingId, marks: { [cubId]: '出席' } }));
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
  env.ctx.installBackupTrigger();
  env.ctx.installBackupTrigger();
  assert.equal(env.triggers.length, 1, '重複安裝不重複');
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
