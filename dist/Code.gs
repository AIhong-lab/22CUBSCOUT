/**
 * 幼童軍進程系統後端（自動產生的合併檔，請勿手動修改）
 * 來源：gas/ 資料夾各檔案。修改後執行 npm run build 重新產生。
 * 部署：整份複製貼到 Apps Script 的「程式碼.gs」（取代原內容）後儲存。
 */

// ════════════════ Logic.js ════════════════
/**
 * 純邏輯函式庫（不依賴 SpreadsheetApp 等 Google 服務）
 *
 * GAS 與 Node 測試共用同一份檔案：
 *  - 在 GAS 中：透過全域物件 `Logic` 使用。
 *  - 在 Node 中：`require('../gas/Logic.js')`。
 *
 * 慣例：
 *  - 日期一律用 'YYYY-MM-DD' 字串（台灣時間），避免時區問題；時間戳記用毫秒數。
 *  - 需要亂數或雜湊的函式，由呼叫端注入（GAS 用 Utilities，Node 用 crypto），本檔不直接呼叫。
 *  - 本檔函式只「計算」，不寫入任何資料；寫入由 GAS 層依計算結果批次執行。
 */
var Logic = (function () {
  'use strict';

  // ───────────── 常數 ─────────────

  /** 進程級別，依序 */
  var LEVELS = ['羚羊', '狼', '鹿', '豹'];
  var CATEGORY = { PROGRESS: '進程', BADGE: '技能章' };
  var BADGE_GROUPS = ['服務類', '健身類', '技巧類'];
  var NO_SECTION = '－';

  /** 四種狀態（查詢端與後台統一使用） */
  var STATUS = {
    AWARDED: '已頒發',
    DONE_PENDING: '已完成待頒發',
    IN_PROGRESS: '進行中',
    NOT_STARTED: '未開始'
  };

  /** 已完成待頒發在查詢端的固定文字（SPEC 第六節第 3 點） */
  var PENDING_TEXT_FOR_PARENTS = '項目已全部完成，等待團長評核頒發';

  var ROLE = { LEADER: '團長', ASSISTANT: '服務員' };

  /** 綁定碼／邀請碼／臨時碼字元集：大寫英文與數字，排除 0、O、1、I、L */
  var CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  // ───────────── 日期工具 ─────────────

  function isDateStr(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }

  function cmpDate(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function maxDate(list) {
    var m = '';
    list.forEach(function (d) { if (d && d > m) m = d; });
    return m || null;
  }

  /** 加 n 個月；遇月底時取該月最後一天（例：1/31 + 1 個月 = 2/28 或 2/29） */
  function addMonths(dateStr, n) {
    var p = dateStr.split('-').map(Number);
    var y = p[0], m = p[1] - 1 + n, d = p[2];
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var day = Math.min(d, last);
    return y + '-' + pad2(m + 1) + '-' + pad2(day);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 入團至今多久，回傳 {years, months, text}；入團日在未來時視為 0 */
  function tenure(joinDate, today) {
    if (!isDateStr(joinDate) || !isDateStr(today) || joinDate > today) return { years: 0, months: 0, text: '0 年 0 個月' };
    var a = joinDate.split('-').map(Number), b = today.split('-').map(Number);
    var months = (b[0] - a[0]) * 12 + (b[1] - a[1]);
    if (b[2] < a[2]) months -= 1;
    // 入團日是月底（例如 1/31）時，2/28 也算滿一個月
    if (b[2] < a[2] && addMonths(joinDate, months + 1) <= today) months += 1;
    var years = Math.floor(months / 12);
    return { years: years, months: months % 12, text: years + ' 年 ' + (months % 12) + ' 個月' };
  }

  // ───────────── 文字與 CSV 工具 ─────────────

  function clean(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  /** 解析 CSV（支援雙引號、逗號、換行） */
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false;
    text = String(text).replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return clean(x) !== ''; }); });
  }

  function toCsv(rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = v === null || v === undefined ? '' : String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n') + '\n';
  }

  // ───────────── 設定值 ─────────────

  /** 設定分頁的鍵、預設值與合理範圍（SPEC 第四節，含帳號密碼版本的調整） */
  var SETTINGS = [
    { key: '綁定碼長度', type: 'int', def: 6, min: 4, max: 12, desc: '家長綁定碼的字元數；管理員邀請碼自動多 2 碼' },
    { key: '綁定碼可用次數', type: 'int', def: 3, min: 1, max: 20, desc: '同一組綁定碼可讓幾個帳號使用' },
    { key: '失敗鎖定次數', type: 'int', def: 5, min: 3, max: 20, desc: '登入或綁定錯誤幾次後鎖定' },
    { key: '失敗鎖定分鐘數', type: 'int', def: 60, min: 5, max: 1440, desc: '鎖定多久' },
    { key: '未登入綁定失敗全站上限（每小時）', type: 'int', def: 20, min: 5, max: 200, desc: '未登入時輸入綁定碼錯誤，全站每小時累計達此數即暫停註冊' },
    { key: '密碼最短長度', type: 'int', def: 8, min: 6, max: 32, desc: '' },
    { key: '登入保持天數', type: 'int', def: 30, min: 1, max: 180, desc: '勾選「記住我」時登入有效天數' },
    { key: '臨時碼有效小時數', type: 'int', def: 24, min: 1, max: 168, desc: '重設密碼用的臨時碼有效時間' },
    { key: '管理員邀請碼有效小時數', type: 'int', def: 24, min: 1, max: 720, desc: '' },
    { key: '晉級間隔月數', type: 'int', def: 6, min: 0, max: 24, desc: '狼、鹿、豹級距上一級頒發日期需滿幾個月' },
    { key: '晉級所需出席次數', type: 'int', def: 0, min: 0, max: 100, desc: '狼、鹿、豹級：上一級頒發日之後需「出席」幾次（請假不算）；填 0 表示不要求' },
    { key: '出席自動完成項目ID', type: 'str', def: 'P-羚羊-7', pattern: /^[PB]-\S+-\d+$/, desc: '出席滿次數後自動完成的項目（預設為羚羊「參加幼童軍團集會至少4次」）' },
    { key: '自動完成所需出席次數', type: 'int', def: 4, min: 1, max: 50, desc: '「出席」幾次後自動完成上面那一項（請假不算）' },
    { key: '快達標門檻（剩幾項以內）', type: 'int', def: 2, min: 1, max: 10, desc: '' },
    { key: '未頒章再提醒天數', type: 'int', def: 14, min: 0, max: 365, desc: '填 0 表示不提醒' },
    { key: '每日排程時間（幾點）', type: 'int', def: 8, min: 0, max: 23, desc: '' },
    { key: '每週備份', type: 'bool', def: true, desc: '是/否' },
    { key: '備份保留份數', type: 'int', def: 8, min: 1, max: 52, desc: '' },
    { key: '離團後提醒處理個資的天數', type: 'int', def: 180, min: 0, max: 3650, desc: '填 0 表示不提醒' }
  ];

  /**
   * 讀取設定分頁（二維陣列，含標題列），驗證範圍。
   * 不合理或缺少的值退回預設，並回報錯誤（後台首頁提示用）。
   * @return {{values: Object, errors: Array<{key, row, value, reason}>}}
   */
  function parseSettings(rows) {
    var found = {};
    (rows || []).slice(1).forEach(function (r, i) {
      var k = clean(r[0]);
      if (k) found[k] = { value: r[1], row: i + 2 };
    });
    var values = {}, errors = [];
    SETTINGS.forEach(function (s) {
      var f = found[s.key];
      if (!f || clean(f.value) === '') {
        values[s.key] = s.def;
        errors.push({ key: s.key, row: f ? f.row : null, value: '', reason: f ? '空白，已使用預設值' : '缺少此設定，已使用預設值' });
        return;
      }
      var raw = clean(f.value);
      if (s.type === 'str') {
        if (s.pattern.test(raw)) values[s.key] = raw;
        else { values[s.key] = s.def; errors.push({ key: s.key, row: f.row, value: raw, reason: '格式不正確，已使用預設值' }); }
        return;
      }
      if (s.type === 'bool') {
        if (raw === '是' || raw === '否') values[s.key] = raw === '是';
        else { values[s.key] = s.def; errors.push({ key: s.key, row: f.row, value: raw, reason: '只能填「是」或「否」，已使用預設值' }); }
        return;
      }
      var n = Number(raw);
      if (!/^-?\d+$/.test(raw) || n < s.min || n > s.max) {
        values[s.key] = s.def;
        errors.push({ key: s.key, row: f.row, value: raw, reason: '需為 ' + s.min + '～' + s.max + ' 的整數，已使用預設值' });
      } else values[s.key] = n;
    });
    return { values: values, errors: errors };
  }

  /** setup() 用：設定分頁初始內容（含標題列） */
  function defaultSettingsRows() {
    return [['鍵', '值', '說明']].concat(SETTINGS.map(function (s) {
      return [s.key, s.type === 'bool' ? (s.def ? '是' : '否') : s.def, s.desc];
    }));
  }

  // ───────────── 項目總表 ─────────────

  /**
   * 讀取項目總表（含標題列）並容錯：
   * 略過空白列、去除前後空白；項目ID 重複、缺少級別或章名、類別不對、啟用欄不是是/否時略過該列並回報列號。
   * 欄位：項目ID、類別、級別或章名、大項、項目內容、排序、啟用
   */
  function parseItems(rows) {
    var items = [], errors = [], seen = {};
    (rows || []).slice(1).forEach(function (r, i) {
      var rowNo = i + 2;
      var cells = [0, 1, 2, 3, 4, 5, 6].map(function (j) { return clean(r[j]); });
      if (cells.every(function (c) { return c === ''; })) return;
      var id = cells[0], cat = cells[1], unit = cells[2], section = cells[3] || NO_SECTION, text = cells[4];
      var order = Number(cells[5]), enabled = cells[6];
      var reason = null;
      if (!id) reason = '缺少項目ID';
      else if (seen[id]) reason = '項目ID 重複（與第 ' + seen[id] + ' 列相同）';
      else if (cat !== CATEGORY.PROGRESS && cat !== CATEGORY.BADGE) reason = '類別只能是「進程」或「技能章」';
      else if (!unit) reason = '缺少級別或章名';
      else if (cat === CATEGORY.PROGRESS && LEVELS.indexOf(unit) < 0) reason = '進程級別只能是羚羊、狼、鹿、豹';
      else if (!text) reason = '缺少項目內容';
      else if (enabled !== '是' && enabled !== '否') reason = '啟用欄只能是「是」或「否」';
      if (reason) { errors.push({ row: rowNo, id: id, reason: reason }); return; }
      seen[id] = rowNo;
      items.push({
        id: id, category: cat, unit: unit, section: section, text: text,
        order: isFinite(order) && cells[5] !== '' ? order : 9999,
        enabled: enabled === '是', row: rowNo
      });
    });
    items.sort(function (a, b) { return a.order - b.order || a.row - b.row; });
    return { items: items, errors: errors };
  }

  /**
   * 產生新的項目ID：同前綴取「用過的最大序號 + 1」，含已停用項目，永不重用。
   * @param {Array<string>} existingIds 項目總表中所有曾出現的ID（含停用、含格式錯誤列）
   */
  function nextItemId(existingIds, category, unit, section) {
    var prefix;
    if (category === CATEGORY.PROGRESS) {
      prefix = (section && section !== NO_SECTION) ? 'P-' + unit + '-' + section + '-' : 'P-' + unit + '-';
    } else prefix = 'B-' + unit + '-';
    var max = 0;
    (existingIds || []).forEach(function (id) {
      id = clean(id);
      if (id.indexOf(prefix) !== 0) return;
      var rest = id.slice(prefix.length);
      if (/^\d+$/.test(rest)) max = Math.max(max, Number(rest));
    });
    return prefix + (max + 1);
  }

  /**
   * 種子資料轉為項目總表列（setup 第一次匯入用）。
   * CSV 欄位：類別,級別或章名,大項或分類,項目內容
   * 技能章的第三欄是「分類」，寫入級別與章說明；項目的大項填「－」。
   * @return {{itemRows: Array, unitRows: Array}} 均不含標題列
   */
  function buildSeed(csvText, progressRules) {
    var rows = parseCsv(csvText).slice(1);
    var ids = [], itemRows = [], units = {}, unitOrder = [];
    rows.forEach(function (r, i) {
      var cat = clean(r[0]), unit = clean(r[1]), third = clean(r[2]), text = clean(r[3]);
      var section = cat === CATEGORY.PROGRESS ? (third || NO_SECTION) : NO_SECTION;
      var id = nextItemId(ids, cat, unit, section);
      ids.push(id);
      itemRows.push([id, cat, unit, section, text, (i + 1) * 10, '是']);
      if (!units[unit + '|' + cat]) {
        units[unit + '|' + cat] = true;
        unitOrder.push({ name: unit, category: cat, group: cat === CATEGORY.BADGE ? third : '' });
      }
    });
    var unitRows = unitOrder.map(function (u, i) {
      return [u.name, u.category, u.group, '', u.category === CATEGORY.PROGRESS ? ((progressRules || {})[u.name] || '') : '', (i + 1) * 10];
    });
    return { itemRows: itemRows, unitRows: unitRows };
  }

  // ───────────── 完成紀錄與狀態判定 ─────────────

  /** 第二期預留：只有「回報狀態為空或已確認」才算完成 */
  function isCountedCompletion(rec) {
    var s = clean(rec && rec.reportStatus);
    return s === '' || s === '已確認';
  }

  /**
   * 計算一位小狼所有級別與技能章的狀態。
   * @param {Object} p
   *  - items: parseItems 的結果 items（只會使用啟用中的）
   *  - completions: [{cubId, itemId, date, signer, note, reporter, reportStatus}]
   *  - awards: [{cubId, unit, date, occasion, note, signer}]
   *  - cubId
   *  - intervalMonths: 晉級間隔月數
   *  - today: 'YYYY-MM-DD'
   * @return {{units: Array, currentLevel: string|null, nextLevel: string|null}}
   */
  function computeCubProgress(p) {
    var cubId = p.cubId;
    var done = {};
    (p.completions || []).forEach(function (c) {
      if (c.cubId !== cubId || !isCountedCompletion(c)) return;
      // 同一項目若有多筆，取最早日期
      if (!done[c.itemId] || c.date < done[c.itemId].date) done[c.itemId] = c;
    });
    // 出席（請假不算）的日期，由舊到新；呼叫端只傳這位小狼、啟用中集會的紀錄
    var attended = (p.attendance || []).filter(function (a) { return a.status === '出席' && isDateStr(a.date); })
      .map(function (a) { return a.date; }).sort();
    // 出席滿次數 → 自動完成指定項目（計算而得，不寫入完成紀錄；出席被修改時自動重算）
    if (p.autoItemId && p.autoCount > 0 && attended.length >= p.autoCount) {
      var autoDate = attended[p.autoCount - 1];
      if (!done[p.autoItemId] || autoDate < done[p.autoItemId].date) {
        done[p.autoItemId] = { date: autoDate, signer: '出席自動計算', auto: true };
      }
    }
    var awarded = {};
    (p.awards || []).forEach(function (a) { if (a.cubId === cubId) awarded[a.unit] = a; });

    var currentLevel = null;
    LEVELS.forEach(function (lv) { if (awarded[lv]) currentLevel = lv; });
    var nextLevel = currentLevel === null ? LEVELS[0] : (LEVELS[LEVELS.indexOf(currentLevel) + 1] || null);

    // 依類別與名稱分組（只算啟用項目）
    var groups = {}, order = [];
    (p.items || []).forEach(function (it) {
      if (!it.enabled) return;
      var k = it.category + '|' + it.unit;
      if (!groups[k]) { groups[k] = { category: it.category, unit: it.unit, items: [] }; order.push(k); }
      groups[k].items.push(it);
    });
    // 進程四級即使沒有項目也要列出
    LEVELS.forEach(function (lv) {
      var k = CATEGORY.PROGRESS + '|' + lv;
      if (!groups[k]) { groups[k] = { category: CATEGORY.PROGRESS, unit: lv, items: [] }; order.push(k); }
    });

    var units = order.map(function (k) {
      var g = groups[k];
      var total = g.items.length, doneCount = 0, dates = [];
      var itemStates = g.items.map(function (it) {
        var c = done[it.id];
        if (c) { doneCount++; dates.push(c.date); }
        return { id: it.id, section: it.section, text: it.text, done: !!c, date: c ? c.date : null, signer: c ? c.signer : null, auto: !!(c && c.auto) };
      });
      var allDone = total > 0 && doneCount === total;
      var award = awarded[g.unit] && (g.category === CATEGORY.PROGRESS ? LEVELS.indexOf(g.unit) >= 0 : true) ? awarded[g.unit] : null;
      var status;
      if (award) status = STATUS.AWARDED;
      else if (allDone) status = STATUS.DONE_PENDING;
      else if (doneCount > 0) status = STATUS.IN_PROGRESS;
      else status = (g.category === CATEGORY.PROGRESS && g.unit === nextLevel) ? STATUS.IN_PROGRESS : STATUS.NOT_STARTED;

      var u = {
        category: g.category, unit: g.unit, status: status, done: doneCount, total: total,
        remaining: total - doneCount, items: itemStates,
        lastCompletionDate: maxDate(dates),
        awardDate: award ? award.date : null, awardOccasion: award ? award.occasion : null,
        eligible: false, eligibleDate: null
      };
      if (!award) {
        var e = eligibility(g.category, g.unit, allDone, u.lastCompletionDate, awarded, p.intervalMonths, p.today, attended, p.levelAttendCount || 0);
        u.eligible = e.eligible; u.eligibleDate = e.date; u.waitingUntil = e.waitingUntil || null;
        if (e.attendRequired) { u.attendRequired = e.attendRequired; u.attendSinceLast = e.attendSinceLast; }
      }
      return u;
    });
    return { units: units, currentLevel: currentLevel, nextLevel: nextLevel };
  }

  /**
   * 達標（可頒章）判定：
   *  - 羚羊、技能章：啟用項目全部完成。
   *  - 狼、鹿、豹：全部完成，且上一級已頒發，且今天 ≥ 上一級頒發日期 + 間隔月數，
   *    且上一級頒發日「之後」（不含當天）出席次數 ≥ 晉級所需出席次數（0 表示不要求；請假不算）。
   * 回傳的 date 是「達標日期」= 以上各條件都滿足的最早日期。
   */
  function eligibility(category, unit, allDone, lastDate, awarded, intervalMonths, today, attended, attendNeed) {
    if (!allDone) return { eligible: false, date: null };
    if (category === CATEGORY.BADGE || unit === LEVELS[0]) return { eligible: true, date: lastDate };
    var prev = LEVELS[LEVELS.indexOf(unit) - 1];
    if (!awarded[prev]) return { eligible: false, date: null, reason: '上一級尚未頒發' };
    var prevDate = awarded[prev].date;
    var ready = addMonths(prevDate, intervalMonths || 0);
    var date = ready > lastDate ? ready : lastDate;
    var out = {};
    if (attendNeed > 0) {
      var after = (attended || []).filter(function (d) { return d > prevDate; });
      out.attendRequired = attendNeed;
      out.attendSinceLast = after.length;
      if (after.length < attendNeed) {
        out.eligible = false; out.date = null; out.reason = '出席次數未達';
        return out;
      }
      if (after[attendNeed - 1] > date) date = after[attendNeed - 1];
    }
    if (today < date) { out.eligible = false; out.date = null; out.waitingUntil = date; return out; }
    out.eligible = true; out.date = date;
    return out;
  }

  /** 出席統計：出席與請假分開計算 */
  function attendanceCounts(records) {
    var r = { attended: 0, leave: 0 };
    (records || []).forEach(function (a) {
      if (a.status === '出席') r.attended++;
      else if (a.status === '請假') r.leave++;
    });
    return r;
  }

  /**
   * 首頁「下一步挑戰」（SPEC 附錄第 5 點）。
   * @return {{type, message, items: Array}}
   *  type: 'start' | 'next' | 'pending' | 'allDone'
   */
  function nextChallenge(progress) {
    var cur = progress.currentLevel, next = progress.nextLevel;
    if (!next) {
      return { type: 'allDone', message: '恭喜你完成全部進程！接下來可以挑戰技能章，並帶領學弟妹一起成長。', items: [] };
    }
    var u = progress.units.filter(function (x) { return x.category === CATEGORY.PROGRESS && x.unit === next; })[0];
    var congrats = cur ? '恭喜你完成' + cur + '進程！' : '';
    if (u && u.total > 0 && u.done === u.total) {
      return { type: 'pending', message: (congrats ? congrats + '\n' : '') + PENDING_TEXT_FOR_PARENTS, items: [] };
    }
    var todo = u ? u.items.filter(function (i) { return !i.done; }).slice(0, 3) : [];
    return { type: cur ? 'next' : 'start', message: congrats, level: next, items: todo };
  }

  /** 快達標：未頒發、未全部完成、剩餘項目數 ≤ 門檻 */
  function isNearlyDone(unitState, threshold) {
    return unitState.status === STATUS.IN_PROGRESS && unitState.done > 0 && unitState.remaining > 0 && unitState.remaining <= threshold;
  }

  /** 查詢端顯示文字：已完成待頒發改為固定文字，不出現「可晉級」 */
  function statusTextForParents(status) {
    return status === STATUS.DONE_PENDING ? PENDING_TEXT_FOR_PARENTS : status;
  }

  // ───────────── 簽核 ─────────────

  /**
   * 小隊批次簽核：已完成的組合略過不重複寫入。
   * @return {{toAdd: Array<Object>, skipped: number}}
   */
  function planBatchSignoff(existing, cubIds, itemIds, date, signer, note) {
    var has = {};
    (existing || []).forEach(function (c) { if (isCountedCompletion(c)) has[c.cubId + '|' + c.itemId] = true; });
    var toAdd = [], skipped = 0, dup = {};
    cubIds.forEach(function (cub) {
      itemIds.forEach(function (item) {
        var k = cub + '|' + item;
        if (has[k] || dup[k]) { skipped++; return; }
        dup[k] = true;
        toAdd.push({ cubId: cub, itemId: item, date: date, signer: signer, note: note || '', reporter: '', reportStatus: '' });
      });
    });
    return { toAdd: toAdd, skipped: skipped };
  }

  /** 完成紀錄物件 ↔ 試算表列（含第二期預留兩欄，原樣帶過） */
  function completionToRow(c) { return [c.cubId, c.itemId, c.date, c.signer, c.note || '', c.reporter || '', c.reportStatus || '']; }
  function rowToCompletion(r) {
    return { cubId: clean(r[0]), itemId: clean(r[1]), date: clean(r[2]), signer: clean(r[3]), note: clean(r[4]), reporter: clean(r[5]), reportStatus: clean(r[6]) };
  }

  // ───────────── 頒章 ─────────────

  /**
   * 頒發日期檢查：必填、合法日期、不可早於最後完成日；未來日期需再確認。
   * @return {{ok: boolean, error?: string, needConfirmFuture?: boolean}}
   */
  function validateAwardDate(awardDate, lastCompletionDate, today) {
    if (!isDateStr(awardDate)) return { ok: false, error: '請填寫正確的頒發日期' };
    if (lastCompletionDate && awardDate < lastCompletionDate) {
      return { ok: false, error: '頒發日期不可早於最後一個項目的完成日期（' + lastCompletionDate + '）' };
    }
    return { ok: true, needConfirmFuture: awardDate > today };
  }

  /**
   * 直接補登頒章（SPEC 7.6）：寫入頒章紀錄，並把該級別或章的啟用項目中「尚未完成」的標記完成。
   * 補登進程級別時，列出較低級別中沒有頒章紀錄者，供前端提示是否一併補登。
   */
  function planBackfill(p) {
    var items = (p.items || []).filter(function (it) { return it.enabled && it.unit === p.unit && it.category === p.category; });
    var doneIds = {};
    (p.completions || []).forEach(function (c) { if (c.cubId === p.cubId && isCountedCompletion(c)) doneIds[c.itemId] = true; });
    var newCompletions = items.filter(function (it) { return !doneIds[it.id]; }).map(function (it) {
      return { cubId: p.cubId, itemId: it.id, date: p.date, signer: p.signer, note: '上線補登', reporter: '', reportStatus: '' };
    });
    var awardedUnits = {};
    (p.awards || []).forEach(function (a) { if (a.cubId === p.cubId) awardedUnits[a.unit] = true; });
    var missingLower = [];
    if (p.category === CATEGORY.PROGRESS) {
      LEVELS.slice(0, LEVELS.indexOf(p.unit)).forEach(function (lv) { if (!awardedUnits[lv]) missingLower.push(lv); });
    }
    return {
      alreadyAwarded: !!awardedUnits[p.unit],
      award: { cubId: p.cubId, unit: p.unit, date: p.date, occasion: p.occasion || '', note: '上線補登', signer: p.signer },
      newCompletions: newCompletions,
      missingLowerLevels: missingLower,
      notify: false // 補登不觸發任何推播
    };
  }

  /** 撤銷進程頒章後，目前級別退回「剩下已頒發中最高的一級」 */
  function levelAfterRevoke(awardsOfCub, revokedUnit) {
    var lv = null;
    LEVELS.forEach(function (l) {
      if (l !== revokedUnit && awardsOfCub.some(function (a) { return a.unit === l; })) lv = l;
    });
    return lv;
  }

  // ───────────── 代碼產生 ─────────────

  /**
   * 產生不重複的亂碼。
   * @param {number} length
   * @param {function(number): number} randInt 回傳 [0, n) 的整數（需為密碼學等級亂數）
   * @param {Object<string, boolean>|Array<string>} taken 已存在的所有代碼（綁定碼與邀請碼合併，確保不衝突）
   */
  function generateCode(length, randInt, taken) {
    var set = {};
    if (Array.isArray(taken)) taken.forEach(function (c) { set[clean(c).toUpperCase()] = true; });
    else if (taken) set = taken;
    for (var tries = 0; tries < 1000; tries++) {
      var s = '';
      for (var i = 0; i < length; i++) s += CODE_CHARSET[randInt(CODE_CHARSET.length)];
      if (!set[s]) return s;
    }
    throw new Error('無法產生不重複的代碼');
  }

  /** 使用者輸入的代碼正規化：去空白、轉大寫 */
  function normalizeCode(s) { return clean(s).replace(/\s+/g, '').toUpperCase(); }

  /**
   * 檢查邀請碼可否使用。
   * @return {{ok: boolean}}；失敗原因只供後端日誌，不回給使用者
   */
  function checkInvite(invite, nowMs) {
    if (!invite) return { ok: false, reason: 'not_found' };
    if (invite.status !== '未使用') return { ok: false, reason: invite.status === '已使用' ? 'used' : 'void' };
    if (nowMs > invite.expiresAt) return { ok: false, reason: 'expired' };
    return { ok: true };
  }

  /** 檢查綁定碼可否使用（綁定碼、小孩姓名都要符合，小狼需在團、剩餘次數 > 0） */
  function checkBindCode(cub, inputName) {
    if (!cub) return { ok: false, reason: 'not_found' };
    if (cub.status !== '在團') return { ok: false, reason: 'not_active' };
    if (!(cub.codeUsesLeft > 0)) return { ok: false, reason: 'used_up' };
    if (clean(inputName).replace(/\s+/g, '') !== clean(cub.name).replace(/\s+/g, '')) return { ok: false, reason: 'name_mismatch' };
    return { ok: true };
  }

  /** 對使用者一律只顯示這句，不透露是哪一種錯誤、也不透露是綁定碼還是邀請碼 */
  var CODE_ERROR_MESSAGE = '代碼或姓名不正確，請確認後再試；如有問題請聯絡團長。';

  // ───────────── 帳號與登入 ─────────────

  function validateUsername(name) {
    return /^[A-Za-z0-9_]{4,20}$/.test(clean(name)) ? { ok: true } : { ok: false, error: '帳號需為 4～20 個英文字母、數字或底線' };
  }

  function validatePassword(pw, minLength) {
    pw = pw === null || pw === undefined ? '' : String(pw);
    if (pw.length < minLength) return { ok: false, error: '密碼至少 ' + minLength + ' 個字元' };
    if (pw.length > 100) return { ok: false, error: '密碼太長' };
    return { ok: true };
  }

  /** 家長稱呼：必填，最多 30 字（例如「王小明媽媽」） */
  function validateNickname(s) {
    s = clean(s);
    if (!s) return { ok: false, error: '請填寫稱呼，例如「王小明媽媽」' };
    if (s.length > 30) return { ok: false, error: '稱呼最多 30 個字' };
    return { ok: true };
  }

  /**
   * 密碼雜湊：加鹽、重複多次的 HMAC-SHA256。
   * @param {function(string, string): string} hmacHex (value, key) → 十六進位字串
   */
  function hashPassword(pw, salt, iterations, hmacHex) {
    var h = salt;
    for (var i = 0; i < iterations; i++) h = hmacHex(h + pw, salt);
    return iterations + '$' + h;
  }

  /** 驗證密碼；雜湊字串前綴記錄次數，日後調整次數不影響舊密碼 */
  function verifyPassword(pw, salt, stored, hmacHex) {
    var s = clean(stored), k = s.indexOf('$');
    if (k <= 0) return false;
    var iter = Number(s.slice(0, k));
    if (!(iter > 0)) return false;
    return constantTimeEqual(hashPassword(pw, salt, iter, hmacHex), s);
  }

  function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  function isSessionValid(session, nowMs) { return !!session && nowMs <= session.expiresAt; }

  /** 臨時碼：存在、未過期才可用；用過即清除（由 GAS 層清除） */
  function isTempCodeValid(account, nowMs) {
    return !!(account && account.tempCodeHash && account.tempCodeExpiresAt && nowMs <= account.tempCodeExpiresAt);
  }

  /**
   * 是否鎖定：最近「鎖定分鐘數」內，同對象失敗次數 ≥ 鎖定次數。
   * @param failures [{type, target, at}]
   */
  function isLocked(failures, type, target, nowMs, settings) {
    var since = nowMs - settings['失敗鎖定分鐘數'] * 60000;
    var n = (failures || []).filter(function (f) { return f.type === type && f.target === target && f.at >= since; }).length;
    return n >= settings['失敗鎖定次數'];
  }

  /** 未登入的綁定碼錯誤：全站每小時累計上限 */
  function isGlobalBindLocked(failures, nowMs, settings) {
    var since = nowMs - 3600000;
    var n = (failures || []).filter(function (f) { return f.type === '綁定' && f.target === '未登入' && f.at >= since; }).length;
    return n >= settings['未登入綁定失敗全站上限（每小時）'];
  }

  // ───────────── 告知同意 ─────────────

  function latestConsentVersion(consentRows) {
    var v = 0;
    (consentRows || []).forEach(function (r) { var n = Number(r.version); if (n > v) v = n; });
    return v;
  }

  /** 同意版本過期（小於最新版）→ 需重新確認 */
  function needsReconsent(binding, latestVersion) {
    return !(Number(binding && binding.consentVersion) >= latestVersion);
  }

  // ───────────── 權限 ─────────────

  /** 角色權限矩陣（SPEC 第七節）。null 代表只有家長身分 */
  var PERMISSIONS = {
    signoff: [ROLE.LEADER, ROLE.ASSISTANT],
    attendance: [ROLE.LEADER, ROLE.ASSISTANT],
    revokeOwnSignoff: [ROLE.LEADER, ROLE.ASSISTANT],
    revokeAnySignoff: [ROLE.LEADER],
    viewRoster: [ROLE.LEADER, ROLE.ASSISTANT],
    viewOverview: [ROLE.LEADER, ROLE.ASSISTANT],
    printSheet: [ROLE.LEADER, ROLE.ASSISTANT],
    linkLine: [ROLE.LEADER, ROLE.ASSISTANT],
    manageCubs: [ROLE.LEADER],
    manageCalendar: [ROLE.LEADER],
    manageBindCodes: [ROLE.LEADER],
    award: [ROLE.LEADER],
    backfill: [ROLE.LEADER],
    manageAdmins: [ROLE.LEADER],
    manageInvites: [ROLE.LEADER],
    manageAccounts: [ROLE.LEADER],
    manageItems: [ROLE.LEADER],
    manageSettings: [ROLE.LEADER],
    privacy: [ROLE.LEADER],
    backup: [ROLE.LEADER]
  };

  function can(role, action) {
    var allowed = PERMISSIONS[action];
    if (!allowed) return false; // 未定義的操作一律拒絕
    return allowed.indexOf(role) >= 0;
  }

  /**
   * 撤銷簽核：團長可撤銷任何人的；服務員只能撤銷自己簽的。
   * signerOf 為該筆完成紀錄的簽核人帳號ID
   */
  function canRevokeSignoff(role, actorId, signerOf) {
    if (can(role, 'revokeAnySignoff')) return true;
    return can(role, 'revokeOwnSignoff') && actorId === signerOf;
  }

  // ───────────── 管理員異動規則 ─────────────

  /**
   * 檢查管理員異動是否允許。
   * @param admins [{accountId, role}]
   * @param change {type: 'add'|'setRole'|'remove', targetId, role}
   * @return {{ok: boolean, error?: string}}
   */
  function validateAdminChange(admins, actorId, change) {
    var actor = (admins || []).filter(function (a) { return a.accountId === actorId; })[0];
    if (!actor || actor.role !== ROLE.LEADER) return { ok: false, error: '只有團長可以管理管理員' };
    var target = admins.filter(function (a) { return a.accountId === change.targetId; })[0];
    var leaders = admins.filter(function (a) { return a.role === ROLE.LEADER; }).length;
    if (change.type === 'add') {
      if (target) return { ok: false, error: '這個帳號已經是管理員' };
      if (change.role !== ROLE.LEADER && change.role !== ROLE.ASSISTANT) return { ok: false, error: '角色只能是團長或服務員' };
      return { ok: true };
    }
    if (!target) return { ok: false, error: '找不到這位管理員' };
    if (change.type === 'remove') {
      if (change.targetId === actorId) return { ok: false, error: '團長不可移除自己；要卸任請先指定另一位團長，由對方操作' };
      if (target.role === ROLE.LEADER && leaders <= 1) return { ok: false, error: '系統至少要保留一位團長' };
      return { ok: true };
    }
    if (change.type === 'setRole') {
      if (change.role !== ROLE.LEADER && change.role !== ROLE.ASSISTANT) return { ok: false, error: '角色只能是團長或服務員' };
      if (target.role === ROLE.LEADER && change.role === ROLE.ASSISTANT) {
        if (change.targetId === actorId) return { ok: false, error: '團長不可將自己降為服務員；要卸任請先指定另一位團長，由對方操作' };
        if (leaders <= 1) return { ok: false, error: '不可把最後一位團長降為服務員' };
      }
      return { ok: true };
    }
    return { ok: false, error: '不支援的操作' };
  }

  /** 刪除帳號時：若該帳號是最後一位團長則不可刪 */
  function canDeleteAccount(admins, accountId) {
    var a = (admins || []).filter(function (x) { return x.accountId === accountId; })[0];
    if (!a || a.role !== ROLE.LEADER) return { ok: true };
    var leaders = admins.filter(function (x) { return x.role === ROLE.LEADER; }).length;
    return leaders <= 1 ? { ok: false, error: '這是最後一位團長的帳號，不可刪除' } : { ok: true };
  }

  // ───────────── 個資處理 ─────────────

  /** 個資處理涉及的分頁與「小狼ID」所在欄（0 起算） */
  var CUB_ID_COLUMNS = {
    '小狼名單': 0,
    '綁定紀錄': 1,
    '完成紀錄': 0,
    '頒章紀錄': 0,
    '通知紀錄': 0,
    '出席紀錄': 1,
    '額外出席': 1
  };

  /**
   * 規劃匿名化或完全刪除（只計算，不寫入）。
   * @param {Object} data  {分頁名稱: 二維陣列（含標題列）}，需含 CUB_ID_COLUMNS 的分頁與「操作日誌」
   * @param {'anonymize'|'delete'} mode
   * @return {{ok, error?, deleteRows: {分頁: [列號]}, updateRows: {分頁: [{row, values}]}, counts: {分頁: 數量}}}
   *   列號為試算表列號（1 起算，標題列為 1）
   */
  function planPrivacy(data, cubId, mode) {
    var cubRows = data['小狼名單'] || [];
    var cubRowIdx = -1;
    for (var i = 1; i < cubRows.length; i++) if (clean(cubRows[i][0]) === cubId) { cubRowIdx = i; break; }
    if (cubRowIdx < 0) return { ok: false, error: '找不到這位小狼' };
    var cubName = clean(cubRows[cubRowIdx][1]);
    var del = {}, upd = {}, counts = {};

    function rowsOf(sheet) {
      var col = CUB_ID_COLUMNS[sheet], out = [];
      (data[sheet] || []).forEach(function (r, idx) { if (idx > 0 && clean(r[col]) === cubId) out.push(idx + 1); });
      return out;
    }

    var replacement;
    if (mode === 'delete') {
      Object.keys(CUB_ID_COLUMNS).forEach(function (s) { del[s] = rowsOf(s); counts[s] = del[s].length; });
      replacement = '已刪除';
    } else if (mode === 'anonymize') {
      var serial = nextAnonymousSerial(cubRows);
      var row = cubRows[cubRowIdx].slice();
      replacement = '已離團小狼' + serial;
      row[1] = replacement; row[2] = ''; row[5] = ''; row[6] = 0; row[7] = '已匿名';
      upd['小狼名單'] = [{ row: cubRowIdx + 1, values: row }];
      counts['小狼名單'] = 1;
      del['綁定紀錄'] = rowsOf('綁定紀錄');
      counts['綁定紀錄'] = del['綁定紀錄'].length;
    } else return { ok: false, error: '不支援的處理方式' };

    // 操作日誌中出現該小狼姓名的地方一律替換（對象、修改前、修改後三欄）
    var logUpd = [];
    if (cubName) {
      (data['操作日誌'] || []).forEach(function (r, idx) {
        if (idx === 0) return;
        var changed = false, v = r.slice();
        [3, 4, 5].forEach(function (c) {
          var s = v[c] === null || v[c] === undefined ? '' : String(v[c]);
          if (s.indexOf(cubName) >= 0) { v[c] = s.split(cubName).join(replacement); changed = true; }
        });
        if (changed) logUpd.push({ row: idx + 1, values: v });
      });
    }
    upd['操作日誌'] = logUpd;
    counts['操作日誌'] = logUpd.length;
    return { ok: true, cubName: cubName, deleteRows: del, updateRows: upd, counts: counts };
  }

  function nextAnonymousSerial(cubRows) {
    var max = 0;
    (cubRows || []).forEach(function (r) {
      var m = /^已離團小狼(\d+)$/.exec(clean(r[1]));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return max + 1;
  }

  /** 離團超過設定天數仍未處理個資的小狼（設定 0 表示不提醒） */
  function overdueForPrivacy(cubs, days, today) {
    if (!days) return [];
    return (cubs || []).filter(function (c) {
      if (c.status !== '離團' || !isDateStr(c.leftDate)) return false;
      var due = new Date(Date.parse(c.leftDate + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
      return today >= due;
    });
  }

  // ───────────── 通知去重（階段 5 使用） ─────────────

  /**
   * 比較目前達標清單與通知紀錄：
   *  - toNotify：新達標、尚未通知過
   *  - toClear：已通知過但目前不再達標（撤銷或項目修改造成），清除紀錄讓重新達標可再通知
   * @param eligibleKeys ['小狼ID|級別或章名']
   * @param notifiedKeys 通知紀錄中類型為「達標」的 key
   */
  function diffNotifications(eligibleKeys, notifiedKeys) {
    var e = {}, n = {};
    eligibleKeys.forEach(function (k) { e[k] = true; });
    notifiedKeys.forEach(function (k) { n[k] = true; });
    return {
      toNotify: eligibleKeys.filter(function (k) { return !n[k]; }),
      toClear: notifiedKeys.filter(function (k) { return !e[k]; })
    };
  }

  /**
   * 年度出席率 =（年度期間內「出席」次數 + 額外出席次數）÷ 應出席總數。
   * 請假不減少分母。總數未設定（0）時不顯示出席率。
   * @param records [{date, status}] 這位小狼、啟用中集會的出席紀錄
   * @param period {start, end, total} 年度出席設定（日期含頭尾）
   * @param extra 團長設定的額外出席次數
   */
  function attendanceRate(records, period, extra) {
    var inPeriod = (records || []).filter(function (a) { return a.date >= period.start && a.date <= period.end; });
    var c = attendanceCounts(inPeriod);
    var ex = Number(extra) > 0 ? Math.floor(Number(extra)) : 0;
    var total = Number(period.total) > 0 ? Math.floor(Number(period.total)) : 0;
    var count = c.attended + ex;
    // 出席 + 額外出席可能超過總數；最多顯示 100%（SPEC 附錄第 13 點）
    var rate = total ? Math.min(1, count / total) : null;
    return {
      attended: c.attended, leave: c.leave, extra: ex, total: total, count: count, rate: rate,
      text: rate === null ? '' : Math.round(rate * 100) + '%'
    };
  }

  /** 找出某日期所屬的年度出席設定（多個年度重疊時取開始日最晚者） */
  function periodOf(periods, date) {
    var hit = null;
    (periods || []).forEach(function (p) {
      if (isDateStr(p.start) && isDateStr(p.end) && date >= p.start && date <= p.end && (!hit || p.start > hit.start)) hit = p;
    });
    return hit;
  }

  return {
    LEVELS: LEVELS, CATEGORY: CATEGORY, BADGE_GROUPS: BADGE_GROUPS, NO_SECTION: NO_SECTION, STATUS: STATUS, ROLE: ROLE,
    PENDING_TEXT_FOR_PARENTS: PENDING_TEXT_FOR_PARENTS, CODE_CHARSET: CODE_CHARSET, CODE_ERROR_MESSAGE: CODE_ERROR_MESSAGE,
    SETTINGS: SETTINGS, PERMISSIONS: PERMISSIONS, CUB_ID_COLUMNS: CUB_ID_COLUMNS,
    isDateStr: isDateStr, cmpDate: cmpDate, addMonths: addMonths, tenure: tenure,
    clean: clean, parseCsv: parseCsv, toCsv: toCsv,
    parseSettings: parseSettings, defaultSettingsRows: defaultSettingsRows,
    parseItems: parseItems, nextItemId: nextItemId, buildSeed: buildSeed,
    isCountedCompletion: isCountedCompletion, computeCubProgress: computeCubProgress, nextChallenge: nextChallenge,
    isNearlyDone: isNearlyDone, attendanceCounts: attendanceCounts, attendanceRate: attendanceRate, periodOf: periodOf, statusTextForParents: statusTextForParents,
    planBatchSignoff: planBatchSignoff, completionToRow: completionToRow, rowToCompletion: rowToCompletion,
    validateAwardDate: validateAwardDate, planBackfill: planBackfill, levelAfterRevoke: levelAfterRevoke,
    generateCode: generateCode, normalizeCode: normalizeCode, checkInvite: checkInvite, checkBindCode: checkBindCode,
    validateUsername: validateUsername, validatePassword: validatePassword, validateNickname: validateNickname,
    hashPassword: hashPassword, verifyPassword: verifyPassword, isSessionValid: isSessionValid, isTempCodeValid: isTempCodeValid,
    isLocked: isLocked, isGlobalBindLocked: isGlobalBindLocked,
    latestConsentVersion: latestConsentVersion, needsReconsent: needsReconsent,
    can: can, canRevokeSignoff: canRevokeSignoff, validateAdminChange: validateAdminChange, canDeleteAccount: canDeleteAccount,
    planPrivacy: planPrivacy, overdueForPrivacy: overdueForPrivacy,
    diffNotifications: diffNotifications
  };
})();

// Node 測試環境匯出；GAS 中沒有 module，略過
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;

// ════════════════ Config.js ════════════════
/**
 * 試算表結構與系統常數（SPEC 第四節）
 *
 * ⚠️ 維護守則：既有欄位不得刪除或重排；要加欄位只能加在陣列最後面，setup() 會自動補上。
 */

var TZ = 'Asia/Taipei';

/** 密碼雜湊次數（0B 實測 1000 次約 380 毫秒；雜湊字串會記錄次數，日後調整不影響舊密碼） */
var HASH_ITERATIONS = 2000;

/** 第一位團長邀請碼的有效時數（setup 產生） */
var FIRST_LEADER_INVITE_HOURS = 72;

var SHEET = {
  CUBS: '小狼名單',
  ACCOUNTS: '帳號',
  SESSIONS: '登入工作階段',
  BINDINGS: '綁定紀錄',
  ADMINS: '管理員',
  INVITES: '管理員邀請',
  ITEMS: '項目總表',
  UNITS: '級別與章說明',
  COMPLETIONS: '完成紀錄',
  AWARDS: '頒章紀錄',
  MEETINGS: '集會行事曆',
  ATTENDANCE: '出席紀錄',
  PERIODS: '年度出席設定',
  EXTRA: '額外出席',
  NOTIFY: '通知紀錄',
  FAILURES: '失敗紀錄',
  CONSENT: '告知同意內容',
  SETTINGS: '設定',
  LOG: '操作日誌'
};

/** 各分頁標題列（順序即欄位順序） */
var HEADERS = {};
HEADERS[SHEET.CUBS] = ['小狼ID', '姓名', '小隊', '入團日', '目前級別', '綁定碼', '綁定碼剩餘次數', '狀態', '離團日'];
HEADERS[SHEET.ACCOUNTS] = ['帳號ID', '帳號名稱', '稱呼', '密碼雜湊', '密碼鹽', '狀態', '建立時間', '最後登入時間', '臨時碼雜湊', '臨時碼到期時間'];
HEADERS[SHEET.SESSIONS] = ['憑證雜湊', '帳號ID', '建立時間', '到期時間'];
HEADERS[SHEET.BINDINGS] = ['帳號ID', '小狼ID', '綁定時間', '同意時間', '同意版本'];
HEADERS[SHEET.ADMINS] = ['帳號ID', '姓名', '角色', '加入時間', '指定人', 'LINE userId', 'LINE 連結時間'];
HEADERS[SHEET.INVITES] = ['邀請碼', '角色', '姓名', '建立人', '建立時間', '到期時間', '狀態', '使用者帳號ID', '使用時間'];
HEADERS[SHEET.ITEMS] = ['項目ID', '類別', '級別或章名', '大項', '項目內容', '排序', '啟用'];
HEADERS[SHEET.UNITS] = ['名稱', '類別', '分類', '說明', '晉級條件', '排序'];
HEADERS[SHEET.COMPLETIONS] = ['小狼ID', '項目ID', '完成日期', '簽核人', '備註', '回報人', '回報狀態'];
HEADERS[SHEET.AWARDS] = ['小狼ID', '級別或章名', '頒發日期', '頒發場合', '備註', '簽核人', '登錄時間'];
HEADERS[SHEET.MEETINGS] = ['集會ID', '日期', '名稱', '備註', '啟用', '建立人', '建立時間'];
HEADERS[SHEET.ATTENDANCE] = ['集會ID', '小狼ID', '狀態', '點名人', '點名時間'];
HEADERS[SHEET.PERIODS] = ['年度名稱', '開始日', '結束日', '應出席總數', '備註'];
HEADERS[SHEET.EXTRA] = ['年度名稱', '小狼ID', '額外出席次數', '備註', '設定人', '設定時間'];
HEADERS[SHEET.NOTIFY] = ['小狼ID', '級別或章名', '通知類型', '通知時間'];
HEADERS[SHEET.FAILURES] = ['類型', '對象', '時間'];
HEADERS[SHEET.CONSENT] = ['版本', '內容', '生效日'];
HEADERS[SHEET.SETTINGS] = ['鍵', '值', '說明'];
HEADERS[SHEET.LOG] = ['時間', '操作人', '動作', '對象', '修改前', '修改後'];

/**
 * 需設為「純文字」格式的欄（1 起算），避免試算表把日期字串或全數字代碼自動轉型。
 */
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.CUBS] = [1, 4, 6, 9];
TEXT_COLUMNS[SHEET.ACCOUNTS] = [1, 2];
TEXT_COLUMNS[SHEET.BINDINGS] = [1, 2];
TEXT_COLUMNS[SHEET.ADMINS] = [1];
TEXT_COLUMNS[SHEET.INVITES] = [1, 8];
TEXT_COLUMNS[SHEET.ITEMS] = [1];
TEXT_COLUMNS[SHEET.COMPLETIONS] = [1, 2, 3, 4];
TEXT_COLUMNS[SHEET.AWARDS] = [1, 3, 6];
TEXT_COLUMNS[SHEET.MEETINGS] = [1, 2];
TEXT_COLUMNS[SHEET.ATTENDANCE] = [1, 2, 4];
TEXT_COLUMNS[SHEET.PERIODS] = [2, 3];
TEXT_COLUMNS[SHEET.EXTRA] = [2];
TEXT_COLUMNS[SHEET.NOTIFY] = [1];
TEXT_COLUMNS[SHEET.CONSENT] = [3];

/** API 錯誤代碼（前端依代碼處理，訊息直接顯示給使用者） */
var ERR = {
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  BAD_LOGIN: 'BAD_LOGIN',
  LOCKED: 'LOCKED',
  CODE_INVALID: 'CODE_INVALID',
  BAD_INPUT: 'BAD_INPUT',
  NEED_CONSENT: 'NEED_CONSENT',
  NAME_TAKEN: 'NAME_TAKEN',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  SERVER_ERROR: 'SERVER_ERROR'
};

/** 給使用者看的錯誤；message 會直接顯示，不可含內部細節 */
function ApiError(code, message) {
  this.code = code;
  this.message = message;
}

// ════════════════ SeedData.js ════════════════
/**
 * 種子資料（自動產生，請勿手動修改；改 data/items.csv、docs/SPEC.md、docs/PRIVACY.md 後執行 npm run build）
 * 只供 setup() 第一次匯入；匯入後試算表才是唯一來源。
 */
var SEED = {
 "itemsCsv": "類別,級別或章名,大項或分類,項目內容\n進程,羚羊,－,能背誦並說明幼童軍諾言和規律之意義。\n進程,羚羊,－,能說出幼童軍級別、隊名，並加以介紹。\n進程,羚羊,－,能說出同隊幼童軍姓名並能自我介紹。\n進程,羚羊,－,能說出團部到家的路線，或團部地址。\n進程,羚羊,－,能說出團長或副團長其中1人的姓名。\n進程,羚羊,－,能說出幼童軍禮節（握手禮及舉手禮）的方法和含義。\n進程,羚羊,－,參加幼童軍團集會至少4次。\n進程,羚羊,－,聽叢林奇談故事2則以上，並參加跳叢林舞或演叢林劇至少1次。\n進程,羚羊,－,樂於接受尊長的引導，並能完成相關任務。\n進程,羚羊,－,能作幼童軍吼聲。\n進程,狼,國旗,能說出參與升降旗及聽到國歌與國旗歌時應有的禮節。\n進程,狼,國旗,能說出收藏以及保管國旗的方法。\n進程,狼,國旗,能識別5個以上國家的國旗。\n進程,狼,運動,會翻筋斗(前滾翻3次)。\n進程,狼,運動,能頂書行走(頭上放3本書)10公尺。\n進程,狼,運動,自己會搖呼啦圈5圈以上。\n進程,狼,運動,能連續跳繩前後各15次以上。\n進程,狼,運動,能一周從事「中度身體運動(會使心跳加速及流汗的運動)」3次以上。\n進程,狼,常識,能知道並遵守步行與搭乘大眾運輸系統的交通規則。\n進程,狼,常識,能遵守公共秩序。\n進程,狼,常識,能說出國家元首及居住地首長的名字。\n進程,狼,常識,能知道地震、火場等防災避難的掩護要領。\n進程,狼,常識,能辨別八方位。\n進程,狼,常識,能知道資源回收的分類方式。\n進程,狼,衛生,能自行準備沐浴用品，自行沐浴並穿好衣服。\n進程,狼,衛生,能注意自己身體與服裝的清潔整齊(包括口腔、指甲、頭髮、手腳、隨身衣物等)。\n進程,狼,衛生,能與家長共同討論訂定並遵守規律生活守則(包括起床、睡覺、寫作業、遊戲等)。\n進程,狼,衛生,能說出操作正確洗手的方法。\n進程,狼,衛生,能說出並實作身體流汗的處理方式。\n進程,狼,衛生,咳嗽或打噴嚏時，會用正確方式遮掩口鼻。\n進程,狼,服務,能打掃團部及家庭。\n進程,狼,服務,能協助大人照顧弟妹或其他幼小兒童，或是在團集會中協助其他夥伴。\n進程,狼,服務,能正確傳遞口訊(包括2件事情)而沒有差錯。\n進程,狼,勞作,工具認識：能知道小刀與剪刀的正確用法並正確傳遞。\n進程,狼,勞作,實作：能運用材料做動物模型至少2種。\n進程,狼,勞作,實作：會製作童玩1種。\n進程,狼,結繩,會打平結。\n進程,狼,結繩,能用平結紮小包裹。\n進程,狼,結繩,能在鞋子上或日常用品上打蝴蝶結。\n進程,狼,蒐集,能持續半年以上作任何一種有趣的蒐集工作，並能介紹內容與他人分享。\n進程,狼,閱讀,能運用各類圖書資源進行閱讀及資料蒐集。\n進程,狼,閱讀,能說出閱讀過的2本以上書籍之內容大意。\n進程,鹿,國旗,能演示國旗摺疊法。\n進程,鹿,國旗,能把國旗正確地繫在揚旗的旗桿上。\n進程,鹿,國旗,能說出升、降旗的方法。\n進程,鹿,運動,能連續踢毽子3次以上。\n進程,鹿,運動,能來回走平衡木或直線(長3公尺以上，寬10公分內)。\n進程,鹿,運動,能完成3種以上不同跳繩動作。\n進程,鹿,運動,能一周從事「中度身體運動(會使心跳加速及流汗的運動)3次以上，並累計100分鐘。\n進程,鹿,常識,會寫信、寄信，並能說出正確的郵資。\n進程,鹿,常識,能知道防溺的相關知識。\n進程,鹿,常識,能知道緊急事件發生時，撥打110、119及113保護專線等電話通報或求助的正確方法。\n進程,鹿,常識,能使用電腦、平板或手機等電子產品，利用關鍵字進行資料的搜尋。\n進程,鹿,常識,面對陌生人的詢問，能知道如何保護自己與正確應對。\n進程,鹿,常識,能愛護動物、植物和尊重生命，不任意殘害。\n進程,鹿,常識,維護環境衛生，在戶外活動後，能恢復環境整潔。\n進程,鹿,常識,能知道環境垃圾的來源以及其對生物的影響。\n進程,鹿,衛生,能說出小刀傷、擦傷等創傷處理方法。\n進程,鹿,衛生,會配合天氣變化適時增減衣物、穿著整齊，並妥善保管自己的衣物。\n進程,鹿,衛生,能知道空氣汙染指標顏色所代表的意義與查詢方式。\n進程,鹿,服務,曾在社區或公共場所自動整理環境或處理垃圾分類。\n進程,鹿,服務,能協助團長、副團長、服務員準備團集會會場或相關器材。\n進程,鹿,服務,能領導小隊遊戲或唱跳。\n進程,鹿,勞作,工具認識：能說出尖嘴鉗、老虎鉗與斜口鉗的不同用法與使用時的注意事項。\n進程,鹿,勞作,工具認識：能說出螺絲起子(一字及十字)、鑽子的用法與使用時的注意事項。\n進程,鹿,勞作,實作：能以編織方式製作2種手工藝品。\n進程,鹿,結繩,會打接繩結、稱人結。\n進程,鹿,結繩,能整理繩子並妥善保管。\n進程,鹿,儲蓄,能有儲蓄的習慣，並能訂定半年以上儲蓄目標及規劃金錢的運用方式，並在家長同意下執行計畫。\n進程,鹿,閱讀,閱讀完叢林奇談，並能自選3則故事，簡述其情節。\n進程,鹿,閱讀,能透過各種媒材資訊(讀報、書籍或多媒體)的閱讀，說出近期重要時事。\n進程,豹,國旗,能說出國旗所代表的意義，以及其圖案意涵。\n進程,豹,國旗,能依指揮節拍演唱國歌、國旗歌。\n進程,豹,運動,能仰臥起坐60秒內24下以上。(依教育部體適能常模公告調整）\n進程,豹,運動,能立定跳遠125公分以上。(依教育部體適能常模公告調整）\n進程,豹,運動,能爬竿、攀樹，或抱石攀岩體驗離地2公尺以上。(但最高不得離地3公尺)\n進程,豹,運動,能一周從事「中度身體運動(會使心跳加速及流汗的運動)」3次以上，並累計150分鐘。\n進程,豹,常識,能說出家用電器、瓦斯爐(含卡式爐)的使用方式與安全注意事項。\n進程,豹,常識,能說出緊急事件的處理方法，例如：火警、車輛肇事、鬥毆等報案。\n進程,豹,常識,能說出最近的緊急醫療機構與AED位置。\n進程,豹,常識,能說出物體的相對值(量感)，例如長短、大小、遠近、重量等。\n進程,豹,常識,參加集會時，能照「會議規範」發言，並參與討論。(施行重點：舉手發言等)\n進程,豹,常識,能認識台灣特有種生物3種以上，並了解外來種生物的危害。\n進程,豹,衛生,會使用各類體溫計測量體溫，並且知道測量脈搏的方法。\n進程,豹,衛生,能說出鼻出血、小燙傷、扭傷、骨折、中暑、腹瀉、嘔吐等常見急症的應對方法。\n進程,豹,衛生,能說出簡易急救包的內容和用法。\n進程,豹,服務,能閱讀大眾交通運輸工具時刻表或路線圖，並能指引他人搭乘。\n進程,豹,服務,能協助清理家中客廳或寢室，結果良好讓家長滿意。\n進程,豹,服務,能領導全團做遊戲或唱跳。\n進程,豹,服務,能參與服務性工作，例如：整潔服務、社區服務、慶典服務，集會服務等。\n進程,豹,服務,能接待客人，並能說出接聽電話的禮貌。\n進程,豹,勞作,工具認識：能知道鐵鎚及鋸子的正確用法與安全注意事項。\n進程,豹,勞作,實作：能利用各種素材做3種以上的玩具或日用品。\n進程,豹,勞作,實作：能製作簡易動、植物標本或攝影蒐集資料。\n進程,豹,結繩,會簡易繩頭處理。\n進程,豹,認識動、植物,能口述2種動物及植物的名稱、生態、習性、特性。\n進程,豹,閱讀,能閱讀5本以上課外讀物並有讀書心得紀錄。\n技能章,嚮導,服務類,能說出社區附近的名勝古蹟。\n技能章,嚮導,服務類,能說出縣（市）政府、鄉（鎮、市、區）公所、郵局、警察局、消防隊、醫院、車站等之所在地並能擔任嚮導。\n技能章,環保,服務類,能說出環境保護的意義。\n技能章,環保,服務類,曾參加跳蚤市場或義賣活動。\n技能章,環保,服務類,會利用廢物製作玩具或藝術創作。\n技能章,環保,服務類,能蒐集廢物製作遊戲器材。\n技能章,環保,服務類,能舉出3種以上化學物質污染環境的例子。\n技能章,交通安全,服務類,能說出交通安全的常識。\n技能章,交通安全,服務類,曾任學校導護生、糾察隊等相關工作，協助引導並維持上、放學路隊行進秩序與安全。\n技能章,交通安全,服務類,能說明10種以上交通標誌。\n技能章,表演,服務類,曾參加各類表演2項以上。\n技能章,表演,服務類,曾參加才藝表演2項以上。\n技能章,種植,服務類,能在果園或花盆播種。\n技能章,種植,服務類,會除草及除蟲害。\n技能章,種植,服務類,能移植花草。\n技能章,飼養,服務類,能說出6種以上飼養動物類之特徵和方法。\n技能章,飼養,服務類,能飼養1種以上的小動物，並能說出其習性及生長情形。\n技能章,勞作,服務類,曾參與自造教育體驗課程3種以上。\n技能章,勞作,服務類,能修護簡易日用品或玩具3種以上。\n技能章,義工,服務類,曾參加淨山、淨河、淨灘等活動。\n技能章,義工,服務類,曾義務擔任社區整潔工作。\n技能章,義工,服務類,曾擔任醫院、圖書館等服務工作。\n技能章,球類運動,健身類,會打兩種以上球類運動。\n技能章,球類運動,健身類,能說出3種球類比賽的計分方式。\n技能章,體適能運動,健身類,立定跳遠：依教育部體適能標準，能達到銅牌以上。\n技能章,體適能運動,健身類,仰臥起坐：依教育部體適能標準，能達到銅牌以上。\n技能章,體適能運動,健身類,八百公尺跑走：依教育部體適能標準，能達到銅牌以上。\n技能章,體適能運動,健身類,坐姿體前彎：依教育部體適能標準，能達到銅牌以上。\n技能章,民俗體育運動,健身類,自己能踩高蹺至少行走10公尺以上。\n技能章,民俗體育運動,健身類,能自己打陀螺，讓陀螺連續打轉30秒以上。\n技能章,民俗體育運動,健身類,能靈活操作鐵環，持續直線滾動達5公尺以上。\n技能章,游泳,健身類,依教育部全國中小學生游泳與自救能力基本指標，能達到第五級標準。\n技能章,游泳,健身類,能說出游泳前、後的一般常識，並能潛水10秒鐘。\n技能章,自行車,健身類,能騎自行車，並能擦車、上油。\n技能章,自行車,健身類,能以正確姿勢上、下車。\n技能章,自行車,健身類,能連續騎自行車一公里以上。\n技能章,自行車,健身類,能調整適合自己騎乘的坐椅高度，及為自行車打氣。\n技能章,旅行,健身類,能說出旅行的一般知識。\n技能章,旅行,健身類,能以口頭報告旅行的全部行程。\n技能章,旅行,健身類,在旅行活動中能說出地區鄉土自然生態與人文環境，並作成簡單紀錄。\n技能章,休閒活動,健身類,能主持休閒活動遊戲5種以上。\n技能章,休閒活動,健身類,能領導唱和跳歌曲3首以上。\n技能章,舞蹈,健身類,能作基本舞步6種。\n技能章,舞蹈,健身類,能跳完兩支以上的舞蹈。\n技能章,體操,健身類,有領導做健身操的能力及經驗。\n技能章,體操,健身類,能做單槓、跳箱、墊上運動一項以上。\n技能章,繪畫,技巧類,能素描或寫生。\n技能章,繪畫,技巧類,能畫出3幅以上的一套漫畫。\n技能章,音樂,技巧類,能讀五線譜。\n技能章,音樂,技巧類,能用一種樂器演奏3首以上之曲子。\n技能章,音樂,技巧類,能辨識5種以上樂器的音色。\n技能章,模型,技巧類,能作手工藝品兩種以上。\n技能章,模型,技巧類,能作動物、房屋或其它模型。\n技能章,口技,技巧類,能學5種以上的動物叫聲。\n技能章,書法,技巧類,能正確說出「永」字八法。\n技能章,書法,技巧類,能用毛筆臨帖一種，其結構筆畫正確。\n技能章,歌詠,技巧類,發聲正確。\n技能章,歌詠,技巧類,能唱幼童軍歌曲及一般歌曲各5首。\n技能章,收集,技巧類,曾收集任何同一類之物品（如郵票、錢幣、火柴盒、紀念章等）50種以上，並略加說明。\n技能章,資訊,技巧類,能使用網路蒐集有關資料並列印。\n技能章,資訊,技巧類,會使用電子郵件及其它通訊APP軟體。\n技能章,資訊,技巧類,會使用手機查閱地圖、天氣、交通等生活資訊。\n技能章,資訊,技巧類,會使用各類型文書處理軟體3種以上。\n技能章,語文,技巧類,會作3分鐘即席演講。\n技能章,語文,技巧類,會說一種母語（閩南語、客家語、原住民語），並簡述一則故事。\n技能章,語文,技巧類,會一種外國語言，並能作簡單交談。\n",
 "progressRules": {
  "羚羊": "凡年滿8歲兒童經家長同意自願申請參加幼童軍活動，經參加4次以上團集會，由團長、副團長及家長依據進程內容予以評核，確認已完成羚羊級進程及登記幼童軍會籍後，經宣誓入團，佩戴團領巾並頒授羚羊章。",
  "狼": "參與羚羊級幼童軍6個月以上，由團長、副團長及家長依據進程內容予以評核，確認已完成狼級進程，經公開晉級儀式頒授佩戴狼章。",
  "鹿": "參與狼級幼童軍6個月以上，由團長、副團長及家長依據進程內容予以評核，確認已完成鹿級進程，經公開晉級儀式頒授佩戴鹿章。",
  "豹": "參與鹿級幼童軍6個月以上，由團長、副團長及家長依據進程內容予以評核，確認已完成豹級進程，經公開晉級儀式頒授佩戴豹章。"
 },
 "consentText": "親愛的家長您好：\n\n為了讓您隨時查看孩子在幼童軍團的進程，本團使用「幼童軍進程查詢系統」。在您建立帳號前，請先閱讀以下說明。\n\n一、我們會記錄哪些資料\n1. 孩子的姓名、小隊、入團日期。\n2. 孩子的進程紀錄：完成了哪些項目、哪一天完成、拿到哪些級別章與技能章。\n3. 孩子的出席紀錄：每次集會出席或請假。\n4. 您的帳號名稱、您填寫的稱呼（例如「王小明媽媽」）。您的密碼會經過加密，任何人（包括團長）都看不到。\n我們不會蒐集孩子的生日、身分證字號、電話、地址或照片。\n\n二、為什麼要記錄\n只用於本團的進程管理、出席統計，以及讓您查看孩子的紀錄，不會用在其他地方，也不會提供給團外的人或廠商。\n\n三、誰看得到\n1. 您只看得到自己孩子的資料。\n2. 本團團長與服務員看得到全團資料，用來簽核、點名與頒章。\n\n四、資料放在哪裡\n存放在本團團長管理的 Google 試算表，並每週自動備份到團長的 Google 雲端硬碟。只有團長與必要的管理人員可以開啟。\n\n五、保存多久\n孩子在團期間會一直保存。孩子離團後，團長會在【請填寫：例如 180 天】內把資料匿名化（看不出是誰）或完全刪除。備份檔會在【請填寫：例如 8 週】內自動輪替刪除。\n\n六、您的權利\n您可以隨時：\n1. 在「我的資料」頁查看我們記錄了什麼。\n2. 要求更正錯誤的資料。\n3. 在「我的資料」頁自行解除綁定（解除後您就看不到孩子的資料，孩子的紀錄不受影響）。\n4. 要求刪除您的帳號，或刪除孩子的全部資料。\n不同意本說明，就不會建立帳號，也不會留下任何紀錄；這不影響孩子參加團集會。\n\n七、聯絡誰\n有任何問題、要更正或刪除資料，請聯絡團長：【請填寫：團長稱呼與聯絡方式，例如 LINE 官方帳號「22團幼童軍進程系統」】。"
};

// ════════════════ Db.js ════════════════
/**
 * 試算表存取層：一律批次讀寫（getValues/setValues），寫入由呼叫端包在 withLock_ 裡。
 * 同一次執行內的讀取結果會快取，寫入後自動失效。
 */

var DB_CACHE_ = {};

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('找不到分頁：' + name + '（請先執行 setup）');
  return sh;
}

