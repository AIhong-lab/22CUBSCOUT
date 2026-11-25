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
    return HtmlService.createHtmlOutput(page).setTitle('22團')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  } catch (e) {
    return ContentService.createTextOutput('OK：22團系統後端運作中。（還沒有加入 Index 網頁檔）');
  }
}

/** 網頁一打開就需要的公開資料；章的圖片太大時不內嵌，由網頁自己再取 */
function bootData_() {
  DB_CACHE_ = {};
  var images = apiUnitImages_().images;
  if (JSON.stringify(images).length > 300000) images = null;
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  return { catalog: apiCatalog_(), notices: apiNotices_().notices, site: apiSiteInfo_(), images: images, webUrl: url, publicTabs: Logic.resolvePermissions(loadPermRules_(), { loggedIn: false }).tabs };
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
  else {
    // [修補] 優先回傳 GAS Web App 網址，避免又指向被停用的外部 GitHub Pages 網址
    var gasUrl = '';
    try { gasUrl = ScriptApp.getService().getUrl() || ''; } catch (e1) { gasUrl = ''; }
    out = { ok: false, code: ERR.MOVED, message: '這個網址已經停用，請改用新的網站網址：' + (gasUrl || webUrl_()) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 不需登入的動作 */
var PUBLIC_ACTIONS = {
  ping: function () { var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; } return { serverTime: new Date().toISOString(), webUrl: url, version: APP_VERSION }; },
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
  startup: apiStartup_,
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
  CUR_SEC_ = null;
  var a = String(req.action || '');
  var fn;
  if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, a)) fn = PUBLIC_ACTIONS[a];
  else if (Object.prototype.hasOwnProperty.call(AUTHED_ACTIONS, a)) {
    var who = requireAccount_(req.token, req._sec);
    return Object.assign({ ok: true }, AUTHED_ACTIONS[a](req, who));
  } else throw new ApiError(ERR.BAD_INPUT, '不支援的操作。');
  return Object.assign({ ok: true }, fn(req));
}

// ───────────── 告知同意 ─────────────

/**
 * 公開標準查詢（不用登入，SPEC 附錄第 21 點）：只回傳啟用中的進程與技能章項目、說明與晉級條件。
 * 不含任何小狼、家長或管理員的資料。結果快取 5 分鐘以加快速度。
 */
function apiCatalog_(req) {
  // 分團（附錄第 77 點）：沒帶或不是有進程的分團時是小狼（舊網址 #progress、#badges）
  var sec = Logic.sectionOf(req && req.section);
  if (!Logic.progressModule(sec)) return { units: [], section: sec, levels: [] };
  var cache = CacheService.getScriptCache(), ckey = 'CATALOG2' + (sec === Logic.DEFAULT_SECTION ? '' : '_' + sec);
  var hit = cache.get(ckey);
  if (hit) return JSON.parse(hit);
  var unitsInfo = loadUnits_(sec);
  var byItem = loadDetails_().byItem;
  var groups = {}, order = [];
  loadItems_().items.forEach(function (it) {
    if (!it.enabled || it.sec !== sec) return;
    var k = it.category + '|' + it.unit;
    if (!groups[k]) {
      var info = unitsInfo[k] || {};
      groups[k] = { category: it.category, unit: it.unit, group: info.group || '', desc: info.desc || '', rule: info.rule || '', order: info.order || 9999, items: [] };
      order.push(k);
    }
    groups[k].items.push({ section: it.section, text: it.text, details: detailsView_(byItem, it.id) });
  });
  var out = { units: order.map(function (k) { return groups[k]; }).sort(function (a, b) { return a.order - b.order; }), section: sec, levels: Logic.levelsOf(sec), badgeGroups: Logic.progressModule(sec).badgeGroups };
  try { cache.put(ckey, JSON.stringify(out), 300); } catch (e) { /* 超過快取大小時不快取 */ }
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
function bindCub_(accountId, cub, consentVersion, relation, skipCodeDecrement) {
  var now = new Date();
  var rel = relation === Logic.RELATION.SELF ? Logic.RELATION.SELF : Logic.RELATION.PARENT;
  var allMine = loadBindings_().filter(function (b) { return b.accountId === accountId; });
  if (allMine.some(function (b) { return b.relation === Logic.RELATION.SELF && b.cubId !== cub.cubId; })) {
    throw new ApiError(ERR.BAD_INPUT, '童軍本人帳號僅限綁定自己的資料，不能綁定其他團員。');
  }
  var existing = allMine.filter(function (b) { return b.cubId === cub.cubId; })[0];
  if (existing) {
    var row = existing._raw.slice(0, HEADERS[SHEET.BINDINGS].length);
    row[3] = now; row[4] = consentVersion;
    if (relation) row[5] = rel;
    updateRows_(SHEET.BINDINGS, [{ row: existing._row, values: row }]);
    return false;
  }
  appendRows_(SHEET.BINDINGS, [[accountId, cub.cubId, now, now, consentVersion, rel]]);
  if (!skipCodeDecrement) {
    var cubRow = cub._raw.slice(0, HEADERS[SHEET.CUBS].length);
    cubRow[6] = Math.max(0, cub.codeUsesLeft - 1);
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: cubRow }]);
  }
  return true;
}

