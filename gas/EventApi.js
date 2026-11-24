// 活動報名與繳費紀錄、進程章與技能章圖片（SPEC 附錄第 50 點）
// 報名只收「姓名、身分別」與團長自訂題目的答案；不收電話、地址、生日等機敏資訊。
// 繳費只記錄金額與是否已繳，不經手金流。

// ───────────── 讀取 ─────────────

function parseJson_(v, fallback) { try { var o = JSON.parse(String(v || '')); return o === null || o === undefined ? fallback : o; } catch (e) { return fallback; } }

function loadEvents_() {
  return readRows_(SHEET.EVENTS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      id: Logic.clean(r[0]), title: Logic.clean(r[1]), desc: String(r[2] === undefined || r[2] === null ? '' : r[2]),
      date: dateStr_(r[3]), endDate: dateStr_(r[4]), regStart: Logic.clean(r[5]), regEnd: Logic.clean(r[6]),
      fee: Number(r[7]) || 0, questions: parseJson_(r[8], []), enabled: Logic.clean(r[9]) !== '關閉', sheetId: Logic.clean(r[12]), archived: !!Logic.clean(r[13]), targets: Logic.parseTargets(r[14]), _row: r._row, _raw: r
    };
  });
}

function loadRegs_() {
  return readRows_(SHEET.EVENT_REGS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      id: Logic.clean(r[0]), eventId: Logic.clean(r[1]), accountId: Logic.clean(r[2]), name: Logic.clean(r[3]), identity: Logic.clean(r[4]),
      answers: parseJson_(r[5], {}), amount: Number(r[6]) || 0, paid: Logic.clean(r[7]) === '是', at: ms_(r[8]), active: Logic.clean(r[9]) !== '取消', _row: r._row, _raw: r
    };
  });
}

/** 現在時間，格式和報名起訖一樣（'YYYY-MM-DDTHH:mm'，台灣時間），可以直接比字串 */
function nowStamp_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm"); }
function regState_(ev, now) { return !ev.enabled ? '已關閉' : now < ev.regStart ? '尚未開始' : now > ev.regEnd ? '已截止' : '報名中'; }

/** 給報名的人看的活動資料（白名單） */
function eventView_(ev, now) {
  return { id: ev.id, title: ev.title, desc: ev.desc, date: ev.date, endDate: ev.endDate, regStart: ev.regStart, regEnd: ev.regEnd, fee: ev.fee, targets: ev.targets.slice(), state: regState_(ev, now) };
}

