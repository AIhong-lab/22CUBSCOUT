// 純邏輯測試（不依賴 Google 服務）。測試資料一律為虛構。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../gas/Logic.js');

const S = L.STATUS;
const TODAY = '2026-11-14';

// ───── 測試用項目總表（虛構、精簡） ─────
const HEADER = ['項目ID', '類別', '級別或章名', '大項', '項目內容', '排序', '啟用'];
function itemsTable(extraRows = []) {
  return [HEADER,
    ['P-剛入團-1', '進程', '剛入團', '－', '剛入團一', 1, '是'],
    ['P-剛入團-2', '進程', '剛入團', '－', '剛入團二', 2, '是'],
    ['P-羚羊-1', '進程', '羚羊', '－', '羚羊一', 10, '是'],
    ['P-羚羊-2', '進程', '羚羊', '－', '羚羊二', 20, '是'],
    ['P-狼-國旗-1', '進程', '狼', '國旗', '狼一', 30, '是'],
    ['P-狼-國旗-2', '進程', '狼', '國旗', '狼二', 40, '是'],
    ['P-鹿-國旗-1', '進程', '鹿', '國旗', '鹿一', 50, '是'],
    ['P-豹-國旗-1', '進程', '豹', '國旗', '豹一', 60, '是'],
    ['B-嚮導-1', '技能章', '嚮導', '－', '嚮導一', 70, '是'],
    ['B-嚮導-2', '技能章', '嚮導', '－', '嚮導二', 80, '是'],
    ['B-環保-1', '技能章', '環保', '－', '環保一', 90, '是'],
    ...extraRows];
}
const items = () => L.parseItems(itemsTable()).items;
const done = (cubId, itemId, date = '2026-01-10', extra = {}) => ({ cubId, itemId, date, signer: 'A1', note: '', reporter: '', reportStatus: '', ...extra });
const award = (cubId, unit, date) => ({ cubId, unit, date, occasion: '', note: '', signer: 'A1' });
function progress(completions, awards, opts = {}) {
  return L.computeCubProgress({ cubId: 'C1', items: opts.items || items(), completions, awards, intervalMonths: opts.interval ?? 6, today: opts.today || TODAY,
    attendance: opts.attendance, levelAttendCount: opts.levelAttend || 0, newbieAttendCount: opts.newbieAttend || 0 });
}
const unit = (p, name) => p.units.find((u) => u.unit === name);

// ───── 狀態判定 ─────

test('四種狀態判定', () => {
  const p = progress([done('C1', 'P-羚羊-1'), done('C1', 'P-羚羊-2'), done('C1', 'B-嚮導-1'), done('C1', 'B-環保-1')], [award('C1', '羚羊', '2026-02-01')]);
  assert.equal(unit(p, '羚羊').status, S.AWARDED);
  assert.equal(unit(p, '羚羊').awardDate, '2026-02-01');
  assert.equal(unit(p, '環保').status, S.DONE_PENDING);
  assert.equal(unit(p, '嚮導').status, S.IN_PROGRESS);
  assert.equal(unit(p, '鹿').status, S.NOT_STARTED);
});

test('目前級別的下一級即使 0 項完成也視為進行中', () => {
  const p0 = progress([], []);
  assert.equal(p0.currentLevel, null);
  assert.equal(unit(p0, '剛入團').status, S.IN_PROGRESS, '新入團：剛入團為下一級');
  assert.equal(unit(p0, '羚羊').status, S.NOT_STARTED);
  const pn = progress([], [award('C1', '剛入團', '2025-10-01')]);
  assert.equal(pn.currentLevel, '剛入團');
  assert.equal(unit(pn, '羚羊').status, S.IN_PROGRESS, '拿到黃領巾後挑戰羚羊');
  const p1 = progress([], [award('C1', '羚羊', '2026-02-01')]);
  assert.equal(p1.currentLevel, '羚羊');
  assert.equal(unit(p1, '狼').status, S.IN_PROGRESS);
  assert.equal(unit(p1, '鹿').status, S.NOT_STARTED);
});

test('豹級頒發後沒有下一級', () => {
  const p = progress([], ['羚羊', '狼', '鹿', '豹'].map((l, i) => award('C1', l, `202${i}-01-01`)));
  assert.equal(p.currentLevel, '豹');
  assert.equal(p.nextLevel, null);
  assert.equal(L.nextChallenge(p).type, 'allDone');
});

test('停用的項目不計入完成度與達標', () => {
  const rows = itemsTable([['B-環保-2', '技能章', '環保', '－', '環保二（停用）', 95, '否']]);
  const p = progress([done('C1', 'B-環保-1')], [], { items: L.parseItems(rows).items });
  const u = unit(p, '環保');
  assert.equal(u.total, 1);
  assert.equal(u.status, S.DONE_PENDING);
  assert.equal(u.eligible, true);
});

test('新增項目後狀態重算：已完成待頒發變回進行中', () => {
  const comps = [done('C1', 'B-環保-1')];
  assert.equal(unit(progress(comps, []), '環保').status, S.DONE_PENDING);
  const rows = itemsTable([['B-環保-2', '技能章', '環保', '－', '新項目', 95, '是']]);
  const after = unit(progress(comps, [], { items: L.parseItems(rows).items }), '環保');
  assert.equal(after.status, S.IN_PROGRESS);
  assert.equal(after.eligible, false);
});

test('已頒章不受項目修改影響', () => {
  const rows = itemsTable([['B-環保-2', '技能章', '環保', '－', '新項目', 95, '是']]);
  const p = progress([done('C1', 'B-環保-1')], [award('C1', '環保', '2026-03-01')], { items: L.parseItems(rows).items });
  assert.equal(unit(p, '環保').status, S.AWARDED);
});

test('第二期預留：回報狀態為待確認的紀錄不算完成', () => {
  const p = progress([done('C1', 'B-環保-1', '2026-01-10', { reportStatus: '待確認', reporter: 'U9' })], []);
  assert.equal(unit(p, '環保').done, 0);
  const p2 = progress([done('C1', 'B-環保-1', '2026-01-10', { reportStatus: '已確認' })], []);
  assert.equal(unit(p2, '環保').done, 1);
});

// ───── 達標判定 ─────

test('羚羊：全部完成且剛入團已頒發即達標（不套用晉級間隔月數）', () => {
  const comps = [done('C1', 'P-羚羊-1'), done('C1', 'P-羚羊-2', '2026-03-05')];
  assert.equal(unit(progress(comps, []), '羚羊').eligible, false, '剛入團還沒頒發');
  const p = progress(comps, [award('C1', '剛入團', '2026-03-01')]);
  assert.equal(unit(p, '羚羊').eligible, true);
  assert.equal(unit(p, '羚羊').eligibleDate, '2026-03-05', '不用等 6 個月');
});

