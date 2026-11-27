// 共同最高管理員（SPEC 附錄第 79 點，2026-11-25 團長決定）：最多 3 位、權限一樣、只能自己卸任、
// 可以幫另一位產生臨時碼、新增只能在試算表選單。測試資料一律虛構。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
  return { env, call, W, O, S, adminPassword: made.password };
}
const acc = (env, name) => env.rows('帳號').find((r) => r[1] === name)[0];
const ownerRow = (env) => (env.rows('設定').find((x) => x[0] === '最高管理員帳號ID') || [])[1] || '';

test('試算表選單新增最高管理員：兩位權限一樣，最多 3 位', () => {
  const { env, call, W, O, S } = world();
  assert.equal(call(S, 'me').isOwner, false);
  const r = env.ctx.addOwnerByUsername_('scoutlead');
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(ownerRow(env).split('、'), [acc(env, 'admin'), acc(env, 'scoutlead')], '原本的 admin 也寫進清單');
  assert.equal(call(S, 'me').isOwner, true);
  assert.equal(call(O, 'me').isOwner, true, 'admin 仍是最高管理員');
  assert.equal(call(S, 'me').isCentral, true, '新增時自動加為總團');
  // 兩位都能任命團長、完全刪除
  const helper = env.api({ action: 'register', identity: '服務員', childNames: [], staffSection: '小狼', username: 'helper01', password: 'helperpass1', nickname: '服務員甲' });
  assert.equal(call(S, 'staffSave', { type: 'add', accountId: acc(env, 'helper01'), section: '行義', role: '團長', title: '團長' }).ok, true);
  assert.equal(env.ctx.addOwnerByUsername_('scoutlead').ok, false, '已經是了');
  assert.match(env.ctx.addOwnerByUsername_('nobody').message, /找不到/);
  assert.equal(env.ctx.addOwnerByUsername_('leader01').ok, true);
  assert.equal(call(W, 'me').isOwner, true);
  assert.match(env.ctx.addOwnerByUsername_('helper01').message, /最多 3 位/);
  void helper;
});

test('互相保護：不能停用、刪除、移除另一位最高管理員；可以幫他產生臨時碼', () => {
  const { env, call, W, O, S } = world();
  env.ctx.addOwnerByUsername_('scoutlead');
  const admin = acc(env, 'admin'), scout = acc(env, 'scoutlead');
  assert.equal(call(S, 'accountStatus', { accountId: admin, status: '停用' }).code, 'BAD_INPUT');
  assert.equal(call(S, 'accountDelete', { accountId: admin, confirmUsername: 'admin' }).code, 'BAD_INPUT');
  assert.equal(call(O, 'accountStatus', { accountId: scout, status: '停用' }).code, 'BAD_INPUT');
  assert.equal(call(O, 'staffSave', { type: 'remove', accountId: scout, key: '總團' }).code, 'BAD_INPUT', '不能拿掉另一位的總團身分');
  assert.equal(call(O, 'staffSave', { type: 'remove', accountId: scout, key: '童軍' }).code, 'BAD_INPUT', '也不能動他的分團身分');
  const t = call(S, 'accountTempCode', { accountId: admin });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.ok(t.code);
  assert.equal(call(W, 'accountTempCode', { accountId: admin }).code === 'FORBIDDEN' || call(W, 'accountTempCode', { accountId: admin }).code === 'BAD_INPUT', true, '一般團長不能幫最高管理員產生臨時碼');
});

test('自己卸任：要輸入密碼、至少留一位；可以選擇不保留總團', () => {
  const { env, call, O, S, adminPassword } = world();
  assert.match(call(O, 'ownerResign', { password: adminPassword }).message, /至少/, '只有一位時不能卸任');
  env.ctx.addOwnerByUsername_('scoutlead');
  assert.match(call(O, 'ownerResign', { password: 'wrongpass' }).message, /密碼不正確/);
  const r = call(O, 'ownerResign', { password: adminPassword, keepAsCentral: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ownerRow(env), acc(env, 'scoutlead'));
  assert.equal(call(O, 'me').isOwner, false);
  assert.equal(call(S, 'me').isOwner, true);
  assert.ok(!env.rows('管理員').some((x) => x[0] === acc(env, 'admin') && x[2] === '總團'));
  assert.ok(env.rows('操作日誌').some((x) => x[2] === '卸任最高管理員'));
  assert.match(call(S, 'ownerResign', { password: 'scoutpass1' }).message, /至少/);
});

test('網站上不能新增或移交最高管理員（只能用試算表選單）', () => {
  const { env, call, O, adminPassword } = world();
  const r = call(O, 'handoverTransfer', { targetAccountId: acc(env, 'scoutlead'), confirmUsername: 'scoutlead', password: adminPassword });
  assert.equal(r.ok, false);
  assert.equal(ownerRow(env), '');
  const sum = call(O, 'handoverSummary');
  assert.equal(sum.ok, true);
  assert.deepEqual(sum.owners.map((o) => o.username), ['admin']);
  assert.equal(sum.canResign, false);
});

test('試算表選單卸下最高管理員：至少留一位；舊的單一帳號ID 設定照常讀得到', () => {
  const { env, call, O, S } = world();
  env.ctx.addOwnerByUsername_('scoutlead');
  assert.equal(env.ctx.removeOwnerByUsername_('admin').ok, true);
  assert.equal(call(O, 'me').isOwner, false);
  assert.match(env.ctx.removeOwnerByUsername_('scoutlead').message, /至少/);
  // 舊版移交中心寫的是單一帳號ID
  const sh = env.sheet('設定'), row = env.rows('設定').findIndex((x) => x[0] === '最高管理員帳號ID') + 2;
  sh.getRange(row, 2, 1, 1).setValues([[acc(env, 'scoutlead')]]);
  assert.equal(call(S, 'me').isOwner, true);
});

test('選單函式要從試算表開（getUi），網頁訪客叫不動', () => {
  const env = loadGas();
  env.ui.unavailable = true;
  assert.throws(() => env.ctx.menuAddOwner());
  assert.throws(() => env.ctx.menuRemoveOwner());
});
