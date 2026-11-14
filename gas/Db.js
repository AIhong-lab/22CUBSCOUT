/**
 * 試算表存取層：一律批次讀寫（getValues/setValues），寫入由呼叫端包在 withLock_ 裡。
 * 同一次執行內的讀取結果會快取，寫入後自動失效。
 */

var DB_CACHE_ = {};

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('找不到分頁：' + name + '（請先執行 setup）');
  return sh;
}

/** 讀整個分頁（含標題列），欄數以標題定義為準 */
function readAll_(name) {
  if (DB_CACHE_[name]) return DB_CACHE_[name];
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var width = HEADERS[name].length;
  var rows = last > 0 ? sh.getRange(1, 1, last, width).getValues() : [];
  DB_CACHE_[name] = rows;
  return rows;
}

/** 讀資料列（不含標題），每列附上試算表列號 _row */
function readRows_(name) {
  return readAll_(name).slice(1).map(function (r, i) { r = r.slice(); r._row = i + 2; return r; });
}

function invalidate_(name) { delete DB_CACHE_[name]; }

function appendRows_(name, rows) {
  if (!rows.length) return;
  var sh = sheet_(name);
  var width = HEADERS[name].length;
  var data = rows.map(function (r) {
    var x = r.slice(0, width);
    while (x.length < width) x.push('');
    return x;
  });
  var start = sh.getLastRow() + 1;
  // 超過試算表目前列數時先加列（getRange 不會自動擴充）
  var need = start + data.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(start, 1, data.length, width).setValues(data);
  invalidate_(name);
}

/** 更新多列：updates = [{row, values}]；相鄰列合併成一次 setValues */
function updateRows_(name, updates) {
  if (!updates.length) return;
  var sh = sheet_(name);
  var width = HEADERS[name].length;
  var sorted = updates.slice().sort(function (a, b) { return a.row - b.row; });
  var i = 0;
  while (i < sorted.length) {
    var j = i;
    while (j + 1 < sorted.length && sorted[j + 1].row === sorted[j].row + 1) j++;
    var block = sorted.slice(i, j + 1).map(function (u) {
      var x = u.values.slice(0, width);
      while (x.length < width) x.push('');
      return x;
    });
    sh.getRange(sorted[i].row, 1, block.length, width).setValues(block);
    i = j + 1;
  }
  invalidate_(name);
}

/** 刪除多列（由下往上，連續列合併成一次 deleteRows） */
function deleteRows_(name, rowNos) {
  if (!rowNos.length) return;
  var sh = sheet_(name);
  var sorted = rowNos.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < sorted.length) {
    var j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] - 1) j++;
    sh.deleteRows(sorted[j], i === j ? 1 : sorted[i] - sorted[j] + 1);
    i = j + 1;
  }
  invalidate_(name);
}

/** 寫入用鎖；同時有人操作時排隊，最多等 20 秒 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new ApiError(ERR.SERVER_ERROR, '目前使用人數較多，請稍後再試一次。');
  try {
    // 拿到鎖後重讀，避免用到別人寫入前的快取
    DB_CACHE_ = {};
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ───────────── 型別轉換 ─────────────

/** 儲存格 → 'YYYY-MM-DD'（試算表可能已自動轉成 Date） */
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var s = Logic.clean(v).replace(/\//g, '-');
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : s;
}

/** 儲存格 → 毫秒數（時間戳記欄） */
function ms_(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  var t = Date.parse(Logic.clean(v));
  return isNaN(t) ? 0 : t;
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

// ───────────── 讀取成物件 ─────────────

function loadCubs_() {
  return readRows_(SHEET.CUBS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      cubId: Logic.clean(r[0]), name: Logic.clean(r[1]), squad: Logic.clean(r[2]), joinDate: dateStr_(r[3]),
      level: Logic.clean(r[4]), code: Logic.normalizeCode(r[5]), codeUsesLeft: Number(r[6]) || 0,
      status: Logic.clean(r[7]), leftDate: dateStr_(r[8]), _row: r._row, _raw: r
    };
  });
}

