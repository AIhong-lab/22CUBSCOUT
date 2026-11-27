// 羅浮本人註冊與成年人版個資告知（SPEC 附錄第 73 點⑱⑲、第 80 點）。測試資料一律虛構。
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
  const inv = call(O, 'inviteCreate', { section: '羅浮', role: '團長', title: '群長', name: '群長' });
  const R = env.api({ action: 'register', code: inv.code, childName: '', username: 'roverlead', password: 'roverpass1', nickname: '群長' }).token;
  return { env, call, W, O, R };
}
const adultV = (env) => env.api({ action: 'consentText', audience: '羅浮本人' }).version;

test('成年人版個資告知：setup 另外建一份；兩份版本各自計算', () => {
  const { env } = world();
  const parent = env.api({ action: 'consentText' });
  const adult = env.api({ action: 'consentText', audience: '羅浮本人' });
  assert.match(parent.content, /親愛的家長/);
  assert.match(adult.content, /^您好/);
  assert.doesNotMatch(adult.content, /家長/);
  assert.equal(adult.audience, '羅浮本人');
  assert.deepEqual(env.rows('告知同意內容').map((r) => r[3] || ''), ['', '羅浮本人']);
});

test('羅浮本人自己註冊：送出申請到羅浮，群長核准後綁定為「本人」，可以請假與報名', () => {
  const { env, call, W, R } = world();
  const parentV = env.api({ action: 'consentText' }).version;
  const base = { identity: '羅浮本人', selfName: '測試羅浮甲', username: 'rover01', password: 'roverpass9', nickname: '測試羅浮甲' };
  assert.equal(env.api({ action: 'register', ...base }).code, 'NEED_CONSENT');
  assert.equal(env.api({ action: 'register', ...base, consentVersion: parentV + 5 }).code, 'NEED_CONSENT');
  const reg = env.api({ action: 'register', ...base, consentVersion: adultV(env) });
  assert.equal(reg.ok, true, JSON.stringify(reg));
  const req = env.rows('註冊申請').find((x) => x[3] === '測試羅浮甲');
  assert.deepEqual([req[2], req[11]], ['本人', '羅浮']);
  assert.equal(call(W, 'requestList').items.length, 0, '小狼團長看不到');
  const list = call(R, 'requestList').items;
  assert.equal(list.length, 1);
  const ok = call(R, 'requestApprove', { requestId: list[0].requestId, name: '測試羅浮甲', squad: '', joinDate: '2026-11-01' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const b = env.rows('綁定紀錄').find((x) => x[1] === ok.cubId);
  assert.equal(b[5], '本人');
  const me = call(reg.token, 'me');
  assert.equal(me.accountType, 'parent', '羅浮本人是成年人，權限和家長一樣');
  assert.equal(me.needsConsent, false);
  assert.equal(call(reg.token, 'cubDetail', { cubId: ok.cubId }).cub.name, '測試羅浮甲');
  call(R, 'meetingSave', { lines: '2026-11-28 羅浮群集會' });
  const m = call(R, 'meetingList').meetings[0];
  assert.equal(call(reg.token, 'parentLeave', { cubId: ok.cubId, meetingId: m.meetingId }).leave, true, '可以自己請假');
  // 家長版改版不影響羅浮本人；成年人版改版才要重新同意
  env.sheet('告知同意內容').getRange(4, 1, 1, 4).setValues([[parentV + 1, '家長版第二版', '2026-11-20', '']]);
  assert.equal(call(reg.token, 'me').needsConsent, false);
  env.sheet('告知同意內容').getRange(5, 1, 1, 4).setValues([[adultV(env) + 1, '您好：成年人版第二版', '2026-11-20', '羅浮本人']]);
  assert.equal(call(reg.token, 'me').needsConsent, true);
  assert.equal(call(reg.token, 'reconsent', { consentVersion: adultV(env) }).ok, true);
  assert.equal(call(reg.token, 'me').needsConsent, false);
});

test('羅浮本人的申請只能在羅浮核准；童軍本人（未成年）照舊不能請假', () => {
  const { env, call, O } = world();
  const reg = env.api({ action: 'register', identity: '羅浮本人', selfName: '測試羅浮乙', username: 'rover02', password: 'roverpass9', nickname: '乙', consentVersion: adultV(env) });
  const rid = env.rows('註冊申請').find((x) => x[3] === '測試羅浮乙')[0];
  // admin 在小狼後台核准 → 擋下
  assert.equal(call(O, 'requestApprove', { requestId: rid, name: '測試羅浮乙', squad: '', joinDate: '2026-11-01' }).ok, false, '要切到羅浮才能核准');
  void reg;
});
