/**
 * 項目管理（SPEC 7.7，階段 4B，團長專用；附錄第 75 點起各分團只管自己的項目，依目前分團 curSec_()）
 * - 項目ID 一經產生永不更改、永不重用；只停用不刪除。
 * - 會影響達標的操作（新增、停用、重新啟用）先回傳影響預覽，團長確認後才寫入。
 * - 每次修改寫入操作日誌（含修改前與修改後）。
 * - 已頒章紀錄不受影響；有頒章紀錄的技能章不能改名（頒章紀錄以章名對應）。
 */

/** 項目或細項有變動後，清掉公開查詢的快取，讓查詢頁馬上看到 */
function itemsChanged_() {
  try { removeCatalogCache_(); } catch (e) { /* 快取失敗不影響存檔 */ }
  invalidate_(SHEET.ITEMS); invalidate_(SHEET.UNITS); invalidate_(SHEET.DETAILS);
}

/** 項目總表的原始列；section 有給時只回該分團的列（第 8 欄分團，空白＝小狼） */
function anyIdsOf_(items) { var m = {}; items.forEach(function (it) { m[it.id] = true; }); return m; }
function rawItemRows_(section) {
  return readRows_(SHEET.ITEMS).filter(function (r) { return Logic.clean(r[0]) && (!section || Logic.sectionOf(r[7]) === Logic.sectionOf(section)); });
}
function itemRowValues_(r) { return HEADERS[SHEET.ITEMS].map(function (h, j) { return r[j] === undefined ? '' : r[j]; }); }
function findItemRow_(id) {
  var r = rawItemRows_(curSec_()).filter(function (x) { return Logic.clean(x[0]) === Logic.clean(id); })[0];
  if (!r) throw new ApiError(ERR.NOT_FOUND, '找不到這個項目，請重新整理。');
  return r;
}
function cleanText_(t, max, label) {
  var v = Logic.clean(t).replace(/\s*\n\s*/g, ' ');
  if (!v) throw new ApiError(ERR.BAD_INPUT, '請填寫' + label + '。');
  if (v.length > max) throw new ApiError(ERR.BAD_INPUT, label + '最多 ' + max + ' 字。');
  return v;
}

/**
 * 影響預覽：用修改後的項目清單重算在團小狼，列出「已完成待頒發」狀態會改變的人。
 * @return {string[]} 給團長看的警告（沒有影響時為空陣列）
 */
function itemImpact_(newItems, category, unit) {
  var ctx = progressCtx_();
  var after = Object.assign({}, ctx, { items: newItems });
  var toPending = [], fromPending = [];
  secCubs_().filter(function (c) { return c.status === '在團'; }).forEach(function (c) {
    var pick = function (x) { return progressOf_(x, c.cubId).units.filter(function (u) { return u.category === category && u.unit === unit; })[0] || {}; };
    var b = pick(ctx).status, a = pick(after).status;
    if (b === Logic.STATUS.DONE_PENDING && a !== Logic.STATUS.DONE_PENDING) fromPending.push(c.name);
    if (b !== Logic.STATUS.DONE_PENDING && a === Logic.STATUS.DONE_PENDING) toPending.push(c.name);
  });
  var label = category === Logic.CATEGORY.PROGRESS ? (unit === Logic.NEWBIE ? unit : unit + '級') : unit;
  var w = [];
  if (fromPending.length) w.push('這會讓 ' + fromPending.length + ' 位團員的「' + label + '」從「已完成待頒發」變成「進行中」：' + fromPending.join('、'));
  if (toPending.length) w.push('這會讓 ' + toPending.length + ' 位團員的「' + label + '」從「進行中」變成「已完成待頒發」：' + toPending.join('、'));
  return w;
}

/** 目前項目清單（parseItems 結果）套用一個變更後的樣子，供影響預覽 */
function itemsWith_(change) {
  var list = loadItems_().items.map(function (it) { return Object.assign({}, it); });
  if (change.add) list.push(change.add);
  if (change.id) list.forEach(function (it) { if (it.id === change.id) it.enabled = change.enabled; });
  return list;
}