test('剛入團：全部完成＋入團後出席滿 4 次；羚羊：剛入團頒發後再出席 8 次', () => {
  const comps = [done('C1', 'P-剛入團-1', '2025-09-10'), done('C1', 'P-剛入團-2', '2025-09-20')];
  const days = ['2025-09-06', '2025-09-13', '2025-09-20', '2025-09-27', '2025-09-30'];
  const three = progress(comps, [], { newbieAttend: 4, attendance: days.slice(0, 3).map((d) => att(d)) });
  assert.equal(unit(three, '剛入團').eligible, false);
  assert.deepEqual([unit(three, '剛入團').attendSinceLast, unit(three, '剛入團').attendRequired], [3, 4]);
  const four = unit(progress(comps, [], { newbieAttend: 4, attendance: days.slice(0, 4).map((d) => att(d)) }), '剛入團');
  assert.equal(four.eligible, true);
  assert.equal(four.eligibleDate, '2025-09-27', '第 4 次出席日');
  // 羚羊：剛入團 2025-10-01 頒發後要再出席 8 次
  const lion = [done('C1', 'P-羚羊-1', '2025-10-05'), done('C1', 'P-羚羊-2', '2025-10-05')];
  const after = ['2025-10-04', '2025-10-11', '2025-10-18', '2025-10-25', '2025-11-01', '2025-11-08', '2025-11-15', '2025-11-22'];
  const seven = unit(progress(lion, [award('C1', '剛入團', '2025-10-01')], { levelAttend: 8, attendance: [...days, ...after.slice(0, 7)].map((d) => att(d)) }), '羚羊');
  assert.deepEqual([seven.eligible, seven.attendSinceLast], [false, 7], '剛入團頒發前的出席不算');
  const eight = unit(progress(lion, [award('C1', '剛入團', '2025-10-01')], { levelAttend: 8, attendance: [...days, ...after].map((d) => att(d)) }), '羚羊');
  assert.deepEqual([eight.eligible, eight.eligibleDate], [true, '2025-11-22']);
});

test('已經拿到羚羊以上的小狼，視為已通過剛入團（不需要補頒黃領巾）', () => {
  const p = progress([], [award('C1', '羚羊', '2025-06-01')]);
  assert.equal(unit(p, '剛入團').status, S.AWARDED);
  assert.equal(unit(p, '剛入團').awardDate, null);
  assert.equal(p.currentLevel, '羚羊');
  assert.equal(unit(p, '狼').status, S.IN_PROGRESS);
});

test('技能章：項目全部完成即達標', () => {
  const p = progress([done('C1', 'B-環保-1', '2026-03-05')], []);
  assert.equal(unit(p, '環保').eligible, true);
  assert.equal(unit(p, '環保').eligibleDate, '2026-03-05');
});

test('晉級間隔以上一級「頒發日期」起算，不是登錄時間', () => {
  const comps = [done('C1', 'P-狼-國旗-1', '2026-03-01'), done('C1', 'P-狼-國旗-2', '2026-04-01')];
  const awards = [{ ...award('C1', '羚羊', '2026-05-20'), registeredAt: '2026-11-01' }];
  assert.equal(unit(progress(comps, awards, { today: '2026-11-19' }), '狼').eligible, false, '未滿 6 個月');
  const ok = unit(progress(comps, awards, { today: '2026-11-20' }), '狼');
  assert.equal(ok.eligible, true, '頒發日 + 6 個月當天即達標');
  assert.equal(ok.eligibleDate, '2026-11-20');
});

test('上一級未頒發時，下一級不達標', () => {
  const comps = [done('C1', 'P-狼-國旗-1'), done('C1', 'P-狼-國旗-2')];
  assert.equal(unit(progress(comps, []), '狼').eligible, false);
});

test('間隔月數遇月底：8/31 + 6 個月 = 2/28', () => {
  assert.equal(L.addMonths('2025-08-31', 6), '2026-02-28');
  assert.equal(L.addMonths('2023-08-31', 6), '2024-02-29');
});

test('修改頒發日期後重算達標', () => {
  const comps = [done('C1', 'P-狼-國旗-1'), done('C1', 'P-狼-國旗-2')];
  assert.equal(unit(progress(comps, [award('C1', '羚羊', '2026-03-01')]), '狼').eligible, true);
  assert.equal(unit(progress(comps, [award('C1', '羚羊', '2026-08-01')]), '狼').eligible, false);
});

test('撤銷頒章後目前級別退回並重算', () => {
  const awards = [award('C1', '羚羊', '2025-01-01'), award('C1', '狼', '2025-08-01')];
  assert.equal(L.levelAfterRevoke(awards, '狼'), '羚羊');
  assert.equal(L.levelAfterRevoke([awards[0]], '羚羊'), null);
  const p = progress([], [awards[0]]);
  assert.equal(p.currentLevel, '羚羊');
  assert.equal(unit(p, '狼').status, S.IN_PROGRESS);
});

// ───── 頒章 ─────

test('頒發日期不可早於最後完成日，未來日期需確認', () => {
  assert.equal(L.validateAwardDate('2026-03-01', '2026-03-05', TODAY).ok, false);
  assert.deepEqual(L.validateAwardDate('2026-03-05', '2026-03-05', TODAY), { ok: true, needConfirmFuture: false });
  assert.equal(L.validateAwardDate('2026-12-01', '2026-03-05', TODAY).needConfirmFuture, true);
  assert.equal(L.validateAwardDate('2026-02-30', null, TODAY).ok, false);
  assert.equal(L.validateAwardDate('', null, TODAY).ok, false);
});

test('補登後狀態正確，且不發通知、提示較低級別', () => {
  const plan = L.planBackfill({ cubId: 'C1', category: '進程', unit: '狼', date: '2025-06-01', signer: 'A1', items: items(), completions: [done('C1', 'P-狼-國旗-1', '2025-01-01')], awards: [] });
  assert.equal(plan.notify, false);
  assert.deepEqual(plan.missingLowerLevels, ['剛入團', '羚羊']);
  assert.deepEqual(plan.newCompletions.map((c) => c.itemId), ['P-狼-國旗-2'], '已完成的不重複寫');
  assert.equal(plan.newCompletions[0].note, '上線補登');
  assert.equal(plan.newCompletions[0].date, '2025-06-01');
  const lion = L.planBackfill({ cubId: 'C1', category: '進程', unit: '羚羊', date: '2025-01-01', signer: 'A1', items: items(), completions: [], awards: [] });
  const p = progress([done('C1', 'P-狼-國旗-1', '2025-01-01'), ...lion.newCompletions, ...plan.newCompletions], [lion.award, plan.award]);
  assert.equal(p.currentLevel, '狼');
  assert.equal(unit(p, '羚羊').status, S.AWARDED);
  assert.equal(unit(p, '狼').status, S.AWARDED);
  assert.equal(unit(p, '鹿').status, S.IN_PROGRESS);
});