/** 讀整個分頁（含標題列），欄數以標題定義為準 */
function readAll_(name) {
  if (DB_CACHE_[name]) return DB_CACHE_[name];
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var width = HEADERS[name].length;
  var rows = last > 0 ? sh.getRange(1, 1, last, width).getValues() : [];
  DB_CACHE_[name] = rows;
  return rows;
}

/** 讀資料列（不含標題），每列附上試算表列號 _row */
function readRows_(name) {
  return readAll_(name).slice(1).map(function (r, i) { r = r.slice(); r._row = i + 2; return r; });
}

function invalidate_(name) { delete DB_CACHE_[name]; }

function appendRows_(name, rows) {
  if (!rows.length) return;
  var sh = sheet_(name);
  var width = HEADERS[name].length;
  var data = rows.map(function (r) {
    var x = r.slice(0, width);
    while (x.length < width) x.push('');
    return x;
  });
  var start = sh.getLastRow() + 1;
  // 超過試算表目前列數時先加列（getRange 不會自動擴充）
  var need = start + data.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  sh.getRange(start, 1, data.length, width).setValues(data);
  invalidate_(name);
}

/** 更新多列：updates = [{row, values}]；相鄰列合併成一次 setValues */
function updateRows_(name, updates) {
  if (!updates.length) return;
  var sh = sheet_(name);
  var width = HEADERS[name].length;
  var sorted = updates.slice().sort(function (a, b) { return a.row - b.row; });
  var i = 0;
  while (i < sorted.length) {
    var j = i;
    while (j + 1 < sorted.length && sorted[j + 1].row === sorted[j].row + 1) j++;
    var block = sorted.slice(i, j + 1).map(function (u) {
      var x = u.values.slice(0, width);
      while (x.length < width) x.push('');
      return x;
    });
    sh.getRange(sorted[i].row, 1, block.length, width).setValues(block);
    i = j + 1;
  }
  invalidate_(name);
}

