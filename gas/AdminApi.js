/**
 * 後台 API（階段 4A）
 * 每一支都先用 Logic.can(角色, 動作) 在後端檢查權限，不能只靠前端隱藏按鈕。
 *
 * 會修改「完成紀錄」「頒章紀錄」「管理員」既有列的只有規格明定的操作：
 *   撤銷簽核（7.4）、修改／撤銷頒章（7.5）、管理員異動（7.9）、個資處理（7.10）。
 */

// ───────────── 共用 ─────────────

function requireRole_(who, action) {
  if (!who.admin || !Logic.can(who.admin.role, action)) throw new ApiError(ERR.FORBIDDEN, '你沒有權限執行這個操作。');
}

/** 把後台動作包上權限檢查後註冊到 AUTHED_ACTIONS */
function registerAdmin_(name, permission, fn) {
  AUTHED_ACTIONS[name] = function (req, who) {
    requireRole_(who, permission);
    var out = fn(req, who);
    // 階段 5：會影響達標的動作完成後，重算並推播（失敗不影響主要操作；等待確認的不算）
    if (Object.prototype.hasOwnProperty.call(NOTIFY_AFTER, name) && !(out && out.needConfirm)) notifySafely_(NOTIFY_AFTER[name]);
    return out;
  };
}

function adminNames_() {
  var m = {};
  loadAdmins_().forEach(function (a) { m[a.accountId] = a.name; });
  return m;
}

function findCub_(cubId) {
  var c = loadCubs_().filter(function (x) { return x.cubId === Logic.clean(cubId); })[0];
  if (!c) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼。');
  return c;
}

function cubRow_(cub) { return cub._raw.slice(0, HEADERS[SHEET.CUBS].length); }

function requireDate_(d, label) {
  if (!Logic.isDateStr(d)) throw new ApiError(ERR.BAD_INPUT, '請填寫正確的' + (label || '日期') + '。');
  return d;
}

/** 一次讀齊計算進度所需的資料，供多位小狼共用 */
function progressCtx_() {
  var settings = loadSettings_().values;
  var meetings = {};
  loadMeetings_().forEach(function (m) { if (m.enabled && Logic.isDateStr(m.date)) meetings[m.meetingId] = m; });
  var attByCub = {};
  loadAttendance_().forEach(function (a) {
    if (!meetings[a.meetingId]) return;
    (attByCub[a.cubId] = attByCub[a.cubId] || []).push({ date: meetings[a.meetingId].date, status: a.status, meetingId: a.meetingId, type: meetings[a.meetingId].type });
  });
  var trialEnd = {};
  loadCubs_().forEach(function (c) { if (c.trialStart && c.joinDate) trialEnd[c.cubId] = c.joinDate; });
  return {
    trialEnd: trialEnd,
    settings: settings, items: loadItems_().items, completions: loadCompletions_(), awards: loadAwards_(),
    meetings: meetings, attByCub: attByCub, today: today_()
  };
}

function progressOf_(ctx, cubId) {
  return Logic.computeCubProgress({
    cubId: cubId, items: ctx.items, completions: ctx.completions, awards: ctx.awards,
    intervalMonths: ctx.settings['晉級間隔月數'], today: ctx.today, attendance: ctx.attByCub[cubId] || [],
    autoItemId: ctx.settings['出席自動完成項目ID'], autoCount: ctx.settings['自動完成所需出席次數'],
    levelAttendCount: ctx.settings['晉級所需出席次數'], newbieAttendCount: ctx.settings['剛入團所需出席次數'],
    newbieAfter: (ctx.trialEnd || {})[cubId] || null
  });
}

/** 依頒章紀錄重算目前級別（頒章、撤銷、補登後呼叫） */
function refreshCubLevel_(cubId) {
  var cub = findCub_(cubId);
  var lv = '';
  var awarded = {};
  loadAwards_().forEach(function (a) { if (a.cubId === cubId) awarded[a.unit] = true; });
  Logic.LEVELS.forEach(function (l) { if (awarded[l]) lv = l; });
  if (cub.level !== lv) {
    var row = cubRow_(cub);
    row[4] = lv;
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
  }
}

// ───────────── 首頁 ─────────────

registerAdmin_('adminHome', 'viewOverview', function (req, who) {
  var ctx = progressCtx_();
  var cubs = loadCubs_();
  var scan = scanCubs_(ctx, cubs);
  var pending = scan.pending, near = scan.near, waiting = scan.waiting;
  // 體驗者：一般團集會出席滿設定次數 → 提醒團長「轉為入團」
  var trialNeed = ctx.settings['體驗所需出席次數'];
  var trials = cubs.filter(function (c) { return c.status === Logic.TRIAL; }).map(function (c) {
    var t = Logic.trialProgress(ctx.attByCub[c.cubId] || [], trialNeed);
    return { cubId: c.cubId, name: c.name, squad: c.squad, count: t.count, need: t.need, ready: t.ready };
  });
  var props = PropertiesService.getScriptProperties();
  var parse = function (k) { try { return JSON.parse(props.getProperty(k) || 'null'); } catch (e) { return null; } };
  var admins = loadAdmins_();
  return {
    me: { name: who.admin.name, role: who.admin.role },
    pending: pending, waiting: waiting, near: near, trials: trials,
    alerts: {
      itemErrors: loadItems_().errors,
      settingErrors: loadSettings_().errors,
      backup: parse('BACKUP_LAST'),
      backupFolderSet: !!props.getProperty('BACKUP_FOLDER_ID'),
      permission: parse('PERM_LAST'),
      privacyOverdue: Logic.overdueForPrivacy(cubs, ctx.settings['離團後提醒處理個資的天數'], ctx.today).map(function (c) { return { cubId: c.cubId, name: c.name, leftDate: c.leftDate }; }),
      noLineAdmin: !admins.some(function (a) { return a.lineUserId; }),
      pendingRequests: Logic.can(who.admin.role, 'reviewRequests') ? loadRequests_().filter(function (r) { return r.status === '待審核'; }).length : 0,
      notifyFailed: Number(props.getProperty('NOTIFY_FAILED') || 0)
    }
  };
});

// ───────────── 小狼管理與綁定碼 ─────────────

registerAdmin_('cubList', 'viewRoster', function (req, who) {
  var leader = Logic.can(who.admin.role, 'manageBindCodes');
  var bindCount = {};
  loadBindings_().forEach(function (b) { bindCount[b.cubId] = (bindCount[b.cubId] || 0) + 1; });
  var cubs = loadCubs_().map(function (c) {
    var o = { cubId: c.cubId, name: c.name, squad: c.squad, joinDate: c.joinDate, level: c.level, status: c.status, leftDate: c.leftDate, role: c.role };
    if (leader) { o.code = c.code; o.codeUsesLeft = c.codeUsesLeft; o.bindCount = bindCount[c.cubId] || 0; }
    return o;
  });
  return { cubs: cubs, squads: squadsOf_(cubs) };
});

/** 小隊清單：依「設定」的小隊清單順序；在團小狼使用中但不在清單的舊名稱附在後面，避免小狼被藏起來 */
function squadsOf_(cubs) {
  var list = loadSettings_().values['小隊清單'].slice();
  cubs.forEach(function (c) { if (c.squad && c.status === '在團' && list.indexOf(c.squad) < 0) list.push(c.squad); });
  return list;
}

/** 新增／編輯小狼時檢查小隊必須在清單內（清單為空時只能留空） */
function requireSquad_(squad) {
  if (!squad) return '';
  var list = loadSettings_().values['小隊清單'];
  if (list.indexOf(squad) < 0) throw new ApiError(ERR.BAD_INPUT, '「' + squad + '」不在小隊清單中，請先到「更多 → 小隊設定」新增。');
  return squad;
}

registerAdmin_('cubSave', 'manageCubs', function (req, who) {
  var trialCub = req.cubId ? findCub_(req.cubId).status === Logic.TRIAL : !!req.trial;
  var name = Logic.clean(req.name), squad = Logic.clean(req.squad).slice(0, 20);
  // 體驗者沒有入團日，改填「體驗開始日」（SPEC 附錄第 40 點）
  var joinDate = trialCub ? '' : requireDate_(Logic.clean(req.joinDate), '入團日');
  var trialStart = trialCub ? requireDate_(Logic.clean(req.trialStart || req.joinDate), '體驗開始日') : '';
  if (!name || name.length > 30) throw new ApiError(ERR.BAD_INPUT, '請填寫小狼姓名（最多 30 字）。');
  return withLock_(function () {
    var settings = loadSettings_().values;
    squad = requireSquad_(squad);
    if (req.cubId) {
      var cub = findCub_(req.cubId);
      var row = cubRow_(cub);
      var before = [row[1], row[2], dateStr_(row[3]), dateStr_(row[9])].join('／');
      if (Logic.clean(row[2]) !== squad) endRoleInRow_(cub, row, today_());
      row[1] = name; row[2] = squad;
      if (trialCub) row[9] = trialStart; else row[3] = joinDate;
      updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
      logOp_(who.account.accountId, '編輯小狼', cub.cubId, before, [row[1], row[2], dateStr_(row[3]), dateStr_(row[9])].join('／'));
      return { cubId: cub.cubId };
    }
    var id = newId_('C', loadCubs_().map(function (c) { return c.cubId; }));
    var code = Logic.generateCode(settings['綁定碼長度'], randInt_, allCodes_());
    appendRows_(SHEET.CUBS, [[id, name, squad, joinDate, '', code, settings['綁定碼可用次數'], trialCub ? Logic.TRIAL : '在團', '', trialStart]]);
    logOp_(who.account.accountId, trialCub ? '新增體驗者' : '新增小狼', id, '', [name, squad, trialCub ? '體驗開始 ' + trialStart : joinDate].join('／'));
    return { cubId: id, code: code };
  });
});

