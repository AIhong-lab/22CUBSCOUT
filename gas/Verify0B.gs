/**
 * 階段 0B 技術驗證用後端（暫時性程式，階段 2 會被正式程式取代並刪除）
 *
 * 驗證三件事：
 *  ① GitHub Pages 網頁以 text/plain POST 呼叫 GAS 並取得回應
 *  ② 測試帳號註冊、登入、記住登入、憑證過期後回到登入畫面
 *  ③ LINE webhook 打到 GAS，輸入任意文字能收到回覆
 *
 * 測試資料只存在 Script Properties（鍵名以 T0B_ 開頭），不碰試算表。
 * 驗證結束後執行 cleanup0B() 即可全部清除。
 *
 * 需要的 Script Properties：
 *  - WEBHOOK_KEY：由 init0B() 自動產生
 *  - LINE_MESSAGING_TOKEN：由團長從 LINE Developers 複製後手動填入
 */

// 密碼雜湊的重複次數（0B 會量測耗時，作為階段 2 決定次數的依據）
var T0B_HASH_ITER = 1000;
// 「記住我」的有效時間：30 天；不勾選時用 2 分鐘，方便測試過期
var T0B_LONG_MS = 30 * 24 * 60 * 60 * 1000;
var T0B_SHORT_MS = 2 * 60 * 1000;

/** 第一次使用時在編輯器手動執行：產生 webhook 密鑰並印出設定說明 */
function init0B() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('WEBHOOK_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('WEBHOOK_KEY', key);
  }
  Logger.log('WEBHOOK_KEY 已就緒。');
  Logger.log('LINE webhook 網址 =（你的 GAS 網址）?key=' + key);
  Logger.log('提示：GAS 網址是「部署」後取得、以 /exec 結尾的那串。');
  Logger.log('LINE_MESSAGING_TOKEN 是否已設定：' + (props.getProperty('LINE_MESSAGING_TOKEN') ? '是' : '否'));
}

/** 查看最近一次 webhook 的紀錄（只記時間、事件數與回覆結果，不記訊息內容與 userId） */
function showWebhookLog() {
  var v = PropertiesService.getScriptProperties().getProperty('T0B_LAST_WEBHOOK');
  Logger.log(v ? v : '還沒有收到任何 webhook。');
}

/** 驗證結束後執行：清除所有 0B 測試資料（保留 WEBHOOK_KEY 與 LINE_MESSAGING_TOKEN） */
function cleanup0B() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('T0B_') === 0) { props.deleteProperty(k); n++; }
  });
  Logger.log('已清除 ' + n + ' 筆 0B 測試資料。');
}

/** 用瀏覽器直接打開 GAS 網址時顯示，確認部署成功 */
function doGet() {
  return ContentService.createTextOutput('OK：幼童軍系統 0B 驗證後端已部署。');
}

/** 同時接前端 API 與 LINE webhook：網址帶 key 參數者視為 webhook */
function doPost(e) {
  var params = (e && e.parameter) || {};
  if (params.key !== undefined) {
    handleWebhook0B_(e);
    // LINE 只需要收到回應；內容不重要
    return ContentService.createTextOutput('OK');
  }
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = handleApi0B_(req);
  } catch (err) {
    // 不把內部錯誤細節回給前端
    console.error(err);
    out = { ok: false, code: 'SERVER_ERROR', message: '系統暫時無法處理，請稍後再試。' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ───────────── ③ LINE webhook ─────────────

function handleWebhook0B_(e) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('WEBHOOK_KEY');
  // 密鑰不符：直接忽略
  if (!key || e.parameter.key !== key) return;
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return; }
  // 只處理格式正確的請求
  if (!body || !Array.isArray(body.events)) return;

  var log = { time: new Date().toISOString(), events: body.events.length, replies: [] };
  var token = props.getProperty('LINE_MESSAGING_TOKEN');
  body.events.forEach(function (ev) {
    if (ev && ev.type === 'message' && ev.message && ev.message.type === 'text' && ev.replyToken) {
      if (!token) { log.replies.push('缺少 LINE_MESSAGING_TOKEN'); return; }
      var text = String(ev.message.text || '').slice(0, 50);
      var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({
          replyToken: ev.replyToken,
          messages: [{ type: 'text', text: '✅ 0B 測試成功：收到你的訊息「' + text + '」' }]
        }),
        muteHttpExceptions: true
      });
      log.replies.push(res.getResponseCode());
    }
  });
  props.setProperty('T0B_LAST_WEBHOOK', JSON.stringify(log));
}