/** 刪除多列（由下往上，連續列合併成一次 deleteRows） */
function deleteRows_(name, rowNos) {
  if (!rowNos.length) return;
  var sh = sheet_(name);
  var sorted = rowNos.slice().sort(function (a, b) { return b - a; });
  var i = 0;
  while (i < sorted.length) {
    var j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] - 1) j++;
    sh.deleteRows(sorted[j], i === j ? 1 : sorted[i] - sorted[j] + 1);
    i = j + 1;
  }
  invalidate_(name);
}

/** 寫入用鎖；同時有人操作時排隊，最多等 20 秒 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new ApiError(ERR.SERVER_ERROR, '目前使用人數較多，請稍後再試一次。');
  try {
    // 拿到鎖後重讀，避免用到別人寫入前的快取
    DB_CACHE_ = {};
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ───────────── 型別轉換 ─────────────

/** 儲存格 → 'YYYY-MM-DD'（試算表可能已自動轉成 Date） */
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var s = Logic.clean(v).replace(/\//g, '-');
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : s;
}

/** 儲存格 → 毫秒數（時間戳記欄） */
function ms_(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  var t = Date.parse(Logic.clean(v));
  return isNaN(t) ? 0 : t;
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

// ───────────── 讀取成物件 ─────────────

function loadCubs_() {
  return readRows_(SHEET.CUBS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      cubId: Logic.clean(r[0]), name: Logic.clean(r[1]), squad: Logic.clean(r[2]), joinDate: dateStr_(r[3]),
      level: Logic.clean(r[4]), code: Logic.normalizeCode(r[5]), codeUsesLeft: Number(r[6]) || 0,
      status: Logic.clean(r[7]), leftDate: dateStr_(r[8]), _row: r._row, _raw: r
    };
  });
}

