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
  // 進程級別順序。「剛入團」是本團在羚羊前加的一級（頒黃領巾，準備闖羚羊級；SPEC 附錄第 37 點）
  var NEWBIE = '剛入團';
  var LEVELS = [NEWBIE, '羚羊', '狼', '鹿', '豹'];
  /** 晉級間隔月數只套用在這些級別（狼、鹿、豹：距上一級頒發滿 N 個月） */
  var INTERVAL_LEVELS = ['狼', '鹿', '豹'];
  /** 剛入團的種子項目（團自訂，setup 在項目總表沒有剛入團時補上；ID 固定為 P-剛入團-1～5） */
  var NEWBIE_SEED = {
    items: ['背誦與了解諾言規律', '知道團長、副團長、服務員姓名', '知道舉手禮與握手禮及意義', '知道同隊幼童軍姓名', '能向大家自我介紹'],
    desc: '入團第一關，準備闖羚羊級：認得人、認得地方、敢開口。',
    rule: '入團後參加團集會 4 次以上，完成剛入團各項，經團長評核頒發黃領巾，開始挑戰羚羊級。'
  };
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
    { key: '晉級所需出席次數', type: 'int', def: 8, min: 0, max: 100, desc: '羚羊、狼、鹿、豹級：上一級頒發日之後需「出席」幾次（請假不算）；填 0 表示不要求' },
    { key: '剛入團所需出席次數', type: 'int', def: 4, min: 0, max: 50, desc: '剛入團：入團後需「出席」幾次才能頒黃領巾（請假不算）；填 0 表示不要求' },
    { key: '小隊清單', type: 'list', def: [], desc: '小隊名稱，用頓號「、」分隔，依此順序顯示（建議在後台「更多 → 小隊設定」修改）' },
    { key: '出席自動完成項目ID', type: 'str', def: 'P-羚羊-7', pattern: /^[PB]-\S+-\d+$/, desc: '出席滿次數後自動完成的項目（預設為羚羊「參加幼童軍團集會至少4次」）' },
    { key: '自動完成所需出席次數', type: 'int', def: 4, min: 1, max: 50, desc: '「出席」幾次後自動完成上面那一項（請假不算）' },
    { key: '快達標門檻（剩幾項以內）', type: 'int', def: 2, min: 1, max: 10, desc: '' },
    { key: '未頒章再提醒天數', type: 'int', def: 14, min: 0, max: 365, desc: '填 0 表示不提醒' },
    { key: '每日排程時間（幾點）', type: 'int', def: 8, min: 0, max: 23, desc: '' },
    { key: '每週備份', type: 'bool', def: true, desc: '是/否' },
    { key: '備份保留份數', type: 'int', def: 8, min: 1, max: 52, desc: '' },
    { key: '離團後提醒處理個資的天數', type: 'int', def: 180, min: 0, max: 3650, desc: '填 0 表示不提醒' },
    { key: '每日註冊申請上限', type: 'int', def: 30, min: 5, max: 500, desc: '24 小時內最多幾個新帳號送出註冊申請，超過就暫停註冊（防止濫用）' }
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
      if (s.type === 'list') {
        // 小隊清單：可為空；頓號、逗號或換行分隔，去重複
        values[s.key] = parseList(f ? f.value : '');
        return;
      }
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

  /** 清單字串 → 陣列（頓號、逗號、換行分隔，去前後空白與重複，每項最多 20 字） */
  function parseList(v) {
    var out = [];
    String(v == null ? '' : v).split(/[、,，\n\r]+/).forEach(function (x) {
      x = clean(x).slice(0, 20);
      if (x && out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }

  /**
   * 小隊清單異動（新增／改名／刪除／移動），回傳新清單；不合法丟出錯誤訊息。
   * @param inUse 目前在團小狼使用中的小隊名稱（刪除時檢查）
   */
  function changeSquads(list, op, inUse) {
    var cur = list.slice();
    var name = clean(op.name).slice(0, 20), to = clean(op.newName).slice(0, 20);
    var i = cur.indexOf(name);
    if (op.type === 'add') {
      if (!name) return { ok: false, error: '請輸入小隊名稱。' };
      if (/[、,，]/.test(op.name)) return { ok: false, error: '小隊名稱不能含頓號或逗號。' };
      if (i >= 0) return { ok: false, error: '已經有這個小隊了。' };
      cur.push(name);
    } else if (op.type === 'rename') {
      if (i < 0) return { ok: false, error: '找不到這個小隊。' };
      if (!to) return { ok: false, error: '請輸入新的小隊名稱。' };
      if (/[、,，]/.test(op.newName)) return { ok: false, error: '小隊名稱不能含頓號或逗號。' };
      if (to !== name && cur.indexOf(to) >= 0) return { ok: false, error: '已經有這個小隊了。' };
      cur[i] = to;
    } else if (op.type === 'remove') {
      if (i < 0) return { ok: false, error: '找不到這個小隊。' };
      if ((inUse || []).indexOf(name) >= 0) return { ok: false, error: '還有在團小狼屬於「' + name + '」，請先把他們換到其他小隊。' };
      cur.splice(i, 1);
    } else if (op.type === 'move') {
      if (i < 0) return { ok: false, error: '找不到這個小隊。' };
      var j = i + (op.dir === 'up' ? -1 : 1);
      if (j >= 0 && j < cur.length) { cur[i] = cur[j]; cur[j] = name; }
    } else return { ok: false, error: '不支援的操作。' };
    return { ok: true, list: cur };
  }

  /** setup() 用：設定分頁初始內容（含標題列） */
  function defaultSettingsRows() {
    return [['鍵', '值', '說明']].concat(SETTINGS.map(function (s) {
      return [s.key, s.type === 'bool' ? (s.def ? '是' : '否') : s.type === 'list' ? s.def.join('、') : s.def, s.desc];
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
      else if (cat === CATEGORY.PROGRESS && LEVELS.indexOf(unit) < 0) reason = '進程級別只能是' + LEVELS.join('、');
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

  // ───────────── 進程細項（團自訂，只顯示、不勾選；SPEC 附錄第 24、27 點） ─────────────

  /** 細項種子：data/details.csv（項目ID,分組,細項內容,通過標準,生活應用）→ 「進程細項」分頁的列 */
  function buildDetailSeed(csvText) {
    return parseCsv(csvText || '').slice(1).filter(function (r) { return clean(r[0]) && clean(r[2]); }).map(function (r, i) {
      return [clean(r[0]), clean(r[1]), clean(r[2]), clean(r[3]), clean(r[4]), (i + 1) * 10, '是'];
    });
  }

  /**
   * 讀「進程細項」分頁（含標題列）。同一項目、同一分組的細項合成一組；
   * 通過標準、生活應用取該組第一個有填的值（團長只要填在每組第一列）。
   * @param {Object} itemIds 項目總表中存在的項目ID（{id: true}）；找不到的列回報錯誤、不顯示
   * @return {{byItem: Object<string, Array<{group, standard, life, subs: string[]}>>, errors: Array}}
   */
  function parseDetails(rows, itemIds) {
    var list = [], errors = [];
    (rows || []).slice(1).forEach(function (r, i) {
      var rowNo = i + 2;
      var c = [0, 1, 2, 3, 4, 5, 6].map(function (j) { return clean(r[j]); });
      if (c.every(function (x) { return x === ''; })) return;
      var reason = null;
      if (!c[0]) reason = '缺少項目ID';
      else if (itemIds && !itemIds[c[0]]) reason = '項目總表找不到這個項目ID';
      else if (!c[2]) reason = '缺少細項內容';
      else if (c[6] !== '是' && c[6] !== '否') reason = '啟用欄只能是「是」或「否」';
      if (reason) { errors.push({ row: rowNo, id: c[0], reason: reason }); return; }
      if (c[6] !== '是') return;
      var order = Number(c[5]);
      list.push({ itemId: c[0], group: c[1], text: c[2], standard: c[3], life: c[4], order: c[5] !== '' && isFinite(order) ? order : 9999, row: rowNo });
    });
    list.sort(function (a, b) { return a.order - b.order || a.row - b.row; });
    var byItem = {};
    list.forEach(function (d) {
      var groups = byItem[d.itemId] || (byItem[d.itemId] = []);
      var g = groups.filter(function (x) { return x.group === d.group; })[0];
      if (!g) groups.push((g = { group: d.group, standard: '', life: '', subs: [] }));
      if (!g.standard && d.standard) g.standard = d.standard;
      if (!g.life && d.life) g.life = d.life;
      g.subs.push(d.text);
    });
    return { byItem: byItem, errors: errors };
  }

  // ───────────── 註冊申請（SPEC 附錄第 31 點） ─────────────

  var IDENTITY = { PARENT: '家長', STAFF: '服務員' };
  var MAX_CHILDREN_PER_REQUEST = 5;

  /**
   * 檢查申請時填的孩子姓名：去空白、去重複，每個 1～20 字，最多 5 位。
   * @return {{ok: boolean, names?: string[], error?: string}}
   */
  function validateChildNames(list, required) {
    var names = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (x) {
      var n = clean(x).replace(/\s+/g, '');
      if (n && !seen[n]) { seen[n] = true; names.push(n); }
    });
    if (required && !names.length) return { ok: false, error: '請填寫孩子的姓名。' };
    if (names.length > MAX_CHILDREN_PER_REQUEST) return { ok: false, error: '一次最多填 ' + MAX_CHILDREN_PER_REQUEST + ' 位孩子。' };
    for (var i = 0; i < names.length; i++) if (names[i].length > 20) return { ok: false, error: '孩子姓名最多 20 字。' };
    return { ok: true, names: names };
  }

  /** 過去 24 小時內送出註冊申請的帳號數（防止濫用） */
  function recentRequestAccounts(requests, now) {
    var set = {};
    (requests || []).forEach(function (r) { if (r.at && now - r.at < 24 * 3600000) set[r.accountId] = true; });
    return Object.keys(set).length;
  }



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
    // 「剛入團」是後來加的一級：已經拿到羚羊以上的小狼，視為已通過剛入團（不寫入頒章紀錄）
    if (!awarded[NEWBIE] && LEVELS.slice(1).some(function (lv) { return awarded[lv]; })) {
      awarded[NEWBIE] = { cubId: cubId, unit: NEWBIE, date: null, occasion: '已晉級（視為通過）', implicit: true };
    }

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
        var e = eligibility(g.category, g.unit, allDone, u.lastCompletionDate, awarded, p.intervalMonths, p.today, attended, g.unit === NEWBIE ? (p.newbieAttendCount || 0) : (p.levelAttendCount || 0));
        u.eligible = e.eligible; u.eligibleDate = e.date; u.waitingUntil = e.waitingUntil || null;
        if (e.attendRequired) { u.attendRequired = e.attendRequired; u.attendSinceLast = e.attendSinceLast; }
      }
      return u;
    });
    return { units: units, currentLevel: currentLevel, nextLevel: nextLevel };
  }

  /**
   * 達標（可頒章）判定：
   *  - 技能章：啟用項目全部完成。
   *  - 剛入團：全部完成，且入團後出席次數 ≥ 剛入團所需出席次數。
   *  - 羚羊、狼、鹿、豹：全部完成，且上一級已頒發，且上一級頒發日「之後」（不含當天）出席次數 ≥ 晉級所需出席次數
   *    （0 表示不要求；請假不算）；狼、鹿、豹另需今天 ≥ 上一級頒發日期 + 間隔月數。
   * 回傳的 date 是「達標日期」= 以上各條件都滿足的最早日期。
   */
  function eligibility(category, unit, allDone, lastDate, awarded, intervalMonths, today, attended, attendNeed) {
    if (!allDone) return { eligible: false, date: null };
    if (category === CATEGORY.BADGE) return { eligible: true, date: lastDate };
    var prevDate = '', date = lastDate;
    if (unit !== LEVELS[0]) {
      var prev = LEVELS[LEVELS.indexOf(unit) - 1];
      if (!awarded[prev]) return { eligible: false, date: null, reason: '上一級尚未頒發' };
      prevDate = awarded[prev].date || '';
      if (INTERVAL_LEVELS.indexOf(unit) >= 0) {
        var ready = addMonths(prevDate, intervalMonths || 0);
        if (ready > date) date = ready;
      }
    }
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
    backup: [ROLE.LEADER],
    reviewRequests: [ROLE.LEADER]
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
    '額外出席': 1,
    '註冊申請': 8
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
    LEVELS: LEVELS, NEWBIE: NEWBIE, NEWBIE_SEED: NEWBIE_SEED, INTERVAL_LEVELS: INTERVAL_LEVELS, CATEGORY: CATEGORY, BADGE_GROUPS: BADGE_GROUPS, NO_SECTION: NO_SECTION, STATUS: STATUS, ROLE: ROLE,
    PENDING_TEXT_FOR_PARENTS: PENDING_TEXT_FOR_PARENTS, CODE_CHARSET: CODE_CHARSET, CODE_ERROR_MESSAGE: CODE_ERROR_MESSAGE,
    SETTINGS: SETTINGS, PERMISSIONS: PERMISSIONS, CUB_ID_COLUMNS: CUB_ID_COLUMNS,
    isDateStr: isDateStr, cmpDate: cmpDate, addMonths: addMonths, tenure: tenure,
    clean: clean, parseCsv: parseCsv, toCsv: toCsv,
    parseSettings: parseSettings, defaultSettingsRows: defaultSettingsRows, parseList: parseList, changeSquads: changeSquads,
    parseItems: parseItems, nextItemId: nextItemId, buildSeed: buildSeed, buildDetailSeed: buildDetailSeed, parseDetails: parseDetails,
    isCountedCompletion: isCountedCompletion, computeCubProgress: computeCubProgress, nextChallenge: nextChallenge,
    isNearlyDone: isNearlyDone, attendanceCounts: attendanceCounts, attendanceRate: attendanceRate, periodOf: periodOf, statusTextForParents: statusTextForParents,
    planBatchSignoff: planBatchSignoff, completionToRow: completionToRow, rowToCompletion: rowToCompletion,
    validateAwardDate: validateAwardDate, planBackfill: planBackfill, levelAfterRevoke: levelAfterRevoke,
    generateCode: generateCode, normalizeCode: normalizeCode, checkInvite: checkInvite, checkBindCode: checkBindCode,
    validateUsername: validateUsername, validatePassword: validatePassword, validateNickname: validateNickname,
    hashPassword: hashPassword, verifyPassword: verifyPassword, isSessionValid: isSessionValid, isTempCodeValid: isTempCodeValid,
    isLocked: isLocked, isGlobalBindLocked: isGlobalBindLocked,
    latestConsentVersion: latestConsentVersion, needsReconsent: needsReconsent,
    IDENTITY: IDENTITY, validateChildNames: validateChildNames, recentRequestAccounts: recentRequestAccounts,
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
  DETAILS: '進程細項',
  COMPLETIONS: '完成紀錄',
  AWARDS: '頒章紀錄',
  MEETINGS: '集會行事曆',
  ATTENDANCE: '出席紀錄',
  PERIODS: '年度出席設定',
  EXTRA: '額外出席',
  NOTIFY: '通知紀錄',
  FAILURES: '失敗紀錄',
  CONSENT: '告知同意內容',
  REQUESTS: '註冊申請',
  SETTINGS: '設定',
  LOG: '操作日誌'
};

/**
 * 團長平常需要自己打開修改的分頁（SPEC 附錄第 30 點）；排在最前面且一律顯示。
 * 其他分頁是系統自己寫入的紀錄，setup() 會把它們隱藏起來（只是隱藏，資料不動）。
 */
var EDITABLE_SHEETS = [SHEET.ITEMS, SHEET.DETAILS, SHEET.UNITS, SHEET.SETTINGS, SHEET.CONSENT];

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
HEADERS[SHEET.DETAILS] = ['項目ID', '分組', '細項內容', '通過標準', '生活應用', '排序', '啟用'];
HEADERS[SHEET.COMPLETIONS] = ['小狼ID', '項目ID', '完成日期', '簽核人', '備註', '回報人', '回報狀態'];
HEADERS[SHEET.AWARDS] = ['小狼ID', '級別或章名', '頒發日期', '頒發場合', '備註', '簽核人', '登錄時間'];
HEADERS[SHEET.MEETINGS] = ['集會ID', '日期', '名稱', '備註', '啟用', '建立人', '建立時間'];
HEADERS[SHEET.ATTENDANCE] = ['集會ID', '小狼ID', '狀態', '點名人', '點名時間'];
HEADERS[SHEET.PERIODS] = ['年度名稱', '開始日', '結束日', '應出席總數', '備註'];
HEADERS[SHEET.EXTRA] = ['年度名稱', '小狼ID', '額外出席次數', '備註', '設定人', '設定時間'];
HEADERS[SHEET.NOTIFY] = ['小狼ID', '級別或章名', '通知類型', '通知時間'];
HEADERS[SHEET.FAILURES] = ['類型', '對象', '時間'];
HEADERS[SHEET.REQUESTS] = ['申請ID', '帳號ID', '類型', '填寫姓名', '申請時間', '狀態', '處理人', '處理時間', '小狼ID', '同意版本', '備註'];
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
TEXT_COLUMNS[SHEET.DETAILS] = [1];
TEXT_COLUMNS[SHEET.COMPLETIONS] = [1, 2, 3, 4];
TEXT_COLUMNS[SHEET.AWARDS] = [1, 3, 6];
TEXT_COLUMNS[SHEET.MEETINGS] = [1, 2];
TEXT_COLUMNS[SHEET.ATTENDANCE] = [1, 2, 4];
TEXT_COLUMNS[SHEET.PERIODS] = [2, 3];
TEXT_COLUMNS[SHEET.EXTRA] = [2];
TEXT_COLUMNS[SHEET.NOTIFY] = [1];
TEXT_COLUMNS[SHEET.CONSENT] = [3];
TEXT_COLUMNS[SHEET.REQUESTS] = [1, 2, 9];

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
 * 種子資料（自動產生，請勿手動修改；改 data/items.csv、data/details.csv、docs/SPEC.md、docs/PRIVACY.md 後執行 npm run build）
 * 只供 setup() 第一次匯入；匯入後試算表才是唯一來源。
 */
var SEED = {
 "itemsCsv": "類別,級別或章名,大項或分類,項目內容\n進程,羚羊,－,能背誦並說明幼童軍諾言和規律之意義。\n進程,羚羊,－,能說出幼童軍級別、隊名，並加以介紹。\n進程,羚羊,－,能說出同隊幼童軍姓名並能自我介紹。\n進程,羚羊,－,能說出團部到家的路線，或團部地址。\n進程,羚羊,－,能說出團長或副團長其中1人的姓名。\n進程,羚羊,－,能說出幼童軍禮節（握手禮及舉手禮）的方法和含義。\n進程,羚羊,－,參加幼童軍團集會至少4次。\n進程,羚羊,－,聽叢林奇談故事2則以上，並參加跳叢林舞或演叢林劇至少1次。\n進程,羚羊,－,樂於接受尊長的引導，並能完成相關任務。\n進程,羚羊,－,能作幼童軍吼聲。\n進程,狼,國旗,能說出參與升降旗及聽到國歌與國旗歌時應有的禮節。\n進程,狼,國旗,能說出收藏以及保管國旗的方法。\n進程,狼,國旗,能識別5個以上國家的國旗。\n進程,狼,運動,會翻筋斗(前滾翻3次)。\n進程,狼,運動,能頂書行走(頭上放3本書)10公尺。\n進程,狼,運動,自己會搖呼啦圈5圈以上。\n進程,狼,運動,能連續跳繩前後各15次以上。\n進程,狼,運動,能一周從事「中度身體運動(會使心跳加速及流汗的運動)」3次以上。\n進程,狼,常識,能知道並遵守步行與搭乘大眾運輸系統的交通規則。\n進程,狼,常識,能遵守公共秩序。\n進程,狼,常識,能說出國家元首及居住地首長的名字。\n進程,狼,常識,能知道地震、火場等防災避難的掩護要領。\n進程,狼,常識,能辨別八方位。\n進程,狼,常識,能知道資源回收的分類方式。\n進程,狼,衛生,能自行準備沐浴用品，自行沐浴並穿好衣服。\n進程,狼,衛生,能注意自己身體與服裝的清潔整齊(包括口腔、指甲、頭髮、手腳、隨身衣物等)。\n進程,狼,衛生,能與家長共同討論訂定並遵守規律生活守則(包括起床、睡覺、寫作業、遊戲等)。\n進程,狼,衛生,能說出操作正確洗手的方法。\n進程,狼,衛生,能說出並實作身體流汗的處理方式。\n進程,狼,衛生,咳嗽或打噴嚏時，會用正確方式遮掩口鼻。\n進程,狼,服務,能打掃團部及家庭。\n進程,狼,服務,能協助大人照顧弟妹或其他幼小兒童，或是在團集會中協助其他夥伴。\n進程,狼,服務,能正確傳遞口訊(包括2件事情)而沒有差錯。\n進程,狼,勞作,工具認識：能知道小刀與剪刀的正確用法並正確傳遞。\n進程,狼,勞作,實作：能運用材料做動物模型至少2種。\n進程,狼,勞作,實作：會製作童玩1種。\n進程,狼,結繩,會打平結。\n進程,狼,結繩,能用平結紮小包裹。\n進程,狼,結繩,能在鞋子上或日常用品上打蝴蝶結。\n進程,狼,蒐集,能持續半年以上作任何一種有趣的蒐集工作，並能介紹內容與他人分享。\n進程,狼,閱讀,能運用各類圖書資源進行閱讀及資料蒐集。\n進程,狼,閱讀,能說出閱讀過的2本以上書籍之內容大意。\n進程,鹿,國旗,能演示國旗摺疊法。\n進程,鹿,國旗,能把國旗正確地繫在揚旗的旗桿上。\n進程,鹿,國旗,能說出升、降旗的方法。\n進程,鹿,運動,能連續踢毽子3次以上。\n進程,鹿,運動,能來回走平衡木或直線(長3公尺以上，寬10公分內)。\n進程,鹿,運動,能完成3種以上不同跳繩動作。\n進程,鹿,運動,能一周從事「中度身體運動(會使心跳加速及流汗的運動)3次以上，並累計100分鐘。\n進程,鹿,常識,會寫信、寄信，並能說出正確的郵資。\n進程,鹿,常識,能知道防溺的相關知識。\n進程,鹿,常識,能知道緊急事件發生時，撥打110、119及113保護專線等電話通報或求助的正確方法。\n進程,鹿,常識,能使用電腦、平板或手機等電子產品，利用關鍵字進行資料的搜尋。\n進程,鹿,常識,面對陌生人的詢問，能知道如何保護自己與正確應對。\n進程,鹿,常識,能愛護動物、植物和尊重生命，不任意殘害。\n進程,鹿,常識,維護環境衛生，在戶外活動後，能恢復環境整潔。\n進程,鹿,常識,能知道環境垃圾的來源以及其對生物的影響。\n進程,鹿,衛生,能說出小刀傷、擦傷等創傷處理方法。\n進程,鹿,衛生,會配合天氣變化適時增減衣物、穿著整齊，並妥善保管自己的衣物。\n進程,鹿,衛生,能知道空氣汙染指標顏色所代表的意義與查詢方式。\n進程,鹿,服務,曾在社區或公共場所自動整理環境或處理垃圾分類。\n進程,鹿,服務,能協助團長、副團長、服務員準備團集會會場或相關器材。\n進程,鹿,服務,能領導小隊遊戲或唱跳。\n進程,鹿,勞作,工具認識：能說出尖嘴鉗、老虎鉗與斜口鉗的不同用法與使用時的注意事項。\n進程,鹿,勞作,工具認識：能說出螺絲起子(一字及十字)、鑽子的用法與使用時的注意事項。\n進程,鹿,勞作,實作：能以編織方式製作2種手工藝品。\n進程,鹿,結繩,會打接繩結、稱人結。\n進程,鹿,結繩,能整理繩子並妥善保管。\n進程,鹿,儲蓄,能有儲蓄的習慣，並能訂定半年以上儲蓄目標及規劃金錢的運用方式，並在家長同意下執行計畫。\n進程,鹿,閱讀,閱讀完叢林奇談，並能自選3則故事，簡述其情節。\n進程,鹿,閱讀,能透過各種媒材資訊(讀報、書籍或多媒體)的閱讀，說出近期重要時事。\n進程,豹,國旗,能說出國旗所代表的意義，以及其圖案意涵。\n進程,豹,國旗,能依指揮節拍演唱國歌、國旗歌。\n進程,豹,運動,能仰臥起坐60秒內24下以上。(依教育部體適能常模公告調整）\n進程,豹,運動,能立定跳遠125公分以上。(依教育部體適能常模公告調整）\n進程,豹,運動,能爬竿、攀樹，或抱石攀岩體驗離地2公尺以上。(但最高不得離地3公尺)\n進程,豹,運動,能一周從事「中度身體運動(會使心跳加速及流汗的運動)」3次以上，並累計150分鐘。\n進程,豹,常識,能說出家用電器、瓦斯爐(含卡式爐)的使用方式與安全注意事項。\n進程,豹,常識,能說出緊急事件的處理方法，例如：火警、車輛肇事、鬥毆等報案。\n進程,豹,常識,能說出最近的緊急醫療機構與AED位置。\n進程,豹,常識,能說出物體的相對值(量感)，例如長短、大小、遠近、重量等。\n進程,豹,常識,參加集會時，能照「會議規範」發言，並參與討論。(施行重點：舉手發言等)\n進程,豹,常識,能認識台灣特有種生物3種以上，並了解外來種生物的危害。\n進程,豹,衛生,會使用各類體溫計測量體溫，並且知道測量脈搏的方法。\n進程,豹,衛生,能說出鼻出血、小燙傷、扭傷、骨折、中暑、腹瀉、嘔吐等常見急症的應對方法。\n進程,豹,衛生,能說出簡易急救包的內容和用法。\n進程,豹,服務,能閱讀大眾交通運輸工具時刻表或路線圖，並能指引他人搭乘。\n進程,豹,服務,能協助清理家中客廳或寢室，結果良好讓家長滿意。\n進程,豹,服務,能領導全團做遊戲或唱跳。\n進程,豹,服務,能參與服務性工作，例如：整潔服務、社區服務、慶典服務，集會服務等。\n進程,豹,服務,能接待客人，並能說出接聽電話的禮貌。\n進程,豹,勞作,工具認識：能知道鐵鎚及鋸子的正確用法與安全注意事項。\n進程,豹,勞作,實作：能利用各種素材做3種以上的玩具或日用品。\n進程,豹,勞作,實作：能製作簡易動、植物標本或攝影蒐集資料。\n進程,豹,結繩,會簡易繩頭處理。\n進程,豹,認識動、植物,能口述2種動物及植物的名稱、生態、習性、特性。\n進程,豹,閱讀,能閱讀5本以上課外讀物並有讀書心得紀錄。\n技能章,嚮導,服務類,能說出社區附近的名勝古蹟。\n技能章,嚮導,服務類,能說出縣（市）政府、鄉（鎮、市、區）公所、郵局、警察局、消防隊、醫院、車站等之所在地並能擔任嚮導。\n技能章,環保,服務類,能說出環境保護的意義。\n技能章,環保,服務類,曾參加跳蚤市場或義賣活動。\n技能章,環保,服務類,會利用廢物製作玩具或藝術創作。\n技能章,環保,服務類,能蒐集廢物製作遊戲器材。\n技能章,環保,服務類,能舉出3種以上化學物質污染環境的例子。\n技能章,交通安全,服務類,能說出交通安全的常識。\n技能章,交通安全,服務類,曾任學校導護生、糾察隊等相關工作，協助引導並維持上、放學路隊行進秩序與安全。\n技能章,交通安全,服務類,能說明10種以上交通標誌。\n技能章,表演,服務類,曾參加各類表演2項以上。\n技能章,表演,服務類,曾參加才藝表演2項以上。\n技能章,種植,服務類,能在果園或花盆播種。\n技能章,種植,服務類,會除草及除蟲害。\n技能章,種植,服務類,能移植花草。\n技能章,飼養,服務類,能說出6種以上飼養動物類之特徵和方法。\n技能章,飼養,服務類,能飼養1種以上的小動物，並能說出其習性及生長情形。\n技能章,勞作,服務類,曾參與自造教育體驗課程3種以上。\n技能章,勞作,服務類,能修護簡易日用品或玩具3種以上。\n技能章,義工,服務類,曾參加淨山、淨河、淨灘等活動。\n技能章,義工,服務類,曾義務擔任社區整潔工作。\n技能章,義工,服務類,曾擔任醫院、圖書館等服務工作。\n技能章,球類運動,健身類,會打兩種以上球類運動。\n技能章,球類運動,健身類,能說出3種球類比賽的計分方式。\n技能章,體適能運動,健身類,立定跳遠：依教育部體適能標準，能達到銅牌以上。\n技能章,體適能運動,健身類,仰臥起坐：依教育部體適能標準，能達到銅牌以上。\n技能章,體適能運動,健身類,八百公尺跑走：依教育部體適能標準，能達到銅牌以上。\n技能章,體適能運動,健身類,坐姿體前彎：依教育部體適能標準，能達到銅牌以上。\n技能章,民俗體育運動,健身類,自己能踩高蹺至少行走10公尺以上。\n技能章,民俗體育運動,健身類,能自己打陀螺，讓陀螺連續打轉30秒以上。\n技能章,民俗體育運動,健身類,能靈活操作鐵環，持續直線滾動達5公尺以上。\n技能章,游泳,健身類,依教育部全國中小學生游泳與自救能力基本指標，能達到第五級標準。\n技能章,游泳,健身類,能說出游泳前、後的一般常識，並能潛水10秒鐘。\n技能章,自行車,健身類,能騎自行車，並能擦車、上油。\n技能章,自行車,健身類,能以正確姿勢上、下車。\n技能章,自行車,健身類,能連續騎自行車一公里以上。\n技能章,自行車,健身類,能調整適合自己騎乘的坐椅高度，及為自行車打氣。\n技能章,旅行,健身類,能說出旅行的一般知識。\n技能章,旅行,健身類,能以口頭報告旅行的全部行程。\n技能章,旅行,健身類,在旅行活動中能說出地區鄉土自然生態與人文環境，並作成簡單紀錄。\n技能章,休閒活動,健身類,能主持休閒活動遊戲5種以上。\n技能章,休閒活動,健身類,能領導唱和跳歌曲3首以上。\n技能章,舞蹈,健身類,能作基本舞步6種。\n技能章,舞蹈,健身類,能跳完兩支以上的舞蹈。\n技能章,體操,健身類,有領導做健身操的能力及經驗。\n技能章,體操,健身類,能做單槓、跳箱、墊上運動一項以上。\n技能章,繪畫,技巧類,能素描或寫生。\n技能章,繪畫,技巧類,能畫出3幅以上的一套漫畫。\n技能章,音樂,技巧類,能讀五線譜。\n技能章,音樂,技巧類,能用一種樂器演奏3首以上之曲子。\n技能章,音樂,技巧類,能辨識5種以上樂器的音色。\n技能章,模型,技巧類,能作手工藝品兩種以上。\n技能章,模型,技巧類,能作動物、房屋或其它模型。\n技能章,口技,技巧類,能學5種以上的動物叫聲。\n技能章,書法,技巧類,能正確說出「永」字八法。\n技能章,書法,技巧類,能用毛筆臨帖一種，其結構筆畫正確。\n技能章,歌詠,技巧類,發聲正確。\n技能章,歌詠,技巧類,能唱幼童軍歌曲及一般歌曲各5首。\n技能章,收集,技巧類,曾收集任何同一類之物品（如郵票、錢幣、火柴盒、紀念章等）50種以上，並略加說明。\n技能章,資訊,技巧類,能使用網路蒐集有關資料並列印。\n技能章,資訊,技巧類,會使用電子郵件及其它通訊APP軟體。\n技能章,資訊,技巧類,會使用手機查閱地圖、天氣、交通等生活資訊。\n技能章,資訊,技巧類,會使用各類型文書處理軟體3種以上。\n技能章,語文,技巧類,會作3分鐘即席演講。\n技能章,語文,技巧類,會說一種母語（閩南語、客家語、原住民語），並簡述一則故事。\n技能章,語文,技巧類,會一種外國語言，並能作簡單交談。\n",
 "detailsCsv": "項目ID,分組,細項內容,通過標準,生活應用\nP-剛入團-1,背誦與了解諾言規律,能完整背出諾言,不看稿背誦＋口述舉例,在家貼一張規律，每週自評一條\nP-剛入團-1,背誦與了解諾言規律,能完整背出規律,,\nP-剛入團-1,背誦與了解諾言規律,能用自己的話說出一條規律的意思,,\nP-剛入團-1,背誦與了解諾言規律,舉一個自己做到規律的實例,,\nP-剛入團-2,知道團長、副團長、服務員姓名,能叫出團長全名,隨機指認3位服務員,遇到大人主動問好\nP-剛入團-2,知道團長、副團長、服務員姓名,能叫出副團長與各服務員姓名,,\nP-剛入團-2,知道團長、副團長、服務員姓名,見面時主動打招呼,,\nP-剛入團-2,知道團長、副團長、服務員姓名,知道遇到問題該找誰,,\nP-剛入團-3,知道舉手禮與握手禮及意義,能做出正確舉手禮（三指）,現場示範並說明,團集會見到服務員主動行禮\nP-剛入團-3,知道舉手禮與握手禮及意義,知道三指代表諾言三條,,\nP-剛入團-3,知道舉手禮與握手禮及意義,能做左手握手禮,,\nP-剛入團-3,知道舉手禮與握手禮及意義,知道為什麼用左手,,\nP-剛入團-4,知道同隊幼童軍姓名,能叫出同小隊每個人的名字,現場點名指認,主動邀約隊友一起做事\nP-剛入團-4,知道同隊幼童軍姓名,能說出小隊名稱,,\nP-剛入團-4,知道同隊幼童軍姓名,知道誰是小隊長,,\nP-剛入團-4,知道同隊幼童軍姓名,能說出一位隊友的一個優點,,\nP-剛入團-5,能向大家自我介紹,能說出姓名、學校、年級,全團面前完成一次,在學校或新環境主動自我介紹一次\nP-剛入團-5,能向大家自我介紹,能說出一項自己喜歡的事,,\nP-剛入團-5,能向大家自我介紹,音量能讓最後一排聽到,,\nP-剛入團-5,能向大家自我介紹,眼睛能看著大家,,\nP-羚羊-2,知道自己小隊名稱、隊呼與隊員職務,能說出每位隊員擔任的工作,口述＋帶一次隊呼,\nP-羚羊-2,知道自己小隊名稱、隊呼與隊員職務,知道自己的工作是什麼,,\nP-羚羊-4,知道如何搭乘大眾交通工具到團部,能說出要搭哪一線公車或捷運,口述完整路線,家長陪同下實際搭一次，由孩子主導\nP-羚羊-4,知道如何搭乘大眾交通工具到團部,能說出在哪一站上下車,,\nP-羚羊-4,知道如何搭乘大眾交通工具到團部,知道要準備多少車資或悠遊卡,,\nP-羚羊-4,知道如何搭乘大眾交通工具到團部,知道坐過站時該怎麼辦,,\nP-羚羊-8,聽叢林奇談故事兩則以上,能說出兩則故事的名稱,口述,回家把其中一則講給家人聽\nP-羚羊-8,聽叢林奇談故事兩則以上,能說出一個動物角色的特點,,\nP-羚羊-8,聽叢林奇談故事兩則以上,能說出自己最喜歡哪一段,,\nP-羚羊-8,參加語唱跳叢林歌曲2首,能完整跟唱2首,現場演出,在家教家人唱一首\nP-羚羊-8,參加語唱跳叢林歌曲2首,能做出對應動作,,\nP-羚羊-8,參加語唱跳叢林歌曲2首,能在小隊前帶唱其中一段副歌,,\nP-羚羊-8,演過叢林劇一次,分配到角色並記住台詞,演出完成,\nP-羚羊-8,演過叢林劇一次,完成排練不缺席,,\nP-羚羊-8,演過叢林劇一次,正式演出完成,,\nP-羚羊-8,演過叢林劇一次,能說出自己演的角色個性,,\nP-羚羊-9,完成小隊交付任務一次並正確回報,聽完任務能複述一次確認,服務員紀錄一次完整循環,完成一件家務並主動回報家長\nP-羚羊-9,完成小隊交付任務一次並正確回報,在時限內完成,,\nP-羚羊-9,完成小隊交付任務一次並正確回報,主動回報結果,,\nP-羚羊-9,完成小隊交付任務一次並正確回報,沒完成時能說明原因而不隱瞞,,\nP-羚羊-10,能操作幼童軍吼聲,記得吼聲的詞與動作,單獨示範一次,\nP-羚羊-10,能操作幼童軍吼聲,能跟全團一起完成,,\nP-羚羊-10,能操作幼童軍吼聲,能獨自完成一次,,\nP-羚羊-10,能操作幼童軍吼聲,知道吼聲在什麼時機使用,,\nP-羚羊-10,了解幼童軍吼聲的意義,能說出吼聲代表對阿克拉的敬意,口述,\nP-羚羊-10,了解幼童軍吼聲的意義,知道吼聲代表全團的回應與服從,,\nP-羚羊-10,了解幼童軍吼聲的意義,能說出吼聲與叢林奇談的關聯,,\nP-狼-國旗-1,知道對國旗的禮節,看到國旗升降能立正並面向國旗,團集會升旗連續3次自動做到，不需提醒,學校升旗時同樣做到，由導師或家長確認\nP-狼-國旗-1,知道對國旗的禮節,能做出正確的注目禮,,\nP-狼-國旗-1,知道對國旗的禮節,知道國旗不可觸地、不可當桌布或包裹物,,\nP-狼-國旗-1,知道對國旗的禮節,國歌唱完前不走動,,\nP-狼-國旗-3,辨識5個國家以上的國旗,能認出中華民國國旗,圖卡辨識5面,看國際賽事時認出3面國旗\nP-狼-國旗-3,辨識5個國家以上的國旗,能認出5國以上國旗,,\nP-狼-國旗-3,辨識5個國家以上的國旗,能說出其中一面國旗的特徵,,\nP-狼-國旗-3,辨識5個國家以上的國旗,不混淆相似國旗（如印尼與波蘭）,,\nP-狼-運動-2,頂書行走10公尺,能頂書站立5秒不掉,一次連續完成10公尺,端水杯走路不灑出來\nP-狼-運動-2,頂書行走10公尺,能頂書走3公尺,,\nP-狼-運動-2,頂書行走10公尺,能頂書走完10公尺,,\nP-狼-運動-2,頂書行走10公尺,掉了能自己撿起重來不放棄,,\nP-狼-運動-4,連續跳繩15次,能正確握繩與甩繩,一次連續15下,每週在家跳3次，家長紀錄\nP-狼-運動-4,連續跳繩15次,能連續跳5次,,\nP-狼-運動-4,連續跳繩15次,能連續跳15次不中斷,,\nP-狼-運動-4,連續跳繩15次,中斷後能自己重來,,\nP-狼-運動-5,了解熱身與運動安全的意義,能說出為什麼要熱身,現場示範3個動作並口述理由,上體育課前自己先做一次熱身\nP-狼-運動-5,了解熱身與運動安全的意義,能做出3個熱身動作（頸、肩、腿）,,\nP-狼-運動-5,了解熱身與運動安全的意義,能說出運動前要檢查的3件事（鞋帶、場地、水）,,\nP-狼-運動-5,了解熱身與運動安全的意義,不舒服時會立刻停下並告訴大人,,\nP-狼-常識-1,了解與遵守步行、乘車的交通規則,能說出紅黃綠燈的意思,團活動外出時全程自動遵守,上下學路上做到，家長觀察一週\nP-狼-常識-1,了解與遵守步行、乘車的交通規則,過馬路走斑馬線並先左右看,,\nP-狼-常識-1,了解與遵守步行、乘車的交通規則,知道乘車要繫安全帶,,\nP-狼-常識-1,了解與遵守步行、乘車的交通規則,下車前先看後方有無來車,,\nP-狼-常識-5,地圖辨識,能在地圖上找到自己家與學校,在紙本地圖上實際指出,出遊時幫家人看一次地圖\nP-狼-常識-5,地圖辨識,知道地圖上北下南,,\nP-狼-常識-5,地圖辨識,能看懂3種常見圖示,,\nP-狼-常識-5,地圖辨識,會看指北針,,\nP-狼-常識-5,辨識方位（使用指北針）,知道指北針紅針指北,戶外實測,能說出自己房間窗戶朝哪個方向\nP-狼-常識-5,辨識方位（使用指北針）,能找出東西南北四方位,,\nP-狼-常識-5,辨識方位（使用指北針）,能說出團部大門朝哪個方向,,\nP-狼-常識-5,辨識方位（使用指北針）,能在戶外定出方位,,\nP-狼-衛生-1,能自行沐浴,能自己調水溫,家長簽名連續一個月,家長不進浴室協助\nP-狼-衛生-1,能自行沐浴,能洗到背部與耳後,,\nP-狼-衛生-1,能自行沐浴,能自己沖乾淨並擦乾,,\nP-狼-衛生-1,能自行沐浴,能收拾浴室不留積水,,\nP-狼-衛生-2,能注意自己身體清潔,每天刷牙兩次,團集會抽查4次,家長紀錄卡一個月\nP-狼-衛生-2,能注意自己身體清潔,飯前洗手,,\nP-狼-衛生-2,能注意自己身體清潔,指甲定期修剪,,\nP-狼-衛生-2,能注意自己身體清潔,頭髮整齊,,\nP-狼-衛生-2,隨身攜帶手帕、衛生紙,知道為什麼要帶,隨機抽查4次全過,上學也隨身攜帶，家長確認\nP-狼-衛生-2,隨身攜帶手帕、衛生紙,知道用完要放哪裡、不亂丟,,\nP-狼-衛生-2,隨身攜帶手帕、衛生紙,連續4次抽查都有帶,,\nP-狼-衛生-2,隨身攜帶手帕、衛生紙,手帕保持乾淨並定期換洗,,\nP-狼-衛生-3,按時起床、睡覺、生活有規律,自己設鬧鐘起床,作息紀錄卡兩週,家長只確認不催促\nP-狼-衛生-3,按時起床、睡覺、生活有規律,固定時間就寢,,\nP-狼-衛生-3,按時起床、睡覺、生活有規律,睡前不使用3C,,\nP-狼-衛生-3,按時起床、睡覺、生活有規律,連續兩週有紀錄,,\nP-狼-衛生-5,流汗會徹底擦乾,知道濕衣服不擦會著涼,活動時觀察,體育課後自己處理\nP-狼-衛生-5,流汗會徹底擦乾,隨身帶毛巾或替換衣,,\nP-狼-衛生-5,流汗會徹底擦乾,運動後主動擦乾,,\nP-狼-衛生-5,流汗會徹底擦乾,主動換下濕衣服,,\nP-狼-服務-1,打掃團部2次,知道自己負責的區域,兩次完成紀錄,負責家中一項固定家務\nP-狼-服務-1,打掃團部2次,能正確使用掃具,,\nP-狼-服務-1,打掃團部2次,完成後自己檢查一次,,\nP-狼-服務-1,打掃團部2次,掃具歸位,,\nP-狼-服務-2,能協助新進幼童軍適應團生活,認養一位新進,以新進的表現為驗收,在學校主動照顧轉學生\nP-狼-服務-2,能協助新進幼童軍適應團生活,帶他認識團部與服務員,,\nP-狼-服務-2,能協助新進幼童軍適應團生活,教他一項基本技能,,\nP-狼-服務-2,能協助新進幼童軍適應團生活,兩個月後新進能獨立參加集會,,\nP-狼-服務-3,能傳遞口訊並沒有錯誤,聽完能複述確認,三次傳訊零錯誤,幫家人傳一次完整口訊\nP-狼-服務-3,能傳遞口訊並沒有錯誤,能記住人、事、時、地,,\nP-狼-服務-3,能傳遞口訊並沒有錯誤,正確傳達給對方,,\nP-狼-服務-3,能傳遞口訊並沒有錯誤,回報已完成,,\nP-狼-勞作-1,知道小剪刀的正確用法,傳遞時刀口朝自己、握把朝對方,現場操作,在家幫忙剪一次東西\nP-狼-勞作-1,知道小剪刀的正確用法,能沿直線剪10公分不歪,,\nP-狼-勞作-1,知道小剪刀的正確用法,能沿曲線剪出一個圓,,\nP-狼-勞作-1,知道小剪刀的正確用法,用完歸位並確認刀口閉合,,\nP-狼-勞作-2,能用黏土做動物模型兩種,能說出要做哪兩種動物,成品展示,送給家人並說明\nP-狼-勞作-2,能用黏土做動物模型兩種,捏出可辨識的外型,,\nP-狼-勞作-2,能用黏土做動物模型兩種,做出特徵（耳朵、尾巴等）,,\nP-狼-勞作-2,能用黏土做動物模型兩種,能站立不倒,,\nP-狼-勞作-3,製作簡易風箏,能照圖裁出骨架,成功放飛,帶家人去放一次\nP-狼-勞作-3,製作簡易風箏,能貼合面材不破,,\nP-狼-勞作-3,製作簡易風箏,能綁上提線,,\nP-狼-勞作-3,製作簡易風箏,能實際放上天,,\nP-狼-結繩-1,會打平結,能打出正確平結,30秒內打好並解開,用平結綁一次垃圾袋或包裹\nP-狼-結繩-1,會打平結,能分辨平結與死結的差別,,\nP-狼-結繩-1,會打平結,能自己解開,,\nP-狼-結繩-1,會打平結,能應用平結,,\nP-狼-結繩-2,能用平結打小包裹,能把繩繞過包裹兩個方向,提起晃動不散,在家綁一次包裹或回收紙箱\nP-狼-結繩-2,能用平結打小包裹,打出正確平結,,\nP-狼-結繩-2,能用平結打小包裹,繩結位在包裹正中,,\nP-狼-結繩-2,能用平結打小包裹,提起晃動不散開,,\nP-狼-結繩-3,能在鞋子上面打蝴蝶結,能自己穿好鞋帶,實作,不再請家長綁鞋帶\nP-狼-結繩-3,能在鞋子上面打蝴蝶結,打出對稱的蝴蝶結,,\nP-狼-結繩-3,能在鞋子上面打蝴蝶結,鬆緊適中不夾腳,,\nP-狼-結繩-3,能在鞋子上面打蝴蝶結,走動10分鐘不鬆開,,\nP-狼-蒐集-1,蒐集並保存自己喜歡的物品5件以上,能說出自己蒐集的是什麼,實物展示,自己整理與保管，不由家長代收\nP-狼-蒐集-1,蒐集並保存自己喜歡的物品5件以上,蒐集滿5件,,\nP-狼-蒐集-1,蒐集並保存自己喜歡的物品5件以上,有固定存放的地方,,\nP-狼-蒐集-1,蒐集並保存自己喜歡的物品5件以上,能說出最喜歡哪一件、為什麼,,\nP-狼-蒐集-1,從事任何一種有趣的蒐集工作,能說出蒐集主題,實物與紀錄,自行保管，不由家長代管\nP-狼-蒐集-1,從事任何一種有趣的蒐集工作,持續蒐集滿三個月,,\nP-狼-蒐集-1,從事任何一種有趣的蒐集工作,累積10件以上,,\nP-狼-蒐集-1,從事任何一種有趣的蒐集工作,有自己的存放方式,,\nP-狼-閱讀-1,讀一本書並能複述大意,專心聽完一本書,口述，允許不完整,養成睡前親子共讀\nP-狼-閱讀-1,讀一本書並能複述大意,能說出主角是誰,,\nP-狼-閱讀-1,讀一本書並能複述大意,能說出發生了什麼事,,\nP-狼-閱讀-1,讀一本書並能複述大意,能說出結局,,\nP-狼-閱讀-2,閱讀至少2本課外讀物,自己選書,閱讀紀錄卡,辦一張圖書館借書證並自己借書\nP-狼-閱讀-2,閱讀至少2本課外讀物,讀完全本,,\nP-狼-閱讀-2,閱讀至少2本課外讀物,能說出書名與作者,,\nP-狼-閱讀-2,閱讀至少2本課外讀物,能說出大意,,\nP-狼-閱讀-2,會講閱讀過的故事一則,能有頭有尾說完,小隊前口述,講給弟妹或家人聽\nP-狼-閱讀-2,會講閱讀過的故事一則,能說出主角,,\nP-狼-閱讀-2,會講閱讀過的故事一則,音量足夠,,\nP-狼-閱讀-2,會講閱讀過的故事一則,三分鐘內講完,,\nP-鹿-國旗-1,知道國旗的折疊法,折疊時旗面不觸地,兩人合作實作,\nP-鹿-國旗-1,知道國旗的折疊法,能與人合作完成折疊,,\nP-鹿-國旗-1,知道國旗的折疊法,折好後青天白日在外,,\nP-鹿-國旗-1,知道國旗的折疊法,能收進旗袋,,\nP-鹿-國旗-2,把國旗正確地縛在旗桿上,知道旗面的上下與正反,實作一次,\nP-鹿-國旗-2,把國旗正確地縛在旗桿上,能綁緊不鬆脫,,\nP-鹿-國旗-2,把國旗正確地縛在旗桿上,升起後不纏繞,,\nP-鹿-國旗-2,把國旗正確地縛在旗桿上,綁錯能自己發現並重綁,,\nP-鹿-國旗-3,知道升降旗的方法,知道升旗快、降旗慢,實作一次,\nP-鹿-國旗-3,知道升降旗的方法,能配合國歌節奏,,\nP-鹿-國旗-3,知道升降旗的方法,知道降半旗的時機,,\nP-鹿-國旗-3,知道升降旗的方法,能處理繩子打結,,\nP-鹿-國旗-3,能擔任團集會旗手一次,全程動作正確,實際擔任一次,在學校擔任一次旗手\nP-鹿-國旗-3,能擔任團集會旗手一次,與司儀口令配合,,\nP-鹿-國旗-3,能擔任團集會旗手一次,不需旁人提醒,,\nP-鹿-國旗-3,能擔任團集會旗手一次,事後能說出一個可以更好的地方,,\nP-鹿-運動-1,踢毽子連續五次,能單腳站穩,連續5下,下課時間找同學一起踢\nP-鹿-運動-1,踢毽子連續五次,能踢中3次,,\nP-鹿-運動-1,踢毽子連續五次,能連續5次,,\nP-鹿-運動-1,踢毽子連續五次,能自己撿起重踢不氣餒,,\nP-鹿-運動-2,成功走繩一次,能站上繩不扶,走完全段,\nP-鹿-運動-2,成功走繩一次,能走3步,,\nP-鹿-運動-2,成功走繩一次,能走完全段,,\nP-鹿-運動-2,成功走繩一次,掉下後能重來至少3次,,\nP-鹿-常識-1,能寫信與辨識郵票,能寫出正確的信封格式,實際寄出並收到回信,寄一封信給家人或朋友\nP-鹿-常識-1,能寫信與辨識郵票,知道郵票貼右上角,,\nP-鹿-常識-1,能寫信與辨識郵票,知道平信與掛號的差別,,\nP-鹿-常識-1,能寫信與辨識郵票,完成寄出一封信,,\nP-鹿-常識-5,能處理陌生人的探詢與訪問,不透露家中地址與家長上班時間,情境演練,與家長約定一組通關密語\nP-鹿-常識-5,能處理陌生人的探詢與訪問,知道不單獨跟陌生人走,,\nP-鹿-常識-5,能處理陌生人的探詢與訪問,能說出「我要先問我爸媽」,,\nP-鹿-常識-5,能處理陌生人的探詢與訪問,能完成一次拒絕演練,,\nP-鹿-常識-6,知道愛護動植物,知道不隨意攀折與捕捉,口述＋一次行動,在家照顧一盆植物或一隻寵物滿一個月\nP-鹿-常識-6,知道愛護動植物,能說出一種保育類動物,,\nP-鹿-常識-6,知道愛護動植物,知道不隨意餵食流浪動物的理由,,\nP-鹿-常識-6,知道愛護動植物,完成一次實際照顧行動,,\nP-鹿-常識-7,維護環境衛生,垃圾分類正確,服務員觀察,負責家中一個區域的整潔滿一個月\nP-鹿-常識-7,維護環境衛生,用完的東西歸位,,\nP-鹿-常識-7,維護環境衛生,主動撿起地上垃圾,,\nP-鹿-常識-7,維護環境衛生,完成一次團部清潔,,\nP-鹿-衛生-1,知道小刀傷的急救法,知道先壓迫止血,情境演練,\nP-鹿-衛生-1,知道小刀傷的急救法,知道用清水沖洗,,\nP-鹿-衛生-1,知道小刀傷的急救法,知道正確包紮方式,,\nP-鹿-衛生-1,知道小刀傷的急救法,知道什麼情況要就醫,,\nP-鹿-衛生-2,穿著整齊並照料自己的日常衣物,能自己整理制服與領巾,制服檢查4次,家長不代為準備隔天衣物\nP-鹿-衛生-2,穿著整齊並照料自己的日常衣物,能摺好自己的衣服,,\nP-鹿-衛生-2,穿著整齊並照料自己的日常衣物,髒衣服主動放洗衣籃,,\nP-鹿-衛生-2,穿著整齊並照料自己的日常衣物,能自己準備隔天要穿的衣服,,\nP-鹿-服務-2,準備團集會會場,知道桌椅擺放方式,完整負責一次,布置一次家庭聚餐場地\nP-鹿-服務-2,準備團集會會場,提前到場,,\nP-鹿-服務-2,準備團集會會場,檢查器材是否齊全,,\nP-鹿-服務-2,準備團集會會場,集會後恢復原狀,,\nP-鹿-服務-3,領導小隊進行遊戲,能說明規則讓大家聽懂,實際帶一次,帶弟妹或表親玩一次遊戲\nP-鹿-服務-3,領導小隊進行遊戲,能處理有人不遵守,,\nP-鹿-服務-3,領導小隊進行遊戲,讓每個人都玩到,,\nP-鹿-服務-3,領導小隊進行遊戲,能準時結束,,\nP-鹿-服務-3,帶小狼歌曲,自己先唱熟,實際帶一次,\nP-鹿-服務-3,帶小狼歌曲,能起音,,\nP-鹿-服務-3,帶小狼歌曲,能帶動作,,\nP-鹿-服務-3,帶小狼歌曲,能讓全隊跟上,,\nP-鹿-勞作-3,會編織或縫紉,能穿線打結,實作,自己縫回一顆掉落的鈕扣\nP-鹿-勞作-3,會編織或縫紉,能縫直線10公分,,\nP-鹿-勞作-3,會編織或縫紉,能縫上一顆鈕扣,,\nP-鹿-勞作-3,會編織或縫紉,能收尾打結不鬆脫,,\nP-鹿-結繩-1,會打接繩結,知道接繩結用來接兩條不同粗細的繩,拉力測試,\nP-鹿-結繩-1,會打接繩結,能打出正確結型,,\nP-鹿-結繩-1,會打接繩結,能承受拉力不滑脫,,\nP-鹿-結繩-1,會打接繩結,能自己解開,,\nP-鹿-結繩-1,會打稱人結,知道稱人結是不會收緊的活套,30秒完成,\nP-鹿-結繩-1,會打稱人結,能在30秒內打好,,\nP-鹿-結繩-1,會打稱人結,套在身上大小適中,,\nP-鹿-結繩-1,會打稱人結,能練習單手打法一次,,\nP-鹿-結繩-2,會收繩,能理順不打結,實作,負責活動後的收繩工作\nP-鹿-結繩-2,會收繩,能盤繞整齊,,\nP-鹿-結繩-2,會收繩,能綁繩尾固定,,\nP-鹿-結繩-2,會收繩,收好後下次能一拉即開,,\nP-鹿-儲蓄-1,了解與說明儲蓄的意義,能說出為什麼要存錢,紀錄卡,存到目標金額並自己買下想要的東西\nP-鹿-儲蓄-1,了解與說明儲蓄的意義,有自己的存錢筒或帳戶,,\nP-鹿-儲蓄-1,了解與說明儲蓄的意義,能說出一個想存錢達成的目標,,\nP-鹿-儲蓄-1,了解與說明儲蓄的意義,連續一個月有存入紀錄,,\nP-鹿-閱讀-1,閱讀完叢林奇談上下冊,讀完上冊,口述,\nP-鹿-閱讀-1,閱讀完叢林奇談上下冊,讀完下冊,,\nP-鹿-閱讀-1,閱讀完叢林奇談上下冊,能說出三個主要角色,,\nP-鹿-閱讀-1,閱讀完叢林奇談上下冊,能說出毛克利最後的選擇,,\nP-鹿-閱讀-1,能說出叢林奇談中一個角色帶給自己的啟發,選定一個角色,口述,\nP-鹿-閱讀-1,能說出叢林奇談中一個角色帶給自己的啟發,說出這個角色做了什麼,,\nP-鹿-閱讀-1,能說出叢林奇談中一個角色帶給自己的啟發,說出自己學到什麼,,\nP-鹿-閱讀-1,能說出叢林奇談中一個角色帶給自己的啟發,說出自己想改變什麼,,\nP-鹿-閱讀-1,會講閱讀過的故事2則,兩則來自不同的書,全團前口述,\nP-鹿-閱讀-1,會講閱讀過的故事2則,能不看稿講完,,\nP-鹿-閱讀-1,會講閱讀過的故事2則,能加上自己的表情動作,,\nP-鹿-閱讀-1,會講閱讀過的故事2則,能回答一個聽眾提問,,\nP-豹-國旗-1,知道國旗的含意,能說出青天、白日、滿地紅各代表什麼,對低級別講解一次,\nP-豹-國旗-1,知道國旗的含意,能說出十二道光芒的意義,,\nP-豹-國旗-1,知道國旗的含意,能說出設計者,,\nP-豹-國旗-1,知道國旗的含意,能對羚羊級講解一次,,\nP-豹-國旗-1,了解畫國徽的方法,知道國徽與國旗的差別,現場繪製,\nP-豹-國旗-1,了解畫國徽的方法,能畫出十二道光芒,,\nP-豹-國旗-1,了解畫國徽的方法,比例大致正確,,\nP-豹-國旗-1,了解畫國徽的方法,能說出國徽用在哪些地方,,\nP-豹-運動-1,伏地挺身、引體向上、仰臥起坐,三項動作姿勢正確,三項達標,在家維持每週練習，紀錄卡\nP-豹-運動-1,伏地挺身、引體向上、仰臥起坐,各達本團設定次數,,\nP-豹-運動-1,伏地挺身、引體向上、仰臥起坐,知道錯誤姿勢會傷到哪裡,,\nP-豹-運動-1,伏地挺身、引體向上、仰臥起坐,能自己安排一週的練習,,\nP-豹-運動-2,立定跳遠,知道正確起跳姿勢,三次取最佳,學校體適能測驗\nP-豹-運動-2,立定跳遠,能擺臂助力,,\nP-豹-運動-2,立定跳遠,落地能站穩不跌,,\nP-豹-運動-2,立定跳遠,達到本團設定距離,,\nP-豹-運動-3,能完成樹攀或攀岩,知道確保裝備怎麼穿,完攀或誠實喊停皆算通過,\nP-豹-運動-3,能完成樹攀或攀岩,完成一次攀登,,\nP-豹-運動-3,能完成樹攀或攀岩,過程中能回應確保者,,\nP-豹-運動-3,能完成樹攀或攀岩,害怕時能說出來而不硬撐,,\nP-豹-常識-1,了解電氣、瓦斯安全的常識,知道不可濕手拔插頭,口述＋在家指出位置,帶家人檢查一次家中延長線\nP-豹-常識-1,了解電氣、瓦斯安全的常識,知道延長線不可超載,,\nP-豹-常識-1,了解電氣、瓦斯安全的常識,知道聞到瓦斯味先開窗不開電器,,\nP-豹-常識-1,了解電氣、瓦斯安全的常識,知道家中總開關與瓦斯開關位置,,\nP-豹-常識-2,知道緊急事件的處置方式,能說出110／119／113的用途,模擬報案演練,與家人約定一個緊急集合地點\nP-豹-常識-2,知道緊急事件的處置方式,能完整報出地址與狀況,,\nP-豹-常識-2,知道緊急事件的處置方式,知道地震先躲桌下,,\nP-豹-常識-2,知道緊急事件的處置方式,知道火災要低姿勢逃生、不搭電梯,,\nP-豹-常識-3,知道附近的警察局、郵局、醫療機構與學校所在地,能說出警察局在哪條路,口述＋地圖標示,帶家人走一次到最近的警察局\nP-豹-常識-3,知道附近的警察局、郵局、醫療機構與學校所在地,能說出最近的診所或醫院名稱,,\nP-豹-常識-3,知道附近的警察局、郵局、醫療機構與學校所在地,能說出郵局位置,,\nP-豹-常識-3,知道附近的警察局、郵局、醫療機構與學校所在地,能在地圖上標出這四個地點,,\nP-豹-常識-4,估測長短、大小、遠近、輕重（永備尺）,知道自己一步的長度,三次估測後實測驗證,不用尺估出自己房間大小再實測\nP-豹-常識-4,估測長短、大小、遠近、輕重（永備尺）,知道自己手掌張開的寬度,,\nP-豹-常識-4,估測長短、大小、遠近、輕重（永備尺）,估測10公尺誤差在2公尺內,,\nP-豹-常識-4,估測長短、大小、遠近、輕重（永備尺）,能估測物體重量在合理誤差內,,\nP-豹-常識-5,按會議規範發言並參與討論,發言前先舉手,服務員觀察一次完整會議,班會或家庭會議做到\nP-豹-常識-5,按會議規範發言並參與討論,不打斷別人,,\nP-豹-常識-5,按會議規範發言並參與討論,針對議題而非針對人,,\nP-豹-常識-5,按會議規範發言並參與討論,能提出一個具體提案,,\nP-豹-衛生-1,知道量體溫與脈搏的方法,能正確使用體溫計,實作測量,家人不舒服時能協助量測\nP-豹-衛生-1,知道量體溫與脈搏的方法,知道正常體溫範圍,,\nP-豹-衛生-1,知道量體溫與脈搏的方法,能在手腕或頸部找到脈搏,,\nP-豹-衛生-1,知道量體溫與脈搏的方法,能數出一分鐘脈搏次數,,\nP-豹-衛生-2,知道鼻出血、小燙傷、扭傷、骨折、中暑、中毒的急救法,六種狀況各能說出處置步驟,抽卡演練,\nP-豹-衛生-2,知道鼻出血、小燙傷、扭傷、骨折、中暑、中毒的急救法,能說出三個常見的錯誤做法,,\nP-豹-衛生-2,知道鼻出血、小燙傷、扭傷、骨折、中暑、中毒的急救法,抽卡演練其中兩種,,\nP-豹-衛生-2,知道鼻出血、小燙傷、扭傷、骨折、中暑、中毒的急救法,知道何時該打119,,\nP-豹-衛生-2,能為他人做簡單傷口處理並口述步驟,先確認自身安全並洗手,對同伴實作一次,\nP-豹-衛生-2,能為他人做簡單傷口處理並口述步驟,清洗傷口,,\nP-豹-衛生-2,能為他人做簡單傷口處理並口述步驟,正確包紮,,\nP-豹-衛生-2,能為他人做簡單傷口處理並口述步驟,全程向對方說明在做什麼,,\nP-豹-衛生-3,能檢查並補齊團部急救包一次,對照清單清點,清點表繳回,檢查家中急救箱\nP-豹-衛生-3,能檢查並補齊團部急救包一次,找出過期品,,\nP-豹-衛生-3,能檢查並補齊團部急救包一次,列出補充清單,,\nP-豹-衛生-3,能檢查並補齊團部急救包一次,完成補齊並回報,,\nP-豹-衛生-3,知道五種以上日常外用藥品的名稱與用法,能說出五種藥品名稱與用途,實物指認,協助整理家中藥箱一次\nP-豹-衛生-3,知道五種以上日常外用藥品的名稱與用法,知道要看有效期限,,\nP-豹-衛生-3,知道五種以上日常外用藥品的名稱與用法,知道外用不可內服,,\nP-豹-衛生-3,知道五種以上日常外用藥品的名稱與用法,知道用藥前要先問大人,,\nP-豹-服務-1,能嚮導,事前熟悉路線與環境,實際帶一次外賓或新生,帶親友參觀一次自己的學校\nP-豹-服務-1,能嚮導,能邊走邊解說,,\nP-豹-服務-1,能嚮導,能回答提問,,\nP-豹-服務-1,能嚮導,全程照顧到最慢的人,,\nP-豹-服務-1,能在真實路線上為小隊帶路一次,事前看過地圖並規劃路線,實走一次,帶家人走一段自己規劃的路\nP-豹-服務-1,能在真實路線上為小隊帶路一次,全程不由大人指正,,\nP-豹-服務-1,能在真實路線上為小隊帶路一次,走錯能自己修正,,\nP-豹-服務-1,能在真實路線上為小隊帶路一次,準時抵達,,\nP-豹-服務-3,帶領全團進行遊戲,選擇適合全團的遊戲,實際帶一次,\nP-豹-服務-3,帶領全團進行遊戲,規則說明清楚,,\nP-豹-服務-3,帶領全團進行遊戲,能控制場面,,\nP-豹-服務-3,帶領全團進行遊戲,能臨時調整規則,,\nP-豹-服務-4,獨立完成一次對外服務並向全團報告,自己找出服務對象,提案、執行、簡報三段完整,服務對象需在團外\nP-豹-服務-4,獨立完成一次對外服務並向全團報告,事前聯繫與確認,,\nP-豹-服務-4,獨立完成一次對外服務並向全團報告,執行完成,,\nP-豹-服務-4,獨立完成一次對外服務並向全團報告,向全團簡報並含檢討,,\nP-豹-服務-4,獨立規劃並執行一次服務行動,自己找出一個需要,提案、執行、回報三段完整,服務對象需在團外\nP-豹-服務-4,獨立規劃並執行一次服務行動,說明為什麼是這件事,,\nP-豹-服務-4,獨立規劃並執行一次服務行動,排出時間與所需物品,,\nP-豹-服務-4,獨立規劃並執行一次服務行動,執行完成並回報,,\nP-豹-服務-5,了解接聽電話的禮貌,能說出標準的接聽開場,情境演練,在家接一次電話並留言給家人\nP-豹-服務-5,了解接聽電話的禮貌,能問清楚對方是誰,,\nP-豹-服務-5,了解接聽電話的禮貌,能記下留言,,\nP-豹-服務-5,了解接聽電話的禮貌,掛電話前說再見,,\nP-豹-勞作-1,知道鐵鎚的用法,知道正確握法（握尾端）,實作釘入3根釘子,在家幫忙釘一次東西\nP-豹-勞作-1,知道鐵鎚的用法,能扶穩釘子,,\nP-豹-勞作-1,知道鐵鎚的用法,能敲直不歪,,\nP-豹-勞作-1,知道鐵鎚的用法,知道要護目、不對人揮舞,,\nP-豹-勞作-1,知道鋸子的用法,知道推鋸與拉鋸的差別,實作鋸開一段木料,\nP-豹-勞作-1,知道鋸子的用法,能固定木料,,\nP-豹-勞作-1,知道鋸子的用法,能沿線鋸直,,\nP-豹-勞作-1,知道鋸子的用法,知道鋸子的收納方式,,\nP-豹-勞作-2,利用各種素材作五種以上的玩具與日常用品,五件作品使用三種以上素材,成品展示＋口述,五件中至少三件在家實際使用\nP-豹-勞作-2,利用各種素材作五種以上的玩具與日常用品,每件都能說明用途,,\nP-豹-勞作-2,利用各種素材作五種以上的玩具與日常用品,至少兩件使用回收材料,,\nP-豹-勞作-2,利用各種素材作五種以上的玩具與日常用品,能說出製作時遇到的困難,,\nP-豹-勞作-2,作品須具實際用途並實際使用過,能說明這件作品要解決什麼問題,使用紀錄,\nP-豹-勞作-2,作品須具實際用途並實際使用過,實際使用滿一週,,\nP-豹-勞作-2,作品須具實際用途並實際使用過,說出使用後發現的缺點,,\nP-豹-勞作-2,作品須具實際用途並實際使用過,提出一個改良方向,,\nP-豹-勞作-3,簡易植物標本製作,能正確採集不破壞植株,標本繳交,送一份給學校自然老師\nP-豹-勞作-3,簡易植物標本製作,能壓平乾燥,,\nP-豹-勞作-3,簡易植物標本製作,貼台紙並標註名稱、日期、地點,,\nP-豹-勞作-3,簡易植物標本製作,完成3份,,\nP-豹-結繩-1,會打繩頭結,知道繩頭結用來防止繩尾散開,實作,\nP-豹-結繩-1,會打繩頭結,能打出正確結型,,\nP-豹-結繩-1,會打繩頭結,能實際用在團部繩具上,,\nP-豹-結繩-1,會打繩頭結,能說出與八字結的差別,,\nP-豹-認識動、植物-1,植物辨識,能認出5種社區常見植物,戶外實地指認5種,散步時教家人認一種植物\nP-豹-認識動、植物-1,植物辨識,能說出其中一種的特徵,,\nP-豹-認識動、植物-1,植物辨識,知道一種有毒或會刺人的植物,,\nP-豹-認識動、植物-1,植物辨識,能自己用圖鑑或手機查證,,\nP-豹-閱讀-1,閱讀至少6本課外讀物,六本涵蓋三種類型,閱讀紀錄卡,維持每月至少一本的習慣\nP-豹-閱讀-1,閱讀至少6本課外讀物,每本有紀錄,,\nP-豹-閱讀-1,閱讀至少6本課外讀物,能說出自己閱讀口味的改變,,\nP-豹-閱讀-1,閱讀至少6本課外讀物,能列出下一本想讀的書,,\nP-豹-閱讀-1,寫出讀書心得2篇,每篇至少300字,繳交,\nP-豹-閱讀-1,寫出讀書心得2篇,有寫出書的內容,,\nP-豹-閱讀-1,寫出讀書心得2篇,有寫出自己的想法,,\nP-豹-閱讀-1,寫出讀書心得2篇,不抄書背文案,,\nP-豹-閱讀-1,心得須寫出「這本書讓我改變了哪一件事」,具體說出改變前的樣子,口述或書面,改變必須是真實發生過的\nP-豹-閱讀-1,心得須寫出「這本書讓我改變了哪一件事」,說出改變後做了什麼,,\nP-豹-閱讀-1,心得須寫出「這本書讓我改變了哪一件事」,改變可以很小,,\nP-豹-閱讀-1,心得須寫出「這本書讓我改變了哪一件事」,能舉出一個實際發生的例子,,\nP-豹-閱讀-1,會講閱讀過的故事4則,四則來自不同的書,分兩次完成,到低年級班上說一次故事\nP-豹-閱讀-1,會講閱讀過的故事4則,能針對不同年齡調整說法,,\nP-豹-閱讀-1,會講閱讀過的故事4則,其中一則說給羚羊級聽,,\nP-豹-閱讀-1,會講閱讀過的故事4則,能讓聽眾有反應,,\n",
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

/** 註冊申請：類型 孩子/服務員；狀態 待審核/已核准/已退回（處理後清掉填寫姓名，只留連結的小狼ID） */
function loadRequests_() {
  return readRows_(SHEET.REQUESTS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      requestId: Logic.clean(r[0]), accountId: Logic.clean(r[1]), type: Logic.clean(r[2]), name: Logic.clean(r[3]), at: ms_(r[4]),
      status: Logic.clean(r[5]), cubId: Logic.clean(r[8]), consentVersion: Number(r[9]) || 0, note: Logic.clean(r[10]), _row: r._row, _raw: r
    };
  });
}

function loadItems_() { return Logic.parseItems(readAll_(SHEET.ITEMS)); }

/** 進程細項（團自訂，只顯示）：{byItem, errors}；分頁不存在（尚未重跑 setup）時視為沒有細項 */
function loadDetails_() {
  if (!ss_().getSheetByName(SHEET.DETAILS)) return { byItem: {}, errors: [] };
  var ids = {};
  loadItems_().items.forEach(function (it) { ids[it.id] = true; });
  return Logic.parseDetails(readAll_(SHEET.DETAILS), ids);
}

/** 細項白名單（只回傳這四個欄位） */
function detailsView_(byItem, itemId) {
  return (byItem[itemId] || []).map(function (g) { return { group: g.group, standard: g.standard, life: g.life, subs: g.subs.slice() }; });
}

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

/** [0, n) 的均勻亂數整數（拒絕取樣，避免偏差）；n 最大 2^32 */
function randInt_(n) {
  if (!(n >= 1 && n <= 4294967296)) throw new Error('randInt_ 範圍不正確');
  var limit = Math.floor(4294967296 / n) * n;
  for (;;) {
    var x = parseInt(randomHex_(8), 16);
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
  resetPassword: apiResetPassword_,
  catalog: apiCatalog_
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
  updateNickname: apiUpdateNickname_,
  requestChildren: apiRequestChildren_
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

/**
 * 公開標準查詢（不用登入，SPEC 附錄第 21 點）：只回傳啟用中的進程與技能章項目、說明與晉級條件。
 * 不含任何小狼、家長或管理員的資料。結果快取 5 分鐘以加快速度。
 */
function apiCatalog_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('CATALOG2');
  if (hit) return JSON.parse(hit);
  var unitsInfo = loadUnits_();
  var byItem = loadDetails_().byItem;
  var groups = {}, order = [];
  loadItems_().items.forEach(function (it) {
    if (!it.enabled) return;
    var k = it.category + '|' + it.unit;
    if (!groups[k]) {
      var info = unitsInfo[k] || {};
      groups[k] = { category: it.category, unit: it.unit, group: info.group || '', desc: info.desc || '', rule: info.rule || '', order: info.order || 9999, items: [] };
      order.push(k);
    }
    groups[k].items.push({ section: it.section, text: it.text, details: detailsView_(byItem, it.id) });
  });
  var out = { units: order.map(function (k) { return groups[k]; }).sort(function (a, b) { return a.order - b.order; }) };
  try { cache.put('CATALOG2', JSON.stringify(out), 300); } catch (e) { /* 超過快取大小時不快取 */ }
  return out;
}

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
/** 使用邀請碼成為管理員；邀請碼沒有填姓名時，用帳號的稱呼當作管理員姓名 */
function redeemInvite_(accountId, invite, nickname) {
  var now = new Date();
  var admins = loadAdmins_();
  if (!admins.some(function (a) { return a.accountId === accountId; })) {
    appendRows_(SHEET.ADMINS, [[accountId, invite.name || Logic.clean(nickname).slice(0, 30) || invite.role, invite.role, now, invite.createdBy || '邀請碼', '', '']]);
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
  // 沒有代碼：新的註冊方式（送出申請，團長審核）；有代碼：舊方式（第一位團長邀請碼、既有綁定碼仍可用）
  if (!Logic.clean(req.code)) return registerByRequest_(req);
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
      redeemInvite_(accountId, r.invite, req.nickname);
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
    redeemInvite_(who.account.accountId, r.invite, who.account.nickname);
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
/**
 * 新的註冊方式（SPEC 附錄第 31 點）：選身分（家長／服務員）、填孩子姓名 → 建立帳號並送出申請，
 * 團長在後台核准後才綁定孩子或成為服務員。帳號可以先登入，看到「等待審核」。
 */
function registerByRequest_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var identity = Logic.clean(req.identity);
    if (identity !== Logic.IDENTITY.PARENT && identity !== Logic.IDENTITY.STAFF) throw new ApiError(ERR.BAD_INPUT, '請選擇身分（家長或服務員）。');
    var v = Logic.validateChildNames(req.childNames, identity === Logic.IDENTITY.PARENT);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    checkAccountInput_(req.username, req.password, req.nickname, settings);
    // 有填孩子就要先同意個資告知；沒有同意不建立任何資料
    var version = v.names.length ? requireConsentVersion_(req.consentVersion) : 0;
    var requests = loadRequests_();
    if (Logic.recentRequestAccounts(requests, Date.now()) >= settings['每日註冊申請上限']) {
      throw new ApiError(ERR.LOCKED, '目前註冊的人太多，暫停註冊，請稍後再試，或聯絡團長。');
    }
    if (findAccountByName_(req.username)) throw new ApiError(ERR.NAME_TAKEN, '這個帳號名稱已經有人使用，請換一個。');

    var accountId = newId_('U', loadAccounts_().map(function (a) { return a.accountId; }));
    var salt = randomHex_(32);
    var hash = Logic.hashPassword(String(req.password), salt, HASH_ITERATIONS, hmacHex_);
    var now = new Date();
    appendRows_(SHEET.ACCOUNTS, [[accountId, Logic.clean(req.username), Logic.clean(req.nickname), hash, salt, '啟用', now, now, '', '']]);
    var rows = requestRows_(accountId, v.names, version, requests, now);
    if (identity === Logic.IDENTITY.STAFF) rows.push(requestRow_(accountId, '服務員', Logic.clean(req.nickname), 0, requests.concat(rowsToIds_(rows)), now));
    appendRows_(SHEET.REQUESTS, rows);
    logOp_(accountId, '註冊申請', Logic.clean(req.username), '', identity + (v.names.length ? '，孩子 ' + v.names.length + ' 位' : ''));
    var s = createSession_(accountId, !!req.remember, settings);
    return { token: s.token, expiresAt: s.expiresAt };
  });
}

/** 已登入的家長再申請新增孩子（例如第二個孩子） */
function apiRequestChildren_(req, who) {
  return withLock_(function () {
    var v = Logic.validateChildNames(req.childNames, true);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    var version = requireConsentVersion_(req.consentVersion);
    var requests = loadRequests_();
    var pendingMine = requests.filter(function (r) { return r.accountId === who.account.accountId && r.status === '待審核'; });
    if (pendingMine.length + v.names.length > 10) throw new ApiError(ERR.BAD_INPUT, '待審核的申請太多了，請等團長審核後再送。');
    var dup = v.names.filter(function (n) { return pendingMine.some(function (r) { return r.type === '孩子' && r.name === n; }); });
    if (dup.length) throw new ApiError(ERR.BAD_INPUT, '「' + dup.join('、') + '」已經在等待審核了。');
    appendRows_(SHEET.REQUESTS, requestRows_(who.account.accountId, v.names, version, requests, new Date()));
    logOp_(who.account.accountId, '申請新增孩子', who.account.username, '', v.names.length + ' 位');
    return { added: v.names.length };
  });
}

function requestRow_(accountId, type, name, version, existing, now) {
  var id = newId_('R', existing.map(function (r) { return r.requestId; }));
  return [id, accountId, type, name, now, '待審核', '', '', '', version || '', ''];
}
function rowsToIds_(rows) { return rows.map(function (r) { return { requestId: r[0] }; }); }
function requestRows_(accountId, names, version, existing, now) {
  var rows = [];
  names.forEach(function (n) { rows.push(requestRow_(accountId, '孩子', n, version, existing.concat(rowsToIds_(rows)), now)); });
  return rows;
}

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
    // 自己的申請：待審核的全部、已退回的最近 5 筆（已退回的姓名已清除，只留類型與團長備註）
    requests: (function () {
      var mineReq = loadRequests_().filter(function (r) { return r.accountId === who.account.accountId; });
      var pend = mineReq.filter(function (r) { return r.status === '待審核'; });
      var rej = mineReq.filter(function (r) { return r.status === '已退回'; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 5);
      return pend.concat(rej).map(function (r) { return { type: r.type, name: r.name, status: r.status, at: r.at ? new Date(r.at).toISOString() : '', note: r.note }; });
    })(),
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
  var byItem = loadDetails_().byItem;
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && Logic.isDateStr(m.date); });
  var mById = {};
  meetings.forEach(function (m) { mById[m.meetingId] = m; });
  var att = loadAttendance_().filter(function (a) { return a.cubId === cub.cubId && mById[a.meetingId]; });
  var attRecords = att.map(function (a) { return { date: mById[a.meetingId].date, status: a.status, meetingId: a.meetingId }; });

  var progress = Logic.computeCubProgress({
    cubId: cub.cubId, items: items, completions: loadCompletions_(), awards: loadAwards_(),
    intervalMonths: settings['晉級間隔月數'], today: today, attendance: attRecords,
    autoItemId: settings['出席自動完成項目ID'], autoCount: settings['自動完成所需出席次數'],
    levelAttendCount: settings['晉級所需出席次數'], newbieAttendCount: settings['剛入團所需出席次數']
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
        return { section: i.section, text: i.text, done: i.done, date: i.date, signer: i.done ? (names[i.signer] || (i.auto ? '出席自動計算' : '')) : '', auto: i.auto, details: detailsView_(byItem, i.id) };
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

// ════════════════ Menu.js ════════════════
/**
 * 試算表選單「🐺 幼童軍系統」（SPEC 附錄第 17 點）
 * 只有能編輯這份試算表的人看得到；開啟試算表時自動出現（onOpen 簡易觸發）。
 * 注意：選單呼叫的函式名稱不可以底線結尾（GAS 會視為私有函式）。
 * 邀請碼功能已拿掉（SPEC 附錄第 33 點）：服務員改為自己註冊、團長核准。
 */

/** 網頁網址（臨時碼說明文字用）；可在 Script Properties 設定 WEB_URL 覆寫 */
var DEFAULT_WEB_URL = 'https://aihong-lab.github.io/22CUBSCOUT/';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🐺 幼童軍系統')
    .addItem('把帳號設為團長', 'menuSetLeader')
    .addSeparator()
    .addItem('顯示全部分頁（查紀錄用）', 'menuShowAllSheets')
    .addItem('只顯示需要編輯的分頁', 'menuHideSystemSheets')
    .addToUi();
}

/**
 * 把已註冊的帳號設為團長（最高權限）。只有能編輯這份試算表的人看得到這個選單，
 * 而能編輯試算表本來就能改所有資料，所以不另外驗證（SPEC 附錄第 36 點）。
 */
function menuSetLeader() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.prompt('把帳號設為團長', '請輸入要設為團長的「帳號」（先在網站註冊好，例如 leader_hong）：', ui.ButtonSet.OK_CANCEL);
  if (ans.getSelectedButton() !== ui.Button.OK) return;
  var r = setLeaderByUsername_(ans.getResponseText());
  ui.alert(r.message);
}

