/**
 * LINE 圖文選單一鍵安裝（SPEC 附錄第 60 點）
 * 試算表選單「🐺 幼童軍系統 → 📱 安裝 LINE 圖文選單」呼叫 menuInstallRichMenu()。
 * 步驟：建立選單（六格連結）→ 上傳圖片（docs/line-richmenu.jpg，從 GitHub 網站抓）→ 設為所有人的預設 → 刪掉舊的「22團選單」。
 * 圖片由 tools/richmenu.js 產生；六格位置要和那支程式一致（三欄兩列，左上 → 右上 → 左下 → 右下）。
 * token 只放在 Script Properties（LINE_MESSAGING_TOKEN），不寫進日誌或視窗。
 */
var RICH_MENU_NAME = '22團選單';
var RICH_MENU_SIZE = { width: 2500, height: 1686 };

/** 六格：[按鈕名稱, 網站頁面]；第六格 FB 用「網站內容」的 FB 網址，沒填就開「了解幼童軍」 */
var RICH_MENU_CELLS = [['公佈欄', 'notices'], ['進程查詢', 'progress'], ['技能章查詢', 'badges'], ['了解幼童軍', 'about'], ['活動時間', 'calendar'], ['22團 FB', 'fb']];

/** 六格的範圍與連結（純計算，方便測試） */
function richMenuAreas_(root, fb) {
  var W = RICH_MENU_SIZE.width, H = RICH_MENU_SIZE.height;
  var xs = [0, Math.round(W / 3), Math.round(W * 2 / 3), W], ys = [0, Math.round(H / 2), H];
  return RICH_MENU_CELLS.map(function (c, i) {
    var col = i % 3, row = Math.floor(i / 3);
    var uri = c[1] === 'fb' ? (/^https:\/\/((www|m)\.)?(facebook\.com|fb\.com|fb\.me)\//.test(fb || '') ? fb : root + 'web/#about') : root + 'web/#' + c[1];
    return { bounds: { x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: ys[row + 1] - ys[row] },
      action: { type: 'uri', label: c[0], uri: uri } };
  });
}

/** 呼叫 LINE API；不是 200 就丟出含 LINE 說明的錯誤（不含 token） */
function lineApi_(token, method, url, payload, contentType) {
  var o = { method: method, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  if (payload !== undefined) { o.payload = payload; o.contentType = contentType || 'application/json'; }
  var res = UrlFetchApp.fetch(url, o);
  var code = res.getResponseCode(), text = res.getContentText() || '{}', json = {};
  try { json = JSON.parse(text); } catch (e) { json = {}; }
  if (code !== 200) throw new Error('LINE 回應 ' + code + (json.message ? '：' + json.message : ''));
  return json;
}

/** 安裝圖文選單，回傳新選單ID；失敗時刪掉做到一半的選單再丟出錯誤 */
function installRichMenu_(token) {
  var root = webUrl_();
  var fb = siteValues_().fb;
  var old = (lineApi_(token, 'get', 'https://api.line.me/v2/bot/richmenu/list').richmenus || [])
    .filter(function (m) { return m.name === RICH_MENU_NAME; }).map(function (m) { return m.richMenuId; });
  var id = lineApi_(token, 'post', 'https://api.line.me/v2/bot/richmenu', JSON.stringify({
    size: RICH_MENU_SIZE, selected: true, name: RICH_MENU_NAME, chatBarText: '選單', areas: richMenuAreas_(root, fb)
  })).richMenuId;
  try {
    var img = UrlFetchApp.fetch(root + 'docs/line-richmenu.jpg').getBlob();
    lineApi_(token, 'post', 'https://api-data.line.me/v2/bot/richmenu/' + id + '/content', img, 'image/jpeg');
    lineApi_(token, 'post', 'https://api.line.me/v2/bot/user/all/richmenu/' + id);
  } catch (e) {
    try { lineApi_(token, 'delete', 'https://api.line.me/v2/bot/richmenu/' + id); } catch (e2) { /* 刪不掉就算了 */ }
    throw e;
  }
  old.forEach(function (o) { try { lineApi_(token, 'delete', 'https://api.line.me/v2/bot/richmenu/' + o); } catch (e) { /* 舊的刪不掉不影響 */ } });
  logOp_('試算表選單', '安裝 LINE 圖文選單', RICH_MENU_NAME, old.length ? '舊選單 ' + old.length + ' 個' : '', '新選單');
  return id;
}

/** 試算表選單：安裝 LINE 圖文選單（只有能編輯試算表的人看得到；網頁訪客呼叫時 getUi 會直接失敗） */
function menuInstallRichMenu() {
  var ui = SpreadsheetApp.getUi();
  var token = PropertiesService.getScriptProperties().getProperty('LINE_MESSAGING_TOKEN');
  if (!token) { ui.alert('安裝 LINE 圖文選單', '還沒有設定 LINE_MESSAGING_TOKEN：請到 Apps Script「專案設定 → 指令碼屬性」填入官方帳號的 Channel access token。'); return; }
  try {
    installRichMenu_(token);
    ui.alert('安裝 LINE 圖文選單', '完成！用手機打開官方帳號聊天室就會看到新的六格選單（可能要關掉聊天室再打開）。\n\n' +
      '如果 LINE 官方帳號管理後台（manager.line.biz）也有設定圖文選單，這裡安裝的會優先顯示。\n' +
      '要換圖或換連結：改好後再按一次這個選單就會換新。');
  } catch (e) {
    ui.alert('安裝 LINE 圖文選單', '安裝失敗：' + e.message + '\n\n請確認 token 正確、網站（GitHub）上有 docs/line-richmenu.jpg。');
  }
}
