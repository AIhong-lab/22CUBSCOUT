/**
 * 小隊輔、正副小隊長、公告欄、批次匯入、家長線上請假（SPEC 附錄第 45 點）
 */

// ───────────── 小隊輔（每個小隊負責的服務員或團長） ─────────────

function loadSquadStaff_() {
  return readRows_(SHEET.SQUAD_STAFF).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { squad: Logic.clean(r[0]), accountId: Logic.clean(r[1]), _row: r._row };
  });
}

/** 某小隊的小隊輔姓名（只取仍是管理員的人） */
function squadStaffNames_(squad) {
  if (!squad) return [];
  var names = adminNames_();
  return loadSquadStaff_().filter(function (s) { return s.squad === squad && names[s.accountId]; }).map(function (s) { return names[s.accountId]; });
}

/** 某管理員負責的小隊（依小隊清單順序），給點名、簽核預設用 */
function squadsOfStaff_(accountId) {
  var mine = {};
  loadSquadStaff_().forEach(function (s) { if (s.accountId === accountId) mine[s.squad] = true; });
  return loadSettings_().values['小隊清單'].filter(function (q) { return mine[q]; });
}

/** 設定某小隊的小隊輔（整組取代）；只能選現任管理員 */
registerAdmin_('squadStaffSave', 'manageSquadStaff', function (req, who) {
  var squad = Logic.clean(req.squad);
  var ids = (req.accountIds || []).map(Logic.clean).filter(String);
  return withLock_(function () {
    if (loadSettings_().values['小隊清單'].indexOf(squad) < 0) throw new ApiError(ERR.NOT_FOUND, '找不到這個小隊。');
    var names = adminNames_();
    if (ids.some(function (id) { return !names[id]; })) throw new ApiError(ERR.BAD_INPUT, '小隊輔只能選團長或服務員，請重新整理後再試。');
    var cur = loadSquadStaff_().filter(function (s) { return s.squad === squad; });
    var before = cur.map(function (s) { return names[s.accountId] || '（已移除）'; }).join('、');
    if (cur.length) deleteRows_(SHEET.SQUAD_STAFF, cur.map(function (s) { return s._row; }));
    var now = new Date(), seen = {};
    var rows = ids.filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; }).map(function (id) { return [squad, id, who.account.accountId, now]; });
    appendRows_(SHEET.SQUAD_STAFF, rows);
    logOp_(who.account.accountId, '設定小隊輔', squad, before, rows.map(function (r) { return names[r[1]]; }).join('、'));
    return { count: rows.length };
  });
});

// ───────────── 正副小隊長（目前職務＋任期紀錄） ─────────────

function loadRoles_() {
  return readRows_(SHEET.ROLES).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { cubId: Logic.clean(r[0]), squad: Logic.clean(r[1]), role: Logic.clean(r[2]), start: dateStr_(r[3]), end: dateStr_(r[4]), _row: r._row, _raw: r };
  });
}

/** 任期紀錄（白名單），新的在前 */
function roleHistory_(cubId) {
  return loadRoles_().filter(function (x) { return x.cubId === cubId; })
    .sort(function (a, b) { return a.start < b.start ? 1 : -1; })
    .map(function (x) { return { squad: x.squad, role: x.role, start: x.start, end: x.end }; });
}

/**
 * 結束某位小狼目前的職務（換小隊、離團、升團、被取代時呼叫）：清掉名單上的職務、任期紀錄補上結束日。
 * 呼叫端需已在 withLock_ 內。row 為要寫回的小狼列（會被修改但不在這裡寫入）。
 */
function endRoleInRow_(cub, row, endDate) {
  if (!Logic.clean(row[10])) return false;
  row[10] = '';
  var open = loadRoles_().filter(function (x) { return x.cubId === cub.cubId && !x.end; });
  if (open.length) updateRows_(SHEET.ROLES, open.map(function (x) {
    var v = HEADERS[SHEET.ROLES].map(function (h, j) { return x._raw[j] === undefined ? '' : x._raw[j]; });
    v[4] = endDate;
    return { row: x._row, values: v };
  }));
  return true;
}