function loadAccounts_() {
  return readRows_(SHEET.ACCOUNTS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      accountId: Logic.clean(r[0]), username: Logic.clean(r[1]), nickname: Logic.clean(r[2]),
      passwordHash: Logic.clean(r[3]), salt: Logic.clean(r[4]), status: Logic.clean(r[5]) || '啟用',
      tempCodeHash: Logic.clean(r[8]), tempCodeExpiresAt: ms_(r[9]), _row: r._row, _raw: r
    };
  });
}

function loadBindings_() {
  return readRows_(SHEET.BINDINGS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { accountId: Logic.clean(r[0]), cubId: Logic.clean(r[1]), consentAt: ms_(r[3]), consentVersion: Number(r[4]) || 0, _row: r._row, _raw: r };
  });
}

function loadAdmins_() {
  return readRows_(SHEET.ADMINS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { accountId: Logic.clean(r[0]), name: Logic.clean(r[1]), role: Logic.clean(r[2]), lineUserId: Logic.clean(r[5]), _row: r._row, _raw: r };
  });
}

function loadInvites_() {
  return readRows_(SHEET.INVITES).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      code: Logic.normalizeCode(r[0]), role: Logic.clean(r[1]), name: Logic.clean(r[2]), createdBy: Logic.clean(r[3]),
      expiresAt: ms_(r[5]), status: Logic.clean(r[6]), _row: r._row, _raw: r
    };
  });
}