function setLeaderByUsername_(username) {
  return withLock_(function () {
    var acc = findAccountByName_(username);
    if (!acc) return { ok: false, message: '找不到帳號「' + Logic.clean(username) + '」。請先在網站註冊（登入 → 註冊新帳號），再回來設定。' };
    if (acc.status !== '啟用') return { ok: false, message: '這個帳號已停用，請先到後台「帳號管理」啟用。' };
    var admins = loadAdmins_();
    var cur = admins.filter(function (a) { return a.accountId === acc.accountId; })[0];
    if (cur && cur.role === Logic.ROLE.LEADER) return { ok: true, message: '「' + acc.username + '」已經是團長了。' };
    if (cur) {
      var row = cur._raw.slice(0, HEADERS[SHEET.ADMINS].length);
      row[2] = Logic.ROLE.LEADER;
      updateRows_(SHEET.ADMINS, [{ row: cur._row, values: row }]);
    } else {
      appendRows_(SHEET.ADMINS, [[acc.accountId, acc.nickname || acc.username, Logic.ROLE.LEADER, new Date(), '試算表選單', '', '']]);
    }
    // 這個帳號還在等審核的服務員申請一併結案
    var pend = loadRequests_().filter(function (q) { return q.accountId === acc.accountId && q.status === '待審核' && q.type === '服務員'; });
    if (pend.length) updateRows_(SHEET.REQUESTS, pend.map(function (q) {
      var v = q._raw.slice(0, HEADERS[SHEET.REQUESTS].length);
      v[3] = ''; v[5] = '已核准'; v[6] = '試算表選單'; v[7] = new Date();
      return { row: q._row, values: v };
    }));
    logOp_('試算表選單', '設為團長', acc.username, cur ? cur.role : '', Logic.ROLE.LEADER);
    return { ok: true, message: '已把「' + acc.username + '」設為團長。請重新登入網站，就會進入後台並擁有全部權限。' };
  });
}

