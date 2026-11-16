/**
 * 試算表結構與系統常數（SPEC 第四節）
 *
 * ⚠️ 維護守則：既有欄位不得刪除或重排；要加欄位只能加在陣列最後面，setup() 會自動補上。
 */

var TZ = 'Asia/Taipei';

/** 密碼雜湊次數（0B 實測 1000 次約 380 毫秒；雜湊字串會記錄次數，日後調整不影響舊密碼） */
var HASH_ITERATIONS = 2000;

/** 第一位團長邀請碼的有效時數（setup 產生） */
var FIRST_LEADER_INVITE_HOURS = 72;

var SHEET = {
  CUBS: '小狼名單',
  ACCOUNTS: '帳號',
  SESSIONS: '登入工作階段',
  BINDINGS: '綁定紀錄',
  ADMINS: '管理員',
  INVITES: '管理員邀請',
  ITEMS: '項目總表',
  UNITS: '級別與章說明',
  DETAILS: '進程細項',
  COMPLETIONS: '完成紀錄',
  AWARDS: '頒章紀錄',
  MEETINGS: '集會行事曆',
  ATTENDANCE: '出席紀錄',
  PERIODS: '年度出席設定',
  EXTRA: '額外出席',
  NOTIFY: '通知紀錄',
  FAILURES: '失敗紀錄',
  CONSENT: '告知同意內容',
  REQUESTS: '註冊申請',
  SQUAD_STAFF: '小隊輔',
  ROLES: '職務紀錄',
  NOTICES: '公告',
  SITE: '網站內容',
  EVENTS: '活動',
  EVENT_REGS: '活動報名',
  UNIT_IMAGES: '章圖',
  SETTINGS: '設定',
  LOG: '操作日誌'
};

/**
 * 團長平常需要自己打開修改的分頁（SPEC 附錄第 30 點）；排在最前面且一律顯示。
 * 其他分頁是系統自己寫入的紀錄，setup() 會把它們隱藏起來（只是隱藏，資料不動）。
 */
var EDITABLE_SHEETS = [SHEET.ITEMS, SHEET.DETAILS, SHEET.UNITS, SHEET.SETTINGS, SHEET.CONSENT];

/** 各分頁標題列（順序即欄位順序） */
var HEADERS = {};
HEADERS[SHEET.CUBS] = ['小狼ID', '姓名', '小隊', '入團日', '目前級別', '綁定碼', '綁定碼剩餘次數', '狀態', '離團日', '體驗開始日', '職務'];
HEADERS[SHEET.ACCOUNTS] = ['帳號ID', '帳號名稱', '稱呼', '密碼雜湊', '密碼鹽', '狀態', '建立時間', '最後登入時間', '臨時碼雜湊', '臨時碼到期時間'];
HEADERS[SHEET.SESSIONS] = ['憑證雜湊', '帳號ID', '建立時間', '到期時間'];
HEADERS[SHEET.BINDINGS] = ['帳號ID', '小狼ID', '綁定時間', '同意時間', '同意版本'];
HEADERS[SHEET.ADMINS] = ['帳號ID', '姓名', '角色', '加入時間', '指定人', 'LINE userId', 'LINE 連結時間'];
HEADERS[SHEET.INVITES] = ['邀請碼', '角色', '姓名', '建立人', '建立時間', '到期時間', '狀態', '使用者帳號ID', '使用時間'];
HEADERS[SHEET.ITEMS] = ['項目ID', '類別', '級別或章名', '大項', '項目內容', '排序', '啟用'];
HEADERS[SHEET.UNITS] = ['名稱', '類別', '分類', '說明', '晉級條件', '排序'];
HEADERS[SHEET.DETAILS] = ['項目ID', '分組', '細項內容', '通過標準', '生活應用', '排序', '啟用'];
HEADERS[SHEET.COMPLETIONS] = ['小狼ID', '項目ID', '完成日期', '簽核人', '備註', '回報人', '回報狀態'];
HEADERS[SHEET.AWARDS] = ['小狼ID', '級別或章名', '頒發日期', '頒發場合', '備註', '簽核人', '登錄時間'];
HEADERS[SHEET.MEETINGS] = ['集會ID', '日期', '名稱', '備註', '啟用', '建立人', '建立時間', '類型'];
HEADERS[SHEET.ATTENDANCE] = ['集會ID', '小狼ID', '狀態', '點名人', '點名時間'];
HEADERS[SHEET.PERIODS] = ['年度名稱', '開始日', '結束日', '應出席總數', '備註'];
HEADERS[SHEET.EXTRA] = ['年度名稱', '小狼ID', '額外出席次數', '備註', '設定人', '設定時間'];
HEADERS[SHEET.NOTIFY] = ['小狼ID', '級別或章名', '通知類型', '通知時間'];
HEADERS[SHEET.FAILURES] = ['類型', '對象', '時間'];
HEADERS[SHEET.REQUESTS] = ['申請ID', '帳號ID', '類型', '填寫姓名', '申請時間', '狀態', '處理人', '處理時間', '小狼ID', '同意版本', '備註'];
HEADERS[SHEET.SQUAD_STAFF] = ['小隊', '帳號ID', '設定人', '設定時間'];
HEADERS[SHEET.ROLES] = ['小狼ID', '小隊', '職務', '開始日', '結束日', '設定人', '設定時間'];
HEADERS[SHEET.EVENTS] = ['活動ID', '標題', '說明', '活動日期', '結束日期', '報名開始', '報名結束', '每人費用', '題目', '狀態', '建立人', '建立時間', '存檔試算表ID', '封存時間'];
HEADERS[SHEET.EVENT_REGS] = ['報名ID', '活動ID', '帳號ID', '姓名', '身分別', '答案', '應繳金額', '已繳', '報名時間', '狀態', '更新人', '更新時間'];
HEADERS[SHEET.UNIT_IMAGES] = ['名稱', '類別', '圖片', '更新人', '更新時間'];
HEADERS[SHEET.SITE] = ['鍵', '內容', '更新人', '更新時間'];
HEADERS[SHEET.NOTICES] = ['公告ID', '標題', '內容', '置頂', '集會ID', '發布人', '發布時間', '狀態'];
HEADERS[SHEET.CONSENT] = ['版本', '內容', '生效日'];
HEADERS[SHEET.SETTINGS] = ['鍵', '值', '說明'];
HEADERS[SHEET.LOG] = ['時間', '操作人', '動作', '對象', '修改前', '修改後'];

