/**
 * Web App 進入點與前端 API（階段 2：帳號、綁定、告知同意、家長查詢）
 * 後台 API 於階段 4A 加入。
 *
 * 前端以 fetch POST、Content-Type: text/plain、body 為 JSON 呼叫：
 *   { action: '動作', token: '登入憑證（需要登入的動作才帶）', ...參數 }
 * 回應：{ ok: true, ... } 或 { ok: false, code: 錯誤代碼, message: 給使用者看的訊息 }
 */

/**
 * 網頁由 GAS 直接提供（SPEC 附錄第 56 點）：專案裡有 HTML 檔「Index」就回傳它，沒有就回原本的文字。
 * 注意：網頁一旦由 GAS 提供，訪客就能用 google.script.run 呼叫所有「名稱不是底線結尾」的函式，
 * 所以這類函式一律不回傳內容、不做危險動作（見 setup、dailyJob、weeklyBackup、menu*）。
 */
function doGet() {
  try {
    var page = HtmlService.createHtmlOutputFromFile('Index').getContent();
    // 把首頁要用的公開資料直接放進網頁（SPEC 附錄第 57 點）：開頁不用再向後端要四五次資料
    var boot = '';
    try { boot = '<script>window.__BOOT=' + JSON.stringify(bootData_()).replace(/</g, '\\u003c') + ';</script>'; } catch (e2) { console.error(e2); boot = ''; }
    var mark = '<script id="boot"></script>', at = page.indexOf(mark);
    if (boot && at >= 0) page = page.slice(0, at) + boot + page.slice(at + mark.length);
    return HtmlService.createHtmlOutput(page).setTitle('22團幼童軍')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  } catch (e) {
    return ContentService.createTextOutput('OK：幼童軍進程系統後端運作中。（還沒有加入 Index 網頁檔）');
  }
}

/** 網頁一打開就需要的公開資料；章的圖片太大時不內嵌，由網頁自己再取 */
function bootData_() {
  DB_CACHE_ = {};
  var images = apiUnitImages_().images;
  if (JSON.stringify(images).length > 300000) images = null;
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  return { catalog: apiCatalog_(), notices: apiNotices_().notices, site: apiSiteInfo_(), images: images, webUrl: url };
}

/** 公開資料快取（5 分鐘）：公佈欄、月曆與活動。後台任何動作之後由 clearPublicCache_ 清掉 */
var PUBLIC_CACHE_KEYS = ['PUB_NOTICES', 'PUB_SITE'];
function cachedPublic_(key, build) {
  var cache = CacheService.getScriptCache();
  try { var hit = cache.get(key); if (hit) return JSON.parse(hit); } catch (e) { /* 快取壞了就重算 */ }
  var out = build();
  try { cache.put(key, JSON.stringify(out), 300); } catch (e2) { /* 太大就不快取 */ }
  return out;
}
function clearPublicCache_() {
  try { var c = CacheService.getScriptCache(); PUBLIC_CACHE_KEYS.forEach(function (k) { c.remove(k); }); } catch (e) { /* 不影響主要操作 */ }
}

/** 處理一個 API 請求（JSON 字串）→ 回傳結果物件；doPost 與 apiFromPage 共用 */
function handleApiBody_(text) {
  try {
    var req = JSON.parse(text || '{}');
    if (!req || typeof req !== 'object' || Array.isArray(req)) throw new ApiError(ERR.BAD_INPUT, '請求格式不正確。');
    return dispatch_(req);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof SyntaxError) return { ok: false, code: ERR.BAD_INPUT, message: '請求格式不正確。' };
    console.error(err && err.stack ? err.stack : err); // 只寫進 GAS 執行紀錄，不回給前端
    return { ok: false, code: ERR.SERVER_ERROR, message: '系統暫時無法處理，請稍後再試。' };
  }
}

