// 後端整合測試：在模擬的 Google 環境（記憶體試算表）跑完整流程。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadGas } = require('./gas-mock.js');

const HOUR = 3600000;

/** 建好系統、團長帳號、一位測試小狼 */
function fresh(opts) {
  const env = loadGas(opts);
  const report = env.ctx.setup();
  const invite = report.firstLeaderInvite.code;
  const leader = env.api({ action: 'register', code: invite, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' });
  assert.equal(leader.ok, true, JSON.stringify(leader));
  // 階段 4A 才有新增小狼的畫面；這裡直接寫入試算表
  addCub(env, 'C1', '測試小狼甲', 'AB2CDE', 3);
  return { env, report, leaderToken: leader.token };
}
function addCub(env, id, name, code, uses, joinDate = '2025-09-01') {
  const sh = env.sheet('小狼名單');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 9).setValues([[id, name, '一小隊', joinDate, '', code, uses, '在團', '']]);
}
function consentVersion(env) { return env.api({ action: 'consentText' }).version; }
function registerParent(env, username = 'parent01', code = 'AB2CDE', childName = '測試小狼甲', extra = {}) {
  return env.api({ action: 'register', code, childName, username, password: 'parentpass1', nickname: '測試小狼甲媽媽', consentVersion: consentVersion(env), ...extra });
}

test('setup：建立所有分頁、匯入種子資料、產生第一位團長邀請碼', () => {
  const env = loadGas();
  const r = env.ctx.setup();
  const names = Object.values(env.ctx.SHEET);
  assert.equal(names.length, 19);
  for (const n of names) {
    assert.ok(env.sheet(n), '缺分頁 ' + n);
    assert.deepEqual(env.sheet(n).getRange(1, 1, 1, env.ctx.HEADERS[n].length).getValues()[0], [...env.ctx.HEADERS[n]]);
    assert.equal(env.sheet(n).frozen, 1);
    assert.equal(env.sheet(n).protections.length, 1, '標題列保護');
  }
  assert.equal(env.rows('項目總表').length, 163);
  assert.equal(env.rows('級別與章說明').length, 30);
  assert.equal(env.rows('告知同意內容').length, 1);
  assert.match(env.rows('告知同意內容')[0][1], /我們會記錄哪些資料/);
  assert.equal(env.rows('設定').length, 19);
  assert.match(r.firstLeaderInvite.code, /^[A-Z2-9]{8}$/);
  assert.ok(env.logs.some(([, m]) => String(m).includes(r.firstLeaderInvite.code)), '邀請碼印在執行紀錄');
  assert.ok(env.props.SPREADSHEET_ID && env.props.WEBHOOK_KEY);
  const lion = env.rows('級別與章說明').find((u) => u[0] === '羚羊');
  assert.match(lion[4], /^凡年滿8歲兒童/, '晉級條件為官方原文');
});

test('setup 可重複執行，已有資料一律不覆蓋、不重新匯入', () => {
  const env = loadGas();
  const first = env.ctx.setup();
  env.sheet('項目總表').getRange(2, 5, 1, 1).setValues([['團長改過的文字']]);
  env.sheet('設定').getRange(2, 2, 1, 1).setValues([['8']]);
  const second = env.ctx.setup();
  assert.equal(env.rows('項目總表').length, 163);
  assert.equal(env.rows('項目總表')[0][4], '團長改過的文字');
  assert.equal(String(env.rows('設定')[0][1]), '8');
  assert.equal(env.rows('告知同意內容').length, 1);
  assert.equal(second.firstLeaderInvite.code, first.firstLeaderInvite.code, '沿用同一組邀請碼');
  assert.equal(env.rows('管理員邀請').length, 1);
  assert.equal(env.sheet('項目總表').protections.length, 1, '不重複加保護');
});

test('setup 只在最右邊補新欄，標題不符時不動', () => {
  const env = loadGas();
  env.ctx.setup();
  env.sheet('通知紀錄').getRange(1, 4, 1, 1).setValues([['']]); // 模擬舊版少一欄
  env.sheet('失敗紀錄').getRange(1, 1, 1, 1).setValues([['被改掉']]);
  const r = env.ctx.setup();
  // 模擬環境內外的陣列分屬不同執行環境，先展開再比較
  assert.deepEqual([...r.headerFixed], ['通知紀錄']);
  assert.deepEqual([...r.headerMismatch], ['失敗紀錄']);
  assert.equal(env.sheet('失敗紀錄').getRange(1, 1).getValues()[0][0], '被改掉');
});

test('第一位團長用邀請碼註冊（小孩姓名留空），邀請碼只能用一次', () => {
  const { env, report, leaderToken } = fresh();
  const me = env.api({ action: 'me', token: leaderToken });
  assert.equal(me.role, '團長');
  assert.equal(me.cubs.length, 0);
  const again = env.api({ action: 'register', code: report.firstLeaderInvite.code, username: 'leader02', password: 'leaderpass1', nickname: 'x' });
  assert.equal(again.code, 'CODE_INVALID');
  assert.equal(env.rows('管理員邀請')[0][6], '已使用');
  assert.equal(env.ctx.setup().firstLeaderInvite, null, '已有管理員就不再產生');
});

test('家長註冊：綁定碼＋小孩姓名都對、同意後才建立帳號', () => {
  const { env } = fresh();
  const before = env.rows('帳號').length;
  const wrongName = env.api({ action: 'checkCode', code: 'AB2CDE', childName: '測試小狼乙' });
  const wrongCode = env.api({ action: 'checkCode', code: 'ZZZZZZ', childName: '測試小狼甲' });
  assert.equal(wrongName.code, 'CODE_INVALID');
  assert.equal(wrongName.message, wrongCode.message, '錯誤訊息不透露原因');
  const ok = env.api({ action: 'checkCode', code: ' ab2cde ', childName: '測試小狼甲' });
  assert.equal(ok.kind, 'parent');
  assert.match(ok.consent.content, /誰看得到/);
  const noConsent = registerParent(env, 'parent01', 'AB2CDE', '測試小狼甲', { consentVersion: 0 });
  assert.equal(noConsent.code, 'NEED_CONSENT');
  assert.equal(env.rows('帳號').length, before, '不同意就不留任何紀錄');
  assert.equal(env.rows('綁定紀錄').length, 0);
  const r = registerParent(env);
  assert.equal(r.ok, true);
  assert.equal(env.rows('綁定紀錄').length, 1);
  assert.equal(env.rows('綁定紀錄')[0][4], 1, '同意版本');
  assert.equal(env.rows('小狼名單')[0][6], 2, '綁定碼次數 −1');
  const me = env.api({ action: 'me', token: r.token });
  assert.equal(me.role, null);
  assert.deepEqual(me.cubs.map((c) => c.name), ['測試小狼甲']);
});

test('帳號名稱不分大小寫不可重複；格式錯誤擋下', () => {
  const { env } = fresh();
  registerParent(env, 'parent01');
  assert.equal(registerParent(env, 'PARENT01').code, 'NAME_TAKEN');
  assert.equal(registerParent(env, 'ab').code, 'BAD_INPUT');
  assert.equal(registerParent(env, 'parent02', 'AB2CDE', '測試小狼甲', { password: '123' }).code, 'BAD_INPUT');
  assert.equal(registerParent(env, 'parent02', 'AB2CDE', '測試小狼甲', { nickname: '' }).code, 'BAD_INPUT');
});

test('綁定碼次數用完、離團後失效', () => {
  const { env } = fresh();
  addCub(env, 'C2', '測試小狼乙', 'FG3HJK', 1);
  assert.equal(registerParent(env, 'parent01', 'FG3HJK', '測試小狼乙').ok, true);
  assert.equal(registerParent(env, 'parent02', 'FG3HJK', '測試小狼乙').code, 'CODE_INVALID');
  env.sheet('小狼名單').getRange(2, 8, 1, 1).setValues([['離團']]);
  assert.equal(registerParent(env, 'parent03').code, 'CODE_INVALID');
});

test('登入：錯誤訊息一致、連續錯誤鎖定、不勾記住我 12 小時後過期', () => {
  const { env } = fresh();
  registerParent(env);
  const bad1 = env.api({ action: 'login', username: 'parent01', password: 'wrongpass1' });
  const bad2 = env.api({ action: 'login', username: 'nobody99', password: 'wrongpass1' });
  assert.equal(bad1.code, 'BAD_LOGIN');
  assert.equal(bad1.message, bad2.message);
  const ok = env.api({ action: 'login', username: 'PARENT01', password: 'parentpass1' });
  assert.equal(ok.ok, true, '帳號不分大小寫');
  env.advance(11 * HOUR);
  assert.equal(env.api({ action: 'me', token: ok.token }).ok, true);
  env.advance(2 * HOUR);
  assert.equal(env.api({ action: 'me', token: ok.token }).code, 'SESSION_EXPIRED');
  const rem = env.api({ action: 'login', username: 'parent01', password: 'parentpass1', remember: true });
  env.advance(29 * 24 * HOUR);
  assert.equal(env.api({ action: 'me', token: rem.token }).ok, true, '記住我 30 天');
  for (let i = 0; i < 4; i++) env.api({ action: 'login', username: 'parent01', password: 'x' });
  assert.equal(env.api({ action: 'login', username: 'parent01', password: 'x' }).code, 'BAD_LOGIN');
  assert.equal(env.api({ action: 'login', username: 'parent01', password: 'parentpass1' }).code, 'LOCKED', '第 6 次即使密碼正確也鎖定');
  env.advance(61 * 60000);
  assert.equal(env.api({ action: 'login', username: 'parent01', password: 'parentpass1' }).ok, true, '鎖定時間過後可登入');
});

test('未登入輸入綁定碼錯誤達全站上限即暫停', () => {
  const { env } = fresh();
  for (let i = 0; i < 20; i++) env.api({ action: 'checkCode', code: 'WRONG' + i, childName: 'x' });
  assert.equal(env.api({ action: 'checkCode', code: 'AB2CDE', childName: '測試小狼甲' }).code, 'LOCKED');
});

test('密碼與登入憑證不以明碼存在試算表', () => {
  const { env } = fresh();
  const r = registerParent(env);
  const all = [...env.ss.sheets.values()].flatMap((s) => s.data.flat()).map(String).join('|');
  assert.ok(!all.includes('parentpass1'));
  assert.ok(!all.includes(r.token));
  assert.ok(env.rows('帳號')[1][3].startsWith('2000$'), '雜湊 2000 次');
});

test('查詢：只能看自己綁定的小狼；回傳欄位採白名單', () => {
  const { env, leaderToken } = fresh();
  addCub(env, 'C2', '測試小狼乙', 'FG3HJK', 3);
  const { token } = registerParent(env);
  const other = env.api({ action: 'cubDetail', token, cubId: 'C2' });
  const none = env.api({ action: 'cubDetail', token, cubId: 'C999' });
  assert.equal(other.code, 'NOT_FOUND');
  assert.equal(other.message, none.message, '不透露小狼是否存在');
  assert.equal(env.api({ action: 'cubDetail', token: leaderToken, cubId: 'C1' }).code, 'NOT_FOUND', '管理員的家長畫面也只看自己綁定的');
  const d = env.api({ action: 'cubDetail', token, cubId: 'C1' });
  assert.equal(d.ok, true);
  assert.deepEqual(Object.keys(d.cub).sort(), ['cubId', 'currentLevel', 'joinDate', 'name', 'squad', 'tenure']);
  assert.equal(d.cub.joinDate, '2025-09-01');
  assert.equal(d.cub.tenure, '1 年 2 個月');
  assert.equal(d.nextChallenge.type, 'start');
  assert.equal(d.nextChallenge.items.length, 3);
  assert.deepEqual(Object.keys(d.nextChallenge.items[0]).sort(), ['section', 'text']);
  const json = JSON.stringify(d);
  assert.ok(!/eligible|U[A-Z2-9]{8}|passwordHash|salt/.test(json), '不含達標判定與帳號ID 等內部欄位');
  assert.equal(d.units.filter((u) => u.category === '進程').length, 4);
  assert.equal(d.units.filter((u) => u.category === '技能章').length, 26);
  assert.equal(d.units.find((u) => u.unit === '羚羊').status, '進行中');
});

test('查詢：簽核人顯示管理員姓名；已完成待頒發用固定文字；出席滿 4 次自動完成', () => {
  const { env } = fresh();
  const { token } = registerParent(env);
  const leaderId = env.rows('管理員')[0][0];
  const items = env.rows('項目總表').filter((r) => r[2] === '環保');
  const comp = env.sheet('完成紀錄');
  comp.getRange(2, 1, items.length, 7).setValues(items.map((it) => ['C1', it[0], '2026-10-01', leaderId, '', '', '']));
  const meet = env.sheet('集會行事曆');
  const dates = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03', '2026-12-05'];
  meet.getRange(2, 1, dates.length, 7).setValues(dates.map((d, i) => ['M' + i, d, d.slice(5) + ' 團集會', '', '是', leaderId, '']));
  const att = env.sheet('出席紀錄');
  att.getRange(2, 1, 5, 5).setValues([['M0', 'C1', '出席', leaderId, ''], ['M1', 'C1', '請假', leaderId, ''], ['M2', 'C1', '出席', leaderId, ''], ['M3', 'C1', '出席', leaderId, ''], ['M4', 'C1', '出席', leaderId, '']]);
  env.sheet('年度出席設定').getRange(2, 1, 1, 5).setValues([['115學年度', '2026-08-01', '2027-07-31', 4, '']]);
  env.sheet('額外出席').getRange(2, 1, 1, 6).setValues([['115學年度', 'C1', 1, '', leaderId, '']]);
  const d = env.api({ action: 'cubDetail', token, cubId: 'C1' });
  const eco = d.units.find((u) => u.unit === '環保');
  assert.equal(eco.status, '已完成待頒發');
  assert.equal(eco.statusText, '項目已全部完成，等待團長評核頒發');
  assert.equal(eco.items[0].signer, '團長');
  const auto = d.units.find((u) => u.unit === '羚羊').items[6];
  assert.equal(auto.done, true);
  assert.equal(auto.date, '2026-10-03', '第 4 次出席（請假不算）');
  assert.equal(auto.signer, '出席自動計算');
  assert.equal(d.attendance.meetings.length, 5, '未來的集會不列入');
  assert.equal(d.attendance.meetings[0].date, '2026-10-03', '新到舊');
  assert.deepEqual(d.attendance.upcoming.map((m) => m.date), ['2026-12-05']);
  assert.deepEqual(d.attendance.counts, { attended: 4, leave: 1 });
  assert.equal(d.attendance.rate.text, '100%', '(4+1)/4 最多 100%');
  assert.equal(d.attendance.rate.period, '115學年度');
});

test('告知內容改版後需重新同意', () => {
  const { env } = fresh();
  const { token } = registerParent(env);
  env.sheet('告知同意內容').getRange(3, 1, 1, 3).setValues([[2, '第二版內容', '2026-11-14']]);
  assert.equal(env.api({ action: 'me', token }).needsConsent, true);
  assert.equal(env.api({ action: 'cubDetail', token, cubId: 'C1' }).code, 'NEED_CONSENT');
  assert.equal(env.api({ action: 'reconsent', token, consentVersion: 1 }).code, 'NEED_CONSENT', '必須同意最新版');
  assert.equal(env.api({ action: 'reconsent', token, consentVersion: 2 }).ok, true);
  assert.equal(env.api({ action: 'cubDetail', token, cubId: 'C1' }).ok, true);
});

test('已登入新增第二個孩子、解除綁定只影響自己', () => {
  const { env } = fresh();
  addCub(env, 'C2', '測試小狼乙', 'FG3HJK', 3);
  const p1 = registerParent(env, 'parent01');
  const p2 = registerParent(env, 'parent02');
  const v = consentVersion(env);
  assert.equal(env.api({ action: 'bind', token: p1.token, code: 'FG3HJK', childName: '測試小狼乙', consentVersion: v }).ok, true);
  assert.equal(env.api({ action: 'me', token: p1.token }).cubs.length, 2);
  assert.equal(env.api({ action: 'unbind', token: p1.token, cubId: 'C1' }).ok, true);
  assert.equal(env.api({ action: 'me', token: p1.token }).cubs.length, 1);
  assert.equal(env.api({ action: 'me', token: p2.token }).cubs.length, 1, '另一位家長不受影響');
  assert.equal(env.rows('小狼名單').length, 2, '小狼資料不受影響');
});

test('修改密碼、臨時碼重設密碼（用過即失效）', () => {
  const { env } = fresh();
  const p = registerParent(env);
  assert.equal(env.api({ action: 'changePassword', token: p.token, oldPassword: 'wrong', newPassword: 'newpass12' }).code, 'BAD_INPUT');
  assert.equal(env.api({ action: 'changePassword', token: p.token, oldPassword: 'parentpass1', newPassword: 'newpass12' }).ok, true);
  assert.equal(env.api({ action: 'me', token: p.token }).ok, true, '目前裝置保持登入');
  assert.equal(env.api({ action: 'login', username: 'parent01', password: 'newpass12' }).ok, true);
  // 階段 4A 才有後台產生臨時碼；這裡直接寫入
  const temp = 'TMPC0DE2'.replace('0', 'Q');
  const accRow = env.rows('帳號').findIndex((r) => r[1] === 'parent01') + 2;
  env.sheet('帳號').getRange(accRow, 9, 1, 2).setValues([[crypto.createHash('sha256').update(temp).digest('hex'), new Date(Date.now() + 1e12)]]);
  assert.equal(env.api({ action: 'resetPassword', username: 'parent01', tempCode: 'WRONG123', newPassword: 'reset1234' }).code, 'BAD_LOGIN');
  assert.equal(env.api({ action: 'resetPassword', username: 'parent01', tempCode: temp.toLowerCase(), newPassword: 'reset1234' }).ok, true);
  assert.equal(env.api({ action: 'me', token: p.token }).code, 'SESSION_EXPIRED', '重設後所有裝置登出');
  assert.equal(env.api({ action: 'resetPassword', username: 'parent01', tempCode: temp, newPassword: 'again1234' }).code, 'BAD_LOGIN', '臨時碼只能用一次');
  assert.equal(env.api({ action: 'login', username: 'parent01', password: 'reset1234' }).ok, true);
});

test('登出後憑證失效；未知操作與壞掉的請求不洩漏細節', () => {
  const { env } = fresh();
  const p = registerParent(env);
  assert.equal(env.api({ action: 'logout', token: p.token }).ok, true);
  assert.equal(env.api({ action: 'me', token: p.token }).code, 'SESSION_EXPIRED');
  assert.equal(env.api({ action: 'dropTables' }).code, 'BAD_INPUT');
  const raw = JSON.parse(env.ctx.doPost({ parameter: {}, postData: { contents: '{壞掉' } }).t);
  assert.equal(raw.code, 'SERVER_ERROR');
  assert.ok(!/at |Error|\.js/.test(raw.message));
});

test('webhook：密鑰不符或格式錯誤都安全忽略', () => {
  const { env } = fresh();
  const call = (key, body) => env.ctx.doPost({ parameter: { key }, postData: { contents: body } }).t;
  assert.equal(call('wrong', '{"events":[]}'), 'OK');
  assert.equal(call(env.props.WEBHOOK_KEY, '壞掉'), 'OK');
  assert.equal(call(env.props.WEBHOOK_KEY, '{"events":[{"type":"message"}]}'), 'OK');
});

test('合併檔 dist/Code.gs 可獨立運作', () => {
  const env = loadGas({ bundle: true });
  env.ctx.setup();
  assert.equal(env.api({ action: 'ping' }).ok, true);
  assert.equal(env.rows('項目總表').length, 163);
});