/**
 * 能不能擔任正副小隊長：狼級以上可以；小隊裡真的沒有狼級以上的在團小狼時，羚羊級也可以（SPEC 附錄第 45 點）。
 * @return {{ok: boolean, reason?: string}}
 */
function canLeadSquad_(cub, cubs) {
  if (Logic.ROLE_LEVELS.indexOf(cub.level) >= 0) return { ok: true };
  var seniors = (cubs || loadCubs_()).filter(function (c) { return c.status === '在團' && c.squad === cub.squad && Logic.ROLE_LEVELS.indexOf(c.level) >= 0; });
  if (cub.level === '羚羊' && cub.squad && !seniors.length) return { ok: true };
  return { ok: false, reason: cub.level === '羚羊' ? cub.squad + '有狼級以上的小狼（' + seniors.map(function (c) { return c.name; }).join('、') + '），請由他們擔任' : '狼級以上才能擔任（小隊沒有狼級以上時，羚羊級也可以）；' + cub.name + ' 目前是' + (cub.level || '尚未晉級') };
}

/** 設定職務：role = 小隊長／副小隊長／''（卸任）。資格見 canLeadSquad_；每小隊正副各一位，換人先確認 */
registerAdmin_('cubRoleSave', 'manageRoles', function (req, who) {
  var role = Logic.clean(req.role);
  if (role && Logic.CUB_ROLES.indexOf(role) < 0) throw new ApiError(ERR.BAD_INPUT, '職務只能是小隊長或副小隊長。');
  var date = Logic.clean(req.date) ? requireDate_(Logic.clean(req.date), '開始日') : today_();
  return withLock_(function () {
    var cub = findCub_(req.cubId);
    if (cub.status !== '在團') throw new ApiError(ERR.BAD_INPUT, '只有在團的小狼可以擔任職務。');
    var row = cubRow_(cub);
    var cur = Logic.clean(row[10]);
    if (cur === role) return { changed: 0 };
    var ups = [];
    if (role) {
      if (!cub.squad) throw new ApiError(ERR.BAD_INPUT, '請先幫這位小狼設定小隊。');
      var can = canLeadSquad_(cub);
      if (!can.ok) throw new ApiError(ERR.BAD_INPUT, '不能擔任' + role + '：' + can.reason + '。');
      var holder = loadCubs_().filter(function (c) { return c.cubId !== cub.cubId && c.status === '在團' && c.squad === cub.squad && c.role === role; })[0];
      if (holder && !req.confirm) return { needConfirm: true, warnings: [cub.squad + '的' + role + '目前是 ' + holder.name + '，確定後會改由 ' + cub.name + ' 擔任。'] };
      if (holder) { var hr = cubRow_(holder); endRoleInRow_(holder, hr, date); ups.push({ row: holder._row, values: hr }); }
    }
    endRoleInRow_(cub, row, date);
    row[10] = role;
    ups.push({ row: cub._row, values: row });
    updateRows_(SHEET.CUBS, ups);
    if (role) appendRows_(SHEET.ROLES, [[cub.cubId, cub.squad, role, date, '', who.account.accountId, new Date()]]);
    logOp_(who.account.accountId, '設定職務', cub.cubId, cur || '隊員', role || '隊員');
    return { changed: 1 };
  });
});

// ───────────── 公告欄（不用登入也看得到；不可放任何孩子的個資） ─────────────

function loadNotices_() {
  return readRows_(SHEET.NOTICES).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      id: Logic.clean(r[0]), title: Logic.clean(r[1]), content: String(r[2] === undefined || r[2] === null ? '' : r[2]), pinned: Logic.clean(r[3]) === '是',
      meetingId: Logic.clean(r[4]), poster: Logic.clean(r[5]), at: ms_(r[6]), visible: Logic.clean(r[7]) !== '下架', _row: r._row, _raw: r
    };
  });
}

function noticeView_(n, meetings, names) {
  var m = n.meetingId ? meetings[n.meetingId] : null;
  var o = { id: n.id, title: n.title, content: n.content, pinned: n.pinned, date: n.at ? Utilities.formatDate(new Date(n.at), TZ, 'yyyy-MM-dd') : '', meeting: m ? { date: m.date, name: m.name } : null };
  if (names) { o.visible = n.visible; o.poster = names[n.poster] || ''; o.meetingId = n.meetingId; }
  return o;
}

