/**
 * 續團確認與三項登記（SPEC 附錄第 69、70、80 點）
 * - 三項登記＝團登記、服務員登記、童軍登記，每年向童軍會辦一次，登記年度採曆年制。
 * - 只記「續團、已登記、應繳、已繳」；身分證字號、生日、電話、地址等仍在總會系統或紙本處理，系統不收集。
 * - 續團確認：各分團團長年底勾選自己分團的團員與服務員要不要續團（只看目前分團）。
 * - 三項登記：總團與最高管理員（沒有最高管理員時團長）設定年度登記費、勾選已登記與已繳、匯出名單；其他人看不到。
 * 每年度每人一列：類型 童軍（對象ID＝團員ID）／服務員（對象ID＝帳號ID）／團（對象ID＝分團名稱）。
 */

var REGIS_TYPES = { SCOUT: '童軍', STAFF: '服務員', TROOP: '團' };

/** 登記年度：九月以後預設是下一年（年底辦理下一年度的登記） */
function defaultRegisYear_() {
  var t = today_();
  var y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return m >= 9 ? y + 1 : y;
}
function regisYear_(v) {
  var y = Number(Logic.clean(v));
  if (!y) return defaultRegisYear_();
  if (!/^\d{4}$/.test(String(y)) || y < 2020 || y > 2100) throw new ApiError(ERR.BAD_INPUT, '請填寫正確的年度（西元年，例如 2027）。');
  return y;
}

function loadRegis_() {
  if (!ss_().getSheetByName(SHEET.REGIS)) return [];
  return readRows_(SHEET.REGIS).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[2]); }).map(function (r) {
    return {
      year: Number(r[0]) || 0, type: Logic.clean(r[1]), id: Logic.clean(r[2]), section: Logic.clean(r[3]),
      renew: Logic.clean(r[4]), registered: Logic.clean(r[5]) === '是', amount: Logic.clean(r[6]) === '' ? null : Number(r[6]) || 0,
      paid: Logic.clean(r[7]) === '是', note: Logic.clean(r[8]), _row: r._row, _raw: r
    };
  });
}
function loadFees_(year) {
  if (!ss_().getSheetByName(SHEET.REGIS_FEES)) return null;
  var r = readRows_(SHEET.REGIS_FEES).filter(function (x) { return Number(x[0]) === year; })[0];
  return r ? { scout: Number(r[1]) || 0, staff: Number(r[2]) || 0, troop: Number(r[3]) || 0, note: Logic.clean(r[4]), _row: r._row } : null;
}
function feeOf_(fees, type) {
  if (!fees) return 0;
  return type === REGIS_TYPES.SCOUT ? fees.scout : type === REGIS_TYPES.STAFF ? fees.staff : fees.troop;
}
function regisKey_(type, id) { return type + '|' + id; }

/** 某分團要確認續團的人：在團的團員＋該分團的團長、服務員（總團不在分團名單裡） */
function renewPeople_(section) {
  var sec = Logic.sectionOf(section), acc = accountsById_();
  var cubs = loadCubs_().filter(function (c) { return c.section === sec && c.status === '在團'; }).map(function (c) {
    return { type: REGIS_TYPES.SCOUT, id: c.cubId, name: c.name, squad: c.squad, section: sec };
  });
  var seen = {};
  var staff = loadAdminRows_().filter(function (r) { return r.role !== Logic.CENTRAL && r.section === sec; }).filter(function (r) {
    var a = acc[r.accountId];
    if (!a || a.status !== '啟用' || seen[r.accountId]) return false;
    seen[r.accountId] = true; return true;
  }).map(function (r) { return { type: REGIS_TYPES.STAFF, id: r.accountId, name: r.name, title: r.title || r.role, section: sec }; });
  return cubs.concat(staff);
}

/** 寫入或更新一列（只改傳進來的欄位） */
function upsertRegis_(existing, year, type, id, section, fields, who) {
  var cur = existing[regisKey_(type, id)];
  var now = new Date();
  if (cur) {
    var v = HEADERS[SHEET.REGIS].map(function (h, j) { return cur._raw[j] === undefined ? '' : cur._raw[j]; });
    if ('renew' in fields) v[4] = fields.renew;
    if ('registered' in fields) v[5] = fields.registered;
    if ('amount' in fields) v[6] = fields.amount;
    if ('paid' in fields) v[7] = fields.paid;
    if ('note' in fields) v[8] = fields.note;
    v[3] = section; v[9] = who.account.accountId; v[10] = now;
    return { update: { row: cur._row, values: v } };
  }
  return { append: [year, type, id, section, fields.renew || '', fields.registered || '否', 'amount' in fields ? fields.amount : '', fields.paid || '否', fields.note || '', who.account.accountId, now] };
}