registerAdmin_('itemsTree', 'manageItems', function () {
  var sec = curSec_(), mod = Logic.progressModule(sec);
  var all = loadItems_();
  var parsed = { items: all.items.filter(function (it) { return it.sec === sec; }), errors: all.errors };
  var unitsMap = loadUnits_(sec);
  var awardedUnits = {};
  loadAwards_().forEach(function (a) { if (a.sec === sec) awardedUnits[a.unit] = true; });
  var units = Object.keys(unitsMap).map(function (k) {
    var u = unitsMap[k];
    return { category: u.category, unit: u.name, group: u.group, desc: u.desc, rule: u.rule, order: u.order, hasAwards: !!awardedUnits[u.name] };
  });
  // 項目總表有、說明分頁沒有的級別或章也要列出來
  parsed.items.forEach(function (it) {
    if (!units.some(function (u) { return u.category === it.category && u.unit === it.unit; })) {
      units.push({ category: it.category, unit: it.unit, group: '', desc: '', rule: '', order: 9999, hasAwards: !!awardedUnits[it.unit] });
    }
  });
  units.sort(function (a, b) { return a.order - b.order; });
  var ids = {};
  parsed.items.forEach(function (it) { ids[it.id] = true; });
  var detailErrors = sec === Logic.DEFAULT_SECTION && ss_().getSheetByName(SHEET.DETAILS) ? Logic.parseDetails(readAll_(SHEET.DETAILS), anyIdsOf_(all.items)).errors : [];
  // 細項只列這個分團項目底下的（找不到項目的列算小狼的，讓小狼團長看得到錯誤）
  var anyIds = {};
  all.items.forEach(function (it) { anyIds[it.id] = true; });
  var mineDetail = function (id) { return ids[id] || (!anyIds[id] && sec === Logic.DEFAULT_SECTION); };
  var details = ss_().getSheetByName(SHEET.DETAILS) ? readRows_(SHEET.DETAILS).filter(function (r) { return (Logic.clean(r[0]) || Logic.clean(r[2])) && mineDetail(Logic.clean(r[0])); }).map(function (r) {
    return { key: r._row, itemId: Logic.clean(r[0]), group: Logic.clean(r[1]), text: Logic.clean(r[2]), standard: Logic.clean(r[3]), life: Logic.clean(r[4]), order: Number(r[5]) || 9999, enabled: Logic.clean(r[6]) !== '否' };
  }) : [];
  return {
    units: units,
    items: parsed.items.map(function (it) { return { id: it.id, category: it.category, unit: it.unit, section: it.section, text: it.text, order: it.order, enabled: it.enabled }; }),
    details: details,
    errors: { items: parsed.errors, details: detailErrors },
    section: sec, groups: mod.badgeGroups, levels: mod.levels
  };
});

/** 修改項目文字（id）或新增項目（沒有 id）；新增會影響達標，需確認 */
registerAdmin_('itemSave', 'manageItems', function (req, who) {
  var text = cleanText_(req.text, 300, '項目內容');
  return withLock_(function () {
    if (req.id) {
      var r = findItemRow_(req.id);
      var before = Logic.clean(r[4]);
      if (before === text) return { id: Logic.clean(r[0]), changed: 0 };
      var v = itemRowValues_(r); v[4] = text;
      updateRows_(SHEET.ITEMS, [{ row: r._row, values: v }]);
      logOp_(who.account.accountId, '修改項目', Logic.clean(r[0]), before, text);
      itemsChanged_();
      return { id: Logic.clean(r[0]), changed: 1 };
    }
    var category = Logic.clean(req.category), unit = Logic.clean(req.unit);
    if (category === Logic.CATEGORY.PROGRESS) {
      if (!Logic.isLevelOf(curSec_(), unit)) throw new ApiError(ERR.BAD_INPUT, '請選擇進程級別。');
    } else if (category === Logic.CATEGORY.BADGE) {
      if (!loadUnits_(curSec_())[category + '|' + unit]) throw new ApiError(ERR.BAD_INPUT, '找不到這個技能章，請先新增技能章。');
    } else throw new ApiError(ERR.BAD_INPUT, '類別只能是進程或技能章。');
    var section = category === Logic.CATEGORY.PROGRESS ? (Logic.clean(req.section) || Logic.NO_SECTION) : Logic.NO_SECTION;
    if (section.length > 20) throw new ApiError(ERR.BAD_INPUT, '大項名稱最多 20 字。');
    var raws = rawItemRows_();
    var id = Logic.nextItemId(raws.map(function (x) { return x[0]; }), category, unit, section, curSec_());
    var sameUnit = rawItemRows_(curSec_()).filter(function (x) { return Logic.clean(x[1]) === category && Logic.clean(x[2]) === unit; });
    var maxOrder = 0;
    sameUnit.forEach(function (x) { var n = Number(x[5]); if (isFinite(n) && n > maxOrder) maxOrder = n; });
    // 排在同一大項最後一項之後；沒有同大項時排在該級最後
    var sameSec = sameUnit.filter(function (x) { return (Logic.clean(x[3]) || Logic.NO_SECTION) === section; });
    var order = maxOrder + 10;
    if (sameSec.length) {
      var lastSec = Math.max.apply(null, sameSec.map(function (x) { return Number(x[5]) || 0; }));
      order = lastSec + 0.5 > maxOrder ? maxOrder + 10 : lastSec + 0.5;
    }
    var warnings = itemImpact_(itemsWith_({ add: { id: id, category: category, unit: unit, section: section, text: text, order: order, enabled: true, sec: curSec_() } }), category, unit);
    if (warnings.length && !req.confirm) return { needConfirm: true, warnings: warnings };
    appendRows_(SHEET.ITEMS, [[id, category, unit, section, text, order, '是', secCell_(curSec_())]]);
    logOp_(who.account.accountId, '新增項目', id, '', [unit, section, text].join('／'));
    itemsChanged_();
    return { id: id, changed: 1 };
  });
});