/** 由 GAS 提供的網頁用 google.script.run 呼叫；和 doPost 完全同一套登入與權限檢查 */
function apiFromPage(body) {
  return JSON.stringify(handleApiBody_(typeof body === 'string' ? body : ''));
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  // 網址帶 key 參數 → LINE webhook
  if (params.key !== undefined) {
    try { handleWebhook_(e); } catch (err) { console.error(err); }
    return ContentService.createTextOutput('OK');
  }
  // 鎖在 GAS（SPEC 附錄第 57 點）：設定「允許外部網頁連線」為否時，外部網頁（含 GitHub 版）一律不能用
  var out;
  var open = true;
  try { DB_CACHE_ = {}; open = loadSettings_().values['允許外部網頁連線'] !== false; } catch (e0) { open = true; }
  if (open) out = handleApiBody_((e && e.postData && e.postData.contents) || '{}');
  else out = { ok: false, code: ERR.MOVED, message: '這個網址已經停用，請改用新的網站網址：' + webUrl_() };
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 不需登入的動作 */
var PUBLIC_ACTIONS = {
  ping: function () { var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; } return { serverTime: new Date().toISOString(), webUrl: url }; },
  consentText: apiConsentText_,
  checkCode: apiCheckCode_,
  register: apiRegister_,
  login: apiLogin_,
  resetPassword: apiResetPassword_,
  catalog: apiCatalog_
};

/** 需要登入的動作（第二個參數為 requireAccount_ 的結果） */
var AUTHED_ACTIONS = {
  me: apiMe_,
  logout: apiLogout_,
  cubDetail: apiCubDetail_,
  bind: apiBind_,
  reconsent: apiReconsent_,
  unbind: apiUnbind_,
  changePassword: apiChangePassword_,
  updateNickname: apiUpdateNickname_,
  requestChildren: apiRequestChildren_
};

function dispatch_(req) {
  DB_CACHE_ = {};
  var a = String(req.action || '');
  var fn;
  if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, a)) fn = PUBLIC_ACTIONS[a];
  else if (Object.prototype.hasOwnProperty.call(AUTHED_ACTIONS, a)) {
    var who = requireAccount_(req.token);
    return Object.assign({ ok: true }, AUTHED_ACTIONS[a](req, who));
  } else throw new ApiError(ERR.BAD_INPUT, '不支援的操作。');
  return Object.assign({ ok: true }, fn(req));
}

// ───────────── 告知同意 ─────────────

/**
 * 公開標準查詢（不用登入，SPEC 附錄第 21 點）：只回傳啟用中的進程與技能章項目、說明與晉級條件。
 * 不含任何小狼、家長或管理員的資料。結果快取 5 分鐘以加快速度。
 */
function apiCatalog_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('CATALOG2');
  if (hit) return JSON.parse(hit);
  var unitsInfo = loadUnits_();
  var byItem = loadDetails_().byItem;
  var groups = {}, order = [];
  loadItems_().items.forEach(function (it) {
    if (!it.enabled) return;
    var k = it.category + '|' + it.unit;
    if (!groups[k]) {
      var info = unitsInfo[k] || {};
      groups[k] = { category: it.category, unit: it.unit, group: info.group || '', desc: info.desc || '', rule: info.rule || '', order: info.order || 9999, items: [] };
      order.push(k);
    }
    groups[k].items.push({ section: it.section, text: it.text, details: detailsView_(byItem, it.id) });
  });
  var out = { units: order.map(function (k) { return groups[k]; }).sort(function (a, b) { return a.order - b.order; }) };
  try { cache.put('CATALOG2', JSON.stringify(out), 300); } catch (e) { /* 超過快取大小時不快取 */ }
  return out;
}

function apiConsentText_() {
  var c = latestConsent_();
  if (!c) throw new ApiError(ERR.SERVER_ERROR, '尚未設定個資告知內容，請聯絡團長。');
  return { version: c.version, content: c.content, effective: c.effective };
}