// ───── 續團確認（各分團團長，只看目前分團） ─────

registerAdmin_('renewList', 'manageCubs', function (req) {
  var year = regisYear_(req.year), sec = curSec_();
  var mine = {};
  loadRegis_().forEach(function (r) { if (r.year === year) mine[regisKey_(r.type, r.id)] = r; });
  return {
    year: year, section: sec,
    people: renewPeople_(sec).map(function (p) {
      var r = mine[regisKey_(p.type, p.id)];
      return { type: p.type, id: p.id, name: p.name, squad: p.squad || '', title: p.title || '', renew: r ? r.renew : '', registered: !!(r && r.registered) };
    })
  };
});

/** entries: [{type, id, renew: '是'|'否'|''}]；只能改目前分團的人，已登記的不能改成不續團 */
registerAdmin_('renewSave', 'manageCubs', function (req, who) {
  var year = regisYear_(req.year), sec = curSec_();
  var entries = (req.entries || []).slice(0, 500);
  return withLock_(function () {
    var allowed = {};
    renewPeople_(sec).forEach(function (p) { allowed[regisKey_(p.type, p.id)] = p; });
    var existing = {};
    loadRegis_().forEach(function (r) { if (r.year === year) existing[regisKey_(r.type, r.id)] = r; });
    var ups = [], adds = [];
    entries.forEach(function (e) {
      var k = regisKey_(Logic.clean(e.type), Logic.clean(e.id)), p = allowed[k];
      if (!p) throw new ApiError(ERR.NOT_FOUND, '名單已經變動，請重新整理。');
      var renew = Logic.clean(e.renew);
      if (['是', '否', ''].indexOf(renew) < 0) throw new ApiError(ERR.BAD_INPUT, '續團只能選「是」或「否」。');
      if (renew === '否' && existing[k] && existing[k].registered) throw new ApiError(ERR.BAD_INPUT, p.name + ' 已經登記了，不能改成不續團，請先請總團取消登記。');
      if (existing[k] && existing[k].renew === renew) return;
      var w = upsertRegis_(existing, year, p.type, p.id, sec, { renew: renew }, who);
      if (w.update) ups.push(w.update); else adds.push(w.append);
    });
    if (ups.length) updateRows_(SHEET.REGIS, ups);
    if (adds.length) appendRows_(SHEET.REGIS, adds);
    if (ups.length + adds.length) logOp_(who.account.accountId, '續團確認', sec, '', year + ' 年度 ' + (ups.length + adds.length) + ' 人');
    return { changed: ups.length + adds.length };
  });
});

// ───── 三項登記（總團、最高管理員） ─────

function requireRegisManager_(who) {
  if (!canManageAll_(who)) throw new ApiError(ERR.FORBIDDEN, '三項登記只有總團與最高管理員可以處理。');
}
AUTHED_ACTIONS.regisList = function (req, who) {
  requireRegisManager_(who);
  var year = regisYear_(req.year), fees = loadFees_(year);
  var rows = {};
  loadRegis_().forEach(function (r) { if (r.year === year) rows[regisKey_(r.type, r.id)] = r; });
  var people = [];
  Logic.SECTIONS.forEach(function (sec) {
    var list = renewPeople_(sec);
    // 團登記：這個分團有人要續團（或已登記）就列出來
    var troopRow = rows[regisKey_(REGIS_TYPES.TROOP, sec)];
    if (list.length || troopRow) list.unshift({ type: REGIS_TYPES.TROOP, id: sec, name: '22 團' + Logic.SECTION_FULL[sec] + '團', section: sec });
    list.forEach(function (p) {
      var r = rows[regisKey_(p.type, p.id)];
      people.push({
        type: p.type, id: p.id, name: p.name, section: sec, title: p.title || '',
        renew: p.type === REGIS_TYPES.TROOP ? '是' : (r ? r.renew : ''),
        registered: !!(r && r.registered), paid: !!(r && r.paid),
        amount: r && r.amount !== null ? r.amount : feeOf_(fees, p.type), note: r ? r.note : ''
      });
    });
  });
  var due = people.filter(function (p) { return p.renew !== '否'; });
  return {
    year: year, fees: fees ? { scout: fees.scout, staff: fees.staff, troop: fees.troop, note: fees.note } : null, people: people,
    summary: {
      renewYes: people.filter(function (p) { return p.type !== REGIS_TYPES.TROOP && p.renew === '是'; }).length,
      undecided: people.filter(function (p) { return p.type !== REGIS_TYPES.TROOP && !p.renew; }).length,
      registered: due.filter(function (p) { return p.registered; }).length, total: due.length,
      amount: due.reduce(function (s, p) { return s + (p.amount || 0); }, 0),
      paid: due.filter(function (p) { return p.paid; }).reduce(function (s, p) { return s + (p.amount || 0); }, 0)
    }
  };
};

