/**
 * 試算表選單「🐺 幼童軍系統」（SPEC 附錄第 17 點）
 * 只有能編輯這份試算表的人看得到；開啟試算表時自動出現（onOpen 簡易觸發）。
 * 注意：選單呼叫的函式名稱不可以底線結尾（GAS 會視為私有函式）。
 * 邀請碼功能已拿掉（SPEC 附錄第 33 點）：服務員改為自己註冊、團長核准。
 */

/** 網頁網址（臨時碼說明文字用）；可在 Script Properties 設定 WEB_URL 覆寫 */
var DEFAULT_WEB_URL = 'https://aihong-lab.github.io/22CUBSCOUT/';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🐺 幼童軍系統')
    .addItem('🔑 團長預設帳號（admin）', 'menuDefaultAdmin')
    .addItem('把帳號設為團長', 'menuSetLeader')
    .addSeparator()
    .addItem('📱 安裝 LINE 圖文選單', 'menuInstallRichMenu')
    .addSeparator()
    .addItem('顯示全部分頁（查紀錄用）', 'menuShowAllSheets')
    .addItem('只顯示需要編輯的分頁', 'menuHideSystemSheets')
    .addToUi();
}

/** 團長預設帳號的帳號名稱（SPEC 附錄第 39 點） */
var DEFAULT_ADMIN_USERNAME = 'admin';

/**
 * 團長預設帳號：沒有 admin 帳號就建立（團長、最高權限），已經有就重設密碼並確保是團長。
 * 密碼每次隨機產生、只顯示在這個視窗，不寫進程式、日誌或試算表（試算表只存雜湊）。
 */
function menuDefaultAdmin() {
  var ui = SpreadsheetApp.getUi();
  var r = ensureDefaultAdmin_();
  ui.alert('團長預設帳號', '網址：' + webUrl_() +
    '\n帳號：' + r.username + '\n密碼：' + r.password + '\n\n' + (r.created ? '已建立團長帳號。' : '已重設這個帳號的密碼（其他裝置已登出）。') +
    '\n請抄下密碼，登入後到「我的 → 修改密碼」改成自己的密碼。這個視窗關掉後就看不到密碼了。', ui.ButtonSet.OK);
}

function ensureDefaultAdmin_() {
  return withLock_(function () {
    var password = Logic.generateCode(10, randInt_, []).toLowerCase();
    var salt = randomHex_(32);
    var hash = Logic.hashPassword(password, salt, HASH_ITERATIONS, hmacHex_);
    var acc = findAccountByName_(DEFAULT_ADMIN_USERNAME);
    var created = false, now = new Date();
    if (!acc) {
      var id = newId_('U', loadAccounts_().map(function (a) { return a.accountId; }));
      appendRows_(SHEET.ACCOUNTS, [[id, DEFAULT_ADMIN_USERNAME, '團長', hash, salt, '啟用', now, '', '', '']]);
      acc = findAccountByName_(DEFAULT_ADMIN_USERNAME);
      created = true;
    } else {
      var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
      row[3] = hash; row[4] = salt; row[5] = '啟用'; row[8] = ''; row[9] = '';
      updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
      purgeSessions_(acc.accountId);
    }
    var admins = loadAdmins_(Logic.DEFAULT_SECTION);
    var cur = admins.filter(function (a) { return a.accountId === acc.accountId; })[0];
    if (!cur) appendRows_(SHEET.ADMINS, [[acc.accountId, '團長', Logic.ROLE.LEADER, now, '試算表選單', '', '', Logic.DEFAULT_SECTION, '']]);
    else if (cur.role !== Logic.ROLE.LEADER) {
      var ar = cur._raw.slice(0, HEADERS[SHEET.ADMINS].length); ar[2] = Logic.ROLE.LEADER;
      updateRows_(SHEET.ADMINS, [{ row: cur._row, values: ar }]);
    }
    // 解除登入鎖定：有人故意輸錯密碼也不會把團長鎖在外面
    var fails = readRows_(SHEET.FAILURES).filter(function (r) { return Logic.clean(r[0]) === '登入' && Logic.clean(r[1]).toLowerCase() === DEFAULT_ADMIN_USERNAME; });
    if (fails.length) deleteRows_(SHEET.FAILURES, fails.map(function (r) { return r._row; }));
    logOp_('試算表選單', created ? '建立團長預設帳號' : '重設團長預設帳號密碼', DEFAULT_ADMIN_USERNAME, '', '團長');
    return { username: DEFAULT_ADMIN_USERNAME, password: password, created: created };
  });
}