function loadAccounts_() {
  return readRows_(SHEET.ACCOUNTS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      accountId: Logic.clean(r[0]), username: Logic.clean(r[1]), nickname: Logic.clean(r[2]),
      passwordHash: Logic.clean(r[3]), salt: Logic.clean(r[4]), status: Logic.clean(r[5]) || '啟用',
      tempCodeHash: Logic.clean(r[8]), tempCodeExpiresAt: ms_(r[9]), _row: r._row, _raw: r
    };
  });
}

function loadBindings_() {
  return readRows_(SHEET.BINDINGS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { accountId: Logic.clean(r[0]), cubId: Logic.clean(r[1]), consentAt: ms_(r[3]), consentVersion: Number(r[4]) || 0, _row: r._row, _raw: r };
  });
}

function loadAdmins_() {
  return readRows_(SHEET.ADMINS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { accountId: Logic.clean(r[0]), name: Logic.clean(r[1]), role: Logic.clean(r[2]), lineUserId: Logic.clean(r[5]), _row: r._row, _raw: r };
  });
}

function loadInvites_() {
  return readRows_(SHEET.INVITES).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      code: Logic.normalizeCode(r[0]), role: Logic.clean(r[1]), name: Logic.clean(r[2]), createdBy: Logic.clean(r[3]),
      expiresAt: ms_(r[5]), status: Logic.clean(r[6]), _row: r._row, _raw: r
    };
  });
}

function loadItems_() { return Logic.parseItems(readAll_(SHEET.ITEMS)); }

/** 級別與章說明（容錯：略過空白列與名稱空白列） */
function loadUnits_() {
  var map = {};
  readRows_(SHEET.UNITS).forEach(function (r) {
    var name = Logic.clean(r[0]);
    if (!name) return;
    map[Logic.clean(r[1]) + '|' + name] = { name: name, category: Logic.clean(r[1]), group: Logic.clean(r[2]), desc: Logic.clean(r[3]), rule: Logic.clean(r[4]), order: Number(r[5]) || 9999 };
  });
  return map;
}

function loadCompletions_() {
  return readRows_(SHEET.COMPLETIONS).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    var c = Logic.rowToCompletion(r);
    c.date = dateStr_(r[2]);
    c._row = r._row;
    return c;
  });
}

function loadAwards_() {
  return readRows_(SHEET.AWARDS).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { cubId: Logic.clean(r[0]), unit: Logic.clean(r[1]), date: dateStr_(r[2]), occasion: Logic.clean(r[3]), note: Logic.clean(r[4]), signer: Logic.clean(r[5]), _row: r._row };
  });
}

function loadMeetings_() {
  return readRows_(SHEET.MEETINGS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { meetingId: Logic.clean(r[0]), date: dateStr_(r[1]), name: Logic.clean(r[2]), note: Logic.clean(r[3]), enabled: Logic.clean(r[4]) !== '否', _row: r._row };
  });
}

function loadAttendance_() {
  return readRows_(SHEET.ATTENDANCE).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { meetingId: Logic.clean(r[0]), cubId: Logic.clean(r[1]), status: Logic.clean(r[2]), signer: Logic.clean(r[3]), _row: r._row };
  });
}

function loadPeriods_() {
  return readRows_(SHEET.PERIODS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { name: Logic.clean(r[0]), start: dateStr_(r[1]), end: dateStr_(r[2]), total: Number(r[3]) || 0 };
  });
}

function loadExtra_() {
  return readRows_(SHEET.EXTRA).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { period: Logic.clean(r[0]), cubId: Logic.clean(r[1]), count: Number(r[2]) || 0 };
  });
}

function loadConsents_() {
  return readRows_(SHEET.CONSENT).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { version: Number(r[0]) || 0, content: String(r[1]), effective: dateStr_(r[2]) };
  });
}

function latestConsent_() {
  var list = loadConsents_();
  var v = Logic.latestConsentVersion(list);
  return list.filter(function (c) { return c.version === v; })[0] || null;
}

function loadSettings_() { return Logic.parseSettings(readAll_(SHEET.SETTINGS)); }

/** 寫操作日誌（不得寫入密碼、臨時碼、登入憑證） */
function logOp_(actor, action, target, before, after) {
  appendRows_(SHEET.LOG, [[new Date(), actor || '', action, target || '', before || '', after || '']]);
}