function noticeMeetings_() {
  var map = {};
  loadMeetings_().forEach(function (m) { if (m.enabled && Logic.isDateStr(m.date)) map[m.meetingId] = m; });
  return map;
}

/** 公開：顯示中的公告，置頂在前、新的在前，最多 30 則。只回標題、內容、日期與連結的集會 */
function apiNotices_() { return cachedPublic_('PUB_NOTICES', buildNotices_); }
function buildNotices_() {
  var meetings = noticeMeetings_();
  var list = loadNotices_().filter(function (n) { return n.visible; })
    .sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.at - a.at; }).slice(0, 30);
  return { notices: list.map(function (n) { return noticeView_(n, meetings, null); }) };
}
PUBLIC_ACTIONS.notices = apiNotices_;

registerAdmin_('noticeList', 'postNotice', function () {
  var meetings = noticeMeetings_(), names = adminNames_(), today = today_();
  return {
    notices: loadNotices_().sort(function (a, b) { return b.at - a.at; }).map(function (n) { return noticeView_(n, meetings, names); }),
    meetings: Object.keys(meetings).map(function (k) { return meetings[k]; }).filter(function (m) { return m.date >= today; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 30).map(function (m) { return { meetingId: m.meetingId, date: m.date, name: m.name }; })
  };
});

registerAdmin_('noticeSave', 'postNotice', function (req, who) {
  var title = Logic.clean(req.title), content = String(req.content || '').replace(/\r\n/g, '\n').trim();
  if (!title || title.length > 60) throw new ApiError(ERR.BAD_INPUT, '請填寫公告標題（最多 60 字）。');
  if (content.length > 2000) throw new ApiError(ERR.BAD_INPUT, '公告內容最多 2000 字。');
  var meetingId = Logic.clean(req.meetingId);
  return withLock_(function () {
    if (meetingId && !noticeMeetings_()[meetingId]) throw new ApiError(ERR.BAD_INPUT, '找不到連結的集會，請重新選擇。');
    var list = loadNotices_();
    if (req.id) {
      var n = list.filter(function (x) { return x.id === Logic.clean(req.id); })[0];
      if (!n) throw new ApiError(ERR.NOT_FOUND, '找不到這則公告。');
      var v = HEADERS[SHEET.NOTICES].map(function (h, j) { return n._raw[j] === undefined ? '' : n._raw[j]; });
      v[1] = title; v[2] = content; v[3] = req.pinned ? '是' : '否'; v[4] = meetingId;
      if (req.visible !== undefined) v[7] = req.visible ? '顯示' : '下架';
      updateRows_(SHEET.NOTICES, [{ row: n._row, values: v }]);
      logOp_(who.account.accountId, '修改公告', n.id, n.title, title + (v[7] === '下架' ? '（下架）' : ''));
      return { id: n.id };
    }
    var id = newId_('N', list.map(function (x) { return x.id; }));
    appendRows_(SHEET.NOTICES, [[id, title, content, req.pinned ? '是' : '否', meetingId, who.account.accountId, new Date(), '顯示']]);
    logOp_(who.account.accountId, '發布公告', id, '', title);
    return { id: id };
  });
});

// ───────────── 批次匯入名單 ─────────────

/**
 * 每行一位：「姓名 小隊 入團日」，用空白、逗號或 Tab 分隔；小隊、入團日可省略（入團日預設今天）。
 * 全部檢查通過才寫入；和在團小狼同名時先確認。
 */
registerAdmin_('cubImport', 'manageCubs', function (req, who) {
  var lines = String(req.lines || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(String);
  if (!lines.length) throw new ApiError(ERR.BAD_INPUT, '請貼上名單，每行一位：姓名 小隊 入團日。');
  if (lines.length > 100) throw new ApiError(ERR.BAD_INPUT, '一次最多匯入 100 位。');
  return withLock_(function () {
    var settings = loadSettings_().values, squads = settings['小隊清單'], today = today_();
    var existing = {};
    loadCubs_().forEach(function (c) { if (c.status === '在團' || c.status === Logic.TRIAL) existing[c.name] = true; });
    var errors = [], dups = [], parsed = [], seen = {};
    lines.forEach(function (line, i) {
      var parts = line.split(/[\s,，\t]+/).filter(String);
      var name = parts[0], squad = '', date = today, no = '第 ' + (i + 1) + ' 行';
      if (!name || name.length > 30) { errors.push(no + '：姓名不正確'); return; }
      parts.slice(1).forEach(function (p) {
        var d = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(p);
        if (d) date = d[1] + '-' + ('0' + d[2]).slice(-2) + '-' + ('0' + d[3]).slice(-2);
        else squad = p;
      });
      if (!Logic.isDateStr(date) || date > today) { errors.push(no + '：入團日不正確（' + name + '）'); return; }
      if (squad && squads.indexOf(squad) < 0) { errors.push(no + '：「' + squad + '」不在小隊清單（' + name + '）'); return; }
      if (seen[name]) { errors.push(no + '：名單裡「' + name + '」重複了'); return; }
      seen[name] = true;
      if (existing[name]) dups.push(name);
      parsed.push([name, squad, date]);
    });
    if (errors.length) throw new ApiError(ERR.BAD_INPUT, errors.join('\n'));
    if (dups.length && !req.confirm) return { needConfirm: true, warnings: ['已經有同名的小狼：' + dups.join('、') + '。確定要再新增一位同名的嗎？'] };
    var ids = loadCubs_().map(function (c) { return c.cubId; }), codes = allCodes_(), rows = [];
    parsed.forEach(function (p) {
      var id = newId_('C', ids); ids.push(id);
      var code = Logic.generateCode(settings['綁定碼長度'], randInt_, codes); codes[code] = true;
      rows.push([id, p[0], p[1], p[2], '', code, settings['綁定碼可用次數'], '在團', '', '', '']);
    });
    appendRows_(SHEET.CUBS, rows);
    logOp_(who.account.accountId, '批次匯入小狼', rows.length + ' 位', '', '');
    return { added: rows.length };
  });
});

// ───────────── 家長線上請假（只能幫自己綁定的孩子、只能請今天以後的集會） ─────────────

function apiParentLeave_(req, who) {
  return withLock_(function () {
    var cubId = Logic.clean(req.cubId);
    var binding = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === cubId; })[0];
    if (!binding) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼的資料。');
    if (Logic.needsReconsent(binding, Logic.latestConsentVersion(loadConsents_()))) throw new ApiError(ERR.NEED_CONSENT, '個資告知內容已更新，請先閱讀並同意。');
    var m = loadMeetings_().filter(function (x) { return x.meetingId === Logic.clean(req.meetingId); })[0];
    if (!m || !m.enabled || !Logic.isDateStr(m.date)) throw new ApiError(ERR.NOT_FOUND, '找不到這場集會。');
    if (m.date < today_()) throw new ApiError(ERR.BAD_INPUT, '這場集會已經過了，請聯絡團長或服務員。');
    if (!cubsOnDate_(m.date, m.type).some(function (c) { return c.cubId === cubId; })) throw new ApiError(ERR.BAD_INPUT, '這場集會不需要請假。');
    var cur = loadAttendance_().filter(function (a) { return a.meetingId === m.meetingId && a.cubId === cubId; })[0];
    if (cur && cur.status === '出席') throw new ApiError(ERR.BAD_INPUT, '這場集會已經點名為出席，要修改請聯絡團長或服務員。');
    var want = req.leave !== false;
    if (want && !cur) appendRows_(SHEET.ATTENDANCE, [[m.meetingId, cubId, '請假', who.account.accountId, new Date()]]);
    if (!want && cur) deleteRows_(SHEET.ATTENDANCE, [cur._row]);
    if ((want && !cur) || (!want && cur)) logOp_(who.account.accountId, want ? '家長請假' : '家長取消請假', cubId, '', m.date);
    return { leave: want };
  });
}
AUTHED_ACTIONS.parentLeave = apiParentLeave_;