// ───────────── 綁定碼／邀請碼 ─────────────

/**
 * 驗證代碼（綁定碼或邀請碼）。失敗一律回同一句訊息並記錄失敗。
 * @param accountId 已登入時的帳號ID；未登入為 null（套用全站上限）
 * @return {{kind: 'parent'|'admin', cub?, invite?}}
 */
function verifyCode_(code, childName, accountId, settings) {
  var target = accountId || '未登入';
  if (accountId) assertNotLocked_('綁定', accountId, settings);
  else if (Logic.isGlobalBindLocked(loadFailures_(), Date.now(), settings)) {
    throw new ApiError(ERR.LOCKED, '目前暫停註冊，請稍後再試，或聯絡團長。');
  }
  var c = Logic.normalizeCode(code);
  var result = null;
  if (c && c.length <= 20) {
    var cub = loadCubs_().filter(function (x) { return x.code === c; })[0];
    if (cub && Logic.checkBindCode(cub, childName).ok) result = { kind: 'parent', cub: cub };
    if (!result) {
      var inv = loadInvites_().filter(function (x) { return x.code === c; })[0];
      if (inv && Logic.checkInvite(inv, Date.now()).ok) result = { kind: 'admin', invite: inv };
    }
  }
  if (!result) {
    recordFailure_('綁定', target);
    throw new ApiError(ERR.CODE_INVALID, Logic.CODE_ERROR_MESSAGE);
  }
  return result;
}

/** 註冊第一步：只驗證代碼（不建立任何資料） */
function apiCheckCode_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var r = verifyCode_(req.code, req.childName, null, settings);
    var out = { kind: r.kind };
    if (r.kind === 'parent') {
      var c = latestConsent_();
      out.consent = c ? { version: c.version, content: c.content } : null;
    }
    return out;
  });
}

/** 綁定一位小狼（寫入綁定紀錄、綁定碼次數 −1）；已綁定過則只更新同意版本 */
function bindCub_(accountId, cub, consentVersion) {
  var now = new Date();
  var existing = loadBindings_().filter(function (b) { return b.accountId === accountId && b.cubId === cub.cubId; })[0];
  if (existing) {
    var row = existing._raw.slice(0, HEADERS[SHEET.BINDINGS].length);
    row[3] = now; row[4] = consentVersion;
    updateRows_(SHEET.BINDINGS, [{ row: existing._row, values: row }]);
    return false;
  }
  appendRows_(SHEET.BINDINGS, [[accountId, cub.cubId, now, now, consentVersion]]);
  var cubRow = cub._raw.slice(0, HEADERS[SHEET.CUBS].length);
  cubRow[6] = Math.max(0, cub.codeUsesLeft - 1);
  updateRows_(SHEET.CUBS, [{ row: cub._row, values: cubRow }]);
  return true;
}

/** 使用邀請碼成為管理員 */
/** 使用邀請碼成為管理員；邀請碼沒有填姓名時，用帳號的稱呼當作管理員姓名 */
function redeemInvite_(accountId, invite, nickname) {
  var now = new Date();
  var admins = loadAdmins_();
  if (!admins.some(function (a) { return a.accountId === accountId; })) {
    appendRows_(SHEET.ADMINS, [[accountId, invite.name || Logic.clean(nickname).slice(0, 30) || invite.role, invite.role, now, invite.createdBy || '邀請碼', '', '']]);
  }
  var row = invite._raw.slice(0, HEADERS[SHEET.INVITES].length);
  row[6] = '已使用'; row[7] = accountId; row[8] = now;
  updateRows_(SHEET.INVITES, [{ row: invite._row, values: row }]);
  // 推播通知建立邀請碼的團長：階段 5 實作
}

