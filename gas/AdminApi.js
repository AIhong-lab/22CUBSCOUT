/**
 * 後台 API（階段 4A）
 * 每一支都先用 Logic.can(角色, 動作) 在後端檢查權限，不能只靠前端隱藏按鈕。
 *
 * 會修改「完成紀錄」「頒章紀錄」「管理員」既有列的只有規格明定的操作：
 *   撤銷簽核（7.4）、修改／撤銷頒章（7.5）、管理員異動（7.9）、個資處理（7.10）。
 */

// ───────────── 共用 ─────────────

/**
 * 目前這個請求的分團（SPEC 附錄第 73 點⑬）：registerAdmin_ 依登入者的身分設定，
 * 名單、小隊、點名等一律只看這個分團。dispatch_ 每次請求開始時清空。
 */
var CUR_SEC_ = null;
function curSec_() { return CUR_SEC_ || Logic.DEFAULT_SECTION; }
/** 目前分團的團員（試算表分頁仍叫「小狼名單」） */
function secCubs_() { var sec = curSec_(); return loadCubs_().filter(function (c) { return c.section === sec; }); }
/** 目前分團的小隊清單（小狼用「小隊清單」，其他分團用「小隊清單（分團）」） */
function squadListOf_(section) { return Logic.sectionSetting(loadSettings_().values, '小隊清單', section || curSec_()).slice(); }
function sectionSettingOf_(key, section) { return Logic.sectionSetting(loadSettings_().values, key, section || curSec_()); }

/** 只有有進程模組的分團（Logic.PROGRESS_SECTIONS：小狼、稚齡）才能用的後台動作 */
var PROGRESS_ACTIONS = ['signoffData', 'signoff', 'signoffRevoke', 'overview', 'award', 'awardEdit', 'awardRevoke', 'backfill', 'printData',
  'itemsTree', 'itemSave', 'itemToggle', 'itemMove', 'sectionRename', 'unitSave', 'detailSave', 'detailToggle', 'itemsExport', 'itemsReload', 'unitImageSave'];
/** 全團共用功能（由管理員指定誰可以用）：動作 → 功能名稱 */
var SHARED_ACTIONS = {
  siteContentGet: '網站內容', siteContentSave: '網站內容', consentSave: '個資告知',
  accountList: '帳號管理', accountTempCode: '帳號管理', accountStatus: '帳號管理', accountDelete: '帳號管理',
  backupNow: '備份', backupPurge: '備份', permCheck: '備份'
};

/** 這個人能不能用某個全團共用功能 */
function canShared_(who, func) {
  var rules = loadPermRules_();
  var feat = Logic.PERM_FEATURES.filter(function (f) { return f.sharedFunc === func; })[0];
  if (feat && rules[feat.id]) {
    return Logic.allowsFeature(rules[feat.id], {
      loggedIn: true, isOwner: !!who.isOwner, ownerExists: !!ownerId_(),
      isCentral: !!who.isCentral, role: who.admin && who.admin.role, section: who.section || curSec_()
    });
  }
  var level = loadSettings_().values['共用功能權限：' + func];
  return Logic.canShared(level, { isOwner: !!who.isOwner, ownerExists: !!ownerId_(), isCentral: !!who.isCentral, role: who.admin && who.admin.role });
}
/** 能管理「全團」的集會、公告、活動：管理員（admin）或總團；沒有 admin 帳號時照舊由團長 */
function canManageAll_(who) {
  if (who.isOwner || who.isCentral) return true;
  return !ownerId_() && !!who.admin && who.admin.role === Logic.ROLE.LEADER;
}

/** 依目前登入者與動態權限表算出可用分頁與動作 */
function resolveWhoPerms_(who, isParent, isScoutSelf, secOverride) {
  var ctx = {
    loggedIn: true,
    isOwner: !!who.isOwner,
    ownerExists: !!ownerId_(),
    isCentral: !!who.isCentral,
    role: who.admin ? who.admin.role : null,
    section: secOverride || who.section || (typeof CUR_SEC_ !== 'undefined' && CUR_SEC_) || '',
    isParent: !!isParent,
    isScoutSelf: !!isScoutSelf
  };
  return Logic.resolvePermissions(loadPermRules_(), ctx);
}

function requireRole_(who, action) {
  if (!who.admin) throw new ApiError(ERR.FORBIDDEN, '你沒有權限執行這個操作。');
  var resolved = resolveWhoPerms_(who, false);
  var allowed = Object.prototype.hasOwnProperty.call(resolved.actions, action) ? resolved.actions[action] : Logic.can(who.admin.role, action);
  if (!allowed) throw new ApiError(ERR.FORBIDDEN, '你沒有權限執行這個操作。');
}

/** 把後台動作包上權限檢查後註冊到 AUTHED_ACTIONS */
function registerAdmin_(name, permission, fn) {
  AUTHED_ACTIONS[name] = function (req, who) {
    CUR_SEC_ = who.section || null;
    if (Object.prototype.hasOwnProperty.call(SHARED_ACTIONS, name)) {
      if (!who.admin || !canShared_(who, SHARED_ACTIONS[name])) throw new ApiError(ERR.FORBIDDEN, '你沒有權限執行這個操作。');
    } else requireRole_(who, permission);
    if (PROGRESS_ACTIONS.indexOf(name) >= 0 && Logic.PROGRESS_SECTIONS.indexOf(curSec_()) < 0) throw new ApiError(ERR.FORBIDDEN, curSec_() + '的進程功能準備中。');
    var out = fn(req, who);
    clearPublicCache_(); // 後台任何動作之後，公開資料（公佈欄、月曆、活動）重新讀取
    // 階段 5：會影響達標的動作完成後，重算並推播（失敗不影響主要操作；等待確認的不算）
    if (Object.prototype.hasOwnProperty.call(NOTIFY_AFTER, name) && !(out && out.needConfirm)) notifySafely_(NOTIFY_AFTER[name]);
    return out;
  };
}

/** 帳號ID → 管理員姓名（簽核人、建立人顯示用；各分團都算） */
function adminNames_() {
  var m = {};
  loadAdminRows_().forEach(function (a) { if (!m[a.accountId]) m[a.accountId] = a.name; });
  return m;
}
/** 目前分團的管理員：帳號ID → 姓名（小隊輔只能選這些人） */
function adminNamesIn_(section) {
  var m = {};
  loadAdmins_(section).forEach(function (a) { m[a.accountId] = a.name; });
  return m;
}

/** 找團員：後台請求只找得到目前分團的（別的分團的人回同一句話） */
function findCub_(cubId) {
  var c = loadCubs_().filter(function (x) { return x.cubId === Logic.clean(cubId) && (!CUR_SEC_ || x.section === CUR_SEC_); })[0];
  if (!c) throw new ApiError(ERR.NOT_FOUND, '找不到這位團員。');
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
    (attByCub[a.cubId] = attByCub[a.cubId] || []).push({ date: meetings[a.meetingId].date, status: a.status, meetingId: a.meetingId, type: meetings[a.meetingId].type, counts: meetings[a.meetingId].counts });
  });
  var trialEnd = {}, secOf = {}, joinOf = {};
  loadCubs_().forEach(function (c) { if (c.trialStart && c.joinDate) trialEnd[c.cubId] = c.joinDate; secOf[c.cubId] = c.section; joinOf[c.cubId] = c.joinDate; });
  return {
    trialEnd: trialEnd, secOf: secOf, joinOf: joinOf,
    settings: settings, items: loadItems_().items, completions: loadCompletions_(), awards: loadAwards_(),
    meetings: meetings, attByCub: attByCub, today: today_()
  };
}

/** 一位團員的進度：依他所屬分團的進程模組與該分團的設定計算（附錄第 77 點） */
function progressOf_(ctx, cubId) {
  var sec = (ctx.secOf || {})[cubId] || Logic.DEFAULT_SECTION;
  var p = Logic.progressParams(ctx.settings, sec) || { section: sec };
  return Logic.computeCubProgress(Object.assign(p, {
    cubId: cubId, items: ctx.items, completions: ctx.completions, awards: ctx.awards,
    today: ctx.today, attendance: ctx.attByCub[cubId] || [],
    newbieAfter: (ctx.trialEnd || {})[cubId] || null, joinDate: (ctx.joinOf || {})[cubId] || ''
  }));
}

/** 進程級別的顯示名稱（剛入團不加「級」） */
function levelLabel_(lv) { return lv === Logic.NEWBIE ? lv : lv + '級'; }

/** 依頒章紀錄重算目前級別（頒章、撤銷、補登後呼叫；只看這位團員所屬分團的級別） */
function refreshCubLevel_(cubId) {
  var cub = findCub_(cubId);
  var lv = Logic.currentLevelOf(loadAwards_().filter(function (a) { return a.cubId === cubId; }), cub.section);
  if (cub.level !== lv) {
    var row = cubRow_(cub);
    row[4] = lv;
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
  }
}

// ───────────── 首頁 ─────────────

registerAdmin_('adminHome', 'viewOverview', function (req, who) {
  var ctx = progressCtx_();
  var cubs = secCubs_();
  // 只有有進程模組的分團才有待頒章、快達標、期限提醒
  var hasProgress = Logic.PROGRESS_SECTIONS.indexOf(curSec_()) >= 0;
  var scan = hasProgress ? scanCubs_(ctx, cubs) : { pending: [], near: [], waiting: [], due: [] };
  var pending = scan.pending, near = scan.near, waiting = scan.waiting;
  // 體驗者：一般團集會出席滿設定次數 → 提醒團長「轉為入團」
  var trialNeed = sectionSettingOf_('體驗所需出席次數');
  var trials = cubs.filter(function (c) { return c.status === Logic.TRIAL; }).map(function (c) {
    var t = Logic.trialProgress(ctx.attByCub[c.cubId] || [], trialNeed);
    return { cubId: c.cubId, name: c.name, squad: c.squad, count: t.count, need: t.need, ready: t.ready };
  });
  var props = PropertiesService.getScriptProperties();
  var parse = function (k) { try { return JSON.parse(props.getProperty(k) || 'null'); } catch (e) { return null; } };
  var admins = loadAdmins_();
  return {
    me: { name: who.admin.name, role: who.admin.role },
    section: curSec_(), hasProgress: hasProgress,
    // 全團總覽（附錄第 73 點⑯）：管理員、總團看得到各分團的人數與待辦
    allSections: (who.isOwner || who.isCentral) ? allSectionsSummary_() : null,
    pending: pending, waiting: waiting, near: near, trials: trials, levels: Logic.levelsOf(curSec_()),
    due: scan.due.map(function (d) { return { cubId: d.cubId, name: d.name, squad: d.squad, category: d.category, unit: d.unit, deadline: d.deadline, over: d.over, done: d.done, total: d.total }; }),
    alerts: {
      itemErrors: loadItems_().errors,
      settingErrors: loadSettings_().errors,
      backup: parse('BACKUP_LAST'),
      backupFolderSet: !!props.getProperty('BACKUP_FOLDER_ID'),
      permission: parse('PERM_LAST'),
      privacyOverdue: Logic.overdueForPrivacy(cubs, ctx.settings['離團後提醒處理個資的天數'], ctx.today).map(function (c) { return { cubId: c.cubId, name: c.name, leftDate: c.leftDate }; }),
      noLineAdmin: !admins.some(function (a) { return a.lineUserId; }),
      pendingRequests: Logic.can(who.admin.role, 'reviewRequests') ? loadRequests_().filter(function (r) { return r.status === '待審核' && requestVisible_(r); }).length : 0,
      notifyFailed: Number(props.getProperty('NOTIFY_FAILED') || 0),
      placeholders: canShared_(who, '個資告知') || canShared_(who, '網站內容') ? placeholderPlaces_() : []
    }
  };
});