/** 使用邀請碼成為管理員；邀請碼沒有填姓名時，用帳號的稱呼當作管理員姓名 */
function redeemInvite_(accountId, invite, nickname) {
  var now = new Date();
  // 邀請碼已指定分團、身分、職稱（SPEC 附錄第 68 點）；同一人在同一分團已有身分就不重複加
  var key = function (r) { return r.role === Logic.CENTRAL ? Logic.CENTRAL : Logic.sectionOf(r.section); };
  if (!loadAdminRows_().some(function (a) { return a.accountId === accountId && key(a) === key(invite); })) {
    appendRows_(SHEET.ADMINS, [[accountId, invite.name || Logic.clean(nickname).slice(0, 30) || invite.role, invite.role, now, invite.createdBy || '邀請碼', '', '', invite.section, invite.title]]);
  }
  var row = invite._raw.slice(0, HEADERS[SHEET.INVITES].length);
  row[6] = '已使用'; row[7] = accountId; row[8] = now;
  updateRows_(SHEET.INVITES, [{ row: invite._row, values: row }]);
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
  var name = Logic.clean(req.username).toLowerCase().slice(0, 40);
  var pw = String(req.password || '');
  // [修補] 帳號或密碼空白直接回傳錯誤，避免浪費 2000 次 HMAC 運算與寫入空目標失敗紀錄
  if (!name || !pw) throw new ApiError(ERR.BAD_LOGIN, '帳號或密碼錯誤。');
  return withLock_(function () {
    var settings = loadSettings_().values;
    assertNotLocked_('登入', name, settings);
    var acc = findAccountByName_(name);
    // 帳號不存在也照樣做一次雜湊，讓回應時間一致
    var ok = Logic.verifyPassword(pw, acc ? acc.salt : 'x', acc ? acc.passwordHash : HASH_ITERATIONS + '$x', hmacHex_);
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
  var name = Logic.clean(req.username).toLowerCase().slice(0, 40);
  var code = Logic.normalizeCode(req.tempCode);
  if (!name || !code) throw new ApiError(ERR.BAD_LOGIN, '帳號或臨時碼錯誤，或臨時碼已過期。請聯絡團長重新產生。');
  return withLock_(function () {
    var settings = loadSettings_().values;
    assertNotLocked_('登入', name, settings);
    var acc = findAccountByName_(name);
    // [修補] 使用常數時間比對臨時碼雜湊
    if (!acc || !Logic.isTempCodeValid(acc, Date.now()) || !Logic.constantTimeEqual(sha256Hex_(code), acc.tempCodeHash) || acc.status !== '啟用') {
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
    // 舊密碼錯誤和登入共用失敗紀錄與鎖定（附錄第 78 點）
    assertNotLocked_('登入', acc.username.toLowerCase(), settings);
    if (!Logic.verifyPassword(String(req.oldPassword || ''), acc.salt, acc.passwordHash, hmacHex_)) {
      recordFailure_('登入', acc.username.toLowerCase());
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

/**
 * 童軍本人帳號（只有「本人」綁定、不是管理員）不能解除自己的綁定或申請新增孩子；
 * 綁定別人已由 bindCub_ 擋下（附錄第 76、78 點）。
 */
function isScoutSelfAccount_(who) {
  if (who.admin) return false;
  var mine = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
  return mine.length > 0 && mine.every(function (b) { return b.relation === Logic.RELATION.SELF; });
}
function assertNotScoutSelf_(who) {
  if (isScoutSelfAccount_(who)) throw new ApiError(ERR.FORBIDDEN, '童軍本人帳號不能做這個操作，請家長處理。');
}

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
  assertNotScoutSelf_(who);
  return withLock_(function () {
    var rows = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === Logic.clean(req.cubId); });
    if (!rows.length) throw new ApiError(ERR.NOT_FOUND, '找不到這筆綁定。');
    deleteRows_(SHEET.BINDINGS, rows.map(function (b) { return b._row; }));
    logOp_(who.account.accountId, '家長解除綁定', Logic.clean(req.cubId), '', '');
    return {};
  });
}

// ───────────── 查詢 ─────────────

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
    var rows = requestRows_(accountId, v.names, version, requests, now, childSections_(req));
    if (identity === Logic.IDENTITY.STAFF) rows.push(requestRow_(accountId, '服務員', Logic.clean(req.nickname), 0, requests.concat(rowsToIds_(rows)), now, requestSection_(req.staffSection)));
    appendRows_(SHEET.REQUESTS, rows);
    logOp_(accountId, '註冊申請', Logic.clean(req.username), '', identity + (v.names.length ? '，孩子 ' + v.names.length + ' 位' : ''));
    var s = createSession_(accountId, !!req.remember, settings);
    return { token: s.token, expiresAt: s.expiresAt };
  });
}

/** 已登入的家長再申請新增孩子（例如第二個孩子） */
function apiRequestChildren_(req, who) {
  assertNotScoutSelf_(who);
  return withLock_(function () {
    var v = Logic.validateChildNames(req.childNames, true);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    var version = requireConsentVersion_(req.consentVersion);
    var requests = loadRequests_();
    var pendingMine = requests.filter(function (r) { return r.accountId === who.account.accountId && r.status === '待審核'; });
    if (pendingMine.length + v.names.length > 10) throw new ApiError(ERR.BAD_INPUT, '待審核的申請太多了，請等團長審核後再送。');
    var dup = v.names.filter(function (n) { return pendingMine.some(function (r) { return r.type === '孩子' && r.name === n; }); });
    if (dup.length) throw new ApiError(ERR.BAD_INPUT, '「' + dup.join('、') + '」已經在等待審核了。');
    appendRows_(SHEET.REQUESTS, requestRows_(who.account.accountId, v.names, version, requests, new Date(), childSections_(req)));
    logOp_(who.account.accountId, '申請新增孩子', who.account.username, '', v.names.length + ' 位');
    return { added: v.names.length };
  });
}

function requestRow_(accountId, type, name, version, existing, now, section) {
  var id = newId_('R', existing.map(function (r) { return r.requestId; }));
  return [id, accountId, type, name, now, '待審核', '', '', '', version || '', '', section || ''];
}
function rowsToIds_(rows) { return rows.map(function (r) { return { requestId: r[0] }; }); }
/**
 * 申請時選的分團（SPEC 附錄第 73 點，團長 2026-11-19 決定）：選了分團就記分團；選「不確定」記「未指定」，
 * 由管理員、總團或各分團團長指定。沒送這個欄位（舊版網頁）時留空＝小狼。
 */
function requestSection_(v) {
  if (v === undefined || v === null) return '';
  var x = Logic.clean(v);
  return Logic.isSection(x) ? x : Logic.UNASSIGNED;
}
/** 孩子姓名 → 分團（childSections 與 childNames 一一對應） */
function childSections_(req) {
  var out = {}, names = Array.isArray(req.childNames) ? req.childNames : [], secs = req.childSections;
  if (!Array.isArray(secs)) return out;
  names.forEach(function (n, i) { var k = Logic.clean(n).replace(/\s+/g, ''); if (k && out[k] === undefined) out[k] = requestSection_(secs[i]); });
  return out;
}
function requestRows_(accountId, names, version, existing, now, sections) {
  var rows = [];
  names.forEach(function (n) { rows.push(requestRow_(accountId, '孩子', n, version, existing.concat(rowsToIds_(rows)), now, (sections || {})[n] || '')); });
  return rows;
}

/**
 * 登入後的第一趟（SPEC 附錄第 58 點）：一次回傳 me 與第一個畫面要用的資料，少等一趟後端。
 * 管理員：後台首頁＋行事曆；家長：第一個孩子的進度。附帶資料取不到就略過，網頁會自己再要。
 */
function apiStartup_(req, who) {
  var me = apiMe_(req, who), pre = {};
  // 每一份預載各自處理錯誤：某一頁沒有權限（例如點名被關掉）時，其他已經拿到的照樣給（附錄第 78 點）
  var tryPut = function (key, fn) { try { pre[key] = Object.assign({ ok: true }, fn()); } catch (e) { /* 沒拿到就由網頁自己再讀 */ } };
  if (who.admin) {
    tryPut('adminHome', function () { return AUTHED_ACTIONS.adminHome({}, who); });
    tryPut('meetingList', function () { return AUTHED_ACTIONS.meetingList({}, who); });
  } else if (me.cubs && me.cubs.length && !me.needsConsent) {
    tryPut('cubDetail', function () { return apiCubDetail_({ cubId: me.cubs[0].cubId }, who); });
  }
  return { me: me, prefetch: pre };
}

function apiMe_(req, who) {
  var latest = Logic.latestConsentVersion(loadConsents_());
  var cubs = loadCubs_();
  var mine = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
  var list = [];
  mine.forEach(function (b) {
    var c = cubs.filter(function (x) { return x.cubId === b.cubId; })[0];
    if (!c) return;
    list.push({ cubId: c.cubId, name: c.name, section: c.section, relation: b.relation || Logic.RELATION.PARENT, consentVersion: b.consentVersion, consentAt: b.consentAt ? new Date(b.consentAt).toISOString() : '' });
  });
  var hasParentBinding = list.some(function (x) { return x.relation !== Logic.RELATION.SELF; });
  var isScoutSelf = !who.admin && list.length > 0 && !hasParentBinding;
  var mySec = who.section || (list[0] ? list[0].section : '');
  var permView = resolveWhoPerms_(who, hasParentBinding, isScoutSelf, mySec);
  var allowedSections = (who.isOwner || who.isCentral)
    ? Logic.SECTIONS.slice()
    : (who.admin ? (who.sections || []).map(function (x) { return x.section; })
      : list.map(function (x) { return x.section; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }));
  var accountType = who.isOwner ? 'owner' : (who.isCentral ? 'central' : (who.admin ? (who.admin.role === Logic.ROLE.LEADER ? 'leader' : 'assistant') : (isScoutSelf ? 'scout_self' : (hasParentBinding ? 'parent' : 'guest'))));
  return {
    username: who.account.username,
    nickname: who.account.nickname,
    role: who.admin ? who.admin.role : null,
    isOwner: !!who.isOwner,
    ownerExists: who.admin ? !!ownerId_() : undefined,
    isScoutSelf: isScoutSelf,
    accountType: accountType,
    allowedSections: allowedSections,
    adminName: who.admin ? who.admin.name : null,
    lineLinked: !!(who.admin && who.admin.lineUserId),
    mySquads: who.admin ? squadsOfStaff_(who.account.accountId, who.section) : [],
    // 目前分團與可以切換的分團（附錄第 73 點⑬）；網頁之後每個請求都帶 _sec
    section: who.section || null,
    sections: (who.sections || []).map(function (x) { return { section: x.section, role: x.role }; }),
    title: who.admin ? (who.admin.title || '') : '',
    canManageAll: who.admin ? canManageAll_(who) : false,
    shared: who.admin ? Logic.SHARED_FUNCS.filter(function (f) { return canShared_(who, f); }) : [],
    // [新增] 依動態權限設定算出本帳號可顯示的分頁與可用動作，前端可直接用來切換分頁與內容
    tabs: permView.tabs,
    visibleTabs: permView.visibleTabs,
    permissions: permView.actions,
    // 各分團身分（SPEC 附錄第 68 點）：staff 給「分團功能準備中」畫面；canManageStaff 決定後台是否顯示「分團身分」頁
    staff: who.staff || [],
    isCentral: !!who.isCentral,
    canManageStaff: !!who.isCentral || !!who.isOwner,
    serverVersion: APP_VERSION, // 網頁用來檢查後端是否已部署新版本（附錄第 72 點）
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
  var isSelf = binding.relation === Logic.RELATION.SELF;
  var pv = resolveWhoPerms_(who, !isSelf, isSelf, cub.section);
  var view = buildCubView_(cub, today_());
  view.relation = binding.relation || Logic.RELATION.PARENT;
  if (!pv.tabs.member_progress) { view.hasProgress = false; view.units = []; view.nextChallenge = null; view.progressDisabledByPerm = true; }
  if (!pv.tabs.member_attendance) { view.attendanceDisabledByPerm = true; view.attendance = { meetings: [], upcoming: [], counts: { attended: 0, late: 0, leave: 0 }, rate: null }; }
  return view;
}

/** 組出家長畫面要的資料（也供後台列印簽核單共用） */
function buildCubView_(cub, today) {
  var settings = loadSettings_().values;
  var items = loadItems_().items;
  var units = loadUnits_(cub.section);
  var byItem = loadDetails_().byItem;
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && Logic.isDateStr(m.date); });
  var mById = {};
  // 出席紀錄（含進程計算）算所有集會；家長看到的集會清單只列孩子分團與全團的
  var shown = meetings.filter(function (m) { return Logic.targetIncludes(m.target, cub.section); });
  meetings.forEach(function (m) { mById[m.meetingId] = m; });
  var att = loadAttendance_().filter(function (a) { return a.cubId === cub.cubId && mById[a.meetingId]; });
  var attRecords = att.map(function (a) { return { date: mById[a.meetingId].date, status: a.status, meetingId: a.meetingId, type: mById[a.meetingId].type, counts: mById[a.meetingId].counts }; });

  // 有進程模組的分團（小狼、稚齡）依各自的規則計算；其他分團的孩子只顯示出席，進程畫面寫「準備中」（附錄第 73 點）
  var hasProgress = Logic.PROGRESS_SECTIONS.indexOf(cub.section) >= 0;
  // 家長畫面不帶完成期限（附錄第 77 點：期限只在後台提醒）
  var params = hasProgress ? Logic.progressParams(settings, cub.section) : null;
  if (params) delete params.deadlines;
  var progress = !hasProgress ? { units: [], currentLevel: '' } : Logic.computeCubProgress(Object.assign(params, {
    cubId: cub.cubId, items: items, completions: loadCompletions_(), awards: loadAwards_(),
    today: today, attendance: attRecords,
    newbieAfter: cub.trialStart && cub.joinDate ? cub.joinDate : null
  }));

  // [修補] 簽核人帳號ID → 管理員姓名：改用全分團 adminNames_()，避免總團或他分團服務員簽核時顯示空白
  var names = adminNames_();

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
  var inTeam = shown.filter(function (m) { return since && m.date >= since && (!cub.leftDate || m.date <= cub.leftDate) && (m.type === '一般' || (cub.joinDate && m.date >= cub.joinDate)); });
  var past = inTeam.filter(function (m) { return m.date <= today; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  // 今天（含）以後的集會：家長可以先請假
  var upcoming = inTeam.filter(function (m) { return m.date >= today && !Logic.isPresent(statusOf[m.meetingId]); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 12);
  var period = sectionPeriod_(cub.section, today);
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
      role: cub.role, squadStaff: squadStaffNames_(cub.squad, cub.section), section: cub.section
    },
    hasProgress: hasProgress, levels: Logic.levelsOf(cub.section),
    trial: cub.status === Logic.TRIAL ? Logic.trialProgress(attRecords, Logic.sectionSetting(settings, '體驗所需出席次數', cub.section)) : null,
    nextChallenge: (function (n) {
      // 白名單：不帶簽核人帳號ID 等內部欄位
      return { type: n.type, message: n.message, level: n.level || '', items: n.items.map(function (i) { return { section: i.section, text: i.text }; }) };
    })(hasProgress ? Logic.nextChallenge(progress) : { type: 'none', message: '', items: [] }),
    units: unitViews,
    attendance: {
      meetings: past.map(function (m) { return { date: m.date, name: m.name, status: statusOf[m.meetingId] || '－' }; }),
      upcoming: upcoming.map(function (m) { return { meetingId: m.meetingId, date: m.date, name: m.name, type: m.type, note: m.note, leave: statusOf[m.meetingId] === '請假' }; }),
      counts: Logic.attendanceCounts(attRecords),
      rate: rate
    }
  };
}