// ───── 簽核 ─────

test('小隊批次簽核略過已完成的組合', () => {
  const existing = [done('C1', 'B-環保-1'), done('C2', 'B-環保-1', '2026-01-01', { reportStatus: '待確認' })];
  const r = L.planBatchSignoff(existing, ['C1', 'C2', 'C3'], ['B-環保-1', 'B-嚮導-1'], TODAY, 'A1');
  assert.equal(r.skipped, 1);
  assert.equal(r.toAdd.length, 5);
  assert.ok(r.toAdd.every((c) => c.reporter === '' && c.reportStatus === ''));
});

test('完成紀錄讀寫正確帶過回報人、回報狀態兩欄', () => {
  const row = ['C1', 'B-環保-1', '2026-01-01', 'A1', '備註', 'U9', '待確認'];
  assert.deepEqual(L.completionToRow(L.rowToCompletion(row)), row);
});

// ───── 代碼 ─────

const rand = (n) => crypto.randomInt(n);

test('綁定碼字元集排除易混淆字元，長度依設定', () => {
  for (const ch of '0O1IL') assert.ok(!L.CODE_CHARSET.includes(ch));
  for (let i = 0; i < 200; i++) {
    const c = L.generateCode(6, rand, []);
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

test('綁定碼不重複（與既有綁定碼、邀請碼皆不衝突）', () => {
  const set = new Set();
  for (let i = 0; i < 500; i++) set.add(L.generateCode(6, rand, [...set]));
  assert.equal(set.size, 500);
});

test('代碼產生遇到重複會重抽', () => {
  // 前 6 次亂數都給 0（產生 AAAAAA，已被使用），之後給 1（產生 BBBBBB）
  let calls = 0;
  const r = (k) => (calls++ < 6 ? 0 : 1) % k;
  assert.equal(L.generateCode(6, r, ['AAAAAA']), 'BBBBBB');
});

test('邀請碼過期、已使用、已作廢都被擋', () => {
  const now = Date.parse('2026-11-14T10:00:00Z');
  const inv = { status: '未使用', expiresAt: now + 1000 };
  assert.equal(L.checkInvite(inv, now).ok, true);
  assert.equal(L.checkInvite({ ...inv, expiresAt: now - 1 }, now).ok, false);
  assert.equal(L.checkInvite({ ...inv, status: '已使用' }, now).ok, false);
  assert.equal(L.checkInvite({ ...inv, status: '已作廢' }, now).ok, false);
  assert.equal(L.checkInvite(null, now).ok, false);
});

test('邀請碼長度 = 綁定碼長度 + 2，與綁定碼不衝突', () => {
  const bind = L.generateCode(6, rand, []);
  const inv = L.generateCode(8, rand, [bind]);
  assert.equal(inv.length, 8);
  assert.notEqual(inv, bind);
});

test('綁定碼檢查：姓名需符合、需在團、次數未用完；錯誤訊息不透露原因', () => {
  const cub = { name: '測試小狼甲', status: '在團', codeUsesLeft: 1 };
  assert.equal(L.checkBindCode(cub, ' 測試小狼甲 ').ok, true);
  assert.equal(L.checkBindCode(cub, '測試小狼乙').ok, false);
  assert.equal(L.checkBindCode({ ...cub, codeUsesLeft: 0 }, '測試小狼甲').ok, false);
  assert.equal(L.checkBindCode({ ...cub, status: '離團' }, '測試小狼甲').ok, false);
  assert.ok(!/綁定碼|邀請碼|不存在|用完|離團/.test(L.CODE_ERROR_MESSAGE));
  assert.equal(L.normalizeCode(' ab cd2 '), 'ABCD2');
});

// ───── 帳號與登入 ─────

const hmacHex = (v, k) => crypto.createHmac('sha256', k).update(v).digest('hex');

test('密碼雜湊與驗證', () => {
  const stored = L.hashPassword('secret123', 'salt-x', 50, hmacHex);
  assert.ok(stored.startsWith('50$'));
  assert.ok(!stored.includes('secret123'));
  assert.equal(L.verifyPassword('secret123', 'salt-x', stored, hmacHex), true);
  assert.equal(L.verifyPassword('secret124', 'salt-x', stored, hmacHex), false);
  assert.equal(L.verifyPassword('secret123', 'salt-y', stored, hmacHex), false);
  assert.equal(L.verifyPassword('x', 's', '', hmacHex), false);
});

test('帳號、密碼、稱呼格式檢查', () => {
  assert.equal(L.validateUsername('test_wolf01').ok, true);
  assert.equal(L.validateUsername('ab').ok, false);
  assert.equal(L.validateUsername('中文帳號').ok, false);
  assert.equal(L.validatePassword('1234567', 8).ok, false);
  assert.equal(L.validatePassword('12345678', 8).ok, false, '連續數字太弱');
  assert.equal(L.validatePassword('blue-kite-58', 8).ok, true);
  assert.equal(L.validateNickname('').ok, false);
  assert.equal(L.validateNickname('測試小狼媽媽').ok, true);
});

test('登入憑證與臨時碼過期', () => {
  const now = 1_000_000;
  assert.equal(L.isSessionValid({ expiresAt: now + 1 }, now), true);
  assert.equal(L.isSessionValid({ expiresAt: now - 1 }, now), false);
  assert.equal(L.isSessionValid(null, now), false);
  assert.equal(L.isTempCodeValid({ tempCodeHash: 'h', tempCodeExpiresAt: now + 1 }, now), true);
  assert.equal(L.isTempCodeValid({ tempCodeHash: 'h', tempCodeExpiresAt: now - 1 }, now), false);
  assert.equal(L.isTempCodeValid({ tempCodeHash: '', tempCodeExpiresAt: now + 1 }, now), false, '用過即清除，不可再用');
});

test('登入與綁定失敗鎖定（含未登入全站上限）', () => {
  const settings = L.parseSettings([]).values;
  const now = Date.parse('2026-11-14T10:00:00Z');
  const f = (type, target, minAgo) => ({ type, target, at: now - minAgo * 60000 });
  const four = [1, 2, 3, 4].map((m) => f('登入', 'test_wolf01', m));
  assert.equal(L.isLocked(four, '登入', 'test_wolf01', now, settings), false);
  assert.equal(L.isLocked([...four, f('登入', 'test_wolf01', 5)], '登入', 'test_wolf01', now, settings), true);
  assert.equal(L.isLocked([...four, f('登入', 'test_wolf01', 61)], '登入', 'test_wolf01', now, settings), false, '超過鎖定分鐘數的不算');
  assert.equal(L.isLocked([...four, f('登入', 'other', 1)], '登入', 'test_wolf01', now, settings), false);
  const global = Array.from({ length: 20 }, (_, i) => f('綁定', '未登入', i));
  assert.equal(L.isGlobalBindLocked(global, now, settings), true);
  assert.equal(L.isGlobalBindLocked(global.slice(1), now, settings), false);
});

// ───── 告知同意 ─────

test('同意版本過期判定', () => {
  const latest = L.latestConsentVersion([{ version: 1 }, { version: '3' }, { version: 2 }]);
  assert.equal(latest, 3);
  assert.equal(L.needsReconsent({ consentVersion: 3 }, latest), false);
  assert.equal(L.needsReconsent({ consentVersion: '2' }, latest), true);
  assert.equal(L.needsReconsent({ consentVersion: '' }, latest), true, '沒有同意紀錄就沒有綁定');
});

// ───── 權限 ─────

test('角色權限矩陣', () => {
  const leaderOnly = ['manageCubs', 'manageCalendar', 'manageBindCodes', 'award', 'backfill', 'manageAdmins', 'manageInvites', 'manageAccounts', 'manageItems', 'manageSettings', 'manageEvents', 'privacy', 'backup', 'revokeAnySignoff', 'reviewRequests', 'manageSquadStaff', 'manageRoles'];
  const both = ['signoff', 'attendance', 'revokeOwnSignoff', 'viewRoster', 'viewOverview', 'printSheet', 'linkLine', 'postNotice'];
  for (const a of leaderOnly) {
    assert.equal(L.can('團長', a), true, a);
    assert.equal(L.can('服務員', a), false, a);
    assert.equal(L.can(null, a), false, a);
  }
  for (const a of both) {
    assert.equal(L.can('團長', a), true, a);
    assert.equal(L.can('服務員', a), true, a);
    assert.equal(L.can(null, a), false, '家長不可進後台：' + a);
  }
  assert.deepEqual(Object.keys(L.PERMISSIONS).sort(), [...leaderOnly, ...both].sort(), '矩陣沒有遺漏或多出的操作');
  assert.equal(L.can('團長', '不存在的操作'), false);
});

test('服務員只能撤銷自己的簽核', () => {
  assert.equal(L.canRevokeSignoff('服務員', 'A2', 'A2'), true);
  assert.equal(L.canRevokeSignoff('服務員', 'A2', 'A1'), false);
  assert.equal(L.canRevokeSignoff('團長', 'A1', 'A2'), true);
  assert.equal(L.canRevokeSignoff(null, 'U1', 'U1'), false);
});

// ───── 管理員異動 ─────

const admins = [{ accountId: 'A1', role: '團長' }, { accountId: 'A2', role: '服務員' }];

test('最後一位團長不可移除或降級', () => {
  const two = [...admins, { accountId: 'A3', role: '團長' }];
  assert.equal(L.validateAdminChange(two, 'A3', { type: 'remove', targetId: 'A1' }).ok, true);
  assert.equal(L.validateAdminChange(two, 'A3', { type: 'setRole', targetId: 'A1', role: '服務員' }).ok, true);
  // 只剩一位團長時，能操作的團長只有他本人，會先被「不可移除／降級自己」擋下；
  // validateAdminChange 內的「最後一位團長」檢查是額外保險，正常流程走不到。
  assert.equal(L.validateAdminChange(admins, 'A1', { type: 'setRole', targetId: 'A1', role: '服務員' }).ok, false);
  assert.equal(L.canDeleteAccount(admins, 'A1').ok, false);
  assert.equal(L.canDeleteAccount(two, 'A1').ok, true);
});

test('團長不可移除自己，也不可自行降級', () => {
  const two = [...admins, { accountId: 'A3', role: '團長' }];
  assert.equal(L.validateAdminChange(two, 'A1', { type: 'remove', targetId: 'A1' }).ok, false);
  assert.equal(L.validateAdminChange(two, 'A1', { type: 'setRole', targetId: 'A1', role: '服務員' }).ok, false);
});

test('只有團長能管理管理員', () => {
  assert.equal(L.validateAdminChange(admins, 'A2', { type: 'add', targetId: 'U5', role: '服務員' }).ok, false);
  assert.equal(L.validateAdminChange(admins, 'U9', { type: 'add', targetId: 'U5', role: '服務員' }).ok, false);
  assert.equal(L.validateAdminChange(admins, 'A1', { type: 'add', targetId: 'U5', role: '服務員' }).ok, true);
  assert.equal(L.validateAdminChange(admins, 'A1', { type: 'add', targetId: 'A2', role: '服務員' }).ok, false, '已是管理員');
  assert.equal(L.validateAdminChange(admins, 'A1', { type: 'remove', targetId: 'A2' }).ok, true);
  assert.equal(L.validateAdminChange(admins, 'A1', { type: 'setRole', targetId: 'A2', role: '團長' }).ok, true);
});

// ───── 個資處理 ─────

function privacyData() {
  return {
    '小狼名單': [['小狼ID', '姓名', '小隊', '入團日', '目前級別', '綁定碼', '綁定碼剩餘次數', '狀態', '離團日'],
      ['C1', '測試小狼甲', '一小隊', '2025-01-01', '狼', 'ABCDEF', 2, '離團', '2026-01-01'],
      ['C2', '測試小狼乙', '二小隊', '2025-01-01', '羚羊', 'GHJKMN', 3, '在團', ''],
      ['C9', '已離團小狼2', '', '2024-01-01', '鹿', '', 0, '已匿名', '2025-01-01']],
    '綁定紀錄': [['帳號ID', '小狼ID', '綁定時間', '同意時間', '同意版本'], ['U1', 'C1', 't', 't', 1], ['U2', 'C2', 't', 't', 1], ['U3', 'C1', 't', 't', 1]],
    '完成紀錄': [['小狼ID', '項目ID'], ['C1', 'P-羚羊-1'], ['C2', 'P-羚羊-1'], ['C1', 'P-羚羊-2']],
    '頒章紀錄': [['小狼ID', '級別或章名'], ['C1', '羚羊'], ['C2', '羚羊']],
    '通知紀錄': [['小狼ID', '級別或章名'], ['C1', '狼']],
    '出席紀錄': [['集會ID', '小狼ID', '狀態'], ['M1', 'C1', '出席'], ['M1', 'C2', '請假'], ['M2', 'C1', '請假']],
    '額外出席': [['年度名稱', '小狼ID', '額外出席次數'], ['115學年度', 'C1', 2]],
    '註冊申請': [['申請ID', '帳號ID', '類型', '填寫姓名', '申請時間', '狀態', '處理人', '處理時間', '小狼ID'], ['R1', 'U1', '孩子', '', 't', '已核准', 'A1', 't', 'C1'], ['R2', 'U9', '孩子', '某孩子', 't', '待審核', '', '', '']],
    '操作日誌': [['時間', '操作人', '動作', '對象', '修改前', '修改後'],
      ['t', 'A1', '新增小狼', '測試小狼甲', '', '測試小狼甲／一小隊'],
      ['t', 'A1', '新增小狼', '測試小狼乙', '', '']]
  };
}

test('完全刪除涵蓋所有相關分頁', () => {
  const plan = L.planPrivacy(privacyData(), 'C1', 'delete');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.deleteRows, { '小狼名單': [2], '綁定紀錄': [2, 4], '完成紀錄': [2, 4], '頒章紀錄': [2], '通知紀錄': [2], '出席紀錄': [2, 4], '額外出席': [2], '註冊申請': [2], '職務紀錄': [] });
  assert.deepEqual(Object.keys(plan.deleteRows).sort(), Object.keys(L.CUB_ID_COLUMNS).sort());
  assert.equal(plan.updateRows['操作日誌'].length, 1);
  const v = plan.updateRows['操作日誌'][0].values;
  assert.ok(!v.join('').includes('測試小狼甲'));
  assert.equal(v[3], '已刪除');
  assert.equal(plan.counts['綁定紀錄'], 2);
});

test('匿名化：改名加流水號、清空小隊與綁定碼、刪除綁定、保留完成與頒章紀錄', () => {
  const plan = L.planPrivacy(privacyData(), 'C1', 'anonymize');
  const row = plan.updateRows['小狼名單'][0];
  assert.equal(row.row, 2);
  assert.equal(row.values[1], '已離團小狼3');
  assert.equal(row.values[2], '');
  assert.equal(row.values[5], '');
  assert.equal(row.values[7], '已匿名');
  assert.deepEqual(plan.deleteRows, { '綁定紀錄': [2, 4] });
  assert.ok(!plan.deleteRows['完成紀錄'] && !plan.deleteRows['頒章紀錄'] && !plan.deleteRows['出席紀錄'] && !plan.deleteRows['額外出席'], '統計用紀錄保留');
  assert.ok(!plan.updateRows['操作日誌'].some((u) => u.values.join('').includes('測試小狼甲')));
});

test('個資處理找不到小狼時不動任何資料', () => {
  assert.equal(L.planPrivacy(privacyData(), 'C404', 'delete').ok, false);
});

test('離團超過設定天數未處理個資的提醒', () => {
  const cubs = [{ status: '離團', leftDate: '2026-01-01' }, { status: '離團', leftDate: '2026-10-01' }, { status: '已匿名', leftDate: '2020-01-01' }];
  assert.equal(L.overdueForPrivacy(cubs, 180, TODAY).length, 1);
  assert.equal(L.overdueForPrivacy(cubs, 0, TODAY).length, 0, '0 表示不提醒');
});

// ───── 項目總表與設定容錯 ─────

test('項目總表格式錯誤的容錯：略過壞列並回報列號', () => {
  const rows = itemsTable([
    ['', '', '', '', '', '', ''],                                   // 空白列：略過、不算錯
    ['P-羚羊-1', '進程', '羚羊', '－', '重複ID', 1, '是'],          // 重複
    ['P-X-1', '進程', '', '－', '缺級別', 1, '是'],                 // 缺級別
    ['B-新-1', '技能章', '新章', '－', '啟用欄錯', 1, 'Y'],          // 啟用欄錯
    ['  B-繪畫-1 ', ' 技能章 ', ' 繪畫 ', '', ' 會素描 ', '', ' 是 '], // 前後空白：要能讀
  ]);
  const r = L.parseItems(rows);
  assert.deepEqual(r.errors.map((e) => e.row), [14, 15, 16]);
  const paint = r.items.find((i) => i.id === 'B-繪畫-1');
  assert.ok(paint);
  assert.equal(paint.text, '會素描');
  assert.equal(paint.section, '－');
  assert.equal(r.items.length, 12);
});

test('設定值超出範圍或格式錯誤退回預設', () => {
  const rows = [['鍵', '值', '說明'], ['綁定碼長度', 99], ['晉級間隔月數', '3'], ['每週備份', '也許'], ['備份保留份數', '2.5'], ['快達標門檻（剩幾項以內）', ' 3 ']];
  const r = L.parseSettings(rows);
  assert.equal(r.values['綁定碼長度'], 6);
  assert.equal(r.values['晉級間隔月數'], 3);
  assert.equal(r.values['每週備份'], true);
  assert.equal(r.values['備份保留份數'], 8);
  assert.equal(r.values['快達標門檻（剩幾項以內）'], 3);
  const bad = r.errors.map((e) => e.key);
  assert.ok(bad.includes('綁定碼長度') && bad.includes('每週備份') && bad.includes('備份保留份數'));
  assert.ok(!bad.includes('晉級間隔月數'));
  const def = L.parseSettings(L.defaultSettingsRows());
  assert.equal(def.errors.length, 0, '預設設定本身要合法');
});

// ───── 項目ID 與種子資料 ─────

test('項目ID 穩定可讀、取最大序號 + 1、永不重用', () => {
  assert.equal(L.nextItemId([], '進程', '狼', '國旗'), 'P-狼-國旗-1');
  assert.equal(L.nextItemId([], '進程', '羚羊', '－'), 'P-羚羊-1');
  assert.equal(L.nextItemId([], '技能章', '嚮導', '－'), 'B-嚮導-1');
  assert.equal(L.nextItemId(['B-嚮導-1', 'B-嚮導-3'], '技能章', '嚮導', '－'), 'B-嚮導-4', '中間刪掉的序號也不重用');
  assert.equal(L.nextItemId(['P-狼-勞作-2'], '技能章', '勞作', '－'), 'B-勞作-1', '進程勞作與技能章勞作分開');
});

test('種子資料：data/items.csv 匯入後數量與ID正確', () => {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'data', 'items.csv'), 'utf8');
  const seed = L.buildSeed(csv, { 羚羊: '羚羊條件' });
  assert.equal(seed.itemRows.length, 163);
  const ids = seed.itemRows.map((r) => r[0]);
  assert.equal(new Set(ids).size, 163, 'ID 不重複');
  assert.ok(ids.includes('P-羚羊-10') && ids.includes('P-狼-國旗-1') && ids.includes('B-嚮導-1') && ids.includes('B-勞作-2') && ids.includes('P-豹-勞作-3'));
  const units = seed.unitRows;
  assert.equal(units.filter((u) => u[1] === '進程').length, 4);
  assert.equal(units.filter((u) => u[1] === '技能章').length, 26);
  assert.equal(units.find((u) => u[0] === '羚羊')[4], '羚羊條件');
  assert.equal(units.find((u) => u[0] === '體操')[2], '健身類');
  const table = [HEADER, ...seed.itemRows];
  assert.equal(L.parseItems(table).errors.length, 0, '匯入結果本身要通過檢查');
});