/** 停用／重新啟用（不刪除）；會影響達標，需確認 */
registerAdmin_('itemToggle', 'manageItems', function (req, who) {
  var enabled = req.enabled === true;
  return withLock_(function () {
    var r = findItemRow_(req.id);
    var id = Logic.clean(r[0]);
    if ((Logic.clean(r[6]) === '是') === enabled) return { changed: 0 };
    var warnings = itemImpact_(itemsWith_({ id: id, enabled: enabled }), Logic.clean(r[1]), Logic.clean(r[2]));
    if (warnings.length && !req.confirm) return { needConfirm: true, warnings: warnings };
    var v = itemRowValues_(r); v[6] = enabled ? '是' : '否';
    updateRows_(SHEET.ITEMS, [{ row: r._row, values: v }]);
    logOp_(who.account.accountId, enabled ? '重新啟用項目' : '停用項目', id, enabled ? '否' : '是', enabled ? '是' : '否');
    itemsChanged_();
    return { changed: 1 };
  });
});

/** 同一大項內上移／下移：只改「排序」欄 */
registerAdmin_('itemMove', 'manageItems', function (req, who) {
  return withLock_(function () {
    var r = findItemRow_(req.id);
    var key = function (x) { return Logic.clean(x[1]) + '|' + Logic.clean(x[2]) + '|' + (Logic.clean(x[3]) || Logic.NO_SECTION); };
    var sibs = rawItemRows_(curSec_()).filter(function (x) { return key(x) === key(r); })
      .sort(function (a, b) { return (Number(a[5]) || 9999) - (Number(b[5]) || 9999) || a._row - b._row; });
    var i = sibs.indexOf(sibs.filter(function (x) { return x._row === r._row; })[0]);
    var j = Logic.clean(req.dir) === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= sibs.length) return { changed: 0 };
    // 先依目前位置給出不重複的排序值，再交換兩者
    var base = Number(sibs[0][5]) || 10;
    var orders = sibs.map(function (x, k) { return base + k; });
    var tmp = orders[i]; orders[i] = orders[j]; orders[j] = tmp;
    var ups = [];
    sibs.forEach(function (x, k) {
      if (Number(x[5]) !== orders[k]) { var v = itemRowValues_(x); v[5] = orders[k]; ups.push({ row: x._row, values: v }); }
    });
    if (ups.length) updateRows_(SHEET.ITEMS, ups);
    logOp_(who.account.accountId, '調整項目順序', Logic.clean(r[0]), String(i + 1), String(j + 1));
    itemsChanged_();
    return { changed: 1 };
  });
});

/** 大項改名：同一級（或章）同一大項的所有項目一起改，項目ID 不變 */
registerAdmin_('sectionRename', 'manageItems', function (req, who) {
  var category = Logic.clean(req.category), unit = Logic.clean(req.unit), section = Logic.clean(req.section);
  var name = cleanText_(req.newName, 20, '新的大項名稱');
  if (name === Logic.NO_SECTION) throw new ApiError(ERR.BAD_INPUT, '大項名稱不可以是「－」。');
  return withLock_(function () {
    var rows = rawItemRows_(curSec_()).filter(function (x) { return Logic.clean(x[1]) === category && Logic.clean(x[2]) === unit; });
    if (rows.some(function (x) { return Logic.clean(x[3]) === name; })) throw new ApiError(ERR.BAD_INPUT, '這一級已經有「' + name + '」這個大項了。');
    var target = rows.filter(function (x) { return (Logic.clean(x[3]) || Logic.NO_SECTION) === section; });
    if (!target.length) throw new ApiError(ERR.NOT_FOUND, '找不到這個大項，請重新整理。');
    updateRows_(SHEET.ITEMS, target.map(function (x) { var v = itemRowValues_(x); v[3] = name; return { row: x._row, values: v }; }));
    logOp_(who.account.accountId, '大項改名', unit, section, name);
    itemsChanged_();
    return { changed: target.length };
  });
});

