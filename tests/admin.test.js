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
const itemsOf = (env, unit) => env.rows('項目總表').filter((r) => r[2] === unit).map((r) => r[0]);

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

test('邀請碼功能已拿掉：後台不能再產生；之前留下的邀請碼可以作廢', () => {
  const { env, call, L } = world();
  assert.equal(call(L, 'inviteCreate', { role: '服務員', name: '林服務員' }).code, 'BAD_INPUT', '不支援的操作');
  // 模擬之前產生、還沒用掉的邀請碼
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
  assert.equal(env.rows('告知同意內容').length, 2, '舊版保留');
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
  const guide = env.rows('項目總表').filter((r) => r[2] === '嚮導').map((r) => r[0]);
  call(L, 'signoff', { cubIds: [cubId], itemIds: guide, date: '2026-10-01' });
  const add = call(L, 'itemSave', { category: '技能章', unit: '嚮導', text: '能帶家人走一次自己規劃的路線' });
  assert.equal(add.needConfirm, true);
  assert.match(add.warnings[0], /1 位小狼的「嚮導」從「已完成待頒發」變成「進行中」：測試小狼甲/);
  assert.equal(env.rows('項目總表').filter((r) => r[2] === '嚮導').length, 2, '未確認前不寫入');
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