// ───── 其他 ─────

test('入團至今多久', () => {
  assert.equal(L.tenure('2024-05-14', TODAY).text, '2 年 6 個月');
  assert.equal(L.tenure('2024-05-15', TODAY).text, '2 年 5 個月');
  assert.equal(L.tenure('2026-01-31', '2026-02-28').text, '0 年 1 個月');
  assert.equal(L.tenure('2027-01-01', TODAY).text, '0 年 0 個月');
});

test('下一步挑戰：剛入團、晉級後、等待頒發', () => {
  const start = L.nextChallenge(progress([], []));
  assert.equal(start.type, 'start');
  assert.equal(start.level, '剛入團');
  assert.deepEqual(start.items.map((i) => i.id), ['P-剛入團-1', 'P-剛入團-2']);
  const next = L.nextChallenge(progress([done('C1', 'P-狼-國旗-1')], [award('C1', '羚羊', '2026-01-01')]));
  assert.equal(next.type, 'next');
  assert.match(next.message, /恭喜你完成羚羊進程/);
  assert.deepEqual(next.items.map((i) => i.id), ['P-狼-國旗-2']);
  const pending = L.nextChallenge(progress([done('C1', 'P-狼-國旗-1'), done('C1', 'P-狼-國旗-2')], [award('C1', '羚羊', '2026-01-01')]));
  assert.equal(pending.type, 'pending');
  assert.match(pending.message, /等待團長評核頒發/);
  assert.ok(!/可晉級/.test(pending.message));
});