/**
 * 體驗者轉為入團（SPEC 附錄第 40 點）：入團日預設今天；一般團集會出席未滿設定次數時先確認。
 * 入團後開始挑戰剛入團；剛入團的出席次數只算入團日之後。
 */
registerAdmin_('cubJoin', 'manageCubs', function (req, who) {
  var d = requireDate_(Logic.clean(req.joinDate) || today_(), '入團日');
  return withLock_(function () {
    var cub = findCub_(req.cubId);
    if (cub.status !== Logic.TRIAL) throw new ApiError(ERR.BAD_INPUT, '這位小狼不是體驗者。');
    if (cub.trialStart && d < cub.trialStart) throw new ApiError(ERR.BAD_INPUT, '入團日不可早於體驗開始日（' + cub.trialStart + '）。');
    var ctx = progressCtx_();
    var t = Logic.trialProgress(ctx.attByCub[cub.cubId] || [], ctx.settings['體驗所需出席次數']);
    if (!t.ready && !req.confirm) return { needConfirm: true, warnings: [cub.name + ' 只參加了 ' + t.count + '／' + t.need + ' 次一般團集會，還沒滿。'] };
    var row = cubRow_(cub);
    row[3] = d; row[7] = '在團';
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
    logOp_(who.account.accountId, '體驗者轉為入團', cub.cubId, '體驗（' + t.count + '／' + t.need + '）', '入團 ' + d);
    return { joinDate: d };
  });
});

/**
 * 名單直接編輯（SPEC 附錄第 41 點）：一次儲存多位小狼的姓名、小隊、入團日。
 * 全部檢查通過才寫入；每位有變更的小狼各寫一筆操作日誌（含修改前）。
 */
registerAdmin_('cubBatchSave', 'manageCubs', function (req, who) {
  // 同一位小狼送了多筆時合併（後面的欄位蓋過前面的）
  var merged = {}, order = [];
  (req.changes || []).slice(0, 300).forEach(function (ch) {
    var id = Logic.clean(ch && ch.cubId);
    if (!merged[id]) { merged[id] = { cubId: id }; order.push(id); }
    ['name', 'squad', 'joinDate'].forEach(function (k) { if (ch[k] !== undefined) merged[id][k] = ch[k]; });
  });
  var changes = order.map(function (id) { return merged[id]; });
  if (!changes.length) throw new ApiError(ERR.BAD_INPUT, '沒有要儲存的變更。');
  return withLock_(function () {
    var byId = {};
    loadCubs_().forEach(function (c) { byId[c.cubId] = c; });
    var squads = loadSettings_().values['小隊清單'];
    var ups = [], logs = [], errors = [];
    changes.forEach(function (ch) {
      var cub = byId[Logic.clean(ch.cubId)];
      if (!cub || cub.status === '已匿名') { errors.push('找不到其中一位小狼，請重新整理。'); return; }
      var row = cubRow_(cub);
      var before = [row[1], row[2], dateStr_(row[3])].join('／');
      if (ch.name !== undefined) {
        var n = Logic.clean(ch.name);
        if (!n || n.length > 30) { errors.push(cub.name + '：姓名不可空白，最多 30 字'); return; }
        row[1] = n;
      }
      if (ch.squad !== undefined) {
        var q = Logic.clean(ch.squad);
        if (q && squads.indexOf(q) < 0 && q !== cub.squad) { errors.push(cub.name + '：「' + q + '」不在小隊清單中'); return; }
        if (q !== cub.squad) endRoleInRow_(cub, row, today_());
        row[2] = q;
      }
      if (ch.joinDate !== undefined && cub.status !== Logic.TRIAL) {
        var d = Logic.clean(ch.joinDate);
        if (!Logic.isDateStr(d)) { errors.push(cub.name + '：入團日格式不正確'); return; }
        row[3] = d;
      }
      var after = [row[1], row[2], dateStr_(row[3])].join('／');
      if (after === before) return;
      ups.push({ row: cub._row, values: row });
      logs.push([cub.cubId, before, after]);
    });
    if (errors.length) throw new ApiError(ERR.BAD_INPUT, errors.join('\n'));
    if (ups.length) updateRows_(SHEET.CUBS, ups);
    logs.forEach(function (l) { logOp_(who.account.accountId, '編輯小狼', l[0], l[1], l[2]); });
    return { changed: ups.length };
  });
});

registerAdmin_('cubLeave', 'manageCubs', function (req, who) {
  var d = requireDate_(Logic.clean(req.leftDate), '離團日');
  return withLock_(function () {
    var cub = findCub_(req.cubId);
    if (cub.status !== '在團' && cub.status !== Logic.TRIAL) throw new ApiError(ERR.BAD_INPUT, '這位小狼目前不是在團狀態。');
    // reason='升團'：升上童軍團（畢業），和中途離團分開統計
    var status = Logic.clean(req.reason) === Logic.GRADUATED && cub.status === '在團' ? Logic.GRADUATED : '離團';
    var row = cubRow_(cub);
    endRoleInRow_(cub, row, d);
    row[5] = ''; row[6] = 0; row[7] = status; row[8] = d; // 綁定碼立即失效
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
    logOp_(who.account.accountId, status === Logic.GRADUATED ? '標記升團' : '標記離團', cub.cubId, cub.status, status + ' ' + d);
    return { status: status };
  });
});

registerAdmin_('cubNewCode', 'manageBindCodes', function (req, who) {
  return withLock_(function () {
    var cub = findCub_(req.cubId);
    if (cub.status !== '在團' && cub.status !== Logic.TRIAL) throw new ApiError(ERR.BAD_INPUT, '只有在團的小狼可以產生綁定碼。');
    var settings = loadSettings_().values;
    var code = Logic.generateCode(settings['綁定碼長度'], randInt_, allCodes_());
    var row = cubRow_(cub);
    row[5] = code; row[6] = settings['綁定碼可用次數'];
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
    logOp_(who.account.accountId, '重新產生綁定碼', cub.cubId, '', '');
    return { code: code, uses: settings['綁定碼可用次數'] };
  });
});

registerAdmin_('cubBindings', 'manageBindCodes', function (req) {
  var cubId = Logic.clean(req.cubId);
  var acc = {};
  loadAccounts_().forEach(function (a) { acc[a.accountId] = a; });
  return {
    bindings: loadBindings_().filter(function (b) { return b.cubId === cubId; }).map(function (b) {
      var a = acc[b.accountId] || {};
      return { accountId: b.accountId, username: a.username || '（已刪除）', nickname: a.nickname || '', consentVersion: b.consentVersion };
    })
  };
});

registerAdmin_('cubUnbind', 'manageBindCodes', function (req, who) {
  return withLock_(function () {
    var rows = loadBindings_().filter(function (b) { return b.cubId === Logic.clean(req.cubId) && b.accountId === Logic.clean(req.accountId); });
    if (!rows.length) throw new ApiError(ERR.NOT_FOUND, '找不到這筆綁定。');
    deleteRows_(SHEET.BINDINGS, rows.map(function (b) { return b._row; }));
    logOp_(who.account.accountId, '後台解除綁定', Logic.clean(req.cubId), Logic.clean(req.accountId), '');
    return {};
  });
});

// ───────────── 簽核 ─────────────

/** 簽核畫面需要的資料：啟用項目、在團小狼、我最近簽過的項目 */
registerAdmin_('signoffData', 'signoff', function (req, who) {
  var items = loadItems_().items.filter(function (i) { return i.enabled; }).map(function (i) {
    return { id: i.id, category: i.category, unit: i.unit, section: i.section, text: i.text };
  });
  var cubs = loadCubs_().filter(function (c) { return c.status === '在團'; }).map(function (c) { return { cubId: c.cubId, name: c.name, squad: c.squad }; });
  var recent = [], seen = {};
  var comps = loadCompletions_();
  for (var i = comps.length - 1; i >= 0 && recent.length < 10; i--) {
    var c = comps[i];
    if (c.signer === who.account.accountId && !seen[c.itemId]) { seen[c.itemId] = true; recent.push(c.itemId); }
  }
  var done = comps.filter(function (c) { return Logic.isCountedCompletion(c); }).map(function (c) { return c.cubId + '|' + c.itemId; });
  return { items: items, cubs: cubs, squads: squadsOf_(loadCubs_()), recent: recent, done: done, today: today_() };
});

