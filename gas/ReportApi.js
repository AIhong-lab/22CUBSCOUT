// 家長回報進程、集會預排項目（SPEC 附錄第 83 點）
// 家長回報：寫入「完成紀錄」但回報狀態為「待確認」（不算完成），服務員確認後才算；不收照片，只有一句說明。
// 集會預排：行事曆的集會先勾這次要做的項目，簽核時自動帶出，家長在「接下來的集會」看得到。

var REPORT_PENDING = '待確認', REPORT_OK = '已確認';
var REPORT_MAX_PER_CUB = 30;

/** 家長可不可以回報（設定「開放家長回報進程」，預設是） */
function reportEnabled_() { return loadSettings_().values['開放家長回報進程'] !== false; }

/** 某位團員「待確認」的回報：{ 項目ID: 完成紀錄 }；已經被簽核（算完成）的不列 */
function pendingReportsOf_(cubId, comps) {
  comps = comps || loadCompletions_();
  var done = {}, out = {};
  comps.forEach(function (c) { if (c.cubId === cubId && Logic.isCountedCompletion(c)) done[c.itemId] = true; });
  comps.forEach(function (c) { if (c.cubId === cubId && c.reportStatus === REPORT_PENDING && !done[c.itemId]) out[c.itemId] = c; });
  return out;
}

/** 家長端共用檢查：綁定、同意、家長權限（未成年的本人帳號不能回報）、分團有進程 */
function reportBinding_(who, cubId) {
  var binding = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === cubId; })[0];
  var cub = binding && loadCubs_().filter(function (c) { return c.cubId === cubId; })[0];
  if (!binding || !cub) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼的資料。');
  if (bindingNeedsConsent_(binding, cub.section)) throw new ApiError(ERR.NEED_CONSENT, '個資告知內容已更新，請先閱讀並同意。');
  if (isMinorSelf_(binding, cub.section)) throw new ApiError(ERR.FORBIDDEN, '回報要由家長的帳號操作。');
  if (!resolveWhoPerms_(who, true, false, cub.section).tabs.member_progress) throw new ApiError(ERR.FORBIDDEN, '目前此身分或分團未開放進程功能。');
  if (Logic.PROGRESS_SECTIONS.indexOf(cub.section) < 0) throw new ApiError(ERR.BAD_INPUT, '這個分團還沒有進程。');
  if (cub.status !== '在團') throw new ApiError(ERR.BAD_INPUT, '在團的團員才能回報。');
  return cub;
}

/** 家長回報：{ cubId, itemIds:[…], note }。已完成或已回報的略過 */
function apiItemReport_(req, who) {
  return withLock_(function () {
    if (!reportEnabled_()) throw new ApiError(ERR.FORBIDDEN, '目前沒有開放家長回報，請在團集會時請服務員簽核。');
    var cub = reportBinding_(who, Logic.clean(req.cubId));
    var ids = (Array.isArray(req.itemIds) ? req.itemIds : []).map(Logic.clean).filter(String);
    if (!ids.length || ids.length > 20) throw new ApiError(ERR.BAD_INPUT, '請選擇要回報的項目（一次最多 20 項）。');
    var note = Logic.clean(req.note).slice(0, 60);
    var okItem = {};
    sectionItems_(cub.section).forEach(function (i) { if (i.enabled) okItem[i.id] = true; });
    var comps = loadCompletions_(), done = {};
    comps.forEach(function (c) { if (c.cubId === cub.cubId && (Logic.isCountedCompletion(c) || c.reportStatus === REPORT_PENDING)) done[c.itemId] = true; });
    var pendingCount = Object.keys(pendingReportsOf_(cub.cubId, comps)).length;
    var add = [], seen = {};
    ids.forEach(function (id) {
      if (!okItem[id]) throw new ApiError(ERR.BAD_INPUT, '有項目不存在或已停用，請重新整理。');
      if (done[id] || seen[id]) return;
      seen[id] = true;
      add.push([cub.cubId, id, today_(), '', note, who.account.accountId, REPORT_PENDING]);
    });
    if (pendingCount + add.length > REPORT_MAX_PER_CUB) throw new ApiError(ERR.BAD_INPUT, '等待確認的回報太多了，請等服務員確認後再回報。');
    if (add.length) {
      appendRows_(SHEET.COMPLETIONS, add);
      logOp_(who.account.accountId, '家長回報', cub.cubId, '', add.length + ' 項');
    }
    return { added: add.length };
  });
}
AUTHED_ACTIONS.itemReport = apiItemReport_;

/** 家長取消自己還沒被確認的回報（只刪「待確認」那一列，不動已完成的紀錄） */
function apiItemReportCancel_(req, who) {
  return withLock_(function () {
    var cub = reportBinding_(who, Logic.clean(req.cubId));
    var c = pendingReportsOf_(cub.cubId)[Logic.clean(req.itemId)];
    if (!c || c.reporter !== who.account.accountId) throw new ApiError(ERR.NOT_FOUND, '找不到這筆回報，可能已經確認了。');
    deleteRows_(SHEET.COMPLETIONS, [c._row]);
    logOp_(who.account.accountId, '家長取消回報', cub.cubId, c.itemId, '');
    return { removed: 1 };
  });
}
AUTHED_ACTIONS.itemReportCancel = apiItemReportCancel_;