function loadItems_() { return Logic.parseItems(readAll_(SHEET.ITEMS)); }

/** 級別與章說明（容錯：略過空白列與名稱空白列） */
function loadUnits_() {
  var map = {};
  readRows_(SHEET.UNITS).forEach(function (r) {
    var name = Logic.clean(r[0]);
    if (!name) return;
    map[Logic.clean(r[1]) + '|' + name] = { name: name, category: Logic.clean(r[1]), group: Logic.clean(r[2]), desc: Logic.clean(r[3]), rule: Logic.clean(r[4]), order: Number(r[5]) || 9999 };
  });
  return map;
}

function loadCompletions_() {
  return readRows_(SHEET.COMPLETIONS).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    var c = Logic.rowToCompletion(r);
    c.date = dateStr_(r[2]);
    c._row = r._row;
    return c;
  });
}

function loadAwards_() {
  return readRows_(SHEET.AWARDS).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { cubId: Logic.clean(r[0]), unit: Logic.clean(r[1]), date: dateStr_(r[2]), occasion: Logic.clean(r[3]), note: Logic.clean(r[4]), signer: Logic.clean(r[5]), _row: r._row };
  });
}

function loadMeetings_() {
  return readRows_(SHEET.MEETINGS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { meetingId: Logic.clean(r[0]), date: dateStr_(r[1]), name: Logic.clean(r[2]), note: Logic.clean(r[3]), enabled: Logic.clean(r[4]) !== '否', _row: r._row };
  });
}