/** 各分團的在團、體驗人數、待審核申請、管理員人數（全團總覽） */
function allSectionsSummary_() {
  var cubs = loadCubs_(), reqs = loadRequests_().filter(function (r) { return r.status === '待審核'; });
  var adminRows = loadAdminRows_().filter(function (r) { return r.role !== Logic.CENTRAL; });
  var out = Logic.SECTIONS.map(function (sec) {
    var mine = cubs.filter(function (c) { return c.section === sec; });
    return {
      section: sec, active: mine.filter(function (c) { return c.status === '在團'; }).length,
      trial: mine.filter(function (c) { return c.status === Logic.TRIAL; }).length,
      requests: reqs.filter(function (r) { return r.section === sec; }).length,
      staff: Logic.effectiveAdmins(adminRows, sec).length
    };
  });
  return { sections: out, unassigned: reqs.filter(function (r) { return r.section === Logic.UNASSIGNED; }).length };
}

/** 上線前要改的範本文字還留著「【請填寫】」的地方（SPEC 附錄第 65 點）：最新版個資告知、認識 22 團 */
function placeholderPlaces_() {
  var out = [], has = function (t) { return /【請填寫/.test(String(t || '')); };
  if (has((latestConsent_() || {}).content)) out.push('個資告知內容');
  if (has(siteValues_().about)) out.push('認識 22 團');
  return out;
}

// ───────────── 小狼管理與綁定碼 ─────────────

registerAdmin_('cubList', 'viewRoster', function (req, who) {
  var leader = Logic.can(who.admin.role, 'manageBindCodes');
  var bindCount = {};
  loadBindings_().forEach(function (b) { bindCount[b.cubId] = (bindCount[b.cubId] || 0) + 1; });
  var cubs = secCubs_().map(function (c) {
    var o = { cubId: c.cubId, name: c.name, squad: c.squad, joinDate: c.joinDate, level: c.level, status: c.status, leftDate: c.leftDate, role: c.role };
    if (leader) { o.code = c.code; o.codeUsesLeft = c.codeUsesLeft; o.bindCount = bindCount[c.cubId] || 0; }
    return o;
  });
  return { cubs: cubs, squads: squadsOf_(cubs) };
});

/** 小隊清單：依「設定」的小隊清單順序；在團小狼使用中但不在清單的舊名稱附在後面，避免小狼被藏起來 */
function squadsOf_(cubs) {
  var list = squadListOf_();
  cubs.forEach(function (c) { if (c.squad && c.status === '在團' && list.indexOf(c.squad) < 0) list.push(c.squad); });
  return list;
}

/** 新增／編輯小狼時檢查小隊必須在清單內（清單為空時只能留空） */
function requireSquad_(squad) {
  if (!squad) return '';
  var list = squadListOf_();
  if (list.indexOf(squad) < 0) throw new ApiError(ERR.BAD_INPUT, '「' + squad + '」不在小隊清單中，請先到「更多 → 小隊設定」新增。');
  return squad;
}

registerAdmin_('cubSave', 'manageCubs', function (req, who) {
  var name = Logic.clean(req.name), squad = Logic.clean(req.squad).slice(0, 20);
  if (!name || name.length > 30) throw new ApiError(ERR.BAD_INPUT, '請填寫團員姓名（最多 30 字）。');
  return withLock_(function () {
    // [修補] 移入鎖內讀取，避免鎖外重複讀表與狀態競爭
    var existingCub = req.cubId ? findCub_(req.cubId) : null;
    var trialCub = existingCub ? existingCub.status === Logic.TRIAL : !!req.trial;
    // 體驗者沒有入團日，改填「體驗開始日」（SPEC 附錄第 40 點）
    var joinDate = trialCub ? '' : requireDate_(Logic.clean(req.joinDate), '入團日');
    var trialStart = trialCub ? requireDate_(Logic.clean(req.trialStart || req.joinDate), '體驗開始日') : '';
    var settings = loadSettings_().values;
    squad = requireSquad_(squad);
    if (existingCub) {
      var row = cubRow_(existingCub);
      var before = [row[1], row[2], dateStr_(row[3]), dateStr_(row[9])].join('／');
      if (Logic.clean(row[2]) !== squad) endRoleInRow_(existingCub, row, today_());
      row[1] = name; row[2] = squad;
      if (trialCub) row[9] = trialStart; else row[3] = joinDate;
      updateRows_(SHEET.CUBS, [{ row: existingCub._row, values: row }]);
      logOp_(who.account.accountId, '編輯小狼', existingCub.cubId, before, [row[1], row[2], dateStr_(row[3]), dateStr_(row[9])].join('／'));
      return { cubId: existingCub.cubId };
    }
    var id = newId_('C', loadCubs_().map(function (c) { return c.cubId; }));
    var code = Logic.generateCode(settings['綁定碼長度'], randInt_, allCodes_());
    appendRows_(SHEET.CUBS, [[id, name, squad, joinDate, '', code, settings['綁定碼可用次數'], trialCub ? Logic.TRIAL : '在團', '', trialStart, '', curSec_()]]);
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
    var t = Logic.trialProgress(ctx.attByCub[cub.cubId] || [], sectionSettingOf_('體驗所需出席次數'));
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
    secCubs_().forEach(function (c) { byId[c.cubId] = c; });
    var squads = squadListOf_();
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
  // [修補] 驗證目標團員屬於目前分團，防止跨分團檢視綁定資料
  var cub = findCub_(req.cubId);
  var acc = {};
  loadAccounts_().forEach(function (a) { acc[a.accountId] = a; });
  return {
    bindings: loadBindings_().filter(function (b) { return b.cubId === cub.cubId; }).map(function (b) {
      var a = acc[b.accountId] || {};
      return { accountId: b.accountId, username: a.username || '（已刪除）', nickname: a.nickname || '', consentVersion: b.consentVersion };
    })
  };
});

registerAdmin_('cubUnbind', 'manageBindCodes', function (req, who) {
  return withLock_(function () {
    // [修補] 驗證目標團員屬於目前分團，防止跨分團解除綁定
    var cub = findCub_(req.cubId);
    var rows = loadBindings_().filter(function (b) { return b.cubId === cub.cubId && b.accountId === Logic.clean(req.accountId); });
    if (!rows.length) throw new ApiError(ERR.NOT_FOUND, '找不到這筆綁定。');
    deleteRows_(SHEET.BINDINGS, rows.map(function (b) { return b._row; }));
    logOp_(who.account.accountId, '後台解除綁定', cub.cubId, Logic.clean(req.accountId), '');
    return {};
  });
});

// ───────────── 簽核 ─────────────

/** 簽核畫面需要的資料：啟用項目、在團小狼、我最近簽過的項目 */
registerAdmin_('signoffData', 'signoff', function (req, who) {
  var items = sectionItems_(curSec_()).filter(function (i) { return i.enabled; }).map(function (i) {
    return { id: i.id, category: i.category, unit: i.unit, section: i.section, text: i.text };
  });
  var cubs = secCubs_().filter(function (c) { return c.status === '在團'; }).map(function (c) { return { cubId: c.cubId, name: c.name, squad: c.squad }; });
  var recent = [], seen = {};
  var comps = loadCompletions_();
  for (var i = comps.length - 1; i >= 0 && recent.length < 10; i--) {
    var c = comps[i];
    if (c.signer === who.account.accountId && !seen[c.itemId]) { seen[c.itemId] = true; recent.push(c.itemId); }
  }
  var done = comps.filter(function (c) { return Logic.isCountedCompletion(c); }).map(function (c) { return c.cubId + '|' + c.itemId; });
  return { items: items, cubs: cubs, squads: squadsOf_(secCubs_()), recent: recent, done: done, today: today_() };
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
    secCubs_().forEach(function (c) { if (c.status === '在團') active[c.cubId] = true; });
    var enabled = {};
    sectionItems_(curSec_()).forEach(function (i) { if (i.enabled) enabled[i.id] = true; });
    if (cubIds.some(function (c) { return !active[c]; })) throw new ApiError(ERR.BAD_INPUT, '名單中有不在團的小狼，請重新整理後再試。');
    if (itemIds.some(function (i) { return !enabled[i]; })) throw new ApiError(ERR.BAD_INPUT, '項目中有已停用的項目，請重新整理後再試。');
    var plan = Logic.planBatchSignoff(loadCompletions_(), cubIds, itemIds, date, who.account.accountId, Logic.clean(req.note).slice(0, 100));
    appendRows_(SHEET.COMPLETIONS, plan.toAdd.map(Logic.completionToRow));
    if (plan.toAdd.length) logOp_(who.account.accountId, '簽核', plan.toAdd.length + ' 筆', '', date);
    return { added: plan.toAdd.length, skipped: plan.skipped, batch: plan.toAdd.map(function (c) { return { cubId: c.cubId, itemId: c.itemId }; }) };
  });
});