registerAdmin_('signoff', 'signoff', function (req, who) {
  var date = requireDate_(Logic.clean(req.date), '完成日期');
  if (date > today_()) throw new ApiError(ERR.BAD_INPUT, '完成日期不可以是未來的日期。');
  var cubIds = (req.cubIds || []).map(Logic.clean).filter(String);
  var itemIds = (req.itemIds || []).map(Logic.clean).filter(String);
  if (!cubIds.length || !itemIds.length) throw new ApiError(ERR.BAD_INPUT, '請至少選一位小狼和一個項目。');
  if (cubIds.length * itemIds.length > 2000) throw new ApiError(ERR.BAD_INPUT, '一次簽太多筆了，請分批送出。');
  return withLock_(function () {
    var active = {};
    loadCubs_().forEach(function (c) { if (c.status === '在團') active[c.cubId] = true; });
    var enabled = {};
    loadItems_().items.forEach(function (i) { if (i.enabled) enabled[i.id] = true; });
    if (cubIds.some(function (c) { return !active[c]; })) throw new ApiError(ERR.BAD_INPUT, '名單中有不在團的小狼，請重新整理後再試。');
    if (itemIds.some(function (i) { return !enabled[i]; })) throw new ApiError(ERR.BAD_INPUT, '項目中有已停用的項目，請重新整理後再試。');
    var plan = Logic.planBatchSignoff(loadCompletions_(), cubIds, itemIds, date, who.account.accountId, Logic.clean(req.note).slice(0, 100));
    appendRows_(SHEET.COMPLETIONS, plan.toAdd.map(Logic.completionToRow));
    if (plan.toAdd.length) logOp_(who.account.accountId, '簽核', plan.toAdd.length + ' 筆', '', date);
    // 階段 5：重算受影響小狼並推播新達標通知
    return { added: plan.toAdd.length, skipped: plan.skipped, batch: plan.toAdd.map(function (c) { return { cubId: c.cubId, itemId: c.itemId }; }) };
  });
});

/** 撤銷簽核（含「復原剛送出的一批」）：團長可撤銷任何人，服務員只能撤銷自己簽的 */
registerAdmin_('signoffRevoke', 'revokeOwnSignoff', function (req, who) {
  var entries = (req.entries || []).slice(0, 2000);
  if (!entries.length) throw new ApiError(ERR.BAD_INPUT, '沒有要撤銷的項目。');
  return withLock_(function () {
    var want = {};
    entries.forEach(function (e) { want[Logic.clean(e.cubId) + '|' + Logic.clean(e.itemId)] = true; });
    var rows = loadCompletions_().filter(function (c) { return want[c.cubId + '|' + c.itemId] && Logic.isCountedCompletion(c); });
    var allowed = rows.filter(function (c) { return Logic.canRevokeSignoff(who.admin.role, who.account.accountId, c.signer); });
    if (rows.length && !allowed.length) throw new ApiError(ERR.FORBIDDEN, '服務員只能撤銷自己簽核的項目。');
    deleteRows_(SHEET.COMPLETIONS, allowed.map(function (c) { return c._row; }));
    allowed.forEach(function (c) {
      logOp_(who.account.accountId, '撤銷簽核', c.cubId, JSON.stringify(Logic.completionToRow(c)), '');
    });
    // 階段 5：不再達標者清除通知紀錄
    return { removed: allowed.length, notAllowed: rows.length - allowed.length };
  });
});

/** 後台看單一小狼：逐項狀態（含項目ID、簽核人、能否撤銷）、達標資訊、頒章紀錄 */
registerAdmin_('cubAdminDetail', 'viewOverview', function (req, who) {
  var cub = findCub_(req.cubId);
  var ctx = progressCtx_();
  var p = progressOf_(ctx, cub.cubId);
  var names = adminNames_();
  var signerOf = {};
  ctx.completions.forEach(function (c) { if (c.cubId === cub.cubId && Logic.isCountedCompletion(c)) signerOf[c.itemId] = c.signer; });
  var units = loadUnits_();
  var byItem = loadDetails_().byItem;
  var att = ctx.attByCub[cub.cubId] || [];
  var period = Logic.periodOf(loadPeriods_(), ctx.today);
  var rate = null;
  if (period) {
    var extra = loadExtra_().filter(function (x) { return x.period === period.name && x.cubId === cub.cubId; }).reduce(function (s, x) { return s + x.count; }, 0);
    rate = Logic.attendanceRate(att, period, extra);
    rate.period = period.name;
  }
  return {
    cub: { cubId: cub.cubId, name: cub.name, squad: cub.squad, joinDate: cub.joinDate, status: cub.status, tenure: Logic.tenure(cub.joinDate, ctx.today).text, currentLevel: p.currentLevel || '', trialStart: cub.trialStart, role: cub.role, canLead: cub.status === '在團' && canLeadSquad_(cub).ok, squadStaff: squadStaffNames_(cub.squad) },
    roles: roleHistory_(cub.cubId),
    trial: cub.status === Logic.TRIAL || cub.trialStart ? Logic.trialProgress(att, ctx.settings['體驗所需出席次數']) : null,
    units: p.units.map(function (u) {
      var info = units[u.category + '|' + u.unit] || {};
      return {
        category: u.category, unit: u.unit, group: info.group || '', order: info.order || 9999, status: u.status, done: u.done, total: u.total,
        eligible: u.eligible, eligibleDate: u.eligibleDate, waitingUntil: u.waitingUntil || '', attendRequired: u.attendRequired || 0, attendSinceLast: u.attendSinceLast || 0,
        lastCompletionDate: u.lastCompletionDate, awardDate: u.awardDate, awardOccasion: u.awardOccasion || '',
        items: u.items.map(function (i) {
          var s = signerOf[i.id];
          return { id: i.id, section: i.section, text: i.text, done: i.done, date: i.date, auto: i.auto, signer: i.done ? (names[s] || (i.auto ? '出席自動計算' : s || '')) : '', canRevoke: !!(i.done && !i.auto && s && Logic.canRevokeSignoff(who.admin.role, who.account.accountId, s)), details: detailsView_(byItem, i.id) };
        })
      };
    }).sort(function (a, b) { return a.order - b.order; }),
    attendance: { counts: Logic.attendanceCounts(att), rate: rate }
  };
});

/** 總覽：小狼 × 進程級別完成度 */
registerAdmin_('overview', 'viewOverview', function () {
  var ctx = progressCtx_();
  var rows = loadCubs_().filter(function (c) { return c.status === '在團'; }).map(function (c) {
    var p = progressOf_(ctx, c.cubId);
    var levels = {};
    var badges = 0;
    p.units.forEach(function (u) {
      if (u.category === Logic.CATEGORY.PROGRESS) levels[u.unit] = { done: u.done, total: u.total, status: u.status, eligible: u.eligible };
      else if (u.status === Logic.STATUS.AWARDED) badges++;
    });
    var att = Logic.attendanceCounts(ctx.attByCub[c.cubId] || []);
    return { cubId: c.cubId, name: c.name, squad: c.squad, currentLevel: p.currentLevel || '', levels: levels, badges: badges, attended: att.attended };
  });
  return { rows: rows, squads: squadsOf_(loadCubs_()) };
});

// ───────────── 頒章、修改、撤銷、補登 ─────────────

/**
 * 批次頒章：多位小狼 × 多個級別或章，共用頒發日期與場合。
 * 需要確認的情況（未來日期、未滿間隔或出席次數）回傳 needConfirm，前端確認後帶 confirm:true 重送。
 */
registerAdmin_('award', 'award', function (req, who) {
  var date = requireDate_(Logic.clean(req.date), '頒發日期');
  var occasion = Logic.clean(req.occasion).slice(0, 50), note = Logic.clean(req.note).slice(0, 200);
  var entries = (req.entries || []).slice(0, 500);
  if (!entries.length) throw new ApiError(ERR.BAD_INPUT, '請選擇要頒發的小狼與級別或技能章。');
  return withLock_(function () {
    var ctx = progressCtx_();
    var cubs = {};
    loadCubs_().forEach(function (c) { cubs[c.cubId] = c; });
    var errors = [], warnings = [], ok = [];
    if (date > ctx.today) warnings.push('頒發日期 ' + date + ' 是未來的日期。');
    entries.forEach(function (e) {
      var cub = cubs[Logic.clean(e.cubId)];
      if (!cub || cub.status !== '在團') { errors.push('找不到在團的小狼'); return; }
      var u = progressOf_(ctx, cub.cubId).units.filter(function (x) { return x.unit === Logic.clean(e.unit); })[0];
      var label = cub.name + '・' + Logic.clean(e.unit);
      if (!u) { errors.push(label + '：找不到這個級別或技能章'); return; }
      if (u.status === Logic.STATUS.AWARDED) { errors.push(label + '：已經頒發過了'); return; }
      if (u.status !== Logic.STATUS.DONE_PENDING) { errors.push(label + '：項目還沒全部完成（已完成 ' + u.done + '／' + u.total + '）；上線前已有的章請用「補登」'); return; }
      if (u.category === Logic.CATEGORY.PROGRESS && u.unit !== Logic.LEVELS[0]) {
        var prev = Logic.LEVELS[Logic.LEVELS.indexOf(u.unit) - 1];
        if (!ctx.awards.some(function (a) { return a.cubId === cub.cubId && a.unit === prev; })) { errors.push(label + '：' + prev + (prev === Logic.NEWBIE ? '' : '級') + '還沒有頒發紀錄，請先頒發或補登'); return; }
      }
      var v = Logic.validateAwardDate(date, u.lastCompletionDate, ctx.today);
      if (!v.ok) { errors.push(label + '：' + v.error); return; }
      if (!u.eligible) {
        warnings.push(label + '：' + (u.waitingUntil ? '晉級間隔要到 ' + u.waitingUntil + ' 才滿' : '上一級頒發後出席 ' + (u.attendSinceLast || 0) + '／' + (u.attendRequired || 0) + ' 次，尚未達到'));
      }
      ok.push({ cub: cub, unit: u });
    });
    if (errors.length) throw new ApiError(ERR.BAD_INPUT, errors.join('\n'));
    if (warnings.length && !req.confirm) return { needConfirm: true, warnings: warnings };
    var now = new Date();
    appendRows_(SHEET.AWARDS, ok.map(function (x) { return [x.cub.cubId, x.unit.unit, date, occasion, note, who.account.accountId, now]; }));
    var touched = {};
    ok.forEach(function (x) {
      logOp_(who.account.accountId, '頒章', x.cub.cubId, '', x.unit.unit + ' ' + date + (occasion ? ' ' + occasion : ''));
      if (x.unit.category === Logic.CATEGORY.PROGRESS) touched[x.cub.cubId] = true;
    });
    Object.keys(touched).forEach(refreshCubLevel_);
    // 階段 5：依設定推播恭喜訊息（目前規格：家長不收推播）
    return { added: ok.length };
  });
});