/** 分頁顯示切換：只改顯示狀態，不動資料（SPEC 附錄第 30 點） */
function menuShowAllSheets() { organizeSheets_(false); SpreadsheetApp.getUi().alert('已顯示全部分頁。查完後可以用「只顯示需要編輯的分頁」再收起來。\n\n⚠️ 系統分頁請不要手動修改。'); }
function menuHideSystemSheets() { var n = organizeSheets_(true); SpreadsheetApp.getUi().alert('已收起 ' + n + ' 個系統分頁（資料都還在）。'); }

// ════════════════ AdminApi.js ════════════════
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
  AUTHED_ACTIONS[name] = function (req, who) { requireRole_(who, permission); return fn(req, who); };
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
    (attByCub[a.cubId] = attByCub[a.cubId] || []).push({ date: meetings[a.meetingId].date, status: a.status, meetingId: a.meetingId });
  });
  return {
    settings: settings, items: loadItems_().items, completions: loadCompletions_(), awards: loadAwards_(),
    meetings: meetings, attByCub: attByCub, today: today_()
  };
}

function progressOf_(ctx, cubId) {
  return Logic.computeCubProgress({
    cubId: cubId, items: ctx.items, completions: ctx.completions, awards: ctx.awards,
    intervalMonths: ctx.settings['晉級間隔月數'], today: ctx.today, attendance: ctx.attByCub[cubId] || [],
    autoItemId: ctx.settings['出席自動完成項目ID'], autoCount: ctx.settings['自動完成所需出席次數'],
    levelAttendCount: ctx.settings['晉級所需出席次數'], newbieAttendCount: ctx.settings['剛入團所需出席次數']
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
  var threshold = ctx.settings['快達標門檻（剩幾項以內）'];
  var pending = [], near = [], waiting = [];
  cubs.filter(function (c) { return c.status === '在團'; }).forEach(function (c) {
    progressOf_(ctx, c.cubId).units.forEach(function (u) {
      var base = { cubId: c.cubId, name: c.name, squad: c.squad, joinDate: c.joinDate, category: u.category, unit: u.unit };
      if (u.status === Logic.STATUS.AWARDED) return;
      if (u.eligible) pending.push(Object.assign(base, { eligibleDate: u.eligibleDate }));
      else if (u.status === Logic.STATUS.DONE_PENDING) waiting.push(Object.assign(base, { waitingUntil: u.waitingUntil || '', attendSinceLast: u.attendSinceLast || 0, attendRequired: u.attendRequired || 0 }));
      else if (Logic.isNearlyDone(u, threshold)) near.push(Object.assign(base, { remaining: u.remaining }));
    });
  });
  var props = PropertiesService.getScriptProperties();
  var parse = function (k) { try { return JSON.parse(props.getProperty(k) || 'null'); } catch (e) { return null; } };
  var admins = loadAdmins_();
  return {
    me: { name: who.admin.name, role: who.admin.role },
    pending: pending, waiting: waiting, near: near,
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
    var o = { cubId: c.cubId, name: c.name, squad: c.squad, joinDate: c.joinDate, level: c.level, status: c.status, leftDate: c.leftDate };
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
  var name = Logic.clean(req.name), squad = Logic.clean(req.squad).slice(0, 20), joinDate = requireDate_(Logic.clean(req.joinDate), '入團日');
  if (!name || name.length > 30) throw new ApiError(ERR.BAD_INPUT, '請填寫小狼姓名（最多 30 字）。');
  return withLock_(function () {
    var settings = loadSettings_().values;
    squad = requireSquad_(squad);
    if (req.cubId) {
      var cub = findCub_(req.cubId);
      var row = cubRow_(cub);
      var before = [row[1], row[2], dateStr_(row[3])].join('／');
      row[1] = name; row[2] = squad; row[3] = joinDate;
      updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
      logOp_(who.account.accountId, '編輯小狼', cub.cubId, before, [name, squad, joinDate].join('／'));
      return { cubId: cub.cubId };
    }
    var id = newId_('C', loadCubs_().map(function (c) { return c.cubId; }));
    var code = Logic.generateCode(settings['綁定碼長度'], randInt_, allCodes_());
    appendRows_(SHEET.CUBS, [[id, name, squad, joinDate, '', code, settings['綁定碼可用次數'], '在團', '']]);
    logOp_(who.account.accountId, '新增小狼', id, '', [name, squad, joinDate].join('／'));
    return { cubId: id, code: code };
  });
});

registerAdmin_('cubLeave', 'manageCubs', function (req, who) {
  var d = requireDate_(Logic.clean(req.leftDate), '離團日');
  return withLock_(function () {
    var cub = findCub_(req.cubId);
    if (cub.status !== '在團') throw new ApiError(ERR.BAD_INPUT, '這位小狼目前不是在團狀態。');
    var row = cubRow_(cub);
    row[5] = ''; row[6] = 0; row[7] = '離團'; row[8] = d; // 綁定碼立即失效
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
    logOp_(who.account.accountId, '標記離團', cub.cubId, '在團', '離團 ' + d);
    return {};
  });
});

registerAdmin_('cubNewCode', 'manageBindCodes', function (req, who) {
  return withLock_(function () {
    var cub = findCub_(req.cubId);
    if (cub.status !== '在團') throw new ApiError(ERR.BAD_INPUT, '只有在團的小狼可以產生綁定碼。');
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
    cub: { cubId: cub.cubId, name: cub.name, squad: cub.squad, joinDate: cub.joinDate, status: cub.status, tenure: Logic.tenure(cub.joinDate, ctx.today).text, currentLevel: p.currentLevel || '' },
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

// ───────────── 註冊申請審核（SPEC 附錄第 31 點，團長專用） ─────────────

registerAdmin_('requestList', 'reviewRequests', function () {
  var accounts = accountsById_();
  var cubs = loadCubs_().filter(function (c) { return c.status === '在團'; });
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
      if (cub.status !== '在團') throw new ApiError(ERR.BAD_INPUT, '只能連結在團的小狼。');
    } else {
      var cname = Logic.clean(req.name).replace(/\s+/g, '') || r.name;
      if (!cname || cname.length > 30) throw new ApiError(ERR.BAD_INPUT, '請填寫小狼姓名（最多 30 字）。');
      var squad = requireSquad_(Logic.clean(req.squad).slice(0, 20));
      var joinDate = requireDate_(Logic.clean(req.joinDate), '入團日');
      var settings = loadSettings_().values;
      var id = newId_('C', loadCubs_().map(function (c) { return c.cubId; }));
      var code = Logic.generateCode(settings['綁定碼長度'], randInt_, allCodes_());
      appendRows_(SHEET.CUBS, [[id, cname, squad, joinDate, '', code, settings['綁定碼可用次數'], '在團', '']]);
      logOp_(who.account.accountId, '新增小狼', id, '', [cname, squad, joinDate].join('／') + '（註冊申請）');
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
    return { meetingId: m.meetingId, date: m.date, name: m.name, note: m.note, enabled: m.enabled, attended: count[m.meetingId] || 0 };
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
      updateRows_(SHEET.MEETINGS, [{ row: m._row, values: row }]);
      logOp_(who.account.accountId, '修改集會', m.meetingId, before, [row[1], row[2], row[4]].join('／'));
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
      add.push([id, d, (mm[4] || '').trim().slice(0, 40) || '團集會', '', '是', who.account.accountId, now]);
    });
    if (!add.length) throw new ApiError(ERR.BAD_INPUT, '沒有可新增的集會。每行格式：2026-11-22 團集會' + (bad.length ? '\n看不懂的行：\n' + bad.join('\n') : ''));
    appendRows_(SHEET.MEETINGS, add);
    logOp_(who.account.accountId, '新增集會', add.length + ' 場', '', add.map(function (r) { return r[1]; }).join('、'));
    return { added: add.length, bad: bad };
  });
});

/** 該集會當天在團的小狼 */
function cubsOnDate_(date) {
  return loadCubs_().filter(function (c) {
    if (c.status === '已匿名') return false;
    if (!c.joinDate || c.joinDate > date) return false;
    if (c.status === '離團' && c.leftDate && c.leftDate < date) return false;
    return true;
  });
}

registerAdmin_('attendanceSheet', 'attendance', function (req) {
  var m = loadMeetings_().filter(function (x) { return x.meetingId === Logic.clean(req.meetingId); })[0];
  if (!m || !m.enabled) throw new ApiError(ERR.NOT_FOUND, '找不到這場集會。');
  var st = {};
  loadAttendance_().forEach(function (a) { if (a.meetingId === m.meetingId) st[a.cubId] = a.status; });
  var cubs = cubsOnDate_(m.date).map(function (c) { return { cubId: c.cubId, name: c.name, squad: c.squad, status: st[c.cubId] || '' }; });
  return { meeting: { meetingId: m.meetingId, date: m.date, name: m.name }, cubs: cubs, squads: squadsOf_(loadCubs_()) };
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
    cubsOnDate_(m.date).forEach(function (c) { valid[c.cubId] = true; });
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
  var rows = loadCubs_().filter(function (c) { return c.status === '在團'; }).map(function (c) {
    var cells = meetings.map(function (m) { return st[c.cubId + '|' + m.meetingId] || ''; });
    var counts = { attended: cells.filter(function (x) { return x === '出席'; }).length, leave: cells.filter(function (x) { return x === '請假'; }).length };
    var rate = period ? Logic.attendanceRate(allAtt[c.cubId] || [], period, extra[c.cubId] || 0) : null;
    return { cubId: c.cubId, name: c.name, squad: c.squad, cells: cells, counts: counts, extra: extra[c.cubId] || 0, rate: rate ? rate.text : '' };
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
  return {
    squads: list.map(function (n) { return { name: n, count: count[n] || 0 }; }),
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
    }
    logOp_(who.account.accountId, '小隊設定', Logic.clean(req.type), cur.join('、'), r.list.join('、') + (moved ? '（更新 ' + moved + ' 位小狼）' : ''));
    return { squads: r.list, moved: moved };
  });
});

// ════════════════ Backup.js ════════════════
/**
 * 備份與試算表權限檢查（SPEC 7.11）
 * 備份資料夾 ID 放在 Script Properties 的 BACKUP_FOLDER_ID。
 */

var BACKUP_PREFIX = '幼童軍進程系統 備份 ';

/** 立即備份：複製整份試算表到備份資料夾，只保留設定的份數 */
function runBackup_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('BACKUP_FOLDER_ID');
  var result;
  try {
    if (!folderId) throw new Error('尚未設定備份資料夾（Script Properties 的 BACKUP_FOLDER_ID）');
    var folder = DriveApp.getFolderById(folderId);
    var file = DriveApp.getFileById(ss_().getId());
    var name = BACKUP_PREFIX + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm');
    file.makeCopy(name, folder);
    var keep = loadSettings_().values['備份保留份數'];
    var removed = rotateBackups_(folder, keep);
    result = { at: Date.now(), ok: true, message: '已備份「' + name + '」' + (removed ? '，刪除最舊的 ' + removed + ' 份' : '') };
  } catch (e) {
    result = { at: Date.now(), ok: false, message: '備份失敗：' + (e && e.message ? e.message : e) };
    // 階段 5：推播通知團長
  }
  props.setProperty('BACKUP_LAST', JSON.stringify(result));
  return result;
}

/** 依建立時間保留最新 keep 份，其餘移到垃圾桶；回傳刪除份數 */
function rotateBackups_(folder, keep) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  var removed = 0;
  files.slice(keep).forEach(function (f) { f.setTrashed(true); removed++; });
  return removed;
}