function requireConsentVersion_(agreedVersion) {
  var c = latestConsent_();
  if (!c) throw new ApiError(ERR.SERVER_ERROR, '尚未設定個資告知內容，請聯絡團長。');
  if (Number(agreedVersion) !== c.version) throw new ApiError(ERR.NEED_CONSENT, '請先閱讀並勾選同意個資告知內容。');
  return c.version;
}

// ───────────── 註冊、登入、密碼 ─────────────

/** 保留的帳號名稱（團長預設帳號）：不開放註冊，訊息與「已有人使用」相同 */
function isReservedUsername_(username) { return Logic.clean(username).toLowerCase() === DEFAULT_ADMIN_USERNAME; }

function apiRegister_(req) {
  // 沒有代碼：新的註冊方式（送出申請，團長審核）；有代碼：舊方式（第一位團長邀請碼、既有綁定碼仍可用）
  if (!Logic.clean(req.code)) return registerByRequest_(req);
  return withLock_(function () {
    var settings = loadSettings_().values;
    var r = verifyCode_(req.code, req.childName, null, settings);
    checkAccountInput_(req.username, req.password, req.nickname, settings);
    // 家長：沒有同意就不建立任何資料
    var version = r.kind === 'parent' ? requireConsentVersion_(req.consentVersion) : null;
    if (isReservedUsername_(req.username) || findAccountByName_(req.username)) throw new ApiError(ERR.NAME_TAKEN, '這個帳號名稱已經有人使用，請換一個。');

    var accounts = loadAccounts_();
    var accountId = newId_('U', accounts.map(function (a) { return a.accountId; }));
    var salt = randomHex_(32);
    var hash = Logic.hashPassword(String(req.password), salt, HASH_ITERATIONS, hmacHex_);
    var now = new Date();
    appendRows_(SHEET.ACCOUNTS, [[accountId, Logic.clean(req.username), Logic.clean(req.nickname), hash, salt, '啟用', now, now, '', '']]);
    if (r.kind === 'parent') {
      bindCub_(accountId, r.cub, version);
      logOp_(accountId, '註冊並綁定', r.cub.cubId, '', '帳號 ' + Logic.clean(req.username));
    } else {
      redeemInvite_(accountId, r.invite, req.nickname);
      logOp_(accountId, '以邀請碼註冊管理員', Logic.clean(req.username), '', r.invite.role);
    }
    var s = createSession_(accountId, !!req.remember, settings);
    return { token: s.token, expiresAt: s.expiresAt };
  });
}

function apiLogin_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var name = Logic.clean(req.username).toLowerCase().slice(0, 40);
    assertNotLocked_('登入', name, settings);
    var acc = findAccountByName_(name);
    // 帳號不存在也照樣做一次雜湊，讓回應時間一致
    var ok = Logic.verifyPassword(String(req.password || ''), acc ? acc.salt : 'x', acc ? acc.passwordHash : HASH_ITERATIONS + '$x', hmacHex_);
    if (!acc || !ok || acc.status !== '啟用') {
      recordFailure_('登入', name);
      throw new ApiError(ERR.BAD_LOGIN, '帳號或密碼錯誤。');
    }
    var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
    row[7] = new Date();
    updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
    purgeSessions_(null);
    var s = createSession_(acc.accountId, !!req.remember, settings);
    return { token: s.token, expiresAt: s.expiresAt };
  });
}

/** 忘記密碼：帳號名稱＋團長給的臨時碼＋新密碼 */
function apiResetPassword_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var name = Logic.clean(req.username).toLowerCase().slice(0, 40);
    assertNotLocked_('登入', name, settings);
    var acc = findAccountByName_(name);
    var code = Logic.normalizeCode(req.tempCode);
    if (!acc || !Logic.isTempCodeValid(acc, Date.now()) || sha256Hex_(code) !== acc.tempCodeHash || acc.status !== '啟用') {
      recordFailure_('登入', name);
      throw new ApiError(ERR.BAD_LOGIN, '帳號或臨時碼錯誤，或臨時碼已過期。請聯絡團長重新產生。');
    }
    var pw = Logic.validatePassword(req.newPassword, settings['密碼最短長度'], acc.username);
    if (!pw.ok) throw new ApiError(ERR.BAD_INPUT, pw.error);
    setPassword_(acc, String(req.newPassword)); // 同時清除臨時碼（用過即失效）
    purgeSessions_(acc.accountId);
    logOp_(acc.accountId, '以臨時碼重設密碼', acc.username, '', '');
    return {};
  });
}

