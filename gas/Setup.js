/**
 * setup()：一鍵建立所有分頁與標題列、第一次匯入種子資料、產生第一位團長邀請碼。
 * 可重複執行；任何分頁已有資料時一律不覆蓋、不重新匯入。
 * 請在 Apps Script 編輯器手動執行。
 */
/** 給人在 Apps Script 編輯器按「執行」用：結果看執行記錄。不回傳內容（公開函式會被網頁訪客呼叫到，回傳值不能帶邀請碼） */
function setup() { assertEditorRun_(); setupCore_(); }

/**
 * 公開函式（名稱沒有底線結尾）在 GAS 網頁版可以被訪客用 google.script.run 呼叫到（附錄第 56、78 點）。
 * 會改設定或排程的函式先確認是擁有者本人在 Apps Script 編輯器或試算表選單執行：
 * 匿名訪客的 getActiveUser() 是空的，和執行身分（擁有者）不同。
 */
function assertEditorRun_() {
  var a = '', e = '';
  try { a = Session.getActiveUser().getEmail(); e = Session.getEffectiveUser().getEmail(); } catch (x) { /* 取不到就當成不是本人 */ }
  if (!a || a !== e) throw new Error('請由擁有者在 Apps Script 編輯器或試算表選單執行這個函式。');
}

function setupCore_() {
  clearAllCaches_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    DB_CACHE_ = {};
    var props = PropertiesService.getScriptProperties();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && !props.getProperty('SPREADSHEET_ID')) props.setProperty('SPREADSHEET_ID', ss.getId());
    if (!props.getProperty('WEBHOOK_KEY')) props.setProperty('WEBHOOK_KEY', randomHex_(64));

    var report = { created: [], headerFixed: [], headerMismatch: [], seeded: [] };
    Object.keys(SHEET).forEach(function (k) { ensureSheet_(SHEET[k], report); });

    // 種子資料：只在分頁沒有資料列時匯入
    var seed = Logic.buildSeed(SEED.itemsCsv, SEED.progressRules);
    if (dataRowCount_(SHEET.ITEMS) === 0) { appendRows_(SHEET.ITEMS, seed.itemRows); report.seeded.push(SHEET.ITEMS + ' ' + seed.itemRows.length + ' 列'); }
    if (dataRowCount_(SHEET.UNITS) === 0) { appendRows_(SHEET.UNITS, seed.unitRows); report.seeded.push(SHEET.UNITS + ' ' + seed.unitRows.length + ' 列'); }
    var newbie = ensureNewbieLevel_();
    if (newbie) report.seeded.push(newbie);
    ensureSectionSeeds_().forEach(function (x) { report.seeded.push(x); });
    if (dataRowCount_(SHEET.DETAILS) === 0) {
      var details = Logic.buildDetailSeed(SEED.detailsCsv);
      if (details.length) { appendRows_(SHEET.DETAILS, details); report.seeded.push(SHEET.DETAILS + ' ' + details.length + ' 列'); }
    }
    if (dataRowCount_(SHEET.CONSENT) === 0) { appendRows_(SHEET.CONSENT, [[1, SEED.consentText, today_()]]); report.seeded.push(SHEET.CONSENT + ' 第 1 版'); }

    // 權限設定：只在分頁沒有資料列時匯入預設權限表
    if (dataRowCount_(SHEET.PERMS) === 0) {
      var permRows = Logic.defaultPermRows().slice(1);
      appendRows_(SHEET.PERMS, permRows);
      report.seeded.push(SHEET.PERMS + ' ' + permRows.length + ' 項');
    }

    // 設定：只補上缺少的鍵，不改既有值
    var have = {};
    readRows_(SHEET.SETTINGS).forEach(function (r) { have[Logic.clean(r[0])] = true; });
    var missing = Logic.defaultSettingsRows().slice(1).filter(function (r) { return !have[r[0]]; });
    if (missing.length) { appendRows_(SHEET.SETTINGS, missing); report.seeded.push(SHEET.SETTINGS + ' 補上 ' + missing.length + ' 項'); }

    report.hidden = organizeSheets_(true);
    try { if (ensureDailyTrigger_()) report.seeded.push('開啟每日達標檢查排程'); } catch (e2) { report.seeded.push('⚠️ 每日排程安裝失敗：' + (e2 && e2.message ? e2.message : e2)); }
    try { ensureBackup_().forEach(function (x) { report.seeded.push(x); }); }
    catch (e) { report.seeded.push('⚠️ 自動備份設定失敗：' + (e && e.message ? e.message : e) + '（可稍後在 Apps Script 執行 installBackupTrigger）'); }
    report.firstLeaderInvite = ensureFirstLeaderInvite_();
    printSetupReport_(report);
    return report;
  } finally {
    lock.releaseLock();
  }
}