/** 刪除所有舊備份（個資處理後使用），再重新備份一次 */
function purgeBackupsAndBackup_() {
  var folderId = PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID');
  if (!folderId) throw new ApiError(ERR.BAD_INPUT, '尚未設定備份資料夾。');
  rotateBackups_(DriveApp.getFolderById(folderId), 0);
  return runBackup_();
}

/** 權限檢查：試算表或備份資料夾設成「知道連結的任何人」或「公開」就警告 */
function checkPermissions_() {
  var props = PropertiesService.getScriptProperties();
  var issues = [];
  var wide = function (access) { return access === DriveApp.Access.ANYONE || access === DriveApp.Access.ANYONE_WITH_LINK; };
  try {
    if (wide(DriveApp.getFileById(ss_().getId()).getSharingAccess())) issues.push('試算表設成「知道連結的任何人」都能開啟');
  } catch (e) { issues.push('無法檢查試算表權限：' + e.message); }
  var folderId = props.getProperty('BACKUP_FOLDER_ID');
  if (folderId) {
    try {
      if (wide(DriveApp.getFolderById(folderId).getSharingAccess())) issues.push('備份資料夾設成「知道連結的任何人」都能開啟');
    } catch (e) { issues.push('無法檢查備份資料夾權限：' + e.message); }
  }
  var result = { at: Date.now(), ok: issues.length === 0, issues: issues };
  props.setProperty('PERM_LAST', JSON.stringify(result));
  return result;
}