function loadAttendance_() {
  return readRows_(SHEET.ATTENDANCE).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { meetingId: Logic.clean(r[0]), cubId: Logic.clean(r[1]), status: Logic.clean(r[2]), signer: Logic.clean(r[3]), _row: r._row };
  });
}

function loadPeriods_() {
  return readRows_(SHEET.PERIODS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { name: Logic.clean(r[0]), start: dateStr_(r[1]), end: dateStr_(r[2]), total: Number(r[3]) || 0 };
  });
}

function loadExtra_() {
  return readRows_(SHEET.EXTRA).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { period: Logic.clean(r[0]), cubId: Logic.clean(r[1]), count: Number(r[2]) || 0 };
  });
}

function loadConsents_() {
  return readRows_(SHEET.CONSENT).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { version: Number(r[0]) || 0, content: String(r[1]), effective: dateStr_(r[2]) };
  });
}

function latestConsent_() {
  var list = loadConsents_();
  var v = Logic.latestConsentVersion(list);
  return list.filter(function (c) { return c.version === v; })[0] || null;
}

function loadSettings_() { return Logic.parseSettings(readAll_(SHEET.SETTINGS)); }

/** 寫操作日誌（不得寫入密碼、臨時碼、登入憑證） */
function logOp_(actor, action, target, before, after) {
  appendRows_(SHEET.LOG, [[new Date(), actor || '', action, target || '', before || '', after || '']]);
}

// ════════════════ Auth.js ════════════════
/**
 * 帳號、登入憑證、失敗鎖定、亂數與雜湊
 */

// ───────────── 亂數與雜湊 ─────────────

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function hmacHex_(value, key) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(value, key, Utilities.Charset.UTF_8));
}

function sha256Hex_(s) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

/** 隨機十六進位字串（取自 UUID v4 的亂數位元，去掉固定的版本與變體位） */
function randomHex_(len) {
  var out = '';
  while (out.length < len) {
    var u = Utilities.getUuid().replace(/-/g, '');
    out += u.slice(0, 12) + u.slice(13, 16) + u.slice(17);
  }
  return out.slice(0, len);
}

/** [0, n) 的均勻亂數整數（拒絕取樣，避免偏差） */
function randInt_(n) {
  var limit = Math.floor(65536 / n) * n;
  for (;;) {
    var x = parseInt(randomHex_(4), 16);
    if (x < limit) return x % n;
  }
}

function newToken_() { return randomHex_(64); }

/** 所有已存在的代碼（綁定碼＋邀請碼），產生新碼時確保不衝突 */
function allCodes_() {
  var set = {};
  loadCubs_().forEach(function (c) { if (c.code) set[c.code] = true; });
  loadInvites_().forEach(function (i) { if (i.code) set[i.code] = true; });
  return set;
}

/** 產生內部代號（帳號ID、小狼ID、集會ID 等），格式：前綴 + 8 碼 */
function newId_(prefix, existing) {
  var set = {};
  (existing || []).forEach(function (x) { set[x] = true; });
  for (;;) {
    var id = prefix + Logic.generateCode(8, randInt_, []);
    if (!set[id]) return id;
  }
}

// ───────────── 失敗紀錄與鎖定 ─────────────

function loadFailures_() {
  return readRows_(SHEET.FAILURES).map(function (r) {
    return { type: Logic.clean(r[0]), target: Logic.clean(r[1]), at: ms_(r[2]) };
  });
}

/** 寫一筆失敗紀錄；超過 500 列時順便清掉一天以前的 */
function recordFailure_(type, target) {
  appendRows_(SHEET.FAILURES, [[type, target, new Date()]]);
  var rows = readRows_(SHEET.FAILURES);
  if (rows.length > 500) {
    var cutoff = Date.now() - 86400000;
    deleteRows_(SHEET.FAILURES, rows.filter(function (r) { return ms_(r[2]) < cutoff; }).map(function (r) { return r._row; }));
  }
}

function assertNotLocked_(type, target, settings) {
  if (Logic.isLocked(loadFailures_(), type, target, Date.now(), settings)) {
    throw new ApiError(ERR.LOCKED, '錯誤次數太多，請 ' + settings['失敗鎖定分鐘數'] + ' 分鐘後再試，或聯絡團長。');
  }
}

// ───────────── 帳號與登入憑證 ─────────────

function findAccountByName_(username) {
  var u = Logic.clean(username).toLowerCase();
  if (!u) return null;
  return loadAccounts_().filter(function (a) { return a.username.toLowerCase() === u; })[0] || null;
}

function findAccountById_(accountId) {
  return loadAccounts_().filter(function (a) { return a.accountId === accountId; })[0] || null;
}

/** 建立登入憑證；回傳給前端的是原始憑證，試算表只存雜湊 */
function createSession_(accountId, remember, settings) {
  var token = newToken_();
  var ttl = remember ? settings['登入保持天數'] * 86400000 : 12 * 3600000; // 不勾記住我：12 小時
  var now = new Date();
  appendRows_(SHEET.SESSIONS, [[sha256Hex_(token), accountId, now, new Date(now.getTime() + ttl)]]);
  return { token: token, expiresAt: now.getTime() + ttl };
}

/** 刪除某帳號的登入憑證（exceptHash 保留目前這一個）與所有已過期的憑證 */
function purgeSessions_(accountId, exceptHash) {
  var now = Date.now();
  var rows = readRows_(SHEET.SESSIONS).filter(function (r) {
    var mine = Logic.clean(r[1]) === accountId && Logic.clean(r[0]) !== exceptHash;
    return (accountId && mine) || ms_(r[3]) < now;
  });
  deleteRows_(SHEET.SESSIONS, rows.map(function (r) { return r._row; }));
}

/**
 * 依憑證取得登入中的帳號；無效、過期、帳號停用一律回 SESSION_EXPIRED。
 * 回傳 {account, admin, sessionHash}
 */