// ───────────── ①② 前端 API ─────────────

function handleApi0B_(req) {
  switch (req.action) {
    case 'ping':
      return { ok: true, serverTime: new Date().toISOString() };
    case 'register':
      return register0B_(req);
    case 'login':
      return login0B_(req);
    case 'me':
      return me0B_(req);
    case 'logout':
      return logout0B_(req);
    default:
      return { ok: false, code: 'BAD_ACTION', message: '不支援的操作。' };
  }
}

function register0B_(req) {
  var name = String(req.username || '').trim();
  var pw = String(req.password || '');
  var nick = String(req.nickname || '').trim().slice(0, 30);
  if (!/^[A-Za-z0-9_]{4,20}$/.test(name)) return { ok: false, code: 'BAD_INPUT', message: '帳號需為 4～20 個英文字母、數字或底線。' };
  if (pw.length < 8) return { ok: false, code: 'BAD_INPUT', message: '密碼至少 8 個字元。' };
  if (!nick) return { ok: false, code: 'BAD_INPUT', message: '請填寫稱呼。' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var accKey = 'T0B_ACC_' + name.toLowerCase();
    if (props.getProperty(accKey)) return { ok: false, code: 'NAME_TAKEN', message: '這個帳號名稱已被使用，請換一個。' };
    var salt = Utilities.getUuid();
    var t0 = Date.now();
    var hash = hashPassword0B_(pw, salt);
    var hashMs = Date.now() - t0;
    props.setProperty(accKey, JSON.stringify({ name: name, nick: nick, salt: salt, hash: hash }));
    return { ok: true, hashMs: hashMs, hashIter: T0B_HASH_ITER };
  } finally {
    lock.releaseLock();
  }
}

function login0B_(req) {
  var name = String(req.username || '').trim();
  var pw = String(req.password || '');
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('T0B_ACC_' + name.toLowerCase());
  var t0 = Date.now();
  // 帳號不存在時也做一次雜湊，讓回應時間一致，避免從速度猜出帳號是否存在
  var acc = raw ? JSON.parse(raw) : { salt: 'dummy', hash: '' };
  var ok = hashPassword0B_(pw, acc.salt) === acc.hash && !!raw;
  var hashMs = Date.now() - t0;
  if (!ok) return { ok: false, code: 'BAD_LOGIN', message: '帳號或密碼錯誤。' };

  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var ttl = req.remember ? T0B_LONG_MS : T0B_SHORT_MS;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    props.setProperty('T0B_SES_' + sha256Hex0B_(token), JSON.stringify({ acc: acc.name.toLowerCase(), exp: Date.now() + ttl }));
  } finally {
    lock.releaseLock();
  }
  return { ok: true, token: token, expiresInMin: Math.round(ttl / 60000), hashMs: hashMs };
}

function me0B_(req) {
  var s = checkSession0B_(req.token);
  if (!s) return { ok: false, code: 'SESSION_EXPIRED', message: '登入已過期，請重新登入。' };
  return { ok: true, username: s.acc.name, nickname: s.acc.nick, expiresAt: new Date(s.exp).toISOString(), serverTime: new Date().toISOString() };
}

function logout0B_(req) {
  if (req.token) PropertiesService.getScriptProperties().deleteProperty('T0B_SES_' + sha256Hex0B_(String(req.token)));
  return { ok: true };
}

/** 依憑證找出帳號；過期或無效回傳 null（過期的憑證順便刪除） */
function checkSession0B_(token) {
  if (!token) return null;
  var props = PropertiesService.getScriptProperties();
  var sesKey = 'T0B_SES_' + sha256Hex0B_(String(token));
  var raw = props.getProperty(sesKey);
  if (!raw) return null;
  var ses = JSON.parse(raw);
  if (Date.now() > ses.exp) { props.deleteProperty(sesKey); return null; }
  var accRaw = props.getProperty('T0B_ACC_' + ses.acc);
  if (!accRaw) return null;
  return { acc: JSON.parse(accRaw), exp: ses.exp };
}

// ───────────── 雜湊工具 ─────────────

/** 加鹽、重複多次的 HMAC-SHA256（GAS 沒有 bcrypt／PBKDF2，以此替代） */
function hashPassword0B_(pw, salt) {
  var h = salt;
  for (var i = 0; i < T0B_HASH_ITER; i++) {
    h = bytesToHex0B_(Utilities.computeHmacSha256Signature(h + pw, salt));
  }
  return h;
}

function sha256Hex0B_(s) {
  return bytesToHex0B_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

function bytesToHex0B_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}
