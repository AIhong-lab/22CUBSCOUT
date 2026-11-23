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
  const report = env.ctx.setupCore_();
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
  const r = env.ctx.setupCore_();
  const names = Object.values(env.ctx.SHEET);
  assert.equal(names.length, 29);
  // 只顯示團長要編輯的 5 個分頁，排最前面；其他系統分頁隱藏
  const shown = env.ctx.ss_().getSheets().filter((x) => !x.isSheetHidden()).map((x) => x.getName());
  assert.deepEqual(shown, ['項目總表', '進程細項', '級別與章說明', '設定', '告知同意內容']);
  assert.equal(r.hidden, 24);
  for (const n of names) {
    assert.ok(env.sheet(n), '缺分頁 ' + n);
    assert.deepEqual(env.sheet(n).getRange(1, 1, 1, env.ctx.HEADERS[n].length).getValues()[0], [...env.ctx.HEADERS[n]]);
    assert.equal(env.sheet(n).frozen, 1);
    assert.equal(env.sheet(n).protections.length, 1, '標題列保護');
  }
  assert.equal(env.rows('項目總表').length, 168, '官方 163 項＋剛入團 5 項');
  assert.equal(env.rows('級別與章說明').length, 31);
  assert.deepEqual(env.rows('項目總表').filter((x) => x[2] === '剛入團').map((x) => x[0]), ['P-剛入團-1', 'P-剛入團-2', 'P-剛入團-3', 'P-剛入團-4', 'P-剛入團-5']);
  assert.equal(env.rows('進程細項').length, 375, '團自訂細項只匯入一次');
  assert.equal(env.rows('告知同意內容').length, 1);
  assert.match(env.rows('告知同意內容')[0][1], /我們會記錄哪些資料/);
  assert.equal(env.rows('設定').length, 24);
  assert.match(r.firstLeaderInvite.code, /^[A-Z2-9]{8}$/);
  assert.ok(env.logs.some(([, m]) => String(m).includes(r.firstLeaderInvite.code)), '邀請碼印在執行紀錄');
  assert.ok(env.props.SPREADSHEET_ID && env.props.WEBHOOK_KEY);
  const lion = env.rows('級別與章說明').find((u) => u[0] === '羚羊');
  assert.match(lion[4], /^凡年滿8歲兒童/, '晉級條件為官方原文');
});

test('setup 可重複執行，已有資料一律不覆蓋、不重新匯入', () => {
  const env = loadGas();
  const first = env.ctx.setupCore_();
  env.sheet('項目總表').getRange(2, 5, 1, 1).setValues([['團長改過的文字']]);
  env.sheet('設定').getRange(2, 2, 1, 1).setValues([['8']]);
  const second = env.ctx.setupCore_();
  assert.equal(env.rows('項目總表').length, 168);
  assert.equal(env.rows('項目總表')[0][4], '團長改過的文字');
  assert.equal(String(env.rows('設定')[0][1]), '8');
  assert.equal(env.rows('告知同意內容').length, 1);
  assert.equal(second.firstLeaderInvite.code, first.firstLeaderInvite.code, '沿用同一組邀請碼');
  assert.equal(env.rows('管理員邀請').length, 1);
  assert.equal(env.sheet('項目總表').protections.length, 1, '不重複加保護');
});