/**
 * 需設為「純文字」格式的欄（1 起算），避免試算表把日期字串或全數字代碼自動轉型。
 */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.CUBS] = [1, 4, 6, 9, 10];
TEXT_COLUMNS[SHEET.ACCOUNTS] = [1, 2];
TEXT_COLUMNS[SHEET.BINDINGS] = [1, 2];
TEXT_COLUMNS[SHEET.ADMINS] = [1];
TEXT_COLUMNS[SHEET.INVITES] = [1, 8];
TEXT_COLUMNS[SHEET.ITEMS] = [1];
TEXT_COLUMNS[SHEET.DETAILS] = [1];
TEXT_COLUMNS[SHEET.COMPLETIONS] = [1, 2, 3, 4];
TEXT_COLUMNS[SHEET.AWARDS] = [1, 3, 6];
TEXT_COLUMNS[SHEET.MEETINGS] = [1, 2];
TEXT_COLUMNS[SHEET.ATTENDANCE] = [1, 2, 4];
TEXT_COLUMNS[SHEET.PERIODS] = [2, 3];
TEXT_COLUMNS[SHEET.EXTRA] = [2];
TEXT_COLUMNS[SHEET.NOTIFY] = [1];
TEXT_COLUMNS[SHEET.CONSENT] = [3];
TEXT_COLUMNS[SHEET.REQUESTS] = [1, 2, 9];
TEXT_COLUMNS[SHEET.SQUAD_STAFF] = [2];
TEXT_COLUMNS[SHEET.ROLES] = [1, 4, 5];
TEXT_COLUMNS[SHEET.NOTICES] = [1, 5];
TEXT_COLUMNS[SHEET.SITE] = [1, 2];
TEXT_COLUMNS[SHEET.EVENTS] = [1, 2, 3, 4, 5, 6, 7, 9, 13];
TEXT_COLUMNS[SHEET.EVENT_REGS] = [1, 2, 3, 4, 5, 6];
TEXT_COLUMNS[SHEET.UNIT_IMAGES] = [1, 2, 3];

/** API 錯誤代碼（前端依代碼處理，訊息直接顯示給使用者） */
var ERR = {
  MOVED: 'MOVED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  BAD_LOGIN: 'BAD_LOGIN',
  LOCKED: 'LOCKED',
  CODE_INVALID: 'CODE_INVALID',
  BAD_INPUT: 'BAD_INPUT',
  NEED_CONSENT: 'NEED_CONSENT',
  NAME_TAKEN: 'NAME_TAKEN',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  SERVER_ERROR: 'SERVER_ERROR'
};

/** 給使用者看的錯誤；message 會直接顯示，不可含內部細節 */
function ApiError(code, message) {
  this.code = code;
  this.message = message;
}