test('快達標與查詢端狀態文字', () => {
  const p = progress([done('C1', 'B-嚮導-1')], []);
  assert.equal(L.isNearlyDone(unit(p, '嚮導'), 2), true);
  assert.equal(L.isNearlyDone(unit(p, '環保'), 2), false, '0 項完成不算快達標');
  assert.equal(L.statusTextForParents(S.DONE_PENDING), L.PENDING_TEXT_FOR_PARENTS);
});

test('通知去重：只通知新達標，不再達標者清除紀錄', () => {
  const r = L.diffNotifications(['C1|狼', 'C2|嚮導'], ['C1|狼', 'C3|環保']);
  assert.deepEqual(r.toNotify, ['C2|嚮導']);
  assert.deepEqual(r.toClear, ['C3|環保']);
});

test('CSV 解析與輸出互通', () => {
  const rows = [['a', 'b,c', '有"引號"'], ['換\n行', '', 'x']];
  assert.deepEqual(L.parseCsv(L.toCsv(rows)), rows);
});

// ───── 出席與進程 ─────

const att = (date, status = '出席') => ({ date, status });
function progressA(attendance, completions = [], awards = [award('C1', '剛入團', '2026-01-01')], opts = {}) {
  const rows = itemsTable([['P-羚羊-7', '進程', '羚羊', '－', '參加幼童軍團集會至少4次', 25, '是']]);
  return L.computeCubProgress({
    cubId: 'C1', items: L.parseItems(rows).items, completions, awards, attendance,
    intervalMonths: opts.interval ?? 6, today: opts.today || TODAY,
    autoItemId: 'P-羚羊-7', autoCount: 4, levelAttendCount: opts.need ?? 0,
  });
}
const itemOf = (p, id) => p.units.flatMap((u) => u.items).find((i) => i.id === id);