/**
 * 級別或技能章的說明：
 * - 進程級別：只能改說明與晉級條件。
 * - 技能章：可改說明、分類；isNew 時新增技能章；newName 改章名（有頒章紀錄的章不能改名）。
 */
registerAdmin_('unitSave', 'manageItems', function (req, who) {
  var category = Logic.clean(req.category), unit = Logic.clean(req.unit);
  var desc = Logic.clean(req.desc).slice(0, 1000), rule = Logic.clean(req.rule).slice(0, 1000), group = Logic.clean(req.group);
  var sec = curSec_(), mod = Logic.progressModule(sec);
  return withLock_(function () {
    var allRows = readRows_(SHEET.UNITS).filter(function (r) { return Logic.clean(r[0]); });
    var rows = allRows.filter(function (r) { return Logic.sectionOf(r[6]) === sec; });
    var find = function (n) { return rows.filter(function (r) { return Logic.clean(r[0]) === n && Logic.clean(r[1]) === category; })[0]; };
    if (category === Logic.CATEGORY.BADGE && mod.badgeGroups.indexOf(group) < 0) throw new ApiError(ERR.BAD_INPUT, '請選擇技能章分類（' + mod.badgeGroups.join('／') + '）。');
    if (req.isNew) {
      if (category !== Logic.CATEGORY.BADGE) throw new ApiError(ERR.BAD_INPUT, '只能新增技能章。');
      var nn = cleanText_(req.unit, 20, '技能章名稱');
      if (find(nn) || mod.levels.indexOf(nn) >= 0) throw new ApiError(ERR.BAD_INPUT, '已經有「' + nn + '」了。');
      var maxOrder = 0;
      rows.forEach(function (r) { var n = Number(r[5]); if (isFinite(n) && n > maxOrder) maxOrder = n; });
      appendRows_(SHEET.UNITS, [[nn, category, group, desc, '', maxOrder + 10, secCell_(sec)]]);
      logOp_(who.account.accountId, '新增技能章', nn, '', group);
      itemsChanged_();
      return { unit: nn };
    }
    var r = find(unit);
    var newName = Logic.clean(req.newName);
    if (newName && newName !== unit) {
      if (category !== Logic.CATEGORY.BADGE) throw new ApiError(ERR.BAD_INPUT, '進程級別不能改名。');
      newName = cleanText_(newName, 20, '新的章名');
      if (find(newName) || mod.levels.indexOf(newName) >= 0) throw new ApiError(ERR.BAD_INPUT, '已經有「' + newName + '」了。');
      if (loadAwards_().some(function (a) { return a.unit === unit && a.sec === sec; })) throw new ApiError(ERR.BAD_INPUT, '「' + unit + '」已經有頒章紀錄，不能改名（頒章紀錄是用章名對應的）。');
      var its = rawItemRows_(sec).filter(function (x) { return Logic.clean(x[1]) === category && Logic.clean(x[2]) === unit; });
      if (its.length) updateRows_(SHEET.ITEMS, its.map(function (x) { var v = itemRowValues_(x); v[2] = newName; return { row: x._row, values: v }; }));
      // 上傳過的章圖跟著新名字（SPEC 附錄第 50 點）
      var img = loadUnitImages_(sec)[category + '|' + unit];
      if (img) { var iv = readRows_(SHEET.UNIT_IMAGES).filter(function (x) { return x._row === img._row; })[0]; updateRows_(SHEET.UNIT_IMAGES, [{ row: img._row, values: [newName, iv[1], iv[2], iv[3], iv[4], iv[5] === undefined ? '' : iv[5]] }]); }
      logOp_(who.account.accountId, '技能章改名', unit, unit, newName);
    }
    var finalName = newName || unit;
    if (category === Logic.CATEGORY.PROGRESS && mod.levels.indexOf(finalName) < 0) throw new ApiError(ERR.BAD_INPUT, '請選擇進程級別。');
    var vals = [finalName, category, category === Logic.CATEGORY.BADGE ? group : '', desc, category === Logic.CATEGORY.PROGRESS ? rule : (r ? Logic.clean(r[4]) : ''), r ? (Number(r[5]) || 9999) : 9999, secCell_(sec)];
    if (r) {
      var before = [Logic.clean(r[2]), Logic.clean(r[3]), Logic.clean(r[4])].join('｜');
      updateRows_(SHEET.UNITS, [{ row: r._row, values: vals }]);
      logOp_(who.account.accountId, '修改說明', finalName, before, [vals[2], vals[3], vals[4]].join('｜'));
    } else {
      appendRows_(SHEET.UNITS, [vals]);
      logOp_(who.account.accountId, '修改說明', finalName, '', [vals[2], vals[3], vals[4]].join('｜'));
    }
    itemsChanged_();
    return { unit: finalName };
  });
});