// ───────────── 網站內容：了解幼童軍、活動時間說明、FB 網址（SPEC 附錄第 49 點） ─────────────

var SITE_KEYS = ['about', 'activity', 'fb'];
/** 還沒設定「了解幼童軍」時顯示的範本，請團長在後台改成實際內容 */
var DEFAULT_ABOUT = [
  '【這是範本，請團長到後台「系統設定 → 網站內容」改成實際內容】',
  '',
  '幼童軍是什麼？',
  '幼童軍是給國小階段孩子參加的童軍活動。孩子在小隊裡和夥伴一起玩遊戲、學技能、到戶外探索，從「做中學」培養自己動手、照顧別人和團隊合作的習慣。',
  '',
  '我們平常做什麼？',
  '定期舉行團集會，內容包含遊戲、手作、繩結、戶外活動與服務學習；每年另有露營等大活動。',
  '',
  '怎麼加入？',
  '歡迎先來體驗：參加 4 次一般團集會後就可以正式入團。想帶孩子來體驗，請聯絡團長：【請填寫聯絡方式】。'
].join('\n');

function loadSite_() {
  var o = {};
  readRows_(SHEET.SITE).forEach(function (r) { var k = Logic.clean(r[0]); if (SITE_KEYS.indexOf(k) >= 0) o[k] = { value: String(r[1] === undefined || r[1] === null ? '' : r[1]), _row: r._row }; });
  return o;
}
function siteValues_() {
  var s = loadSite_();
  return { about: s.about ? s.about.value : DEFAULT_ABOUT, activity: s.activity ? s.activity.value : '', fb: s.fb ? s.fb.value : '' };
}