test('出席滿 4 次自動完成羚羊「參加團集會至少4次」，日期為第 4 次出席日', () => {
  const three = [att('2026-09-05'), att('2026-09-12'), att('2026-09-19', '請假'), att('2026-09-26')];
  assert.equal(itemOf(progressA(three), 'P-羚羊-7').done, false, '請假不算出席');
  const four = [...three, att('2026-10-17'), att('2026-10-03')];
  const it = itemOf(progressA(four), 'P-羚羊-7');
  assert.equal(it.done, true);
  assert.equal(it.date, '2026-10-03', '依日期排序取第 4 次');
  assert.equal(it.auto, true);
  assert.equal(it.signer, '出席自動計算');
});

test('羚羊「參加團集會至少4次」只算剛入團頒發日之後的出席（附錄第 64 點）', () => {
  const four = [att('2026-09-05'), att('2026-09-12'), att('2026-09-19'), att('2026-09-26'), att('2026-10-03')];
  assert.equal(itemOf(progressA(four, [], []), 'P-羚羊-7').done, false, '還沒頒剛入團：不自動完成');
  const after = itemOf(progressA(four, [], [award('C1', '剛入團', '2026-09-05')]), 'P-羚羊-7');
  assert.equal(after.done, true, '頒發當天不算，之後 4 次');
  assert.equal(after.date, '2026-10-03');
  assert.equal(itemOf(progressA(four, [], [award('C1', '剛入團', '2026-09-12')]), 'P-羚羊-7').done, false, '之後只有 3 次');
  assert.equal(itemOf(progressA(four, [], [award('C1', '羚羊', '2026-01-01')]), 'P-羚羊-7').done, true, '已有羚羊章（剛入團視為通過、沒有日期）：全部出席都算');
});

test('出席紀錄被修改後自動完成會重算（不寫入完成紀錄）', () => {
  const four = [att('2026-09-05'), att('2026-09-12'), att('2026-09-19'), att('2026-09-26')];
  assert.equal(itemOf(progressA(four), 'P-羚羊-7').done, true);
  four[3].status = '請假';
  assert.equal(itemOf(progressA(four), 'P-羚羊-7').done, false);
});