function apiLogout_(req, who) {
  return withLock_(function () {
    var row = readRows_(SHEET.SESSIONS).filter(function (r) { return Logic.clean(r[0]) === who.sessionHash; })[0];
    if (row) deleteRows_(SHEET.SESSIONS, [row._row]);
    return {};
  });
}

function apiChangePassword_(req, who) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var acc = findAccountById_(who.account.accountId);
    if (!Logic.verifyPassword(String(req.oldPassword || ''), acc.salt, acc.passwordHash, hmacHex_)) {
      throw new ApiError(ERR.BAD_INPUT, '目前的密碼不正確。');
    }
    var pw = Logic.validatePassword(req.newPassword, settings['密碼最短長度'], acc.username);
    if (!pw.ok) throw new ApiError(ERR.BAD_INPUT, pw.error);
    setPassword_(acc, String(req.newPassword));
    purgeSessions_(acc.accountId, who.sessionHash); // 其他裝置登出，目前這台保留
    logOp_(acc.accountId, '修改密碼', acc.username, '', '');
    return {};
  });
}

function apiUpdateNickname_(req, who) {
  var v = Logic.validateNickname(req.nickname);
  if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
  return withLock_(function () {
    var acc = findAccountById_(who.account.accountId);
    var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
    var before = row[2];
    row[2] = Logic.clean(req.nickname);
    updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
    logOp_(acc.accountId, '修改稱呼', acc.username, before, row[2]);
    return {};
  });
}

// ───────────── 已登入：綁定與同意 ─────────────

/** 已登入帳號新增綁定（第二個孩子），或輸入邀請碼成為管理員 */
function apiBind_(req, who) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var r = verifyCode_(req.code, req.childName, who.account.accountId, settings);
    if (r.kind === 'parent') {
      var version = requireConsentVersion_(req.consentVersion);
      bindCub_(who.account.accountId, r.cub, version);
      logOp_(who.account.accountId, '新增綁定', r.cub.cubId, '', '');
      return { kind: 'parent', cubId: r.cub.cubId };
    }
    redeemInvite_(who.account.accountId, r.invite, who.account.nickname);
    logOp_(who.account.accountId, '以邀請碼成為管理員', who.account.username, '', r.invite.role);
    return { kind: 'admin' };
  });
}

/** 告知內容改版後重新同意：更新此帳號所有綁定的同意時間與版本 */
function apiReconsent_(req, who) {
  return withLock_(function () {
    var version = requireConsentVersion_(req.consentVersion);
    var now = new Date();
    var ups = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; }).map(function (b) {
      var row = b._raw.slice(0, HEADERS[SHEET.BINDINGS].length);
      row[3] = now; row[4] = version;
      return { row: b._row, values: row };
    });
    updateRows_(SHEET.BINDINGS, ups);
    return { updated: ups.length };
  });
}

/** 家長自行解除綁定：只刪除自己這個帳號與該小狼的綁定 */
function apiUnbind_(req, who) {
  return withLock_(function () {
    var rows = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === Logic.clean(req.cubId); });
    if (!rows.length) throw new ApiError(ERR.NOT_FOUND, '找不到這筆綁定。');
    deleteRows_(SHEET.BINDINGS, rows.map(function (b) { return b._row; }));
    logOp_(who.account.accountId, '家長解除綁定', Logic.clean(req.cubId), '', '');
    return {};
  });
}

// ───────────── 查詢 ─────────────

