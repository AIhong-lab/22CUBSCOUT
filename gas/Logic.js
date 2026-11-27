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

  // ───────────── 多分團（SPEC 附錄第 68 點） ─────────────
  /** 分團清單；試算表「分團」欄空白一律視為小狼 */
  var SECTIONS = ['稚齡', '小狼', '童軍', '行義', '羅浮'];
  var DEFAULT_SECTION = '小狼';
  /** 總團：全部分團都有團長權限（管理員＝admin 帳號，另由 ownerId 判斷） */
  var CENTRAL = '總團';
  var STAFF_ROLES = [CENTRAL, ROLE.LEADER, ROLE.ASSISTANT];
  /** 綁定紀錄「關係」：空白視為家長 */
  var RELATION = { PARENT: '家長', SELF: '本人' };
  /** 童軍以上（有手機，由家長建立的本人帳號）的權限層級名稱與適用分團 */
  var SCOUT_SELF = '童軍本人';
  var SELF_ELIGIBLE_SECTIONS = ['童軍', '行義', '羅浮'];

  function sectionOf(v) {
    var x = clean(v);
    return x || DEFAULT_SECTION;
  }

  // ───────────── 全團上線（SPEC 附錄第 73 點） ─────────────
  /** 集會、公告、活動可指定「全團」；註冊申請家長不確定分團時記「未指定」 */
  var ALL = '全團';
  var UNASSIGNED = '未指定';
  /** 網址代號（#cub/progress）與完整名稱（畫面標題用） */
  var SECTION_SLUG = { '稚齡': 'beaver', '小狼': 'cub', '童軍': 'scout', '行義': 'venture', '羅浮': 'rover' };
  var SECTION_FULL = { '稚齡': '稚齡童軍', '小狼': '幼童軍', '童軍': '童軍', '行義': '行義童軍', '羅浮': '羅浮童軍' };
  // ───────────── 進程模組（SPEC 附錄第 73 點⑨⑩、第 75 點） ─────────────
  /**
   * 每個有進程的分團一個模組：級別順序、要算間隔的級別、技能章分類、項目ID 前綴，以及特殊規則。
   *  - newbie：有「剛入團」級（已頒上面幾級時視為通過）——只有小狼
   *  - autoItem：出席滿次數自動完成指定項目（設定「出席自動完成項目ID」）——只有小狼
   *  - deadlines：各級「幾個月內完成」的期限（上限，只提醒、不擋頒章；地球從入團日起算，其餘從上一級頒發日起算）——稚齡
   * 次數、月數一律放在設定（各分團一組），這裡只放預設值。新增分團的進程＝在這裡加一個模組，不改小狼。
   */
  var PROGRESS_MODULES = {
    '小狼': { levels: LEVELS, intervalLevels: INTERVAL_LEVELS, badgeGroups: ['服務類', '健身類', '技巧類'], idPrefix: '', newbie: true, autoItem: true },
    '稚齡': {
      levels: ['地球', '星星', '月亮', '太陽'], intervalLevels: [], badgeGroups: ['服務類', '運動類', '技巧類'], idPrefix: '稚齡-',
      levelAttendDef: 0, deadlines: { '地球': 6, '星星': 6, '月亮': 12, '太陽': 12 }
    },
    // 童軍與行義共用一套（附錄第 80 點）：童軍從初級開始、行義從高級接著往上；資料與頒章都記在「童軍」
    // minMonths：「經 N 個月以上」的最少月數（第一級從入團日起算，其餘從上一級頒發日起算），未滿只提醒、頒章時再確認
    '童軍': {
      levels: ['初級', '中級', '高級', '獅級', '長城', '國花'], intervalLevels: [], badgeGroups: ['服務類', '技能類', '健身類', '興趣類'], idPrefix: '童軍-',
      shareWith: ['行義'], badgeLabel: '專科章', levelAttendDef: 0,
      minMonths: { '初級': 2, '中級': 4, '高級': 5, '獅級': 6, '長城': 8, '國花': 8 }
    },
    // 羅浮：見習羅浮的「途徑1」「途徑2」完成其中一條；服務羅浮的「主題活動」任選一項，其他（基本要求）全部完成
    '羅浮': {
      levels: ['見習羅浮', '授銜羅浮', '服務羅浮'], intervalLevels: [], badgeGroups: [], idPrefix: '羅浮-', levelAttendDef: 0,
      minMonths: { '授銜羅浮': 6, '服務羅浮': 12 },
      levelRules: { '見習羅浮': { anyGroup: true }, '服務羅浮': { pickOne: ['主題活動'] } }
    }
  };
  /** 目前有進程模組的分團（簽核、頒章、項目管理只在這些分團開放）；共用別人模組的分團（行義）也算 */
  var PROGRESS_SECTIONS = SECTIONS.filter(function (sec) {
    return PROGRESS_MODULES[sec] || Object.keys(PROGRESS_MODULES).some(function (k) { return (PROGRESS_MODULES[k].shareWith || []).indexOf(sec) >= 0; });
  });
  /** 進程資料記在哪個分團（行義→童軍；其他就是自己）。項目、級別與章說明、頒章、章圖、進程設定都用這個 */
  function progressSec(section) {
    var sec = sectionOf(section);
    if (PROGRESS_MODULES[sec]) return sec;
    var k = Object.keys(PROGRESS_MODULES).filter(function (x) { return (PROGRESS_MODULES[x].shareWith || []).indexOf(sec) >= 0; })[0];
    return k || sec;
  }
  /** 某分團的進程模組；沒有進程的分團回 null */
  function progressModule(section) { return PROGRESS_MODULES[progressSec(section)] || null; }
  /** 這個名稱是不是某分團的進程級別 */
  function isLevelOf(section, unit) { var m = progressModule(section); return !!m && m.levels.indexOf(unit) >= 0; }
  /** 項目ID 前綴：小狼沒有前綴（P-狼-國旗-1），其他分團加分團名（稚齡-P-地球-1） */
  function idPrefixOf(section) { var m = progressModule(section); return m ? m.idPrefix : sectionOf(section) + '-'; }
  /** 某分團的進程級別（沒有進程的分團回空陣列） */
  function levelsOf(section) { var m = progressModule(section); return m ? m.levels.slice() : []; }
  /** 依頒章紀錄算出某分團目前的級別（頒章、撤銷、補登後寫回名單「目前級別」） */
  function currentLevelOf(awardsOfCub, section) {
    var sec = progressSec(section), have = {}, lv = '';
    (awardsOfCub || []).forEach(function (a) { if (progressSec(a.sec) === sec) have[a.unit] = true; });
    levelsOf(sec).forEach(function (l) { if (have[l]) lv = l; });
    return lv;
  }

  function isSection(v) { return SECTIONS.indexOf(clean(v)) >= 0; }
  /** 集會、公告的對象：「全團」或分團名稱；空白＝小狼（舊資料） */
  function targetOf(v) { var x = clean(v); return x === ALL ? ALL : sectionOf(x); }
  /** 某個對象在某分團看不看得到：全團都看得到 */
  function targetIncludes(target, section) { var t = targetOf(target); return t === ALL || t === sectionOf(section); }
  /** 活動的對象可以複選分團（「童軍、行義」）或「全團」；空白＝小狼 */
  function parseTargets(v) {
    var x = clean(v);
    if (!x) return [DEFAULT_SECTION];
    if (x === ALL) return [ALL];
    var out = parseList(x).filter(function (s) { return SECTIONS.indexOf(s) >= 0; });
    return out.length ? out : [DEFAULT_SECTION];
  }
  function targetsInclude(list, section) { return list.indexOf(ALL) >= 0 || list.indexOf(sectionOf(section)) >= 0; }
  /** 職稱顯示：羅浮的團長稱「群長」（權限等級相同） */
  function leaderTitle(section) { return sectionOf(section) === '羅浮' ? '群長' : ROLE.LEADER; }
  /** 註冊申請的分團：空白＝小狼（舊資料）；「未指定」表示家長不確定，由管理員、總團或各分團團長指定 */
  function requestSectionOf(v) { var x = clean(v); return x === UNASSIGNED ? UNASSIGNED : sectionOf(x); }

  /**
   * 這個人可以進哪些分團的後台：[{section, role, scope}]（依 SECTIONS 順序）。
   * 管理員（admin 帳號）與總團在每個分團都是團長；其他人依管理員分頁的各分團身分。
   */
  function staffSections(rows, isOwner) {
    var mine = rows || [];
    var central = isOwner || mine.some(function (r) { return r.role === CENTRAL; });
    var out = [];
    SECTIONS.forEach(function (sec) {
      if (central) { out.push({ section: sec, role: ROLE.LEADER, scope: isOwner ? '管理員' : CENTRAL }); return; }
      var e = effectiveAdmins(mine, sec)[0];
      if (e) out.push({ section: sec, role: e.role, scope: sec });
    });
    return out;
  }
  /** 選要進的分團：指定的那個（有權限才算），否則優先小狼，再來第一個 */
  function pickSection(list, wanted) {
    var w = clean(wanted);
    var hit = list.filter(function (x) { return x.section === w; })[0];
    if (hit) return hit;
    return list.filter(function (x) { return x.section === DEFAULT_SECTION; })[0] || list[0] || null;
  }

  /** 全團共用的後台功能：由管理員（admin）指定誰可以用（附錄第 73 點，團長 2026-11-19 決定） */
  var SHARED_FUNCS = ['系統設定', '網站內容', '個資告知', '帳號管理', '備份'];
  var SHARED_LEVELS = ['管理員', CENTRAL, ROLE.LEADER];
  /**
   * ctx {isOwner, ownerExists, isCentral, role（目前分團的身分）}；level 為設定值
   * 沒有 admin 帳號時照舊：團長（含總團）都可以。
   */
  function canShared(level, ctx) {
    ctx = ctx || {};
    if (ctx.isOwner) return true;
    var leader = ctx.role === ROLE.LEADER || !!ctx.isCentral;
    if (!ctx.ownerExists) return leader;
    if (level === ROLE.LEADER) return leader;
    if (level === CENTRAL) return !!ctx.isCentral;
    return false;
  }

  /**
   * 從「管理員」分頁全部列（一人可有多列），算出在某分團有效的管理員，每個帳號一筆。
   * 總團在每個分團都視為團長（scope 標記為總團）；同一人有多列時取權限較高者。
   * rows: [{accountId, role, section, ...}]
   */
  function effectiveAdmins(rows, section) {
    var target = sectionOf(section), byId = {}, order = [];
    (rows || []).forEach(function (r) {
      var e = null;
      if (r.role === CENTRAL) e = Object.assign({}, r, { role: ROLE.LEADER, scope: CENTRAL });
      else if ((r.role === ROLE.LEADER || r.role === ROLE.ASSISTANT) && sectionOf(r.section) === target) e = Object.assign({}, r, { scope: target });
      if (!e) return;
      var cur = byId[r.accountId];
      if (!cur) { byId[r.accountId] = e; order.push(r.accountId); return; }
      if (cur.role !== ROLE.LEADER && e.role === ROLE.LEADER) byId[r.accountId] = e;
    });
    return order.map(function (id) { return byId[id]; });
  }

  /**
   * 分團身分異動（由管理員或總團在後台設定，SPEC 附錄第 68 點）。
   * rows：管理員分頁全部列；actor {accountId, isOwner, isCentral}；ownerId：最高管理員帳號ID，或多位的陣列（附錄第 79 點；沒有則空）
   * change {type: 'add'|'update'|'remove', targetId, section, role, title}
   */
  /** 最高管理員：單一帳號ID、陣列或「、」分隔的字串 → 陣列（附錄第 79 點最多 MAX_OWNERS 位） */
  var MAX_OWNERS = 3;
  function ownerList(v) {
    var list = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[、,，\s]+/);
    var out = [];
    list.forEach(function (x) { x = clean(x); if (x && out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  function validateStaffChange(rows, actor, change, ownerId) {
    rows = rows || []; actor = actor || {}; change = change || {};
    if (!actor.isOwner && !actor.isCentral) return { ok: false, error: '只有管理員或總團可以設定分團身分' };
    var role = clean(change.role);
    var section = role === CENTRAL ? '' : clean(change.section);
    if (change.type !== 'remove') {
      if (STAFF_ROLES.indexOf(role) < 0) return { ok: false, error: '身分只能是總團、團長或服務員' };
      if (role !== CENTRAL && SECTIONS.indexOf(section) < 0) return { ok: false, error: '請選擇分團' };
      if (clean(change.title).length > 20) return { ok: false, error: '職稱最多 20 個字' };
    }
    var owners = ownerList(ownerId);
    // 最高管理員的身分只有他自己能動（另一位最高管理員也不行；附錄第 79 點）
    if (owners.indexOf(change.targetId) >= 0 && actor.accountId !== change.targetId) return { ok: false, error: OWNER_LOCKED_MESSAGE };
    var key = function (r) { return r.role === CENTRAL ? CENTRAL : sectionOf(r.section); };
    var wantKey = role === CENTRAL ? CENTRAL : section;
    var mine = rows.filter(function (r) { return r.accountId === change.targetId; });
    var target = change.type === 'add' ? null : mine.filter(function (r) { return key(r) === clean(change.key || wantKey); })[0];
    if (change.type !== 'add' && !target) return { ok: false, error: '找不到這個身分' };
    if (change.type === 'add' && mine.some(function (r) { return key(r) === wantKey; })) return { ok: false, error: '這個人在這個分團已經有身分，請改用修改' };
    if (change.type === 'update' && wantKey !== key(target) && mine.some(function (r) { return key(r) === wantKey; })) return { ok: false, error: '這個人在這個分團已經有身分' };
    // 總團、團長只有管理員（admin）能指定或取消；沒有 admin 帳號時總團也可以
    var high = function (r) { return r && (r.role === CENTRAL || r.role === ROLE.LEADER); };
    if ((high({ role: role }) && change.type !== 'remove') || high(target)) {
      if (owners.length ? owners.indexOf(actor.accountId) < 0 : !actor.isCentral) return { ok: false, error: '只有最高管理員可以指定或取消總團、團長' };
    }
    // 小狼至少保留一位團長（總團也算）
    var after = rows.filter(function (r) { return r !== target; });
    if (change.type !== 'remove') after.push({ accountId: change.targetId, role: role, section: section });
    var leaders = effectiveAdmins(after, DEFAULT_SECTION).filter(function (a) { return a.role === ROLE.LEADER; }).length;
    if (!leaders) return { ok: false, error: '小狼至少要保留一位團長' };
    return { ok: true, row: target || null, section: section, role: role };
  }

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
    // [修補] 補回 UTF-8 BOM 移除（原 /^/ 遺失 \uFEFF）
    text = String(text).replace(/^\uFEFF/, '');
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
    { key: '晉級間隔月數', scope: 'cub', type: 'int', def: 6, min: 0, max: 24, desc: '狼、鹿、豹級距上一級頒發日期需滿幾個月' },
    { key: '晉級所需出席次數', scope: 'cub', type: 'int', def: 8, min: 0, max: 100, desc: '羚羊、狼、鹿、豹級：上一級頒發日之後需「出席」幾次（遲到算、請假不算、設為不計入進程的集會不算）；填 0 表示不要求' },
    { key: '體驗所需出席次數', scope: 'section', type: 'int', def: 4, min: 1, max: 20, desc: '體驗者參加幾次「一般」團集會後可以入團（遲到算；大活動、請假、不計入進程的集會不算）' },
    { key: '剛入團所需出席次數', scope: 'cub', type: 'int', def: 4, min: 0, max: 50, desc: '剛入團：入團後需「出席」幾次才能頒黃領巾（請假不算）；填 0 表示不要求' },
    { key: '小隊清單', scope: 'section', type: 'list', def: [], desc: '小隊名稱，用頓號「、」分隔，依此順序顯示（建議在後台「更多 → 小隊設定」修改）' },
    { key: '出席自動完成項目ID', scope: 'cub', type: 'str', def: 'P-羚羊-7', pattern: /^[PB]-\S+-\d+$/, desc: '出席滿次數後自動完成的項目（預設為羚羊「參加幼童軍團集會至少4次」）' },
    { key: '自動完成所需出席次數', scope: 'cub', type: 'int', def: 4, min: 1, max: 50, desc: '「出席」幾次後自動完成上面那一項（請假不算；進程項目只算上一級頒發後的出席）' },
    { key: '快達標門檻（剩幾項以內）', scope: 'cub', type: 'int', def: 2, min: 1, max: 10, desc: '' },
    { key: '未頒章再提醒天數', scope: 'cub', type: 'int', def: 14, min: 0, max: 365, desc: '填 0 表示不提醒' },
    { key: '每日排程時間（幾點）', type: 'int', def: 8, min: 0, max: 23, desc: '' },
    { key: '每週備份', type: 'bool', def: true, desc: '是/否' },
    { key: '備份保留份數', type: 'int', def: 8, min: 1, max: 52, desc: '' },
    { key: '離團後提醒處理個資的天數', type: 'int', def: 180, min: 0, max: 3650, desc: '填 0 表示不提醒' },
    { key: '允許外部網頁連線', type: 'bool', def: true, desc: '是：GitHub 等外部網頁也能連到後端（舊做法）。否：只有放在 GAS 上的網頁能用（鎖在 GAS）。請先確認 GAS 版網頁可以正常登入，再改成「否」' },
    { key: '每日註冊申請上限', type: 'int', def: 30, min: 5, max: 500, desc: '24 小時內最多幾個新帳號送出註冊申請，超過就暫停註冊（防止濫用）' }
  ];
  // 各分團自己的設定（附錄第 73 點⑥⑧）：小狼用原本的鍵，其他分團的鍵後面加「（分團）」；沒填就用預設值，不算錯誤
  SETTINGS.filter(function (s) { return s.scope === 'section'; }).forEach(function (s) {
    SECTIONS.filter(function (sec) { return sec !== DEFAULT_SECTION; }).forEach(function (sec) {
      SETTINGS.push({ key: s.key + '（' + sec + '）', base: s.key, section: sec, scope: 'section', optional: true, type: s.type, def: s.def, min: s.min, max: s.max, desc: sec + '：' + s.desc });
    });
  });
  // 進程模組的設定（附錄第 73 點⑩）：小狼用原本的鍵（scope 'cub'）；其他有進程的分團各一組，鍵後面加「（分團）」
  Object.keys(PROGRESS_MODULES).forEach(function (sec) {
    if (sec === DEFAULT_SECTION) return;
    var m = PROGRESS_MODULES[sec];
    var add = function (base, def, extra) {
      var s0 = SETTINGS.filter(function (x) { return x.key === base; })[0] || {};
      SETTINGS.push(Object.assign({ key: base + '（' + sec + '）', base: base, section: sec, scope: 'progress', optional: true, type: 'int', def: def, min: s0.min, max: s0.max, desc: sec + '：' + (s0.desc || '') }, extra || {}));
    };
    if (m.intervalLevels.length) add('晉級間隔月數', 6, { desc: sec + '：' + m.intervalLevels.join('、') + '級距上一級頒發日期需滿幾個月' });
    add('晉級所需出席次數', m.levelAttendDef === undefined ? 8 : m.levelAttendDef, { desc: sec + '：上一級頒發日之後需「出席」幾次才達標（遲到算、請假不算、設為不計入進程的集會不算）；填 0 表示不要求' });
    add('快達標門檻（剩幾項以內）', 2);
    add('未頒章再提醒天數', 14);
    if (m.deadlines) {
      m.levels.forEach(function (lv, i) {
        add('完成期限月數：' + lv, m.deadlines[lv], { min: 0, max: 60, desc: sec + '：' + (i === 0 ? '入團日' : '獲頒' + m.levels[i - 1] + '章') + '後幾個月內要完成' + lv + '級（只在後台提醒，不擋頒章）；填 0 表示不提醒' });
      });
      add('期限前幾天提醒', 30, { min: 0, max: 180, desc: sec + '：離完成期限剩幾天時列入「快到期」（後台首頁與團員頁）' });
    }
    if (m.minMonths) {
      m.levels.forEach(function (lv, i) {
        if (!(lv in m.minMonths)) return;
        add('晉級間隔月數：' + lv, m.minMonths[lv], { min: 0, max: 36, desc: sec + '：' + (i === 0 ? '入團日' : '獲頒' + m.levels[i - 1] + '章') + '後需滿幾個月才達標（未滿時頒章會再確認）；填 0 表示不要求' });
      });
    }
  });
  // 全團共用功能由誰使用（只有管理員 admin 可以改）
  SHARED_FUNCS.forEach(function (f) {
    SETTINGS.push({ key: '共用功能權限：' + f, scope: 'shared', optional: true, type: 'choice', options: SHARED_LEVELS, def: CENTRAL, desc: '誰可以用「' + f + '」：管理員＝只有 admin；總團＝admin 與總團；團長＝再加上各分團團長' });
  });
  /** 取某分團的設定值（小狼用原本的鍵） */
  function sectionSetting(values, key, section) {
    var sec = sectionOf(section);
    if (sec === DEFAULT_SECTION) return values[key];
    var v = values[key + '（' + sec + '）'];
    return v === undefined ? values[key] : v;
  }
  /** 某分團這個設定的實際鍵名 */
  function sectionSettingKey(key, section) { return sectionOf(section) === DEFAULT_SECTION ? key : key + '（' + sectionOf(section) + '）'; }

  /**
   * 某分團計算進程用的參數（交給 computeCubProgress；呼叫端再補 cubId、items 等資料）。
   * 只取這個分團模組用得到的設定：小狼才有剛入團與出席自動完成，稚齡才有完成期限。
   */
  function progressParams(values, section) {
    var sec = progressSec(section), m = progressModule(sec);
    if (!m) return null;
    var g = function (k) { return sectionSetting(values, k, sec); };
    var p = { section: sec, levelAttendCount: g('晉級所需出席次數') || 0, intervalMonths: m.intervalLevels.length ? (g('晉級間隔月數') || 0) : 0 };
    if (m.newbie) p.newbieAttendCount = values['剛入團所需出席次數'] || 0;
    if (m.autoItem) { p.autoItemId = values['出席自動完成項目ID']; p.autoCount = values['自動完成所需出席次數']; }
    if (m.deadlines) {
      p.deadlines = {};
      m.levels.forEach(function (lv) { p.deadlines[lv] = g('完成期限月數：' + lv) || 0; });
      p.deadlineWarnDays = g('期限前幾天提醒') || 0;
    }
    if (m.minMonths) {
      p.minMonths = {};
      Object.keys(m.minMonths).forEach(function (lv) { p.minMonths[lv] = g('晉級間隔月數：' + lv) || 0; });
    }
    return p;
  }

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
      if (s.type === 'choice') {
        var cv = f ? clean(f.value) : '';
        values[s.key] = s.options.indexOf(cv) >= 0 ? cv : s.def;
        return;
      }
      if (s.optional && (!f || clean(f.value) === '')) { values[s.key] = s.def; return; }
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

  /**
   * 後台設定頁：檢查單一設定值（SPEC 7.8）。小隊清單另有專屬頁面，不在這裡改。
   * @return {{ok: boolean, stored?: string, error?: string}} stored 為要寫入試算表的文字
   */
  function validateSettingValue(key, raw) {
    var s = SETTINGS.filter(function (x) { return x.key === key; })[0];
    if (!s || s.type === 'list') return { ok: false, error: '不支援修改這個設定' };
    var v = clean(raw);
    if (s.type === 'bool') return v === '是' || v === '否' ? { ok: true, stored: v } : { ok: false, error: key + '：只能選「是」或「否」' };
    if (s.type === 'choice') return s.options.indexOf(v) >= 0 ? { ok: true, stored: v } : { ok: false, error: key + '：只能選' + s.options.join('、') };
    if (s.type === 'str') return s.pattern.test(v) ? { ok: true, stored: v } : { ok: false, error: key + '：格式不正確' };
    var n = Number(v);
    if (!/^-?\d+$/.test(v) || n < s.min || n > s.max) return { ok: false, error: key + '：需為 ' + s.min + '～' + s.max + ' 的整數' };
    return { ok: true, stored: String(n) };
  }

  /** setup() 用：設定分頁初始內容（含標題列） */
  function defaultSettingsRows() {
    return [['鍵', '值', '說明']].concat(SETTINGS.filter(function (s) { return !s.optional; }).map(function (s) {
      return [s.key, s.type === 'bool' ? (s.def ? '是' : '否') : s.type === 'list' ? s.def.join('、') : s.def, s.desc];
    }));
  }

  // ───────────── 項目總表 ─────────────

  /**
   * 讀取項目總表（含標題列）並容錯：
   * 略過空白列、去除前後空白；項目ID 重複、缺少級別或章名、類別不對、啟用欄不是是/否時略過該列並回報列號。
   * 欄位：項目ID、類別、級別或章名、大項、項目內容、排序、啟用、分團（空白＝小狼；附錄第 77 點）
   * 回傳的 item.section 是「大項」（舊名稱沿用），分團放在 item.sec。
   */
  function parseItems(rows) {
    var items = [], errors = [], seen = {};
    (rows || []).slice(1).forEach(function (r, i) {
      var rowNo = i + 2;
      var cells = [0, 1, 2, 3, 4, 5, 6, 7].map(function (j) { return clean(r[j]); });
      if (cells.every(function (c) { return c === ''; })) return;
      var id = cells[0], cat = cells[1], unit = cells[2], section = cells[3] || NO_SECTION, text = cells[4];
      var order = Number(cells[5]), enabled = cells[6], sec = progressSec(cells[7]), mod = progressModule(sec);
      var reason = null;
      if (!id) reason = '缺少項目ID';
      else if (seen[id]) reason = '項目ID 重複（與第 ' + seen[id] + ' 列相同）';
      else if (cat !== CATEGORY.PROGRESS && cat !== CATEGORY.BADGE) reason = '類別只能是「進程」或「技能章」';
      else if (!unit) reason = '缺少級別或章名';
      else if (!isSection(sec)) reason = '分團只能是' + SECTIONS.join('、') + '（空白＝小狼）';
      else if (!mod) reason = sec + '還沒有進程模組';
      else if (cat === CATEGORY.PROGRESS && mod.levels.indexOf(unit) < 0) reason = sec + '的進程級別只能是' + mod.levels.join('、');
      else if (!text) reason = '缺少項目內容';
      else if (enabled !== '是' && enabled !== '否') reason = '啟用欄只能是「是」或「否」';
      if (reason) { errors.push({ row: rowNo, id: id, reason: reason }); return; }
      seen[id] = rowNo;
      items.push({
        id: id, category: cat, unit: unit, section: section, text: text, sec: sec,
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
  function nextItemId(existingIds, category, unit, section, sec) {
    var prefix;
    if (category === CATEGORY.PROGRESS) {
      prefix = (section && section !== NO_SECTION) ? 'P-' + unit + '-' + section + '-' : 'P-' + unit + '-';
    } else prefix = 'B-' + unit + '-';
    prefix = idPrefixOf(sec) + prefix; // 小狼沒有前綴；稚齡為「稚齡-P-地球-1」
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
   * @param sec 分團（小狼或空白：分團欄留空，沿用舊格式）
   * @return {{itemRows: Array, unitRows: Array}} 均不含標題列
   */
  function buildSeed(csvText, progressRules, sec) {
    var secCell = progressSec(sec) === DEFAULT_SECTION ? '' : progressSec(sec);
    var rows = parseCsv(csvText).slice(1);
    var ids = [], itemRows = [], units = {}, unitOrder = [];
    rows.forEach(function (r, i) {
      var cat = clean(r[0]), unit = clean(r[1]), third = clean(r[2]), text = clean(r[3]);
      if (cat === '專科章') cat = CATEGORY.BADGE; // 童軍行義的「專科章」在系統裡和技能章同一類，畫面上依分團改稱專科章
      var section = cat === CATEGORY.PROGRESS ? (third || NO_SECTION) : NO_SECTION;
      var id = nextItemId(ids, cat, unit, section, sec);
      ids.push(id);
      itemRows.push([id, cat, unit, section, text, (i + 1) * 10, '是', secCell]);
      if (!units[unit + '|' + cat]) {
        units[unit + '|' + cat] = true;
        unitOrder.push({ name: unit, category: cat, group: cat === CATEGORY.BADGE ? third : '' });
      }
    });
    var unitRows = unitOrder.map(function (u, i) {
      return [u.name, u.category, u.group, '', u.category === CATEGORY.PROGRESS ? ((progressRules || {})[u.name] || '') : '', (i + 1) * 10, secCell];
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
  /** 離團的原因（附錄第 69 點）：狀態維持「離團」，原因另外記 */
  var LEAVE_REASONS = ['不續團', '退團', '其他'];
  /** 正副小隊長：狼級以上才能擔任 */
  var CUB_ROLES = ['小隊長', '副小隊長'];
  var ROLE_LEVELS = ['狼', '鹿', '豹'];
  var MEETING_TYPES = ['一般', '大活動'];

  // ───────────── 活動報名（SPEC 附錄第 50 點） ─────────────
  var EVENT_IDENTITIES = ['小狼', '稚齡', '童軍', '家長', '服務員'];
  var EVENT_MAX_PER_ACCOUNT = 20;
  /** 報名表不可以問的內容：不收集機敏資訊 */
  var SENSITIVE_WORDS = ['電話', '手機', '地址', '住址', '身分證', '身份證', '生日', '出生', '護照', '病史', '銀行', '帳戶', '信用卡'];
  var STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  function isStamp(s) { return STAMP_RE.test(String(s || '')) && isDateStr(String(s).slice(0, 10)) && Number(String(s).slice(11, 13)) < 24 && Number(String(s).slice(14, 16)) < 60; }
  function multiline(v, max) { return String(v === null || v === undefined ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max); }

  /** 檢查團長設定的活動；questions = [{ label, type:'choice'|'text', options:[…], required }] */
  function validateEvent(req) {
    req = req || {};
    var title = clean(req.title);
    if (!title || title.length > 60) return { ok: false, error: '請填寫活動名稱（最多 60 字）。' };
    var date = clean(req.date), endDate = clean(req.endDate) || date;
    if (!isDateStr(date)) return { ok: false, error: '請填寫活動日期。' };
    if (!isDateStr(endDate) || endDate < date) return { ok: false, error: '活動結束日不可以早於開始日。' };
    var regStart = clean(req.regStart), regEnd = clean(req.regEnd);
    if (!isStamp(regStart) || !isStamp(regEnd)) return { ok: false, error: '請填寫開始報名與結束報名的時間。' };
    if (regEnd <= regStart) return { ok: false, error: '結束報名時間要晚於開始報名時間。' };
    var fee = req.fee === '' || req.fee === undefined || req.fee === null ? 0 : Number(req.fee);
    if (!isFinite(fee) || fee < 0 || fee > 1000000 || Math.floor(fee) !== fee) return { ok: false, error: '費用需為 0～1000000 的整數。' };
    var qs = Array.isArray(req.questions) ? req.questions : [];
    if (qs.length > 10) return { ok: false, error: '自訂題目最多 10 題。' };
    var out = [], seen = {}, err = '';
    qs.forEach(function (q, i) {
      if (err) return;
      var label = clean(q && q.label), no = '第 ' + (i + 1) + ' 題';
      if (!label || label.length > 60) { err = no + '：請填寫題目（最多 60 字）。'; return; }
      var bad = SENSITIVE_WORDS.filter(function (w) { return label.indexOf(w) >= 0; })[0];
      if (bad) { err = no + '：報名表不收集「' + bad + '」這類機敏資訊，請改用其他方式聯絡。'; return; }
      if (seen[label]) { err = no + '：題目重複了。'; return; }
      seen[label] = true;
      var type = q.type === 'choice' ? 'choice' : 'text', options = [];
      if (type === 'choice') {
        (Array.isArray(q.options) ? q.options : []).forEach(function (o) { o = clean(o).slice(0, 30); if (o && options.indexOf(o) < 0) options.push(o); });
        if (options.length < 2 || options.length > 10) { err = no + '：選擇題要有 2～10 個選項。'; return; }
      }
      out.push({ id: clean(q.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'q' + (i + 1), label: label, type: type, options: options, required: !!q.required });
    });
    if (err) return { ok: false, error: err };
    var ids = {};
    out.forEach(function (q, i) { if (ids[q.id]) q.id = 'q' + (i + 1) + 'x'; ids[q.id] = true; });
    return { ok: true, event: { title: title, desc: multiline(req.desc, 2000), date: date, endDate: endDate, regStart: regStart, regEnd: regEnd, fee: fee, questions: out } };
  }

  /** 檢查一次送出的報名：people = [{ name, identity, answers:{ 題目id: 答案 } }] */
  function validateEventPeople(people, questions) {
    if (!Array.isArray(people) || !people.length) return { ok: false, error: '請至少填寫一位。' };
    if (people.length > 10) return { ok: false, error: '一次最多報名 10 位，請分兩次送出。' };
    var out = [], names = {}, err = '';
    people.forEach(function (p, i) {
      if (err) return;
      var no = '第 ' + (i + 1) + ' 位', name = clean(p && p.name), identity = clean(p && p.identity);
      if (!name || name.length > 30) { err = no + '：請填寫姓名。'; return; }
      if (EVENT_IDENTITIES.indexOf(identity) < 0) { err = no + '（' + name + '）：請選擇身分別。'; return; }
      if (names[name]) { err = '「' + name + '」重複了。'; return; }
      names[name] = true;
      var ans = {}, src = (p && p.answers) || {};
      (questions || []).forEach(function (q) {
        if (err) return;
        var v = clean(src[q.id]).slice(0, 100);
        if (!v) { if (q.required) err = no + '（' + name + '）：請回答「' + q.label + '」。'; return; }
        if (q.type === 'choice' && q.options.indexOf(v) < 0) { err = no + '（' + name + '）：「' + q.label + '」請從選項中選擇。'; return; }
        ans[q.id] = v;
      });
      if (!err) out.push({ name: name, identity: identity, answers: ans });
    });
    return err ? { ok: false, error: err } : { ok: true, people: out };
  }

  /** 章的圖片：前端縮小後的 data URL（png／jpeg／webp），放得進試算表一格 */
  function isUnitImage(s) { return typeof s === 'string' && s.length <= 45000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/]+=*$/.test(s); }

  /**
   * 體驗者的進度：只算「一般」且「計入進程」的團集會出席（遲到算出席；大活動、請假不算）。
   * @param {Array<{date, status, type}>} records
   * @return {{count: number, need: number, ready: boolean, readyDate: string|null}}
   */
  function trialProgress(records, need) {
    var dates = (records || []).filter(function (a) { return isPresent(a.status) && a.counts !== false && (a.type || '一般') === '一般' && isDateStr(a.date); })
      .map(function (a) { return a.date; }).sort();
    return { count: dates.length, need: need, ready: dates.length >= need, readyDate: dates.length >= need ? dates[need - 1] : null };
  }

  // ───────────── 註冊申請（SPEC 附錄第 31 點） ─────────────

  var IDENTITY = { PARENT: '家長', STAFF: '服務員', ROVER_SELF: '羅浮本人' };
  /** 成年的本人帳號（附錄第 73 點⑱⑲）：羅浮本人自己註冊、用成年人版個資告知，權限和家長一樣 */
  var ADULT_SELF_SECTIONS = ['羅浮'];
  var ROVER_AUDIENCE = '羅浮本人';
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
   *  - section: 分團（空白＝小狼）；只算這個分團的項目與頒章，級別與規則依該分團的進程模組（progressParams 產生其餘參數）
   *  - deadlines／deadlineWarnDays／joinDate：有完成期限的分團（稚齡）用
   * @return {{units: Array, currentLevel: string|null, nextLevel: string|null}}
   */
  function computeCubProgress(p) {
    var cubId = p.cubId;
    var sec = progressSec(p.section), M = progressModule(sec) || PROGRESS_MODULES[DEFAULT_SECTION], LV = M.levels;
    var done = {};
    (p.completions || []).forEach(function (c) {
      if (c.cubId !== cubId || !isCountedCompletion(c)) return;
      // 同一項目若有多筆，取最早日期
      if (!done[c.itemId] || c.date < done[c.itemId].date) done[c.itemId] = c;
    });
    // 出席（含遲到；請假不算；集會設為「不計入進程」的不算）的日期，由舊到新；呼叫端只傳這位小狼、啟用中集會的紀錄
    var attended = (p.attendance || []).filter(function (a) { return isPresent(a.status) && a.counts !== false && isDateStr(a.date); })
      .map(function (a) { return a.date; }).sort();
    var awarded = {};
    // 頒章紀錄依分團分開（稚齡和小狼都有「種植」章；升團後舊分團的章不會算到新分團）
    (p.awards || []).forEach(function (a) { if (a.cubId === cubId && progressSec(a.sec) === sec) awarded[a.unit] = a; });
    // 「剛入團」是後來加的一級：已經拿到羚羊以上的小狼，視為已通過剛入團（不寫入頒章紀錄）。
    // 舊生用補登剛入團，不設「啟用基準日」（SPEC 附錄第 64、65 點）
    if (M.newbie && !awarded[NEWBIE] && LEVELS.slice(1).some(function (lv) { return awarded[lv]; })) {
      awarded[NEWBIE] = { cubId: cubId, unit: NEWBIE, date: null, occasion: '已晉級（視為通過）', implicit: true };
    }
    // 出席滿次數 → 自動完成指定項目（計算而得，不寫入完成紀錄；出席被修改時自動重算）。
    // 項目屬於某一級進程時，只算「上一級頒發日之後（不含當天）」的出席；上一級還沒頒發就不自動完成
    //（SPEC 附錄第 64 點：羚羊的「參加團集會至少4次」從剛入團頒發後才開始算）。視為通過、沒有日期的上一級：全部出席都算。
    if (M.autoItem && p.autoItemId && p.autoCount > 0) {
      var autoIt = (p.items || []).filter(function (it) { return it.id === p.autoItemId; })[0];
      var autoPool = attended, li = autoIt && autoIt.category === CATEGORY.PROGRESS ? LEVELS.indexOf(autoIt.unit) : -1;
      if (li > 0) {
        var pa = awarded[LEVELS[li - 1]];
        autoPool = !pa ? [] : (pa.date ? attended.filter(function (d) { return d > pa.date; }) : attended);
      }
      if (autoPool.length >= p.autoCount) {
        var autoDate = autoPool[p.autoCount - 1];
        if (!done[p.autoItemId] || autoDate < done[p.autoItemId].date) {
          done[p.autoItemId] = { date: autoDate, signer: '出席自動計算', auto: true };
        }
      }
    }

    var currentLevel = null;
    LV.forEach(function (lv) { if (awarded[lv]) currentLevel = lv; });
    var nextLevel = currentLevel === null ? LV[0] : (LV[LV.indexOf(currentLevel) + 1] || null);

    // 依類別與名稱分組（只算這個分團的啟用項目）
    var groups = {}, order = [];
    (p.items || []).forEach(function (it) {
      if (!it.enabled || progressSec(it.sec) !== sec) return;
      var k = it.category + '|' + it.unit;
      if (!groups[k]) { groups[k] = { category: it.category, unit: it.unit, items: [] }; order.push(k); }
      groups[k].items.push(it);
    });
    // 進程各級即使沒有項目也要列出
    LV.forEach(function (lv) {
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
      // 擇一規則（羅浮）：完成度改用「要完成的項目」計算
      var rule = g.category === CATEGORY.PROGRESS && M.levelRules ? M.levelRules[g.unit] : null;
      if (rule && total) {
        var lr = levelRuleProgress(itemStates, rule);
        total = lr.total; doneCount = lr.done; dates = lr.dates;
      }
      var allDone = total > 0 && doneCount >= total;
      var award = awarded[g.unit] && (g.category === CATEGORY.PROGRESS ? LV.indexOf(g.unit) >= 0 : true) ? awarded[g.unit] : null;
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
        var isNb = M.newbie && g.unit === NEWBIE;
        var e = eligibility(g.category, g.unit, allDone, u.lastCompletionDate, awarded, p.intervalMonths, p.today,
          isNb && p.newbieAfter ? attended.filter(function (d) { return d > p.newbieAfter; }) : attended,
          isNb ? (p.newbieAttendCount || 0) : (p.levelAttendCount || 0), M, p.minMonths, p.joinDate);
        u.eligible = e.eligible; u.eligibleDate = e.date; u.waitingUntil = e.waitingUntil || null;
        if (e.attendRequired) { u.attendRequired = e.attendRequired; u.attendSinceLast = e.attendSinceLast; }
        // 完成期限（稚齡；附錄第 73 點⑨：只提醒、不擋頒章）：只看正在挑戰的那一級
        if (g.category === CATEGORY.PROGRESS && g.unit === nextLevel && p.deadlines) {
          var dl = levelDeadline(LV, g.unit, awarded, p.joinDate, p.deadlines[g.unit]);
          if (dl) {
            u.deadline = dl;
            u.deadlineState = p.today > dl ? 'over' : (p.deadlineWarnDays > 0 && addDays(p.today, p.deadlineWarnDays) >= dl ? 'soon' : '');
          }
        }
      }
      return u;
    });
    return { units: units, currentLevel: currentLevel, nextLevel: nextLevel, section: sec };
  }

  /**
   * 擇一規則的完成度（附錄第 80 點，羅浮）：
   *  - anyGroup：任一個大項的項目全部完成即可（見習羅浮途徑1／途徑2）；顯示最接近完成的那一組
   *  - pickOne：列出的大項裡任選一項完成即可，其他大項全部要完成（服務羅浮的主題活動）
   */
  function levelRuleProgress(items, rule) {
    var bySec = {}, order = [];
    items.forEach(function (it) { if (!bySec[it.section]) { bySec[it.section] = []; order.push(it.section); } bySec[it.section].push(it); });
    var datesOf = function (list) { return list.filter(function (i) { return i.done; }).map(function (i) { return i.date; }); };
    if (rule.anyGroup) {
      var best = null;
      order.forEach(function (k) {
        var list = bySec[k], d = list.filter(function (i) { return i.done; }).length;
        var score = d / list.length;
        if (!best || score > best.score || (score === best.score && list.length < best.list.length)) best = { score: score, list: list, done: d };
      });
      return { total: best.list.length, done: best.done, dates: datesOf(best.list) };
    }
    var pick = rule.pickOne || [], req = [], opt = [];
    items.forEach(function (it) { (pick.indexOf(it.section) >= 0 ? opt : req).push(it); });
    var optDone = opt.filter(function (i) { return i.done; });
    var firstOpt = optDone.map(function (i) { return i.date; }).sort()[0];
    return {
      total: req.length + (opt.length ? 1 : 0),
      done: req.filter(function (i) { return i.done; }).length + (optDone.length ? 1 : 0),
      dates: datesOf(req).concat(firstOpt ? [firstOpt] : [])
    };
  }

  /** 完成期限：第一級從入團日起算、其餘從上一級頒發日起算 + 月數；沒有起算日或月數為 0 時回 null */
  function levelDeadline(levels, unit, awarded, joinDate, months) {
    if (!(months > 0)) return null;
    var i = levels.indexOf(unit);
    var base = i === 0 ? joinDate : (awarded[levels[i - 1]] && awarded[levels[i - 1]].date);
    return isDateStr(base) ? addMonths(base, months) : null;
  }

  /** 加 n 天（'YYYY-MM-DD'） */
  function addDays(dateStr, n) {
    var p = dateStr.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /**
   * 達標（可頒章）判定：
   *  - 技能章：啟用項目全部完成。
   *  - 剛入團：全部完成，且入團後出席次數 ≥ 剛入團所需出席次數。
   *  - 羚羊、狼、鹿、豹：全部完成，且上一級已頒發，且上一級頒發日「之後」（不含當天）出席次數 ≥ 晉級所需出席次數
   *    （0 表示不要求；請假不算）；狼、鹿、豹另需今天 ≥ 上一級頒發日期 + 間隔月數。
   * 回傳的 date 是「達標日期」= 以上各條件都滿足的最早日期。
   */
  function eligibility(category, unit, allDone, lastDate, awarded, intervalMonths, today, attended, attendNeed, mod, minMonths, joinDate) {
    if (!allDone) return { eligible: false, date: null };
    if (category === CATEGORY.BADGE) return { eligible: true, date: lastDate };
    var M = mod || PROGRESS_MODULES[DEFAULT_SECTION], LV = M.levels;
    var prevDate = '', date = lastDate;
    if (unit !== LV[0]) {
      var prev = LV[LV.indexOf(unit) - 1];
      if (!awarded[prev]) return { eligible: false, date: null, reason: '上一級尚未頒發' };
      prevDate = awarded[prev].date || '';
      // [修補] 確保 prevDate 為合法日期字串再計算 addMonths，避免產生 NaN-NaN-NaN
      if (minMonths && minMonths[unit] > 0 && isDateStr(prevDate)) {
        var readyM = addMonths(prevDate, minMonths[unit]);
        if (readyM > date) date = readyM;
      }
      if (M.intervalLevels.indexOf(unit) >= 0 && isDateStr(prevDate)) {
        var ready = addMonths(prevDate, intervalMonths || 0);
        if (ready > date) date = ready;
      }
    } else if (minMonths && minMonths[unit] > 0 && isDateStr(joinDate)) {
      // 第一級（童軍初級）：入團日後需滿 N 個月
      var readyJ = addMonths(joinDate, minMonths[unit]);
      if (readyJ > date) date = readyJ;
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

  /** 點名狀態（SPEC 附錄第 61 點）：遲到算出席，只是多一個標記；空白＝沒有紀錄，不記缺席 */
  var ATTEND_MARKS = ['出席', '遲到', '請假'];
  function isPresent(status) { return status === '出席' || status === '遲到'; }

  /** 出席統計：出席（含遲到）與請假分開計算；late 是其中遲到的次數。不看「計入進程」（出席率照算） */
  function attendanceCounts(records) {
    var r = { attended: 0, leave: 0, late: 0 };
    (records || []).forEach(function (a) {
      if (isPresent(a.status)) { r.attended++; if (a.status === '遲到') r.late++; }
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
    var items = (p.items || []).filter(function (it) { return it.enabled && it.unit === p.unit && it.category === p.category && progressSec(it.sec) === progressSec(p.section); });
    var doneIds = {};
    (p.completions || []).forEach(function (c) { if (c.cubId === p.cubId && isCountedCompletion(c)) doneIds[c.itemId] = true; });
    var newCompletions = items.filter(function (it) { return !doneIds[it.id]; }).map(function (it) {
      return { cubId: p.cubId, itemId: it.id, date: p.date, signer: p.signer, note: '上線補登', reporter: '', reportStatus: '' };
    });
    var sec = progressSec(p.section), LV = (progressModule(sec) || PROGRESS_MODULES[DEFAULT_SECTION]).levels;
    var awardedUnits = {};
    (p.awards || []).forEach(function (a) { if (a.cubId === p.cubId && progressSec(a.sec) === sec) awardedUnits[a.unit] = true; });
    var missingLower = [];
    if (p.category === CATEGORY.PROGRESS) {
      LV.slice(0, LV.indexOf(p.unit)).forEach(function (lv) { if (!awardedUnits[lv]) missingLower.push(lv); });
    }
    return {
      alreadyAwarded: !!awardedUnits[p.unit],
      award: { cubId: p.cubId, unit: p.unit, date: p.date, occasion: p.occasion || '', note: '上線補登', signer: p.signer, sec: progressSec(p.section) },
      newCompletions: newCompletions,
      missingLowerLevels: missingLower,
      notify: false // 補登不觸發任何推播
    };
  }

  /**
   * 把字串裡的 name 換成 rep，但落在 longer（包含 name 的其他姓名）裡面的那幾段不換。
   * 例如 name＝陳宇、longer＝[陳宇軒]：「陳宇、陳宇軒」→「rep、陳宇軒」。
   */
  function replaceNameOnly(str, name, rep, longer) {
    var protect = [];
    (longer || []).forEach(function (n) {
      for (var i = str.indexOf(n); i >= 0; i = str.indexOf(n, i + 1)) protect.push([i, i + n.length]);
    });
    var out = '', pos = 0;
    for (var j = str.indexOf(name); j >= 0; j = str.indexOf(name, j + 1)) {
      if (j < pos) continue;
      var inside = protect.some(function (p) { return j >= p[0] && j + name.length <= p[1]; });
      if (inside) continue;
      out += str.slice(pos, j) + rep;
      pos = j + name.length;
    }
    return out + str.slice(pos);
  }

  /** 撤銷進程頒章後，目前級別退回「剩下已頒發中最高的一級」 */
  function levelAfterRevoke(awardsOfCub, revokedUnit, section) {
    var lv = null;
    levelsOf(section).forEach(function (l) {
      if (l !== revokedUnit && awardsOfCub.some(function (a) { return a.unit === l && progressSec(a.sec) === progressSec(section); })) lv = l;
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
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
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
    manageEvents: [ROLE.LEADER],
    privacy: [ROLE.LEADER],
    backup: [ROLE.LEADER],
    reviewRequests: [ROLE.LEADER],
    manageSquadStaff: [ROLE.LEADER],
    manageRoles: [ROLE.LEADER],
    postNotice: [ROLE.LEADER, ROLE.ASSISTANT]
  };

  // ───────────── 動態分頁與內容權限設定（不同權限顯示不同分頁與內容） ─────────────
  var PERM_LEVELS = ['管理員', CENTRAL, ROLE.LEADER, ROLE.ASSISTANT, '家長', '已登入', '公開', '停用'];
  var ADMIN_PERM_LEVELS = ['管理員', CENTRAL, ROLE.LEADER, ROLE.ASSISTANT, '停用'];
  var PUBLIC_PERM_LEVELS = ['公開', '已登入', '僅家長以上', '僅管理員', '停用'];
  var PARENT_PERM_LEVELS = [SCOUT_SELF, '家長', '僅管理員', '停用'];

  /**
   * 系統可設定的分頁與功能清單（由總團／管理員於後台「權限與分頁設定」調整）。
   * - id：前端分頁／功能代碼
   * - group：六大分類（公開與成員內容／家長與童軍本人功能／分團日常團務／分團團員與幹部／進程與頒章管理／總團管理與移交）
   * - def：預設最低權限
   * - options：允許調整的權限選項
   * - actions：對應後端 PERMISSIONS 動作代碼
   * - sharedFunc：若對應原本 SHARED_FUNCS，則與系統設定共用功能連動
   * - locked：true 表示管理員與總團永遠保有存取權，防止誤鎖自己
   */
  var PERM_FEATURES = [
    // 1. 公開與成員瀏覽內容（各分團登入者僅看自己分團與全團）
    { id: 'pub_about', name: '認識 22 團（簡介）', group: '公開與成員內容', scope: 'public', def: '公開', options: PUBLIC_PERM_LEVELS, actions: [] },
    { id: 'pub_notices', name: '公佈欄', group: '公開與成員內容', scope: 'public', def: '公開', options: PUBLIC_PERM_LEVELS, actions: [] },
    { id: 'pub_calendar', name: '集會時間與月曆', group: '公開與成員內容', scope: 'public', def: '公開', options: PUBLIC_PERM_LEVELS, actions: [] },
    { id: 'pub_progress', name: '進程總表查詢', group: '公開與成員內容', scope: 'public', def: '公開', options: PUBLIC_PERM_LEVELS, actions: [] },
    { id: 'pub_badges', name: '技能章總表查詢', group: '公開與成員內容', scope: 'public', def: '公開', options: PUBLIC_PERM_LEVELS, actions: [] },
    // 2. 家長與童軍本人專屬功能（童軍／行義／羅浮本人帳號僅看自己）
    { id: 'member_progress', name: '個人進程與徽章紀錄', group: '家長與童軍本人功能', scope: 'parent', def: SCOUT_SELF, options: PARENT_PERM_LEVELS, actions: [] },
    { id: 'member_attendance', name: '個人出席與集點紀錄', group: '家長與童軍本人功能', scope: 'parent', def: SCOUT_SELF, options: PARENT_PERM_LEVELS, actions: [] },
    { id: 'parent_leave', name: '線上請假申請', group: '家長與童軍本人功能', scope: 'parent', def: '家長', options: PARENT_PERM_LEVELS, actions: [] },
    { id: 'parent_events', name: '線上活動報名', group: '家長與童軍本人功能', scope: 'parent', def: '家長', options: PARENT_PERM_LEVELS, actions: [] },
    { id: 'parent_create_scout', name: '家長建立童軍本人帳號', group: '家長與童軍本人功能', scope: 'parent', def: '家長', options: ['家長', '僅管理員', '停用'], actions: [] },
    // 3. 分團日常團務（各分團嚴格隔離）
    { id: 'tab_home', name: '後台首頁與待辦總覽', group: '分團日常團務', scope: 'admin', def: ROLE.ASSISTANT, options: ADMIN_PERM_LEVELS, actions: ['viewOverview'] },
    { id: 'tab_attendance', name: '集會點名', group: '分團日常團務', scope: 'admin', def: ROLE.ASSISTANT, options: ADMIN_PERM_LEVELS, actions: ['attendance'] },
    { id: 'tab_calendar', name: '行事曆與年度出席', group: '分團日常團務', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['manageCalendar'] },
    { id: 'tab_notices', name: '公告發布與管理', group: '分團日常團務', scope: 'admin', def: ROLE.ASSISTANT, options: ADMIN_PERM_LEVELS, actions: ['postNotice'] },
    { id: 'tab_events', name: '活動管理與繳費', group: '分團日常團務', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['manageEvents'] },
    // 4. 分團團員與幹部（各分團嚴格隔離）
    { id: 'tab_roster', name: '團員名單檢視', group: '分團團員與幹部', scope: 'admin', def: ROLE.ASSISTANT, options: ADMIN_PERM_LEVELS, actions: ['viewRoster'] },
    { id: 'tab_cubs_manage', name: '團員異動與綁定碼', group: '分團團員與幹部', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['manageCubs', 'manageBindCodes'] },
    { id: 'tab_requests', name: '註冊申請審核', group: '分團團員與幹部', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['reviewRequests'] },
    { id: 'tab_squads', name: '小隊與小隊輔設定', group: '分團團員與幹部', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['manageSquadStaff', 'manageRoles'] },
    { id: 'tab_admins', name: '分團正副團長與服務員管理', group: '分團團員與幹部', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['manageAdmins', 'manageInvites'] },
    { id: 'tab_privacy', name: '離團個資處理', group: '分團團員與幹部', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['privacy'] },
    // 5. 進程與頒章管理（依分團進程模組）
    { id: 'tab_signoff', name: '進程簽核與撤銷自簽', group: '進程與頒章管理', scope: 'admin', def: ROLE.ASSISTANT, options: ADMIN_PERM_LEVELS, actions: ['signoff', 'revokeOwnSignoff'] },
    { id: 'tab_signoff_revoke_any', name: '撤銷他人簽核', group: '進程與頒章管理', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['revokeAnySignoff'] },
    { id: 'tab_award', name: '頒章與上線補登', group: '進程與頒章管理', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['award', 'backfill'] },
    { id: 'tab_print', name: '列印進程簽核單', group: '進程與頒章管理', scope: 'admin', def: ROLE.ASSISTANT, options: ADMIN_PERM_LEVELS, actions: ['printSheet'] },
    { id: 'tab_items', name: '進程項目與章圖管理', group: '進程與頒章管理', scope: 'admin', def: ROLE.LEADER, options: ADMIN_PERM_LEVELS, actions: ['manageItems'] },
    // 6. 總團管理與移交中心（僅總團／管理員）
    // 只管「全團」的系統參數；各分團自己的設定（小隊、體驗次數、小狼進程設定）仍由該分團團長在設定頁修改（附錄第 74 點）
    { id: 'tab_settings', name: '全團系統參數設定', group: '總團管理與移交', scope: 'admin', def: CENTRAL, options: SHARED_LEVELS, actions: [], sharedFunc: '系統設定' },
    { id: 'tab_site', name: '網站公開內容設定', group: '總團管理與移交', scope: 'admin', def: CENTRAL, options: SHARED_LEVELS, actions: [], sharedFunc: '網站內容' },
    { id: 'tab_consent', name: '個資告知條款管理', group: '總團管理與移交', scope: 'admin', def: CENTRAL, options: SHARED_LEVELS, actions: [], sharedFunc: '個資告知' },
    { id: 'tab_accounts', name: '全團帳號總管', group: '總團管理與移交', scope: 'admin', def: CENTRAL, options: SHARED_LEVELS, actions: [], sharedFunc: '帳號管理' },
    { id: 'tab_backup', name: '資料備份與權限檢查', group: '總團管理與移交', scope: 'admin', def: CENTRAL, options: SHARED_LEVELS, actions: [], sharedFunc: '備份' },
    { id: 'tab_permissions', name: '權限與分頁設定', group: '總團管理與移交', scope: 'admin', def: CENTRAL, options: ['管理員', CENTRAL], actions: ['managePermissions'], locked: true },
    { id: 'tab_handover', name: '團務移交與交接中心', group: '總團管理與移交', scope: 'admin', def: CENTRAL, options: ['管理員', CENTRAL], actions: ['manageHandover'] }
  ];

  function defaultPermRows() {
    return [['功能代碼', '功能名稱', '分類', '最低權限', '停用分團', '更新人', '更新時間']].concat(PERM_FEATURES.map(function (f) {
      return [f.id, f.name, f.group, f.def, '', '系統預設', ''];
    }));
  }

  /**
   * 解析「權限設定」分頁；缺少或無效列退回預設。
   * rows：試算表讀出的二維陣列（第一列是標題）或 [{id, level, disabledSections}]。
   * settingsValues：設定分頁的值；分頁裡沒有這一列的共用功能，沿用「共用功能權限：○○」（附錄第 74 點）
   */
  function parsePermRules(rows, settingsValues) {
    var byId = {};
    (rows || []).forEach(function (r, i) {
      var o = Array.isArray(r) ? { id: r[0], level: r[3], disabledSections: r[4] } : r;
      if (Array.isArray(r) && i === 0 && clean(r[0]) === '功能代碼') return;
      var id = clean(o && o.id);
      if (id) byId[id] = o;
    });
    var rules = {};
    PERM_FEATURES.forEach(function (f) {
      var row = byId[f.id];
      var fallback = f.def;
      if (f.sharedFunc && settingsValues) {
        var sv = clean(settingsValues['共用功能權限：' + f.sharedFunc]);
        if (f.options.indexOf(sv) >= 0) fallback = sv;
      }
      var lv = row && f.options.indexOf(clean(row.level)) >= 0 ? clean(row.level) : fallback;
      var dis = row ? parseList(row.disabledSections).filter(function (s) { return SECTIONS.indexOf(s) >= 0; }) : [];
      rules[f.id] = {
        id: f.id, name: f.name, group: f.group, scope: f.scope,
        level: lv, options: f.options.slice(), actions: f.actions.slice(),
        sharedFunc: f.sharedFunc || '', locked: !!f.locked,
        disabledSections: f.locked ? [] : dis
      };
    });
    return rules;
  }

  function validatePermUpdate(id, level, disabledSections) {
    var feat = PERM_FEATURES.filter(function (f) { return f.id === clean(id); })[0];
    if (!feat) return { ok: false, error: '找不到功能代碼：' + clean(id) };
    var lv = clean(level);
    if (feat.options.indexOf(lv) < 0) return { ok: false, error: '「' + feat.name + '」的權限選項不正確：' + lv };
    var dis = [];
    if (!feat.locked && disabledSections) {
      var raw = Array.isArray(disabledSections) ? disabledSections : parseList(disabledSections);
      raw.forEach(function (s) {
        var c = clean(s);
        if (SECTIONS.indexOf(c) >= 0 && dis.indexOf(c) < 0) dis.push(c);
      });
    }
    return { ok: true, feature: feat, level: lv, disabledSections: dis };
  }

  /**
   * 判斷指定使用者（或訪客）在特定分團下是否能看到／使用某功能。
   * - 總團、管理員永遠看到所有內容（除非該功能為「停用」，且鎖定項永遠開放給總團／管理員）
   * - 各分團正副團長、服務員、家長、童軍本人皆受「停用分團」與分團隔離規則限制
   */
  function allowsFeature(rule, ctx) {
    ctx = ctx || {};
    var sec = ctx.section ? sectionOf(ctx.section) : '';
    var isAdmin = !!ctx.isOwner || !!ctx.isCentral || ctx.role === ROLE.LEADER || ctx.role === ROLE.ASSISTANT;
    var isTop = !!ctx.isOwner || !!ctx.isCentral;
    if (rule.locked && (ctx.isOwner || (rule.level === CENTRAL && ctx.isCentral) || (!ctx.ownerExists && ctx.isCentral))) return true;
    if (rule.level === '停用') return false;
    if (sec && rule.disabledSections && rule.disabledSections.indexOf(sec) >= 0 && !isTop) return false;
    if (rule.scope === 'public') {
      if (rule.level === '公開') return true;
      if (rule.level === '已登入') return !!ctx.loggedIn;
      if (rule.level === '僅家長以上') return !!ctx.loggedIn && (!!ctx.isParent || isAdmin);
      if (rule.level === '僅管理員') return isAdmin;
      return false;
    }
    if (rule.scope === 'parent') {
      if (rule.level === SCOUT_SELF) return !!ctx.loggedIn && (!!ctx.isScoutSelf || !!ctx.isParent || isAdmin);
      if (rule.level === '家長') return !!ctx.loggedIn && (!!ctx.isParent || isAdmin);
      if (rule.level === '僅管理員') return isAdmin;
      return false;
    }
    // admin scope
    if (!isAdmin) return false;
    if (ctx.isOwner) return true;
    // 還沒有最高管理員帳號時照舊：總團與團長都可以（附錄第 46、74 點）
    if (!ctx.ownerExists && (rule.level === '管理員' || rule.level === CENTRAL)) return !!ctx.isCentral || ctx.role === ROLE.LEADER;
    if (rule.level === '管理員') return false;
    if (rule.level === CENTRAL) return !!ctx.isCentral;
    if (rule.level === ROLE.LEADER) return !!ctx.isCentral || ctx.role === ROLE.LEADER;
    if (rule.level === ROLE.ASSISTANT) return true;
    return false;
  }

  /** 算出登入者（或訪客）完整可用的分頁與後端動作表 */
  function resolvePermissions(rules, ctx) {
    var tabs = {}, visibleTabs = [], actions = {};
    PERM_FEATURES.forEach(function (f) {
      var rule = (rules && rules[f.id]) || { id: f.id, scope: f.scope, level: f.def, disabledSections: [], actions: f.actions, locked: !!f.locked };
      var ok = allowsFeature(rule, ctx);
      tabs[f.id] = ok;
      if (ok) visibleTabs.push(f.id);
      (f.actions || []).forEach(function (act) { actions[act] = ok; });
    });
    return { tabs: tabs, visibleTabs: visibleTabs, actions: actions };
  }

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
  var OWNER_ONLY_MESSAGE = '只有最高管理員可以指定或取消團長。';
  var OWNER_LOCKED_MESSAGE = '這是最高管理員的帳號，只有他自己能更動。';
  function validateAdminChange(admins, actorId, change, ownerId) {
    var actor = (admins || []).filter(function (a) { return a.accountId === actorId; })[0];
    if (!actor || actor.role !== ROLE.LEADER) return { ok: false, error: '只有團長可以管理管理員' };
    var target = admins.filter(function (a) { return a.accountId === change.targetId; })[0];
    // 總團身分不在這裡改（SPEC 附錄第 68 點：在「分團身分」設定）
    if (target && target.scope === CENTRAL && change.type !== 'add') return { ok: false, error: '這位是總團，請到「分團身分」調整' };
    var leaders = admins.filter(function (a) { return a.role === ROLE.LEADER; }).length;
    var owners = ownerList(ownerId);
    if (owners.length) {
      if (owners.indexOf(change.targetId) >= 0 && change.type !== 'add') return { ok: false, error: OWNER_LOCKED_MESSAGE };
      var touchesLeader = change.role === ROLE.LEADER || (target && target.role === ROLE.LEADER && change.type !== 'add');
      if (touchesLeader && owners.indexOf(actorId) < 0) return { ok: false, error: OWNER_ONLY_MESSAGE };
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
    '職務紀錄': 0,
    '升團紀錄': 0, // 附錄第 80 點
    '年度登記': 2 //  附錄第 80 點：對象ID（童軍登記的那一列）
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
      while (row.length < 12) row.push('');
      replacement = '已離團小狼' + serial;
      // [修補] 匿名化時一併清除職務欄（row[10]），避免殘留小隊長標記
      row[1] = replacement; row[2] = ''; row[5] = ''; row[6] = 0; row[7] = '已匿名'; row[10] = '';
      upd['小狼名單'] = [{ row: cubRowIdx + 1, values: row }];
      counts['小狼名單'] = 1;
      del['綁定紀錄'] = rowsOf('綁定紀錄');
      counts['綁定紀錄'] = del['綁定紀錄'].length;
    } else return { ok: false, error: '不支援的處理方式' };

    // 操作日誌中出現該小狼姓名的地方一律替換（對象、修改前、修改後三欄）。
    // 其他團員的姓名包含這個名字時（例如「陳宇」與「陳宇軒」）那一段不動（附錄第 78 點）
    var logUpd = [];
    var longer = cubRows.slice(1).map(function (r, i) { return i + 1 === cubRowIdx ? '' : clean(r[1]); })
      .filter(function (n) { return n && n !== cubName && n.indexOf(cubName) >= 0; });
    if (cubName) {
      (data['操作日誌'] || []).forEach(function (r, idx) {
        if (idx === 0) return;
        var changed = false, v = r.slice();
        [3, 4, 5].forEach(function (c) {
          var s = v[c] === null || v[c] === undefined ? '' : String(v[c]);
          if (s.indexOf(cubName) >= 0) {
            var out = replaceNameOnly(s, cubName, replacement, longer);
            if (out !== s) { v[c] = out; changed = true; }
          }
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
    LEVELS: LEVELS, NEWBIE: NEWBIE, ownerList: ownerList, MAX_OWNERS: MAX_OWNERS, SCOUT_SELF: SCOUT_SELF, SELF_ELIGIBLE_SECTIONS: SELF_ELIGIBLE_SECTIONS, PROGRESS_MODULES: PROGRESS_MODULES, progressModule: progressModule, progressSec: progressSec, levelRuleProgress: levelRuleProgress, isLevelOf: isLevelOf, idPrefixOf: idPrefixOf, levelsOf: levelsOf, currentLevelOf: currentLevelOf, progressParams: progressParams, levelDeadline: levelDeadline, addDays: addDays, NEWBIE_SEED: NEWBIE_SEED, INTERVAL_LEVELS: INTERVAL_LEVELS, CATEGORY: CATEGORY, BADGE_GROUPS: BADGE_GROUPS, NO_SECTION: NO_SECTION, STATUS: STATUS, ROLE: ROLE, SECTIONS: SECTIONS, DEFAULT_SECTION: DEFAULT_SECTION, CENTRAL: CENTRAL, STAFF_ROLES: STAFF_ROLES, RELATION: RELATION, sectionOf: sectionOf, effectiveAdmins: effectiveAdmins, ALL: ALL, UNASSIGNED: UNASSIGNED, SECTION_SLUG: SECTION_SLUG, SECTION_FULL: SECTION_FULL, PROGRESS_SECTIONS: PROGRESS_SECTIONS, isSection: isSection, targetOf: targetOf, targetIncludes: targetIncludes, parseTargets: parseTargets, targetsInclude: targetsInclude, leaderTitle: leaderTitle, requestSectionOf: requestSectionOf, staffSections: staffSections, pickSection: pickSection, SHARED_FUNCS: SHARED_FUNCS, SHARED_LEVELS: SHARED_LEVELS, canShared: canShared, sectionSetting: sectionSetting, sectionSettingKey: sectionSettingKey, validateStaffChange: validateStaffChange,
    PENDING_TEXT_FOR_PARENTS: PENDING_TEXT_FOR_PARENTS, CODE_CHARSET: CODE_CHARSET, CODE_ERROR_MESSAGE: CODE_ERROR_MESSAGE,
    SETTINGS: SETTINGS, PERMISSIONS: PERMISSIONS, CUB_ID_COLUMNS: CUB_ID_COLUMNS,
    isDateStr: isDateStr, cmpDate: cmpDate, addMonths: addMonths, tenure: tenure,
    clean: clean, parseCsv: parseCsv, toCsv: toCsv,
    parseSettings: parseSettings, defaultSettingsRows: defaultSettingsRows, validateSettingValue: validateSettingValue, parseList: parseList, changeSquads: changeSquads,
    parseItems: parseItems, nextItemId: nextItemId, buildSeed: buildSeed, buildDetailSeed: buildDetailSeed, parseDetails: parseDetails,
    isCountedCompletion: isCountedCompletion, computeCubProgress: computeCubProgress, nextChallenge: nextChallenge,
    isNearlyDone: isNearlyDone, attendanceCounts: attendanceCounts, ATTEND_MARKS: ATTEND_MARKS, isPresent: isPresent, attendanceRate: attendanceRate, periodOf: periodOf, statusTextForParents: statusTextForParents,
    planBatchSignoff: planBatchSignoff, completionToRow: completionToRow, rowToCompletion: rowToCompletion,
    validateAwardDate: validateAwardDate, planBackfill: planBackfill, levelAfterRevoke: levelAfterRevoke,
    generateCode: generateCode, normalizeCode: normalizeCode, checkInvite: checkInvite, checkBindCode: checkBindCode,
    validateUsername: validateUsername, validatePassword: validatePassword, isWeakPassword: isWeakPassword, validateNickname: validateNickname,
    hashPassword: hashPassword, verifyPassword: verifyPassword, constantTimeEqual: constantTimeEqual, isSessionValid: isSessionValid, isTempCodeValid: isTempCodeValid,
    isLocked: isLocked, isGlobalBindLocked: isGlobalBindLocked,
    latestConsentVersion: latestConsentVersion, needsReconsent: needsReconsent,
    TRIAL: TRIAL, GRADUATED: GRADUATED, LEAVE_REASONS: LEAVE_REASONS, ADULT_SELF_SECTIONS: ADULT_SELF_SECTIONS, ROVER_AUDIENCE: ROVER_AUDIENCE, CUB_ROLES: CUB_ROLES, ROLE_LEVELS: ROLE_LEVELS, MEETING_TYPES: MEETING_TYPES, EVENT_IDENTITIES: EVENT_IDENTITIES, EVENT_MAX_PER_ACCOUNT: EVENT_MAX_PER_ACCOUNT, validateEvent: validateEvent, validateEventPeople: validateEventPeople, isUnitImage: isUnitImage, trialProgress: trialProgress,
    IDENTITY: IDENTITY, validateChildNames: validateChildNames, recentRequestAccounts: recentRequestAccounts,
    PERM_LEVELS: PERM_LEVELS, PERM_FEATURES: PERM_FEATURES, defaultPermRows: defaultPermRows, parsePermRules: parsePermRules, validatePermUpdate: validatePermUpdate, allowsFeature: allowsFeature, resolvePermissions: resolvePermissions,
    can: can, canRevokeSignoff: canRevokeSignoff, validateAdminChange: validateAdminChange, OWNER_ONLY_MESSAGE: OWNER_ONLY_MESSAGE, OWNER_LOCKED_MESSAGE: OWNER_LOCKED_MESSAGE, canDeleteAccount: canDeleteAccount,
    planPrivacy: planPrivacy, overdueForPrivacy: overdueForPrivacy,
    diffNotifications: diffNotifications
  };
})();

// Node 測試環境匯出；GAS 中沒有 module，略過
if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