function dataRowCount_(name) {
  return readRows_(name).filter(function (r) { return r.some(function (v) { return Logic.clean(v) !== ''; }); }).length;
}

/** 建立分頁、寫標題列（只補最右邊缺少的欄）、凍結、文字格式、標題列保護 */
function ensureSheet_(name, report) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  // 新分頁依序排在最後面（insertSheet 不給位置時會插在最前面）
  if (!sh) { sh = ss.insertSheet(name, ss.getSheets().length); report.created.push(name); }
  var header = HEADERS[name];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  } else {
    var width = Math.max(sh.getLastColumn(), 1);
    var cur = sh.getRange(1, 1, 1, width).getValues()[0].map(Logic.clean);
    var n = Math.min(cur.length, header.length);
    var prefixOk = true;
    for (var i = 0; i < n; i++) if (cur[i] !== header[i]) prefixOk = false;
    if (!prefixOk) report.headerMismatch.push(name);
    else if (cur.filter(function (x) { return x; }).length < header.length) {
      // 既有欄位不動，只在最右邊補上新欄
      var start = cur.filter(function (x) { return x; }).length;
      sh.getRange(1, start + 1, 1, header.length - start).setValues([header.slice(start)]);
      report.headerFixed.push(name);
    }
  }
  invalidate_(name);
  sh.setFrozenRows(1);
  (TEXT_COLUMNS[name] || []).forEach(function (col) {
    sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  var protectedAlready = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).some(function (p) { return p.getDescription() === '標題列'; });
  if (!protectedAlready) sh.getRange(1, 1, 1, header.length).protect().setDescription('標題列').setWarningOnly(true);
}

/** 管理員分頁是空的時候，產生（或沿用）一組團長邀請碼 */
function ensureFirstLeaderInvite_() {
  if (loadAdminRows_().length) return null;
  var now = Date.now();
  var existing = loadInvites_().filter(function (i) { return i.role === Logic.ROLE.LEADER && Logic.checkInvite(i, now).ok; })[0];
  if (existing) return { code: existing.code, expiresAt: existing.expiresAt, reused: true };
  var len = loadSettings_().values['綁定碼長度'] + 2;
  var code = Logic.generateCode(len, randInt_, allCodes_());
  var exp = new Date(now + FIRST_LEADER_INVITE_HOURS * 3600000);
  appendRows_(SHEET.INVITES, [[code, Logic.ROLE.LEADER, '團長', 'setup', new Date(now), exp, '未使用', '', '', Logic.DEFAULT_SECTION, '']]);
  return { code: code, expiresAt: exp.getTime(), reused: false };
}

/**
 * 補上「剛入團」級（SPEC 附錄第 37 點）：項目總表沒有剛入團項目時，新增 P-剛入團-1～5；
 * 級別與章說明沒有剛入團時新增一列；進程細項裡原本掛在羚羊項目下、屬於剛入團的細項改掛到新項目。
 * 只新增列與修改這些細項的項目ID，不動其他資料；已補過就不再執行。
 * @return {string} 報告文字（沒有做事時為空字串）
 */
function ensureNewbieLevel_() {
  var NB = Logic.NEWBIE, seed = Logic.NEWBIE_SEED, done = [];
  var items = loadItems_().items;
  if (!items.some(function (it) { return it.category === Logic.CATEGORY.PROGRESS && it.unit === NB; })) {
    appendRows_(SHEET.ITEMS, seed.items.map(function (t, i) { return ['P-' + NB + '-' + (i + 1), Logic.CATEGORY.PROGRESS, NB, Logic.NO_SECTION, t, i + 1, '是']; }));
    done.push(SHEET.ITEMS + ' 新增剛入團 ' + seed.items.length + ' 項');
    // 細項：分組名稱等於剛入團大項、且目前掛在羚羊項目下的，改掛到剛入團
    if (ss_().getSheetByName(SHEET.DETAILS)) {
      var ups = [];
      readRows_(SHEET.DETAILS).forEach(function (r) {
        var idx = seed.items.indexOf(Logic.clean(r[1]));
        if (idx >= 0 && /^P-羚羊-/.test(Logic.clean(r[0]))) {
          var v = HEADERS[SHEET.DETAILS].map(function (h, j) { return r[j]; });
          v[0] = 'P-' + NB + '-' + (idx + 1);
          ups.push({ row: r._row, values: v });
        }
      });
      if (ups.length) { updateRows_(SHEET.DETAILS, ups); done.push(SHEET.DETAILS + ' ' + ups.length + ' 條改掛到剛入團'); }
    }
  }
  if (!loadUnits_(Logic.DEFAULT_SECTION)[Logic.CATEGORY.PROGRESS + '|' + NB]) {
    appendRows_(SHEET.UNITS, [[NB, Logic.CATEGORY.PROGRESS, '', seed.desc, seed.rule, 5]]);
    done.push(SHEET.UNITS + ' 新增剛入團');
  }
  return done.join('、');
}