registerAdmin_('backupNow', 'backup', function (req, who) {
  var r = runBackup_();
  logOp_(who.account.accountId, '立即備份', '', '', r.message);
  if (!r.ok) throw new ApiError(ERR.SERVER_ERROR, r.message);
  return r;
});

registerAdmin_('backupPurge', 'backup', function (req, who) {
  var r = purgeBackupsAndBackup_();
  logOp_(who.account.accountId, '刪除所有舊備份並重新備份', '', '', r.message);
  if (!r.ok) throw new ApiError(ERR.SERVER_ERROR, r.message);
  return r;
});

registerAdmin_('permCheck', 'backup', function (req, who) {
  return checkPermissions_();
});

// ───────────── 排程（在 Apps Script 編輯器手動執行一次） ─────────────

/** 每週備份排程呼叫（依設定「每週備份」決定是否執行），同時做權限檢查 */
function weeklyBackup() {
  DB_CACHE_ = {};
  if (loadSettings_().values['每週備份']) runBackup_();
  checkPermissions_();
}

/** 安裝每週備份排程（每週日凌晨 3 點）；重複執行不會重複安裝 */
function installBackupTrigger() {
  removeTriggers_('weeklyBackup');
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  Logger.log('已安裝每週備份排程（每週日 03:00）。');
}

function removeTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t); });
}

// ════════════════ Webhook.js ════════════════
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
    // 階段 5：關鍵字回覆
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
  if (name) lineReply_(replyToken, '✅ ' + name + '，已連結 22 團幼童軍進程系統的通知。之後小狼達標時會在這裡通知你。');
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
    var newbie = ensureNewbieLevel_();
    if (newbie) report.seeded.push(newbie);
    if (dataRowCount_(SHEET.DETAILS) === 0) {
      var details = Logic.buildDetailSeed(SEED.detailsCsv);
      if (details.length) { appendRows_(SHEET.DETAILS, details); report.seeded.push(SHEET.DETAILS + ' ' + details.length + ' 列'); }
    }
    if (dataRowCount_(SHEET.CONSENT) === 0) { appendRows_(SHEET.CONSENT, [[1, SEED.consentText, today_()]]); report.seeded.push(SHEET.CONSENT + ' 第 1 版'); }

    // 設定：只補上缺少的鍵，不改既有值
    var have = {};
    readRows_(SHEET.SETTINGS).forEach(function (r) { have[Logic.clean(r[0])] = true; });
    var missing = Logic.defaultSettingsRows().slice(1).filter(function (r) { return !have[r[0]]; });
    if (missing.length) { appendRows_(SHEET.SETTINGS, missing); report.seeded.push(SHEET.SETTINGS + ' 補上 ' + missing.length + ' 項'); }

    report.hidden = organizeSheets_(true);
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
  // 新分頁依序排在最後面（insertSheet 不給位置時會插在最前面）
  if (!sh) { sh = ss.insertSheet(name, ss.getSheets().length); report.created.push(name); }
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