/** 撤銷簽核（含「復原剛送出的一批」）：團長可撤銷任何人，服務員只能撤銷自己簽的 */
registerAdmin_('signoffRevoke', 'revokeOwnSignoff', function (req, who) {
  var entries = (req.entries || []).slice(0, 2000);
  if (!entries.length) throw new ApiError(ERR.BAD_INPUT, '沒有要撤銷的項目。');
  return withLock_(function () {
    // [修補] 僅允許撤銷目前分團團員的簽核紀錄
    var secIds = {};
    secCubs_().forEach(function (c) { secIds[c.cubId] = true; });
    var want = {};
    entries.forEach(function (e) {
      var cid = Logic.clean(e.cubId);
      if (secIds[cid]) want[cid + '|' + Logic.clean(e.itemId)] = true;
    });
    var rows = loadCompletions_().filter(function (c) { return want[c.cubId + '|' + c.itemId] && Logic.isCountedCompletion(c); });
    var canRevAny = !!resolveWhoPerms_(who, false).actions.revokeAnySignoff;
    var allowed = rows.filter(function (c) { return canRevAny || c.signer === who.account.accountId; });
    if (rows.length && !allowed.length) throw new ApiError(ERR.FORBIDDEN, '服務員只能撤銷自己簽核的項目。');
    deleteRows_(SHEET.COMPLETIONS, allowed.map(function (c) { return c._row; }));
    allowed.forEach(function (c) {
      logOp_(who.account.accountId, '撤銷簽核', c.cubId, JSON.stringify(Logic.completionToRow(c)), '');
    });
    return { removed: allowed.length, notAllowed: rows.length - allowed.length };
  });
});

/** 後台看單一小狼：逐項狀態（含項目ID、簽核人、能否撤銷）、達標資訊、頒章紀錄 */
registerAdmin_('cubAdminDetail', 'viewOverview', function (req, who) {
  var cub = findCub_(req.cubId);
  var ctx = progressCtx_();
  var hasProgress = Logic.PROGRESS_SECTIONS.indexOf(cub.section) >= 0;
  var p = hasProgress ? progressOf_(ctx, cub.cubId) : { units: [], currentLevel: '' };
  var names = adminNames_();
  var canRevAny = !!resolveWhoPerms_(who, false).actions.revokeAnySignoff;
  var signerOf = {};
  ctx.completions.forEach(function (c) { if (c.cubId === cub.cubId && Logic.isCountedCompletion(c)) signerOf[c.itemId] = c.signer; });
  var units = loadUnits_(cub.section);
  var byItem = loadDetails_().byItem;
  var att = ctx.attByCub[cub.cubId] || [];
  var period = sectionPeriod_(cub.section, ctx.today);
  var rate = null;
  if (period) {
    var extra = loadExtra_().filter(function (x) { return x.period === period.name && x.cubId === cub.cubId; }).reduce(function (s, x) { return s + x.count; }, 0);
    rate = Logic.attendanceRate(att, period, extra);
    rate.period = period.name;
  }
  return {
    cub: { cubId: cub.cubId, name: cub.name, squad: cub.squad, joinDate: cub.joinDate, status: cub.status, tenure: Logic.tenure(cub.joinDate, ctx.today).text, currentLevel: p.currentLevel || '', trialStart: cub.trialStart, role: cub.role, canLead: cub.status === '在團' && canLeadSquad_(cub).ok, squadStaff: squadStaffNames_(cub.squad, cub.section), section: cub.section },
    hasProgress: hasProgress, levels: Logic.levelsOf(cub.section),
    roles: roleHistory_(cub.cubId),
    trial: cub.status === Logic.TRIAL || cub.trialStart ? Logic.trialProgress(att, sectionSettingOf_('體驗所需出席次數', cub.section)) : null,
    units: p.units.map(function (u) {
      var info = units[u.category + '|' + u.unit] || {};
      return {
        category: u.category, unit: u.unit, group: info.group || '', order: info.order || 9999, status: u.status, done: u.done, total: u.total,
        eligible: u.eligible, eligibleDate: u.eligibleDate, waitingUntil: u.waitingUntil || '', attendRequired: u.attendRequired || 0, attendSinceLast: u.attendSinceLast || 0,
        deadline: u.deadline || '', deadlineState: u.deadlineState || '',
        lastCompletionDate: u.lastCompletionDate, awardDate: u.awardDate, awardOccasion: u.awardOccasion || '',
        items: u.items.map(function (i) {
          var s = signerOf[i.id];
          return { id: i.id, section: i.section, text: i.text, done: i.done, date: i.date, auto: i.auto, signer: i.done ? (names[s] || (i.auto ? '出席自動計算' : s || '')) : '', canRevoke: !!(i.done && !i.auto && s && (canRevAny || s === who.account.accountId)), details: detailsView_(byItem, i.id) };
        })
      };
    }).sort(function (a, b) { return a.order - b.order; }),
    attendance: { counts: Logic.attendanceCounts(att), rate: rate }
  };
});