function findAward_(cubId, unit) {
  var a = loadAwards_().filter(function (x) { return x.cubId === Logic.clean(cubId) && x.unit === Logic.clean(unit); })[0];
  if (!a) throw new ApiError(ERR.NOT_FOUND, '找不到這筆頒章紀錄。');
  return a;
}

registerAdmin_('awardEdit', 'award', function (req, who) {
  var date = requireDate_(Logic.clean(req.date), '頒發日期');
  return withLock_(function () {
    var a = findAward_(req.cubId, req.unit);
    var ctx = progressCtx_();
    var u = progressOf_(ctx, a.cubId).units.filter(function (x) { return x.unit === a.unit; })[0];
    var v = Logic.validateAwardDate(date, u ? u.lastCompletionDate : null, ctx.today);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    if (v.needConfirmFuture && !req.confirm) return { needConfirm: true, warnings: ['頒發日期 ' + date + ' 是未來的日期。'] };
    var raw = readRows_(SHEET.AWARDS).filter(function (r) { return r._row === a._row; })[0];
    var row = raw.slice(0, HEADERS[SHEET.AWARDS].length);
    var before = [a.date, a.occasion, a.note].join('／');
    row[2] = date; row[3] = Logic.clean(req.occasion).slice(0, 50); row[4] = Logic.clean(req.note).slice(0, 200);
    updateRows_(SHEET.AWARDS, [{ row: a._row, values: row }]);
    logOp_(who.account.accountId, '修改頒章', a.cubId, a.unit + ' ' + before, a.unit + ' ' + [row[2], row[3], row[4]].join('／'));
    return {};
  });
});

registerAdmin_('awardRevoke', 'award', function (req, who) {
  return withLock_(function () {
    var a = findAward_(req.cubId, req.unit);
    deleteRows_(SHEET.AWARDS, [a._row]);
    logOp_(who.account.accountId, '撤銷頒章', a.cubId, [a.unit, a.date, a.occasion, a.note, a.signer].join('／'), '');
    if (Logic.LEVELS.indexOf(a.unit) >= 0) refreshCubLevel_(a.cubId);
    // 階段 5：重算達標、清除不再達標的通知紀錄
    return {};
  });
});

/**
 * 直接補登頒章（系統上線用）：寫入頒章紀錄，並把該級別或章的啟用項目標記完成（備註「上線補登」）。
 * 進程較低級別沒有紀錄時先回 needConfirm；includeLower=true 時一併補登（同一天），false 時只補這一級。
 * 補登不觸發任何推播。
 */
registerAdmin_('backfill', 'backfill', function (req, who) {
  var date = requireDate_(Logic.clean(req.date), '頒發日期');
  if (date > today_()) throw new ApiError(ERR.BAD_INPUT, '補登的頒發日期不可以是未來的日期。');
  var unit = Logic.clean(req.unit);
  var category = Logic.LEVELS.indexOf(unit) >= 0 ? Logic.CATEGORY.PROGRESS : Logic.CATEGORY.BADGE;
  return withLock_(function () {
    var cub = findCub_(req.cubId);
    var items = loadItems_().items;
    if (!items.some(function (i) { return i.unit === unit && i.category === category; })) throw new ApiError(ERR.BAD_INPUT, '找不到這個級別或技能章。');
    var plan = Logic.planBackfill({ cubId: cub.cubId, category: category, unit: unit, date: date, occasion: Logic.clean(req.occasion), signer: who.account.accountId, items: items, completions: loadCompletions_(), awards: loadAwards_() });
    if (plan.alreadyAwarded) throw new ApiError(ERR.BAD_INPUT, cub.name + ' 的' + unit + '已經有頒章紀錄了。');
    if (plan.missingLowerLevels.length && req.includeLower === undefined) return { needConfirm: true, missingLowerLevels: plan.missingLowerLevels };
    var plans = [plan];
    if (req.includeLower === true) {
      // 較低級別依級別順序（由低到高）排在前面
      plans = plan.missingLowerLevels.map(function (lv) {
        return Logic.planBackfill({ cubId: cub.cubId, category: Logic.CATEGORY.PROGRESS, unit: lv, date: date, occasion: Logic.clean(req.occasion), signer: who.account.accountId, items: items, completions: loadCompletions_(), awards: loadAwards_() });
      }).concat(plans);
    }
    var comps = [], awards = [], now = new Date();
    plans.forEach(function (p) {
      p.newCompletions.forEach(function (c) { comps.push(Logic.completionToRow(c)); });
      awards.push([p.award.cubId, p.award.unit, p.award.date, p.award.occasion, p.award.note, p.award.signer, now]);
    });
    appendRows_(SHEET.COMPLETIONS, comps);
    appendRows_(SHEET.AWARDS, awards);
    plans.forEach(function (p) { logOp_(who.account.accountId, '補登頒章', cub.cubId, '', p.award.unit + ' ' + date); });
    refreshCubLevel_(cub.cubId);
    return { awarded: plans.map(function (p) { return p.award.unit; }), completions: comps.length };
  });
});

// ───────────── 管理員與帳號 ─────────────

function accountsById_() {
  var m = {};
  loadAccounts_().forEach(function (a) { m[a.accountId] = a; });
  return m;
}

registerAdmin_('adminList', 'manageAdmins', function () {
  var acc = accountsById_();
  var names = adminNames_();
  var rows = readRows_(SHEET.ADMINS).filter(function (r) { return Logic.clean(r[0]); });
  return {
    admins: rows.map(function (r) {
      var id = Logic.clean(r[0]);
      return { accountId: id, name: Logic.clean(r[1]), role: Logic.clean(r[2]), username: (acc[id] || {}).username || '（帳號已刪除）', joinedAt: ms_(r[3]), assignedBy: names[Logic.clean(r[4])] || Logic.clean(r[4]), lineLinked: !!Logic.clean(r[5]) };
    })
  };
});

/** 方式一：從已註冊的帳號指定為管理員 */
registerAdmin_('adminAdd', 'manageAdmins', function (req, who) {
  var role = Logic.clean(req.role), name = Logic.clean(req.name).slice(0, 30);
  if (!name) throw new ApiError(ERR.BAD_INPUT, '請填寫要顯示的姓名。');
  return withLock_(function () {
    var target = accountsById_()[Logic.clean(req.accountId)];
    if (!target || target.status !== '啟用') throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    var v = Logic.validateAdminChange(loadAdmins_(), who.account.accountId, { type: 'add', targetId: target.accountId, role: role });
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    appendRows_(SHEET.ADMINS, [[target.accountId, name, role, new Date(), who.account.accountId, '', '']]);
    logOp_(who.account.accountId, '指定管理員', target.username, '', role + '：' + name);
    // 階段 5：推播通知當事人
    return {};
  });
});

registerAdmin_('adminUpdate', 'manageAdmins', function (req, who) {
  return withLock_(function () {
    var admins = loadAdmins_();
    var t = admins.filter(function (a) { return a.accountId === Logic.clean(req.accountId); })[0];
    if (!t) throw new ApiError(ERR.NOT_FOUND, '找不到這位管理員。');
    var row = t._raw.slice(0, HEADERS[SHEET.ADMINS].length);
    var before = row[2] + '：' + row[1];
    if (req.role && Logic.clean(req.role) !== t.role) {
      var v = Logic.validateAdminChange(admins, who.account.accountId, { type: 'setRole', targetId: t.accountId, role: Logic.clean(req.role) });
      if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
      row[2] = Logic.clean(req.role);
    } else if (!Logic.can(who.admin.role, 'manageAdmins')) throw new ApiError(ERR.FORBIDDEN, '你沒有權限執行這個操作。');
    if (req.name !== undefined) {
      var n = Logic.clean(req.name).slice(0, 30);
      if (!n) throw new ApiError(ERR.BAD_INPUT, '姓名不可空白。');
      row[1] = n;
    }
    updateRows_(SHEET.ADMINS, [{ row: t._row, values: row }]);
    logOp_(who.account.accountId, '變更管理員', t.accountId, before, row[2] + '：' + row[1]);
    return {};
  });
});