/**
 * 補上「剛入團」級（SPEC 附錄第 37 點）：項目總表沒有剛入團項目時，新增 P-剛入團-1～5；
 * 級別與章說明沒有剛入團時新增一列；進程細項裡原本掛在羚羊項目下、屬於剛入團的細項改掛到新項目。
 * 只新增列與修改這些細項的項目ID，不動其他資料；已補過就不再執行。
 * @return {string} 報告文字（沒有做事時為空字串）
 */
function ensureNewbieLevel_() {
  var NB = Logic.NEWBIE, seed = Logic.NEWBIE_SEED, done = [];
  var items = loadItems_().items;
  if (!items.some(function (it) { return it.category === Logic.CATEGORY.PROGRESS && it.unit === NB; })) {
    appendRows_(SHEET.ITEMS, seed.items.map(function (t, i) { return ['P-' + NB + '-' + (i + 1), Logic.CATEGORY.PROGRESS, NB, Logic.NO_SECTION, t, i + 1, '是']; }));
    done.push(SHEET.ITEMS + ' 新增剛入團 ' + seed.items.length + ' 項');
    // 細項：分組名稱等於剛入團大項、且目前掛在羚羊項目下的，改掛到剛入團
    if (ss_().getSheetByName(SHEET.DETAILS)) {
      var ups = [];
      readRows_(SHEET.DETAILS).forEach(function (r) {
        var idx = seed.items.indexOf(Logic.clean(r[1]));
        if (idx >= 0 && /^P-羚羊-/.test(Logic.clean(r[0]))) {
          var v = HEADERS[SHEET.DETAILS].map(function (h, j) { return r[j]; });
          v[0] = 'P-' + NB + '-' + (idx + 1);
          ups.push({ row: r._row, values: v });
        }
      });
      if (ups.length) { updateRows_(SHEET.DETAILS, ups); done.push(SHEET.DETAILS + ' ' + ups.length + ' 條改掛到剛入團'); }
    }
  }
  if (!loadUnits_()[Logic.CATEGORY.PROGRESS + '|' + NB]) {
    appendRows_(SHEET.UNITS, [[NB, Logic.CATEGORY.PROGRESS, '', seed.desc, seed.rule, 5]]);
    done.push(SHEET.UNITS + ' 新增剛入團');
  }
  return done.join('、');
}