/** 公開（月曆與活動頁用）：啟用中、還沒結束的活動；不含題目與任何報名資料 */
function publicEvents_() {
  var now = nowStamp_(), from = now.slice(0, 8) + '01';
  return loadEvents_().filter(function (e) { return e.enabled && (e.endDate || e.date) >= from; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 50).map(function (e) { return eventView_(e, now); });
}

// ───────────── 報名（要登入；家長、服務員、團長都可以） ─────────────

/**
 * 這個帳號屬於哪些分團（活動報名資格用，附錄第 73 點⑮）：
 * 擔任團長、服務員的分團（admin、總團＝全部），以及綁定「在團／體驗中」孩子所在的分團。
 */
function accountSections_(who) {
  var set = {};
  (who.sections || []).forEach(function (x) { set[x.section] = true; });
  var active = {};
  loadCubs_().forEach(function (c) { if (c.status === '在團' || c.status === Logic.TRIAL) active[c.cubId] = c.section; });
  loadBindings_().forEach(function (b) { if (b.accountId === who.account.accountId && active[b.cubId]) set[active[b.cubId]] = true; });
  return Object.keys(set);
}
/** 可以報名的人：團長、服務員，或有綁定「在團／體驗中」孩子的帳號（SPEC 附錄第 52 點）；有指定 ev 時還要在活動開放的分團 */
function canRegisterEvents_(who, ev, secs) {
  secs = secs || accountSections_(who);
  if (!secs.length) return false;
  if (!ev) return true;
  return secs.some(function (sec) { return Logic.targetsInclude(ev.targets, sec); });
}
var EVENT_NOT_ELIGIBLE = '活動報名只開放 22 團的家長、團長與服務員。如果你是 22 團的家長，請等團長審核通過後再報名。';

function apiEventList_(req, who) {
  var now = nowStamp_(), today = now.slice(0, 10), secs = accountSections_(who), eligible = canRegisterEvents_(who, null, secs);
  // 有身分的人只看開放給自己分團的活動；還沒有任何分團的人照舊看全部（但不能報名）
  var events = loadEvents_().filter(function (e) { return e.enabled && (e.endDate || e.date) >= today && (!eligible || canRegisterEvents_(who, e, secs)); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var mine = loadRegs_().filter(function (r) { return r.accountId === who.account.accountId && r.active; });
  return {
    identities: Logic.EVENT_IDENTITIES, eligible: eligible, notice: eligible ? '' : EVENT_NOT_ELIGIBLE,
    events: events.map(function (e) {
      var v = eventView_(e, now);
      if (eligible) v.questions = e.questions;
      v.mine = mine.filter(function (r) { return r.eventId === e.id; }).map(function (r) { return { regId: r.id, name: r.name, identity: r.identity, answers: r.answers, amount: r.amount, paid: r.paid }; });
      return v;
    })
  };
}
AUTHED_ACTIONS.eventList = apiEventList_;

function apiEventRegister_(req, who) {
  // 先看是不是 22 團的人（訊息照舊），再看總團有沒有開放這個身分線上報名（權限設定 parent_events）
  if (!canRegisterEvents_(who)) throw new ApiError(ERR.FORBIDDEN, EVENT_NOT_ELIGIBLE);
  var myBinds = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
  var isPar = myBinds.some(function (b) { return b.relation !== Logic.RELATION.SELF; });
  var isSelf = !who.admin && myBinds.length > 0 && !isPar;
  var firstCub = myBinds[0] ? loadCubs_().filter(function (c) { return c.cubId === myBinds[0].cubId; })[0] : null;
  if (!resolveWhoPerms_(who, isPar, isSelf, firstCub ? firstCub.section : '').tabs.parent_events) {
    throw new ApiError(ERR.FORBIDDEN, '目前此身分或分團未開放線上活動報名。');
  }
  return afterSync_(withLock_(function () {
    if (!canRegisterEvents_(who)) throw new ApiError(ERR.FORBIDDEN, EVENT_NOT_ELIGIBLE);
    var ev = loadEvents_().filter(function (e) { return e.id === Logic.clean(req.eventId); })[0];
    if (!ev || !ev.enabled) throw new ApiError(ERR.NOT_FOUND, '找不到這個活動。');
    if (!canRegisterEvents_(who, ev)) throw new ApiError(ERR.FORBIDDEN, '這個活動只開放給' + ev.targets.join('、') + '報名。');
    var st = regState_(ev, nowStamp_());
    if (st !== '報名中') throw new ApiError(ERR.BAD_INPUT, '這個活動' + (st === '尚未開始' ? '還沒開始報名。' : '已經截止報名，請聯絡團長。'));
    var v = Logic.validateEventPeople(req.people, ev.questions);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    var regs = loadRegs_();
    var mine = regs.filter(function (r) { return r.eventId === ev.id && r.accountId === who.account.accountId && r.active; });
    if (mine.length + v.people.length > Logic.EVENT_MAX_PER_ACCOUNT) throw new ApiError(ERR.BAD_INPUT, '同一個帳號每個活動最多報名 ' + Logic.EVENT_MAX_PER_ACCOUNT + ' 位。');
    var dup = v.people.filter(function (p) { return mine.some(function (r) { return r.name === p.name; }); })[0];
    if (dup) throw new ApiError(ERR.BAD_INPUT, '「' + dup.name + '」已經報名過了。');
    var ids = regs.map(function (r) { return r.id; }), now = new Date();
    appendRows_(SHEET.EVENT_REGS, v.people.map(function (p) {
      var id = newId_('R', ids); ids.push(id);
      return [id, ev.id, who.account.accountId, p.name, p.identity, JSON.stringify(p.answers), ev.fee, '否', now, '有效', '', ''];
    }));
    logOp_(who.account.accountId, '活動報名', ev.id, '', v.people.length + ' 位');
    return { added: v.people.length, _ev: ev.id };
  }));
}
AUTHED_ACTIONS.eventRegister = apiEventRegister_;

/** 自己取消報名：只能在報名期間內、且還沒登記繳費 */
function apiEventCancel_(req, who) {
  return afterSync_(withLock_(function () {
    var r = loadRegs_().filter(function (x) { return x.id === Logic.clean(req.regId) && x.accountId === who.account.accountId && x.active; })[0];
    if (!r) throw new ApiError(ERR.NOT_FOUND, '找不到這筆報名。');
    var ev = loadEvents_().filter(function (e) { return e.id === r.eventId; })[0];
    if (!ev || regState_(ev, nowStamp_()) !== '報名中') throw new ApiError(ERR.BAD_INPUT, '報名已經截止，要取消請聯絡團長。');
    if (r.paid) throw new ApiError(ERR.BAD_INPUT, '這筆報名已經登記繳費，要取消請聯絡團長。');
    var row = r._raw.slice(0, HEADERS[SHEET.EVENT_REGS].length);
    row[9] = '取消'; row[10] = who.account.accountId; row[11] = new Date();
    updateRows_(SHEET.EVENT_REGS, [{ row: r._row, values: row }]);
    logOp_(who.account.accountId, '取消活動報名', r.eventId, '', '');
    return { _ev: r.eventId };
  }));
}
AUTHED_ACTIONS.eventCancel = apiEventCancel_;

// ───────────── 後台：活動設定、報名名單、繳費紀錄（團長） ─────────────

/**
 * 活動對象（附錄第 73 點⑮，團長 2026-11-19 決定）：「全團」或一個以上的分團。
 * 全團活動只有管理員或總團能開、能改；分團活動由對象裡任一分團的團長管理。
 */
function canManageEvent_(who, ev) {
  if (canManageAll_(who)) return true;
  return ev.targets.indexOf(Logic.ALL) < 0 && ev.targets.indexOf(curSec_()) >= 0;
}
function findManagedEvent_(who, eventId) {
  var ev = loadEvents_().filter(function (e) { return e.id === Logic.clean(eventId); })[0];
  if (!ev || !Logic.targetsInclude(ev.targets, curSec_())) throw new ApiError(ERR.NOT_FOUND, '找不到這個活動。');
  if (!canManageEvent_(who, ev)) throw new ApiError(ERR.FORBIDDEN, '全團活動由管理員或總團管理。');
  return ev;
}
/** 送來的活動對象 → 存進試算表的字串（「全團」或「童軍、行義」） */
function eventTargets_(who, v) {
  if (v === undefined || v === null) return curSec_();
  var list = (Array.isArray(v) ? v : [v]).map(Logic.clean).filter(String);
  if (list.indexOf(Logic.ALL) >= 0) {
    if (!canManageAll_(who)) throw new ApiError(ERR.FORBIDDEN, '全團活動由管理員或總團開設。');
    return Logic.ALL;
  }
  var out = Logic.SECTIONS.filter(function (s) { return list.indexOf(s) >= 0; });
  if (!out.length || out.length !== list.length) throw new ApiError(ERR.BAD_INPUT, '請選擇活動開放的分團。');
  if (out.indexOf(curSec_()) < 0 && !canManageAll_(who)) throw new ApiError(ERR.BAD_INPUT, '活動對象要包含你自己的分團（' + curSec_() + '）。');
  return out.join('、');
}

registerAdmin_('eventAdminList', 'manageEvents', function (req, who) {
  var now = nowStamp_(), regs = loadRegs_().filter(function (r) { return r.active; });
  return {
    identities: Logic.EVENT_IDENTITIES, section: curSec_(), sections: Logic.SECTIONS, canManageAll: canManageAll_(who),
    events: loadEvents_().filter(function (e) { return Logic.targetsInclude(e.targets, curSec_()); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (e) {
      var mine = regs.filter(function (r) { return r.eventId === e.id; });
      var v = eventView_(e, now);
      v.questions = e.questions; v.enabled = e.enabled; v.archived = e.archived; v.canEdit = canManageEvent_(who, e);
      v.count = mine.length; v.paidCount = mine.filter(function (r) { return r.paid; }).length;
      return v;
    })
  };
});

registerAdmin_('eventSave', 'manageEvents', function (req, who) {
  var v = Logic.validateEvent(req);
  if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
  var e = v.event;
  return afterSync_(withLock_(function () {
    var list = loadEvents_();
    var cells = [e.title, e.desc, e.date, e.endDate, e.regStart, e.regEnd, e.fee, JSON.stringify(e.questions), req.enabled === false ? '關閉' : '開放'];
    if (req.id) {
      var cur = findManagedEvent_(who, req.id);
      if (cur.archived) throw new ApiError(ERR.BAD_INPUT, '這個活動已經結束並封存，不能再修改；資料請看存檔試算表。');
      var row = cur._raw.slice(0, HEADERS[SHEET.EVENTS].length);
      while (row.length < HEADERS[SHEET.EVENTS].length) row.push('');
      cells.forEach(function (c, i) { row[i + 1] = c; });
      if (req.targets !== undefined) row[14] = eventTargets_(who, req.targets);
      updateRows_(SHEET.EVENTS, [{ row: cur._row, values: row }]);
      logOp_(who.account.accountId, '修改活動', cur.id, cur.title, e.title + (req.enabled === false ? '（關閉）' : ''));
      return { id: cur.id, _ev: cur.id };
    }
    var id = newId_('E', list.map(function (x) { return x.id; }));
    appendRows_(SHEET.EVENTS, [[id].concat(cells, [who.account.accountId, new Date(), '', '', eventTargets_(who, req.targets)])]);
    logOp_(who.account.accountId, '新增活動', id, '', e.title);
    return { id: id, _ev: id };
  }));
});

registerAdmin_('eventRegs', 'manageEvents', function (req, who) {
  var ev = findManagedEvent_(who, req.eventId);
  var acc = accountsById_();
  var v = eventView_(ev, nowStamp_());
  v.questions = ev.questions; v.enabled = ev.enabled; v.archived = ev.archived;
  return {
    event: v, sheetUrl: ev.sheetId ? EVENT_SHEET_URL + ev.sheetId : '',
    regs: loadRegs_().filter(function (r) { return r.eventId === ev.id && r.active; }).sort(function (a, b) { return a.at - b.at; }).map(function (r) {
      return { regId: r.id, name: r.name, identity: r.identity, answers: r.answers, amount: r.amount, paid: r.paid, at: r.at, by: (acc[r.accountId] || {}).nickname || '（帳號已刪除）' };
    })
  };
});

/** 登記繳費：只記錄金額與是否已繳。updates = [{ regId, amount, paid }] */
registerAdmin_('eventPay', 'manageEvents', function (req, who) {
  var updates = Array.isArray(req.updates) ? req.updates : [];
  if (!updates.length || updates.length > 300) throw new ApiError(ERR.BAD_INPUT, '沒有要儲存的變更。');
  return afterSync_(withLock_(function () {
    var regs = loadRegs_(), ups = [], now = new Date();
    var first = regs.filter(function (x) { return x.id === Logic.clean(updates[0].regId) && x.active; })[0];
    if (!first) throw new ApiError(ERR.NOT_FOUND, '找不到其中一筆報名，請重新整理。');
    findManagedEvent_(who, first.eventId);
    updates.forEach(function (u) {
      var r = regs.filter(function (x) { return x.id === Logic.clean(u.regId) && x.active && x.eventId === first.eventId; })[0];
      if (!r) throw new ApiError(ERR.NOT_FOUND, '找不到其中一筆報名，請重新整理。');
      var amount = Number(u.amount);
      if (!isFinite(amount) || amount < 0 || amount > 1000000 || Math.floor(amount) !== amount) throw new ApiError(ERR.BAD_INPUT, r.name + '：金額需為 0～1000000 的整數。');
      var row = r._raw.slice(0, HEADERS[SHEET.EVENT_REGS].length);
      row[6] = amount; row[7] = u.paid ? '是' : '否'; row[10] = who.account.accountId; row[11] = now;
      ups.push({ row: r._row, values: row });
    });
    updateRows_(SHEET.EVENT_REGS, ups);
    logOp_(who.account.accountId, '登記活動繳費', first.eventId, '', ups.length + ' 筆');
    return { changed: ups.length, _ev: first.eventId };
  }));
});

/** 團長取消一筆報名（保留紀錄，狀態改為取消） */
registerAdmin_('eventRegRemove', 'manageEvents', function (req, who) {
  return afterSync_(withLock_(function () {
    var r = loadRegs_().filter(function (x) { return x.id === Logic.clean(req.regId) && x.active; })[0];
    if (!r) throw new ApiError(ERR.NOT_FOUND, '找不到這筆報名。');
    findManagedEvent_(who, r.eventId);
    var row = r._raw.slice(0, HEADERS[SHEET.EVENT_REGS].length);
    row[9] = '取消'; row[10] = who.account.accountId; row[11] = new Date();
    updateRows_(SHEET.EVENT_REGS, [{ row: r._row, values: row }]);
    logOp_(who.account.accountId, '取消活動報名', r.eventId, '', '');
    return { _ev: r.eventId };
  }));
});

// ───────────── 每個活動一份獨立的存檔試算表（SPEC 附錄第 51 點） ─────────────
// 另開一個 Google 試算表檔案（只有擁有者＝團長看得到），每次報名、取消、登記繳費後整份重寫。
// 主系統的「活動」「活動報名」分頁才是資料來源；存檔失敗不影響報名。

var EVENT_FOLDER_NAME = '幼童軍活動報名存檔';
var EVENT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/';

function eventFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('EVENT_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 資料夾被刪掉了，重建 */ } }
  var folder = DriveApp.createFolder(EVENT_FOLDER_NAME);
  props.setProperty('EVENT_FOLDER_ID', folder.getId());
  return folder;
}

/** 寫進另一份試算表的文字：等號等開頭的內容前面加單引號，避免被當成公式 */
function safeCell_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }

function writeSheet_(book, name, rows) {
  var sh = book.getSheetByName(name) || book.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows.map(function (r) { return r.map(safeCell_); }));
  sh.setFrozenRows(1);
}

/** 建立（第一次）或更新這個活動的存檔試算表，回傳網址。inLock=true 時表示呼叫端已持有 script lock */
function syncEventSheet_(eventId, inLock) {
  var ensureBook = function () {
    DB_CACHE_ = {};
    var ev = loadEvents_().filter(function (e) { return e.id === eventId; })[0];
    if (!ev) throw new ApiError(ERR.NOT_FOUND, '找不到這個活動。');
    if (ev.archived) throw new ApiError(ERR.BAD_INPUT, '這個活動已經封存，存檔試算表不會再更新。');
    var book = null;
    if (ev.sheetId) { try { book = SpreadsheetApp.openById(ev.sheetId); } catch (e) { book = null; } }
    if (!book) {
      book = SpreadsheetApp.create('活動報名｜' + ev.title + '｜' + ev.date);
      try { DriveApp.getFileById(book.getId()).moveTo(eventFolder_()); } catch (e) { /* 搬不進資料夾就留在雲端硬碟根目錄 */ }
      var first = book.getSheets()[0];
      if (first && first.getName() !== '報名名單') first.setName('報名名單');
      var row = HEADERS[SHEET.EVENTS].map(function (h, j) { return ev._raw[j] === undefined ? '' : ev._raw[j]; });
      row[12] = book.getId();
      updateRows_(SHEET.EVENTS, [{ row: ev._row, values: row }]);
    }
    return { ev: ev, book: book };
  };
  // [修補] 建立存檔試算表並回寫 sheetId 時加上鎖保護，避免兩人同時報名建出重複試算表
  var pair = inLock ? ensureBook() : withLock_(ensureBook);
  var ev = pair.ev, book = pair.book;
  var acc = accountsById_(), now = new Date();
  var fmt = function (t) { return t ? Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd HH:mm') : ''; };
  var regs = loadRegs_().filter(function (r) { return r.eventId === ev.id; }).sort(function (a, b) { return a.at - b.at; });
  var head = ['姓名', '身分別'].concat(ev.questions.map(function (q) { return q.label; }), ['報名人', '應繳金額', '已繳', '報名時間', '狀態', '最後更新']);
  var rows = [head].concat(regs.map(function (r) {
    return [r.name, r.identity].concat(ev.questions.map(function (q) { return r.answers[q.id] || ''; }),
      [(acc[r.accountId] || {}).nickname || '（帳號已刪除）', r.amount, r.paid ? '是' : '否', fmt(r.at), r.active ? '有效' : '取消', fmt(ms_(r._raw[11]) || r.at)]);
  }));
  writeSheet_(book, '報名名單', rows);
  var act = regs.filter(function (r) { return r.active; });
  writeSheet_(book, '活動資訊', [['項目', '內容'], ['活動名稱', ev.title], ['活動日期', ev.date + (ev.endDate && ev.endDate !== ev.date ? '～' + ev.endDate : '')],
    ['開始報名', ev.regStart.replace('T', ' ')], ['結束報名', ev.regEnd.replace('T', ' ')], ['每人費用', ev.fee], ['狀態', ev.enabled ? '開放' : '關閉'],
    ['報名人數', act.length], ['已繳人數', act.filter(function (r) { return r.paid; }).length],
    ['應收金額', act.reduce(function (a, r) { return a + r.amount; }, 0)], ['已收金額', act.filter(function (r) { return r.paid; }).reduce(function (a, r) { return a + r.amount; }, 0)],
    ['說明', ev.desc], ['最後同步', fmt(now.getTime())], ['注意', '這份是自動產生的存檔，請不要直接在這裡修改；要改請到網站後台，這裡會自動更新。']]);
  return EVENT_SHEET_URL + book.getId();
}

/** 動作成功後更新存檔試算表；失敗只記錄，不影響主要操作。res._ev 是活動ID，不回傳給前端 */
function afterSync_(res) {
  var id = res && res._ev;
  if (res) delete res._ev;
  if (id) { try { syncEventSheet_(id, false); } catch (e) { console.error('活動存檔試算表更新失敗：' + (e && e.message)); } }
  return res;
}

/** 團長手動同步（或補建）存檔試算表 */
registerAdmin_('eventSheetSync', 'manageEvents', function (req, who) {
  var id = findManagedEvent_(who, req.eventId).id;
  try { return { sheetUrl: syncEventSheet_(id, false) }; }
  catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(ERR.BAD_INPUT, '存檔試算表建立或更新失敗，請稍後再試一次。'); }
});

/**
 * 活動結束後（結束日的隔天起）清除網站上的報名資料；存檔試算表保留，由團長自己封存（SPEC 附錄第 52 點）。
 * 先做最後一次同步，同步成功才清除並標記封存；同步失敗就留到下次再試，避免資料不見。每日排程呼叫。
 */
function purgeEndedEvents_() {
  var today = today_(), done = 0;
  var ended = loadEvents_().filter(function (e) { return !e.archived && Logic.isDateStr(e.endDate || e.date) && (e.endDate || e.date) < today; });
  ended.forEach(function (e0) {
    try {
      withLock_(function () {
        syncEventSheet_(e0.id, true);
        DB_CACHE_ = {};
        var ev = loadEvents_().filter(function (x) { return x.id === e0.id; })[0];
        if (!ev || !ev.sheetId) return;
        var rows = loadRegs_().filter(function (r) { return r.eventId === ev.id; }).map(function (r) { return r._row; });
        if (rows.length) deleteRows_(SHEET.EVENT_REGS, rows);
        var row = HEADERS[SHEET.EVENTS].map(function (h, j) { return ev._raw[j] === undefined ? '' : ev._raw[j]; });
        row[13] = new Date();
        updateRows_(SHEET.EVENTS, [{ row: ev._row, values: row }]);
        logOp_('每日排程', '活動封存', ev.id, rows.length + ' 筆報名', '已移到存檔試算表');
        done++;
      });
    } catch (err) { console.error('活動封存失敗（明天再試）：' + (err && err.message)); }
  });
  return done;
}

/**
 * [修補] 刪除帳號時一併刪除該帳號送出的報名（報名含姓名，屬個資），並回傳受影響的活動ID清單，
 * 讓呼叫端在釋放鎖之後再同步存檔試算表。
 */
function deleteRegsOfAccount_(accountId) {
  var mine = loadRegs_().filter(function (r) { return r.accountId === accountId; });
  if (!mine.length) return [];
  deleteRows_(SHEET.EVENT_REGS, mine.map(function (r) { return r._row; }));
  var seen = {}, evIds = [];
  mine.forEach(function (r) { if (!seen[r.eventId]) { seen[r.eventId] = true; evIds.push(r.eventId); } });
  return evIds;
}

// ───────────── 進程章與技能章的圖片（團長上傳，公開顯示） ─────────────

function loadUnitImages_() {
  var map = {};
  readRows_(SHEET.UNIT_IMAGES).forEach(function (r) {
    var k = Logic.clean(r[1]) + '|' + Logic.clean(r[0]);
    if (Logic.clean(r[0]) && Logic.isUnitImage(String(r[2] || ''))) map[k] = { image: String(r[2]), _row: r._row };
  });
  return map;
}

/** 公開：{ '進程|狼': 'data:image/…', … }，只含還存在的級別與章 */
function apiUnitImages_() {
  var units = loadUnits_(), imgs = loadUnitImages_(), out = {};
  Object.keys(imgs).forEach(function (k) { if (units[k]) out[k] = imgs[k].image; });
  return { images: out };
}
PUBLIC_ACTIONS.unitImages = apiUnitImages_;

/** image 是前端縮小後的 data URL；空字串＝移除圖片 */
registerAdmin_('unitImageSave', 'manageItems', function (req, who) {
  var category = Logic.clean(req.category), unit = Logic.clean(req.unit), image = String(req.image || '');
  if (image && !Logic.isUnitImage(image)) throw new ApiError(ERR.BAD_INPUT, '圖片格式不正確或檔案太大，請換一張圖再試。');
  return withLock_(function () {
    var key = category + '|' + unit;
    if (!loadUnits_()[key]) throw new ApiError(ERR.NOT_FOUND, '找不到這個級別或技能章。');
    var cur = loadUnitImages_()[key];
    if (!image) { if (cur) deleteRows_(SHEET.UNIT_IMAGES, [cur._row]); }
    else if (cur) updateRows_(SHEET.UNIT_IMAGES, [{ row: cur._row, values: [unit, category, image, who.account.accountId, new Date()] }]);
    else appendRows_(SHEET.UNIT_IMAGES, [[unit, category, image, who.account.accountId, new Date()]]);
    logOp_(who.account.accountId, image ? '上傳章的圖片' : '移除章的圖片', key, '', '');
    return {};
  });
});