/** entries: [{type, id, section, registered?, paid?, amount?, note?}] */
AUTHED_ACTIONS.regisSave = function (req, who) {
  requireRegisManager_(who);
  var year = regisYear_(req.year);
  var entries = (req.entries || []).slice(0, 1000);
  return withLock_(function () {
    var existing = {};
    loadRegis_().forEach(function (r) { if (r.year === year) existing[regisKey_(r.type, r.id)] = r; });
    var ups = [], adds = [];
    entries.forEach(function (e) {
      var type = Logic.clean(e.type), id = Logic.clean(e.id), sec = Logic.sectionOf(e.section);
      if ([REGIS_TYPES.SCOUT, REGIS_TYPES.STAFF, REGIS_TYPES.TROOP].indexOf(type) < 0 || !id) throw new ApiError(ERR.BAD_INPUT, '資料不正確，請重新整理。');
      var f = {};
      if ('registered' in e) f.registered = e.registered ? '是' : '否';
      if ('paid' in e) f.paid = e.paid ? '是' : '否';
      if ('amount' in e) {
        var n = Number(e.amount);
        if (e.amount === '' || e.amount === null) f.amount = '';
        else if (!isFinite(n) || n < 0 || n > 100000) throw new ApiError(ERR.BAD_INPUT, '應繳金額需為 0～100000。');
        else f.amount = Math.round(n);
      }
      if ('note' in e) f.note = Logic.clean(e.note).slice(0, 100);
      var w = upsertRegis_(existing, year, type, id, sec, f, who);
      if (w.update) ups.push(w.update); else adds.push(w.append);
    });
    if (ups.length) updateRows_(SHEET.REGIS, ups);
    if (adds.length) appendRows_(SHEET.REGIS, adds);
    if (ups.length + adds.length) logOp_(who.account.accountId, '三項登記', String(year), '', (ups.length + adds.length) + ' 筆');
    return { changed: ups.length + adds.length };
  });
};

AUTHED_ACTIONS.regisFeesSave = function (req, who) {
  requireRegisManager_(who);
  var year = regisYear_(req.year);
  var num = function (v, label) {
    var n = Number(v);
    if (!isFinite(n) || n < 0 || n > 100000) throw new ApiError(ERR.BAD_INPUT, label + '需為 0～100000 的金額。');
    return Math.round(n);
  };
  var vals = [year, num(req.scout, '童軍登記費'), num(req.staff, '服務員登記費'), num(req.troop, '團登記費'), Logic.clean(req.note).slice(0, 100), who.account.accountId, new Date()];
  return withLock_(function () {
    var cur = loadFees_(year);
    if (cur) updateRows_(SHEET.REGIS_FEES, [{ row: cur._row, values: vals }]);
    else appendRows_(SHEET.REGIS_FEES, [vals]);
    logOp_(who.account.accountId, '設定登記費', String(year), cur ? [cur.scout, cur.staff, cur.troop].join('／') : '', vals.slice(1, 4).join('／'));
    return {};
  });
};

/** 匯出（附錄第 70 點）：姓名、分團、身分、續團、是否已登記、應繳、已繳；不續團的不列 */
AUTHED_ACTIONS.regisExport = function (req, who) {
  var d = AUTHED_ACTIONS.regisList(req, who);
  var rows = [['姓名', '分團', '身分', '續團', '是否已登記', '應繳', '已繳']];
  d.people.filter(function (p) { return p.renew !== '否'; }).forEach(function (p) {
    rows.push([p.name, Logic.SECTION_FULL[p.section] || p.section, p.type, p.renew || '未確認', p.registered ? '是' : '否', p.amount || 0, p.paid ? '是' : '否']);
  });
  return { csv: Logic.toCsv(rows.map(function (r) { return r.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }); })), filename: '三項登記_' + d.year + '.csv' };
};