registerAdmin_('adminRemove', 'manageAdmins', function (req, who) {
  return withLock_(function () {
    var admins = loadAdmins_();
    var t = admins.filter(function (a) { return a.accountId === Logic.clean(req.accountId); })[0];
    if (!t) throw new ApiError(ERR.NOT_FOUND, '找不到這位管理員。');
    var v = Logic.validateAdminChange(admins, who.account.accountId, { type: 'remove', targetId: t.accountId });
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    deleteRows_(SHEET.ADMINS, [t._row]);
    logOp_(who.account.accountId, '移除管理員', t.accountId, t.role + '：' + t.name, '');
    return {};
  });
});

registerAdmin_('inviteList', 'manageInvites', function () {
  var names = adminNames_(), now = Date.now();
  return {
    invites: loadInvites_().filter(function (i) { return i.status === '未使用'; }).map(function (i) {
      return { code: i.code, role: i.role, name: i.name, createdBy: names[i.createdBy] || i.createdBy, expiresAt: i.expiresAt, expired: now > i.expiresAt };
    })
  };
});

registerAdmin_('inviteVoid', 'manageInvites', function (req, who) {
  return withLock_(function () {
    var inv = loadInvites_().filter(function (i) { return i.code === Logic.normalizeCode(req.code) && i.status === '未使用'; })[0];
    if (!inv) throw new ApiError(ERR.NOT_FOUND, '找不到這組未使用的邀請碼。');
    var row = inv._raw.slice(0, HEADERS[SHEET.INVITES].length);
    row[6] = '已作廢';
    updateRows_(SHEET.INVITES, [{ row: inv._row, values: row }]);
    logOp_(who.account.accountId, '作廢邀請碼', inv.name, '未使用', '已作廢');
    return {};
  });
});

registerAdmin_('accountList', 'manageAccounts', function () {
  var cubs = {};
  loadCubs_().forEach(function (c) { cubs[c.cubId] = c.name; });
  var bound = {};
  loadBindings_().forEach(function (b) { (bound[b.accountId] = bound[b.accountId] || []).push(cubs[b.cubId] || '（已刪除）'); });
  var roles = {};
  loadAdmins_().forEach(function (a) { roles[a.accountId] = a.role; });
  return {
    accounts: readRows_(SHEET.ACCOUNTS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
      var id = Logic.clean(r[0]);
      return { accountId: id, username: Logic.clean(r[1]), nickname: Logic.clean(r[2]), status: Logic.clean(r[5]) || '啟用', createdAt: ms_(r[6]), lastLogin: ms_(r[7]), cubs: bound[id] || [], role: roles[id] || '' };
    })
  };
});

/** 忘記密碼：產生一次性臨時碼（只存雜湊），該帳號所有登入立即失效 */
registerAdmin_('accountTempCode', 'manageAccounts', function (req, who) {
  return withLock_(function () {
    var acc = accountsById_()[Logic.clean(req.accountId)];
    if (!acc) throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    var settings = loadSettings_().values;
    var code = Logic.generateCode(8, randInt_, []);
    var exp = new Date(Date.now() + settings['臨時碼有效小時數'] * 3600000);
    var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
    row[8] = sha256Hex_(code); row[9] = exp;
    updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
    purgeSessions_(acc.accountId);
    logOp_(who.account.accountId, '產生臨時碼', acc.username, '', ''); // 不記臨時碼
    var url = PropertiesService.getScriptProperties().getProperty('WEB_URL') || DEFAULT_WEB_URL;
    var msgText = acc.nickname + ' 您好，這是 22 團幼童軍進程系統的密碼重設臨時碼：\n' +
      '帳號：' + acc.username + '\n臨時碼：' + code + '\n' +
      '請打開 ' + url + ' →「忘記密碼？」→ 輸入帳號、臨時碼與新密碼。\n' +
      '臨時碼只能用一次，' + Utilities.formatDate(exp, TZ, 'MM/dd HH:mm') + ' 前有效。';
    return { code: code, expiresAt: exp.getTime(), message: msgText };
  });
});

registerAdmin_('accountStatus', 'manageAccounts', function (req, who) {
  var status = Logic.clean(req.status);
  if (status !== '啟用' && status !== '停用') throw new ApiError(ERR.BAD_INPUT, '狀態只能是啟用或停用。');
  return withLock_(function () {
    var acc = accountsById_()[Logic.clean(req.accountId)];
    if (!acc) throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    if (status === '停用') {
      if (acc.accountId === who.account.accountId) throw new ApiError(ERR.BAD_INPUT, '不可以停用自己的帳號。');
      var c = Logic.canDeleteAccount(loadAdmins_(), acc.accountId);
      if (!c.ok) throw new ApiError(ERR.BAD_INPUT, c.error.replace('刪除', '停用'));
    }
    var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
    var before = row[5];
    row[5] = status;
    updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
    if (status === '停用') purgeSessions_(acc.accountId);
    logOp_(who.account.accountId, '帳號' + status, acc.username, before, status);
    return {};
  });
});

/** 刪除帳號（家長要求時）：刪帳號、登入憑證、綁定、管理員身分；小狼資料不受影響 */
registerAdmin_('accountDelete', 'manageAccounts', function (req, who) {
  return withLock_(function () {
    var acc = accountsById_()[Logic.clean(req.accountId)];
    if (!acc) throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    if (Logic.clean(req.confirmUsername) !== acc.username) throw new ApiError(ERR.BAD_INPUT, '請輸入正確的帳號名稱以確認刪除。');
    if (acc.accountId === who.account.accountId) throw new ApiError(ERR.BAD_INPUT, '不可以刪除自己的帳號。');
    var admins = loadAdmins_();
    var c = Logic.canDeleteAccount(admins, acc.accountId);
    if (!c.ok) throw new ApiError(ERR.BAD_INPUT, c.error);
    purgeSessions_(acc.accountId);
    deleteRows_(SHEET.BINDINGS, loadBindings_().filter(function (b) { return b.accountId === acc.accountId; }).map(function (b) { return b._row; }));
    deleteRows_(SHEET.ADMINS, admins.filter(function (a) { return a.accountId === acc.accountId; }).map(function (a) { return a._row; }));
    deleteRows_(SHEET.REQUESTS, loadRequests_().filter(function (r) { return r.accountId === acc.accountId; }).map(function (r) { return r._row; }));
    deleteRows_(SHEET.ACCOUNTS, [acc._row]);
    logOp_(who.account.accountId, '刪除帳號', acc.accountId, '', '');
    return {};
  });
});

// ───────────── 設定（SPEC 7.8，團長專用） ─────────────

registerAdmin_('settingsGet', 'manageSettings', function () {
  var parsed = loadSettings_();
  var raw = {};
  readRows_(SHEET.SETTINGS).forEach(function (r) { var k = Logic.clean(r[0]); if (k) raw[k] = Logic.clean(r[1]); });
  var errs = {};
  parsed.errors.forEach(function (e) { errs[e.key] = e.reason; });
  var c = latestConsent_();
  return {
    settings: Logic.SETTINGS.filter(function (s) { return s.type !== 'list'; }).map(function (s) {
      var v = parsed.values[s.key];
      return {
        key: s.key, type: s.type, desc: s.desc, min: s.min, max: s.max,
        value: s.type === 'bool' ? (v ? '是' : '否') : String(v), sheetValue: raw[s.key] === undefined ? '' : raw[s.key], error: errs[s.key] || ''
      };
    }),
    consent: c ? { version: c.version, content: c.content, effective: c.effective } : null
  };
});

/** 修改設定：全部檢查通過才寫入；修改前後的值寫入操作日誌 */
registerAdmin_('settingsSave', 'manageSettings', function (req, who) {
  var changes = req.changes || {};
  var keys = Object.keys(changes);
  if (!keys.length) throw new ApiError(ERR.BAD_INPUT, '沒有要修改的設定。');
  var stored = {}, errors = [];
  keys.forEach(function (k) {
    var v = Logic.validateSettingValue(k, changes[k]);
    if (v.ok) stored[k] = v.stored; else errors.push(v.error);
  });
  if (errors.length) throw new ApiError(ERR.BAD_INPUT, errors.join('\n'));
  return withLock_(function () {
    var rows = readRows_(SHEET.SETTINGS);
    var ups = [], adds = [], changed = 0;
    keys.forEach(function (k) {
      var r = rows.filter(function (x) { return Logic.clean(x[0]) === k; })[0];
      if (r) {
        if (Logic.clean(r[1]) === stored[k]) return;
        ups.push({ row: r._row, values: [k, stored[k], r[2] === undefined ? '' : r[2]] });
        logOp_(who.account.accountId, '修改設定', k, Logic.clean(r[1]), stored[k]);
      } else {
        var def = Logic.SETTINGS.filter(function (s) { return s.key === k; })[0];
        adds.push([k, stored[k], def.desc]);
        logOp_(who.account.accountId, '修改設定', k, '', stored[k]);
      }
      changed++;
    });
    if (ups.length) updateRows_(SHEET.SETTINGS, ups);
    if (adds.length) appendRows_(SHEET.SETTINGS, adds);
    if (stored['每日排程時間（幾點）'] !== undefined) { try { ensureDailyTrigger_(); } catch (e) { /* 沒有排程權限時略過，setup 會再裝 */ } }
    return { changed: changed };
  });
});