function requireAccount_(token) {
  var fail = new ApiError(ERR.SESSION_EXPIRED, '登入已過期，請重新登入。');
  if (!token || typeof token !== 'string' || token.length > 200) throw fail;
  var h = sha256Hex_(token);
  var ses = readRows_(SHEET.SESSIONS).filter(function (r) { return Logic.clean(r[0]) === h; })[0];
  if (!ses || !Logic.isSessionValid({ expiresAt: ms_(ses[3]) }, Date.now())) throw fail;
  var acc = findAccountById_(Logic.clean(ses[1]));
  if (!acc || acc.status !== '啟用') throw fail;
  var admin = loadAdmins_().filter(function (a) { return a.accountId === acc.accountId; })[0] || null;
  return { account: acc, admin: admin, sessionHash: h };
}

function setPassword_(acc, password) {
  var salt = randomHex_(32);
  var hash = Logic.hashPassword(password, salt, HASH_ITERATIONS, hmacHex_);
  var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
  row[3] = hash; row[4] = salt; row[8] = ''; row[9] = '';
  updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
}

/** 輸入格式檢查，不合格丟 BAD_INPUT */
function checkAccountInput_(username, password, nickname, settings) {
  var checks = [Logic.validateUsername(username), Logic.validatePassword(password, settings['密碼最短長度'])];
  if (nickname !== undefined) checks.push(Logic.validateNickname(nickname));
  checks.forEach(function (c) { if (!c.ok) throw new ApiError(ERR.BAD_INPUT, c.error); });
}

// ════════════════ Api.js ════════════════
/**
 * Web App 進入點與前端 API（階段 2：帳號、綁定、告知同意、家長查詢）
 * 後台 API 於階段 4A 加入。
 *
 * 前端以 fetch POST、Content-Type: text/plain、body 為 JSON 呼叫：
 *   { action: '動作', token: '登入憑證（需要登入的動作才帶）', ...參數 }
 * 回應：{ ok: true, ... } 或 { ok: false, code: 錯誤代碼, message: 給使用者看的訊息 }
 */

function doGet() {
  return ContentService.createTextOutput('OK：幼童軍進程系統後端運作中。');
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  // 網址帶 key 參數 → LINE webhook
  if (params.key !== undefined) {
    try { handleWebhook_(e); } catch (err) { console.error(err); }
    return ContentService.createTextOutput('OK');
  }
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!req || typeof req !== 'object' || Array.isArray(req)) throw new ApiError(ERR.BAD_INPUT, '請求格式不正確。');
    out = dispatch_(req);
  } catch (err) {
    if (err instanceof ApiError) out = { ok: false, code: err.code, message: err.message };
    else {
      console.error(err && err.stack ? err.stack : err); // 只寫進 GAS 執行紀錄，不回給前端
      out = { ok: false, code: ERR.SERVER_ERROR, message: '系統暫時無法處理，請稍後再試。' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 不需登入的動作 */
var PUBLIC_ACTIONS = {
  ping: function () { return { serverTime: new Date().toISOString() }; },
  consentText: apiConsentText_,
  checkCode: apiCheckCode_,
  register: apiRegister_,
  login: apiLogin_,
  resetPassword: apiResetPassword_
};

/** 需要登入的動作（第二個參數為 requireAccount_ 的結果） */
var AUTHED_ACTIONS = {
  me: apiMe_,
  logout: apiLogout_,
  cubDetail: apiCubDetail_,
  bind: apiBind_,
  reconsent: apiReconsent_,
  unbind: apiUnbind_,
  changePassword: apiChangePassword_,
  updateNickname: apiUpdateNickname_
};

function dispatch_(req) {
  DB_CACHE_ = {};
  var a = String(req.action || '');
  var fn;
  if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, a)) fn = PUBLIC_ACTIONS[a];
  else if (Object.prototype.hasOwnProperty.call(AUTHED_ACTIONS, a)) {
    var who = requireAccount_(req.token);
    return Object.assign({ ok: true }, AUTHED_ACTIONS[a](req, who));
  } else throw new ApiError(ERR.BAD_INPUT, '不支援的操作。');
  return Object.assign({ ok: true }, fn(req));
}

// ───────────── 告知同意 ─────────────

function apiConsentText_() {
  var c = latestConsent_();
  if (!c) throw new ApiError(ERR.SERVER_ERROR, '尚未設定個資告知內容，請聯絡團長。');
  return { version: c.version, content: c.content, effective: c.effective };
}

// ───────────── 綁定碼／邀請碼 ─────────────

/**
 * 驗證代碼（綁定碼或邀請碼）。失敗一律回同一句訊息並記錄失敗。
 * @param accountId 已登入時的帳號ID；未登入為 null（套用全站上限）
 * @return {{kind: 'parent'|'admin', cub?, invite?}}
 */
function verifyCode_(code, childName, accountId, settings) {
  var target = accountId || '未登入';
  if (accountId) assertNotLocked_('綁定', accountId, settings);
  else if (Logic.isGlobalBindLocked(loadFailures_(), Date.now(), settings)) {
    throw new ApiError(ERR.LOCKED, '目前暫停註冊，請稍後再試，或聯絡團長。');
  }
  var c = Logic.normalizeCode(code);
  var result = null;
  if (c && c.length <= 20) {
    var cub = loadCubs_().filter(function (x) { return x.code === c; })[0];
    if (cub && Logic.checkBindCode(cub, childName).ok) result = { kind: 'parent', cub: cub };
    if (!result) {
      var inv = loadInvites_().filter(function (x) { return x.code === c; })[0];
      if (inv && Logic.checkInvite(inv, Date.now()).ok) result = { kind: 'admin', invite: inv };
    }
  }
  if (!result) {
    recordFailure_('綁定', target);
    throw new ApiError(ERR.CODE_INVALID, Logic.CODE_ERROR_MESSAGE);
  }
  return result;
}

/** 註冊第一步：只驗證代碼（不建立任何資料） */
function apiCheckCode_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var r = verifyCode_(req.code, req.childName, null, settings);
    var out = { kind: r.kind };
    if (r.kind === 'parent') {
      var c = latestConsent_();
      out.consent = c ? { version: c.version, content: c.content } : null;
    }
    return out;
  });
}

/** 綁定一位小狼（寫入綁定紀錄、綁定碼次數 −1）；已綁定過則只更新同意版本 */
function bindCub_(accountId, cub, consentVersion) {
  var now = new Date();
  var existing = loadBindings_().filter(function (b) { return b.accountId === accountId && b.cubId === cub.cubId; })[0];
  if (existing) {
    var row = existing._raw.slice(0, HEADERS[SHEET.BINDINGS].length);
    row[3] = now; row[4] = consentVersion;
    updateRows_(SHEET.BINDINGS, [{ row: existing._row, values: row }]);
    return false;
  }
  appendRows_(SHEET.BINDINGS, [[accountId, cub.cubId, now, now, consentVersion]]);
  var cubRow = cub._raw.slice(0, HEADERS[SHEET.CUBS].length);
  cubRow[6] = Math.max(0, cub.codeUsesLeft - 1);
  updateRows_(SHEET.CUBS, [{ row: cub._row, values: cubRow }]);
  return true;
}

/** 使用邀請碼成為管理員 */
function redeemInvite_(accountId, invite) {
  var now = new Date();
  var admins = loadAdmins_();
  if (!admins.some(function (a) { return a.accountId === accountId; })) {
    appendRows_(SHEET.ADMINS, [[accountId, invite.name, invite.role, now, invite.createdBy || '邀請碼', '', '']]);
  }
  var row = invite._raw.slice(0, HEADERS[SHEET.INVITES].length);
  row[6] = '已使用'; row[7] = accountId; row[8] = now;
  updateRows_(SHEET.INVITES, [{ row: invite._row, values: row }]);
  // 推播通知建立邀請碼的團長：階段 5 實作
}

function requireConsentVersion_(agreedVersion) {
  var c = latestConsent_();
  if (!c) throw new ApiError(ERR.SERVER_ERROR, '尚未設定個資告知內容，請聯絡團長。');
  if (Number(agreedVersion) !== c.version) throw new ApiError(ERR.NEED_CONSENT, '請先閱讀並勾選同意個資告知內容。');
  return c.version;
}

// ───────────── 註冊、登入、密碼 ─────────────

function apiRegister_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var r = verifyCode_(req.code, req.childName, null, settings);
    checkAccountInput_(req.username, req.password, req.nickname, settings);
    // 家長：沒有同意就不建立任何資料
    var version = r.kind === 'parent' ? requireConsentVersion_(req.consentVersion) : null;
    if (findAccountByName_(req.username)) throw new ApiError(ERR.NAME_TAKEN, '這個帳號名稱已經有人使用，請換一個。');

    var accounts = loadAccounts_();
    var accountId = newId_('U', accounts.map(function (a) { return a.accountId; }));
    var salt = randomHex_(32);
    var hash = Logic.hashPassword(String(req.password), salt, HASH_ITERATIONS, hmacHex_);
    var now = new Date();
    appendRows_(SHEET.ACCOUNTS, [[accountId, Logic.clean(req.username), Logic.clean(req.nickname), hash, salt, '啟用', now, now, '', '']]);
    if (r.kind === 'parent') {
      bindCub_(accountId, r.cub, version);
      logOp_(accountId, '註冊並綁定', r.cub.cubId, '', '帳號 ' + Logic.clean(req.username));
    } else {
      redeemInvite_(accountId, r.invite);
      logOp_(accountId, '以邀請碼註冊管理員', Logic.clean(req.username), '', r.invite.role);
    }
    var s = createSession_(accountId, !!req.remember, settings);
    return { token: s.token, expiresAt: s.expiresAt };
  });
}

function apiLogin_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var name = Logic.clean(req.username).toLowerCase().slice(0, 40);
    assertNotLocked_('登入', name, settings);
    var acc = findAccountByName_(name);
    // 帳號不存在也照樣做一次雜湊，讓回應時間一致
    var ok = Logic.verifyPassword(String(req.password || ''), acc ? acc.salt : 'x', acc ? acc.passwordHash : HASH_ITERATIONS + '$x', hmacHex_);
    if (!acc || !ok || acc.status !== '啟用') {
      recordFailure_('登入', name);
      throw new ApiError(ERR.BAD_LOGIN, '帳號或密碼錯誤。');
    }
    var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
    row[7] = new Date();
    updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
    purgeSessions_(null);
    var s = createSession_(acc.accountId, !!req.remember, settings);
    return { token: s.token, expiresAt: s.expiresAt };
  });
}

/** 忘記密碼：帳號名稱＋團長給的臨時碼＋新密碼 */
function apiResetPassword_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var name = Logic.clean(req.username).toLowerCase().slice(0, 40);
    assertNotLocked_('登入', name, settings);
    var acc = findAccountByName_(name);
    var code = Logic.normalizeCode(req.tempCode);
    if (!acc || !Logic.isTempCodeValid(acc, Date.now()) || sha256Hex_(code) !== acc.tempCodeHash || acc.status !== '啟用') {
      recordFailure_('登入', name);
      throw new ApiError(ERR.BAD_LOGIN, '帳號或臨時碼錯誤，或臨時碼已過期。請聯絡團長重新產生。');
    }
    var pw = Logic.validatePassword(req.newPassword, settings['密碼最短長度']);
    if (!pw.ok) throw new ApiError(ERR.BAD_INPUT, pw.error);
    setPassword_(acc, String(req.newPassword)); // 同時清除臨時碼（用過即失效）
    purgeSessions_(acc.accountId);
    logOp_(acc.accountId, '以臨時碼重設密碼', acc.username, '', '');
    return {};
  });
}

function apiLogout_(req, who) {
  return withLock_(function () {
    var row = readRows_(SHEET.SESSIONS).filter(function (r) { return Logic.clean(r[0]) === who.sessionHash; })[0];
    if (row) deleteRows_(SHEET.SESSIONS, [row._row]);
    return {};
  });
}

function apiChangePassword_(req, who) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var acc = findAccountById_(who.account.accountId);
    if (!Logic.verifyPassword(String(req.oldPassword || ''), acc.salt, acc.passwordHash, hmacHex_)) {
      throw new ApiError(ERR.BAD_INPUT, '目前的密碼不正確。');
    }
    var pw = Logic.validatePassword(req.newPassword, settings['密碼最短長度']);
    if (!pw.ok) throw new ApiError(ERR.BAD_INPUT, pw.error);
    setPassword_(acc, String(req.newPassword));
    purgeSessions_(acc.accountId, who.sessionHash); // 其他裝置登出，目前這台保留
    logOp_(acc.accountId, '修改密碼', acc.username, '', '');
    return {};
  });
}

function apiUpdateNickname_(req, who) {
  var v = Logic.validateNickname(req.nickname);
  if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
  return withLock_(function () {
    var acc = findAccountById_(who.account.accountId);
    var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
    var before = row[2];
    row[2] = Logic.clean(req.nickname);
    updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
    logOp_(acc.accountId, '修改稱呼', acc.username, before, row[2]);
    return {};
  });
}

// ───────────── 已登入：綁定與同意 ─────────────

/** 已登入帳號新增綁定（第二個孩子），或輸入邀請碼成為管理員 */
function apiBind_(req, who) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var r = verifyCode_(req.code, req.childName, who.account.accountId, settings);
    if (r.kind === 'parent') {
      var version = requireConsentVersion_(req.consentVersion);
      bindCub_(who.account.accountId, r.cub, version);
      logOp_(who.account.accountId, '新增綁定', r.cub.cubId, '', '');
      return { kind: 'parent', cubId: r.cub.cubId };
    }
    redeemInvite_(who.account.accountId, r.invite);
    logOp_(who.account.accountId, '以邀請碼成為管理員', who.account.username, '', r.invite.role);
    return { kind: 'admin' };
  });
}