/** 登入者的基本資訊、身分、綁定的小狼 */
/**
 * 新的註冊方式（SPEC 附錄第 31 點）：選身分（家長／服務員）、填孩子姓名 → 建立帳號並送出申請，
 * 團長在後台核准後才綁定孩子或成為服務員。帳號可以先登入，看到「等待審核」。
 */
function registerByRequest_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var identity = Logic.clean(req.identity);
    if (identity !== Logic.IDENTITY.PARENT && identity !== Logic.IDENTITY.STAFF) throw new ApiError(ERR.BAD_INPUT, '請選擇身分（家長或服務員）。');
    var v = Logic.validateChildNames(req.childNames, identity === Logic.IDENTITY.PARENT);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    checkAccountInput_(req.username, req.password, req.nickname, settings);
    // 有填孩子就要先同意個資告知；沒有同意不建立任何資料
    var version = v.names.length ? requireConsentVersion_(req.consentVersion) : 0;
    var requests = loadRequests_();
    if (Logic.recentRequestAccounts(requests, Date.now()) >= settings['每日註冊申請上限']) {
      throw new ApiError(ERR.LOCKED, '目前註冊的人太多，暫停註冊，請稍後再試，或聯絡團長。');
    }
    if (isReservedUsername_(req.username) || findAccountByName_(req.username)) throw new ApiError(ERR.NAME_TAKEN, '這個帳號名稱已經有人使用，請換一個。');

    var accountId = newId_('U', loadAccounts_().map(function (a) { return a.accountId; }));
    var salt = randomHex_(32);
    var hash = Logic.hashPassword(String(req.password), salt, HASH_ITERATIONS, hmacHex_);
    var now = new Date();
    appendRows_(SHEET.ACCOUNTS, [[accountId, Logic.clean(req.username), Logic.clean(req.nickname), hash, salt, '啟用', now, now, '', '']]);
    var rows = requestRows_(accountId, v.names, version, requests, now);
    if (identity === Logic.IDENTITY.STAFF) rows.push(requestRow_(accountId, '服務員', Logic.clean(req.nickname), 0, requests.concat(rowsToIds_(rows)), now));
    appendRows_(SHEET.REQUESTS, rows);
    logOp_(accountId, '註冊申請', Logic.clean(req.username), '', identity + (v.names.length ? '，孩子 ' + v.names.length + ' 位' : ''));
    var s = createSession_(accountId, !!req.remember, settings);
    return { token: s.token, expiresAt: s.expiresAt };
  });
}

/** 已登入的家長再申請新增孩子（例如第二個孩子） */
function apiRequestChildren_(req, who) {
  return withLock_(function () {
    var v = Logic.validateChildNames(req.childNames, true);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    var version = requireConsentVersion_(req.consentVersion);
    var requests = loadRequests_();
    var pendingMine = requests.filter(function (r) { return r.accountId === who.account.accountId && r.status === '待審核'; });
    if (pendingMine.length + v.names.length > 10) throw new ApiError(ERR.BAD_INPUT, '待審核的申請太多了，請等團長審核後再送。');
    var dup = v.names.filter(function (n) { return pendingMine.some(function (r) { return r.type === '孩子' && r.name === n; }); });
    if (dup.length) throw new ApiError(ERR.BAD_INPUT, '「' + dup.join('、') + '」已經在等待審核了。');
    appendRows_(SHEET.REQUESTS, requestRows_(who.account.accountId, v.names, version, requests, new Date()));
    logOp_(who.account.accountId, '申請新增孩子', who.account.username, '', v.names.length + ' 位');
    return { added: v.names.length };
  });
}

