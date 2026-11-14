/**
 * 試算表選單「🐺 幼童軍系統」（SPEC 附錄第 17 點）
 * 只有能編輯這份試算表的人看得到；開啟試算表時自動出現（onOpen 簡易觸發）。
 * 注意：選單呼叫的函式名稱不可以底線結尾（GAS 會視為私有函式）。
 */

/** 網頁網址（邀請說明文字用）；可在 Script Properties 設定 WEB_URL 覆寫 */
var DEFAULT_WEB_URL = 'https://aihong-lab.github.io/22CUBSCOUT/';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🐺 幼童軍系統')
    .addItem('產生服務員邀請碼', 'menuInviteAssistant')
    .addItem('產生團長邀請碼', 'menuInviteLeader')
    .addSeparator()
    .addItem('顯示全部分頁（查紀錄用）', 'menuShowAllSheets')
    .addItem('只顯示需要編輯的分頁', 'menuHideSystemSheets')
    .addToUi();
}

/** 分頁顯示切換：只改顯示狀態，不動資料（SPEC 附錄第 30 點） */
function menuShowAllSheets() { organizeSheets_(false); SpreadsheetApp.getUi().alert('已顯示全部分頁。查完後可以用「只顯示需要編輯的分頁」再收起來。\n\n⚠️ 系統分頁請不要手動修改。'); }
function menuHideSystemSheets() { var n = organizeSheets_(true); SpreadsheetApp.getUi().alert('已收起 ' + n + ' 個系統分頁（資料都還在）。'); }

function menuInviteAssistant() { menuInvite_(Logic.ROLE.ASSISTANT); }
function menuInviteLeader() { menuInvite_(Logic.ROLE.LEADER); }

/** 詢問姓名 → 產生邀請碼並寫入「管理員邀請」→ 顯示說明文字 */
function menuInvite_(role) {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.prompt('產生' + role + '邀請碼', '請輸入對方的姓名（會顯示在後台的管理員名單）：', ui.ButtonSet.OK_CANCEL);
  if (ans.getSelectedButton() !== ui.Button.OK) return;
  var name = Logic.clean(ans.getResponseText()).slice(0, 30);
  if (!name) { ui.alert('沒有輸入姓名，已取消。'); return; }
  var inv = createInvite_(role, name, '試算表選單');
  ui.alert('已產生' + role + '邀請碼', inviteMessage_(inv) + '\n\n（請複製上面的文字，用 LINE 傳給對方。這組碼只能用一次。）', ui.ButtonSet.OK);
}

/**
 * 產生一組管理員邀請碼並寫入試算表（試算表選單與 4A 後台共用）
 * @return {{code, role, name, expiresAt}}
 */
function createInvite_(role, name, createdBy) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var code = Logic.generateCode(settings['綁定碼長度'] + 2, randInt_, allCodes_());
    var now = new Date();
    var exp = new Date(now.getTime() + settings['管理員邀請碼有效小時數'] * 3600000);
    appendRows_(SHEET.INVITES, [[code, role, name, createdBy, now, exp, '未使用', '', '']]);
    logOp_(createdBy, '產生管理員邀請碼', name, '', role);
    return { code: code, role: role, name: name, expiresAt: exp.getTime() };
  });
}

/** 給對方的邀請說明文字 */
function inviteMessage_(inv) {
  var url = PropertiesService.getScriptProperties().getProperty('WEB_URL') || DEFAULT_WEB_URL;
  return inv.name + ' 您好，邀請您加入 22 團幼童軍進程系統（' + inv.role + '）：\n' +
    '1. 打開 ' + url + '\n' +
    '2. 按「我有代碼，要註冊」\n' +
    '3. 綁定碼欄位輸入：' + inv.code + '（孩子姓名留空）\n' +
    '4. 設定您的帳號、密碼、稱呼\n' +
    '邀請碼只能用一次，' + Utilities.formatDate(new Date(inv.expiresAt), TZ, 'MM/dd HH:mm') + ' 前有效。';
}