test('setup 只在最右邊補新欄，標題不符時不動', () => {
  const env = loadGas();
  env.ctx.setupCore_();
  env.sheet('通知紀錄').getRange(1, 4, 1, 1).setValues([['']]); // 模擬舊版少一欄
  env.sheet('失敗紀錄').getRange(1, 1, 1, 1).setValues([['被改掉']]);
  const r = env.ctx.setupCore_();
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
  assert.equal(env.ctx.setupCore_().firstLeaderInvite, null, '已有管理員就不再產生');
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
  assert.deepEqual(Object.keys(d.cub).sort(), ['cubId', 'currentLevel', 'joinDate', 'name', 'role', 'section', 'squad', 'squadStaff', 'status', 'tenure', 'trialStart']);
  assert.equal(d.cub.joinDate, '2025-09-01');
  assert.equal(d.cub.tenure, '1 年 2 個月');
  assert.equal(d.nextChallenge.type, 'start');
  assert.equal(d.nextChallenge.items.length, 3);
  assert.deepEqual(Object.keys(d.nextChallenge.items[0]).sort(), ['section', 'text']);
  const json = JSON.stringify(d);
  assert.ok(!/eligible|U[A-Z2-9]{8}|passwordHash|salt/.test(json), '不含達標判定與帳號ID 等內部欄位');
  assert.equal(d.units.filter((u) => u.category === '進程').length, 5);
  assert.equal(d.units.filter((u) => u.category === '技能章').length, 26);
  assert.equal(d.units.find((u) => u.unit === '剛入團').status, '進行中', '新入團先挑戰剛入團');
  assert.equal(d.units.find((u) => u.unit === '羚羊').status, '未開始');
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
  env.sheet('頒章紀錄').getRange(2, 1, 1, 7).setValues([['C1', '剛入團', '2026-09-01', '', '', leaderId, '']]); // 羚羊第 7 項從剛入團頒發後算（附錄第 64 點）
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
  assert.deepEqual(d.attendance.counts, { attended: 4, leave: 1, late: 0 });
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
  env.ctx.setupCore_();
  assert.equal(env.api({ action: 'ping' }).ok, true);
  assert.equal(env.rows('項目總表').length, 168);
});

test('試算表選單：只有分頁顯示切換，沒有邀請碼（SPEC 附錄第 33 點）', () => {
  const { env } = fresh();
  env.ctx.onOpen();
  assert.equal(env.ui.menus[0].title, '🐺 幼童軍系統');
  assert.ok(env.ui.menus[0].items.every(([, fn]) => typeof env.ctx[fn] === 'function' && !fn.endsWith('_')), '選單函式存在且非私有');
  assert.deepEqual(env.ui.menus[0].items.map(([t]) => t), ['🔑 團長預設帳號（admin）', '把帳號設為團長', '📱 安裝 LINE 圖文選單', '顯示全部分頁（查紀錄用）', '只顯示需要編輯的分頁']);
  assert.equal(typeof env.ctx.menuInviteAssistant, 'undefined');
});

test('第一位團長邀請碼過期後不能使用', () => {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  env.advance(73 * 3600000);
  assert.equal(env.api({ action: 'checkCode', code: r.firstLeaderInvite.code, childName: '' }).code, 'CODE_INVALID');
});

test('randInt_ 支援大範圍且結果均在範圍內（修正：曾因只取 16 位元在 n > 65536 時無窮迴圈）', () => {
  const env = loadGas();
  for (const n of [1, 31, 65536, 900000, 2 ** 32]) {
    for (let i = 0; i < 50; i++) { const x = env.ctx.randInt_(n); assert.ok(x >= 0 && x < n && Number.isInteger(x)); }
  }
  assert.throws(() => env.ctx.randInt_(0));
});