test('已有人工簽核時，取較早的日期', () => {
  const four = [att('2026-09-05'), att('2026-09-12'), att('2026-09-19'), att('2026-09-26')];
  const it = itemOf(progressA(four, [done('C1', 'P-羚羊-7', '2026-08-01')]), 'P-羚羊-7');
  assert.equal(it.date, '2026-08-01');
  assert.equal(it.auto, false);
});

test('晉級所需出席次數：上一級頒發日之後（不含當天）出席滿 N 次才達標', () => {
  const comps = [done('C1', 'P-狼-國旗-1', '2026-01-10'), done('C1', 'P-狼-國旗-2', '2026-01-10')];
  const awards = [award('C1', '羚羊', '2026-01-01')];
  const meetings = [att('2026-01-01'), att('2026-02-01'), att('2026-03-01', '請假'), att('2026-04-01')];
  const wolf = (attendance, need) => progressA(attendance, comps, awards, { need }).units.find((u) => u.unit === '狼');
  const w0 = wolf(meetings, 0);
  assert.equal(w0.eligible, true, '0 表示不要求');
  assert.equal(w0.attendRequired, undefined);
  const w2 = wolf(meetings, 2);
  assert.equal(w2.eligible, true);
  assert.equal(w2.attendSinceLast, 2, '頒發當天與請假都不算');
  assert.equal(w2.eligibleDate, '2026-07-01', '仍需滿 6 個月');
  const w3 = wolf(meetings, 3);
  assert.equal(w3.eligible, false);
  assert.equal(w3.attendRequired, 3);
  const late = wolf([...meetings, att('2026-08-15')], 3);
  assert.equal(late.eligible, true);
  assert.equal(late.eligibleDate, '2026-08-15', '達標日期取第 N 次出席日與滿間隔日較晚者');
});

test('出席與請假分開計算；遲到算出席，另外計數（附錄第 61 點）', () => {
  assert.deepEqual(L.attendanceCounts([att('a'), att('b', '請假'), att('c'), att('d', '')]), { attended: 2, leave: 1, late: 0 });
  assert.deepEqual(L.attendanceCounts([att('a'), att('b', '遲到'), att('c', '請假')]), { attended: 2, leave: 1, late: 1 });
  assert.equal(L.isPresent('遲到'), true);
  assert.equal(L.isPresent('請假'), false);
  assert.deepEqual(L.ATTEND_MARKS, ['出席', '遲到', '請假']);
});

test('遲到算晉級出席；集會設為「不計入進程」時不算晉級、自動完成與體驗次數，但出席率照算（附錄第 61 點）', () => {
  const four = [att('2026-09-05'), att('2026-09-12', '遲到'), att('2026-09-19'), att('2026-09-26')];
  assert.equal(itemOf(progressA(four), 'P-羚羊-7').done, true, '遲到算出席');
  four[3].counts = false;
  assert.equal(itemOf(progressA(four), 'P-羚羊-7').done, false, '不計入進程的集會不算');
  const recs = [{ date: '2026-09-05', status: '遲到', type: '一般' }, { date: '2026-09-12', status: '出席', type: '一般', counts: false }];
  assert.equal(L.trialProgress(recs, 4).count, 1, '體驗：遲到算、不計入的不算');
  const r = L.attendanceRate(recs, { start: '2026-09-01', end: '2026-12-31', total: 2 }, 0);
  assert.equal(r.count, 2, '出席率不受「計入進程」影響');
});

test('出席相關設定的預設與格式檢查', () => {
  const d = L.parseSettings(L.defaultSettingsRows()).values;
  assert.equal(d['出席自動完成項目ID'], 'P-羚羊-7');
  assert.equal(d['自動完成所需出席次數'], 4);
  assert.equal(d['晉級所需出席次數'], 8);
  assert.equal(d['剛入團所需出席次數'], 4);
  const bad = L.parseSettings([['鍵', '值'], ['出席自動完成項目ID', '羚羊第七項']]);
  assert.equal(bad.values['出席自動完成項目ID'], 'P-羚羊-7');
  assert.ok(bad.errors.some((e) => e.key === '出席自動完成項目ID'));
});

test('年度出席率：（出席 + 額外）÷ 總數，請假不減少分母', () => {
  const recs = [att('2025-08-30'), att('2025-09-06'), att('2025-09-13', '請假'), att('2026-03-01'), att('2026-08-01')];
  const period = { start: '2025-09-01', end: '2026-07-31', total: 18 };
  const r = L.attendanceRate(recs, period, 0);
  assert.deepEqual([r.attended, r.leave, r.total], [2, 1, 18], '只算年度期間內');
  assert.equal(r.text, '11%');
  const r2 = L.attendanceRate([...Array(15)].map((_, i) => att('2025-10-' + String(i + 1).padStart(2, '0'))).concat([att('2025-11-01', '請假'), att('2025-11-02', '請假')]), period, 0);
  assert.equal(r2.text, '83%', '15/18，請假 2 次不影響分母');
  assert.equal(L.attendanceRate(recs, period, 3).count, 5, '加上額外出席次數');
  assert.equal(L.attendanceRate(recs, { ...period, total: 0 }, 0).text, '', '總數未設定不顯示');
  const over = L.attendanceRate(recs, { ...period, total: 3 }, 5);
  assert.equal(over.count, 7);
  assert.equal(over.text, '100%', '最多顯示 100%');
});

test('依日期找年度出席設定', () => {
  const ps = [{ name: '114學年度', start: '2025-08-01', end: '2026-07-31' }, { name: '115學年度', start: '2026-08-01', end: '2027-07-31' }];
  assert.equal(L.periodOf(ps, '2026-11-14').name, '115學年度');
  assert.equal(L.periodOf(ps, '2024-01-01'), null);
});

// ───── 小隊清單 ─────

test('小隊清單：解析、預設為空、不算設定錯誤', () => {
  assert.deepEqual(L.parseList('黑豹小隊、灰狼小隊,白鹿小隊，黑豹小隊\n 星星小隊 '), ['黑豹小隊', '灰狼小隊', '白鹿小隊', '星星小隊']);
  const d = L.parseSettings(L.defaultSettingsRows());
  assert.deepEqual(d.values['小隊清單'], []);
  assert.equal(d.errors.length, 0);
  assert.deepEqual(L.parseSettings([['鍵', '值'], ['小隊清單', '甲隊、乙隊']]).values['小隊清單'], ['甲隊', '乙隊']);
});