/** 後台：目前分團等待確認的回報 */
function pendingReports_() {
  var cubs = {}, items = {};
  secCubs_().forEach(function (c) { cubs[c.cubId] = c; });
  sectionItems_(curSec_()).forEach(function (i) { items[i.id] = i; });
  var comps = loadCompletions_(), done = {};
  comps.forEach(function (c) { if (Logic.isCountedCompletion(c)) done[c.cubId + '|' + c.itemId] = true; });
  return comps.filter(function (c) { return c.reportStatus === REPORT_PENDING && cubs[c.cubId] && items[c.itemId] && !done[c.cubId + '|' + c.itemId]; })
    .map(function (c) { return { c: c, cub: cubs[c.cubId], item: items[c.itemId] }; });
}

registerAdmin_('reportList', 'signoff', function () {
  var acc = accountsById_();
  return {
    enabled: reportEnabled_(),
    reports: pendingReports_().map(function (x) {
      return { cubId: x.cub.cubId, name: x.cub.name, squad: x.cub.squad, itemId: x.item.id, category: x.item.category, unit: x.item.unit, text: x.item.text,
        date: x.c.date, note: x.c.note, by: (acc[x.c.reporter] || {}).nickname || '（帳號已刪除）' };
    }).sort(function (a, b) { return a.name === b.name ? (a.date < b.date ? -1 : 1) : (a.name < b.name ? -1 : 1); })
  };
});

/** 確認或退回：entries = [{ cubId, itemId }]；ok=true 確認（簽核人記確認的人），false 退回（刪掉那筆待確認） */
registerAdmin_('reportReview', 'signoff', function (req, who) {
  var entries = Array.isArray(req.entries) ? req.entries.slice(0, 200) : [];
  if (!entries.length) throw new ApiError(ERR.BAD_INPUT, '請先勾選要處理的回報。');
  var ok = req.ok !== false;
  return withLock_(function () {
    var map = {};
    pendingReports_().forEach(function (x) { map[x.c.cubId + '|' + x.c.itemId] = x; });
    var hit = [], seen = {};
    entries.forEach(function (e) {
      var k = Logic.clean(e && e.cubId) + '|' + Logic.clean(e && e.itemId);
      if (map[k] && !seen[k]) { seen[k] = true; hit.push(map[k]); }
    });
    if (!hit.length) throw new ApiError(ERR.NOT_FOUND, '這些回報已經處理過了，請重新整理。');
    if (ok) {
      updateRows_(SHEET.COMPLETIONS, hit.map(function (x) {
        return { row: x.c._row, values: [x.c.cubId, x.c.itemId, x.c.date, who.account.accountId, x.c.note ? '家長回報：' + x.c.note : '家長回報', x.c.reporter, REPORT_OK] };
      }));
    } else {
      deleteRows_(SHEET.COMPLETIONS, hit.map(function (x) { return x.c._row; }));
    }
    logOp_(who.account.accountId, ok ? '確認家長回報' : '退回家長回報', hit.length + ' 筆', '', hit.slice(0, 20).map(function (x) { return x.cub.cubId + ' ' + x.item.id; }).join('、'));
    return { changed: hit.length };
  });
});

// ───────────── 集會預排項目 ─────────────

/** 集會的預排項目裡，屬於某分團（進程模組）而且還啟用的項目 */
function meetingPlanItems_(m, section) {
  var ids = Array.isArray(m.plan) ? m.plan : [];
  if (!ids.length) return [];
  var by = {};
  sectionItems_(section).forEach(function (i) { if (i.enabled) by[i.id] = i; });
  return ids.filter(function (id) { return by[id]; }).map(function (id) { return by[id]; });
}

/** 儲存預排：{ meetingId, itemIds:[…] }。只換掉目前分團的部分，其他分團排的留著（全團集會各排各的） */
registerAdmin_('meetingPlanSave', 'signoff', function (req, who) {
  var want = (Array.isArray(req.itemIds) ? req.itemIds : []).map(Logic.clean).filter(String);
  if (want.length > 40) throw new ApiError(ERR.BAD_INPUT, '一場集會最多預排 40 個項目。');
  return withLock_(function () {
    var m = findMeeting_(req.meetingId);
    var mine = {};
    sectionItems_(curSec_()).forEach(function (i) { if (i.enabled) mine[i.id] = true; });
    var seen = {}, ids = [];
    want.forEach(function (id) {
      if (!mine[id]) throw new ApiError(ERR.BAD_INPUT, '有項目不存在或已停用，請重新整理。');
      if (!seen[id]) { seen[id] = true; ids.push(id); }
    });
    var keep = (Array.isArray(m.plan) ? m.plan : []).filter(function (id) { return !mine[id]; });
    var raw = readRows_(SHEET.MEETINGS).filter(function (r) { return r._row === m._row; })[0];
    var row = raw.slice(0, HEADERS[SHEET.MEETINGS].length);
    while (row.length < HEADERS[SHEET.MEETINGS].length) row.push('');
    var all = keep.concat(ids);
    row[10] = all.length ? JSON.stringify(all) : '';
    updateRows_(SHEET.MEETINGS, [{ row: m._row, values: row }]);
    logOp_(who.account.accountId, '集會預排項目', m.meetingId, '', m.date + ' ' + ids.length + ' 項');
    return { count: ids.length };
  });
});