/** 個資說明改版：新增一列（版本 +1），舊版保留；家長下次登入要重新同意 */
registerAdmin_('consentSave', 'manageSettings', function (req, who) {
  var content = String(req.content || '').replace(/\r\n/g, '\n').trim();
  if (content.length < 20) throw new ApiError(ERR.BAD_INPUT, '個資說明內容太短了。');
  if (content.length > 10000) throw new ApiError(ERR.BAD_INPUT, '個資說明最多 10000 字。');
  return withLock_(function () {
    var c = latestConsent_();
    if (c && c.content.trim() === content) throw new ApiError(ERR.BAD_INPUT, '內容沒有變更。');
    var version = (c ? c.version : 0) + 1;
    appendRows_(SHEET.CONSENT, [[version, content, today_()]]);
    logOp_(who.account.accountId, '個資說明改版', '第 ' + version + ' 版', c ? '第 ' + c.version + ' 版' : '', '第 ' + version + ' 版');
    return { version: version };
  });
});

// ───────────── 註冊申請審核（SPEC 附錄第 31 點，團長專用） ─────────────

registerAdmin_('requestList', 'reviewRequests', function () {
  var accounts = accountsById_();
  var cubs = loadCubs_().filter(function (c) { return c.status === '在團' || c.status === Logic.TRIAL; });
  var adminIds = {};
  loadAdmins_().forEach(function (a) { adminIds[a.accountId] = true; });
  var items = loadRequests_().filter(function (r) { return r.status === '待審核'; }).sort(function (a, b) { return a.at - b.at; }).map(function (r) {
    var acc = accounts[r.accountId] || {};
    return {
      requestId: r.requestId, type: r.type, name: r.name, at: r.at ? new Date(r.at).toISOString() : '',
      nickname: acc.nickname || '（帳號已刪除）', username: acc.username || '', isAdmin: !!adminIds[r.accountId],
      // 同名的在團小狼（例如爸爸媽媽各自註冊同一個孩子），審核時建議直接連結
      sameName: r.type === '孩子' ? cubs.filter(function (c) { return c.name === r.name; }).map(function (c) { return c.cubId; }) : []
    };
  });
  var settings = loadSettings_().values;
  return {
    items: items,
    cubs: cubs.map(function (c) { return { cubId: c.cubId, name: c.name, squad: c.squad }; }),
    squads: settings['小隊清單'] || [],
    today: today_()
  };
});

/** 取出一筆待審核申請，帳號必須仍在且啟用 */
function pendingRequest_(requestId) {
  var r = loadRequests_().filter(function (x) { return x.requestId === Logic.clean(requestId); })[0];
  if (!r || r.status !== '待審核') throw new ApiError(ERR.NOT_FOUND, '找不到這筆申請，可能已經處理過了，請重新整理。');
  var acc = accountsById_()[r.accountId];
  if (!acc || acc.status !== '啟用') throw new ApiError(ERR.BAD_INPUT, '申請人的帳號已停用或刪除，請按「退回」。');
  return { req: r, acc: acc };
}

/** 結案：寫入結果並清掉申請時填的姓名（姓名已在小狼名單或管理員名單，不重複保存） */
function closeRequest_(r, status, who, cubId, note) {
  var row = r._raw.slice(0, HEADERS[SHEET.REQUESTS].length);
  row[3] = ''; row[5] = status; row[6] = who.account.accountId; row[7] = new Date(); row[8] = cubId || ''; row[10] = Logic.clean(note).slice(0, 100);
  updateRows_(SHEET.REQUESTS, [{ row: r._row, values: row }]);
}

/**
 * 核准：
 * - 孩子：mode='new' 新增小狼（姓名可修正、選小隊、填入團日）或 mode='link' 連結到現有小狼，並綁定申請人帳號。
 * - 服務員：把申請人設為服務員（姓名可修正）。
 */
registerAdmin_('requestApprove', 'reviewRequests', function (req, who) {
  return withLock_(function () {
    var p = pendingRequest_(req.requestId), r = p.req;
    if (r.type === '服務員') {
      var name = Logic.clean(req.name).slice(0, 30) || r.name;
      if (!name) throw new ApiError(ERR.BAD_INPUT, '請填寫服務員姓名。');
      var admins = loadAdmins_();
      if (!admins.some(function (a) { return a.accountId === r.accountId; })) {
        var v = Logic.validateAdminChange(admins, who.account.accountId, { type: 'add', targetId: r.accountId, role: Logic.ROLE.ASSISTANT });
        if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
        appendRows_(SHEET.ADMINS, [[r.accountId, name, Logic.ROLE.ASSISTANT, new Date(), who.account.accountId, '', '']]);
      }
      closeRequest_(r, '已核准', who, '', '');
      logOp_(who.account.accountId, '核准服務員申請', p.acc.username, '', '服務員：' + name);
      return { type: '服務員' };
    }
    var cub;
    if (Logic.clean(req.mode) === 'link') {
      cub = findCub_(req.cubId);
      if (cub.status !== '在團' && cub.status !== Logic.TRIAL) throw new ApiError(ERR.BAD_INPUT, '只能連結在團的小狼或體驗者。');
    } else {
      var cname = Logic.clean(req.name).replace(/\s+/g, '') || r.name;
      if (!cname || cname.length > 30) throw new ApiError(ERR.BAD_INPUT, '請填寫小狼姓名（最多 30 字）。');
      var squad = requireSquad_(Logic.clean(req.squad).slice(0, 20));
      // mode='trial'：新增為體驗者（日期是體驗開始日）；否則直接入團（日期是入團日）
      var asTrial = Logic.clean(req.mode) === 'trial';
      var joinDate = requireDate_(Logic.clean(req.joinDate), asTrial ? '體驗開始日' : '入團日');
      var settings = loadSettings_().values;
      var id = newId_('C', loadCubs_().map(function (c) { return c.cubId; }));
      var code = Logic.generateCode(settings['綁定碼長度'], randInt_, allCodes_());
      appendRows_(SHEET.CUBS, [[id, cname, squad, asTrial ? '' : joinDate, '', code, settings['綁定碼可用次數'], asTrial ? Logic.TRIAL : '在團', '', asTrial ? joinDate : '']]);
      logOp_(who.account.accountId, asTrial ? '新增體驗者' : '新增小狼', id, '', [cname, squad, (asTrial ? '體驗開始 ' : '') + joinDate].join('／') + '（註冊申請）');
      cub = findCub_(id);
    }
    // 綁定：同意時間與版本沿用申請時的紀錄（家長送出申請時已同意）
    var exists = loadBindings_().some(function (b) { return b.accountId === r.accountId && b.cubId === cub.cubId; });
    if (!exists) appendRows_(SHEET.BINDINGS, [[r.accountId, cub.cubId, new Date(), new Date(r.at || Date.now()), r.consentVersion]]);
    closeRequest_(r, '已核准', who, cub.cubId, '');
    logOp_(who.account.accountId, '核准孩子申請', cub.cubId, '', '綁定帳號 ' + p.acc.username);
    return { type: '孩子', cubId: cub.cubId };
  });
});

registerAdmin_('requestReject', 'reviewRequests', function (req, who) {
  return withLock_(function () {
    var r = loadRequests_().filter(function (x) { return x.requestId === Logic.clean(req.requestId); })[0];
    if (!r || r.status !== '待審核') throw new ApiError(ERR.NOT_FOUND, '找不到這筆申請，可能已經處理過了，請重新整理。');
    closeRequest_(r, '已退回', who, '', req.note);
    logOp_(who.account.accountId, '退回註冊申請', r.requestId, '', r.type);
    return {};
  });
});

// ───────────── 集會行事曆、點名、出席 ─────────────

