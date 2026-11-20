/**
 * 帳號、登入憑證、失敗鎖定、亂數與雜湊
 */

// ───────────── 亂數與雜湊 ─────────────

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function hmacHex_(value, key) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8));
}

function sha256Hex_(s) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

/** 隨機十六進位字串（取自 UUID v4 的亂數位元，去掉固定的版本與變體位） */
function randomHex_(len) {
  var out = '';
  while (out.length < len) {
    var u = Utilities.getUuid().replace(/-/g, '');
    out += u.slice(0, 12) + u.slice(13, 16) + u.slice(17);
  }
  return out.slice(0, len);
}

/** [0, n) 的均勻亂數整數（拒絕取樣，避免偏差）；n 最大 2^32 */
function randInt_(n) {
  if (!(n >= 1 && n <= 4294967296)) throw new Error('randInt_ 範圍不正確');
  var limit = Math.floor(4294967296 / n) * n;
  for (;;) {
    var x = parseInt(randomHex_(8), 16);
    if (x < limit) return x % n;
  }
}

function newToken_() { return randomHex_(64); }

/** 所有已存在的代碼（綁定碼＋邀請碼），產生新碼時確保不衝突 */
function allCodes_() {
  var set = {};
  loadCubs_().forEach(function (c) { if (c.code) set[c.code] = true; });
  loadInvites_().forEach(function (i) { if (i.code) set[i.code] = true; });
  return set;
}

/** 產生內部代號（帳號ID、小狼ID、集會ID 等），格式：前綴 + 8 碼 */
function newId_(prefix, existing) {
  var set = {};
  (existing || []).forEach(function (x) { set[x] = true; });
  for (;;) {
    var id = prefix + Logic.generateCode(8, randInt_, []);
    if (!set[id]) return id;
  }
}

// ───────────── 失敗紀錄與鎖定 ─────────────

function loadFailures_() {
  return readRows_(SHEET.FAILURES).map(function (r) {
    return { type: Logic.clean(r[0]), target: Logic.clean(r[1]), at: ms_(r[2]) };
  });
}

/** 寫一筆失敗紀錄；超過 500 列時順便清掉一天以前的 */
function recordFailure_(type, target) {
  appendRows_(SHEET.FAILURES, [[type, target, new Date()]]);
  var rows = readRows_(SHEET.FAILURES);
  if (rows.length > 500) {
    var cutoff = Date.now() - 86400000;
    deleteRows_(SHEET.FAILURES, rows.filter(function (r) { return ms_(r[2]) < cutoff; }).map(function (r) { return r._row; }));
  }
}

function assertNotLocked_(type, target, settings) {
  if (Logic.isLocked(loadFailures_(), type, target, Date.now(), settings)) {
    throw new ApiError(ERR.LOCKED, '錯誤次數太多，請 ' + settings['失敗鎖定分鐘數'] + ' 分鐘後再試，或聯絡團長。');
  }
}

// ───────────── 帳號與登入憑證 ─────────────

function findAccountByName_(username) {
  var u = Logic.clean(username).toLowerCase();
  if (!u) return null;
  return loadAccounts_().filter(function (a) { return a.username.toLowerCase() === u; })[0] || null;
}

function findAccountById_(accountId) {
  return loadAccounts_().filter(function (a) { return a.accountId === accountId; })[0] || null;
}

/** 建立登入憑證；回傳給前端的是原始憑證，試算表只存雜湊 */
function createSession_(accountId, remember, settings) {
  var token = newToken_();
  var ttl = remember ? settings['登入保持天數'] * 86400000 : 12 * 3600000; // 不勾記住我：12 小時
  var now = new Date();
  appendRows_(SHEET.SESSIONS, [[sha256Hex_(token), accountId, now, new Date(now.getTime() + ttl)]]);
  return { token: token, expiresAt: now.getTime() + ttl };
}

/** 刪除某帳號的登入憑證（exceptHash 保留目前這一個）與所有已過期的憑證 */
function purgeSessions_(accountId, exceptHash) {
  var now = Date.now();
  var rows = readRows_(SHEET.SESSIONS).filter(function (r) {
    var mine = Logic.clean(r[1]) === accountId && Logic.clean(r[0]) !== exceptHash;
    return (accountId && mine) || ms_(r[3]) < now;
  });
  deleteRows_(SHEET.SESSIONS, rows.map(function (r) { return r._row; }));
}

/**
 * 依憑證取得登入中的帳號；無效、過期、帳號停用一律回 SESSION_EXPIRED。
 * 回傳 {account, admin, sessionHash}
 */
/**
 * 以登入憑證查出帳號與「目前分團」的身分（SPEC 附錄第 73 點⑬）。
 * section：網頁送來的目前分團（_sec）；沒有權限或沒送就用預設（優先小狼）。前端送來的只是「想看哪個分團」，
 * 權限一律由後端依管理員分頁判斷。
 */
function requireAccount_(token, section) {
  var fail = new ApiError(ERR.SESSION_EXPIRED, '登入已過期，請重新登入。');
  if (!token || typeof token !== 'string' || token.length > 200) throw fail;
  var h = sha256Hex_(token);
  var ses = readRows_(SHEET.SESSIONS).filter(function (r) { return Logic.clean(r[0]) === h; })[0];
  if (!ses || !Logic.isSessionValid({ expiresAt: ms_(ses[3]) }, Date.now())) throw fail;
  var acc = findAccountById_(Logic.clean(ses[1]));
  if (!acc || acc.status !== '啟用') throw fail;
  var rows = loadAdminRows_().filter(function (a) { return a.accountId === acc.accountId; });
  var isOwner = isReservedUsername_(acc.username) && rows.length > 0;
  var sections = Logic.staffSections(rows, isOwner);
  var pick = Logic.pickSection(sections, section);
  var admin = null;
  if (pick) {
    // 目前分團的身分：有該分團的列就用那一列（姓名、職稱、LINE），總團／管理員沒有就借第一列
    var base = Logic.effectiveAdmins(rows, pick.section)[0] || rows[0];
    var line = '';
    rows.forEach(function (r) { if (r.lineUserId && !line) line = r.lineUserId; });
    admin = Object.assign({}, base, { role: pick.role, scope: pick.scope, section: pick.section, lineUserId: base.lineUserId || line });
  }
  // staff：這個人在各分團的身分（給分團身分設定與「準備中」畫面用）
  var staff = rows.map(function (a) { return { section: a.section, role: a.role, title: a.title }; });
  return {
    account: acc, admin: admin, staff: staff, sections: sections, section: pick ? pick.section : null, isOwner: isOwner,
    isCentral: rows.some(function (a) { return a.role === Logic.CENTRAL; }), sessionHash: h
  };
}

function setPassword_(acc, password) {
  var salt = randomHex_(32);
  var hash = Logic.hashPassword(password, salt, HASH_ITERATIONS, hmacHex_);
  var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
  row[3] = hash; row[4] = salt; row[8] = ''; row[9] = '';
  updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
}

/** 輸入格式檢查，不合格丟 BAD_INPUT */
function checkAccountInput_(username, password, nickname, settings) {
  var checks = [Logic.validateUsername(username), Logic.validatePassword(password, settings['密碼最短長度'], username)];
  if (nickname !== undefined) checks.push(Logic.validateNickname(nickname));
  checks.forEach(function (c) { if (!c.ok) throw new ApiError(ERR.BAD_INPUT, c.error); });
}