/**
 * 整理分頁：要編輯的分頁排最前面並顯示；系統分頁依 hide 隱藏或全部顯示。
 * 只改分頁的順序與顯示狀態，不動任何資料；不屬於本系統的分頁不處理。
 * @return {number} 隱藏的分頁數
 */
function organizeSheets_(hide) {
  var ss = ss_();
  // 先顯示要編輯的分頁（試算表至少要有一個看得到的分頁，才能隱藏其他的）
  EDITABLE_SHEETS.forEach(function (name, i) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    if (sh.isSheetHidden()) sh.showSheet();
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  var n = 0;
  Object.keys(SHEET).forEach(function (k) {
    var name = SHEET[k];
    if (EDITABLE_SHEETS.indexOf(name) >= 0) return;
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    if (hide && !sh.isSheetHidden()) { sh.hideSheet(); n++; }
    if (!hide && sh.isSheetHidden()) sh.showSheet();
  });
  var first = ss.getSheetByName(EDITABLE_SHEETS[0]);
  if (first) ss.setActiveSheet(first);
  return n;
}

function printSetupReport_(r) {
  Logger.log('setup 完成。');
  Logger.log('只顯示需要編輯的 ' + EDITABLE_SHEETS.length + ' 個分頁，其他系統分頁已隱藏（資料都在）。要查看時用試算表選單「🐺 幼童軍系統 → 顯示全部分頁」。');
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