registerAdmin_('meetingList', 'attendance', function () {
  var count = {};
  loadAttendance_().forEach(function (a) { if (a.status === '出席') count[a.meetingId] = (count[a.meetingId] || 0) + 1; });
  var list = loadMeetings_().filter(function (m) { return Logic.isDateStr(m.date); }).map(function (m) {
    return { meetingId: m.meetingId, date: m.date, name: m.name, note: m.note, enabled: m.enabled, type: m.type, attended: count[m.meetingId] || 0 };
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { meetings: list, today: today_(), defaultId: defaultMeetingId_(list, today_()) };
});

/** 點名預設：今天的集會；今天沒有就選日期最接近的一場 */
function defaultMeetingId_(list, today) {
  var best = null, bestDiff = Infinity;
  list.filter(function (m) { return m.enabled; }).forEach(function (m) {
    var diff = Math.abs(Date.parse(m.date) - Date.parse(today));
    if (diff < bestDiff || (diff === bestDiff && m.date < today)) { best = m; bestDiff = diff; }
  });
  return best ? best.meetingId : null;
}

/**
 * 新增或修改集會：
 *  - 一次新增多筆：lines = "2026-11-22 團集會\n2026/11/29 露營"（名稱省略時為「團集會」）
 *  - 修改一筆：meetingId + date + name + note；enabled 可改為 false（取消，不刪除）
 */
registerAdmin_('meetingSave', 'manageCalendar', function (req, who) {
  return withLock_(function () {
    var meetings = loadMeetings_();
    if (req.meetingId) {
      var m = meetings.filter(function (x) { return x.meetingId === Logic.clean(req.meetingId); })[0];
      if (!m) throw new ApiError(ERR.NOT_FOUND, '找不到這場集會。');
      var raw = readRows_(SHEET.MEETINGS).filter(function (r) { return r._row === m._row; })[0];
      var row = raw.slice(0, HEADERS[SHEET.MEETINGS].length);
      var before = [m.date, m.name, m.enabled ? '是' : '否'].join('／');
      if (req.date !== undefined) row[1] = requireDate_(Logic.clean(req.date));
      if (req.name !== undefined) row[2] = Logic.clean(req.name).slice(0, 40) || '團集會';
      if (req.note !== undefined) row[3] = Logic.clean(req.note).slice(0, 100);
      if (req.enabled !== undefined) row[4] = req.enabled ? '是' : '否';
      if (req.type !== undefined) { if (Logic.MEETING_TYPES.indexOf(Logic.clean(req.type)) < 0) throw new ApiError(ERR.BAD_INPUT, '類型只能是一般或大活動。'); row[7] = Logic.clean(req.type); }
      updateRows_(SHEET.MEETINGS, [{ row: m._row, values: row }]);
      logOp_(who.account.accountId, '修改集會', m.meetingId, before + '／' + m.type, [row[1], row[2], row[4], row[7] || '一般'].join('／'));
      return { updated: 1 };
    }
    var ids = meetings.map(function (x) { return x.meetingId; });
    var add = [], bad = [], now = new Date();
    String(req.lines || '').split(/\r?\n/).forEach(function (line, i) {
      line = line.trim();
      if (!line) return;
      var mm = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\s*(.*)$/.exec(line);
      var d = mm ? mm[1] + '-' + ('0' + mm[2]).slice(-2) + '-' + ('0' + mm[3]).slice(-2) : '';
      if (!Logic.isDateStr(d)) { bad.push('第 ' + (i + 1) + ' 行：' + line); return; }
      var id = newId_('M', ids);
      ids.push(id);
      // 名稱裡有「大活動」就標成大活動（體驗者不算、點名不列體驗者）
      var nm = (mm[4] || '').trim().slice(0, 40) || '團集會';
      add.push([id, d, nm, '', '是', who.account.accountId, now, /大活動/.test(nm) ? '大活動' : '一般']);
    });
    if (!add.length) throw new ApiError(ERR.BAD_INPUT, '沒有可新增的集會。每行格式：2026-11-22 團集會' + (bad.length ? '\n看不懂的行：\n' + bad.join('\n') : ''));
    appendRows_(SHEET.MEETINGS, add);
    logOp_(who.account.accountId, '新增集會', add.length + ' 場', '', add.map(function (r) { return r[1]; }).join('、'));
    return { added: add.length, bad: bad };
  });
});

/** 該集會當天在團的小狼 */
function cubsOnDate_(date, type) {
  return loadCubs_().filter(function (c) {
    if (c.status === '已匿名') return false;
    if ((c.status === '離團' || c.status === Logic.GRADUATED) && c.leftDate && c.leftDate < date) return false;
    if (c.joinDate && c.joinDate <= date) return true;
    // 體驗者（含已轉入團者的體驗期間）：只參加「一般」團集會
    return !!(c.trialStart && c.trialStart <= date && (type || '一般') === '一般');
  });
}

registerAdmin_('attendanceSheet', 'attendance', function (req) {
  var m = loadMeetings_().filter(function (x) { return x.meetingId === Logic.clean(req.meetingId); })[0];
  if (!m || !m.enabled) throw new ApiError(ERR.NOT_FOUND, '找不到這場集會。');
  var st = {};
  loadAttendance_().forEach(function (a) { if (a.meetingId === m.meetingId) st[a.cubId] = a.status; });
  var cubs = cubsOnDate_(m.date, m.type).map(function (c) { return { cubId: c.cubId, name: c.name, squad: c.squad, status: st[c.cubId] || '', trial: !(c.joinDate && c.joinDate <= m.date) }; });
  return { meeting: { meetingId: m.meetingId, date: m.date, name: m.name, type: m.type }, cubs: cubs, squads: squadsOf_(loadCubs_()) };
});

/** 儲存點名：只更新送來的小狼（以「集會＋小狼」為單位，同時點名不互相覆蓋）；空白＝刪除該筆 */
registerAdmin_('attendanceSave', 'attendance', function (req, who) {
  var marks = req.marks || {};
  var ids = Object.keys(marks).slice(0, 500);
  if (!ids.length) throw new ApiError(ERR.BAD_INPUT, '沒有要儲存的點名。');
  ids.forEach(function (k) { if (['出席', '請假', ''].indexOf(marks[k]) < 0) throw new ApiError(ERR.BAD_INPUT, '點名狀態只能是出席、請假或空白。'); });
  return withLock_(function () {
    var m = loadMeetings_().filter(function (x) { return x.meetingId === Logic.clean(req.meetingId); })[0];
    if (!m || !m.enabled) throw new ApiError(ERR.NOT_FOUND, '找不到這場集會。');
    var valid = {};
    cubsOnDate_(m.date, m.type).forEach(function (c) { valid[c.cubId] = true; });
    var existing = {};
    loadAttendance_().forEach(function (a) { if (a.meetingId === m.meetingId) existing[a.cubId] = a; });
    var add = [], upd = [], del = [], now = new Date(), changed = 0;
    ids.forEach(function (cubId) {
      if (!valid[cubId]) return;
      var want = marks[cubId], cur = existing[cubId];
      if (cur && cur.status === want) return;
      changed++;
      if (!want) { if (cur) del.push(cur._row); return; }
      if (cur) upd.push({ row: cur._row, values: [m.meetingId, cubId, want, who.account.accountId, now] });
      else add.push([m.meetingId, cubId, want, who.account.accountId, now]);
    });
    updateRows_(SHEET.ATTENDANCE, upd);
    appendRows_(SHEET.ATTENDANCE, add);
    deleteRows_(SHEET.ATTENDANCE, del);
    if (changed) logOp_(who.account.accountId, '點名', m.meetingId, '', m.date + ' 變更 ' + changed + ' 人');
    return { changed: changed };
  });
});

/** 出席總覽：小狼 × 集會（日期區間），含出席次數與本年度出席率 */
registerAdmin_('attendanceOverview', 'viewOverview', function (req) {
  var today = today_();
  var from = Logic.isDateStr(req.from) ? req.from : '0000-01-01', to = Logic.isDateStr(req.to) ? req.to : '9999-12-31';
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && m.date >= from && m.date <= to && m.date <= today; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var mIds = {};
  meetings.forEach(function (m) { mIds[m.meetingId] = m; });
  var st = {}, allAtt = {};
  var enabledMeetings = {};
  loadMeetings_().forEach(function (m) { if (m.enabled) enabledMeetings[m.meetingId] = m; });
  loadAttendance_().forEach(function (a) {
    if (mIds[a.meetingId]) st[a.cubId + '|' + a.meetingId] = a.status;
    if (enabledMeetings[a.meetingId]) (allAtt[a.cubId] = allAtt[a.cubId] || []).push({ date: enabledMeetings[a.meetingId].date, status: a.status });
  });
  var period = Logic.periodOf(loadPeriods_(), today);
  var extra = {};
  if (period) loadExtra_().forEach(function (x) { if (x.period === period.name) extra[x.cubId] = (extra[x.cubId] || 0) + x.count; });
  var rows = loadCubs_().filter(function (c) { return c.status === '在團' || c.status === Logic.TRIAL; }).map(function (c) {
    var cells = meetings.map(function (m) { return st[c.cubId + '|' + m.meetingId] || ''; });
    var counts = { attended: cells.filter(function (x) { return x === '出席'; }).length, leave: cells.filter(function (x) { return x === '請假'; }).length };
    var rate = period ? Logic.attendanceRate(allAtt[c.cubId] || [], period, extra[c.cubId] || 0) : null;
    return { cubId: c.cubId, name: c.name, squad: c.squad, trial: c.status === Logic.TRIAL, cells: cells, counts: counts, extra: extra[c.cubId] || 0, rate: rate ? rate.text : '' };
  });
  return { meetings: meetings.map(function (m) { return { meetingId: m.meetingId, date: m.date, name: m.name }; }), rows: rows, period: period, squads: squadsOf_(loadCubs_()) };
});

registerAdmin_('periodList', 'viewOverview', function () {
  return { periods: loadPeriods_(), current: (Logic.periodOf(loadPeriods_(), today_()) || {}).name || '' };
});

/** 新增或修改年度出席設定（以年度名稱為鍵） */
registerAdmin_('periodSave', 'manageCalendar', function (req, who) {
  var name = Logic.clean(req.name).slice(0, 30);
  if (!name) throw new ApiError(ERR.BAD_INPUT, '請填寫年度名稱，例如「115學年度」。');
  var start = requireDate_(Logic.clean(req.start), '開始日'), end = requireDate_(Logic.clean(req.end), '結束日');
  if (end < start) throw new ApiError(ERR.BAD_INPUT, '結束日不可早於開始日。');
  var total = Number(req.total);
  if (!(total >= 0 && total <= 500 && Math.floor(total) === total)) throw new ApiError(ERR.BAD_INPUT, '應出席總數需為 0～500 的整數。');
  return withLock_(function () {
    var row = [name, start, end, total, Logic.clean(req.note).slice(0, 100)];
    var cur = readRows_(SHEET.PERIODS).filter(function (r) { return Logic.clean(r[0]) === name; })[0];
    if (cur) updateRows_(SHEET.PERIODS, [{ row: cur._row, values: row }]);
    else appendRows_(SHEET.PERIODS, [row]);
    logOp_(who.account.accountId, '設定年度出席', name, cur ? [dateStr_(cur[1]), dateStr_(cur[2]), cur[3]].join('／') : '', [start, end, total].join('／'));
    return {};
  });
});

/** 設定某位小狼某年度的額外出席次數（有參加額外活動才給；0 表示清除） */
registerAdmin_('extraSave', 'manageCalendar', function (req, who) {
  var period = Logic.clean(req.period), cubId = Logic.clean(req.cubId), count = Number(req.count);
  if (!(count >= 0 && count <= 100 && Math.floor(count) === count)) throw new ApiError(ERR.BAD_INPUT, '額外出席次數需為 0～100 的整數。');
  return withLock_(function () {
    if (!loadPeriods_().some(function (p) { return p.name === period; })) throw new ApiError(ERR.NOT_FOUND, '找不到這個年度。');
    findCub_(cubId);
    var cur = readRows_(SHEET.EXTRA).filter(function (r) { return Logic.clean(r[0]) === period && Logic.clean(r[1]) === cubId; });
    var before = cur.length ? String(cur[0][2]) : '0';
    if (cur.length) deleteRows_(SHEET.EXTRA, cur.map(function (r) { return r._row; }));
    if (count > 0) appendRows_(SHEET.EXTRA, [[period, cubId, count, Logic.clean(req.note).slice(0, 100), who.account.accountId, new Date()]]);
    logOp_(who.account.accountId, '設定額外出席', cubId, period + ' ' + before, period + ' ' + count);
    return {};
  });
});

// ───────────── 個資處理（7.10） ─────────────

function privacyData_() {
  var data = {};
  Object.keys(Logic.CUB_ID_COLUMNS).concat([SHEET.LOG]).forEach(function (s) { data[s] = readAll_(s); });
  return data;
}

registerAdmin_('privacyPreview', 'privacy', function (req) {
  var plan = Logic.planPrivacy(privacyData_(), Logic.clean(req.cubId), Logic.clean(req.mode));
  if (!plan.ok) throw new ApiError(ERR.BAD_INPUT, plan.error);
  return { cubName: plan.cubName, counts: plan.counts };
});

/** 執行匿名化或完全刪除：需輸入該小狼姓名確認；日誌不記姓名 */
registerAdmin_('privacyExecute', 'privacy', function (req, who) {
  return withLock_(function () {
    var mode = Logic.clean(req.mode);
    var plan = Logic.planPrivacy(privacyData_(), Logic.clean(req.cubId), mode);
    if (!plan.ok) throw new ApiError(ERR.BAD_INPUT, plan.error);
    if (Logic.clean(req.confirmName) !== plan.cubName) throw new ApiError(ERR.BAD_INPUT, '輸入的姓名不符，未執行。');
    Object.keys(plan.updateRows).forEach(function (s) { updateRows_(s, plan.updateRows[s]); });
    Object.keys(plan.deleteRows).forEach(function (s) { deleteRows_(s, plan.deleteRows[s]); });
    logOp_(who.account.accountId, mode === 'delete' ? '個資處理：完全刪除' : '個資處理：匿名化', '一位小狼', '', '');
    return { counts: plan.counts };
  });
});

// ───────────── 連結 LINE 通知 ─────────────

/** 產生 10 分鐘內有效的 6 位數配對碼；管理員在官方帳號聊天室輸入後完成連結（見 Webhook.js） */
registerAdmin_('lineLinkStart', 'linkLine', function (req, who) {
  var cache = CacheService.getScriptCache();
  var code;
  for (var i = 0; i < 20; i++) {
    code = String(100000 + randInt_(900000));
    if (!cache.get('PAIR_' + code)) break;
  }
  cache.put('PAIR_' + code, who.account.accountId, 600);
  return { code: code, expiresInMin: 10 };
});

registerAdmin_('lineUnlink', 'linkLine', function (req, who) {
  return withLock_(function () {
    var a = loadAdmins_().filter(function (x) { return x.accountId === who.account.accountId; })[0];
    var row = a._raw.slice(0, HEADERS[SHEET.ADMINS].length);
    row[5] = ''; row[6] = '';
    updateRows_(SHEET.ADMINS, [{ row: a._row, values: row }]);
    logOp_(who.account.accountId, '解除 LINE 連結', a.name, '', '');
    return {};
  });
});

// ───────────── 列印簽核單（依小狼或依小隊） ─────────────

/** 一個進程級別、多位小狼的簽核單資料 */
registerAdmin_('printData', 'printSheet', function (req) {
  var unit = Logic.clean(req.unit);
  if (Logic.LEVELS.indexOf(unit) < 0) throw new ApiError(ERR.BAD_INPUT, '請選擇進程級別。');
  var ids = (req.cubIds || []).map(Logic.clean);
  var ctx = progressCtx_();
  var names = adminNames_();
  var signerOf = {};
  ctx.completions.forEach(function (c) { if (Logic.isCountedCompletion(c)) signerOf[c.cubId + '|' + c.itemId] = c.signer; });
  var info = loadUnits_()[Logic.CATEGORY.PROGRESS + '|' + unit] || {};
  var sheets = loadCubs_().filter(function (c) { return ids.indexOf(c.cubId) >= 0; }).map(function (c) {
    var u = progressOf_(ctx, c.cubId).units.filter(function (x) { return x.category === Logic.CATEGORY.PROGRESS && x.unit === unit; })[0];
    return {
      cub: { name: c.name, squad: c.squad, joinDate: c.joinDate },
      awardDate: u.awardDate,
      items: u.items.map(function (i) {
        var s = signerOf[c.cubId + '|' + i.id];
        return { section: i.section, text: i.text, done: i.done, date: i.date, signer: i.done ? (names[s] || (i.auto ? '出席自動計算' : '')) : '' };
      })
    };
  });
  return { unit: unit, rule: info.rule || '', sheets: sheets };
});

// ───────────── 小隊設定 ─────────────

registerAdmin_('squadList', 'viewRoster', function () {
  var count = {};
  loadCubs_().forEach(function (c) { if (c.status === '在團' && c.squad) count[c.squad] = (count[c.squad] || 0) + 1; });
  var list = loadSettings_().values['小隊清單'];
  var extra = Object.keys(count).filter(function (k) { return list.indexOf(k) < 0; });
  var staff = loadSquadStaff_(), names = adminNames_();
  return {
    squads: list.map(function (n) {
      var mine = staff.filter(function (x) { return x.squad === n && names[x.accountId]; });
      return { name: n, count: count[n] || 0, staff: mine.map(function (x) { return { accountId: x.accountId, name: names[x.accountId] }; }) };
    }),
    admins: loadAdmins_().map(function (a) { return { accountId: a.accountId, name: a.name, role: a.role }; }),
    notInList: extra.map(function (n) { return { name: n, count: count[n] }; })
  };
});

/**
 * 小隊清單異動：type = add / rename / remove / move（dir: up/down）
 * 改名時同步更新所有使用該小隊名稱的小狼（含已離團），並寫操作日誌。
 */
registerAdmin_('squadSave', 'manageCubs', function (req, who) {
  return withLock_(function () {
    var cubs = loadCubs_();
    var inUse = cubs.filter(function (c) { return c.status === '在團' && c.squad; }).map(function (c) { return c.squad; });
    var cur = loadSettings_().values['小隊清單'];
    var r = Logic.changeSquads(cur, { type: Logic.clean(req.type), name: req.name, newName: req.newName, dir: req.dir }, inUse);
    if (!r.ok) throw new ApiError(ERR.BAD_INPUT, r.error);
    var row = readRows_(SHEET.SETTINGS).filter(function (x) { return Logic.clean(x[0]) === '小隊清單'; })[0];
    var values = ['小隊清單', r.list.join('、'), (Logic.SETTINGS.filter(function (x) { return x.key === '小隊清單'; })[0] || {}).desc || ''];
    if (row) updateRows_(SHEET.SETTINGS, [{ row: row._row, values: values }]);
    else appendRows_(SHEET.SETTINGS, [values]);
    var moved = 0;
    if (req.type === 'rename') {
      var from = Logic.clean(req.name), to = Logic.clean(req.newName);
      var ups = cubs.filter(function (c) { return c.squad === from; }).map(function (c) {
        var x = cubRow_(c); x[2] = to; return { row: c._row, values: x };
      });
      updateRows_(SHEET.CUBS, ups);
      moved = ups.length;
      var st = readRows_(SHEET.SQUAD_STAFF).filter(function (x) { return Logic.clean(x[0]) === from; });
      if (st.length) updateRows_(SHEET.SQUAD_STAFF, st.map(function (x) { return { row: x._row, values: [to, x[1], x[2], x[3]] }; }));
    }
    if (req.type === 'remove') {
      var gone = loadSquadStaff_().filter(function (x) { return x.squad === Logic.clean(req.name); });
      if (gone.length) deleteRows_(SHEET.SQUAD_STAFF, gone.map(function (x) { return x._row; }));
    }
    logOp_(who.account.accountId, '小隊設定', Logic.clean(req.type), cur.join('、'), r.list.join('、') + (moved ? '（更新 ' + moved + ' 位小狼）' : ''));
    return { squads: r.list, moved: moved };
  });
});