/**
 * 匯入其他分團的官方進程與章（附錄第 77 點；目前是稚齡）：項目總表還沒有該分團的項目時，才在最下面新增；
 * 級別與章說明只補該分團還沒有的名稱。只新增列、不改任何既有資料；已匯入就不再執行（團長改過的內容不會被蓋掉）。
 * @return {string[]} 報告文字
 */
function ensureSectionSeeds_() {
  var out = [], sections = (typeof SEED !== 'undefined' && SEED.sections) || {};
  Object.keys(sections).forEach(function (sec) {
    if (!Logic.progressModule(sec)) return;
    var seed = Logic.buildSeed(sections[sec].itemsCsv, sections[sec].progressRules, sec);
    // 格式錯誤的列也算（看原始的分團欄），避免重複匯入
    var hasAny = readRows_(SHEET.ITEMS).some(function (r) { return Logic.clean(r[0]) && Logic.progressSec(r[7]) === sec; });
    if (!hasAny) {
      var taken = {};
      readRows_(SHEET.ITEMS).forEach(function (r) { taken[Logic.clean(r[0])] = true; });
      var rows = seed.itemRows.filter(function (r) { return !taken[r[0]]; });
      if (rows.length) { appendRows_(SHEET.ITEMS, rows); out.push(SHEET.ITEMS + ' 新增' + sec + ' ' + rows.length + ' 項'); }
    }
    var have = loadUnits_(sec);
    var units = seed.unitRows.filter(function (u) { return !have[u[1] + '|' + u[0]]; });
    if (units.length) { appendRows_(SHEET.UNITS, units); out.push(SHEET.UNITS + ' 新增' + sec + ' ' + units.length + ' 列'); }
  });
  return out;
}

/**
 * 整理分頁：要編輯的分頁排最前面並顯示；系統分頁依 hide 隱藏或全部顯示。
 * 只改分頁的順序與顯示狀態，不動任何資料；不屬於本系統的分頁不處理。
 * @return {number} 隱藏的分頁數
 */
function organizeSheets_(hide) {
  var ss = ss_();
  // 先顯示要編輯的分頁（試算表至少要有一個看得到的分頁，才能隱藏其他的）
  EDITABLE_SHEETS.forEach(function (name, i) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    if (sh.isSheetHidden()) sh.showSheet();
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  var n = 0;
  Object.keys(SHEET).forEach(function (k) {
    var name = SHEET[k];
    if (EDITABLE_SHEETS.indexOf(name) >= 0) return;
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    if (hide && !sh.isSheetHidden()) { sh.hideSheet(); n++; }
    if (!hide && sh.isSheetHidden()) sh.showSheet();
  });
  var first = ss.getSheetByName(EDITABLE_SHEETS[0]);
  if (first) ss.setActiveSheet(first);
  return n;
}

function printSetupReport_(r) {
  Logger.log('setup 完成。');
  Logger.log('只顯示需要編輯的 ' + EDITABLE_SHEETS.length + ' 個分頁，其他系統分頁已隱藏（資料都在）。要查看時用試算表選單「🐺 幼童軍系統 → 顯示全部分頁」。');
  if (r.created.length) Logger.log('新建立分頁：' + r.created.join('、'));
  if (r.seeded.length) Logger.log('匯入資料：' + r.seeded.join('、'));
  if (r.headerFixed.length) Logger.log('補上新欄位：' + r.headerFixed.join('、'));
  if (r.headerMismatch.length) Logger.log('⚠️ 標題列與程式不一致（未修改，請檢查）：' + r.headerMismatch.join('、'));
  if (r.firstLeaderInvite) {
    Logger.log('第一位團長邀請碼：' + r.firstLeaderInvite.code + '（有效到 ' +
      Utilities.formatDate(new Date(r.firstLeaderInvite.expiresAt), TZ, 'yyyy-MM-dd HH:mm') + '）');
    Logger.log('請用網頁「我有代碼，要註冊」輸入這組邀請碼（小孩姓名留空）建立你的團長帳號。不要分享給別人。');
  }
}

/** 清除階段 0B 的測試資料（Script Properties 中 T0B_ 開頭者） */
function cleanup0B() {
  assertEditorRun_();
  var props = PropertiesService.getScriptProperties();
  var n = 0;
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf('T0B_') === 0) { props.deleteProperty(k); n++; } });
  Logger.log('已清除 ' + n + ' 筆 0B 測試資料。');
}