test('公開標準查詢：不用登入、只有項目與說明、停用項目不顯示、不含任何個人資料', () => {
  const { env } = fresh();
  registerParent(env);
  const r = env.api({ action: 'catalog' });
  assert.equal(r.ok, true);
  assert.equal(r.units.filter((u) => u.category === '進程').length, 5);
  assert.equal(r.units.filter((u) => u.category === '技能章').length, 26);
  assert.equal(r.units.reduce((s, u) => s + u.items.length, 0), 168);
  assert.equal(r.units[0].unit, '剛入團', '依排序：剛入團在羚羊前面');
  assert.equal(r.units[1].unit, '羚羊');
  assert.match(r.units.find((u) => u.unit === '狼').rule, /參與羚羊級/);
  assert.equal(r.units.find((u) => u.unit === '嚮導').group, '服務類');
  const json = JSON.stringify(r);
  assert.ok(!/測試小狼|parent01|leader01|U[A-Z2-9]{8}|AB2CDE/.test(json), '不含小狼、帳號、綁定碼');
  assert.deepEqual(Object.keys(r.units[0].items[0]).sort(), ['details', 'section', 'text'], '項目只回傳大項、內容與細項，不含項目ID');
  // 停用項目不顯示（快取 5 分鐘後生效）
  const row = env.rows('項目總表').findIndex((x) => x[2] === '嚮導') + 2;
  env.sheet('項目總表').getRange(row, 7).setValues([['否']]);
  assert.equal(env.api({ action: 'catalog' }).units.find((u) => u.unit === '嚮導').items.length, 2, '快取期間內不變');
  env.advance(301000);
  assert.equal(env.api({ action: 'catalog' }).units.find((u) => u.unit === '嚮導').items.length, 1);
});

test('進程細項：公開查詢、家長畫面、後台小狼頁都帶細項；停用與錯誤列不顯示；技能章沒有細項', () => {
  const { env, leaderToken } = fresh();
  const reg = registerParent(env);
  const r = env.api({ action: 'catalog' });
  const lion = r.units.find((u) => u.unit === '羚羊');
  const vow = r.units.find((u) => u.unit === '剛入團').items[0];
  assert.equal(vow.text, '背誦與了解諾言規律');
  assert.equal(lion.items[0].details.length, 0, '剛入團的細項已從羚羊移出');
  assert.equal(vow.details.length, 1);
  assert.deepEqual(Object.keys(vow.details[0]).sort(), ['group', 'life', 'standard', 'subs']);
  assert.equal(vow.details[0].group, '背誦與了解諾言規律');
  assert.equal(vow.details[0].subs.length, 4);
  assert.equal(vow.details[0].standard, '不看稿背誦＋口述舉例');
  assert.equal(lion.items[6].details.length, 0, '參加團集會 4 次（出席自動完成）沒有細項');
  assert.equal(lion.items[7].details.length, 3, '叢林奇談掛 3 組');
  assert.ok(r.units.filter((u) => u.category === '技能章').every((u) => u.items.every((i) => i.details.length === 0)));
  assert.equal(r.units.reduce((s, u) => s + u.items.reduce((t, i) => t + i.details.reduce((x, g) => x + g.subs.length, 0), 0), 0), 375);

  const view = env.api({ action: 'cubDetail', token: reg.token, cubId: 'C1' });
  assert.equal(view.ok, true, JSON.stringify(view));
  assert.equal(view.units.find((u) => u.unit === '剛入團').items[0].details[0].subs[0], '能完整背出諾言');
  const adm = env.api({ action: 'cubAdminDetail', token: leaderToken, cubId: 'C1' });
  assert.equal(adm.units.find((u) => u.unit === '剛入團').items[0].details[0].group, '背誦與了解諾言規律');

  // 團長在試算表停用一條、寫錯一個項目ID：停用的不顯示，錯誤列略過
  const sh = env.sheet('進程細項');
  sh.getRange(2, 7).setValues([['否']]);
  sh.getRange(3, 1).setValues([['P-不存在-1']]);
  env.advance(301000);
  const after = env.api({ action: 'catalog' }).units.find((u) => u.unit === '剛入團').items[0].details[0];
  assert.equal(after.subs.length, 2);
  assert.equal(after.standard, '', '通過標準寫在被停用的第一列時，這組就不顯示通過標準');
});