/** 本團細項：修改（key＝試算表列號，需附原本的項目ID與內容核對）或新增 */
registerAdmin_('detailSave', 'manageItems', function (req, who) {
  var itemId = Logic.clean(req.itemId);
  var text = cleanText_(req.text, 200, '細項內容');
  var group = Logic.clean(req.group).slice(0, 60), standard = Logic.clean(req.standard).slice(0, 200), life = Logic.clean(req.life).slice(0, 200);
  return withLock_(function () {
    if (!sectionItems_(curSec_()).some(function (it) { return it.id === itemId; })) throw new ApiError(ERR.NOT_FOUND, '找不到這個項目，請重新整理。');
    if (req.key) {
      var r = detailRow_(req.key, req.origItemId, req.origText);
      var before = [r[1], r[2], r[3], r[4]].map(Logic.clean).join('｜');
      var v = HEADERS[SHEET.DETAILS].map(function (h, j) { return r[j] === undefined ? '' : r[j]; });
      v[0] = itemId; v[1] = group; v[2] = text; v[3] = standard; v[4] = life;
      updateRows_(SHEET.DETAILS, [{ row: r._row, values: v }]);
      logOp_(who.account.accountId, '修改細項', itemId, before, [group, text, standard, life].join('｜'));
    } else {
      var maxOrder = 0;
      readRows_(SHEET.DETAILS).forEach(function (x) { var n = Number(x[5]); if (isFinite(n) && n > maxOrder) maxOrder = n; });
      // 排在同一項目最後一條細項後面
      var mine = readRows_(SHEET.DETAILS).filter(function (x) { return Logic.clean(x[0]) === itemId; });
      var order = mine.length ? Math.max.apply(null, mine.map(function (x) { return Number(x[5]) || 0; })) + 0.5 : maxOrder + 10;
      appendRows_(SHEET.DETAILS, [[itemId, group, text, standard, life, order, '是']]);
      logOp_(who.account.accountId, '新增細項', itemId, '', [group, text].join('｜'));
    }
    itemsChanged_();
    return {};
  });
});

registerAdmin_('detailToggle', 'manageItems', function (req, who) {
  var enabled = req.enabled === true;
  return withLock_(function () {
    var r = detailRow_(req.key, req.origItemId, req.origText);
    var v = HEADERS[SHEET.DETAILS].map(function (h, j) { return r[j] === undefined ? '' : r[j]; });
    v[6] = enabled ? '是' : '否';
    updateRows_(SHEET.DETAILS, [{ row: r._row, values: v }]);
    logOp_(who.account.accountId, enabled ? '重新啟用細項' : '停用細項', Logic.clean(r[0]), Logic.clean(r[2]), enabled ? '是' : '否');
    itemsChanged_();
    return {};
  });
});

/** 依列號取細項，並核對項目ID與內容沒被別人改過（試算表可能同時被編輯） */
function detailRow_(key, origItemId, origText) {
  var r = readRows_(SHEET.DETAILS).filter(function (x) { return x._row === Number(key); })[0];
  if (!r || Logic.clean(r[0]) !== Logic.clean(origItemId) || Logic.clean(r[2]) !== Logic.clean(origText) ||
    !sectionItems_(curSec_()).some(function (it) { return it.id === Logic.clean(r[0]); })) {
    throw new ApiError(ERR.BAD_INPUT, '這條細項剛剛被修改過，請重新整理後再試。');
  }
  return r;
}

/** 匯出項目總表（含停用項目）為 CSV 文字，前端下載 */
registerAdmin_('itemsExport', 'manageItems', function () {
  var rows = [HEADERS[SHEET.ITEMS]].concat(rawItemRows_(curSec_()).map(itemRowValues_));
  return { csv: Logic.toCsv(rows), filename: '項目總表_' + (curSec_() === Logic.DEFAULT_SECTION ? '' : curSec_() + '_') + today_() + '.csv' };
});

/** 重新載入：清掉快取（直接改了試算表後使用） */
registerAdmin_('itemsReload', 'manageItems', function () {
  itemsChanged_();
  return { errors: loadItems_().errors.length };
});