test('小隊清單異動：新增、改名、刪除（使用中不可刪）、移動', () => {
  let r = L.changeSquads([], { type: 'add', name: '黑豹小隊' });
  assert.deepEqual(r.list, ['黑豹小隊']);
  assert.equal(L.changeSquads(r.list, { type: 'add', name: '黑豹小隊' }).ok, false, '不可重複');
  assert.equal(L.changeSquads(r.list, { type: 'add', name: '甲、乙' }).ok, false, '不可含分隔符號');
  r = L.changeSquads(['黑豹小隊', '灰狼小隊'], { type: 'rename', name: '黑豹小隊', newName: '豹豹小隊' });
  assert.deepEqual(r.list, ['豹豹小隊', '灰狼小隊']);
  assert.equal(L.changeSquads(['甲', '乙'], { type: 'rename', name: '甲', newName: '乙' }).ok, false, '改名不可撞名');
  assert.match(L.changeSquads(['甲', '乙'], { type: 'remove', name: '甲' }, ['甲']).error, /還有在團小狼/);
  assert.deepEqual(L.changeSquads(['甲', '乙'], { type: 'remove', name: '甲' }, ['乙']).list, ['乙']);
  assert.deepEqual(L.changeSquads(['甲', '乙', '丙'], { type: 'move', name: '丙', dir: 'up' }).list, ['甲', '丙', '乙']);
  assert.deepEqual(L.changeSquads(['甲', '乙'], { type: 'move', name: '甲', dir: 'up' }).list, ['甲', '乙'], '已在最上面不動');
});

test('進程細項：種子轉列、依項目與分組合併、通過標準取該組第一個有填的值、錯誤列回報列號', () => {
  const seed = L.buildDetailSeed('項目ID,分組,細項內容,通過標準,生活應用\nP-羚羊-1,甲,一,標準甲,生活甲\nP-羚羊-1,甲,二,,\nP-羚羊-1,乙,三,標準乙,\n,,空白,,\n');
  assert.deepEqual(seed.map((r) => [...r]), [
    ['P-羚羊-1', '甲', '一', '標準甲', '生活甲', 10, '是'],
    ['P-羚羊-1', '甲', '二', '', '', 20, '是'],
    ['P-羚羊-1', '乙', '三', '標準乙', '', 30, '是']
  ]);
  const head = ['項目ID', '分組', '細項內容', '通過標準', '生活應用', '排序', '啟用'];
  const rows = [head, ...seed,
    ['P-狼-國旗-1', '', '四', '', '', 5, '是'],
    ['P-狼-國旗-1', '', '停用的', '', '', 6, '否'],
    ['P-沒有-1', '', '五', '', '', 7, '是'],
    ['P-羚羊-1', '甲', '', '', '', 8, '是'],
    ['P-羚羊-1', '甲', '六', '', '', 9, '可能']];
  const r = L.parseDetails(rows, { 'P-羚羊-1': true, 'P-狼-國旗-1': true });
  assert.deepEqual(JSON.parse(JSON.stringify(r.byItem)), {
    'P-羚羊-1': [{ group: '甲', standard: '標準甲', life: '生活甲', subs: ['一', '二'] }, { group: '乙', standard: '標準乙', life: '', subs: ['三'] }],
    'P-狼-國旗-1': [{ group: '', standard: '', life: '', subs: ['四'] }]
  });
  assert.deepEqual(r.errors.map((e) => e.row), [7, 8, 9]);
});

test('多分團：有效管理員（總團視為團長、其他分團不算小狼、同一人取較高權限）', () => {
  const rows = [
    { accountId: 'U1', role: '團長', section: '' },
    { accountId: 'U2', role: '服務員', section: '童軍' },
    { accountId: 'U3', role: '總團', section: '' },
    { accountId: 'U4', role: '服務員', section: '小狼' },
    { accountId: 'U4', role: '團長', section: '小狼' }
  ];
  const cub = L.effectiveAdmins(rows, '小狼');
  assert.deepEqual(cub.map((a) => a.accountId + a.role), ['U1團長', 'U3團長', 'U4團長']);
  assert.equal(cub.find((a) => a.accountId === 'U3').scope, '總團');
  assert.deepEqual(L.effectiveAdmins(rows, '童軍').map((a) => a.accountId), ['U2', 'U3']);
  assert.equal(L.sectionOf(''), '小狼');
});

test('多分團：分團身分異動規則', () => {
  const rows = [{ accountId: 'O', role: '團長', section: '' }, { accountId: 'C', role: '總團', section: '' }, { accountId: 'X', role: '服務員', section: '童軍' }];
  const owner = { accountId: 'O', isOwner: true }, central = { accountId: 'C', isCentral: true };
  assert.equal(L.validateStaffChange(rows, { accountId: 'X' }, { type: 'add', targetId: 'X', section: '行義', role: '服務員' }, 'O').ok, false, '一般人不能設定');
  assert.equal(L.validateStaffChange(rows, central, { type: 'add', targetId: 'X', section: '行義', role: '服務員' }, 'O').ok, true);
  assert.equal(L.validateStaffChange(rows, central, { type: 'add', targetId: 'X', section: '行義', role: '團長' }, 'O').ok, false, '團長要 admin');
  assert.equal(L.validateStaffChange(rows, central, { type: 'remove', targetId: 'O', key: '小狼' }, 'O').ok, false, 'admin 不能被改');
  assert.equal(L.validateStaffChange(rows, owner, { type: 'add', targetId: 'X', section: '海軍', role: '服務員' }, 'O').ok, false, '分團不在清單');
  assert.equal(L.validateStaffChange(rows, owner, { type: 'remove', targetId: 'C', key: '總團' }, 'O').ok, true);
  const lone = [{ accountId: 'O', role: '團長', section: '小狼' }];
  assert.equal(L.validateStaffChange(lone, owner, { type: 'update', targetId: 'O', key: '小狼', section: '童軍', role: '團長' }, '').ok, false, '小狼至少一位團長');
});

test('多分團：團長可以兼任（同一人在多個分團當團長或服務員，SPEC 附錄第 71 點）', () => {
  const rows = [{ accountId: 'O', role: '團長', section: '小狼' }, { accountId: 'B', role: '團長', section: '小狼' }];
  const owner = { accountId: 'O', isOwner: true };
  assert.equal(L.validateStaffChange(rows, owner, { type: 'add', targetId: 'B', section: '童軍', role: '團長' }, 'O').ok, true);
  rows.push({ accountId: 'B', role: '團長', section: '童軍' });
  assert.equal(L.validateStaffChange(rows, owner, { type: 'add', targetId: 'B', section: '行義', role: '服務員' }, 'O').ok, true);
  assert.deepEqual(L.effectiveAdmins(rows, '童軍').map((a) => a.accountId + a.role), ['B團長']);
  assert.ok(L.effectiveAdmins(rows, '小狼').some((a) => a.accountId === 'B' && a.role === '團長'));
});