test('進程細項：舊系統還沒重跑 setup（沒有細項分頁）時照常運作', () => {
  const { env } = fresh();
  env.ctx.ss_().deleteSheet(env.sheet('進程細項'));
  env.ctx.DB_CACHE_ = {};
  const r = env.api({ action: 'catalog' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.units[0].items[0].details.length, 0);
});

test('跨級簽核：還在羚羊級的小狼可以先簽豹級的項目（依團集會實際完成的內容給）', () => {
  const { env, leaderToken } = fresh();
  const reg = registerParent(env);
  const r = env.api({ action: 'signoff', token: leaderToken, cubIds: ['C1'], itemIds: ['P-豹-勞作-1'], date: '2026-11-01' });
  assert.equal(r.added, 1, JSON.stringify(r));
  const adm = env.api({ action: 'cubAdminDetail', token: leaderToken, cubId: 'C1' });
  const leopard = adm.units.find((u) => u.unit === '豹');
  assert.equal(leopard.done, 1);
  assert.equal(leopard.status, '進行中');
  assert.equal(leopard.items.find((i) => i.text.includes('鐵鎚')).done, true);
  const view = env.api({ action: 'cubDetail', token: reg.token, cubId: 'C1' });
  assert.equal(view.units.find((u) => u.unit === '豹').items.find((i) => i.text.includes('鐵鎚')).date, '2026-11-01', '家長看得到');
  assert.equal(view.cub.currentLevel, '', '目前級別不受影響');
});

test('分頁顯示切換：顯示全部再收起，只動顯示狀態不動資料；不屬於系統的分頁不處理', () => {
  const { env } = fresh();
  const before = JSON.stringify(env.rows('帳號'));
  env.ctx.ss_().insertSheet('團長自己的筆記');
  env.ctx.organizeSheets_(false);
  assert.equal(env.ctx.ss_().getSheets().filter((x) => x.isSheetHidden()).length, 0);
  assert.equal(env.ctx.organizeSheets_(true), 24);
  assert.equal(env.sheet('團長自己的筆記').isSheetHidden(), false);
  assert.equal(JSON.stringify(env.rows('帳號')), before);
  // 隱藏中的分頁照常讀寫（系統功能不受影響）
  addCub(env, 'C2', '測試小狼乙', 'XY3ZWV', 3);
  assert.equal(env.rows('小狼名單').length, 2);
  assert.equal(env.ctx.setupCore_().hidden, 0, '重跑 setup 不重複處理');
});

test('試算表選單「把帳號設為團長」：自己註冊的帳號直接變團長（最高權限）', () => {
  const { env } = fresh();
  const reg = env.api({ action: 'register', identity: '服務員', username: 'boss_hong', password: 'bosspass12', nickname: '洪團長' });
  assert.equal(env.api({ action: 'me', token: reg.token }).role, null);
  env.ui.answers.push(null);
  env.ctx.menuSetLeader();
  assert.equal(env.ui.alerts.length, 0, '取消不做事');
  env.ui.answers.push('nobody99');
  env.ctx.menuSetLeader();
  assert.match(env.ui.alerts.at(-1), /找不到帳號/);
  env.ui.answers.push('BOSS_HONG');
  env.ctx.menuSetLeader();
  assert.match(env.ui.alerts.at(-1), /已把「boss_hong」設為團長/);
  const me = env.api({ action: 'me', token: reg.token });
  assert.deepEqual([me.role, me.adminName], ['團長', '洪團長']);
  assert.equal(env.api({ action: 'requestList', token: reg.token }).items.length, 0, '自己的服務員申請已結案');
  env.ui.answers.push('boss_hong');
  env.ctx.menuSetLeader();
  assert.match(env.ui.alerts.at(-1), /已經是團長/);
  assert.ok(env.rows('操作日誌').some((r) => r[2] === '設為團長'));
});

test('剛入團：已上線的系統重跑 setup 會補上剛入團，並把細項從羚羊改掛過來；只做一次', () => {
  const env = loadGas();
  env.ctx.setupCore_();
  // 模擬舊版：刪掉剛入團的項目與說明，把細項改回掛在羚羊（舊的對照）
  const items = env.sheet('項目總表');
  const keep = env.rows('項目總表').filter((x) => x[2] !== '剛入團');
  items.data.splice(1); keep.forEach((r) => items.data.push([...r]));
  const units = env.sheet('級別與章說明');
  const keepU = env.rows('級別與章說明').filter((x) => x[0] !== '剛入團');
  units.data.splice(1); keepU.forEach((r) => units.data.push([...r]));
  const det = env.sheet('進程細項');
  const old = { 1: 'P-羚羊-1', 2: 'P-羚羊-5', 3: 'P-羚羊-6', 4: 'P-羚羊-3', 5: 'P-羚羊-3' };
  det.data.forEach((r, i) => { if (i > 0 && /^P-剛入團-/.test(r[0])) r[0] = old[r[0].split('-')[2]]; });
  env.ctx.DB_CACHE_ = {};
  const r = env.ctx.setupCore_();
  assert.ok(r.seeded.some((x) => /新增剛入團 5 項/.test(x)));
  assert.ok(r.seeded.some((x) => /20 條改掛到剛入團/.test(x)));
  assert.equal(env.rows('進程細項').filter((x) => x[0].startsWith('P-剛入團-')).length, 20);
  assert.equal(env.rows('項目總表').filter((x) => x[2] === '剛入團').length, 5);
  assert.ok(env.rows('級別與章說明').some((x) => x[0] === '剛入團'));
  const again = env.ctx.setupCore_();
  assert.ok(!again.seeded.some((x) => /剛入團/.test(x)), '已補過就不再執行');
});

test('自動備份免設定：setup 建立備份資料夾並開啟每週備份；重跑不重複建立', () => {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  assert.ok(env.props.BACKUP_FOLDER_ID, '已設定資料夾 ID');
  assert.ok(r.seeded.some((x) => /建立備份資料夾/.test(x)));
  assert.ok(r.seeded.some((x) => /每週日 03:00 自動備份/.test(x)));
  const id = env.props.BACKUP_FOLDER_ID;
  const again = env.ctx.setupCore_();
  assert.equal(env.props.BACKUP_FOLDER_ID, id, '不重建');
  assert.ok(!again.seeded.some((x) => /備份/.test(x)));
  assert.equal(env.ctx.runBackup_().ok, true, '可以直接備份');
});

test('團長預設帳號：選單一按就建立 admin（團長），密碼隨機只顯示在視窗；再按一次重設密碼', () => {
  const { env } = fresh();
  env.ctx.menuDefaultAdmin();
  const msg1 = env.ui.alerts.at(-1);
  const pw1 = /密碼：(\S+)/.exec(msg1)[1];
  assert.match(msg1, /帳號：admin/);
  assert.match(msg1, /已建立團長帳號/);
  assert.ok(!JSON.stringify(env.rows('帳號')).includes(pw1), '試算表只存雜湊');
  assert.ok(!JSON.stringify(env.rows('操作日誌')).includes(pw1), '日誌不記密碼');
  const login = env.api({ action: 'login', username: 'admin', password: pw1 });
  assert.equal(login.ok, true, JSON.stringify(login));
  const me = env.api({ action: 'me', token: login.token });
  assert.equal(me.role, '團長');
  assert.equal(env.api({ action: 'itemsTree', token: login.token }).ok, true, '最高權限：可用團長專屬功能');
  env.ctx.menuDefaultAdmin();
  const pw2 = /密碼：(\S+)/.exec(env.ui.alerts.at(-1))[1];
  assert.notEqual(pw1, pw2);
  assert.match(env.ui.alerts.at(-1), /已重設/);
  assert.equal(env.api({ action: 'me', token: login.token }).code, 'SESSION_EXPIRED', '重設後舊的登入失效');
  assert.equal(env.api({ action: 'login', username: 'admin', password: pw1 }).code, 'BAD_LOGIN');
  assert.equal(env.api({ action: 'login', username: 'admin', password: pw2 }).ok, true);
  assert.equal(env.rows('帳號').filter((r) => r[1] === 'admin').length, 1, '不重複建立');
});

test('網頁由 GAS 提供（附錄第 56 點）：doGet 回傳頁面；訪客能呼叫的公開函式不洩漏資料、不能濫用', () => {
  const env = loadGas();
  // 還沒放 Index 檔時，doGet 維持原本的文字訊息
  assert.match(env.ctx.doGet({ parameter: {} }).t, /後端運作中/);
  env.html.Index = '<!doctype html><title>x</title>';
  const out = env.ctx.doGet({ parameter: {} });
  assert.equal(out.kind, 'html');
  assert.equal(out.title, '22團');
  assert.match(out.meta.viewport, /width=device-width/);
  // 頁面用 google.script.run 呼叫 apiFromPage：和 doPost 同一套處理，回傳 JSON 字串
  assert.equal(JSON.parse(env.ctx.apiFromPage(JSON.stringify({ action: 'ping' }))).ok, true);
  assert.equal(JSON.parse(env.ctx.apiFromPage('不是 JSON')).ok, false);
  assert.equal(JSON.parse(env.ctx.apiFromPage(JSON.stringify({ action: 'adminList' }))).ok, false, '一樣要登入與權限');
  // setup 的回傳值不能帶第一位團長邀請碼（網頁訪客呼叫得到公開函式）
  assert.equal(env.ctx.setup(), undefined);
  assert.ok(env.ctx.setupCore_().firstLeaderInvite.code, '內部函式才拿得到');
  // 排程用的公開函式：短時間內重複呼叫會被略過，也不回傳內容
  const copies = () => env.drive.files.length;
  assert.equal(env.ctx.weeklyBackup(), undefined);
  const n = copies();
  assert.ok(n >= 1);
  env.ctx.weeklyBackup(); env.ctx.weeklyBackup();
  assert.equal(copies(), n, '一小時內重複呼叫不會一直產生備份');
  env.advance(61 * 60000);
  env.ctx.weeklyBackup();
  assert.equal(copies(), n + 1);
  assert.equal(env.ctx.dailyJob(), undefined);
  // 選單函式在網頁情境（沒有試算表畫面）一律不動作
  env.ui.unavailable = true;
  const hiddenBefore = env.ss.getSheets().filter((s) => s.isSheetHidden()).length;
  assert.throws(() => env.ctx.menuShowAllSheets());
  assert.equal(env.ss.getSheets().filter((s) => s.isSheetHidden()).length, hiddenBefore, '沒有被打開');
  assert.throws(() => env.ctx.menuDefaultAdmin());
  assert.ok(!env.rows('帳號').some((r) => r[1] === 'admin'), '沒有建立或重設 admin');
});

test('鎖在 GAS 與加快載入（附錄第 57 點）：關閉外部連線、網頁內嵌首頁資料、公開資料快取', () => {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' }).token;
  const page = (body) => JSON.parse(env.ctx.apiFromPage(JSON.stringify(body)));
  // 預設允許外部連線；關掉後 doPost 的 API 一律拒絕，GAS 網頁（apiFromPage）照常
  assert.equal(env.api({ action: 'ping' }).ok, true);
  assert.equal(page({ action: 'settingsSave', token: L, changes: { '允許外部網頁連線': '否' } }).ok, true);
  const blocked = env.api({ action: 'ping' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'MOVED');
  assert.match(blocked.message, /已經停用/);
  assert.equal(env.api({ action: 'login', username: 'leader01', password: 'leaderpass1' }).ok, false, '登入也不行');
  assert.equal(page({ action: 'ping' }).ok, true);
  assert.equal(page({ action: 'adminHome', token: L }).ok, true);
  // LINE webhook 不受影響（走 key 參數）
  assert.equal(env.ctx.doPost({ parameter: { key: 'x' }, postData: { contents: '{}' } }).t, 'OK');
  // doGet 把首頁要用的公開資料直接放進網頁，開頁不用再多打幾次後端
  env.html.Index = '<!doctype html><html><head><script id="boot"></script></head><body>$& $1</body></html>';
  page({ action: 'noticeSave', token: L, title: '測試公告</script><b>', content: '內容' });
  const out = env.ctx.doGet({ parameter: {} });
  const m = /<script>window\.__BOOT=(.*?);<\/script>/.exec(out.content);
  assert.ok(m, '有內嵌資料');
  assert.ok(!/測試公告<\/script>/.test(out.content), '資料裡的 </script> 有跳脫，不會打斷網頁');
  assert.ok(out.content.includes('<body>$& $1</body>'), '原本的內容不被取代字串影響');
  const boot = JSON.parse(m[1]);
  assert.deepEqual(Object.keys(boot).sort(), ['catalog', 'images', 'notices', 'publicTabs', 'site', 'webUrl']);
  assert.equal(boot.notices[0].title, '測試公告</script><b>');
  assert.ok(boot.catalog.units.length > 20);
  assert.ok(Array.isArray(boot.site.meetings));
  // 公開資料有快取：重複讀取不再讀試算表；後台一改就清掉
  page({ action: 'notices' });
  const reads = () => env.sheet('公告').reads;
  const before = reads();
  page({ action: 'notices' }); page({ action: 'notices' });
  assert.equal(reads(), before, '快取期間不重讀');
  page({ action: 'noticeSave', token: L, title: '第二則', content: '' });
  assert.equal(page({ action: 'notices' }).notices.length, 2, '後台發布後馬上看得到');
});

test('加速：同一次請求只開一次試算表（附錄第 58 點）', () => {
  const env = loadGas();
  const r = env.ctx.setupCore_();
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' }).token;
  env.props.SPREADSHEET_ID = 'TEST-SPREADSHEET';
  let opens = 0;
  const orig = env.ctx.SpreadsheetApp.openById;
  env.ctx.SpreadsheetApp.openById = (id) => { opens++; return orig(id); };
  env.api({ action: 'adminHome', token: L });
  assert.ok(opens <= 1, '後台首頁開了 ' + opens + ' 次試算表');
  opens = 0;
  env.html.Index = '<script id="boot"></script>';
  env.ctx.doGet({ parameter: {} });
  assert.ok(opens <= 1, '網頁開了 ' + opens + ' 次試算表');
});

test('加速：很少變動的分頁暫存起來，修改後立刻更新（附錄第 58 點）', () => {
  const env = loadGas();
  env.flags.sheetCache = true;
  const r = env.ctx.setupCore_();
  const L = env.api({ action: 'register', code: r.firstLeaderInvite.code, childName: '', username: 'leader01', password: 'leaderpass1', nickname: '團長' }).token;
  const items = env.sheet('項目總表'), settings = env.sheet('設定');
  env.api({ action: 'adminHome', token: L });
  const i0 = items.reads, s0 = settings.reads;
  env.api({ action: 'adminHome', token: L });
  env.api({ action: 'me', token: L });
  assert.equal(items.reads, i0, '項目總表不用再讀');
  assert.equal(settings.reads, s0, '設定不用再讀');
  // 經由後台修改：立刻看到新值
  env.api({ action: 'settingsSave', token: L, changes: { '晉級間隔月數': '3' } });
  assert.equal(env.api({ action: 'settingsGet', token: L }).settings.find((x) => x.key === '晉級間隔月數').value, '3');
  // 直接在試算表修改：onEdit 會清掉暫存
  const row = env.rows('設定').findIndex((x) => x[0] === '晉級間隔月數') + 2;
  settings.getRange(row, 2).setValues([[5]]);
  env.ctx.onEdit({ range: { getSheet: () => settings } });
  assert.equal(env.api({ action: 'settingsGet', token: L }).settings.find((x) => x.key === '晉級間隔月數').value, '5');
});
