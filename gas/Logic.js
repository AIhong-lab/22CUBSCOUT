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
    { key: '體驗所需出席次數', type: 'int', def: 4, min: 1, max: 20, desc: '體驗者參加幾次「一般」團集會後可以入團（大活動不算；請假不算）' },
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
  /**
   * 後台設定頁：檢查單一設定值（SPEC 7.8）。小隊清單另有專屬頁面，不在這裡改。
   * @return {{ok: boolean, stored?: string, error?: string}} stored 為要寫入試算表的文字
   */
  function validateSettingValue(key, raw) {
    var s = SETTINGS.filter(function (x) { return x.key === key; })[0];
    if (!s || s.type === 'list') return { ok: false, error: '不支援修改這個設定' };
    var v = clean(raw);
    if (s.type === 'bool') return v === '是' || v === '否' ? { ok: true, stored: v } : { ok: false, error: key + '：只能選「是」或「否」' };
    if (s.type === 'str') return s.pattern.test(v) ? { ok: true, stored: v } : { ok: false, error: key + '：格式不正確' };
    var n = Number(v);
    if (!/^-?\d+$/.test(v) || n < s.min || n > s.max) return { ok: false, error: key + '：需為 ' + s.min + '～' + s.max + ' 的整數' };
    return { ok: true, stored: String(n) };
  }

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

  // ───────────── 體驗者（SPEC 附錄第 40 點） ─────────────

  var TRIAL = '體驗';
  /** 升上童軍團（畢業）：和中途離團分開記（SPEC 附錄第 45 點） */
  var GRADUATED = '升團';
  /** 正副小隊長：狼級以上才能擔任 */
  var CUB_ROLES = ['小隊長', '副小隊長'];
  var ROLE_LEVELS = ['狼', '鹿', '豹'];
  var MEETING_TYPES = ['一般', '大活動'];

  /**
   * 體驗者的進度：只算「一般」團集會的出席（大活動、請假不算）。
   * @param {Array<{date, status, type}>} records
   * @return {{count: number, need: number, ready: boolean, readyDate: string|null}}
   */
  function trialProgress(records, need) {
    var dates = (records || []).filter(function (a) { return a.status === '出席' && (a.type || '一般') === '一般' && isDateStr(a.date); })
      .map(function (a) { return a.date; }).sort();
    return { count: dates.length, need: need, ready: dates.length >= need, readyDate: dates.length >= need ? dates[need - 1] : null };
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
        var e = eligibility(g.category, g.unit, allDone, u.lastCompletionDate, awarded, p.intervalMonths, p.today,
          g.unit === NEWBIE && p.newbieAfter ? attended.filter(function (d) { return d > p.newbieAfter; }) : attended,
          g.unit === NEWBIE ? (p.newbieAttendCount || 0) : (p.levelAttendCount || 0));
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
    if (cub.status !== '在團' && cub.status !== '體驗') return { ok: false, reason: 'not_active' };
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

  /** 最常見的弱密碼（小寫比對）；另擋：與帳號相同、同一個字重複、連續數字或字母 */
  var WEAK_PASSWORDS = ['password', 'password1', 'password12', 'password123', 'passw0rd', 'qwertyui', 'qwertyuiop', 'qwerty123', 'qwer1234', '1q2w3e4r', '1q2w3e4r5t',
    '1qaz2wsx', 'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'iloveyou', 'iloveyou1', 'abcd1234', 'abc12345', 'abc123456', 'a1234567', 'a12345678', 'aa123456', 'admin123', 'admin1234',
    'welcome1', 'welcome123', 'letmein1', 'sunshine1', 'princess1', 'football1', 'baseball1', 'superman1', 'pokemon1', 'scout123', 'scout1234', 'aaaa1111', 'asdf1234', 'qazwsxedc', '5201314a', 'woaini1314'];
  function isWeakPassword(pw, username) {
    var p = String(pw).toLowerCase(), u = clean(username).toLowerCase();
    if (WEAK_PASSWORDS.indexOf(p) >= 0) return true;
    if (u && (p === u || p === u + '1' || p === u + '123')) return true;
    if (/^(.)\1+$/.test(p)) return true;
    var seq = '0123456789012345678909876543210987654321abcdefghijklmnopqrstuvwxyz';
    if (seq.indexOf(p) >= 0) return true;
    if (/^(\d{1,4})\1+$/.test(p)) return true; // 12121212、12341234
    return false;
  }

  function validatePassword(pw, minLength, username) {
    pw = pw === null || pw === undefined ? '' : String(pw);
    if (pw.length < minLength) return { ok: false, error: '密碼至少 ' + minLength + ' 個字元' };
    if (pw.length > 100) return { ok: false, error: '密碼太長' };
    if (isWeakPassword(pw, username)) return { ok: false, error: '這組密碼太常見或太簡單，容易被猜到，請換一組（建議混合英文與數字，不要和帳號相同）' };
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
    reviewRequests: [ROLE.LEADER],
    manageSquadStaff: [ROLE.LEADER],
    manageRoles: [ROLE.LEADER],
    postNotice: [ROLE.LEADER, ROLE.ASSISTANT]
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
  /** ownerId：最高權限帳號（admin）的帳號ID；有的話只有它能指定或取消團長，且它本身不能被更動（SPEC 附錄第 46 點）。沒有就照舊 */
  var OWNER_ONLY_MESSAGE = '只有最高權限帳號（admin）可以指定或取消團長。';
  var OWNER_LOCKED_MESSAGE = 'admin 是最高權限帳號，不能更動。';
  function validateAdminChange(admins, actorId, change, ownerId) {
    var actor = (admins || []).filter(function (a) { return a.accountId === actorId; })[0];
    if (!actor || actor.role !== ROLE.LEADER) return { ok: false, error: '只有團長可以管理管理員' };
    var target = admins.filter(function (a) { return a.accountId === change.targetId; })[0];
    var leaders = admins.filter(function (a) { return a.role === ROLE.LEADER; }).length;
    if (ownerId) {
      if (change.targetId === ownerId && change.type !== 'add') return { ok: false, error: OWNER_LOCKED_MESSAGE };
      var touchesLeader = change.role === ROLE.LEADER || (target && target.role === ROLE.LEADER && change.type !== 'add');
      if (touchesLeader && actorId !== ownerId) return { ok: false, error: OWNER_ONLY_MESSAGE };
    }
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
    '註冊申請': 8,
    '職務紀錄': 0
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
      if ((c.status !== '離團' && c.status !== GRADUATED) || !isDateStr(c.leftDate)) return false;
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
    parseSettings: parseSettings, defaultSettingsRows: defaultSettingsRows, validateSettingValue: validateSettingValue, parseList: parseList, changeSquads: changeSquads,
    parseItems: parseItems, nextItemId: nextItemId, buildSeed: buildSeed, buildDetailSeed: buildDetailSeed, parseDetails: parseDetails,
    isCountedCompletion: isCountedCompletion, computeCubProgress: computeCubProgress, nextChallenge: nextChallenge,
    isNearlyDone: isNearlyDone, attendanceCounts: attendanceCounts, attendanceRate: attendanceRate, periodOf: periodOf, statusTextForParents: statusTextForParents,
    planBatchSignoff: planBatchSignoff, completionToRow: completionToRow, rowToCompletion: rowToCompletion,
    validateAwardDate: validateAwardDate, planBackfill: planBackfill, levelAfterRevoke: levelAfterRevoke,
    generateCode: generateCode, normalizeCode: normalizeCode, checkInvite: checkInvite, checkBindCode: checkBindCode,
    validateUsername: validateUsername, validatePassword: validatePassword, isWeakPassword: isWeakPassword, validateNickname: validateNickname,
    hashPassword: hashPassword, verifyPassword: verifyPassword, isSessionValid: isSessionValid, isTempCodeValid: isTempCodeValid,
    isLocked: isLocked, isGlobalBindLocked: isGlobalBindLocked,
    latestConsentVersion: latestConsentVersion, needsReconsent: needsReconsent,
    TRIAL: TRIAL, GRADUATED: GRADUATED, CUB_ROLES: CUB_ROLES, ROLE_LEVELS: ROLE_LEVELS, MEETING_TYPES: MEETING_TYPES, trialProgress: trialProgress,
    IDENTITY: IDENTITY, validateChildNames: validateChildNames, recentRequestAccounts: recentRequestAccounts,
    can: can, canRevokeSignoff: canRevokeSignoff, validateAdminChange: validateAdminChange, OWNER_ONLY_MESSAGE: OWNER_ONLY_MESSAGE, OWNER_LOCKED_MESSAGE: OWNER_LOCKED_MESSAGE, canDeleteAccount: canDeleteAccount,
    planPrivacy: planPrivacy, overdueForPrivacy: overdueForPrivacy,
    diffNotifications: diffNotifications
  };
})();

// Node 測試環境匯出；GAS 中沒有 module，略過
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