/** 總覽：小狼 × 進程級別完成度 */
registerAdmin_('overview', 'viewOverview', function () {
  var ctx = progressCtx_();
  var rows = secCubs_().filter(function (c) { return c.status === '在團'; }).map(function (c) {
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
  return { rows: rows, squads: squadsOf_(secCubs_()), levels: Logic.levelsOf(curSec_()) };
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
    secCubs_().forEach(function (c) { cubs[c.cubId] = c; });
    var errors = [], warnings = [], ok = [];
    if (date > ctx.today) warnings.push('頒發日期 ' + date + ' 是未來的日期。');
    entries.forEach(function (e) {
      var cub = cubs[Logic.clean(e.cubId)];
      if (!cub || cub.status !== '在團') { errors.push('找不到在團的小狼'); return; }
      var prog = progressOf_(ctx, cub.cubId);
      var u = prog.units.filter(function (x) { return x.unit === Logic.clean(e.unit); })[0];
      var label = cub.name + '・' + Logic.clean(e.unit);
      if (!u) { errors.push(label + '：找不到這個級別或技能章'); return; }
      if (u.status === Logic.STATUS.AWARDED) { errors.push(label + '：已經頒發過了'); return; }
      if (u.status !== Logic.STATUS.DONE_PENDING) { errors.push(label + '：項目還沒全部完成（已完成 ' + u.done + '／' + u.total + '）；上線前已有的章請用「補登」'); return; }
      var LV = Logic.levelsOf(cub.section);
      if (u.category === Logic.CATEGORY.PROGRESS && u.unit !== LV[0]) {
        var prev = LV[LV.indexOf(u.unit) - 1];
        // [修補] 改比對 progressOf_ 計算結果（含隱含通過／舊生豁免），與前端狀態判定一致；只看這位團員所屬分團的級別
        var prevUnit = prog.units.filter(function (x) { return x.category === Logic.CATEGORY.PROGRESS && x.unit === prev; })[0];
        if (!prevUnit || prevUnit.status !== Logic.STATUS.AWARDED) { errors.push(label + '：' + levelLabel_(prev) + '還沒有頒發紀錄，請先頒發或補登'); return; }
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
    appendRows_(SHEET.AWARDS, ok.map(function (x) { return [x.cub.cubId, x.unit.unit, date, occasion, note, who.account.accountId, now, secCell_(x.cub.section)]; }));
    var touched = {};
    ok.forEach(function (x) {
      logOp_(who.account.accountId, '頒章', x.cub.cubId, '', x.unit.unit + ' ' + date + (occasion ? ' ' + occasion : ''));
      if (x.unit.category === Logic.CATEGORY.PROGRESS) touched[x.cub.cubId] = true;
    });
    Object.keys(touched).forEach(refreshCubLevel_);
    return { added: ok.length };
  });
});

function findAward_(cubId, unit) {
  // [修補] 驗證目標團員屬於目前分團，防止跨分團修改或撤銷頒章；頒章紀錄依分團對應（附錄第 77 點）
  var cub = findCub_(cubId);
  var a = loadAwards_().filter(function (x) { return x.cubId === cub.cubId && x.unit === Logic.clean(unit) && x.sec === cub.section; })[0];
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
    if (Logic.isLevelOf(a.sec, a.unit)) refreshCubLevel_(a.cubId);
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
  return withLock_(function () {
    var cub = findCub_(req.cubId);
    var category = Logic.isLevelOf(cub.section, unit) ? Logic.CATEGORY.PROGRESS : Logic.CATEGORY.BADGE;
    var items = sectionItems_(cub.section);
    if (!items.some(function (i) { return i.unit === unit && i.category === category; })) throw new ApiError(ERR.BAD_INPUT, '找不到這個級別或技能章。');
    var plan = Logic.planBackfill({ cubId: cub.cubId, section: cub.section, category: category, unit: unit, date: date, occasion: Logic.clean(req.occasion), signer: who.account.accountId, items: items, completions: loadCompletions_(), awards: loadAwards_() });
    if (plan.alreadyAwarded) throw new ApiError(ERR.BAD_INPUT, cub.name + ' 的' + unit + '已經有頒章紀錄了。');
    if (plan.missingLowerLevels.length && req.includeLower === undefined) return { needConfirm: true, missingLowerLevels: plan.missingLowerLevels };
    var plans = [plan];
    if (req.includeLower === true) {
      // 較低級別依級別順序（由低到高）排在前面
      plans = plan.missingLowerLevels.map(function (lv) {
        return Logic.planBackfill({ cubId: cub.cubId, section: cub.section, category: Logic.CATEGORY.PROGRESS, unit: lv, date: date, occasion: Logic.clean(req.occasion), signer: who.account.accountId, items: items, completions: loadCompletions_(), awards: loadAwards_() });
      }).concat(plans);
    }
    var comps = [], awards = [], now = new Date();
    plans.forEach(function (p) {
      p.newCompletions.forEach(function (c) { comps.push(Logic.completionToRow(c)); });
      awards.push([p.award.cubId, p.award.unit, p.award.date, p.award.occasion, p.award.note, p.award.signer, now, secCell_(cub.section)]);
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

/** 設定分頁裡記錄「最高管理員」的鍵（移交中心寫入，SPEC 附錄第 76 點） */
var OWNER_SETTING_KEY = '最高管理員帳號ID';
/** 最高權限帳號的帳號ID：移交後以設定分頁記錄的為準，否則是 admin；都沒有就回傳空字串（SPEC 附錄第 46、76 點） */
function ownerId_() {
  // 「最高管理員帳號ID」不在 Logic.SETTINGS 裡（不讓設定頁直接改），所以直接讀設定分頁的原始列；只能由移交中心寫入
  var configured = '';
  readRows_(SHEET.SETTINGS).forEach(function (r) { if (Logic.clean(r[0]) === OWNER_SETTING_KEY) configured = Logic.clean(r[1]); });
  if (configured) {
    var cAcc = findAccountById_(configured);
    if (cAcc && cAcc.status === '啟用') return cAcc.accountId;
  }
  var a = findAccountByName_(DEFAULT_ADMIN_USERNAME);
  return a ? a.accountId : '';
}

/**
 * [修補] 帳號管理用：跨全分團檢查對象是否為 admin、總團或任一分團團長。
 * 原本只看 loadAdmins_()（目前分團），切換到別的分團時會漏判他分團團長。
 */
function guardOwner_(targetId, who, allAdminRows) {
  var owner = ownerId_();
  if (!owner) return;
  if (targetId === owner) throw new ApiError(ERR.BAD_INPUT, Logic.OWNER_LOCKED_MESSAGE + '要重設密碼請用試算表選單。');
  var rows = (allAdminRows || loadAdminRows_()).filter(function (a) { return a.accountId === targetId; });
  var isHigh = rows.some(function (a) { return a.role === Logic.ROLE.LEADER || a.role === Logic.CENTRAL; });
  if (isHigh && who.account.accountId !== owner) throw new ApiError(ERR.BAD_INPUT, Logic.OWNER_ONLY_MESSAGE);
}

registerAdmin_('adminList', 'manageAdmins', function () {
  var acc = accountsById_(), owner = ownerId_();
  var names = adminNames_();
  // 只列在目前分團有權限的人（總團也列，標記 central）；其他分團的身分在「分團身分」頁（SPEC 附錄第 68 點）
  return {
    ownerExists: !!owner,
    admins: loadAdmins_().map(function (a) {
      var r = a._raw, id = a.accountId;
      return { owner: !!owner && id === owner, accountId: id, name: a.name, role: a.role, central: a.scope === Logic.CENTRAL, title: a.title, username: (acc[id] || {}).username || '（帳號已刪除）', joinedAt: ms_(r[3]), assignedBy: names[Logic.clean(r[4])] || Logic.clean(r[4]), lineLinked: !!a.lineUserId };
    })
  };
});

/**
 * 指定管理員時找帳號（附錄第 73 點）：帳號管理改由管理員指定誰能用之後，各分團團長仍要能找人加為服務員。
 * 只回帳號名稱與稱呼（不含孩子、狀態等），最多 20 筆；不列目前分團已經是管理員的人。
 */
registerAdmin_('adminCandidates', 'manageAdmins', function (req) {
  var q = Logic.clean(req.q).slice(0, 30).toLowerCase();
  var have = {};
  loadAdmins_().forEach(function (a) { have[a.accountId] = true; });
  return {
    accounts: loadAccounts_().filter(function (a) {
      return a.status === '啟用' && !have[a.accountId] && (!q || a.username.toLowerCase().indexOf(q) >= 0 || a.nickname.toLowerCase().indexOf(q) >= 0);
    }).slice(0, 20).map(function (a) { return { accountId: a.accountId, username: a.username, nickname: a.nickname }; })
  };
});

/** 方式一：從已註冊的帳號指定為管理員 */
registerAdmin_('adminAdd', 'manageAdmins', function (req, who) {
  var role = Logic.clean(req.role), name = Logic.clean(req.name).slice(0, 30);
  if (!name) throw new ApiError(ERR.BAD_INPUT, '請填寫要顯示的姓名。');
  return withLock_(function () {
    var target = accountsById_()[Logic.clean(req.accountId)];
    if (!target || target.status !== '啟用') throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    var v = Logic.validateAdminChange(loadAdmins_(), who.account.accountId, { type: 'add', targetId: target.accountId, role: role }, ownerId_());
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    appendRows_(SHEET.ADMINS, [[target.accountId, name, role, new Date(), who.account.accountId, '', '', curSec_(), Logic.clean(req.title).slice(0, 20)]]);
    logOp_(who.account.accountId, '指定管理員', target.username, '', role + '：' + name);
    return {};
  });
});

registerAdmin_('adminUpdate', 'manageAdmins', function (req, who) {
  return withLock_(function () {
    var admins = loadAdmins_();
    var t = admins.filter(function (a) { return a.accountId === Logic.clean(req.accountId); })[0];
    if (!t) throw new ApiError(ERR.NOT_FOUND, '找不到這位管理員。');
    if (t.accountId === ownerId_() && who.account.accountId !== t.accountId) throw new ApiError(ERR.BAD_INPUT, Logic.OWNER_LOCKED_MESSAGE);
    // [修補] 避免 admin 切換到別的分團時，透過合成列誤蓋原本分團的設定
    if (t._synthetic) throw new ApiError(ERR.BAD_INPUT, '這個帳號在「' + curSec_() + '」沒有獨立身分列，請到「分團身分」設定。');
    var row = t._raw.slice(0, HEADERS[SHEET.ADMINS].length);
    var before = row[2] + '：' + row[1];
    if (req.role && Logic.clean(req.role) !== t.role) {
      var v = Logic.validateAdminChange(admins, who.account.accountId, { type: 'setRole', targetId: t.accountId, role: Logic.clean(req.role) }, ownerId_());
      if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
      row[2] = Logic.clean(req.role);
    } else if (!Logic.can(who.admin.role, 'manageAdmins')) throw new ApiError(ERR.FORBIDDEN, '你沒有權限執行這個操作。');
    if (req.name !== undefined) {
      var n = Logic.clean(req.name).slice(0, 30);
      if (!n) throw new ApiError(ERR.BAD_INPUT, '姓名不可空白。');
      row[1] = n;
    }
    // 職稱（顯示用，例如副團長、小隊輔；附錄第 68 點）
    if (req.title !== undefined) { while (row.length < 9) row.push(''); row[8] = Logic.clean(req.title).slice(0, 20); }
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
    var v = Logic.validateAdminChange(admins, who.account.accountId, { type: 'remove', targetId: t.accountId }, ownerId_());
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    deleteRows_(SHEET.ADMINS, [t._row]);
    // [修補] 一併清理該管理員在目前分團的小隊輔設定
    var stRows = loadSquadStaff_().filter(function (s) { return s.accountId === t.accountId && s.section === curSec_(); }).map(function (s) { return s._row; });
    if (stRows.length) deleteRows_(SHEET.SQUAD_STAFF, stRows);
    logOp_(who.account.accountId, '移除管理員', t.accountId, t.role + '：' + t.name, '');
    return {};
  });
});

registerAdmin_('inviteList', 'manageInvites', function () {
  var names = adminNames_(), now = Date.now();
  return {
    invites: loadInvites_().filter(function (i) { return i.status === '未使用'; }).map(function (i) {
      return { code: i.code, role: i.role, section: i.section, title: i.title, name: i.name, createdBy: names[i.createdBy] || i.createdBy, expiresAt: i.expiresAt, expired: now > i.expiresAt };
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
  // [修補] 彙整全分團身分（不只目前分團），避免在別的分團管理帳號時漏看角色
  var roleList = {};
  loadAdminRows_().forEach(function (a) {
    var label = a.role === Logic.CENTRAL ? Logic.CENTRAL : (a.section === Logic.DEFAULT_SECTION ? a.role : a.section + '・' + a.role);
    (roleList[a.accountId] = roleList[a.accountId] || []).push(label);
  });
  return {
    accounts: readRows_(SHEET.ACCOUNTS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
      var id = Logic.clean(r[0]);
      return { accountId: id, username: Logic.clean(r[1]), nickname: Logic.clean(r[2]), status: Logic.clean(r[5]) || '啟用', createdAt: ms_(r[6]), lastLogin: ms_(r[7]), cubs: bound[id] || [], role: (roleList[id] || []).join('、') };
    })
  };
});

/** 忘記密碼：產生一次性臨時碼（只存雜湊），該帳號所有登入立即失效 */
registerAdmin_('accountTempCode', 'manageAccounts', function (req, who) {
  return withLock_(function () {
    var acc = accountsById_()[Logic.clean(req.accountId)];
    if (!acc) throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    if (acc.accountId !== who.account.accountId) guardOwner_(acc.accountId, who);
    var settings = loadSettings_().values;
    var code = Logic.generateCode(8, randInt_, []);
    var exp = new Date(Date.now() + settings['臨時碼有效小時數'] * 3600000);
    var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
    row[8] = sha256Hex_(code); row[9] = exp;
    updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
    purgeSessions_(acc.accountId);
    logOp_(who.account.accountId, '產生臨時碼', acc.username, '', ''); // 不記臨時碼
    var url = webUrl_();
    var msgText = acc.nickname + ' 您好，這是 22 團網站的密碼重設臨時碼：\n' +
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
      var allAdminRows = loadAdminRows_();
      guardOwner_(acc.accountId, who, allAdminRows);
      if (acc.accountId === who.account.accountId) throw new ApiError(ERR.BAD_INPUT, '不可以停用自己的帳號。');
      // [修補] 固定檢查小狼（預設分團）是否仍保留至少一位團長，不受目前切換分團影響
      var c = Logic.canDeleteAccount(Logic.effectiveAdmins(allAdminRows, Logic.DEFAULT_SECTION), acc.accountId);
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

/** 刪除帳號（家長要求時）：刪帳號、登入憑證、綁定、管理員身分、小隊輔；小狼資料不受影響 */
registerAdmin_('accountDelete', 'manageAccounts', function (req, who) {
  var affectedEvents = [];
  withLock_(function () {
    var acc = accountsById_()[Logic.clean(req.accountId)];
    if (!acc) throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    if (Logic.clean(req.confirmUsername) !== acc.username) throw new ApiError(ERR.BAD_INPUT, '請輸入正確的帳號名稱以確認刪除。');
    if (acc.accountId === who.account.accountId) throw new ApiError(ERR.BAD_INPUT, '不可以刪除自己的帳號。');
    var allAdminRows = loadAdminRows_();
    guardOwner_(acc.accountId, who, allAdminRows);
    // [修補] 固定檢查小狼是否仍保留至少一位團長
    var c = Logic.canDeleteAccount(Logic.effectiveAdmins(allAdminRows, Logic.DEFAULT_SECTION), acc.accountId);
    if (!c.ok) throw new ApiError(ERR.BAD_INPUT, c.error);
    purgeSessions_(acc.accountId);
    deleteRows_(SHEET.BINDINGS, loadBindings_().filter(function (b) { return b.accountId === acc.accountId; }).map(function (b) { return b._row; }));
    // 所有分團的身分與小隊輔一起刪
    deleteRows_(SHEET.ADMINS, allAdminRows.filter(function (a) { return a.accountId === acc.accountId; }).map(function (a) { return a._row; }));
    // [修補] 一併刪除小隊輔孤兒紀錄
    deleteRows_(SHEET.SQUAD_STAFF, loadSquadStaff_().filter(function (s) { return s.accountId === acc.accountId; }).map(function (s) { return s._row; }));
    affectedEvents = deleteRegsOfAccount_(acc.accountId);
    deleteRows_(SHEET.REQUESTS, loadRequests_().filter(function (r) { return r.accountId === acc.accountId; }).map(function (r) { return r._row; }));
    deleteRows_(SHEET.ACCOUNTS, [acc._row]);
    logOp_(who.account.accountId, '刪除帳號', acc.accountId, '', '');
  });
  // [修補] 釋放鎖後再同步受影響的活動存檔試算表，避免在鎖內跑 Drive 操作逾時
  affectedEvents.forEach(function (evId) { afterSync_({ _ev: evId }); });
  return {};
});

// ───────────── 設定（SPEC 7.8，團長專用） ─────────────

/**
 * 設定分三種（附錄第 73 點，團長 2026-11-19 決定）：
 *  - 全團：系統設定（密碼、鎖定、排程……），誰能改由「共用功能權限：系統設定」決定
 *  - 分團：各分團自己的（小隊清單另有頁面、體驗所需出席次數；小狼另有進程設定），該分團團長可改
 *  - 權限：共用功能由誰使用，只有管理員（admin）可改（沒有 admin 帳號時由總團）
 * @return '全團' | '分團' | '權限' | null（目前這個人不能看或改）
 */
function settingGroupFor_(def, who) {
  if (!def || def.type === 'list') return null;
  if (def.scope === 'shared') return who.isOwner || (!ownerId_() && who.isCentral) ? '權限' : null;
  if (def.scope === 'cub') return curSec_() === Logic.DEFAULT_SECTION ? '分團' : null;
  if (def.scope === 'progress') return def.section === curSec_() ? '分團' : null;
  if (def.scope === 'section') return def.key === Logic.sectionSettingKey(def.base || def.key, curSec_()) ? '分團' : null;
  return canShared_(who, '系統設定') ? '全團' : null;
}

registerAdmin_('settingsGet', 'manageSettings', function (req, who) {
  var parsed = loadSettings_();
  var raw = {};
  readRows_(SHEET.SETTINGS).forEach(function (r) { var k = Logic.clean(r[0]); if (k) raw[k] = Logic.clean(r[1]); });
  var errs = {};
  parsed.errors.forEach(function (e) { errs[e.key] = e.reason; });
  var c = latestConsent_();
  return {
    section: curSec_(),
    canConsent: canShared_(who, '個資告知'), canSite: canShared_(who, '網站內容'),
    settings: Logic.SETTINGS.filter(function (s) { return settingGroupFor_(s, who); }).map(function (s) {
      var v = parsed.values[s.key];
      return {
        key: s.key, group: settingGroupFor_(s, who), options: s.options, type: s.type, desc: s.desc, min: s.min, max: s.max,
        value: s.type === 'bool' ? (v ? '是' : '否') : String(v), sheetValue: raw[s.key] === undefined ? '' : raw[s.key], error: errs[s.key] || ''
      };
    }),
    consent: c && canShared_(who, '個資告知') ? { version: c.version, content: c.content, effective: c.effective } : null
  };
});

/** 修改設定：全部檢查通過才寫入；修改前後的值寫入操作日誌 */
registerAdmin_('settingsSave', 'manageSettings', function (req, who) {
  var changes = req.changes || {};
  var keys = Object.keys(changes);
  if (!keys.length) throw new ApiError(ERR.BAD_INPUT, '沒有要修改的設定。');
  var stored = {}, errors = [];
  keys.forEach(function (k) {
    var def = Logic.SETTINGS.filter(function (s) { return s.key === k; })[0];
    if (def && !settingGroupFor_(def, who)) throw new ApiError(ERR.FORBIDDEN, '你沒有權限修改「' + k + '」。');
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
    // [修補] 若修改了「共用功能權限：*」且已有「權限設定」分頁，同步更新對應列避免兩邊打架
    if (ss_().getSheetByName(SHEET.PERMS)) {
      var pRows = readRows_(SHEET.PERMS), pUps = [];
      Logic.PERM_FEATURES.forEach(function (f) {
        if (!f.sharedFunc) return;
        var sk = '共用功能權限：' + f.sharedFunc;
        if (stored[sk] === undefined) return;
        var pr = pRows.filter(function (x) { return Logic.clean(x[0]) === f.id; })[0];
        if (pr && Logic.clean(pr[3]) !== stored[sk]) {
          var pv = HEADERS[SHEET.PERMS].map(function (h, j) { return pr[j] === undefined ? '' : pr[j]; });
          pv[3] = stored[sk]; pv[5] = who.account.accountId; pv[6] = new Date();
          pUps.push({ row: pr._row, values: pv });
        }
      });
      if (pUps.length) updateRows_(SHEET.PERMS, pUps);
    }
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

// ───────────── 權限與分頁設定（新增：不同權限顯示不同分頁與內容） ─────────────

/** 讀取全部可設定的分頁與功能權限（僅限有「權限與分頁設定」權限者） */
registerAdmin_('permSettingsGet', 'managePermissions', function (req, who) {
  var rules = loadPermRules_();
  return {
    sections: Logic.SECTIONS,
    features: Logic.PERM_FEATURES.map(function (f) {
      var r = rules[f.id];
      return {
        id: r.id, name: r.name, group: r.group, scope: r.scope,
        level: r.level, options: r.options, disabledSections: r.disabledSections, locked: r.locked
      };
    })
  };
});

/**
 * 儲存分頁與功能權限設定：
 * req.updates = [{ id: 'tab_events', level: '服務員', disabledSections: ['稚齡'] }, ...]
 * 若試算表尚未建立「權限設定」分頁，會自動建立並寫入預設列後更新。
 */
registerAdmin_('permSettingsSave', 'managePermissions', function (req, who) {
  var updates = Array.isArray(req.updates) ? req.updates : [];
  if (!updates.length) throw new ApiError(ERR.BAD_INPUT, '沒有要修改的權限設定。');
  var checked = [], errors = [];
  updates.forEach(function (u) {
    var v = Logic.validatePermUpdate(u && u.id, u && u.level, u && u.disabledSections);
    if (v.ok) checked.push(v); else errors.push(v.error);
  });
  if (errors.length) throw new ApiError(ERR.BAD_INPUT, errors.join('\n'));
  return withLock_(function () {
    // 若尚未跑過新版 setup()，自動建立「權限設定」分頁並匯入預設值
    if (!ss_().getSheetByName(SHEET.PERMS)) {
      ensureSheet_(SHEET.PERMS, { created: [], headerFixed: [], headerMismatch: [] });
      appendRows_(SHEET.PERMS, Logic.defaultPermRows().slice(1));
    }
    var rows = readRows_(SHEET.PERMS);
    var byId = {};
    rows.forEach(function (r) { var id = Logic.clean(r[0]); if (id) byId[id] = r; });
    var ups = [], adds = [], changed = 0, now = new Date();
    checked.forEach(function (c) {
      var disStr = c.disabledSections.join('、');
      var cur = byId[c.feature.id];
      var vals = [c.feature.id, c.feature.name, c.feature.group, c.level, disStr, who.account.accountId, now];
      if (cur) {
        if (Logic.clean(cur[3]) === c.level && Logic.clean(cur[4]) === disStr) return;
        ups.push({ row: cur._row, values: vals });
        logOp_(who.account.accountId, '修改權限設定', c.feature.name, Logic.clean(cur[3]) + (Logic.clean(cur[4]) ? '（停用：' + Logic.clean(cur[4]) + '）' : ''), c.level + (disStr ? '（停用：' + disStr + '）' : ''));
      } else {
        adds.push(vals);
        logOp_(who.account.accountId, '修改權限設定', c.feature.name, c.feature.def, c.level + (disStr ? '（停用：' + disStr + '）' : ''));
      }
      changed++;
    });
    if (ups.length) updateRows_(SHEET.PERMS, ups);
    if (adds.length) appendRows_(SHEET.PERMS, adds);
    // 共用功能（系統設定、網站內容…）同步寫回設定分頁的「共用功能權限：○○」，兩邊一致
    var sRows = readRows_(SHEET.SETTINGS), sUps = [], sAdds = [];
    checked.forEach(function (c) {
      if (!c.feature.sharedFunc) return;
      var k = '共用功能權限：' + c.feature.sharedFunc, r = sRows.filter(function (x) { return Logic.clean(x[0]) === k; })[0];
      if (r && Logic.clean(r[1]) === c.level) return;
      var desc = (Logic.SETTINGS.filter(function (s) { return s.key === k; })[0] || {}).desc || '';
      if (r) sUps.push({ row: r._row, values: [k, c.level, r[2] === undefined ? desc : r[2]] }); else sAdds.push([k, c.level, desc]);
    });
    if (sUps.length) updateRows_(SHEET.SETTINGS, sUps);
    if (sAdds.length) appendRows_(SHEET.SETTINGS, sAdds);
    return { changed: changed };
  });
});

// ───────────── 團務移交與交接中心（總團／管理員檢視，移交最高管理權限限現任最高管理員） ─────────────

registerAdmin_('handoverSummary', 'manageHandover', function (req, who) {
  var owner = ownerId_();
  var accById = accountsById_();
  var allAdminRows = loadAdminRows_();
  var cubs = loadCubs_();
  var pendingReqs = loadRequests_().filter(function (r) { return r.status === '待審核'; }).length;
  var permSheetExists = !!ss_().getSheetByName(SHEET.PERMS);
  var ownerAcc = owner ? accById[owner] : null;
  var ownerAdminRow = allAdminRows.filter(function (r) { return r.accountId === owner; })[0];

  var central = allAdminRows.filter(function (r) { return r.role === Logic.CENTRAL; }).map(function (r) {
    var a = accById[r.accountId] || {};
    return {
      accountId: r.accountId, username: a.username || '', name: r.name || a.nickname || '',
      title: r.title || '總團', isOwner: r.accountId === owner, lineLinked: !!r.lineUserId, status: a.status || ''
    };
  });

  var sections = Logic.SECTIONS.map(function (sec) {
    var secRows = allAdminRows.filter(function (r) { return r.section === sec && r.role !== Logic.CENTRAL; });
    var leaders = secRows.filter(function (r) { return r.role === Logic.ROLE.LEADER; }).map(function (r) {
      var a = accById[r.accountId] || {};
      return { accountId: r.accountId, username: a.username || '', name: r.name || a.nickname || '', title: r.title || '團長', lineLinked: !!r.lineUserId };
    });
    var assistants = secRows.filter(function (r) { return r.role === Logic.ROLE.ASSISTANT; }).map(function (r) {
      var a = accById[r.accountId] || {};
      return { accountId: r.accountId, username: a.username || '', name: r.name || a.nickname || '', title: r.title || '服務員', lineLinked: !!r.lineUserId };
    });
    var activeCubs = cubs.filter(function (c) { return c.section === sec && !c.leftDate; }).length;
    return {
      section: sec, fullName: Logic.SECTION_FULL[sec] || sec,
      leaderCount: leaders.length, assistantCount: assistants.length, activeCubs: activeCubs,
      leaders: leaders, assistants: assistants,
      needsLeader: activeCubs > 0 && leaders.length === 0
    };
  });

  // 可接任最高管理權的候選人（啟用中的總團或各分團團長，不含現任最高管理員）
  var seen = {};
  var candidates = [];
  allAdminRows.forEach(function (r) {
    if (r.accountId === owner || seen[r.accountId]) return;
    if (r.role !== Logic.CENTRAL && r.role !== Logic.ROLE.LEADER) return;
    var a = accById[r.accountId];
    if (!a || a.status !== '啟用') return;
    seen[r.accountId] = true;
    candidates.push({
      accountId: r.accountId, username: a.username, name: r.name || a.nickname || a.username,
      roleLabel: r.role === Logic.CENTRAL ? '總團' : (r.section + ' ' + (r.title || '團長'))
    });
  });

  return {
    isOwner: !!who.isOwner,
    owner: ownerAcc ? {
      accountId: ownerAcc.accountId, username: ownerAcc.username,
      name: (ownerAdminRow && ownerAdminRow.name) || ownerAcc.nickname || ownerAcc.username,
      lineLinked: !!(ownerAdminRow && ownerAdminRow.lineUserId),
      transferred: readRows_(SHEET.SETTINGS).some(function (r) { return Logic.clean(r[0]) === OWNER_SETTING_KEY && Logic.clean(r[1]); })
    } : null,
    central: central,
    sections: sections,
    candidates: candidates,
    checklist: [
      { label: '權限設定工作表已啟用', ok: permSheetExists, note: permSheetExists ? '已就緒' : '尚未建立（到「權限設定」儲存一次即可自動建立）' },
      { label: '有團員的分團皆已指派團長', ok: !sections.some(function (s) { return s.needsLeader; }), note: sections.filter(function (s) { return s.needsLeader; }).map(function (s) { return s.section; }).join('、') || '全部分團皆有負責團長' },
      { label: '總團或管理員已設定兩人以上（避免單人交接斷層）', ok: central.length >= 2 || candidates.length >= 1, note: '目前總團 ' + central.length + ' 人、可接任候選 ' + candidates.length + ' 人' },
      { label: '待審核註冊申請已清空', ok: pendingReqs === 0, note: pendingReqs ? '尚有 ' + pendingReqs + ' 筆待審核' : '目前無積壓申請' }
    ]
  };
});

registerAdmin_('handoverTransfer', 'manageHandover', function (req, who) {
  if (!who.isOwner) throw new ApiError(ERR.FORBIDDEN, '只有現任最高管理員可以執行最高管理權移交。');
  var password = String(req.password || '');
  var targetId = Logic.clean(req.targetAccountId);
  var confirmUsername = Logic.clean(req.confirmUsername);
  if (!password) throw new ApiError(ERR.BAD_INPUT, '請輸入你目前的密碼以確認移交。');
  if (!targetId || targetId === who.account.accountId) throw new ApiError(ERR.BAD_INPUT, '請選擇要接任的帳號。');
  return withLock_(function () {
    // 再確認一次目前的密碼（錯太多次會鎖住，和登入共用失敗紀錄）
    var settingsV = loadSettings_().values, me = findAccountById_(who.account.accountId);
    assertNotLocked_('登入', me.username.toLowerCase(), settingsV);
    if (!Logic.verifyPassword(password, me.salt, me.passwordHash, hmacHex_)) {
      recordFailure_('登入', me.username.toLowerCase());
      throw new ApiError(ERR.BAD_INPUT, '目前密碼不正確，已取消移交。');
    }
    var target = findAccountById_(targetId);
    if (!target || target.status !== '啟用') throw new ApiError(ERR.NOT_FOUND, '找不到接任帳號，或該帳號已停用。');
    if (confirmUsername.toLowerCase() !== target.username.toLowerCase()) {
      throw new ApiError(ERR.BAD_INPUT, '請完整輸入接任帳號的帳號名稱（' + target.username + '）以確認移交。');
    }
    var now = new Date();
    // 1. 確保接任者具備「總團」身分
    var rows = loadAdminRows_();
    var targetCentral = rows.filter(function (r) { return r.accountId === target.accountId && r.role === Logic.CENTRAL; })[0];
    if (!targetCentral) {
      var existingName = (rows.filter(function (r) { return r.accountId === target.accountId; })[0] || {}).name || target.nickname || target.username;
      appendRows_(SHEET.ADMINS, [[target.accountId, existingName, Logic.CENTRAL, now, who.account.accountId, '', '', '', '總團']]);
    }
    // 2. 若原管理員未指定移除總團身分，確保原管理員保留「總團」以便陪同交接
    if (req.keepAsCentral !== false) {
      var myCentral = rows.filter(function (r) { return r.accountId === who.account.accountId && r.role === Logic.CENTRAL; })[0];
      if (!myCentral) {
        var myName = (rows.filter(function (r) { return r.accountId === who.account.accountId; })[0] || {}).name || who.account.nickname || who.account.username;
        appendRows_(SHEET.ADMINS, [[who.account.accountId, myName, Logic.CENTRAL, now, who.account.accountId, '', '', '', '交接顧問']]);
      }
    }
    // 3. 寫入「設定」工作表：最高管理員帳號ID
    var sRows = readRows_(SHEET.SETTINGS);
    var curSetting = sRows.filter(function (r) { return Logic.clean(r[0]) === OWNER_SETTING_KEY; })[0];
    var sVals = [OWNER_SETTING_KEY, target.accountId, '系統最高管理員帳號（只能由後台移交中心更新，請不要手動修改）'];
    if (curSetting) updateRows_(SHEET.SETTINGS, [{ row: curSetting._row, values: sVals }]);
    else appendRows_(SHEET.SETTINGS, [sVals]);
    logOp_(who.account.accountId, '移交最高管理權', target.username, who.account.username, target.username + '（' + target.accountId + '）');
    clearPublicCache_();
    return { newOwnerUsername: target.username, newOwnerName: target.nickname || target.username };
  });
});

// ───────────── 註冊申請審核（SPEC 附錄第 31 點，團長專用） ─────────────

registerAdmin_('requestList', 'reviewRequests', function () {
  var accounts = accountsById_();
  var cubs = secCubs_().filter(function (c) { return c.status === '在團' || c.status === Logic.TRIAL; });
  var adminIds = {};
  loadAdmins_().forEach(function (a) { adminIds[a.accountId] = true; });
  var items = loadRequests_().filter(function (r) { return r.status === '待審核' && requestVisible_(r); }).sort(function (a, b) { return a.at - b.at; }).map(function (r) {
    var acc = accounts[r.accountId] || {};
    return {
      requestId: r.requestId, type: r.type, name: r.name, at: r.at ? new Date(r.at).toISOString() : '', section: r.section,
      nickname: acc.nickname || '（帳號已刪除）', username: acc.username || '', isAdmin: !!adminIds[r.accountId],
      // 同名的在團小狼（例如爸爸媽媽各自註冊同一個孩子），審核時建議直接連結
      sameName: r.type === '孩子' ? cubs.filter(function (c) { return c.name === r.name; }).map(function (c) { return c.cubId; }) : []
    };
  });
  return {
    items: items,
    cubs: cubs.map(function (c) { return { cubId: c.cubId, name: c.name, squad: c.squad }; }),
    squads: squadListOf_(),
    section: curSec_(), sections: Logic.SECTIONS,
    today: today_()
  };
});

/** 目前分團看得到的申請：該分團的，以及家長選「不確定」（未指定）的（附錄第 73 點） */
function requestVisible_(r) { return r.section === curSec_() || r.section === Logic.UNASSIGNED; }

/** 指定（或改）申請的分團：未指定的誰都可以指定；已在本分團的可以改到別的分團（轉給該分團審核） */
registerAdmin_('requestAssign', 'reviewRequests', function (req, who) {
  var to = Logic.clean(req.to);
  if (!Logic.isSection(to)) throw new ApiError(ERR.BAD_INPUT, '請選擇分團。');
  return withLock_(function () {
    var r = loadRequests_().filter(function (x) { return x.requestId === Logic.clean(req.requestId); })[0];
    if (!r || r.status !== '待審核' || !requestVisible_(r)) throw new ApiError(ERR.NOT_FOUND, '找不到這筆申請，可能已經處理過了，請重新整理。');
    var row = r._raw.slice(0, HEADERS[SHEET.REQUESTS].length);
    while (row.length < HEADERS[SHEET.REQUESTS].length) row.push('');
    row[11] = to;
    updateRows_(SHEET.REQUESTS, [{ row: r._row, values: row }]);
    logOp_(who.account.accountId, '指定申請分團', r.requestId, r.section, to);
    return { section: to };
  });
});

/** 取出一筆待審核申請，帳號必須仍在且啟用 */
function pendingRequest_(requestId) {
  var r = loadRequests_().filter(function (x) { return x.requestId === Logic.clean(requestId); })[0];
  if (!r || r.status !== '待審核' || !requestVisible_(r)) throw new ApiError(ERR.NOT_FOUND, '找不到這筆申請，可能已經處理過了，請重新整理。');
  var acc = accountsById_()[r.accountId];
  if (!acc || acc.status !== '啟用') throw new ApiError(ERR.BAD_INPUT, '申請人的帳號已停用或刪除，請按「退回」。');
  return { req: r, acc: acc };
}

/** 結案：寫入結果並清掉申請時填的姓名（姓名已在小狼名單或管理員名單，不重複保存） */
function closeRequest_(r, status, who, cubId, note) {
  var row = r._raw.slice(0, HEADERS[SHEET.REQUESTS].length);
  while (row.length < HEADERS[SHEET.REQUESTS].length) row.push('');
  row[3] = ''; row[5] = status; row[6] = who.account.accountId; row[7] = new Date(); row[8] = cubId || ''; row[10] = Logic.clean(note).slice(0, 100);
  // 核准時記下實際的分團（未指定的申請由審核的分團接手）
  if (status === '已核准') row[11] = curSec_();
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
        appendRows_(SHEET.ADMINS, [[r.accountId, name, Logic.ROLE.ASSISTANT, new Date(), who.account.accountId, '', '', curSec_(), '']]);
      }
      closeRequest_(r, '已核准', who, '', '');
      logOp_(who.account.accountId, '核准服務員申請', p.acc.username, '', '服務員：' + name);
      return { type: '服務員' };
    }
    var cub;
    if (Logic.clean(req.mode) === 'link') {
      cub = findCub_(req.cubId);
      if (cub.status !== '在團' && cub.status !== Logic.TRIAL) throw new ApiError(ERR.BAD_INPUT, '只能連結在團的團員或體驗者。');
    } else {
      var cname = Logic.clean(req.name).replace(/\s+/g, '') || r.name;
      if (!cname || cname.length > 30) throw new ApiError(ERR.BAD_INPUT, '請填寫團員姓名（最多 30 字）。');
      var squad = requireSquad_(Logic.clean(req.squad).slice(0, 20));
      // mode='trial'：新增為體驗者（日期是體驗開始日）；否則直接入團（日期是入團日）
      var asTrial = Logic.clean(req.mode) === 'trial';
      var joinDate = requireDate_(Logic.clean(req.joinDate), asTrial ? '體驗開始日' : '入團日');
      var settings = loadSettings_().values;
      var id = newId_('C', loadCubs_().map(function (c) { return c.cubId; }));
      var code = Logic.generateCode(settings['綁定碼長度'], randInt_, allCodes_());
      appendRows_(SHEET.CUBS, [[id, cname, squad, asTrial ? '' : joinDate, '', code, settings['綁定碼可用次數'], asTrial ? Logic.TRIAL : '在團', '', asTrial ? joinDate : '', '', curSec_()]]);
      logOp_(who.account.accountId, asTrial ? '新增體驗者' : '新增小狼', id, '', [cname, squad, (asTrial ? '體驗開始 ' : '') + joinDate].join('／') + '（註冊申請）');
      cub = findCub_(id);
    }
    // 綁定：同意時間與版本沿用申請時的紀錄（家長送出申請時已同意）
    var exists = loadBindings_().some(function (b) { return b.accountId === r.accountId && b.cubId === cub.cubId; });
    if (!exists) appendRows_(SHEET.BINDINGS, [[r.accountId, cub.cubId, new Date(), new Date(r.at || Date.now()), r.consentVersion, Logic.RELATION.PARENT]]);
    closeRequest_(r, '已核准', who, cub.cubId, '');
    logOp_(who.account.accountId, '核准孩子申請', cub.cubId, '', '綁定帳號 ' + p.acc.username);
    return { type: '孩子', cubId: cub.cubId };
  });
});

registerAdmin_('requestReject', 'reviewRequests', function (req, who) {
  return withLock_(function () {
    var r = loadRequests_().filter(function (x) { return x.requestId === Logic.clean(req.requestId); })[0];
    if (!r || r.status !== '待審核' || !requestVisible_(r)) throw new ApiError(ERR.NOT_FOUND, '找不到這筆申請，可能已經處理過了，請重新整理。');
    closeRequest_(r, '已退回', who, '', req.note);
    logOp_(who.account.accountId, '退回註冊申請', r.requestId, '', r.type);
    return {};
  });
});

// ───────────── 集會行事曆、點名、出席 ─────────────

/**
 * 集會對象（附錄第 73 點⑫）：每場集會是「某分團」或「全團」。目前分團看得到自己分團與全團的集會；
 * 全團集會由管理員或總團設定，分團集會由該分團團長設定。點名時各分團點自己的團員。
 */
function meetingVisible_(m) { return Logic.targetIncludes(m.target, curSec_()); }
function canEditMeeting_(who, m) { return m.target === Logic.ALL ? canManageAll_(who) : m.target === curSec_(); }
function findMeeting_(meetingId) {
  var m = loadMeetings_().filter(function (x) { return x.meetingId === Logic.clean(meetingId) && meetingVisible_(x); })[0];
  if (!m || !m.enabled) throw new ApiError(ERR.NOT_FOUND, '找不到這場集會。');
  return m;
}

registerAdmin_('meetingList', 'attendance', function (req, who) {
  var count = {}, mine = {};
  secCubs_().forEach(function (c) { mine[c.cubId] = true; });
  // 出席人數只算目前分團的團員（全團集會各分團各自點名）
  loadAttendance_().forEach(function (a) { if (Logic.isPresent(a.status) && mine[a.cubId]) count[a.meetingId] = (count[a.meetingId] || 0) + 1; });
  var list = loadMeetings_().filter(function (m) { return Logic.isDateStr(m.date) && meetingVisible_(m); }).map(function (m) {
    return { meetingId: m.meetingId, date: m.date, name: m.name, note: m.note, enabled: m.enabled, type: m.type, counts: m.counts, attended: count[m.meetingId] || 0, target: m.target, canEdit: canEditMeeting_(who, m) };
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { meetings: list, today: today_(), defaultId: defaultMeetingId_(list, today_()), section: curSec_(), canManageAll: canManageAll_(who) };
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
      var m = meetings.filter(function (x) { return x.meetingId === Logic.clean(req.meetingId) && meetingVisible_(x); })[0];
      if (!m) throw new ApiError(ERR.NOT_FOUND, '找不到這場集會。');
      if (!canEditMeeting_(who, m)) throw new ApiError(ERR.FORBIDDEN, m.target === Logic.ALL ? '全團集會由管理員或總團設定。' : '這是' + m.target + '的集會，請由' + m.target + '的團長修改。');
      var raw = readRows_(SHEET.MEETINGS).filter(function (r) { return r._row === m._row; })[0];
      var row = raw.slice(0, HEADERS[SHEET.MEETINGS].length);
      var before = [m.date, m.name, m.enabled ? '是' : '否'].join('／') + '／' + m.type + '／' + (m.counts ? '計入' : '不計入');
      if (req.date !== undefined) row[1] = requireDate_(Logic.clean(req.date));
      if (req.name !== undefined) row[2] = Logic.clean(req.name).slice(0, 40) || '團集會';
      if (req.note !== undefined) row[3] = Logic.clean(req.note).slice(0, 100);
      if (req.enabled !== undefined) row[4] = req.enabled ? '是' : '否';
      if (req.type !== undefined) { if (Logic.MEETING_TYPES.indexOf(Logic.clean(req.type)) < 0) throw new ApiError(ERR.BAD_INPUT, '類型只能是一般或大活動。'); row[7] = Logic.clean(req.type); }
      // 計入進程（SPEC 附錄第 61 點）：「否」的集會出席不算晉級、自動完成與體驗次數；出席率照算
      if (req.counts !== undefined) row[8] = req.counts === false ? '否' : '是';
      // 改對象（全團 ↔ 分團）只有管理員或總團可以
      if (req.target !== undefined && Logic.targetOf(req.target) !== m.target) {
        if (!canManageAll_(who)) throw new ApiError(ERR.FORBIDDEN, '只有管理員或總團可以改集會的對象。');
        while (row.length < 10) row.push('');
        row[9] = meetingTarget_(req.target);
      }
      updateRows_(SHEET.MEETINGS, [{ row: m._row, values: row }]);
      logOp_(who.account.accountId, '修改集會', m.meetingId, before, [row[1], row[2], row[4], row[7] || '一般', row[8] === '否' ? '不計入' : '計入'].join('／'));
      return { updated: 1 };
    }
    var target = req.target === undefined ? curSec_() : meetingTarget_(req.target);
    if (target === Logic.ALL && !canManageAll_(who)) throw new ApiError(ERR.FORBIDDEN, '全團集會由管理員或總團設定。');
    if (target !== Logic.ALL && target !== curSec_() && !canManageAll_(who)) throw new ApiError(ERR.FORBIDDEN, '只能新增自己分團的集會。');
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
      // [修補] 支援日期區間寫法（如 2026-12-05~2026/12/06 露營），避免名稱留下開頭減號
      var rest = (mm[4] || '').trim(), note = '';
      var rng = /^[-~～至到]+\s*(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\s*(.*)$/.exec(rest);
      if (rng) {
        var ed = rng[1] + '-' + ('0' + rng[2]).slice(-2) + '-' + ('0' + rng[3]).slice(-2);
        if (Logic.isDateStr(ed)) { note = '至 ' + ed; rest = (rng[4] || '').trim(); }
      }
      // 名稱裡有「大活動」就標成大活動（體驗者不算、點名不列體驗者）
      var nm = rest.slice(0, 40) || '團集會';
      add.push([id, d, nm, note, '是', who.account.accountId, now, /大活動/.test(nm) ? '大活動' : '一般', '是', target]);
    });
    if (!add.length) throw new ApiError(ERR.BAD_INPUT, '沒有可新增的集會。每行格式：2026-11-22 團集會' + (bad.length ? '\n看不懂的行：\n' + bad.join('\n') : ''));
    appendRows_(SHEET.MEETINGS, add);
    logOp_(who.account.accountId, '新增集會', add.length + ' 場', '', add.map(function (r) { return r[1]; }).join('、'));
    return { added: add.length, bad: bad };
  });
});

/** 送來的集會對象：「全團」或分團名稱，其他一律拒絕 */
function meetingTarget_(v) {
  var x = Logic.clean(v);
  if (x !== Logic.ALL && !Logic.isSection(x)) throw new ApiError(ERR.BAD_INPUT, '集會對象只能是全團或某個分團。');
  return x;
}

/** 該集會當天在團的團員（目前分團或指定分團） */
function cubsOnDate_(date, type, section) {
  var sec = Logic.sectionOf(section || curSec_());
  return loadCubs_().filter(function (c) {
    if (c.section !== sec) return false;
    if (c.status === '已匿名') return false;
    if ((c.status === '離團' || c.status === Logic.GRADUATED) && c.leftDate && c.leftDate < date) return false;
    if (c.joinDate && c.joinDate <= date) return true;
    // 體驗者（含已轉入團者的體驗期間）：只參加「一般」團集會
    return !!(c.trialStart && c.trialStart <= date && (type || '一般') === '一般');
  });
}

registerAdmin_('attendanceSheet', 'attendance', function (req) {
  var m = findMeeting_(req.meetingId);
  var st = {};
  loadAttendance_().forEach(function (a) { if (a.meetingId === m.meetingId) st[a.cubId] = a.status; });
  var cubs = cubsOnDate_(m.date, m.type).map(function (c) { return { cubId: c.cubId, name: c.name, squad: c.squad, status: st[c.cubId] || '', trial: !(c.joinDate && c.joinDate <= m.date) }; });
  return { meeting: { meetingId: m.meetingId, date: m.date, name: m.name, type: m.type, target: m.target }, cubs: cubs, squads: squadsOf_(secCubs_()) };
});

/** 儲存點名：只更新送來的小狼（以「集會＋小狼」為單位，同時點名不互相覆蓋）；空白＝刪除該筆 */
registerAdmin_('attendanceSave', 'attendance', function (req, who) {
  var marks = req.marks || {};
  var ids = Object.keys(marks).slice(0, 500);
  if (!ids.length) throw new ApiError(ERR.BAD_INPUT, '沒有要儲存的點名。');
  ids.forEach(function (k) { if (marks[k] !== '' && Logic.ATTEND_MARKS.indexOf(marks[k]) < 0) throw new ApiError(ERR.BAD_INPUT, '點名狀態只能是出席、遲到、請假或空白。'); });
  return withLock_(function () {
    var m = findMeeting_(req.meetingId);
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
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && meetingVisible_(m) && m.date >= from && m.date <= to && m.date <= today; })
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
  var period = sectionPeriod_(curSec_(), today);
  var extra = {};
  if (period) loadExtra_().forEach(function (x) { if (x.period === period.name) extra[x.cubId] = (extra[x.cubId] || 0) + x.count; });
  var rows = secCubs_().filter(function (c) { return c.status === '在團' || c.status === Logic.TRIAL; }).map(function (c) {
    var cells = meetings.map(function (m) { return st[c.cubId + '|' + m.meetingId] || ''; });
    var counts = Logic.attendanceCounts(cells.map(function (x) { return { status: x }; }));
    var rate = period ? Logic.attendanceRate(allAtt[c.cubId] || [], period, extra[c.cubId] || 0) : null;
    return { cubId: c.cubId, name: c.name, squad: c.squad, trial: c.status === Logic.TRIAL, cells: cells, counts: counts, extra: extra[c.cubId] || 0, rate: rate ? rate.text : '' };
  });
  return { meetings: meetings.map(function (m) { return { meetingId: m.meetingId, date: m.date, name: m.name }; }), rows: rows, period: period, squads: squadsOf_(secCubs_()) };
});

/** 年度出席設定：目前分團自己的＋全團預設（附錄第 73 點）；全團預設由管理員或總團設定 */
registerAdmin_('periodList', 'viewOverview', function (req, who) {
  var sec = curSec_(), all = canManageAll_(who);
  return {
    periods: loadPeriods_().filter(function (p) { return p.target === sec || p.target === Logic.ALL; }).map(function (p) {
      return { name: p.name, start: p.start, end: p.end, total: p.total, note: p.note, target: p.target, canEdit: p.target === Logic.ALL ? all : true };
    }),
    current: (sectionPeriod_(sec, today_()) || {}).name || '', section: sec, canManageAll: all
  };
});

/** 新增或修改年度出席設定（以年度名稱為鍵） */
registerAdmin_('periodSave', 'manageCalendar', function (req, who) {
  var name = Logic.clean(req.name).slice(0, 30);
  if (!name) throw new ApiError(ERR.BAD_INPUT, '請填寫年度名稱，例如「115學年度」。');
  var start = requireDate_(Logic.clean(req.start), '開始日'), end = requireDate_(Logic.clean(req.end), '結束日');
  if (end < start) throw new ApiError(ERR.BAD_INPUT, '結束日不可早於開始日。');
  var total = Number(req.total);
  if (!(total >= 0 && total <= 500 && Math.floor(total) === total)) throw new ApiError(ERR.BAD_INPUT, '應出席總數需為 0～500 的整數。');
  var target = Logic.clean(req.target) === Logic.ALL ? Logic.ALL : curSec_();
  if (target === Logic.ALL && !canManageAll_(who)) throw new ApiError(ERR.FORBIDDEN, '全團預設由管理員或總團設定；請設定自己分團的年度。');
  return withLock_(function () {
    var row = [name, start, end, total, Logic.clean(req.note).slice(0, 100), target];
    // 以「年度名稱＋分團」為鍵：同名的全團預設與分團設定分開存
    var cur = loadPeriods_().filter(function (p) { return p.name === name && p.target === target; })[0];
    if (cur) updateRows_(SHEET.PERIODS, [{ row: cur._row, values: row }]);
    else appendRows_(SHEET.PERIODS, [row]);
    logOp_(who.account.accountId, '設定年度出席', name + '（' + target + '）', cur ? [cur.start, cur.end, cur.total].join('／') : '', [start, end, total].join('／'));
    return {};
  });
});

/** 設定某位小狼某年度的額外出席次數（有參加額外活動才給；0 表示清除） */
registerAdmin_('extraSave', 'manageCalendar', function (req, who) {
  var period = Logic.clean(req.period), cubId = Logic.clean(req.cubId), count = Number(req.count);
  if (!(count >= 0 && count <= 100 && Math.floor(count) === count)) throw new ApiError(ERR.BAD_INPUT, '額外出席次數需為 0～100 的整數。');
  return withLock_(function () {
    if (!loadPeriods_().some(function (p) { return p.name === period && (p.target === curSec_() || p.target === Logic.ALL); })) throw new ApiError(ERR.NOT_FOUND, '找不到這個年度。');
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
  // [修補] 驗證目標團員屬於目前分團，防止跨分團檢視個資處理預覽
  var cub = findCub_(req.cubId);
  var plan = Logic.planPrivacy(privacyData_(), cub.cubId, Logic.clean(req.mode));
  if (!plan.ok) throw new ApiError(ERR.BAD_INPUT, plan.error);
  return { cubName: plan.cubName, counts: plan.counts };
});

/** 執行匿名化或完全刪除：需輸入該小狼姓名確認；日誌不記姓名 */
registerAdmin_('privacyExecute', 'privacy', function (req, who) {
  return withLock_(function () {
    var mode = Logic.clean(req.mode);
    // 完全刪除只有最高權限帳號（admin）可以；還沒有 admin 帳號時照舊（SPEC 附錄第 48 點）
    var owner = ownerId_();
    if (mode === 'delete' && owner && who.account.accountId !== owner) throw new ApiError(ERR.FORBIDDEN, '只有最高權限帳號（admin）可以刪除小狼；其他團長可以用匿名化。');
    // [修補] 驗證目標團員屬於目前分團，防止跨分團匿名化或刪除
    var cub = findCub_(req.cubId);
    var plan = Logic.planPrivacy(privacyData_(), cub.cubId, mode);
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
    // LINE 跟著人走：這個人每一列的連結都清掉
    var mine = loadAdminRows_().filter(function (x) { return x.accountId === who.account.accountId; });
    updateRows_(SHEET.ADMINS, mine.filter(function (a) { return a.lineUserId; }).map(function (a) {
      var row = a._raw.slice(0, HEADERS[SHEET.ADMINS].length);
      row[5] = ''; row[6] = '';
      return { row: a._row, values: row };
    }));
    logOp_(who.account.accountId, '解除 LINE 連結', who.admin.name, '', '');
    return {};
  });
});

// ───────────── 列印簽核單（依小狼或依小隊） ─────────────

/** 一個進程級別、多位小狼的簽核單資料 */
registerAdmin_('printData', 'printSheet', function (req) {
  var unit = Logic.clean(req.unit);
  if (!Logic.isLevelOf(curSec_(), unit)) throw new ApiError(ERR.BAD_INPUT, '請選擇進程級別。');
  var ids = (req.cubIds || []).map(Logic.clean);
  var ctx = progressCtx_();
  var names = adminNames_();
  var signerOf = {};
  ctx.completions.forEach(function (c) { if (Logic.isCountedCompletion(c)) signerOf[c.cubId + '|' + c.itemId] = c.signer; });
  var info = loadUnits_(curSec_())[Logic.CATEGORY.PROGRESS + '|' + unit] || {};
  var sheets = secCubs_().filter(function (c) { return ids.indexOf(c.cubId) >= 0; }).map(function (c) {
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
  secCubs_().forEach(function (c) { if (c.status === '在團' && c.squad) count[c.squad] = (count[c.squad] || 0) + 1; });
  var list = squadListOf_();
  var extra = Object.keys(count).filter(function (k) { return list.indexOf(k) < 0; });
  var staff = loadSquadStaff_().filter(function (x) { return x.section === curSec_(); }), names = adminNamesIn_();
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
    var cubs = secCubs_();
    var inUse = cubs.filter(function (c) { return c.status === '在團' && c.squad; }).map(function (c) { return c.squad; });
    var cur = squadListOf_();
    var key = Logic.sectionSettingKey('小隊清單', curSec_());
    var r = Logic.changeSquads(cur, { type: Logic.clean(req.type), name: req.name, newName: req.newName, dir: req.dir }, inUse);
    if (!r.ok) throw new ApiError(ERR.BAD_INPUT, r.error);
    // [修補] 清單順序無變動（例如第一隊按上移）時略過寫入與操作日誌
    if (r.list.join('、') === cur.join('、')) return { squads: r.list, moved: 0 };
    var row = readRows_(SHEET.SETTINGS).filter(function (x) { return Logic.clean(x[0]) === key; })[0];
    var values = [key, r.list.join('、'), (Logic.SETTINGS.filter(function (x) { return x.key === key; })[0] || {}).desc || ''];
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
      var st = loadSquadStaff_().filter(function (x) { return x.squad === from && x.section === curSec_(); });
      if (st.length) updateRows_(SHEET.SQUAD_STAFF, st.map(function (x) { var v = x._raw.slice(0, HEADERS[SHEET.SQUAD_STAFF].length); v[0] = to; return { row: x._row, values: v }; }));
    }
    if (req.type === 'remove') {
      var gone = loadSquadStaff_().filter(function (x) { return x.squad === Logic.clean(req.name) && x.section === curSec_(); });
      if (gone.length) deleteRows_(SHEET.SQUAD_STAFF, gone.map(function (x) { return x._row; }));
    }
    logOp_(who.account.accountId, '小隊設定', Logic.clean(req.type), cur.join('、'), r.list.join('、') + (moved ? '（更新 ' + moved + ' 位小狼）' : ''));
    return { squads: r.list, moved: moved };
  });
});