/** 公開：了解幼童軍、活動時間說明、FB 網址，以及這個月 1 日以後、啟用中的集會（只有日期、名稱、類型、備註） */
function apiSiteInfo_() { return cachedPublic_('PUB_SITE', buildSiteInfo_); }
function buildSiteInfo_() {
  var today = today_(), from = today.slice(0, 8) + '01';
  var v = siteValues_();
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && Logic.isDateStr(m.date) && m.date >= from; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 200)
    .map(function (m) { return { date: m.date, name: m.name, type: m.type, note: m.note }; });
  return { about: v.about, activity: v.activity, fb: v.fb, today: today, meetings: meetings, events: publicEvents_() };
}
PUBLIC_ACTIONS.siteInfo = apiSiteInfo_;

registerAdmin_('siteContentGet', 'manageSettings', function () { return siteValues_(); });

registerAdmin_('siteContentSave', 'manageSettings', function (req, who) {
  var text = function (v) { return String(v === undefined || v === null ? '' : v).replace(/\r\n/g, '\n').trim(); };
  var next = { about: text(req.about), activity: text(req.activity), fb: Logic.clean(req.fb) };
  if (next.about.length > 5000) throw new ApiError(ERR.BAD_INPUT, '「了解幼童軍」最多 5000 字。');
  if (next.activity.length > 1000) throw new ApiError(ERR.BAD_INPUT, '「活動時間說明」最多 1000 字。');
  if (next.fb && !/^https:\/\/((www|m)\.)?(facebook\.com|fb\.com|fb\.me)\/[^\s<>"']{1,300}$/.test(next.fb)) throw new ApiError(ERR.BAD_INPUT, 'FB 網址請貼 Facebook 粉絲專頁的網址（https://www.facebook.com/…）。');
  return withLock_(function () {
    var cur = loadSite_(), ups = [], adds = [], now = new Date();
    SITE_KEYS.forEach(function (k) {
      var row = [k, next[k], who.account.accountId, now];
      if (cur[k]) { if (cur[k].value !== next[k]) ups.push({ row: cur[k]._row, values: row }); } else adds.push(row);
    });
    if (ups.length) updateRows_(SHEET.SITE, ups);
    if (adds.length) appendRows_(SHEET.SITE, adds);
    logOp_(who.account.accountId, '修改網站內容', '了解幼童軍／活動時間／FB', '', '');
    return { changed: ups.length + adds.length };
  });
});