/** 告知內容改版後重新同意：更新此帳號所有綁定的同意時間與版本 */
function apiReconsent_(req, who) {
  return withLock_(function () {
    var version = requireConsentVersion_(req.consentVersion);
    var now = new Date();
    var ups = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; }).map(function (b) {
      var row = b._raw.slice(0, HEADERS[SHEET.BINDINGS].length);
      row[3] = now; row[4] = version;
      return { row: b._row, values: row };
    });
    updateRows_(SHEET.BINDINGS, ups);
    return { updated: ups.length };
  });
}

/** 家長自行解除綁定：只刪除自己這個帳號與該小狼的綁定 */
function apiUnbind_(req, who) {
  return withLock_(function () {
    var rows = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === Logic.clean(req.cubId); });
    if (!rows.length) throw new ApiError(ERR.NOT_FOUND, '找不到這筆綁定。');
    deleteRows_(SHEET.BINDINGS, rows.map(function (b) { return b._row; }));
    logOp_(who.account.accountId, '家長解除綁定', Logic.clean(req.cubId), '', '');
    return {};
  });
}

// ───────────── 查詢 ─────────────

/** 登入者的基本資訊、身分、綁定的小狼 */
function apiMe_(req, who) {
  var latest = Logic.latestConsentVersion(loadConsents_());
  var cubs = loadCubs_();
  var mine = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
  var list = [];
  mine.forEach(function (b) {
    var c = cubs.filter(function (x) { return x.cubId === b.cubId; })[0];
    if (!c) return;
    list.push({ cubId: c.cubId, name: c.name, consentVersion: b.consentVersion, consentAt: b.consentAt ? new Date(b.consentAt).toISOString() : '' });
  });
  return {
    username: who.account.username,
    nickname: who.account.nickname,
    role: who.admin ? who.admin.role : null,
    adminName: who.admin ? who.admin.name : null,
    lineLinked: !!(who.admin && who.admin.lineUserId),
    cubs: list,
    latestConsentVersion: latest,
    needsConsent: mine.some(function (b) { return Logic.needsReconsent(b, latest); })
  };
}

/**
 * 一位已綁定小狼的完整資料（家長畫面用）。回傳欄位採白名單。
 * 不回傳「是否達標／可晉級」，已完成待頒發一律顯示固定文字。
 */
function apiCubDetail_(req, who) {
  var cubId = Logic.clean(req.cubId);
  var binding = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === cubId; })[0];
  // 沒有綁定與小狼不存在回同一句話，不透露小狼是否存在
  if (!binding) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼的資料。');
  if (Logic.needsReconsent(binding, Logic.latestConsentVersion(loadConsents_()))) {
    throw new ApiError(ERR.NEED_CONSENT, '個資告知內容已更新，請先閱讀並同意。');
  }
  var cub = loadCubs_().filter(function (c) { return c.cubId === cubId; })[0];
  if (!cub) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼的資料。');
  return buildCubView_(cub, today_());
}

/** 組出家長畫面要的資料（也供後台列印簽核單共用） */
function buildCubView_(cub, today) {
  var settings = loadSettings_().values;
  var items = loadItems_().items;
  var units = loadUnits_();
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && Logic.isDateStr(m.date); });
  var mById = {};
  meetings.forEach(function (m) { mById[m.meetingId] = m; });
  var att = loadAttendance_().filter(function (a) { return a.cubId === cub.cubId && mById[a.meetingId]; });
  var attRecords = att.map(function (a) { return { date: mById[a.meetingId].date, status: a.status, meetingId: a.meetingId }; });

  var progress = Logic.computeCubProgress({
    cubId: cub.cubId, items: items, completions: loadCompletions_(), awards: loadAwards_(),
    intervalMonths: settings['晉級間隔月數'], today: today, attendance: attRecords,
    autoItemId: settings['出席自動完成項目ID'], autoCount: settings['自動完成所需出席次數'],
    levelAttendCount: settings['晉級所需出席次數']
  });

  // 簽核人帳號ID → 管理員姓名
  var names = {};
  loadAdmins_().forEach(function (a) { names[a.accountId] = a.name; });

  var unitViews = progress.units.map(function (u) {
    var info = units[u.category + '|' + u.unit] || {};
    return {
      category: u.category, unit: u.unit, group: info.group || '', desc: info.desc || '', rule: info.rule || '',
      order: info.order || 9999, status: u.status, statusText: Logic.statusTextForParents(u.status),
      done: u.done, total: u.total, awardDate: u.awardDate, awardOccasion: u.awardOccasion || '',
      attendRequired: u.attendRequired || 0, attendSinceLast: u.attendSinceLast || 0,
      items: u.items.map(function (i) {
        return { section: i.section, text: i.text, done: i.done, date: i.date, signer: i.done ? (names[i.signer] || (i.auto ? '出席自動計算' : '')) : '', auto: i.auto };
      })
    };
  }).sort(function (a, b) { return a.order - b.order; });

  // 出席：只顯示已到日期的集會；未來的列為即將到來；沒點名的顯示「－」（不記缺席）
  var statusOf = {};
  att.forEach(function (a) { statusOf[a.meetingId] = a.status; });
  var inTeam = meetings.filter(function (m) { return m.date >= cub.joinDate && (!cub.leftDate || m.date <= cub.leftDate); });
  var past = inTeam.filter(function (m) { return m.date <= today; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var upcoming = inTeam.filter(function (m) { return m.date > today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 5);
  var period = Logic.periodOf(loadPeriods_(), today);
  var rate = null;
  if (period) {
    var extra = loadExtra_().filter(function (x) { return x.period === period.name && x.cubId === cub.cubId; })
      .reduce(function (s, x) { return s + x.count; }, 0);
    rate = Logic.attendanceRate(attRecords, period, extra);
    rate.period = period.name;
  }

  return {
    cub: {
      cubId: cub.cubId, name: cub.name, squad: cub.squad, joinDate: cub.joinDate,
      tenure: Logic.tenure(cub.joinDate, today).text, currentLevel: progress.currentLevel || ''
    },
    nextChallenge: (function (n) {
      // 白名單：不帶簽核人帳號ID 等內部欄位
      return { type: n.type, message: n.message, level: n.level || '', items: n.items.map(function (i) { return { section: i.section, text: i.text }; }) };
    })(Logic.nextChallenge(progress)),
    units: unitViews,
    attendance: {
      meetings: past.map(function (m) { return { date: m.date, name: m.name, status: statusOf[m.meetingId] || '－' }; }),
      upcoming: upcoming.map(function (m) { return { date: m.date, name: m.name }; }),
      counts: Logic.attendanceCounts(attRecords),
      rate: rate
    }
  };
}

// ════════════════ Webhook.js ════════════════
/**
 * LINE webhook（網址需帶 ?key=WEBHOOK_KEY）
 * 階段 2：只做密鑰與格式檢查，不回覆。
 * 階段 4A：管理員「連結 LINE 通知」配對碼。階段 5：關鍵字回覆（可晉級、快達標、進度）。
 */
function handleWebhook_(e) {
  var key = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
  // 密鑰不符：直接忽略
  if (!key || e.parameter.key !== key) return;
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return; }
  // 只處理格式正確的請求
  if (!body || !Array.isArray(body.events)) return;
  // 之後的階段在這裡依事件類型分派
}

// ════════════════ Setup.js ════════════════
/**
 * setup()：一鍵建立所有分頁與標題列、第一次匯入種子資料、產生第一位團長邀請碼。
 * 可重複執行；任何分頁已有資料時一律不覆蓋、不重新匯入。
 * 請在 Apps Script 編輯器手動執行。
 */
function setup() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    DB_CACHE_ = {};
    var props = PropertiesService.getScriptProperties();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss && !props.getProperty('SPREADSHEET_ID')) props.setProperty('SPREADSHEET_ID', ss.getId());
    if (!props.getProperty('WEBHOOK_KEY')) props.setProperty('WEBHOOK_KEY', randomHex_(64));

    var report = { created: [], headerFixed: [], headerMismatch: [], seeded: [] };
    Object.keys(SHEET).forEach(function (k) { ensureSheet_(SHEET[k], report); });

    // 種子資料：只在分頁沒有資料列時匯入
    var seed = Logic.buildSeed(SEED.itemsCsv, SEED.progressRules);
    if (dataRowCount_(SHEET.ITEMS) === 0) { appendRows_(SHEET.ITEMS, seed.itemRows); report.seeded.push(SHEET.ITEMS + ' ' + seed.itemRows.length + ' 列'); }
    if (dataRowCount_(SHEET.UNITS) === 0) { appendRows_(SHEET.UNITS, seed.unitRows); report.seeded.push(SHEET.UNITS + ' ' + seed.unitRows.length + ' 列'); }
    if (dataRowCount_(SHEET.CONSENT) === 0) { appendRows_(SHEET.CONSENT, [[1, SEED.consentText, today_()]]); report.seeded.push(SHEET.CONSENT + ' 第 1 版'); }

    // 設定：只補上缺少的鍵，不改既有值
    var have = {};
    readRows_(SHEET.SETTINGS).forEach(function (r) { have[Logic.clean(r[0])] = true; });
    var missing = Logic.defaultSettingsRows().slice(1).filter(function (r) { return !have[r[0]]; });
    if (missing.length) { appendRows_(SHEET.SETTINGS, missing); report.seeded.push(SHEET.SETTINGS + ' 補上 ' + missing.length + ' 項'); }

    report.firstLeaderInvite = ensureFirstLeaderInvite_();
    printSetupReport_(report);
    return report;
  } finally {
    lock.releaseLock();
  }
}

function dataRowCount_(name) {
  return readRows_(name).filter(function (r) { return r.some(function (v) { return Logic.clean(v) !== ''; }); }).length;
}

/** 建立分頁、寫標題列（只補最右邊缺少的欄）、凍結、文字格式、標題列保護 */
function ensureSheet_(name, report) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); report.created.push(name); }
  var header = HEADERS[name];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  } else {
    var width = Math.max(sh.getLastColumn(), 1);
    var cur = sh.getRange(1, 1, 1, width).getValues()[0].map(Logic.clean);
    var n = Math.min(cur.length, header.length);
    var prefixOk = true;
    for (var i = 0; i < n; i++) if (cur[i] !== header[i]) prefixOk = false;
    if (!prefixOk) report.headerMismatch.push(name);
    else if (cur.filter(function (x) { return x; }).length < header.length) {
      // 既有欄位不動，只在最右邊補上新欄
      var start = cur.filter(function (x) { return x; }).length;
      sh.getRange(1, start + 1, 1, header.length - start).setValues([header.slice(start)]);
      report.headerFixed.push(name);
    }
  }
  invalidate_(name);
  sh.setFrozenRows(1);
  (TEXT_COLUMNS[name] || []).forEach(function (col) {
    sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  var protectedAlready = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).some(function (p) { return p.getDescription() === '標題列'; });
  if (!protectedAlready) sh.getRange(1, 1, 1, header.length).protect().setDescription('標題列').setWarningOnly(true);
}

/** 管理員分頁是空的時候，產生（或沿用）一組團長邀請碼 */
function ensureFirstLeaderInvite_() {
  if (loadAdmins_().length) return null;
  var now = Date.now();
  var existing = loadInvites_().filter(function (i) { return i.role === Logic.ROLE.LEADER && Logic.checkInvite(i, now).ok; })[0];
  if (existing) return { code: existing.code, expiresAt: existing.expiresAt, reused: true };
  var len = loadSettings_().values['綁定碼長度'] + 2;
  var code = Logic.generateCode(len, randInt_, allCodes_());
  var exp = new Date(now + FIRST_LEADER_INVITE_HOURS * 3600000);
  appendRows_(SHEET.INVITES, [[code, Logic.ROLE.LEADER, '團長', 'setup', new Date(now), exp, '未使用', '', '']]);
  return { code: code, expiresAt: exp.getTime(), reused: false };
}

function printSetupReport_(r) {
  Logger.log('setup 完成。');
  if (r.created.length) Logger.log('新建立分頁：' + r.created.join('、'));
  if (r.seeded.length) Logger.log('匯入資料：' + r.seeded.join('、'));
  if (r.headerFixed.length) Logger.log('補上新欄位：' + r.headerFixed.join('、'));
  if (r.headerMismatch.length) Logger.log('⚠️ 標題列與程式不一致（未修改，請檢查）：' + r.headerMismatch.join('、'));
  if (r.firstLeaderInvite) {
    Logger.log('第一位團長邀請碼：' + r.firstLeaderInvite.code + '（有效到 ' +
      Utilities.formatDate(new Date(r.firstLeaderInvite.expiresAt), TZ, 'yyyy-MM-dd HH:mm') + '）');
    Logger.log('請用網頁「我有代碼，要註冊」輸入這組邀請碼（小孩姓名留空）建立你的團長帳號。不要分享給別人。');
  }
}

/** 清除階段 0B 的測試資料（Script Properties 中 T0B_ 開頭者） */
function cleanup0B() {
  var props = PropertiesService.getScriptProperties();
  var n = 0;
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf('T0B_') === 0) { props.deleteProperty(k); n++; } });
  Logger.log('已清除 ' + n + ' 筆 0B 測試資料。');
}