function requestRow_(accountId, type, name, version, existing, now) {
  var id = newId_('R', existing.map(function (r) { return r.requestId; }));
  return [id, accountId, type, name, now, '待審核', '', '', '', version || '', ''];
}
function rowsToIds_(rows) { return rows.map(function (r) { return { requestId: r[0] }; }); }
function requestRows_(accountId, names, version, existing, now) {
  var rows = [];
  names.forEach(function (n) { rows.push(requestRow_(accountId, '孩子', n, version, existing.concat(rowsToIds_(rows)), now)); });
  return rows;
}

function apiMe_(req, who) {
  var latest = Logic.latestConsentVersion(loadConsents_());
  var cubs = loadCubs_();
  var mine = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
  var list = [];
  mine.forEach(function (b) {
    var c = cubs.filter(function (x) { return x.cubId === b.cubId; })[0];
    if (!c) return;
    list.push({ cubId: c.cubId, name: c.name, consentVersion: b.consentVersion, consentAt: b.consentAt ? new Date(b.consentAt).toISOString() : '' });
  });
  return {
    username: who.account.username,
    nickname: who.account.nickname,
    role: who.admin ? who.admin.role : null,
    isOwner: !!who.admin && isReservedUsername_(who.account.username),
    ownerExists: who.admin ? !!findAccountByName_(DEFAULT_ADMIN_USERNAME) : undefined,
    adminName: who.admin ? who.admin.name : null,
    lineLinked: !!(who.admin && who.admin.lineUserId),
    mySquads: who.admin ? squadsOfStaff_(who.account.accountId) : [],
    cubs: list,
    // 自己的申請：待審核的全部、已退回的最近 5 筆（已退回的姓名已清除，只留類型與團長備註）
    requests: (function () {
      var mineReq = loadRequests_().filter(function (r) { return r.accountId === who.account.accountId; });
      var pend = mineReq.filter(function (r) { return r.status === '待審核'; });
      var rej = mineReq.filter(function (r) { return r.status === '已退回'; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 5);
      return pend.concat(rej).map(function (r) { return { type: r.type, name: r.name, status: r.status, at: r.at ? new Date(r.at).toISOString() : '', note: r.note }; });
    })(),
    latestConsentVersion: latest,
    needsConsent: mine.some(function (b) { return Logic.needsReconsent(b, latest); })
  };
}

/**
 * 一位已綁定小狼的完整資料（家長畫面用）。回傳欄位採白名單。
 * 不回傳「是否達標／可晉級」，已完成待頒發一律顯示固定文字。
 */
function apiCubDetail_(req, who) {
  var cubId = Logic.clean(req.cubId);
  var binding = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === cubId; })[0];
  // 沒有綁定與小狼不存在回同一句話，不透露小狼是否存在
  if (!binding) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼的資料。');
  if (Logic.needsReconsent(binding, Logic.latestConsentVersion(loadConsents_()))) {
    throw new ApiError(ERR.NEED_CONSENT, '個資告知內容已更新，請先閱讀並同意。');
  }
  var cub = loadCubs_().filter(function (c) { return c.cubId === cubId; })[0];
  if (!cub) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼的資料。');
  return buildCubView_(cub, today_());
}

