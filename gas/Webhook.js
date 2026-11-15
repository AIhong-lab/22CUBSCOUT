/**
 * LINE webhook（網址需帶 ?key=WEBHOOK_KEY）
 * 階段 4A：管理員「連結 LINE 通知」——在官方帳號聊天室輸入後台給的 6 位數配對碼。
 * 階段 5：關鍵字回覆（可晉級、快達標、進度）。
 */
function handleWebhook_(e) {
  var key = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
  // 密鑰不符：直接忽略
  if (!key || e.parameter.key !== key) return;
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return; }
  // 只處理格式正確的請求
  if (!body || !Array.isArray(body.events)) return;
  body.events.forEach(function (ev) {
    if (!ev || ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
    if (!ev.source || ev.source.type !== 'user' || !ev.source.userId || !ev.replyToken) return;
    var text = String(ev.message.text || '').trim();
    if (/^\d{6}$/.test(text)) handlePairing_(text, ev.source.userId, ev.replyToken);
    else { DB_CACHE_ = {}; handleKeyword_(text, ev.source.userId, ev.replyToken); }
  });
}

/** 配對碼正確 → 把 LINE userId 寫入該管理員；錯誤則不回覆（不透露任何資訊） */
function handlePairing_(code, lineUserId, replyToken) {
  var cache = CacheService.getScriptCache();
  var accountId = cache.get('PAIR_' + code);
  if (!accountId) return;
  cache.remove('PAIR_' + code);
  var name = withLock_(function () {
    var a = loadAdmins_().filter(function (x) { return x.accountId === accountId; })[0];
    if (!a) return null;
    var row = a._raw.slice(0, HEADERS[SHEET.ADMINS].length);
    row[5] = lineUserId; row[6] = new Date();
    updateRows_(SHEET.ADMINS, [{ row: a._row, values: row }]);
    logOp_(accountId, '連結 LINE 通知', a.name, '', ''); // 不記 userId
    return a.name;
  });
  if (name) lineReply_(replyToken, '✅ ' + name + '，已連結 22 團幼童軍進程系統的通知。之後小狼達標時會在這裡通知你。\n也可以輸入「可晉級」或「快達標」查名單。');
}

/** 回覆訊息（不計入推播額度） */
function lineReply_(replyToken, text) {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_MESSAGING_TOKEN');
  if (!token) return null;
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
  return res.getResponseCode();
}