/**
 * 把已註冊的帳號設為團長（最高權限）。只有能編輯這份試算表的人看得到這個選單，
 * 而能編輯試算表本來就能改所有資料，所以不另外驗證（SPEC 附錄第 36 點）。
 */
function menuSetLeader() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.prompt('把帳號設為團長', '請輸入要設為團長的「帳號」（先在網站註冊好，例如 leader_hong）：', ui.ButtonSet.OK_CANCEL);
  if (ans.getSelectedButton() !== ui.Button.OK) return;
  var r = setLeaderByUsername_(ans.getResponseText());
  ui.alert(r.message);
}

function setLeaderByUsername_(username) {
  return withLock_(function () {
    var acc = findAccountByName_(username);
    if (!acc) return { ok: false, message: '找不到帳號「' + Logic.clean(username) + '」。請先在網站註冊（登入 → 註冊新帳號），再回來設定。' };
    if (acc.status !== '啟用') return { ok: false, message: '這個帳號已停用，請先到後台「帳號管理」啟用。' };
    var admins = loadAdmins_(Logic.DEFAULT_SECTION);
    var cur = admins.filter(function (a) { return a.accountId === acc.accountId; })[0];
    if (cur && cur.role === Logic.ROLE.LEADER) return { ok: true, message: '「' + acc.username + '」已經是團長了。' };
    if (cur) {
      var row = cur._raw.slice(0, HEADERS[SHEET.ADMINS].length);
      row[2] = Logic.ROLE.LEADER;
      updateRows_(SHEET.ADMINS, [{ row: cur._row, values: row }]);
    } else {
      appendRows_(SHEET.ADMINS, [[acc.accountId, acc.nickname || acc.username, Logic.ROLE.LEADER, new Date(), '試算表選單', '', '', Logic.DEFAULT_SECTION, '']]);
    }
    // 這個帳號還在等審核的服務員申請一併結案
    var pend = loadRequests_().filter(function (q) { return q.accountId === acc.accountId && q.status === '待審核' && q.type === '服務員'; });
    if (pend.length) updateRows_(SHEET.REQUESTS, pend.map(function (q) {
      var v = q._raw.slice(0, HEADERS[SHEET.REQUESTS].length);
      v[3] = ''; v[5] = '已核准'; v[6] = '試算表選單'; v[7] = new Date();
      return { row: q._row, values: v };
    }));
    logOp_('試算表選單', '設為團長', acc.username, cur ? cur.role : '', Logic.ROLE.LEADER);
    return { ok: true, message: '已把「' + acc.username + '」設為團長。請重新登入網站，就會進入後台並擁有全部權限。' };
  });
}

/** 分頁顯示切換：只改顯示狀態，不動資料（SPEC 附錄第 30 點） */
function menuShowAllSheets() { var ui0 = SpreadsheetApp.getUi(); organizeSheets_(false); ui0.alert('已顯示全部分頁。查完後可以用「只顯示需要編輯的分頁」再收起來。\n\n⚠️ 系統分頁請不要手動修改。'); }
function menuHideSystemSheets() { var ui0 = SpreadsheetApp.getUi(); var n = organizeSheets_(true); ui0.alert('已收起 ' + n + ' 個系統分頁（資料都還在）。'); }
