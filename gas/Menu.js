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
    .addItem('顯示全部分頁（查紀錄用）', 'menuShowAllSheets')
    .addItem('只顯示需要編輯的分頁', 'menuHideSystemSheets')
    .addToUi();
}

/** 分頁顯示切換：只改顯示狀態，不動資料（SPEC 附錄第 30 點） */
function menuShowAllSheets() { organizeSheets_(false); SpreadsheetApp.getUi().alert('已顯示全部分頁。查完後可以用「只顯示需要編輯的分頁」再收起來。\n\n⚠️ 系統分頁請不要手動修改。'); }
function menuHideSystemSheets() { var n = organizeSheets_(true); SpreadsheetApp.getUi().alert('已收起 ' + n + ' 個系統分頁（資料都還在）。'); }