/** 組出家長畫面要的資料（也供後台列印簽核單共用） */
function buildCubView_(cub, today) {
  var settings = loadSettings_().values;
  var items = loadItems_().items;
  var units = loadUnits_();
  var byItem = loadDetails_().byItem;
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && Logic.isDateStr(m.date); });
  var mById = {};
  meetings.forEach(function (m) { mById[m.meetingId] = m; });
  var att = loadAttendance_().filter(function (a) { return a.cubId === cub.cubId && mById[a.meetingId]; });
  var attRecords = att.map(function (a) { return { date: mById[a.meetingId].date, status: a.status, meetingId: a.meetingId, type: mById[a.meetingId].type }; });

  var progress = Logic.computeCubProgress({
    cubId: cub.cubId, items: items, completions: loadCompletions_(), awards: loadAwards_(),
    intervalMonths: settings['晉級間隔月數'], today: today, attendance: attRecords,
    autoItemId: settings['出席自動完成項目ID'], autoCount: settings['自動完成所需出席次數'],
    levelAttendCount: settings['晉級所需出席次數'], newbieAttendCount: settings['剛入團所需出席次數'],
    newbieAfter: cub.trialStart && cub.joinDate ? cub.joinDate : null
  });

  // 簽核人帳號ID → 管理員姓名
  var names = {};
  loadAdmins_().forEach(function (a) { names[a.accountId] = a.name; });

  var unitViews = progress.units.map(function (u) {
    var info = units[u.category + '|' + u.unit] || {};
    return {
      category: u.category, unit: u.unit, group: info.group || '', desc: info.desc || '', rule: info.rule || '',
      order: info.order || 9999, status: u.status, statusText: Logic.statusTextForParents(u.status),
      done: u.done, total: u.total, awardDate: u.awardDate, awardOccasion: u.awardOccasion || '',
      attendRequired: u.attendRequired || 0, attendSinceLast: u.attendSinceLast || 0,
      items: u.items.map(function (i) {
        return { section: i.section, text: i.text, done: i.done, date: i.date, signer: i.done ? (names[i.signer] || (i.auto ? '出席自動計算' : '')) : '', auto: i.auto, details: detailsView_(byItem, i.id) };
      })
    };
  }).sort(function (a, b) { return a.order - b.order; });

  // 出席：只顯示已到日期的集會；未來的列為即將到來；沒點名的顯示「－」（不記缺席）
  var statusOf = {};
  att.forEach(function (a) { statusOf[a.meetingId] = a.status; });
  var since = cub.trialStart && (!cub.joinDate || cub.trialStart < cub.joinDate) ? cub.trialStart : cub.joinDate;
  var inTeam = meetings.filter(function (m) { return since && m.date >= since && (!cub.leftDate || m.date <= cub.leftDate) && (m.type === '一般' || (cub.joinDate && m.date >= cub.joinDate)); });
  var past = inTeam.filter(function (m) { return m.date <= today; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  // 今天（含）以後的集會：家長可以先請假
  var upcoming = inTeam.filter(function (m) { return m.date >= today && statusOf[m.meetingId] !== '出席'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 12);
  var period = Logic.periodOf(loadPeriods_(), today);
  var rate = null;
  if (period) {
    var extra = loadExtra_().filter(function (x) { return x.period === period.name && x.cubId === cub.cubId; })
      .reduce(function (s, x) { return s + x.count; }, 0);
    rate = Logic.attendanceRate(attRecords, period, extra);
    rate.period = period.name;
  }

  return {
    cub: {
      cubId: cub.cubId, name: cub.name, squad: cub.squad, joinDate: cub.joinDate,
      tenure: Logic.tenure(cub.joinDate, today).text, currentLevel: progress.currentLevel || '', status: cub.status === Logic.TRIAL ? Logic.TRIAL : '', trialStart: cub.trialStart,
      role: cub.role, squadStaff: squadStaffNames_(cub.squad)
    },
    trial: cub.status === Logic.TRIAL ? Logic.trialProgress(attRecords, settings['體驗所需出席次數']) : null,
    nextChallenge: (function (n) {
      // 白名單：不帶簽核人帳號ID 等內部欄位
      return { type: n.type, message: n.message, level: n.level || '', items: n.items.map(function (i) { return { section: i.section, text: i.text }; }) };
    })(Logic.nextChallenge(progress)),
    units: unitViews,
    attendance: {
      meetings: past.map(function (m) { return { date: m.date, name: m.name, status: statusOf[m.meetingId] || '－' }; }),
      upcoming: upcoming.map(function (m) { return { meetingId: m.meetingId, date: m.date, name: m.name, type: m.type, note: m.note, leave: statusOf[m.meetingId] === '請假' }; }),
      counts: Logic.attendanceCounts(attRecords),
      rate: rate
    }
  };
}
