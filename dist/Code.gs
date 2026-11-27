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
  SQUAD_STAFF: '小隊輔',
  ROLES: '職務紀錄',
  NOTICES: '公告',
  SITE: '網站內容',
  EVENTS: '活動',
  EVENT_REGS: '活動報名',
  UNIT_IMAGES: '章圖',
  SETTINGS: '設定',
  PERMS: '權限設定',
  PROMOTIONS: '升團紀錄',
  REGIS: '年度登記',
  REGIS_FEES: '登記費用',
  LOG: '操作日誌'
};

/**
 * 團長平常需要自己打開修改的分頁（SPEC 附錄第 30 點）；排在最前面且一律顯示。
 * 其他分頁是系統自己寫入的紀錄，setup() 會把它們隱藏起來（只是隱藏，資料不動）。
 */
var EDITABLE_SHEETS = [SHEET.ITEMS, SHEET.DETAILS, SHEET.UNITS, SHEET.SETTINGS, SHEET.CONSENT];

/** 各分頁標題列（順序即欄位順序） */
var HEADERS = {};
HEADERS[SHEET.CUBS] = ['小狼ID', '姓名', '小隊', '入團日', '目前級別', '綁定碼', '綁定碼剩餘次數', '狀態', '離團日', '體驗開始日', '職務', '分團', '離開原因'];
HEADERS[SHEET.ACCOUNTS] = ['帳號ID', '帳號名稱', '稱呼', '密碼雜湊', '密碼鹽', '狀態', '建立時間', '最後登入時間', '臨時碼雜湊', '臨時碼到期時間'];
HEADERS[SHEET.SESSIONS] = ['憑證雜湊', '帳號ID', '建立時間', '到期時間'];
HEADERS[SHEET.BINDINGS] = ['帳號ID', '小狼ID', '綁定時間', '同意時間', '同意版本', '關係'];
HEADERS[SHEET.ADMINS] = ['帳號ID', '姓名', '角色', '加入時間', '指定人', 'LINE userId', 'LINE 連結時間', '分團', '職稱'];
HEADERS[SHEET.INVITES] = ['邀請碼', '角色', '姓名', '建立人', '建立時間', '到期時間', '狀態', '使用者帳號ID', '使用時間', '分團', '職稱'];
HEADERS[SHEET.ITEMS] = ['項目ID', '類別', '級別或章名', '大項', '項目內容', '排序', '啟用', '分團'];
HEADERS[SHEET.UNITS] = ['名稱', '類別', '分類', '說明', '晉級條件', '排序', '分團'];
HEADERS[SHEET.DETAILS] = ['項目ID', '分組', '細項內容', '通過標準', '生活應用', '排序', '啟用'];
HEADERS[SHEET.COMPLETIONS] = ['小狼ID', '項目ID', '完成日期', '簽核人', '備註', '回報人', '回報狀態'];
HEADERS[SHEET.AWARDS] = ['小狼ID', '級別或章名', '頒發日期', '頒發場合', '備註', '簽核人', '登錄時間', '分團'];
HEADERS[SHEET.MEETINGS] = ['集會ID', '日期', '名稱', '備註', '啟用', '建立人', '建立時間', '類型', '計入進程', '分團'];
HEADERS[SHEET.ATTENDANCE] = ['集會ID', '小狼ID', '狀態', '點名人', '點名時間'];
HEADERS[SHEET.PERIODS] = ['年度名稱', '開始日', '結束日', '應出席總數', '備註', '分團'];
HEADERS[SHEET.EXTRA] = ['年度名稱', '小狼ID', '額外出席次數', '備註', '設定人', '設定時間'];
HEADERS[SHEET.NOTIFY] = ['小狼ID', '級別或章名', '通知類型', '通知時間'];
HEADERS[SHEET.FAILURES] = ['類型', '對象', '時間'];
HEADERS[SHEET.REQUESTS] = ['申請ID', '帳號ID', '類型', '填寫姓名', '申請時間', '狀態', '處理人', '處理時間', '小狼ID', '同意版本', '備註', '分團'];
HEADERS[SHEET.SQUAD_STAFF] = ['小隊', '帳號ID', '設定人', '設定時間', '分團'];
HEADERS[SHEET.ROLES] = ['小狼ID', '小隊', '職務', '開始日', '結束日', '設定人', '設定時間'];
HEADERS[SHEET.EVENTS] = ['活動ID', '標題', '說明', '活動日期', '結束日期', '報名開始', '報名結束', '每人費用', '題目', '狀態', '建立人', '建立時間', '存檔試算表ID', '封存時間', '分團'];
HEADERS[SHEET.EVENT_REGS] = ['報名ID', '活動ID', '帳號ID', '姓名', '身分別', '答案', '應繳金額', '已繳', '報名時間', '狀態', '更新人', '更新時間'];
HEADERS[SHEET.UNIT_IMAGES] = ['名稱', '類別', '圖片', '更新人', '更新時間', '分團'];
HEADERS[SHEET.SITE] = ['鍵', '內容', '更新人', '更新時間'];
HEADERS[SHEET.NOTICES] = ['公告ID', '標題', '內容', '置頂', '集會ID', '發布人', '發布時間', '狀態', '分團'];
HEADERS[SHEET.CONSENT] = ['版本', '內容', '生效日', '對象'];
HEADERS[SHEET.SETTINGS] = ['鍵', '值', '說明'];
HEADERS[SHEET.PERMS] = ['功能代碼', '功能名稱', '分類', '最低權限', '停用分團', '更新人', '更新時間'];
// 升團（附錄第 69、80 點）：同一筆團員改到下一個分團，原本的入團日、小隊、職務記在這裡
HEADERS[SHEET.PROMOTIONS] = ['小狼ID', '原分團', '新分團', '升團日', '原入團日', '原小隊', '原職務', '設定人', '設定時間'];
// 續團確認與三項登記（附錄第 70、80 點）：每年度每人一列；類型 童軍／服務員／團（團登記一個分團一列）
HEADERS[SHEET.REGIS] = ['年度', '類型', '對象ID', '分團', '續團', '已登記', '應繳金額', '已繳', '備註', '更新人', '更新時間'];
HEADERS[SHEET.REGIS_FEES] = ['年度', '童軍登記費', '服務員登記費', '團登記費', '備註', '更新人', '更新時間'];
HEADERS[SHEET.LOG] = ['時間', '操作人', '動作', '對象', '修改前', '修改後'];

/**
 * 需設為「純文字」格式的欄（1 起算），避免試算表把日期字串或全數字代碼自動轉型。
 */
var TEXT_COLUMNS = {};
// 姓名、小隊、稱呼等使用者輸入的欄也設成純文字：輸入「=」開頭的字不會被當成公式（附錄第 78 點）
TEXT_COLUMNS[SHEET.CUBS] = [1, 2, 3, 4, 6, 9, 10];
TEXT_COLUMNS[SHEET.ACCOUNTS] = [1, 2, 3];
TEXT_COLUMNS[SHEET.BINDINGS] = [1, 2];
TEXT_COLUMNS[SHEET.ADMINS] = [1, 2];
TEXT_COLUMNS[SHEET.INVITES] = [1, 8];
TEXT_COLUMNS[SHEET.ITEMS] = [1];
TEXT_COLUMNS[SHEET.DETAILS] = [1];
TEXT_COLUMNS[SHEET.COMPLETIONS] = [1, 2, 3, 4];
TEXT_COLUMNS[SHEET.AWARDS] = [1, 3, 6];
TEXT_COLUMNS[SHEET.MEETINGS] = [1, 2, 3, 4];
TEXT_COLUMNS[SHEET.ATTENDANCE] = [1, 2, 4];
TEXT_COLUMNS[SHEET.PERIODS] = [2, 3];
TEXT_COLUMNS[SHEET.EXTRA] = [2];
TEXT_COLUMNS[SHEET.NOTIFY] = [1];
TEXT_COLUMNS[SHEET.CONSENT] = [3];
TEXT_COLUMNS[SHEET.REQUESTS] = [1, 2, 4, 9];
TEXT_COLUMNS[SHEET.SQUAD_STAFF] = [2];
TEXT_COLUMNS[SHEET.ROLES] = [1, 4, 5];
TEXT_COLUMNS[SHEET.PROMOTIONS] = [1, 4, 5];
TEXT_COLUMNS[SHEET.REGIS] = [1, 3];
TEXT_COLUMNS[SHEET.NOTICES] = [1, 5];
TEXT_COLUMNS[SHEET.SITE] = [1, 2];
TEXT_COLUMNS[SHEET.EVENTS] = [1, 2, 3, 4, 5, 6, 7, 9, 13];
TEXT_COLUMNS[SHEET.EVENT_REGS] = [1, 2, 3, 4, 5, 6];
TEXT_COLUMNS[SHEET.UNIT_IMAGES] = [1, 2, 3];
TEXT_COLUMNS[SHEET.PERMS] = [1, 2, 3, 4, 5];

/**
 * 後端版本（SPEC 附錄第 72 點）：每次改 gas/ 的程式都要更新，並同步改 web/index.html 的 APP_VERSION。
 * 網頁登入後比對兩邊，不一樣就在後台首頁提醒團長「後端還是舊版，請部署新版本」。
 */
var APP_VERSION = '2026-11-27b';

/** API 錯誤代碼（前端依代碼處理，訊息直接顯示給使用者） */
var ERR = {
  MOVED: 'MOVED',
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
 "consentText": "親愛的家長您好：\n\n為了讓您隨時查看孩子在 22 團的紀錄，本團使用「22團網站」（涵蓋稚齡童軍、幼童軍、童軍、行義童軍、羅浮童軍五個分團）。在您建立帳號前，請先閱讀以下說明。\n\n一、我們會記錄哪些資料\n1. 孩子的姓名、所屬分團、小隊、入團日期，以及是否擔任小隊長、副小隊長與任期。\n2. 孩子的進程紀錄：完成了哪些項目、哪一天完成、拿到哪些級別章與技能章（各分團的進程功能陸續上線）。\n3. 孩子的出席紀錄：每次集會出席或請假（包含您在網站上先幫孩子請的假）。\n4. 您的帳號名稱、您填寫的稱呼（例如「王小明媽媽」）。您的密碼會經過加密，任何人（包括團長）都看不到。\n5. 活動報名：您幫自己或家人報名活動時填的姓名、身分別、報名表上的回答，以及應繳金額與是否已繳。我們不經手付款，也不記錄任何付款資料。活動結束後，網站上的報名資料會自動清除；報名名單另存一份在團長的雲端硬碟作為存檔，由團長負責保管。\n我們不會蒐集孩子的生日、身分證字號、電話、地址或照片。\n\n二、為什麼要記錄\n只用於本團的進程管理、出席統計、活動報名，以及讓您查看孩子的紀錄，不會用在其他地方，也不會提供給團外的人或廠商。\n\n三、誰看得到\n1. 您只看得到自己孩子的資料。\n2. 孩子所屬分團的團長與服務員看得到該分團的資料，用來點名、簽核與頒章；其他分團的團長、服務員看不到。\n3. 總團與系統管理員看得到全團資料，用來協助各分團與處理帳號問題。\n4. 孩子升上其他分團時，新分團的團長可以看到孩子之前的紀錄，讓進程接續。\n\n四、資料放在哪裡\n存放在本團管理的 Google 試算表，並每週自動備份到團長的 Google 雲端硬碟。只有團長與必要的管理人員可以開啟。\n\n五、保存多久\n孩子在團期間會一直保存。孩子離團後，團長會在【請填寫：例如 180 天】內把資料匿名化（看不出是誰）或完全刪除。備份檔會在【請填寫：例如 8 週】內自動輪替刪除。\n\n六、您的權利\n您可以隨時：\n1. 在「我的資料」頁查看我們記錄了什麼。\n2. 要求更正錯誤的資料。\n3. 在「我的資料」頁自行解除綁定（解除後您就看不到孩子的資料，孩子的紀錄不受影響）。\n4. 要求刪除您的帳號，或刪除孩子的全部資料。\n不同意本說明，就不會建立帳號，也不會留下任何紀錄；這不影響孩子參加團集會。\n\n七、聯絡誰\n有任何問題、要更正或刪除資料，請聯絡孩子所屬分團的團長，或：【請填寫：聯絡方式，例如 LINE 官方帳號「22團」】。",
 "roverConsentText": "您好：\n\n為了讓您隨時查看自己在 22 團羅浮群的紀錄，本團使用「22團網站」（涵蓋稚齡童軍、幼童軍、童軍、行義童軍、羅浮童軍五個分團）。在您建立帳號前，請先閱讀以下說明。\n\n一、我們會記錄哪些資料\n1. 您的姓名、所屬分團、群（小隊）、入團日期，以及擔任的職務與任期。\n2. 您的進程紀錄：完成了哪些項目、哪一天完成、拿到哪些級別章。\n3. 您的出席紀錄：每次集會出席或請假（包含您在網站上自己請的假）。\n4. 您的帳號名稱與稱呼。您的密碼會經過加密，任何人（包括群長、團長）都看不到。\n5. 活動報名：您報名活動時填的姓名、身分別、報名表上的回答，以及應繳金額與是否已繳。我們不經手付款，也不記錄任何付款資料。活動結束後，網站上的報名資料會自動清除；報名名單另存一份在團長的雲端硬碟作為存檔，由團長負責保管。\n6. 年度登記：您這一年是否續團、是否已向童軍會登記、應繳與已繳的登記費。\n我們不會在網站上蒐集您的生日、身分證字號、電話、地址或照片（向童軍會登記所需的資料仍依總會規定另外處理）。\n\n二、為什麼要記錄\n只用於本團的進程管理、出席統計、活動報名與年度登記，以及讓您查看自己的紀錄，不會用在其他地方，也不會提供給團外的人或廠商。\n\n三、誰看得到\n1. 您只看得到自己的資料。\n2. 羅浮群的群長與服務員看得到羅浮群的資料，用來點名、簽核與頒章；其他分團的團長、服務員看不到。\n3. 總團與系統管理員看得到全團資料，用來協助各分團與處理帳號問題。\n4. 您之前在其他分團的紀錄（例如童軍、行義時期）會跟著您，讓進程與服務紀錄接續。\n\n四、資料放在哪裡\n存放在本團管理的 Google 試算表，並每週自動備份到團長的 Google 雲端硬碟。只有團長與必要的管理人員可以開啟。\n\n五、保存多久\n您在團期間會一直保存。您離團後，團長會在【請填寫：例如 180 天】內把資料匿名化（看不出是誰）或完全刪除。備份檔會在【請填寫：例如 8 週】內自動輪替刪除。\n\n六、您的權利\n您可以隨時：\n1. 在「我的資料」頁查看我們記錄了什麼。\n2. 要求更正錯誤的資料。\n3. 要求停用或刪除您的帳號，或刪除您的全部資料。\n不同意本說明，就不會建立帳號，也不會留下任何紀錄；這不影響您參加羅浮群的活動。\n\n七、聯絡誰\n有任何問題、要更正或刪除資料，請聯絡羅浮群的群長，或：【請填寫：聯絡方式，例如 LINE 官方帳號「22團」】。",
 "sections": {
  "稚齡": {
   "itemsCsv": "類別,級別或章名,大項或分類,項目內容\r\n進程,地球,－,能背誦稚齡童軍諾言及規律，並能說出其意義。\r\n進程,地球,－,能完成稚齡童軍的吼聲與敬禮。\r\n進程,地球,－,能說出小隊服務員之稱呼。\r\n進程,地球,－,認識並能說出自己小隊伙伴的姓名。\r\n進程,地球,－,會唱狼寶寶歌、稚齡童軍歌。\r\n進程,地球,－,能說出 3 種以上自我保護的方法。\r\n進程,星星,－,獲得地球章後，至少參加 4 次以上之團集會。\r\n進程,星星,－,能介紹自己家中親人予伙伴認識。\r\n進程,星星,－,會協助整理小隊器材，並完成小隊交付任務。\r\n進程,星星,－,會做好自己日常生活起居及留意服裝儀容整潔。\r\n進程,星星,－,能說出重要的電話號碼，以及打電話的禮節。\r\n進程,星星,－,能與伙伴共同創作一件物品。\r\n進程,月亮,－,獲得星星章後，至少參加 6 次以上之團集會。\r\n進程,月亮,－,能介紹同學予伙伴認識。\r\n進程,月亮,－,能參與自己的團部及班級的服務工作。\r\n進程,月亮,－,會協助整理家中物件，並能關心家人。\r\n進程,月亮,－,會用正確的方法使用各項遊戲器材。\r\n進程,月亮,－,能分辨各種交通工具。\r\n進程,月亮,－,能自行整理書包，完成上學前的準備。\r\n進程,月亮,－,能以正確姿勢握筆寫字。\r\n進程,月亮,－,能每天與師長及別人打招呼。\r\n進程,太陽,－,獲得月亮章後，至少參加 6 次以上之團集會。\r\n進程,太陽,－,能邀請伙伴至家中聚會。\r\n進程,太陽,－,能參與自己團部及學校的服務工作。\r\n進程,太陽,－,能簡述住家附近之社區環境。\r\n進程,太陽,－,能遵守步行的交通規則。\r\n進程,太陽,－,會與同學或伙伴共同遊戲。\r\n進程,太陽,－,能注意站立、坐下與行走的正確姿勢。\r\n進程,太陽,－,能閱讀兒童課外讀物，至少 3 本。\r\n技能章,種植,服務類,能使用棉花種植豆類至發芽，並觀察、記錄。\r\n技能章,種植,服務類,會利用瓶、罐，種植花本。\r\n技能章,種植,服務類,會整理學校或家庭的花圃、盆栽。\r\n技能章,生活,服務類,能早睡、早起。\r\n技能章,生活,服務類,不挑食、不偏食。\r\n技能章,生活,服務類,能隨時注意保持服裝儀容整潔。\r\n技能章,保健,服務類,能說出自己身體主要部位的名稱及功能.\r\n技能章,保健,服務類,會維護自己牙齒和視力的健康。\r\n技能章,環保,服務類,\"會做到垃圾分類,以及資源回收。\"\r\n技能章,環保,服務類,能協助整理住家環境。\r\n技能章,環保,服務類,能隨時保持教室個人桌椅周遭整潔。\r\n技能章,交通,服務類,認識紅綠燈，會過馬路，並注意安全。\r\n技能章,交通,服務類,注意乘車安全與禮貌。\r\n技能章,球類,運動類,拍球：能在原地拍球 20 下。\r\n技能章,球類,運動類,傳球：能與同伴互相連續傳球 20 下。\r\n技能章,球類,運動類,踢球：能對準相距 3 公尺之前方，連續 3 次踢中直徑 1 公尺之目標。\r\n技能章,騎車,運動類,會騎乘三輪車、扭扭車或滑板車、腳踏車等，均能連續騎乘 50 公尺以上。\r\n技能章,體能,運動類,能在 20 秒以內，跑走 60 公尺。\r\n技能章,體能,運動類,立定跳遠：能跳過 50 公分以上。\r\n技能章,體能,運動類,能連續側滾 3 次。\r\n技能章,民俗,運動類,跳繩 5 下、踩奶粉罐走 3 公尺或其他經團長認可的民俗活動。\r\n技能章,律動,運動類,會做健康操或律動唱跳。\r\n技能章,益智,技巧類,完成 20 片以上的拼圖或積木。\r\n技能章,益智,技巧類,會玩一種棋藝。\r\n技能章,表演,技巧類,能隨音樂的節奏做動作。\r\n技能章,表演,技巧類,能模仿兩種以上動物的聲音或動作。\r\n技能章,歌唱,技巧類,能唱 3 首兒歌及 2 首童軍歌曲。\r\n技能章,語文,技巧類,能說故事及唸童謠。\r\n技能章,美勞,技巧類,完成繪畫 1 張、勞作 1 件及摺紙 1 項。\r\n",
   "progressRules": {
    "地球": "凡年滿五歲兒童，經徵得父母同意，申辦入團手續後，經3至6個月完成地球級各項進程，始得正式入團頒授地球章、佩帶團領巾，表揚起步向前。",
    "星星": "獲頒地球章後，6個月內完成星星級各項進程，即可頒授星星章。",
    "月亮": "獲頒星星章後繼續參加活動，在1年內完成月亮級各項進程，即可頒授月亮章。",
    "太陽": "獲頒月亮章後繼續參加活動，在1年內完成太陽級各項進程，即可頒授太陽章，並鼓勵邁向幼童軍之門，參與幼童軍團集會活動，學習幼童軍羚羊級進程。"
   }
  },
  "童軍": {
   "itemsCsv": "類別,級別或章名,大項或分類,項目內容\r\n進程,初級,童軍精神方面,能背誦並實踐童軍諾言、規律、銘言，並能說出宣誓的意義。\r\n進程,初級,童軍精神方面,知道童軍的起源和中華民國童軍的歷史。\r\n進程,初級,童軍精神方面,知道中華民國童軍徽的意義和佩戴法，以及童軍制服的榮譽表徵和穿著法。\r\n進程,初級,童軍精神方面,知道童軍三指符號及左握的含意，並能行各種敬禮的方法。\r\n進程,初級,童軍精神方面,知道國家元首的姓名。\r\n進程,初級,群體生活方面,能說出本小隊隊名，並能做隊呼、隊聲、小隊歌和繪製隊徽。實踐在小隊分工的任務及團內應盡的職責。\r\n進程,初級,群體生活方面,能說出住所及團部鄰近的警察、醫院、消防隊、郵局、大眾交通等公共設施所在地。\r\n進程,初級,群體生活方面,能繪製國旗，並愛護國旗。能說出國旗的歷史和意義及升降懸掛的正確方法。\r\n進程,初級,群體生活方面,熟悉徒手及持棍操法的基本動作及小隊操法。\r\n進程,初級,記號,能在日常生活及活動中，應用下列各種記號：前進記號、止步記號、藏信記號、我已回記號、危險記號。\r\n進程,初級,記號,能辨認常用的手勢訊號、警笛訊號及營地訊號。\r\n進程,初級,結繩,能打繩頭結：單結、8 字結、簡易繩頭結。\r\n進程,初級,結繩,能打下列各繩結，並能說出它的用途：平結、接繩結、雙套結、稱人結、雙半結、縮短結、活索結、雀頭結。\r\n進程,初級,衛生,明瞭什麼是事故傷害，並能意識、辨別童軍戶外活動環境中可能出現的危險因子，並能夠採取適當作為事前予以防範。\r\n進程,初級,衛生,能明瞭生病的原因，懂得如何維持良好的衛生與保健習慣。\r\n進程,初級,衛生,能以正確的方式撥打 119 呼叫救援。\r\n進程,初級,衛生,能夠處理創傷出血，並了解如何清潔傷口、控制感染，並以滅菌紗布與繃帶等進行簡易包紮。\r\n進程,初級,衛生,了解關節扭傷造成的原因與處理。\r\n進程,初級,衛生,明瞭從事戶外活動時急救包應準備之物品，並能夠正確使用。\r\n進程,初級,衛生,明瞭吸菸、飲酒、嚼食檳榔、藥物成癮會如何緩慢且持續的損害健康。\r\n進程,初級,資訊處理,能運用資訊設備建立小隊通訊聯絡方式或管道。\r\n進程,初級,資訊處理,能運用資訊設備發布小隊活動通知。\r\n進程,中級,童軍精神方面,能講解並實踐童軍諾言、規律及銘言。\r\n進程,中級,童軍精神方面,有節約與儲蓄的習慣，且能正當的使用金錢。\r\n進程,中級,童軍精神方面,能說出本縣（市）童軍會的所在地。\r\n進程,中級,群體生活方面,能經常自動自發參加小隊集會、團集會、野外活動及各種童軍作業。\r\n進程,中級,群體生活方面,能在家庭、學校、社區鄰里從事服務，而有良好的成績。\r\n進程,中級,群體生活方面,能切實實踐國民生活須知，熟知禮儀。\r\n進程,中級,群體生活方面,能遵守交通規則。\r\n進程,中級,群體生活方面,能落實垃圾分類及住家環保。\r\n進程,中級,觀察,能在 1 分鐘內觀察不同的 24 件細小雜物，而能記憶 12 件以上。\r\n進程,中級,觀察,能在 30 分鐘內依據蹤跡到達 1 公里間的目的地。\r\n進程,中級,觀察,能根據樹葉的型態辨認至少 5 種樹木。\r\n進程,中級,觀察,能辨認昆蟲 5 種以上，並知道它與人類的關係。\r\n進程,中級,觀察,能認識至少 2 種不同的雲層組織，並了解其與氣象的關係。\r\n進程,中級,訊號,運用通訊設備收發簡訊。\r\n進程,中級,訊號,能運用雙旗或單旗收發中文數碼旗語（含電碼翻譯）2 分鐘 4 個字。\r\n進程,中級,訊號,能正確使用對講機通訊設備及注意通訊禮節。\r\n進程,中級,急救,了解何為生命徵象，並知道生命徵象在評估傷患時的重要。\r\n進程,中級,急救,瞭解緊急事故處理原則。\r\n進程,中級,急救,能正確操作基本的止血法：直接加壓止血法、抬高止血法、冰敷止血法、止血點指壓法等，並了解使用時機與原則。\r\n進程,中級,急救,能正確的施行 CPR（不施作暢通呼吸道及吹氣）。\r\n進程,中級,急救,能操作仰臥（頭部朝上與朝下）、仰臥屈膝、半坐臥及復甦姿勢等休息姿勢，並能了解其使用時機。\r\n進程,中級,急救,了解不當搬運對傷患造成的傷害。\r\n進程,中級,急救,能應用繃帶或三角巾進行身體部位（如頭部、手掌、膝部及足踝等）的包紮。\r\n進程,中級,童軍技能方面,結繩能打下列各繩結，並能說出它的用途：牧童結、瓶口結、袋口結、營繩結、繫木結、方回結、十字結、吊桶結、剪立結。\r\n進程,中級,方位,能正確使用及應用指北針，測量方位的度數，並知道十六方位的名稱。\r\n進程,中級,方位,能利用太陽和時錶推測正確的方位。\r\n進程,中級,方位,能藉植物或地上物推測正確的方位。\r\n進程,中級,生火與野炊,知道刀、斧及鋸子的保護法及使用法。\r\n進程,中級,生火與野炊,能削火媒棒及正確架柴法，並能以不超過 2 根火柴在戶外生火。\r\n進程,中級,生火與野炊,能使用其他能源之正確方法與安全（如瓦斯、汽化爐、無煙煤……等）。\r\n進程,中級,生火與野炊,能規劃及烹煮個人野外餐飲。\r\n進程,中級,旅行,能說出徒步旅行的方法。\r\n進程,中級,旅行,能使用簡略地圖在野外進行旅行活動。\r\n進程,中級,旅行,能準備從事戶外旅行所需要的裝備、服裝及應注意事項。\r\n進程,中級,旅行,瞭解從事戶外旅行活動應注意的環保事項。\r\n進程,中級,旅行,曾有乾糧旅行或生火旅行，行程 10 公里以上的經驗，並能做書面報告。\r\n進程,中級,露營,能說出童軍露營的意義、事前的準備和事後的復原工作。\r\n進程,中級,露營,能做簡易營地設施。\r\n進程,中級,露營,能規劃小隊的野外炊事，並與小隊合作利用簡易爐灶烹煮小隊野外炊事。\r\n進程,中級,露營,能說出露營時應有的作業和活動。\r\n進程,中級,露營,能說出營地的安全與衛生注意事項及維護戶外生態保育。\r\n進程,中級,露營,具有 5 夜以上童軍露營的野外生活經驗（至少須含 3 天 2 夜露營 1 次），且必須參加所屬童軍團之露營 1 次以上。\r\n進程,中級,資訊處理,能將小隊五股幹事，任一種業務運用電腦完成。\r\n進程,中級,資訊處理,能運用網路搜尋小隊露營資料。\r\n進程,中級,資訊處理,知道使用資訊的安全及倫理，並能確實遵守。\r\n進程,高級,童軍精神方面,能實踐童軍諾言、規律及銘言。\r\n進程,高級,童軍精神方面,能健全自己，並能影響他人。\r\n進程,高級,童軍精神方面,能勤勞節約，刻苦自勵。\r\n進程,高級,童軍精神方面,瞭解童軍虔敬聚會意義。\r\n進程,高級,群體生活方面,能在小隊集會、團集會、野外活動及各種作業中發揮領導才能。\r\n進程,高級,群體生活方面,能主動參加團部各種服務，並曾幫助團長訓練兒童至少 1 人成為初級童軍。\r\n進程,高級,群體生活方面,能說出一般社交活動與國際的禮儀。\r\n進程,高級,群體生活方面,能說出國際童軍的組織概況。\r\n進程,高級,群體生活方面,能帶領小隊參加社區服務。\r\n進程,高級,觀察,能認識野生動物 3 種以上，並能說出牠的習性。\r\n進程,高級,觀察,能認識野生植物 5 種以上，能說出它的用途。\r\n進程,高級,觀察,能觀察四季重要星座及月亮的變化，並能據以推測正確的方位。\r\n進程,高級,觀察,能觀察自然現象和動物狀態 5 種以上，從而能夠預測未來氣象的變化。\r\n進程,高級,童軍技能方面,訊號具有下列任何一項能力： 1.能用聲或光通訊（每分鐘可收發各 4 個字以上）。 2.會用摩斯碼收發訊號。\r\n進程,高級,急救,能了解造成休克及其他一般急症（暈倒、中風、心臟病、食物中毒、癲癇、異物入眼、異物入耳、鼻出血）的原因，並能夠進行處置。\r\n進程,高級,急救,能了解異常環境溫度所造成的傷害，並能夠知道預防與處理的步驟。\r\n進程,高級,急救,能辨識、預防並處理野外惱人與有毒生物（台灣鋏蠓、螞蝗、隱翅蟲、硬蜱、恙蟲、蜂、蛇、蕈菇、咬人貓、菇婆芋等）所造成的傷害。\r\n進程,高級,急救,能應用各種包紮技巧實施骨折固定。\r\n進程,高級,急救,了解痙攣造成的原因並進行處理。\r\n進程,高級,急救,能正確施行各種徒手搬運法與簡易擔架製作，並了解使用時機與原則。\r\n進程,高級,急救,能正確操作 CPR+AED（公眾場所民眾簡易版）。\r\n進程,高級,急救,能實施異物梗塞時的急救法。\r\n進程,高級,急救,能準備戶外活動時，應備之急救物品，並能夠正確使用。\r\n進程,高級,童軍技能方面,結繩能打下列各繩結，並能說出它的用途：鞦韆結、漁人結、三套結、椅結、貓爪結、花聯結、槓桿結。\r\n進程,高級,露營,能參與設計 2 天 1 夜小隊露營（包括小隊及個人的裝備，並附器材單、菜單、活動日程表、營地配置圖）。並協助該露營之工作人員（具有書面資料）。\r\n進程,高級,露營,能利用自然物製作營地實用設備。\r\n進程,高級,露營,能作無具炊事至少 3 種以上。\r\n進程,高級,露營,累積有 6 夜以上童軍露營的野外生活經驗（需在 2 個以上之營地露營），並參加所屬童軍團或縣（市）以上童軍會主辦之露營 1 次以上，且有紀錄可查。\r\n進程,高級,露營,必須小隊合作完成 24 小時野外露營旅行及熟練快速的滅跡。\r\n進程,高級,露營,能做至少 2 種野外炊事爐灶。\r\n進程,高級,露營,能了解童軍野外露營活動之有關戶外活動倫理。\r\n進程,高級,工藝,能做簡易縫補的技巧。\r\n進程,高級,工藝,能使用簡單工具製作實用物品或手工藝品各 2 種以上。\r\n進程,高級,工藝,能裝置或修理家用電器。\r\n進程,高級,估測,能估測出一個不能走過的寬度（如河面、池塘寬度）。\r\n進程,高級,估測,能估測高度（如樹木、電桿、房屋）。\r\n進程,高級,估測,能測出營地、田園或廣場的面積。\r\n進程,高級,估測,能估測物品重量及其實體體積。（以上 4 種估測誤差不得超過 10%）\r\n進程,高級,估測,能測出以童軍步（跑、走相間），完成 2 公里所需時間。\r\n進程,高級,估測,能步測 100 公尺之短距離，其誤差不得超過 5%。\r\n進程,高級,製圖,瞭解指北針與地圖的整合應用。\r\n進程,高級,製圖,能應用符號繪製營地簡圖。\r\n進程,高級,工程,能完成一項小隊簡易斥堠工程計畫（最低限度能用 2 種不同的工程繩結和滑車）。\r\n進程,高級,工程,能製作簡易斥堠工程模型。\r\n進程,高級,運動技能,能游泳 25 公尺的距離，並能說出關於游泳安全的常識和救人的方法。\r\n進程,高級,運動技能,能划船 100 公尺（需有救生員在場）。\r\n進程,高級,運動技能,能騎自行車通過 2 公里路程。\r\n進程,高級,運動技能,會 2 種以上不同的溜冰姿勢。（以上 4 項得任選一項參加考驗）\r\n進程,高級,運動技能,伏地挺身 10 次或跪膝伏地挺身 20 次。\r\n進程,高級,運動技能,仰臥起坐 10 次。\r\n進程,高級,運動技能,引體向上 3 次或 2 分鐘內跳繩 120 下。\r\n進程,高級,運動技能,4 分 30 秒內耐力跑 800 公尺。（女生標準為：5 分 30 秒）\r\n進程,高級,資訊處理,能運用電腦製作團活動報告或投稿童軍相關刊物。\r\n進程,高級,資訊處理,能運用電腦編修照片或圖畫，並置於網頁供公眾瀏覽。\r\n進程,高級,童軍技能方面,休閒活動能規劃自己的休閒活動，並就下列各項選擇 2 項展現： 1.樂器。 2.舞蹈。 3.歌唱。 4.棋藝。 5.球類。 6.其他休閒活動。\r\n進程,獅級,－,實踐童軍諾言、規律、銘言，並有良好成績表現。（團長評定）\r\n進程,獅級,－,熱心擔任童軍團內工作：如正（副）小隊長、正（副）聯隊長、或其他團幹部等職務，並累積達 4 個月以上。（團長評定）\r\n進程,獅級,－,曾介紹 2 人入團，並指導童軍 1 人晉升中級童軍。（團長評定）\r\n進程,獅級,－,能說出童軍團的組織及成立程序。（團長評定）\r\n進程,獅級,－,累積 10 夜以上的露營經驗（須在 3 個不同營地露營，至少參加 1 次縣（市）以上或經所屬縣（市）童軍會核可 3 團以上聯團之露營活動）且有紀錄可查。（團長評定，資料送縣（市）童軍會核定）\r\n進程,獅級,－,曾參加團或社區服務 16 小時以上，有良好成績表現。（有紀錄可查）（團長評定，資料送縣（市）童軍會核定）\r\n進程,獅級,－,取得專科章 5 種以上，其中必須具有下列 3 項： 社區公民專科章。 旅行專科章。 露營專科章。\r\n進程,長城,－,實踐並闡述童軍諾言、規律、銘言，有良好成績表現。（團長評定）\r\n進程,長城,－,曾在童軍團內擔任下列工作達 4 個月以上，並有良好績效。（團長評定） 正（副）小隊長。 正（副）聯隊長。 團幹部。 在幼童軍團服務。\r\n進程,長城,－,曾協助團長指導 2 人晉升高級童軍。（團長評定）\r\n進程,長城,－,能說出各級童軍會的組織。（團長評定）\r\n進程,長城,－,曾協助團長領導小隊完成 2 次 8 小時以上或 1 次 24 小時以上之長途旅行，並提出完整書面記錄。（團長評定，資料送縣（市）童軍會核定）\r\n進程,長城,－,能規劃及執行社區服務 2 次以上，並有完整書面紀錄。（團長評定，資料送縣（市）童軍會核定）\r\n進程,長城,－,取得專科章 11 種以上，其中必須具有下列 3 項： 國家公民專科章。 急救專科章。 游泳專科章或自行車專科章或越野專科章 3 項擇 1 項。\r\n進程,國花,－,實踐並能對外簡要說明童軍諾言、規律、銘言，有良好成績表現。（團長評定）\r\n進程,國花,－,曾在縣（市）或地區以上所舉辦的童軍活動中擔任服務工作累計 40 小時以上，有良好成績表現，持有主辦單位簽字之服務紀錄卡或服務證明者。（團長評定，資料送總會核定）\r\n進程,國花,－,負責訓練童軍取得專科章 3 種以上。（團長評定，資料送總會核定）\r\n進程,國花,－,能說出世界童軍組織及近期重大活動（會議）訊息。（團長評定）\r\n進程,國花,－,曾在童軍團，教授 3 種以上課程。（團長評定，資料送總會核定)\r\n進程,國花,－,曾規劃及帶領小隊做童軍露營活動 2 次以上（須有 1 次 3 天 2 夜），並提出完整書面紀錄。（團長評定，資料送總會核定)\r\n進程,國花,－,能規劃並研擬社會服務計畫，經家長、團長、受服務團體同意，並領導童軍實施服務計畫，且經相關人員協助及輔導，活動執行完畢後有良好績效，並有完整紀錄。（受服務團體評定，資料送總會核定）\r\n進程,國花,－,國花級童軍必須在 19 歲之前完成。\r\n進程,國花,－,取得專科章 18 種以上，其中必須具有下列 5 項： 世界公民專科章。 生態保育專科章。 測量專科章。 植物專科章或昆蟲專科章或賞鳥專科章 3 項擇 1 項。 音樂專科章或舞蹈專科章或攝影專科章 3 項擇 1 項。\r\n專科章,社區公民,服務類,能說出「社區」的定義。\r\n專科章,社區公民,服務類,能說出負責推動社區各項建設的是哪一個社區組織體系。\r\n專科章,社區公民,服務類,能說出社區劃定的依據是哪些。\r\n專科章,社區公民,服務類,能說出社區發展的目標是什麼。\r\n專科章,社區公民,服務類,能說出你所居住的社區（或村里）內，有哪些有形及無形的資源，可供利用為社區發展。\r\n專科章,社區公民,服務類,能說出童軍能夠為其所居住之社區（或村里）發展提供哪些服務事項。\r\n專科章,國家公民,服務類,能說出中華民國國籍之取得，有哪些規定。\r\n專科章,國家公民,服務類,能簡述我國國民享有哪些權利，對國家應盡哪些義務。\r\n專科章,國家公民,服務類,能說出何謂「政權」，何謂「治權」。\r\n專科章,國家公民,服務類,能說出我國總統、副總統如何產生，任期幾年。\r\n專科章,國家公民,服務類,能說出五院的性質，地位及組織架構。\r\n專科章,國家公民,服務類,能說出五院院長、副院長是如何產生的。立法委員、監察委員、考試委員又是如何產生的。\r\n專科章,國家公民,服務類,我國負責解釋憲法及法律責任的是哪個單位。\r\n專科章,國家公民,服務類,根據我國憲法規定，各種選舉的方法（選舉原則）有哪些﹖\r\n專科章,國家公民,服務類,能簡述我國的近代歷史概況。\r\n專科章,國家公民,服務類,能簡述我國的地理情勢，如山川、海洋、氣候、交通與重要物產與資源等。\r\n專科章,世界公民,服務類,能說明今日因傳播媒體及通訊器材的發達，對國際間的互動，有什麼影響。\r\n專科章,世界公民,服務類,能說明「地球村」的意義及地球村居民的基本權利與義務。\r\n專科章,世界公民,服務類,能舉例說明當前世界各國的政府組織體制有哪幾種，我國政府組織，屬哪一種體制。\r\n專科章,世界公民,服務類,在聯合國所屬的數十個委員會及組織中，能說明其中3至5 個組織的原則與目標。\r\n專科章,世界公民,服務類,能說明WHO、WTO、UNESCO 及WOSM 各是什麼組織，哪一個組織不屬聯合國管轄。\r\n專科章,世界公民,服務類,能說明聯合國安全理事會及國際法庭的組織任務。\r\n專科章,世界公民,服務類,國際之間的交往，憑藉哪些組織及方法維持國際關係。\r\n專科章,世界公民,服務類,能說明一個國家的資源對其經濟發展的影響及對其他國家的關係。\r\n專科章,世界公民,服務類,能說出我國目前能以獨立國家或獨立實體參加的國際組織有哪些。\r\n專科章,世界公民,服務類,曾經到訪過哪些國家（含地區），能簡述這些國家（地區）的國情、風貌、氣候特徵及重要物產。並說出你結交了多少外國朋友？交往情形如何？\r\n專科章,社區服務,服務類,能說出志工的定義。\r\n專科章,社區服務,服務類,能說出並遵守志工倫理信條。\r\n專科章,社區服務,服務類,曾參與社區服務至少8 小時。\r\n專科章,社區服務,服務類,撰寫社區服務學習心得一篇。\r\n專科章,社區服務,服務類,能說出住家附近的社區服務組織。\r\n專科章,社區服務,服務類,參與志工講習，擁有志工證。\r\n專科章,環境保護,服務類,能說明垃圾分類的目的與方法。\r\n專科章,環境保護,服務類,能舉出3種以上化學物質污染環境的例子及其產生的影響。\r\n專科章,環境保護,服務類,能說出地球溫室效應的原因及維護的方法。\r\n專科章,環境保護,服務類,能說出導致河川污染的各種原因，及維護的方法。\r\n專科章,環境保護,服務類,能說出濫伐森林所造成的災害項目，及維護的方法。\r\n專科章,環境保護,服務類,能說明在工業發展中、工廠應注意哪些環保工作。\r\n專科章,生態保育,服務類,能說出生態保育的目的。\r\n專科章,生態保育,服務類,能說出20 種以上台灣地區保育類生物名稱及其受威脅的程度。\r\n專科章,生態保育,服務類,能說明生物多樣性與人類、地球的關係。\r\n專科章,生態保育,服務類,童軍活動（例：旅行、露營）中要注意哪些事項來避免生態破壞。\r\n專科章,生態保育,服務類,參與生態保育工作兩次以上。\r\n專科章,嚮導,服務類,能繪圖說明團部週圍5 公里內的道路、街衢、捷徑、僻巷及橋樑等地形。\r\n專科章,嚮導,服務類,能在黑夜辨認本地道路及鄰近村鎮的方向。\r\n專科章,嚮導,服務類,能背誦團部附近的醫院、警察局、消防隊、郵局、電信局等地址及其電話號碼。\r\n專科章,嚮導,服務類,能說明所在地之特產、史事、名勝、古跡之名稱及其事蹟。\r\n專科章,嚮導,服務類,有3 次以上的嚮導服務經驗。\r\n專科章,交通,服務類,能說出本地水陸交通幹道。\r\n專科章,交通,服務類,能說出本地各種交通情形。\r\n專科章,交通,服務類,能辨識各種交通訊號與標誌。\r\n專科章,交通,服務類,能說出各種交通規則。\r\n專科章,交通,服務類,能演示各種交通指揮手勢。\r\n專科章,消防,服務類,能說明本地區義消或消防隊的組織，和報告火警的方法。\r\n專科章,消防,服務類,能說明房屋著火逃出法。\r\n專科章,消防,服務類,能說明火焰蔓延的防止法。\r\n專科章,消防,服務類,能說明消防器材的構造，及其使用方法。\r\n專科章,消防,服務類,能於火警時，幫助警察維持秩序，或協助消防隊滅火。\r\n專科章,安全,服務類,能闡述家庭中應如何防止跌傷、熨傷、煤氣或藥品中毒、火燒、電燒傷及電線走火等安全措施。\r\n專科章,安全,服務類,能說明童軍野外生活必備的安全措施，以及其對快樂的野外生活的助益。\r\n專科章,安全,服務類,能在十字路口觀察行人及車輛之通行達3 小時（可分數次完成），列舉所見的違反交通安全規則的情節，並能說出如何才安全。\r\n專科章,安全,服務類,能觀察你的住家或學校的各種安全措施，列舉所有不安全的項目，並能解釋如何處理改善。\r\n專科章,安全,服務類,能在交通號誌故障時指揮交通。\r\n專科章,水上救生,服務類,獲有童軍急救及游泳專科章或通過其合格標準者。\r\n專科章,水上救生,服務類,能說明一般救生常識。\r\n專科章,水上救生,服務類,能在水中解脫衣履，並能在流水中泅泳60 公尺，或靜水中游泳50 公尺。\r\n專科章,水上救生,服務類,能在靜水中潛泳15 公尺或流水中潛泳20 公尺。\r\n專科章,水上救生,服務類,能說明正確接近法3 種及拖帶法3 種（採用陸上表演方式說明）並任選一法入水表演，攜帶溺者（10 磅重人體模型代替）拖帶10 公尺之距離。\r\n專科章,水上救生,服務類,能入水演習手臂受攬握時、受正面扼抱時及受背後扼抱時之解脫法。\r\n專科章,水上救生,服務類,能立游30 秒鐘（雙臂抱胸或露出水面）。\r\n專科章,公共衛生,服務類,能說明猩紅熱、白喉、肺結核、腦膜炎、腦炎、鼠疫、天花、霍亂、瘧疾、狂犬病、破傷風、傷寒和流行性感冒、SARS、腸病毒、登革熱等3種以上傳染病的起因和傳染途徑，及預防方法。\r\n專科章,公共衛生,服務類,能說明如何預防傳染疾病（至少3 種）。\r\n專科章,公共衛生,服務類,能說明蚊蠅的害處和根本驅除法。\r\n專科章,公共衛生,服務類,能列舉兩種因飲食不潔或冰水所致的疾病。能說出露營時如何處理飲用水。\r\n專科章,公共衛生,服務類,能列舉兩種以上常見的寄生蟲病及預防方法。\r\n專科章,公共衛生,服務類,能說明清除垃圾的重要和處理法。\r\n專科章,公共衛生,服務類,能說明店舖中保持飲料、食物生鮮及器皿的清潔。\r\n專科章,個人衛生,服務類,能說明人體解剖學及生理學的大要。\r\n專科章,個人衛生,服務類,能說明循環、呼吸、消化、排泄、生殖、神經等系統及五官、四肢的保健原則。\r\n專科章,個人衛生,服務類,能說明衣、食、住、行的衛生法，並能實踐而有顯著成績。\r\n專科章,個人衛生,服務類,具備正確的性知識和簡單的心理衛生知識，並力戒各種不良嗜好和惡習。\r\n專科章,露營,技能類,能擬訂三日兩夜的小隊露營計畫（包括事前準備、日程、活動內容、經費、菜單、事後整理等事項）。\r\n專科章,露營,技能類,能佈置一個小隊露營的營地（包括應有的建設）。\r\n專科章,露營,技能類,能不用舟、車往返10 公里以上地區領導小隊作3 日露營，並能作500 字以上的露營報告。\r\n專科章,露營,技能類,能說明各種露營用的營幕種類、名稱，並能示範搭架方法。\r\n專科章,露營,技能類,能利用自然物製作營地應用品4 種以上。\r\n專科章,露營,技能類,能在旅行露營中，依地圖、路標、指北針等為引導，不論遇有任何困難（特殊事故除外）不求助於人，而順利完成。\r\n專科章,旅行,技能類,能說出旅行的基本意義與一般常識，並能擬定旅行計畫( 包括事前準備、分工表、旅行路線、日程、活動內容、經費預算、緊急應變計畫)。\r\n專科章,旅行,技能類,能在市鎮或鄉村旅行並作詳細報告和繪製行程略圖。\r\n專科章,旅行,技能類,能在旅程中認識該地區鄉土的自然與人文環境，如地形、水文、植物、經濟（耕地、工廠、住宅、商店等分佈）及土地利用（住宅、商業、工業、農業、遊憩區等分佈）並作成紀錄解說。\r\n專科章,烹飪,技能類,能構築各種炊事灶。\r\n專科章,烹飪,技能類,能做無具炊事3 種。\r\n專科章,烹飪,技能類,能正確安全握刀，並能演示各種常用食材的處理法。\r\n專科章,烹飪,技能類,能設計並烹調小隊一天的飲食（包括：正餐及茶點，並需考量不同宗教的飲食需求）。\r\n專科章,烹飪,技能類,能說出各種常用食材的貯藏法，並能注重衛生、安全及防止食物交叉感染。\r\n專科章,急救,技能類,了解急救的定義、目的、處理原則、基礎生命徵象( 呼吸、脈搏、血壓、體溫等) 的重要性與其涵義。\r\n專科章,急救,技能類,能對傷患進行評估與紀錄，辨識傷病種類與緊急程度，並採取適當對應措施。\r\n專科章,急救,技能類,能正確操作CPR、異物梗塞排除( 哈姆立克法) 與AED。\r\n專科章,急救,技能類,能實施骨折、脫臼等包紮固定。\r\n專科章,急救,技能類,熟悉燒傷與過熱、過冷的影響： 1、清楚燒傷的處理。 2、能分辨中暑、熱衰竭、熱痙攣的差異，並處理之。 3、了解失溫、凍傷的處理。\r\n專科章,急救,技能類,能實施徒手與現有器材製作之擔架進行傷患運送法。附註： 持有紅十字會初級急救員以上證書（有效期限內）或其他團體舉辦之救護員證書( 須附課程表) 送審，據以核發急救專科章。\r\n專科章,斥堠工程,技能類,能正確熟練地作10 個工程繩結（必須包含3 個工程結：十字結、方回結、剪立結，並能應用）。\r\n專科章,斥堠工程,技能類,能利用自然物搭架一座獨腳、三腳或四腳瞭望台。( 以小隊方式完成)。\r\n專科章,斥堠工程,技能類,能就地取材搭架一種簡便橋樑，最少能供3人同時渡過。( 以小隊方式完成)\r\n專科章,斥堠工程,技能類,能利用自然物構築可容兩人露營的營舍。\r\n專科章,星象,技能類,能解說天體之運行概況。\r\n專科章,星象,技能類,能解說月球的運行及日、月蝕、潮、汐的原因。\r\n專科章,星象,技能類,能說出流星的成因。\r\n專科章,星象,技能類,能指出亮的星座至少6 座。\r\n專科章,星象,技能類,能利用3 個以上之星座找尋方位。\r\n專科章,星象,技能類,能指出北極星。\r\n專科章,星象,技能類,參觀天文臺或星象館能記錄其設備及其內容。\r\n專科章,氣象,技能類,能使用5 種氣象觀測儀器。\r\n專科章,氣象,技能類,能根據氣象報告繪出簡略氣象圖。\r\n專科章,氣象,技能類,能解釋氣象局所繪之天氣圖。\r\n專科章,氣象,技能類,能詳述風速、溫度、氣壓、雨量等變化與農作物生長等，及其相互間的關係。\r\n專科章,氣象,技能類,曾實地記錄兩個月以上之氣溫、雨量而有統計表者。\r\n專科章,定向運動,技能類,能說出向運動的意義及內涵。\r\n專科章,定向運動,技能類,能使用指北針判別方位。\r\n專科章,定向運動,技能類,能正確判讀定向運動的地圖。\r\n專科章,定向運動,技能類,能實地完成徒步定向、滑雪定向、單車定向等任一種運動。\r\n專科章,測量,技能類,能描繪地形草圖。\r\n專科章,測量,技能類,能使用比例尺、指北針。\r\n專科章,測量,技能類,能用各種方法測量高度、方位及距離。\r\n專科章,測量,技能類,能目測計算簡單地形的面積。\r\n專科章,測量,技能類,能說出等高線及地形、地貌等符號的意義。\r\n專科章,測量,技能類,能依比例繪製草圖。\r\n專科章,訊號,技能類,能詳述電話發明經過、原理及其構造。\r\n專科章,訊號,技能類,能列舉出15 種以上通訊的方法。\r\n專科章,訊號,技能類,譯電及解碼 1、能在30 分鐘內將50 個中文字翻譯成電碼，並須有40 組以上正確。 2、能在12 分鐘內將50 組電碼翻譯成中文，並須有40字以上正確。\r\n專科章,訊號,技能類,收發：二選一 1、能在每分鐘內，收發中文電碼雙旗語12 字。 2、能在每分鐘內，收發中文電碼單旗語5 字。\r\n專科章,訊號,技能類,能用煙、火、聲、光等，其中兩種方法通訊。\r\n專科章,無線電,技能類,能繪製一簡明收音機線路圖。\r\n專科章,無線電,技能類,能架設天線、地線及說明雷雨預防法。\r\n專科章,無線電,技能類,能正確使用電池和充電法。\r\n專科章,無線電,技能類,能檢查收音機的故障及說明修理法。\r\n專科章,無線電,技能類,能自製晶體收音機並能應用。\r\n專科章,無線電,技能類,能說出電台的工作實務情況。\r\n專科章,電腦維修,技能類,能解釋電腦執行架構的五大單元。\r\n專科章,電腦維修,技能類,能舉出各5 種輸入、輸出設備。\r\n專科章,電腦維修,技能類,能指出電腦主要零件設備。\r\n專科章,電腦維修,技能類,能保養、拆裝、檢測及故障排除（包括：滑鼠、鍵盤、螢幕、網路線。）\r\n專科章,電腦維修,技能類,能組裝電腦設備，並能正常開機、關機。\r\n專科章,電腦維修,技能類,能正確判斷電腦故障的原因，並能排除。\r\n專科章,地球科學,技能類,能簡易地解說與辨別各種岩石。\r\n專科章,地球科學,技能類,能判別天候的變化。\r\n專科章,地球科學,技能類,能說出地形、地物的利用。\r\n專科章,地球科學,技能類,能解說天然災害。\r\n專科章,地球科學,技能類,能說明對自然環境維護的方法及策略。\r\n專科章,家俱維修,技能類,能說出各種粉刷工作的進行程序及應注意事項。\r\n專科章,家俱維修,技能類,能詳述用料的配合法及比量。\r\n專科章,家俱維修,技能類,能用漆刷器具、牆壁與天花板等。\r\n專科章,家俱維修,技能類,能修理門窗及櫥櫃等之鉸鏈。\r\n專科章,家俱維修,技能類,能裝配門、窗、玻璃及糊壁紙。\r\n專科章,家俱維修,技能類,能修理室內用具及裝飾物件。\r\n專科章,家俱維修,技能類,能磨礪刀、剪等物件。\r\n專科章,家俱維修,技能類,能製作簡易實用品數件。\r\n專科章,游泳,健身類,能向初學者說明游泳應注意的事項，及指導準備運動。\r\n專科章,游泳,健身類,能演示救溺法。\r\n專科章,游泳,健身類,能說明游泳時及前、後的注意事項。\r\n專科章,游泳,健身類,能在60 秒內游完50 公尺。\r\n專科章,游泳,健身類,能游200 公尺以上。\r\n專科章,划船,健身類,持有游泳專科章。\r\n專科章,划船,健身類,能以雙手獨划前進、後退、左、右轉，並能急停船。\r\n專科章,划船,健身類,能演示操舵法。\r\n專科章,划船,健身類,能演示上船法、在船中的安全動作，並能前進、靠岸等操作。\r\n專科章,划船,健身類,能說明接近他船或障礙物的操作，和防止互衝處置法。\r\n專科章,划船,健身類,能正確地繫船。\r\n專科章,划船,健身類,能說出乘艇的檢點、整備的要點。\r\n專科章,划船,健身類,有兩次每次兩小時以上的航行經驗，並有航行紀錄。\r\n專科章,划船,健身類,能操作獨木舟划行兩公里（含曲線前進及迴轉）。\r\n專科章,球類,健身類,能說出5 種以上球類之比賽方法。\r\n專科章,球類,健身類,曾參加3 種以上之球類運動。\r\n專科章,球類,健身類,能籃球上籃20 次而投中15 球。\r\n專科章,體適能,健身類,能說出體適能的定義及重要性。\r\n專科章,體適能,健身類,能協助團長施測各項體適能。\r\n專科章,體適能,健身類,仰臥起坐60 秒：依教育部體適能標準常模，能達到百分等級60 以上。\r\n專科章,體適能,健身類,坐姿體前彎：依教育部體適能標準常模，能達到百分等級70 以上。\r\n專科章,體適能,健身類,立定跳遠：依教育部體適能標準常模，能達到百分等級70 以上。\r\n專科章,體適能,健身類,800(1600) 公尺跑走：依教育部體適能標準常模，能達到百分等級60 以上。\r\n專科章,武術,健身類,曾習拳術6 個月以上。\r\n專科章,武術,健身類,能演徒手拳二路。\r\n專科章,武術,健身類,能演示木棍一路。\r\n專科章,武術,健身類,能說出武術的派別和優點。\r\n專科章,越野,健身類,能說出越野訓練的目的。\r\n專科章,越野,健身類,能在平地運用跑走相間方法跑完2000 公尺（自行預估時間誤差值不得超過5 ％）。\r\n專科章,越野,健身類,能以越野的時間，估測兩地的距離（誤差值平地不得超過5 ％，坡地不得超過8 ％）。\r\n專科章,越野,健身類,曾參加越野賽跑兩次以上。（累積達10 公里以上）\r\n專科章,攀登,健身類,能說出從事攀岩的基本裝備及使用方法。\r\n專科章,攀登,健身類,能說出「確保」的要領，並能操作正確而且安全的「確保」動作。\r\n專科章,攀登,健身類,能正確地操作「垂降」姿勢，以及運用「普魯士結」上升。\r\n專科章,攀登,健身類,能概略說出攀岩歷史及種類，人工及天然攀岩場的特性與差異。\r\n專科章,攀登,健身類,能以平衡攀登的基本技巧，與三點不動一點動的動作原則進行攀登。\r\n專科章,攀登,健身類,能在完整確保情況下，徒手完成正確的10 公尺攀登。\r\n專科章,攀登,健身類,能恪守安全規範，攀岩禮儀，及岩場使用規則。\r\n專科章,自行車,健身類,能於平路騎乘自行車1 小時行駛10 公里以上。\r\n專科章,自行車,健身類,能知道自行車主要構造的名稱，並能說出保養的方法。\r\n專科章,自行車,健身類,能說出自行車行駛時的交通規則。\r\n專科章,自行車,健身類,能依照地圖騎乘自行車，並能傳遞口訊和完成所指示的觀察。\r\n專科章,溜冰（可以直排輪代替）,健身類,穿著溜冰鞋能在冰上或地上進、退，快慢自如。\r\n專科章,溜冰（可以直排輪代替）,健身類,能穿著冰鞋走路。\r\n專科章,溜冰（可以直排輪代替）,健身類,能在起伏地形溜冰。\r\n專科章,溜冰（可以直排輪代替）,健身類,能修理溜冰鞋。\r\n專科章,騎術,健身類,能識別馬的品種和優劣。\r\n專科章,騎術,健身類,能說出馬的疾病症狀。\r\n專科章,騎術,健身類,能說出馬的飼養法及衛生。\r\n專科章,騎術,健身類,能說出馬蹄鐵之功用。\r\n專科章,騎術,健身類,能裝配馬鞍。\r\n專科章,騎術,健身類,能說出各種口令及記號。\r\n專科章,騎術,健身類,能說出馬隻牽引及栓馬法。\r\n專科章,騎術,健身類,能在各種速度上、下馬。\r\n專科章,騎術,健身類,能騎行各種步法( 漫步、輕快步、跑步)。\r\n專科章,騎術,健身類,能在馬上體操。\r\n專科章,騎術,健身類,能騎馬跳躍障礙。\r\n專科章,騎術,健身類,能說出溜馬之重要。\r\n專科章,射擊,健身類,能說出步槍、手槍射擊法。\r\n專科章,射擊,健身類,能說出射擊理論，安全常識。\r\n專科章,射擊,健身類,能用步槍在50 公尺處擊靶5 次，平均每次得50 分以上。\r\n專科章,射擊,健身類,能用手槍在10 公尺處擊靶5 次，平均每次得50 分以上。\r\n專科章,射箭,健身類,能說明射箭運動的發展歷史及射箭運動的特色。\r\n專科章,射箭,健身類,能說明射箭運動的禮節及安全守則。\r\n專科章,射箭,健身類,能指出弓、箭器材的各部位名稱。\r\n專科章,射箭,健身類,能說明射箭比賽的規則及計分方式。\r\n專科章,射箭,健身類,能演示射箭的基本動作與實際操作射箭基本動作。\r\n專科章,射箭,健身類,參與兩小時射箭課程講習，經筆試合格，並能達成8 公尺12 箭總分60分以上及格者。\r\n專科章,音樂,興趣類,瞭解基本樂理（五線譜、簡譜、音樂術語、音樂記號、中西樂器的分類）。-- 筆試。\r\n專科章,音樂,興趣類,依照樂譜上的指示，以演唱或演奏（中西樂器皆可）的方式來表演一首歌曲或民謠。-- 現場表演。\r\n專科章,音樂,興趣類,書面報告（2000 字以上）：以下二選一。 1、 聽一場音樂會（中西樂皆可）或於大眾傳播媒體上欣賞類似的節目二至三小時，能介紹作曲家、音樂家、指揮及這個節目或歌劇的故事背景，發表對於這場音樂會的心得感想。 2、概述台灣本土的音樂發展，並介紹5 位台灣知名的作曲家與音樂家，及一種台灣原住民音樂。\r\n專科章,音樂,興趣類,且須具備下列之一者： 1、參與音樂性社團六個月以上，且於公開場合表演五次以上，並請相關單位協助提出公開表演證明（例如節目單、照片⋯）。-- 相關證明 2、在公開場合活動中，教唱3 首歌曲，並配合歌曲設計動作，帶動唱。-- 現場示範 3、能以五線譜創作至少12 小節的樂曲，並演唱或演奏之。-- 現場表演 4、能將自己或家人收藏之影音媒體（CD、TAPE、DVD⋯）編製目錄，並介紹其如何使用與保存。--攜帶目錄，現場口試\r\n專科章,戲劇,興趣類,能編一段短劇，並自任導演。\r\n專科章,戲劇,興趣類,能自行化粧，並處理劇內角色的特性及化裝技巧。\r\n專科章,戲劇,興趣類,能分辨舞台劇與電影的表演技巧。\r\n專科章,戲劇,興趣類,能解說舞台基本設計、燈光處理、佈景及道具的運用。\r\n專科章,戲劇,興趣類,露營時能作各種娛樂之表演。\r\n專科章,舞蹈,興趣類,能演示及應用舞蹈的基本步法。並具有身體韻律節奏的能力。\r\n專科章,舞蹈,興趣類,參與土風舞活動，並能分辨我國與他國土風舞。\r\n專科章,舞蹈,興趣類,能指導土風舞或舞曲的演出。\r\n專科章,舞蹈,興趣類,能創作土風舞或舞曲一種。\r\n專科章,號角,興趣類,能說出號譜及節拍。\r\n專科章,號角,興趣類,能背吹步號進行曲4 首。\r\n專科章,號角,興趣類,能吹童軍應用號譜5 首。\r\n專科章,號角,興趣類,能解說中西樂器各4 種。\r\n專科章,特技,興趣類,能作民俗技藝3 種以上： 1、能放自製風箏。 2、能作8 種以上的花式踢毽子。 3、能跳兩支以上民族舞。 4、能作5 種以上中國結。 5、能作6 種以上扯鈴。 6、能作5 種以上的花式跳繩。\r\n專科章,特技,興趣類,能作特殊技能兩種以上： 1、能放自製的滑翔翼。 2、能作簡易魔術5 種。 3、能跳5 支以上土風舞。 4、能表演6 種以上的口技。\r\n專科章,紙藝,興趣類,能說出造紙原料3 種以上並能製作手工紙。\r\n專科章,紙藝,興趣類,能說出普通常用紙類5 種以上。\r\n專科章,紙藝,興趣類,能作紙藝( 摺紙、剪紙、紙雕) 兩種以上。\r\n專科章,紙藝,興趣類,能辨別紙的絲流方向，並應用絲流的特性於紙藝上。\r\n專科章,紙藝,興趣類,能用廢紙作簡單應用品兩種以上。\r\n專科章,皮雕,興趣類,能分辨人造皮與獸皮。\r\n專科章,皮雕,興趣類,能分辨牛皮、羊皮、鹿皮及豬皮等。\r\n專科章,皮雕,興趣類,能正確使用皮革工具進行剪、切、雕、打孔、縫合、編織、裝訂等技法。\r\n專科章,皮雕,興趣類,能作簡單皮件修補工作。\r\n專科章,皮雕,興趣類,能製作簡易童軍皮雕。\r\n專科章,陶藝,興趣類,能分辨陶、瓷土的性質及其用途。\r\n專科章,陶藝,興趣類,能用練土法拌和陶瓷土。\r\n專科章,陶藝,興趣類,能分辨陶瓷器皿之優劣。\r\n專科章,陶藝,興趣類,能用（手捏、泥條、土板、拉坏）中兩種技法塑造簡單器皿兩種以上。\r\n專科章,陶藝,興趣類,能正確上釉，並完成釉燒作品一件。\r\n專科章,編織,興趣類,能說出編織的歷史。\r\n專科章,編織,興趣類,能說出編織所用的各種材料及其產地。\r\n專科章,編織,興趣類,能說出各種材料的編織方法和應用工具。\r\n專科章,編織,興趣類,能利用籐竹、蘆葦、稻草、麥桿、絲、麻、棉線等材料編織成實用品3件以上。\r\n專科章,編織,興趣類,能整理和保管各項編織用品。\r\n專科章,雕塑,興趣類,能以泥材塑型（立體圓雕作品）。\r\n專科章,雕塑,興趣類,能以石材、木材、泥材3 種材料之一作半立體的浮雕。\r\n專科章,雕塑,興趣類,能以原型作石膏模型。\r\n專科章,雕塑,興趣類,能有熟練翻製蠟、石膏、塑膠等材料之翻模技術。\r\n專科章,繪畫,興趣類,能說出中西繪畫的簡史和特質。\r\n專科章,繪畫,興趣類,能演示國畫或西畫的畫法。\r\n專科章,繪畫,興趣類,能說出色彩學的大意。\r\n專科章,繪畫,興趣類,能繪想像畫、記憶畫、寫生畫、裝飾畫、插畫或漫畫，以上任選一種。\r\n專科章,繪畫,興趣類,能繪國畫或西畫一幅。\r\n專科章,攝影,興趣類,能說出攝影學原理。\r\n專科章,攝影,興趣類,能解說傳統相機與數位相機的構造、原理、操作與保養方法。\r\n專科章,攝影,興趣類,能演示控制景深的方法。\r\n專科章,攝影,興趣類,能說出照片放大法。\r\n專科章,攝影,興趣類,能拍攝六吋風景4 張（內有雨景、夜景），人像一張，靜物一張，室內景一張，動物一張。\r\n專科章,廣告設計,興趣類,能說出廣告設計的意義。\r\n專科章,廣告設計,興趣類,能說出廣告設計的構成要素。\r\n專科章,廣告設計,興趣類,能說出廣告設計編排的意義、注意要項及常用的編排法。\r\n專科章,廣告設計,興趣類,能說出並遵守廣告設計相關法規及智慧財產權保護法。\r\n專科章,廣告設計,興趣類,能用繪圖工具設計活動標章（LOGO）。\r\n專科章,廣告設計,興趣類,能用三階段草圖（創意草圖S：1/4 →發展粗稿S：1/2 →精細色稿S：1/1）將創意視覺化完成活動或公益海報一張（對開）。\r\n專科章,電腦繪圖,興趣類,能說出電腦繪圖的應用範圍，及專用術語。\r\n專科章,電腦繪圖,興趣類,能操作電腦繪圖的軟、硬體及周邊設備。\r\n專科章,電腦繪圖,興趣類,能應用繪圖軟體繪製下列質感： 1、木紋 2、石材 3、塑膠 4、金屬 5、玻璃 6、皮革 7、絲綢 8、粗麻布\r\n專科章,電腦繪圖,興趣類,能將文字或圖案立體化並設定不同光源效果。\r\n專科章,電腦繪圖,興趣類,能應用貝茲曲線（BEZIER CURVES）繪製A4 插畫及連續圖案各一張。\r\n專科章,電腦繪圖,興趣類,能應用影像處理軟體之MASK、修色、反差控制、濾鏡、過網⋯等功能，完成A3 合成影像一幅。\r\n專科章,網頁設計,興趣類,能解說網際網路瀏覽及網路組態設計的知識。\r\n專科章,網頁設計,興趣類,能正確說出網頁設計的組成元素與設計要領。\r\n專科章,網頁設計,興趣類,能正確說出常用之網頁編輯軟體的名稱與特性。\r\n專科章,網頁設計,興趣類,能解說網路資源分享及安全管制的觀念與知識。\r\n專科章,網頁設計,興趣類,能將製作網頁所指定內容材料，依指示正確操作，並利用電腦傳輸檔案至其他伺服器，成功完成各頁面串聯。\r\n專科章,建築,興趣類,能說出建築工程的發展趨勢。\r\n專科章,建築,興趣類,能說出建築物的異同及其優劣。\r\n專科章,建築,興趣類,能說出建築五金土木用料及其品質。\r\n專科章,建築,興趣類,能繪製簡單立體投影畫（三面視圖）及透視圖法。\r\n專科章,建築,興趣類,能做簡單建築圖樣（平面圖、側面圖、基礎圖、屋架圖、水電裝配圖、剖面圖等）。\r\n專科章,辯論,興趣類,能藉簡明的摘要作5 分鐘以上的國語演說。\r\n專科章,辯論,興趣類,能詳述辯論規則和主席的職權。\r\n專科章,辯論,興趣類,曾參加正式辯論兩次以上。\r\n專科章,辯論,興趣類,能說出辯論時的動作態度和其他應注意之點。\r\n專科章,編撰,興趣類,能將本團團部一切情形作一篇系統的文字報導。\r\n專科章,編撰,興趣類,曾在團部內主編刊物。\r\n專科章,編撰,興趣類,能採訪一件有價值的新聞，並加以報導。\r\n專科章,編撰,興趣類,能說出新聞編輯的方法。\r\n專科章,翻譯,興趣類,能直接聽外國語一種。\r\n專科章,翻譯,興趣類,能利用單字或片語，寫成通順之外國語句。\r\n專科章,翻譯,興趣類,能用一種外國語作簡短書信一封。\r\n專科章,翻譯,興趣類,能翻譯外國文章一篇。\r\n專科章,應用化學,興趣類,能說出漿糊、牙膏、粉筆、肥皂、墨汁、紅、藍墨水等的製作法。\r\n專科章,應用化學,興趣類,能自製蒸餾水及配製各種飲料汽水。\r\n專科章,應用化學,興趣類,能說出電鍍的基本原料和方法。\r\n專科章,應用化學,興趣類,能說出織物纖維的種類和漂染方法。\r\n專科章,應用化學,興趣類,能說出炸藥和煙幕的配合和製作方法。\r\n專科章,應用化學,興趣類,能說出滅火器的設備和使用法。\r\n專科章,農藥,興趣類,能說出重要農藥的性質及其方法。\r\n專科章,農藥,興趣類,能說出重要農藥的延毒作用。\r\n專科章,農藥,興趣類,能說出使用農藥應注意事項。\r\n專科章,農藥,興趣類,能說出噴霧、噴粉、塗刷、燻蒸等方法及應注意事項。\r\n專科章,農藥,興趣類,能說出重要農藥對溫血動物的藥害。\r\n專科章,農藝,興趣類,能識別主要農作物10 種以上。\r\n專科章,農藝,興趣類,能識別土壤質地及肥料三要素，並能解說土質與作物生長關係有相當瞭解。\r\n專科章,農藝,興趣類,能識別病害、蟲害各10 種，並能說出其防治方法。\r\n專科章,農藝,興趣類,能使用新式農具，並能說出農具之保養方法。\r\n專科章,農藝,興趣類,對操作各項田間農稼，並能說出其操作時期及方法。\r\n專科章,農藝,興趣類,有實際栽培一種以上作物至收穫之紀錄者。\r\n專科章,農產加工,興趣類,能說出農產加工對人生的重要。\r\n專科章,農產加工,興趣類,能說出農產加工的種類。\r\n專科章,農產加工,興趣類,能說出農產加工原料的特性。\r\n專科章,農產加工,興趣類,能說出一般農產加工的原理及製作方法。\r\n專科章,農產加工,興趣類,能夠鑑別農產加工品之優劣。\r\n專科章,農產加工,興趣類,能製作麵類及果實加工品各5 種。\r\n專科章,園藝,興趣類,能說出種菜和種花的原理及方法。\r\n專科章,園藝,興趣類,能說出蔬菜的簡易分類及食用價值。\r\n專科章,園藝,興趣類,能說出花卉的簡易分類及觀賞價值。\r\n專科章,園藝,興趣類,能夠分辨或介紹重要蔬菜花卉各10 種。\r\n專科章,園藝,興趣類,能說出園藝作物的繁殖方法。\r\n專科章,園藝,興趣類,能說出園藝作物對人類的重要性。\r\n專科章,園藝,興趣類,能說出氮、磷、鉀肥料成分比例，及對於花卉成長之助益。\r\n專科章,植物,興趣類,能說出兩門以上植物的生活史。\r\n專科章,植物,興趣類,能說出植物的形態構造。\r\n專科章,植物,興趣類,能說明植物的分類。\r\n專科章,植物,興趣類,能說出當地植物分佈情形及其利用方法。\r\n專科章,植物,興趣類,能說出當地的食用、藥用、有毒、香料、材用、纖維、染料、指標、觀賞植物等共20 種以上及其習性。\r\n專科章,昆蟲,興趣類,能說出兩目以上昆蟲的生活史。\r\n專科章,昆蟲,興趣類,能說出昆蟲形態及重要習性。\r\n專科章,昆蟲,興趣類,能說出昆蟲之基本分類方法。\r\n專科章,昆蟲,興趣類,能說出當地蝶類、甲蟲、蛾類等各類昆蟲20 種以上，及其習性。\r\n專科章,昆蟲,興趣類,能說出對居家有害的昆蟲防治法及驅趕法。\r\n專科章,養蜂,興趣類,能鑑別蜜蜂的品種及蜂群習性。\r\n專科章,養蜂,興趣類,能使用養蜂各項用具，並能說出飼養之方法。\r\n專科章,養蜂,興趣類,能說出蜂房種類、構造，及分封方法並曾實地操作。\r\n專科章,養蜂,興趣類,有養蜂的實際績效，並有紀錄或報告。\r\n專科章,養蜂,興趣類,能說出選擇蜂房的場所及各項管理要點。\r\n專科章,養蠶,興趣類,能識別蠶的品種，並鑑別其優劣。\r\n專科章,養蠶,興趣類,能說出蠶的製種、孵育、飼養、縲絲及蠶室管理方法，並有實地經驗。\r\n專科章,養蠶,興趣類,能說出蠶病的預防和補救方法。\r\n專科章,養蠶,興趣類,能說出桑樹栽培及桑園管理方法。\r\n專科章,養蠶,興趣類,能自行製作簡單養蠶工具。\r\n專科章,標本製作,興趣類,能說出動物標本剝製、浸製和乾製的方法。\r\n專科章,標本製作,興趣類,能說出植物標本採集和製作方法。\r\n專科章,標本製作,興趣類,能說出昆蟲標本採集、製作和保存方法。\r\n專科章,標本製作,興趣類,能說出標本製作工具和藥品的種類及使用方法。\r\n專科章,標本製作,興趣類,能製作植物及昆蟲標本各兩種以上。\r\n專科章,畜牧,興趣類,能說出我國和各國的畜牧概況。\r\n專科章,畜牧,興趣類,能說出畜牧和人類的關係。\r\n專科章,畜牧,興趣類,能說出主要家畜、家禽的飼養及管理方法。\r\n專科章,畜牧,興趣類,能飼養家畜、家禽各一種，並將飼養經過作成詳細有系統之紀錄。\r\n專科章,畜牧,興趣類,能說出禽、畜防疫及一般傷害疾病急救方法。\r\n專科章,獸醫,興趣類,能說出解剖學的大要。\r\n專科章,獸醫,興趣類,能由家禽的呼吸數、體溫及脈搏診察其健康與否。\r\n專科章,獸醫,興趣類,能說出主要藥劑的特性功能及其使用方法。\r\n專科章,獸醫,興趣類,能說出禽、畜普通病症的治療方法。\r\n專科章,獸醫,興趣類,能說出家畜受傷害後的救護法。\r\n專科章,獸醫,興趣類,能查驗禽、畜的傳染病症，並能說出其預防方法。\r\n專科章,獸類,興趣類,能說出數類哺乳動物的生活史。\r\n專科章,獸類,興趣類,能說出一般獸類的生理及形態名稱。\r\n專科章,獸類,興趣類,能說出獸類的足跡、排遺及食痕的描述記錄法。\r\n專科章,獸類,興趣類,認識獸類20 種以上及其生活習性。\r\n專科章,釣魚,興趣類,能說出釣魚的方法並能使用釣魚用具。\r\n專科章,釣魚,興趣類,能說出5 種以上的淡水魚類之名稱及習性。\r\n專科章,釣魚,興趣類,能說出養魚的方法。\r\n專科章,釣魚,興趣類,能寫出5 種以上本土保育的魚類名稱。\r\n專科章,魚類,興趣類,能說出不同類型魚類的生活史。\r\n專科章,魚類,興趣類,能說出魚類的內外部的形態及名稱。\r\n專科章,魚類,興趣類,能詳述當地常見的有毒魚類（若無則免）。\r\n專科章,魚類,興趣類,能說出5 種以上常見魚類的生活習性。\r\n專科章,賞鳥,興趣類,能正確調整、使用望遠鏡，觀察野外鳥類，且能說出望遠鏡各部位標示的意義。\r\n專科章,賞鳥,興趣類,能在室內、外正確的保養、保護、保存望遠鏡。\r\n專科章,賞鳥,興趣類,能說出鳥類體表的各部位名稱。\r\n專科章,賞鳥,興趣類,能說出各類野生鳥類的作息及最佳的觀察季節與時間。\r\n專科章,賞鳥,興趣類,能正確的記述或簡單繪圖標示鳥類的特徵。\r\n專科章,賞鳥,興趣類,能辨識且解說常見野生陸鳥及水鳥各20 種( 共40 種)。\r\n專科章,賞鳥,興趣類,能正確使用圖鑑辨識鳥類。\r\n專科章,賞鳥,興趣類,會做簡易的鳥類調查紀錄。\r\n專科章,賞鳥,興趣類,規劃執行小區域簡單的鳥類資源調查，並完成報告（20次以上調查紀錄的整理）。\r\n專科章,簿記,興趣類,能說出記帳之意義及其重要。\r\n專科章,簿記,興趣類,要達到迅速、正確、完備明瞭之目的。\r\n專科章,簿記,興趣類,要有熟練之記帳技術。\r\n專科章,簿記,興趣類,要能編製正確之各種報表。\r\n專科章,統計圖表,興趣類,能說出統計的意義及其重要。\r\n專科章,統計圖表,興趣類,能說出一般統計製表的規則及方法。\r\n專科章,統計圖表,興趣類,能說出各種圖表的應用比較。\r\n專科章,統計圖表,興趣類,能繪製線圖、條圖、面積圖、象形圖和統計地圖。\r\n專科章,珠算,興趣類,能說出學習珠算之目的。\r\n專科章,珠算,興趣類,能說出算盤之歷史。\r\n專科章,珠算,興趣類,能熟練地操作運珠法與運指法。\r\n專科章,珠算,興趣類,能熟練各種計算方法。 1、加減算 2、乘算 3、除算 4、傳票算 5、心算 6、乘算定位法 7、除算定位法 8、應用計算 9、開方\r\n專科章,泥工,興趣類,能說出泥工用具的使用方法。\r\n專科章,泥工,興趣類,能說出混凝土的人工拌和與機械拌和法。\r\n專科章,泥工,興趣類,能說出混凝土的配合比例。\r\n專科章,泥工,興趣類,能說出混凝土震動器的使用方法。\r\n專科章,泥工,興趣類,能舖卵石或砌磚牆。\r\n專科章,漆工,興趣類,能說出油漆工作時的健康管理及安全與環境維護。\r\n專科章,漆工,興趣類,能說出油漆的原料及配合法。\r\n專科章,漆工,興趣類,能說出生漆和調和漆的優劣。\r\n專科章,漆工,興趣類,能說出市面上油漆的種類、特性及用途。\r\n專科章,漆工,興趣類,能詳述油漆工具的使用法和保管法。\r\n專科章,漆工,興趣類,能使用油漆法進行下列物品之塗刷：門窗、牆壁、天花板、傢俱、鋼鐵器物。\r\n專科章,漆工,興趣類,能詳述各種油漆的保管法。\r\n專科章,木工,興趣類,能識別針葉與闊葉木各5 種以上。 1、針葉：杉木、松木、檜木、鐵杉等。 2、闊葉：胡桃木、白楊木、樺木、柚木、樟木等。\r\n專科章,木工,興趣類,能說出各種主要木材的特性及其用途。\r\n專科章,木工,興趣類,能熟練的使用一般普通木工器具和磨礪的方法。\r\n專科章,木工,興趣類,能說明各種榫接法，並能製造公母榫接一種以上。\r\n專科章,木工,興趣類,能製作實用木器一具。\r\n專科章,裁縫,興趣類,能說出各種線號。\r\n專科章,裁縫,興趣類,能裁開三角形及長條形布條。\r\n專科章,裁縫,興趣類,能用手縫補破洞。\r\n專科章,裁縫,興趣類,能用尺量身材，並完成活動背心一件。\r\n專科章,裁縫,興趣類,能為縫紉機上油。\r\n專科章,電工,興趣類,能說出各種電工材料及其規格。\r\n專科章,電工,興趣類,能分辨直流電和交流電。\r\n專科章,電工,興趣類,能說出電流、電壓、電阻的意義，及其關係與量度法。\r\n專科章,電工,興趣類,能區分高壓電與低壓電。\r\n專科章,電工,興趣類,能進行各種電線的接合法及絕緣措施與漏電檢查。\r\n專科章,電工,興趣類,能正確使用電路的連接法（串聯與並聯）。\r\n專科章,電工,興趣類,能說出防止觸電及觸電時之急救。\r\n專科章,機械,興趣類,能說出機械作功的意義。\r\n專科章,機械,興趣類,能說出6 種簡單機械作功的基本原理及其運用。\r\n專科章,機械,興趣類,能說出發電機、電動機的功用，及其主要構造與保管維護要領。\r\n專科章,機械,興趣類,能熟練地操作砂輪、鑽床、車床等簡單機械。\r\n專科章,機械,興趣類,能熟練的使用工具，例如：劃線架、螺絲、手鋸、電鑽等。\r\n專科章,機械,興趣類,能解說機械工圖說及插繪簡單工作圖。\r\n專科章,機械,興趣類,能判讀各種尺寸及使用一般測量儀具。\r\n專科章,機械,興趣類,能照圖製作簡單構架與零件。\r\n專科章,板金工,興趣類,能說出各種鐵皮材料的規格及其用途。\r\n專科章,板金工,興趣類,能說出各種鐵皮材料的施工方法。\r\n專科章,板金工,興趣類,能使用一般的板金工具。\r\n專科章,板金工,興趣類,能說出寸法的使用。\r\n專科章,板金工,興趣類,能看圖劃線及估料計料。\r\n專科章,板金工,興趣類,能處理搥擊、修邊、捲邊、和撓扣鑲工作。\r\n專科章,鉗工,興趣類,能說出各種鐵材及其性質。\r\n專科章,鉗工,興趣類,能說出工具的使用方法。\r\n專科章,鉗工,興趣類,能說出寸法的使用。\r\n專科章,鉗工,興趣類,能解說草圖、藍圖的內容。\r\n專科章,鉗工,興趣類,能作正方或三角開孔鐵或直角曲尺實樣一件。\r\n專科章,銲工,興趣類,能判讀藍圖與焊接符號。\r\n專科章,銲工,興趣類,能說出電氣的基本常識。\r\n專科章,銲工,興趣類,熟練地操作「電焊」與「氣焊」設備。\r\n專科章,銲工,興趣類,能詳述「對接法」與「搭接法」工作之執行要領。\r\n專科章,銲工,興趣類,能判別焊接工作之圓滿與否。\r\n專科章,汽車修護,興趣類,能說出汽車的種類和用途。\r\n專科章,汽車修護,興趣類,能說出汽車各主要機件的名稱。\r\n專科章,汽車修護,興趣類,能說出汽車發動前後的檢查要領。\r\n專科章,汽車修護,興趣類,能檢查汽車輪胎氣壓是否正常及換裝輪胎。\r\n專科章,汽車修護,興趣類,能做汽車之清洗、擦拭、打臘及維護。\r\n專科章,汽車修護,興趣類,能做四油、三水的檢查與電路上的故障排除工作。\r\n專科章,機車修護,興趣類,能解說各型車種廠牌及汽缸容量。\r\n專科章,機車修護,興趣類,能說出機車原理及各種構造。\r\n專科章,機車修護,興趣類,可以簡單修護電路及故障。\r\n專科章,機車修護,興趣類,能裝拆輪胎，修補內胎。\r\n專科章,機車修護,興趣類,騎機車能掌握起動要領與駕駛技巧。\r\n專科章,機車修護,興趣類,能做火星塞之檢查及清洗。\r\n專科章,自行車修護,興趣類,能解說各種自行車之車型及其特性。\r\n專科章,自行車修護,興趣類,能知道自行車的全部構造及其功能。\r\n專科章,自行車修護,興趣類,能分解及裝合任何型別之自行車。\r\n專科章,自行車修護,興趣類,能修理自行車機件、車胎及處理一般故障。\r\n專科章,帆船,興趣類,持有游泳專科章。\r\n專科章,帆船,興趣類,能說出帆船船具保養與清潔要領。\r\n專科章,帆船,興趣類,能駕駛與操縱帆船，熟悉操帆法、操舵法、上船法、船中的安全動作，並熟練前進、靠岸等操作。\r\n專科章,帆船,興趣類,能救援落水人員。\r\n專科章,帆船,興趣類,能熟練應用稱人結的繫船法。\r\n專科章,帆船,興趣類,能說出帆船檢點整備的要點。\r\n專科章,機帆船,興趣類,能說出機帆船的構造概略。\r\n專科章,機帆船,興趣類,能說出發動機的保養要領。\r\n專科章,機帆船,興趣類,能駕駛與操縱機帆船。\r\n專科章,機帆船,興趣類,能應用通訊訊號。\r\n專科章,機帆船,興趣類,能說出機帆船各部份的保養及清潔要領。\r\n專科章,機帆船,興趣類,能照料暈船人員。\r\n專科章,飛機,興趣類,能識別飛機、飛船及飛艇。\r\n專科章,飛機,興趣類,能識別飛機種別、型別及標幟。\r\n專科章,飛機,興趣類,能說出飛機、飛船、飛艇的飛行原理。\r\n專科章,飛機,興趣類,能說出飛機進步沿革及製造大概。\r\n專科章,飛機,興趣類,能說出軍機的攻擊方式及防禦方法。\r\n專科章,飛機,興趣類,能製造一種以上的飛機模型。\r\n專科章,國防科技,興趣類,能說出國防科技在國家、人類文明的定位。\r\n專科章,國防科技,興趣類,能說出我國的國防科技成就，並曾參觀過國防科技展或演示。\r\n專科章,國防科技,興趣類,能述說我國陸、海、空主要武器載具的種類、用途與優缺點。\r\n專科章,國防科技,興趣類,能述說非殺傷性武器的種類與其特性。\r\n專科章,國防科技,興趣類,能說出國防科技對未來戰爭的影響。\r\n專科章,化生放,興趣類,能說出化學戰劑（毒氣）的種類和性能。\r\n專科章,化生放,興趣類,能說出生物戰劑（細菌）的種類和性能。\r\n專科章,化生放,興趣類,能說出放射線戰劑（核輻射）的簡單性能。\r\n專科章,化生放,興趣類,能說出躲避毒氣及中毒施救的方法。\r\n專科章,化生放,興趣類,能分辨生化警報種類，並能遵從安全人員之指揮，在聞警報時迅速避向安全地區。\r\n專科章,望遠鏡,興趣類,能說出雙筒望遠鏡的各種配件。\r\n專科章,望遠鏡,興趣類,能說出望遠鏡的成像原理。\r\n專科章,望遠鏡,興趣類,能使用望遠鏡，並能將標的物在地圖上與現地作對照。\r\n專科章,望遠鏡,興趣類,能說出望遠鏡的操作原理。\r\n專科章,望遠鏡,興趣類,能說出不同望遠鏡的保養方法。\r\n",
   "progressRules": {
    "初級": "凡年滿11歲之少年，經家長同意，自願申請參加為童軍。經2個月以上，初級童軍合格標準訓練，由小隊長在群體生活中，訓練其童軍技能；童軍精神經團長認可後，由所屬童軍團向縣（市）童軍會辦理登記後，舉辦宣誓入團儀式，背誦童軍諾言，佩戴初級童軍章、團領巾。幼童軍升團後，經2個月以上，初級童軍合格標準訓練，由小隊長在群體生活中，訓練其童軍技能；童軍精神經團長認可後，舉辦宣誓儀式，背誦童軍諾言，佩戴初級童軍",
    "中級": "晉級初級童軍後，開始4個月以上，中級童軍合格標準訓練，在群體生活中由小隊長考驗其童軍技能，童軍精神經團長認可後，登錄於「童軍、行義童軍晉級手冊」，公開舉辦晉級儀式，頒發中級童軍",
    "高級": "晉級中級童軍後，開始5個月以上，高級童軍合格標準訓練，其童軍精神、領導能力、群體生活，經團長認可，推薦參加縣（市）童軍會舉辦之考驗（營），童軍技能經考驗委員評定確達高級童軍合格標準，由所屬童軍團向縣（市）童軍會辦理晉級，經縣（市）童軍會核定後，向省（市）童軍會、總會填報晉級名冊，公開舉辦晉級儀式或縣（市）童軍會舉辦慶典活動中，頒授高級童軍合格證書及高級童軍章。新加入行義童軍尚未取得高級童軍章者，得由所屬童軍團進行4個月以上之高級童軍進程訓練。經團長考驗，認其確具高級童軍精神、領導能力、群體生活、技能標準者，由所屬童軍團向縣（市）童軍會辦理高級童軍核備後，佩戴高級童軍",
    "獅級": "核准高級童軍章之後，開始6個月以上，獅級童軍合格標準訓練，其童軍精神、領導能力、群體生活，經團長認可；專科智能，經考驗委員評定合於專科章標準。各項經團長確達獅級童軍合格標準，由所屬童軍團提報縣（市）童軍會申請晉級，經縣（市）童軍會核定，縣（市）童軍會並向省（市）童軍會、總會填報晉級名冊，公開舉辦晉級儀式，或在省（市）、縣（市）童軍會舉辦之儀典活動，頒授獅級童軍合格證書及獅級童軍",
    "長城": "核准獅級童軍章之後，開始8個月以上，長城級童軍合格標準訓練，其童軍精神、領導能力、群體生活，經團長認可；專科智能，經考驗委員評定合於專科章標準。各項經團長確達長城童軍合格標準，由所屬童軍團提報縣（市）童軍會申請晉級，經縣（市）童軍會審議確達長城級童軍合格標準，由縣（市）童軍會送省（市）童軍會核定，省（市）童軍會向總會填報晉級名冊，公開舉辦晉級儀式，或在省（市）、縣（市）童軍會舉辦之儀典活動，頒授長城級童軍合格證書及長城級童軍章",
    "國花": "核准長城級童軍章之後，開始8個月以上，國花級童軍合格標準訓練，其童軍精神、領導能力、群體生活，經團長認可；專科智能，經考驗委員評定合於專科章標準。各項經團長確達國花級童軍合格標準，由所屬童軍團提報縣（市）童軍會申請晉級，經縣（市）童軍會審議確達國花級童軍合格標準，送總會核定，晉級國花級童軍名冊副知省（市）童軍會。在全國性童軍儀典活動中，頒授國花級童軍合格證書及國花級童軍章"
   }
  },
  "羅浮": {
   "itemsCsv": "類別,級別或章名,大項或分類,項目內容\r\n進程,見習羅浮,途徑1,至少參加二次羅浮群（童軍團）活動，其中一次須為戶外活動。\r\n進程,見習羅浮,途徑1,了解本群（團）的歷史、組織架構、職務與權責。知道羅浮進程的具體內容與羅浮活動。\r\n進程,見習羅浮,途徑1,能以成年人的立場詮釋童軍諾言及規律之意義，並願意具體實踐之。\r\n進程,見習羅浮,途徑2,參加活動：至少參加三次羅浮群（童軍團）活動，其中一次須為戶外活動。\r\n進程,見習羅浮,途徑2,認識童軍： A. 了解本群（團）的歷史、組織架構、職務與權責。 B. 認識我國的童軍運動。 a. 我國童軍運動發展與史略。 b. 我國各階段童軍的進程與活動。 C. 了解世界童軍運動起源及發展概況。\r\n進程,見習羅浮,途徑2,童軍禮節： A. 認識各級童軍的制服樣式，知道羅浮童軍制服及徽章的佩戴法。 B. 認識各級童軍的徽章與標誌。 C. 明瞭並知道使用下列禮節的時機： a. 徒手禮 b. 握手禮 c. 三指禮 D. 明瞭並能使用下列的儀典： a. 升旗、揚旗 b. 降旗\r\n進程,見習羅浮,途徑2,諾言及規律： A. 能背誦童軍諾言。 B. 能以成年人的立場詮釋童軍諾言及規律之意義，並願意具體實踐之。\r\n進程,授銜羅浮,－,童軍知能： A. 認識世界童軍與我國童軍之組織架構。 B. 了解童軍運動的定義、目的、原則及訓練方法。 C. 了解虔敬集會的意義並能運用。 D. 閱讀羅浮童軍相關書籍，書目另定之。\r\n進程,授銜羅浮,－,社區服務：積極參與各類社區服務或其它義務工作，累計達 36 小時。\r\n進程,授銜羅浮,－,戶外活動： A. 積極參與室外環境中的教育與休閒活動，如：野外拓荒、環境保育、自然研究等，至少二類並有書面活動記錄。 B. 熟悉基本露營技巧，曾經在不同營地露營並累積有兩夜以上的經驗。 C. 具備風險意識，能識別、評估及應對各類活動中的潛在風險，並參加急救訓練包含急救概述、創傷止血、包紮、傷患運送、心肺復甦術（CPR）、自動體外電擊器(AED) 操作及異物哽塞等項目，且能操作上述急救方法。\r\n進程,授銜羅浮,－,生活體驗：開啟個人生涯規劃和對社會事務的了解，培養自我覺察之能力，做好個人準備，以融入社會。\r\n進程,授銜羅浮,－,價值理念：省思自我價值，探究自我角色定位，了解並包容他人的觀點，培養個人客觀的態度及宏觀思惟。\r\n進程,授銜羅浮,－,個人興趣：公開展示並介紹有關個人興趣之活動、收集、作品等成果。\r\n進程,授銜羅浮,－,人際關係：曾參加群體研習、訓練等課程、並有與不相熟識的青年一起工作學習的經驗。\r\n進程,授銜羅浮,－,認識世界：認識至少三個國家或地區的文化、歷史、風俗。\r\n進程,服務羅浮,基本要求,心靈發展：探索生命的意義、生活的目的，發展自我價值體系、個人人生哲學與宗教觀。\r\n進程,服務羅浮,基本要求,運動與健康：從事一項或多項運動，持續至少六個月以上。\r\n進程,服務羅浮,基本要求,.野外活動： a. 曾在三個以上不同營地露營並累積有六夜以上的經驗，能享受野外生活樂趣，並展現良好的露營技巧。 b. 邀集伙伴組成團隊，經由共同計畫，進行至少三天兩夜的野外探涉旅行。 c. 知道野外急救的目的，並能於野外操作以下急救方法：傷口清創與止血、包紮、骨折固定(四肢) 、失溫與熱疾病、傷患搬運。\r\n進程,服務羅浮,基本要求,社會服務與學習： a. 參與服務學習達 96 小時以上，並獲有簽證者。 b. 參加童軍組織所辦理之志工、服務學習等研習活動 c. 結合志同道合的伙伴或其他人士共同參與社會服務工作並有具體貢獻。\r\n進程,服務羅浮,主題活動,活動企劃與領導： a. 參加國內外相關「活動企劃與領導」之訓練。 b. 結合跨群團夥伴，主辦累計三天以上的聯團童軍活動。\r\n進程,服務羅浮,主題活動,自然探索與保育： a. 能夠了解台灣之自然生態及當今所面臨之問題，提出相關因應之道。 b. 能實踐「無痕山林」(Leave No Trace)。\r\n進程,服務羅浮,主題活動,專業職能與認證： a. 取得國內外相關「專業團體」之認證證書。 b. 以專業職能策劃辦理二次童軍活動者。參與以上各項主題活動者需逐項提出個人或小組完成該項的具體計畫（含計劃、預期成果、執行、評量或相關具體內容），有關進程之施行辦法內容另訂之。\r\n",
   "progressRules": {
    "見習羅浮": "【途徑1】年滿17歲，曾為高級童軍者得加入羅浮群，於完成下列各項要求，經該羅浮群會議議決後，由群長（團長）頒發見習章成為見習羅浮。【途徑2】符合參加資格之青年得自願申請加入羅浮群，於完成下列各項要求，經羅浮群會議議決後，由群長（團長）頒發見習章成為見習羅浮。",
    "授銜羅浮": "成為見習羅浮滿六個月以上，持續參與羅浮童軍活動，並在八項主題活動中，有顯著之成就。由群長初審及推薦，認為在生活言行及服務態度確具童軍精神，經羅浮群會議及團長複審，參加自省守靜後，在授銜儀式中由團長（或羅浮顧問）頒發授銜羅浮章。",
    "服務羅浮": "成為授銜羅浮滿十二個月以上，曾參與籌畫並執行至少兩次由兩個以上的羅浮群共同籌辦或參與之活動。且積極參與各級羅浮組織之活動具有成效者。完成進程內容基本要求，並在下列主題活動中自選一項完成，經羅浮群會議及團長初審及薦，認為在生活言行、專業能力及服務態度確具童軍精神，獲羅浮暨青年委員會委任之單位複審通過後，由童軍總會於公開儀式頒發服務羅浮章。"
   }
  }
 }
};

// ════════════════ Db.js ════════════════
/**
 * 試算表存取層：一律批次讀寫（getValues/setValues），寫入由呼叫端包在 withLock_ 裡。
 * 同一次執行內的讀取結果會快取，寫入後自動失效。
 */

var DB_CACHE_ = {};

// 同一次執行只開一次試算表、每個分頁只找一次（openById 很慢，原本每讀一個分頁就開一次；SPEC 附錄第 58 點）
var SS_CACHE_ = null, SHEET_CACHE_ = {};
function ss_() {
  if (SS_CACHE_) return SS_CACHE_;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  SS_CACHE_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  SHEET_CACHE_ = {};
  return SS_CACHE_;
}

function sheet_(name) {
  var book = ss_();
  if (SHEET_CACHE_[name]) return SHEET_CACHE_[name];
  var sh = book.getSheetByName(name);
  if (sh) SHEET_CACHE_[name] = sh;
  if (!sh) throw new Error('找不到分頁：' + name + '（請先執行 setup）');
  return sh;
}

/**
 * 很少變動的分頁暫存在 CacheService（10 分鐘），省掉每次請求都讀試算表的時間（SPEC 附錄第 58 點）。
 * 經由程式寫入時 invalidate_ 會清掉；直接在試算表編輯時由 onEdit 清掉。這些分頁沒有日期欄，存成 JSON 不會變型。
 */
var SHEET_CACHE_SECONDS = 600;
function sheetCacheKey_(name) {
  return [SHEET.ITEMS, SHEET.UNITS, SHEET.DETAILS, SHEET.SETTINGS, SHEET.PERMS].indexOf(name) >= 0 ? 'SHEET_' + name : '';
}
function readAll_(name) {
  if (DB_CACHE_[name]) return DB_CACHE_[name];
  var key = sheetCacheKey_(name);
  if (key) {
    try { var hit = CacheService.getScriptCache().get(key); if (hit) { DB_CACHE_[name] = JSON.parse(hit); return DB_CACHE_[name]; } } catch (e) { /* 暫存壞了就讀試算表 */ }
  }
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var width = HEADERS[name].length;
  var rows = last > 0 ? sh.getRange(1, 1, last, width).getValues() : [];
  DB_CACHE_[name] = rows;
  if (key) {
    try { var text = JSON.stringify(rows); if (text.length < 95000) CacheService.getScriptCache().put(key, text, SHEET_CACHE_SECONDS); } catch (e2) { /* 太大就不暫存 */ }
  }
  return rows;
}

/** 清掉所有暫存（setup、直接編輯試算表時） */
function clearAllCaches_() {
  DB_CACHE_ = {};
  try {
    var c = CacheService.getScriptCache();
    [SHEET.ITEMS, SHEET.UNITS, SHEET.DETAILS, SHEET.SETTINGS, SHEET.PERMS].forEach(function (n) { c.remove('SHEET_' + n); });
    removeCatalogCache_();
  } catch (e) { /* 不影響主要操作 */ }
  clearPublicCache_();
}

/** 簡易觸發器：有人直接在試算表編輯時清掉暫存。只清暫存、不讀不寫資料，網頁訪客呼叫也無害 */
function onEdit(e) { clearAllCaches_(); }

/** 讀資料列（不含標題），每列附上試算表列號 _row */
function readRows_(name) {
  return readAll_(name).slice(1).map(function (r, i) { r = r.slice(); r._row = i + 2; return r; });
}

function invalidate_(name) {
  delete DB_CACHE_[name];
  var key = sheetCacheKey_(name);
  if (key) { try { CacheService.getScriptCache().remove(key); } catch (e) { /* 不影響寫入 */ } }
}

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
  // [修補] 寫入前先確保 TEXT_COLUMNS 為純文字格式，避免新擴充列把日期或全數字代碼自動轉型
  (TEXT_COLUMNS[name] || []).forEach(function (col) {
    if (col <= width) sh.getRange(start, col, data.length, 1).setNumberFormat('@');
  });
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

function validDateStr_(v) { var d = dateStr_(v); return Logic.isDateStr(d) ? d : ''; }

function loadCubs_() {
  return readRows_(SHEET.CUBS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      cubId: Logic.clean(r[0]), name: Logic.clean(r[1]), squad: Logic.clean(r[2]), joinDate: validDateStr_(r[3]),
      level: Logic.clean(r[4]), code: Logic.normalizeCode(r[5]), codeUsesLeft: Number(r[6]) || 0,
      status: Logic.clean(r[7]), leftDate: validDateStr_(r[8]), trialStart: validDateStr_(r[9]), role: Logic.clean(r[10]), section: Logic.sectionOf(r[11]), leaveReason: Logic.clean(r[12]), _row: r._row, _raw: r
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
    return { accountId: Logic.clean(r[0]), cubId: Logic.clean(r[1]), consentAt: ms_(r[3]), consentVersion: Number(r[4]) || 0, relation: Logic.clean(r[5]) || Logic.RELATION.PARENT, _row: r._row, _raw: r };
  });
}

/** 管理員分頁全部列（一人可有多列：每個分團一列，總團一列；SPEC 附錄第 68 點） */
function loadAdminRows_() {
  return readRows_(SHEET.ADMINS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      accountId: Logic.clean(r[0]), name: Logic.clean(r[1]), role: Logic.clean(r[2]), lineUserId: Logic.clean(r[5]),
      section: Logic.clean(r[2]) === Logic.CENTRAL ? '' : Logic.sectionOf(r[7]), title: Logic.clean(r[8]), _row: r._row, _raw: r
    };
  });
}

/**
 * 在某分團有權限的管理員（每人一筆；總團視為團長）。沒指定分團時用目前請求的分團（CUR_SEC_），再沒有就是小狼。
 * 管理員（admin 帳號）在每個分團都是團長，沒有該分團的列時也會列出來（scope＝管理員）。
 */
function loadAdmins_(section) {
  var sec = Logic.sectionOf(section || (typeof CUR_SEC_ !== 'undefined' && CUR_SEC_) || '');
  var rows = loadAdminRows_(), line = {};
  rows.forEach(function (r) { if (r.lineUserId) line[r.accountId] = r.lineUserId; });
  var list = Logic.effectiveAdmins(rows, sec);
  // 每一位最高管理員在每個分團都是團長（附錄第 79 點可以有多位）
  ownerIds_().forEach(function (ownerAcc) {
    if (list.some(function (a) { return a.accountId === ownerAcc; })) return;
    var orow = rows.filter(function (r) { return r.accountId === ownerAcc; })[0];
    if (orow) list.push(Object.assign({}, orow, { role: Logic.ROLE.LEADER, scope: '管理員', _synthetic: true }));
  });
  // LINE 通知是跟著人走的：同一人任何一列有連結都算
  return list.map(function (a) {
    return a.lineUserId || !line[a.accountId] ? a : Object.assign({}, a, { lineUserId: line[a.accountId] });
  });
}

function loadInvites_() {
  return readRows_(SHEET.INVITES).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      code: Logic.normalizeCode(r[0]), role: Logic.clean(r[1]), name: Logic.clean(r[2]), createdBy: Logic.clean(r[3]),
      expiresAt: ms_(r[5]), status: Logic.clean(r[6]),
      section: Logic.clean(r[1]) === Logic.CENTRAL ? '' : Logic.sectionOf(r[9]), title: Logic.clean(r[10]), _row: r._row, _raw: r
    };
  });
}

/** 註冊申請：類型 孩子/服務員；狀態 待審核/已核准/已退回（處理後清掉填寫姓名，只留連結的小狼ID） */
function loadRequests_() {
  return readRows_(SHEET.REQUESTS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      requestId: Logic.clean(r[0]), accountId: Logic.clean(r[1]), type: Logic.clean(r[2]), name: Logic.clean(r[3]), at: ms_(r[4]),
      status: Logic.clean(r[5]), cubId: Logic.clean(r[8]), consentVersion: Number(r[9]) || 0, note: Logic.clean(r[10]), section: Logic.requestSectionOf(r[11]), _row: r._row, _raw: r
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

/** 級別與章說明，全部分團（容錯：略過空白列與名稱空白列）；sec 是分團（空白＝小狼） */
function loadAllUnits_() {
  return readRows_(SHEET.UNITS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { name: Logic.clean(r[0]), category: Logic.clean(r[1]), group: Logic.clean(r[2]), desc: Logic.clean(r[3]), rule: Logic.clean(r[4]), order: Number(r[5]) || 9999, sec: Logic.progressSec(r[6]), _row: r._row };
  });
}

/**
 * 某分團的級別與章說明：{ '類別|名稱': {...} }。稚齡和小狼都有「種植」章，所以一律要指定分團（附錄第 77 點）。
 * @param section 分團；沒給時用目前分團（後台請求），再沒有就是小狼
 */
function loadUnits_(section) {
  var sec = Logic.progressSec(section || (typeof CUR_SEC_ !== 'undefined' && CUR_SEC_) || '');
  var map = {};
  loadAllUnits_().forEach(function (u) { if (u.sec === sec) map[u.category + '|' + u.name] = u; });
  return map;
}

/** 公開進程查詢的快取（每個有進程的分團一份） */
function removeCatalogCache_() {
  var c = CacheService.getScriptCache();
  Object.keys(Logic.PROGRESS_MODULES).forEach(function (sec) { c.remove('CATALOG2' + (sec === Logic.DEFAULT_SECTION ? '' : '_' + sec)); });
}

/** 分團欄要寫的值：小狼留空（和舊資料一樣），其他寫分團名稱 */
function secCell_(section) { var s = Logic.progressSec(section); return s === Logic.DEFAULT_SECTION ? '' : s; }

/** 某分團的項目（含停用）；item.sec 是分團 */
function sectionItems_(section) {
  var sec = Logic.progressSec(section);
  return loadItems_().items.filter(function (it) { return it.sec === sec; });
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
    return { cubId: Logic.clean(r[0]), unit: Logic.clean(r[1]), date: dateStr_(r[2]), occasion: Logic.clean(r[3]), note: Logic.clean(r[4]), signer: Logic.clean(r[5]), sec: Logic.progressSec(r[7]), _row: r._row };
  });
}

function loadMeetings_() {
  return readRows_(SHEET.MEETINGS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { meetingId: Logic.clean(r[0]), date: dateStr_(r[1]), name: Logic.clean(r[2]), note: Logic.clean(r[3]), enabled: Logic.clean(r[4]) !== '否', type: Logic.clean(r[7]) === '大活動' ? '大活動' : '一般', counts: Logic.clean(r[8]) !== '否', target: Logic.targetOf(r[9]), _row: r._row };
  });
}

function loadAttendance_() {
  return readRows_(SHEET.ATTENDANCE).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { meetingId: Logic.clean(r[0]), cubId: Logic.clean(r[1]), status: Logic.clean(r[2]), signer: Logic.clean(r[3]), _row: r._row };
  });
}

function loadPeriods_() {
  return readRows_(SHEET.PERIODS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { name: Logic.clean(r[0]), start: dateStr_(r[1]), end: dateStr_(r[2]), total: Number(r[3]) || 0, note: Logic.clean(r[4]), target: Logic.targetOf(r[5]), _row: r._row };
  });
}

/**
 * 某分團某天適用的年度出席設定（附錄第 73 點，團長 2026-11-19 決定）：
 * 先找該分團自己的；沒有就用管理員或總團做的「全團」預設。
 */
function sectionPeriod_(section, date) {
  var all = loadPeriods_(), sec = Logic.sectionOf(section);
  return Logic.periodOf(all.filter(function (p) { return p.target === sec; }), date) ||
    Logic.periodOf(all.filter(function (p) { return p.target === Logic.ALL; }), date);
}

function loadExtra_() {
  return readRows_(SHEET.EXTRA).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { period: Logic.clean(r[0]), cubId: Logic.clean(r[1]), count: Number(r[2]) || 0 };
  });
}

function loadConsents_() {
  return readRows_(SHEET.CONSENT).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { version: Number(r[0]) || 0, content: String(r[1]), effective: dateStr_(r[2]), audience: Logic.clean(r[3]) };
  });
}

/** 個資告知分兩份（附錄第 73 點⑲）：對象空白＝家長版（含童軍本人），「羅浮本人」＝成年人版；版本各自計算 */
function consentAudience_(v) { return Logic.clean(v) === Logic.ROVER_AUDIENCE ? Logic.ROVER_AUDIENCE : ''; }
function latestConsent_(audience) {
  var aud = consentAudience_(audience);
  var list = loadConsents_().filter(function (c) { return c.audience === aud; });
  var v = Logic.latestConsentVersion(list);
  return list.filter(function (c) { return c.version === v; })[0] || null;
}
function latestConsentVersionFor_(audience) { var c = latestConsent_(audience); return c ? c.version : 0; }

/** 本人綁定且屬於成年的分團（羅浮）＝成年本人：用成年人版告知、權限和家長一樣 */
function isAdultSelf_(binding, section) { return binding.relation === Logic.RELATION.SELF && Logic.ADULT_SELF_SECTIONS.indexOf(Logic.sectionOf(section)) >= 0; }
/** 未成年的本人帳號（童軍、行義本人）：權限另外限制 */
function isMinorSelf_(binding, section) { return binding.relation === Logic.RELATION.SELF && !isAdultSelf_(binding, section); }
function bindingAudience_(binding, section) { return isAdultSelf_(binding, section) ? Logic.ROVER_AUDIENCE : ''; }
function bindingNeedsConsent_(binding, section) { return Logic.needsReconsent(binding, latestConsentVersionFor_(bindingAudience_(binding, section))); }

function loadSettings_() { return Logic.parseSettings(readAll_(SHEET.SETTINGS)); }

/** 讀取動態權限設定；若試算表尚未建立「權限設定」分頁，自動退回內建預設值不報錯 */
function loadPermRules_() {
  var rows = ss_().getSheetByName(SHEET.PERMS) ? readAll_(SHEET.PERMS) : [];
  return Logic.parsePermRules(rows, loadSettings_().values);
}

/** 寫操作日誌（不得寫入密碼、臨時碼、登入憑證） */
function logOp_(actor, action, target, before, after) {
  appendRows_(SHEET.LOG, [[new Date(), actor || '', action, target || '', before || '', after || '']]);
}

/** 升團紀錄（附錄第 69、80 點） */
function loadPromotions_() {
  if (!ss_().getSheetByName(SHEET.PROMOTIONS)) return [];
  return readRows_(SHEET.PROMOTIONS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return { cubId: Logic.clean(r[0]), from: Logic.sectionOf(r[1]), to: Logic.sectionOf(r[2]), date: dateStr_(r[3]), joinDate: dateStr_(r[4]), squad: Logic.clean(r[5]), role: Logic.clean(r[6]) };
  });
}

/**
 * 紀錄跟著人走（附錄第 69 點）：這位團員在「其他分團」拿到的章與升團經過，新分團的團長與家長都看得到。
 * 白名單：分團、名稱、類別、頒發日期；升團的原分團、新分團、日期。
 */
function cubHistory_(cub) {
  var mine = Logic.progressSec(cub.section);
  var awards = loadAwards_().filter(function (a) { return a.cubId === cub.cubId && a.sec !== mine; }).map(function (a) {
    return { section: a.sec, unit: a.unit, category: Logic.isLevelOf(a.sec, a.unit) ? Logic.CATEGORY.PROGRESS : Logic.CATEGORY.BADGE, date: a.date };
  }).sort(function (a, b) { return Logic.SECTIONS.indexOf(a.section) - Logic.SECTIONS.indexOf(b.section) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); });
  var promotions = loadPromotions_().filter(function (p) { return p.cubId === cub.cubId; }).map(function (p) { return { from: p.from, to: p.to, date: p.date }; });
  return { awards: awards, promotions: promotions };
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
 * 以登入憑證查出帳號與「目前分團」的身分（SPEC 附錄第 73 點⑬）。
 * section：網頁送來的目前分團（_sec）；沒有權限或沒送就用預設（優先小狼）。前端送來的只是「想看哪個分團」，
 * 權限一律由後端依管理員分頁判斷。
 */
function requireAccount_(token, section) {
  var fail = new ApiError(ERR.SESSION_EXPIRED, '登入已過期，請重新登入。');
  if (!token || typeof token !== 'string' || token.length > 200) throw fail;
  var h = sha256Hex_(token);
  var ses = readRows_(SHEET.SESSIONS).filter(function (r) { return Logic.clean(r[0]) === h; })[0];
  if (!ses || !Logic.isSessionValid({ expiresAt: ms_(ses[3]) }, Date.now())) throw fail;
  var acc = findAccountById_(Logic.clean(ses[1]));
  if (!acc || acc.status !== '啟用') throw fail;
  var rows = loadAdminRows_().filter(function (a) { return a.accountId === acc.accountId; });
  var oids = ownerIds_();
  var isOwner = oids.length ? (oids.indexOf(acc.accountId) >= 0 && rows.length > 0) : (isReservedUsername_(acc.username) && rows.length > 0);
  var sections = Logic.staffSections(rows, isOwner);
  var pick = Logic.pickSection(sections, section);
  var admin = null;
  if (pick) {
    // 目前分團的身分：有該分團的列就用那一列（姓名、職稱、LINE），總團／管理員沒有就借第一列
    var base = Logic.effectiveAdmins(rows, pick.section)[0] || rows[0];
    var line = '';
    rows.forEach(function (r) { if (r.lineUserId && !line) line = r.lineUserId; });
    admin = Object.assign({}, base, { role: pick.role, scope: pick.scope, section: pick.section, lineUserId: base.lineUserId || line });
  }
  // staff：這個人在各分團的身分（給分團身分設定與「準備中」畫面用）
  var staff = rows.map(function (a) { return { section: a.section, role: a.role, title: a.title }; });
  return {
    account: acc, admin: admin, staff: staff, sections: sections, section: pick ? pick.section : null, isOwner: isOwner,
    isCentral: rows.some(function (a) { return a.role === Logic.CENTRAL; }), sessionHash: h
  };
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
  var checks = [Logic.validateUsername(username), Logic.validatePassword(password, settings['密碼最短長度'], username)];
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

/**
 * 網頁由 GAS 直接提供（SPEC 附錄第 56 點）：專案裡有 HTML 檔「Index」就回傳它，沒有就回原本的文字。
 * 注意：網頁一旦由 GAS 提供，訪客就能用 google.script.run 呼叫所有「名稱不是底線結尾」的函式，
 * 所以這類函式一律不回傳內容、不做危險動作（見 setup、dailyJob、weeklyBackup、menu*）。
 */
function doGet() {
  try {
    var page = HtmlService.createHtmlOutputFromFile('Index').getContent();
    // 把首頁要用的公開資料直接放進網頁（SPEC 附錄第 57 點）：開頁不用再向後端要四五次資料
    var boot = '';
    try { boot = '<script>window.__BOOT=' + JSON.stringify(bootData_()).replace(/</g, '\\u003c') + ';</script>'; } catch (e2) { console.error(e2); boot = ''; }
    var mark = '<script id="boot"></script>', at = page.indexOf(mark);
    if (boot && at >= 0) page = page.slice(0, at) + boot + page.slice(at + mark.length);
    return HtmlService.createHtmlOutput(page).setTitle('22團')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  } catch (e) {
    return ContentService.createTextOutput('OK：22團系統後端運作中。（還沒有加入 Index 網頁檔）');
  }
}

/** 網頁一打開就需要的公開資料；章的圖片太大時不內嵌，由網頁自己再取 */
function bootData_() {
  DB_CACHE_ = {};
  var images = apiUnitImages_().images;
  if (JSON.stringify(images).length > 300000) images = null;
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  return { catalog: apiCatalog_(), notices: apiNotices_().notices, site: apiSiteInfo_(), images: images, webUrl: url, publicTabs: Logic.resolvePermissions(loadPermRules_(), { loggedIn: false }).tabs };
}

/** 公開資料快取（5 分鐘）：公佈欄、月曆與活動。後台任何動作之後由 clearPublicCache_ 清掉 */
var PUBLIC_CACHE_KEYS = ['PUB_NOTICES', 'PUB_SITE'];
function cachedPublic_(key, build) {
  var cache = CacheService.getScriptCache();
  try { var hit = cache.get(key); if (hit) return JSON.parse(hit); } catch (e) { /* 快取壞了就重算 */ }
  var out = build();
  try { cache.put(key, JSON.stringify(out), 300); } catch (e2) { /* 太大就不快取 */ }
  return out;
}
function clearPublicCache_() {
  try { var c = CacheService.getScriptCache(); PUBLIC_CACHE_KEYS.forEach(function (k) { c.remove(k); }); } catch (e) { /* 不影響主要操作 */ }
}

/** 處理一個 API 請求（JSON 字串）→ 回傳結果物件；doPost 與 apiFromPage 共用 */
function handleApiBody_(text) {
  try {
    var req = JSON.parse(text || '{}');
    if (!req || typeof req !== 'object' || Array.isArray(req)) throw new ApiError(ERR.BAD_INPUT, '請求格式不正確。');
    return dispatch_(req);
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof SyntaxError) return { ok: false, code: ERR.BAD_INPUT, message: '請求格式不正確。' };
    console.error(err && err.stack ? err.stack : err); // 只寫進 GAS 執行紀錄，不回給前端
    return { ok: false, code: ERR.SERVER_ERROR, message: '系統暫時無法處理，請稍後再試。' };
  }
}

/** 由 GAS 提供的網頁用 google.script.run 呼叫；和 doPost 完全同一套登入與權限檢查 */
function apiFromPage(body) {
  return JSON.stringify(handleApiBody_(typeof body === 'string' ? body : ''));
}

function doPost(e) {
  var params = (e && e.parameter) || {};
  // 網址帶 key 參數 → LINE webhook
  if (params.key !== undefined) {
    try { handleWebhook_(e); } catch (err) { console.error(err); }
    return ContentService.createTextOutput('OK');
  }
  // 鎖在 GAS（SPEC 附錄第 57 點）：設定「允許外部網頁連線」為否時，外部網頁（含 GitHub 版）一律不能用
  var out;
  var open = true;
  try { DB_CACHE_ = {}; open = loadSettings_().values['允許外部網頁連線'] !== false; } catch (e0) { open = true; }
  if (open) out = handleApiBody_((e && e.postData && e.postData.contents) || '{}');
  else {
    // [修補] 優先回傳 GAS Web App 網址，避免又指向被停用的外部 GitHub Pages 網址
    var gasUrl = '';
    try { gasUrl = ScriptApp.getService().getUrl() || ''; } catch (e1) { gasUrl = ''; }
    out = { ok: false, code: ERR.MOVED, message: '這個網址已經停用，請改用新的網站網址：' + (gasUrl || webUrl_()) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 不需登入的動作 */
var PUBLIC_ACTIONS = {
  ping: function () { var url = ''; try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; } return { serverTime: new Date().toISOString(), webUrl: url, version: APP_VERSION }; },
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
  startup: apiStartup_,
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
  CUR_SEC_ = null;
  var a = String(req.action || '');
  var fn;
  if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, a)) fn = PUBLIC_ACTIONS[a];
  else if (Object.prototype.hasOwnProperty.call(AUTHED_ACTIONS, a)) {
    var who = requireAccount_(req.token, req._sec);
    return Object.assign({ ok: true }, AUTHED_ACTIONS[a](req, who));
  } else throw new ApiError(ERR.BAD_INPUT, '不支援的操作。');
  return Object.assign({ ok: true }, fn(req));
}

// ───────────── 告知同意 ─────────────

/**
 * 公開標準查詢（不用登入，SPEC 附錄第 21 點）：只回傳啟用中的進程與技能章項目、說明與晉級條件。
 * 不含任何小狼、家長或管理員的資料。結果快取 5 分鐘以加快速度。
 */
function apiCatalog_(req) {
  // 分團（附錄第 77 點）：沒帶或不是有進程的分團時是小狼（舊網址 #progress、#badges）
  // 行義和童軍共用一套（附錄第 80 點）：回傳童軍的資料
  var sec = Logic.progressSec(req && req.section);
  if (!Logic.progressModule(sec)) return { units: [], section: sec, levels: [] };
  var cache = CacheService.getScriptCache(), ckey = 'CATALOG2' + (sec === Logic.DEFAULT_SECTION ? '' : '_' + sec);
  var hit = cache.get(ckey);
  if (hit) return JSON.parse(hit);
  var unitsInfo = loadUnits_(sec);
  var byItem = loadDetails_().byItem;
  var groups = {}, order = [];
  loadItems_().items.forEach(function (it) {
    if (!it.enabled || it.sec !== sec) return;
    var k = it.category + '|' + it.unit;
    if (!groups[k]) {
      var info = unitsInfo[k] || {};
      groups[k] = { category: it.category, unit: it.unit, group: info.group || '', desc: info.desc || '', rule: info.rule || '', order: info.order || 9999, items: [] };
      order.push(k);
    }
    groups[k].items.push({ section: it.section, text: it.text, details: detailsView_(byItem, it.id) });
  });
  var out = { units: order.map(function (k) { return groups[k]; }).sort(function (a, b) { return a.order - b.order; }), section: sec, levels: Logic.levelsOf(sec), badgeGroups: Logic.progressModule(sec).badgeGroups, badgeLabel: Logic.progressModule(sec).badgeLabel || '技能章' };
  try { cache.put(ckey, JSON.stringify(out), 300); } catch (e) { /* 超過快取大小時不快取 */ }
  return out;
}

function apiConsentText_(req) {
  var c = latestConsent_(req && req.audience);
  if (!c) throw new ApiError(ERR.SERVER_ERROR, '尚未設定個資告知內容，請聯絡團長。');
  return { version: c.version, content: c.content, effective: c.effective, audience: c.audience };
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
function bindCub_(accountId, cub, consentVersion, relation, skipCodeDecrement) {
  var now = new Date();
  var rel = relation === Logic.RELATION.SELF ? Logic.RELATION.SELF : Logic.RELATION.PARENT;
  var allMine = loadBindings_().filter(function (b) { return b.accountId === accountId; });
  if (allMine.some(function (b) { return b.relation === Logic.RELATION.SELF && b.cubId !== cub.cubId; })) {
    throw new ApiError(ERR.BAD_INPUT, '童軍本人帳號僅限綁定自己的資料，不能綁定其他團員。');
  }
  var existing = allMine.filter(function (b) { return b.cubId === cub.cubId; })[0];
  if (existing) {
    var row = existing._raw.slice(0, HEADERS[SHEET.BINDINGS].length);
    row[3] = now; row[4] = consentVersion;
    if (relation) row[5] = rel;
    updateRows_(SHEET.BINDINGS, [{ row: existing._row, values: row }]);
    return false;
  }
  appendRows_(SHEET.BINDINGS, [[accountId, cub.cubId, now, now, consentVersion, rel]]);
  if (!skipCodeDecrement) {
    var cubRow = cub._raw.slice(0, HEADERS[SHEET.CUBS].length);
    cubRow[6] = Math.max(0, cub.codeUsesLeft - 1);
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: cubRow }]);
  }
  return true;
}

/** 使用邀請碼成為管理員；邀請碼沒有填姓名時，用帳號的稱呼當作管理員姓名 */
function redeemInvite_(accountId, invite, nickname) {
  var now = new Date();
  // 邀請碼已指定分團、身分、職稱（SPEC 附錄第 68 點）；同一人在同一分團已有身分就不重複加
  var key = function (r) { return r.role === Logic.CENTRAL ? Logic.CENTRAL : Logic.sectionOf(r.section); };
  if (!loadAdminRows_().some(function (a) { return a.accountId === accountId && key(a) === key(invite); })) {
    appendRows_(SHEET.ADMINS, [[accountId, invite.name || Logic.clean(nickname).slice(0, 30) || invite.role, invite.role, now, invite.createdBy || '邀請碼', '', '', invite.section, invite.title]]);
  }
  var row = invite._raw.slice(0, HEADERS[SHEET.INVITES].length);
  row[6] = '已使用'; row[7] = accountId; row[8] = now;
  updateRows_(SHEET.INVITES, [{ row: invite._row, values: row }]);
}

function requireConsentVersion_(agreedVersion, audience) {
  var c = latestConsent_(audience);
  if (!c) throw new ApiError(ERR.SERVER_ERROR, '尚未設定個資告知內容，請聯絡團長。');
  if (Number(agreedVersion) !== c.version) throw new ApiError(ERR.NEED_CONSENT, '請先閱讀並勾選同意個資告知內容。');
  return c.version;
}

// ───────────── 註冊、登入、密碼 ─────────────

/** 保留的帳號名稱（團長預設帳號）：不開放註冊，訊息與「已有人使用」相同 */
function isReservedUsername_(username) { return Logic.clean(username).toLowerCase() === DEFAULT_ADMIN_USERNAME; }

function apiRegister_(req) {
  // 沒有代碼：新的註冊方式（送出申請，團長審核）；有代碼：舊方式（第一位團長邀請碼、既有綁定碼仍可用）
  if (!Logic.clean(req.code)) return registerByRequest_(req);
  return withLock_(function () {
    var settings = loadSettings_().values;
    var r = verifyCode_(req.code, req.childName, null, settings);
    checkAccountInput_(req.username, req.password, req.nickname, settings);
    // 家長：沒有同意就不建立任何資料
    var version = r.kind === 'parent' ? requireConsentVersion_(req.consentVersion) : null;
    if (isReservedUsername_(req.username) || findAccountByName_(req.username)) throw new ApiError(ERR.NAME_TAKEN, '這個帳號名稱已經有人使用，請換一個。');

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
  var name = Logic.clean(req.username).toLowerCase().slice(0, 40);
  var pw = String(req.password || '');
  // [修補] 帳號或密碼空白直接回傳錯誤，避免浪費 2000 次 HMAC 運算與寫入空目標失敗紀錄
  if (!name || !pw) throw new ApiError(ERR.BAD_LOGIN, '帳號或密碼錯誤。');
  return withLock_(function () {
    var settings = loadSettings_().values;
    assertNotLocked_('登入', name, settings);
    var acc = findAccountByName_(name);
    // 帳號不存在也照樣做一次雜湊，讓回應時間一致
    var ok = Logic.verifyPassword(pw, acc ? acc.salt : 'x', acc ? acc.passwordHash : HASH_ITERATIONS + '$x', hmacHex_);
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
  var name = Logic.clean(req.username).toLowerCase().slice(0, 40);
  var code = Logic.normalizeCode(req.tempCode);
  if (!name || !code) throw new ApiError(ERR.BAD_LOGIN, '帳號或臨時碼錯誤，或臨時碼已過期。請聯絡團長重新產生。');
  return withLock_(function () {
    var settings = loadSettings_().values;
    assertNotLocked_('登入', name, settings);
    var acc = findAccountByName_(name);
    // [修補] 使用常數時間比對臨時碼雜湊
    if (!acc || !Logic.isTempCodeValid(acc, Date.now()) || !Logic.constantTimeEqual(sha256Hex_(code), acc.tempCodeHash) || acc.status !== '啟用') {
      recordFailure_('登入', name);
      throw new ApiError(ERR.BAD_LOGIN, '帳號或臨時碼錯誤，或臨時碼已過期。請聯絡團長重新產生。');
    }
    var pw = Logic.validatePassword(req.newPassword, settings['密碼最短長度'], acc.username);
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
    // 舊密碼錯誤和登入共用失敗紀錄與鎖定（附錄第 78 點）
    assertNotLocked_('登入', acc.username.toLowerCase(), settings);
    if (!Logic.verifyPassword(String(req.oldPassword || ''), acc.salt, acc.passwordHash, hmacHex_)) {
      recordFailure_('登入', acc.username.toLowerCase());
      throw new ApiError(ERR.BAD_INPUT, '目前的密碼不正確。');
    }
    var pw = Logic.validatePassword(req.newPassword, settings['密碼最短長度'], acc.username);
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

/**
 * 童軍本人帳號（只有「本人」綁定、不是管理員）不能解除自己的綁定或申請新增孩子；
 * 綁定別人已由 bindCub_ 擋下（附錄第 76、78 點）。
 */
function isScoutSelfAccount_(who) {
  if (who.admin) return false;
  var mine = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
  var secOf = {};
  loadCubs_().forEach(function (c) { secOf[c.cubId] = c.section; });
  return mine.length > 0 && mine.every(function (b) { return isMinorSelf_(b, secOf[b.cubId]); });
}
function assertNotScoutSelf_(who) {
  if (isScoutSelfAccount_(who)) throw new ApiError(ERR.FORBIDDEN, '童軍本人帳號不能做這個操作，請家長處理。');
}

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
    var now = new Date(), secOf = {};
    loadCubs_().forEach(function (c) { secOf[c.cubId] = c.section; });
    var mine = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
    // 帳號只有成年本人綁定時同意的是成年人版，否則是家長版；只更新同一份的綁定
    var aud = mine.length && mine.every(function (b) { return isAdultSelf_(b, secOf[b.cubId]); }) ? Logic.ROVER_AUDIENCE : '';
    var version = requireConsentVersion_(req.consentVersion, aud);
    var ups = mine.filter(function (b) { return bindingAudience_(b, secOf[b.cubId]) === aud; }).map(function (b) {
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
  assertNotScoutSelf_(who);
  return withLock_(function () {
    var rows = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === Logic.clean(req.cubId); });
    if (!rows.length) throw new ApiError(ERR.NOT_FOUND, '找不到這筆綁定。');
    deleteRows_(SHEET.BINDINGS, rows.map(function (b) { return b._row; }));
    logOp_(who.account.accountId, '家長解除綁定', Logic.clean(req.cubId), '', '');
    return {};
  });
}

// ───────────── 查詢 ─────────────

/**
 * 新的註冊方式（SPEC 附錄第 31 點）：選身分（家長／服務員）、填孩子姓名 → 建立帳號並送出申請，
 * 團長在後台核准後才綁定孩子或成為服務員。帳號可以先登入，看到「等待審核」。
 */
function registerByRequest_(req) {
  return withLock_(function () {
    var settings = loadSettings_().values;
    var identity = Logic.clean(req.identity);
    if (identity === Logic.IDENTITY.ROVER_SELF) return registerRoverSelf_(req, settings);
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
    if (isReservedUsername_(req.username) || findAccountByName_(req.username)) throw new ApiError(ERR.NAME_TAKEN, '這個帳號名稱已經有人使用，請換一個。');

    var accountId = newId_('U', loadAccounts_().map(function (a) { return a.accountId; }));
    var salt = randomHex_(32);
    var hash = Logic.hashPassword(String(req.password), salt, HASH_ITERATIONS, hmacHex_);
    var now = new Date();
    appendRows_(SHEET.ACCOUNTS, [[accountId, Logic.clean(req.username), Logic.clean(req.nickname), hash, salt, '啟用', now, now, '', '']]);
    var rows = requestRows_(accountId, v.names, version, requests, now, childSections_(req));
    if (identity === Logic.IDENTITY.STAFF) rows.push(requestRow_(accountId, '服務員', Logic.clean(req.nickname), 0, requests.concat(rowsToIds_(rows)), now, requestSection_(req.staffSection)));
    appendRows_(SHEET.REQUESTS, rows);
    logOp_(accountId, '註冊申請', Logic.clean(req.username), '', identity + (v.names.length ? '，孩子 ' + v.names.length + ' 位' : ''));
    var s = createSession_(accountId, !!req.remember, settings);
    return { token: s.token, expiresAt: s.expiresAt };
  });
}

/**
 * 羅浮本人自己註冊（附錄第 73 點⑱）：不需要家長；同意成年人版個資告知，送出「本人」申請到羅浮，群長核准後綁定為本人。
 * 在 registerByRequest_ 的鎖裡面呼叫。
 */
function registerRoverSelf_(req, settings) {
  var v = Logic.validateChildNames([req.selfName], true);
  if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error.replace('孩子', '你'));
  checkAccountInput_(req.username, req.password, req.nickname || v.names[0], settings);
  var version = requireConsentVersion_(req.consentVersion, Logic.ROVER_AUDIENCE);
  var requests = loadRequests_();
  if (Logic.recentRequestAccounts(requests, Date.now()) >= settings['每日註冊申請上限']) {
    throw new ApiError(ERR.LOCKED, '目前註冊的人太多，暫停註冊，請稍後再試，或聯絡團長。');
  }
  if (isReservedUsername_(req.username) || findAccountByName_(req.username)) throw new ApiError(ERR.NAME_TAKEN, '這個帳號名稱已經有人使用，請換一個。');
  var accountId = newId_('U', loadAccounts_().map(function (a) { return a.accountId; }));
  var salt = randomHex_(32), now = new Date();
  var hash = Logic.hashPassword(String(req.password), salt, HASH_ITERATIONS, hmacHex_);
  appendRows_(SHEET.ACCOUNTS, [[accountId, Logic.clean(req.username), Logic.clean(req.nickname) || v.names[0], hash, salt, '啟用', now, now, '', '']]);
  appendRows_(SHEET.REQUESTS, [requestRow_(accountId, '本人', v.names[0], version, requests, now, '羅浮')]);
  logOp_(accountId, '註冊申請', Logic.clean(req.username), '', '羅浮本人');
  var s = createSession_(accountId, !!req.remember, settings);
  return { token: s.token, expiresAt: s.expiresAt };
}

/** 已登入的家長再申請新增孩子（例如第二個孩子） */
function apiRequestChildren_(req, who) {
  assertNotScoutSelf_(who);
  return withLock_(function () {
    var v = Logic.validateChildNames(req.childNames, true);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    var version = requireConsentVersion_(req.consentVersion);
    var requests = loadRequests_();
    var pendingMine = requests.filter(function (r) { return r.accountId === who.account.accountId && r.status === '待審核'; });
    if (pendingMine.length + v.names.length > 10) throw new ApiError(ERR.BAD_INPUT, '待審核的申請太多了，請等團長審核後再送。');
    var dup = v.names.filter(function (n) { return pendingMine.some(function (r) { return r.type === '孩子' && r.name === n; }); });
    if (dup.length) throw new ApiError(ERR.BAD_INPUT, '「' + dup.join('、') + '」已經在等待審核了。');
    appendRows_(SHEET.REQUESTS, requestRows_(who.account.accountId, v.names, version, requests, new Date(), childSections_(req)));
    logOp_(who.account.accountId, '申請新增孩子', who.account.username, '', v.names.length + ' 位');
    return { added: v.names.length };
  });
}

function requestRow_(accountId, type, name, version, existing, now, section) {
  var id = newId_('R', existing.map(function (r) { return r.requestId; }));
  return [id, accountId, type, name, now, '待審核', '', '', '', version || '', '', section || ''];
}
function rowsToIds_(rows) { return rows.map(function (r) { return { requestId: r[0] }; }); }
/**
 * 申請時選的分團（SPEC 附錄第 73 點，團長 2026-11-19 決定）：選了分團就記分團；選「不確定」記「未指定」，
 * 由管理員、總團或各分團團長指定。沒送這個欄位（舊版網頁）時留空＝小狼。
 */
function requestSection_(v) {
  if (v === undefined || v === null) return '';
  var x = Logic.clean(v);
  return Logic.isSection(x) ? x : Logic.UNASSIGNED;
}
/** 孩子姓名 → 分團（childSections 與 childNames 一一對應） */
function childSections_(req) {
  var out = {}, names = Array.isArray(req.childNames) ? req.childNames : [], secs = req.childSections;
  if (!Array.isArray(secs)) return out;
  names.forEach(function (n, i) { var k = Logic.clean(n).replace(/\s+/g, ''); if (k && out[k] === undefined) out[k] = requestSection_(secs[i]); });
  return out;
}
function requestRows_(accountId, names, version, existing, now, sections) {
  var rows = [];
  names.forEach(function (n) { rows.push(requestRow_(accountId, '孩子', n, version, existing.concat(rowsToIds_(rows)), now, (sections || {})[n] || '')); });
  return rows;
}

/**
 * 登入後的第一趟（SPEC 附錄第 58 點）：一次回傳 me 與第一個畫面要用的資料，少等一趟後端。
 * 管理員：後台首頁＋行事曆；家長：第一個孩子的進度。附帶資料取不到就略過，網頁會自己再要。
 */
function apiStartup_(req, who) {
  var me = apiMe_(req, who), pre = {};
  // 每一份預載各自處理錯誤：某一頁沒有權限（例如點名被關掉）時，其他已經拿到的照樣給（附錄第 78 點）
  var tryPut = function (key, fn) { try { pre[key] = Object.assign({ ok: true }, fn()); } catch (e) { /* 沒拿到就由網頁自己再讀 */ } };
  if (who.admin) {
    tryPut('adminHome', function () { return AUTHED_ACTIONS.adminHome({}, who); });
    tryPut('meetingList', function () { return AUTHED_ACTIONS.meetingList({}, who); });
  } else if (me.cubs && me.cubs.length && !me.needsConsent) {
    tryPut('cubDetail', function () { return apiCubDetail_({ cubId: me.cubs[0].cubId }, who); });
  }
  return { me: me, prefetch: pre };
}

function apiMe_(req, who) {
  var cubs = loadCubs_();
  var mine = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
  var list = [];
  mine.forEach(function (b) {
    var c = cubs.filter(function (x) { return x.cubId === b.cubId; })[0];
    if (!c) return;
    list.push({ cubId: c.cubId, name: c.name, section: c.section, relation: b.relation || Logic.RELATION.PARENT, consentVersion: b.consentVersion, consentAt: b.consentAt ? new Date(b.consentAt).toISOString() : '' });
  });
  // 成年的羅浮本人和家長一樣（附錄第 80 點）；未成年的本人帳號另外限制
  var hasParentBinding = list.some(function (x) { return !isMinorSelf_(x, x.section); });
  var myAudience = list.length && list.every(function (x) { return isAdultSelf_(x, x.section); }) ? Logic.ROVER_AUDIENCE : '';
  var isScoutSelf = !who.admin && list.length > 0 && !hasParentBinding;
  var mySec = who.section || (list[0] ? list[0].section : '');
  var permView = resolveWhoPerms_(who, hasParentBinding, isScoutSelf, mySec);
  var allowedSections = (who.isOwner || who.isCentral)
    ? Logic.SECTIONS.slice()
    : (who.admin ? (who.sections || []).map(function (x) { return x.section; })
      : list.map(function (x) { return x.section; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }));
  var accountType = who.isOwner ? 'owner' : (who.isCentral ? 'central' : (who.admin ? (who.admin.role === Logic.ROLE.LEADER ? 'leader' : 'assistant') : (isScoutSelf ? 'scout_self' : (hasParentBinding ? 'parent' : 'guest'))));
  return {
    username: who.account.username,
    nickname: who.account.nickname,
    role: who.admin ? who.admin.role : null,
    isOwner: !!who.isOwner,
    ownerExists: who.admin ? !!ownerId_() : undefined,
    isScoutSelf: isScoutSelf,
    accountType: accountType,
    allowedSections: allowedSections,
    adminName: who.admin ? who.admin.name : null,
    lineLinked: !!(who.admin && who.admin.lineUserId),
    mySquads: who.admin ? squadsOfStaff_(who.account.accountId, who.section) : [],
    // 目前分團與可以切換的分團（附錄第 73 點⑬）；網頁之後每個請求都帶 _sec
    section: who.section || null,
    sections: (who.sections || []).map(function (x) { return { section: x.section, role: x.role }; }),
    title: who.admin ? (who.admin.title || '') : '',
    canManageAll: who.admin ? canManageAll_(who) : false,
    shared: who.admin ? Logic.SHARED_FUNCS.filter(function (f) { return canShared_(who, f); }) : [],
    // [新增] 依動態權限設定算出本帳號可顯示的分頁與可用動作，前端可直接用來切換分頁與內容
    tabs: permView.tabs,
    visibleTabs: permView.visibleTabs,
    permissions: permView.actions,
    // 各分團身分（SPEC 附錄第 68 點）：staff 給「分團功能準備中」畫面；canManageStaff 決定後台是否顯示「分團身分」頁
    staff: who.staff || [],
    isCentral: !!who.isCentral,
    canManageStaff: !!who.isCentral || !!who.isOwner,
    serverVersion: APP_VERSION, // 網頁用來檢查後端是否已部署新版本（附錄第 72 點）
    cubs: list,
    // 自己的申請：待審核的全部、已退回的最近 5 筆（已退回的姓名已清除，只留類型與團長備註）
    requests: (function () {
      var mineReq = loadRequests_().filter(function (r) { return r.accountId === who.account.accountId; });
      var pend = mineReq.filter(function (r) { return r.status === '待審核'; });
      var rej = mineReq.filter(function (r) { return r.status === '已退回'; }).sort(function (a, b) { return b.at - a.at; }).slice(0, 5);
      return pend.concat(rej).map(function (r) { return { type: r.type, name: r.name, status: r.status, at: r.at ? new Date(r.at).toISOString() : '', note: r.note }; });
    })(),
    latestConsentVersion: latestConsentVersionFor_(myAudience),
    needsConsent: mine.some(function (b) { var c = cubs.filter(function (x) { return x.cubId === b.cubId; })[0]; return bindingNeedsConsent_(b, c ? c.section : ''); }),
    // 帳號只有成年本人綁定時看成年人版告知（附錄第 73 點⑲）
    consentAudience: myAudience
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
  var cub = loadCubs_().filter(function (c) { return c.cubId === cubId; })[0];
  if (!cub) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼的資料。');
  if (bindingNeedsConsent_(binding, cub.section)) {
    throw new ApiError(ERR.NEED_CONSENT, '個資告知內容已更新，請先閱讀並同意。');
  }
  var isSelf = isMinorSelf_(binding, cub.section);
  var pv = resolveWhoPerms_(who, !isSelf, isSelf, cub.section);
  var view = buildCubView_(cub, today_());
  view.relation = binding.relation || Logic.RELATION.PARENT;
  if (!pv.tabs.member_progress) { view.hasProgress = false; view.units = []; view.nextChallenge = null; view.progressDisabledByPerm = true; }
  if (!pv.tabs.member_attendance) { view.attendanceDisabledByPerm = true; view.attendance = { meetings: [], upcoming: [], counts: { attended: 0, late: 0, leave: 0 }, rate: null }; }
  return view;
}

/** 組出家長畫面要的資料（也供後台列印簽核單共用） */
function buildCubView_(cub, today) {
  var settings = loadSettings_().values;
  var items = loadItems_().items;
  var units = loadUnits_(cub.section);
  var byItem = loadDetails_().byItem;
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && Logic.isDateStr(m.date); });
  var mById = {};
  // 出席紀錄（含進程計算）算所有集會；家長看到的集會清單只列孩子分團與全團的
  var shown = meetings.filter(function (m) { return Logic.targetIncludes(m.target, cub.section); });
  meetings.forEach(function (m) { mById[m.meetingId] = m; });
  var att = loadAttendance_().filter(function (a) { return a.cubId === cub.cubId && mById[a.meetingId]; });
  var attRecords = att.map(function (a) { return { date: mById[a.meetingId].date, status: a.status, meetingId: a.meetingId, type: mById[a.meetingId].type, counts: mById[a.meetingId].counts }; });

  // 有進程模組的分團（小狼、稚齡）依各自的規則計算；其他分團的孩子只顯示出席，進程畫面寫「準備中」（附錄第 73 點）
  var hasProgress = Logic.PROGRESS_SECTIONS.indexOf(cub.section) >= 0;
  // 家長畫面不帶完成期限（附錄第 77 點：期限只在後台提醒）
  var params = hasProgress ? Logic.progressParams(settings, cub.section) : null;
  if (params) delete params.deadlines;
  var progress = !hasProgress ? { units: [], currentLevel: '' } : Logic.computeCubProgress(Object.assign(params, {
    cubId: cub.cubId, items: items, completions: loadCompletions_(), awards: loadAwards_(),
    today: today, attendance: attRecords,
    newbieAfter: cub.trialStart && cub.joinDate ? cub.joinDate : null
  }));

  // [修補] 簽核人帳號ID → 管理員姓名：改用全分團 adminNames_()，避免總團或他分團服務員簽核時顯示空白
  var names = adminNames_();

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
  var since = cub.trialStart && (!cub.joinDate || cub.trialStart < cub.joinDate) ? cub.trialStart : cub.joinDate;
  var inTeam = shown.filter(function (m) { return since && m.date >= since && (!cub.leftDate || m.date <= cub.leftDate) && (m.type === '一般' || (cub.joinDate && m.date >= cub.joinDate)); });
  var past = inTeam.filter(function (m) { return m.date <= today; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  // 今天（含）以後的集會：家長可以先請假
  var upcoming = inTeam.filter(function (m) { return m.date >= today && !Logic.isPresent(statusOf[m.meetingId]); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 12);
  var period = sectionPeriod_(cub.section, today);
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
      tenure: Logic.tenure(cub.joinDate, today).text, currentLevel: progress.currentLevel || '', status: cub.status === Logic.TRIAL ? Logic.TRIAL : '', trialStart: cub.trialStart,
      role: cub.role, squadStaff: squadStaffNames_(cub.squad, cub.section), section: cub.section
    },
    hasProgress: hasProgress, levels: Logic.levelsOf(cub.section), history: cubHistory_(cub),
    trial: cub.status === Logic.TRIAL ? Logic.trialProgress(attRecords, Logic.sectionSetting(settings, '體驗所需出席次數', cub.section)) : null,
    nextChallenge: (function (n) {
      // 白名單：不帶簽核人帳號ID 等內部欄位
      return { type: n.type, message: n.message, level: n.level || '', items: n.items.map(function (i) { return { section: i.section, text: i.text }; }) };
    })(hasProgress ? Logic.nextChallenge(progress) : { type: 'none', message: '', items: [] }),
    units: unitViews,
    attendance: {
      meetings: past.map(function (m) { return { date: m.date, name: m.name, status: statusOf[m.meetingId] || '－' }; }),
      upcoming: upcoming.map(function (m) { return { meetingId: m.meetingId, date: m.date, name: m.name, type: m.type, note: m.note, leave: statusOf[m.meetingId] === '請假' }; }),
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
    .addItem('🔑 團長預設帳號（admin）', 'menuDefaultAdmin')
    .addItem('把帳號設為團長', 'menuSetLeader')
    .addSeparator()
    .addItem('👑 新增最高管理員', 'menuAddOwner')
    .addItem('👑 卸下最高管理員', 'menuRemoveOwner')
    .addSeparator()
    .addItem('📱 安裝 LINE 圖文選單', 'menuInstallRichMenu')
    .addSeparator()
    .addItem('顯示全部分頁（查紀錄用）', 'menuShowAllSheets')
    .addItem('只顯示需要編輯的分頁', 'menuHideSystemSheets')
    .addToUi();
}

/** 團長預設帳號的帳號名稱（SPEC 附錄第 39 點） */
var DEFAULT_ADMIN_USERNAME = 'admin';

/**
 * 團長預設帳號：沒有 admin 帳號就建立（團長、最高權限），已經有就重設密碼並確保是團長。
 * 密碼每次隨機產生、只顯示在這個視窗，不寫進程式、日誌或試算表（試算表只存雜湊）。
 */
function menuDefaultAdmin() {
  var ui = SpreadsheetApp.getUi();
  var r = ensureDefaultAdmin_();
  ui.alert('團長預設帳號', '網址：' + webUrl_() +
    '\n帳號：' + r.username + '\n密碼：' + r.password + '\n\n' + (r.created ? '已建立團長帳號。' : '已重設這個帳號的密碼（其他裝置已登出）。') +
    '\n請抄下密碼，登入後到「我的 → 修改密碼」改成自己的密碼。這個視窗關掉後就看不到密碼了。', ui.ButtonSet.OK);
}

function ensureDefaultAdmin_() {
  return withLock_(function () {
    var password = Logic.generateCode(10, randInt_, []).toLowerCase();
    var salt = randomHex_(32);
    var hash = Logic.hashPassword(password, salt, HASH_ITERATIONS, hmacHex_);
    var acc = findAccountByName_(DEFAULT_ADMIN_USERNAME);
    var created = false, now = new Date();
    if (!acc) {
      var id = newId_('U', loadAccounts_().map(function (a) { return a.accountId; }));
      appendRows_(SHEET.ACCOUNTS, [[id, DEFAULT_ADMIN_USERNAME, '團長', hash, salt, '啟用', now, '', '', '']]);
      acc = findAccountByName_(DEFAULT_ADMIN_USERNAME);
      created = true;
    } else {
      var row = acc._raw.slice(0, HEADERS[SHEET.ACCOUNTS].length);
      row[3] = hash; row[4] = salt; row[5] = '啟用'; row[8] = ''; row[9] = '';
      updateRows_(SHEET.ACCOUNTS, [{ row: acc._row, values: row }]);
      purgeSessions_(acc.accountId);
    }
    var admins = loadAdmins_(Logic.DEFAULT_SECTION);
    var cur = admins.filter(function (a) { return a.accountId === acc.accountId; })[0];
    if (!cur) appendRows_(SHEET.ADMINS, [[acc.accountId, '團長', Logic.ROLE.LEADER, now, '試算表選單', '', '', Logic.DEFAULT_SECTION, '']]);
    else if (cur.role !== Logic.ROLE.LEADER) {
      var ar = cur._raw.slice(0, HEADERS[SHEET.ADMINS].length); ar[2] = Logic.ROLE.LEADER;
      updateRows_(SHEET.ADMINS, [{ row: cur._row, values: ar }]);
    }
    // 解除登入鎖定：有人故意輸錯密碼也不會把團長鎖在外面
    var fails = readRows_(SHEET.FAILURES).filter(function (r) { return Logic.clean(r[0]) === '登入' && Logic.clean(r[1]).toLowerCase() === DEFAULT_ADMIN_USERNAME; });
    if (fails.length) deleteRows_(SHEET.FAILURES, fails.map(function (r) { return r._row; }));
    logOp_('試算表選單', created ? '建立團長預設帳號' : '重設團長預設帳號密碼', DEFAULT_ADMIN_USERNAME, '', '團長');
    return { username: DEFAULT_ADMIN_USERNAME, password: password, created: created };
  });
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
    var admins = loadAdmins_(Logic.DEFAULT_SECTION);
    var cur = admins.filter(function (a) { return a.accountId === acc.accountId; })[0];
    if (cur && cur.role === Logic.ROLE.LEADER) return { ok: true, message: '「' + acc.username + '」已經是團長了。' };
    if (cur) {
      var row = cur._raw.slice(0, HEADERS[SHEET.ADMINS].length);
      row[2] = Logic.ROLE.LEADER;
      updateRows_(SHEET.ADMINS, [{ row: cur._row, values: row }]);
    } else {
      appendRows_(SHEET.ADMINS, [[acc.accountId, acc.nickname || acc.username, Logic.ROLE.LEADER, new Date(), '試算表選單', '', '', Logic.DEFAULT_SECTION, '']]);
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
function menuShowAllSheets() { var ui0 = SpreadsheetApp.getUi(); organizeSheets_(false); ui0.alert('已顯示全部分頁。查完後可以用「只顯示需要編輯的分頁」再收起來。\n\n⚠️ 系統分頁請不要手動修改。'); }
function menuHideSystemSheets() { var ui0 = SpreadsheetApp.getUi(); var n = organizeSheets_(true); ui0.alert('已收起 ' + n + ' 個系統分頁（資料都還在）。'); }

// ───────────── 最高管理員（SPEC 附錄第 79 點） ─────────────
// 最多 Logic.MAX_OWNERS 位、權限一樣。只能在這裡（能編輯試算表的人）新增或卸下；網站上只能自己卸任。

function menuAddOwner() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.prompt('👑 新增最高管理員', '請輸入要成為最高管理員的「帳號」（要先在網站註冊好）。\n最高管理員可以指定團長與總團、完全刪除資料、調整權限，最多 ' + Logic.MAX_OWNERS + ' 位：', ui.ButtonSet.OK_CANCEL);
  if (ans.getSelectedButton() !== ui.Button.OK) return;
  ui.alert(addOwnerByUsername_(ans.getResponseText()).message);
}

function menuRemoveOwner() {
  var ui = SpreadsheetApp.getUi();
  var ans = ui.prompt('👑 卸下最高管理員', '目前的最高管理員：' + ownerIds_().map(function (id) { return (findAccountById_(id) || {}).username; }).join('、') + '\n請輸入要卸下的「帳號」（至少要留一位；他的總團與分團身分不會被移除）：', ui.ButtonSet.OK_CANCEL);
  if (ans.getSelectedButton() !== ui.Button.OK) return;
  ui.alert(removeOwnerByUsername_(ans.getResponseText()).message);
}

function addOwnerByUsername_(username) {
  return withLock_(function () {
    var acc = findAccountByName_(username);
    if (!acc) return { ok: false, message: '找不到帳號「' + Logic.clean(username) + '」。請先在網站註冊，再回來設定。' };
    if (acc.status !== '啟用') return { ok: false, message: '這個帳號已停用，請先啟用。' };
    var owners = ownerIds_();
    if (owners.indexOf(acc.accountId) >= 0) return { ok: false, message: '「' + acc.username + '」已經是最高管理員了。' };
    if (owners.length >= Logic.MAX_OWNERS) return { ok: false, message: '最高管理員最多 ' + Logic.MAX_OWNERS + ' 位，請先卸下一位。' };
    // 最高管理員也加為總團（看得到全團、收全團的 LINE 通知）
    var rows = loadAdminRows_();
    if (!rows.some(function (r) { return r.accountId === acc.accountId && r.role === Logic.CENTRAL; })) {
      var name = (rows.filter(function (r) { return r.accountId === acc.accountId; })[0] || {}).name || acc.nickname || acc.username;
      appendRows_(SHEET.ADMINS, [[acc.accountId, name, Logic.CENTRAL, new Date(), '試算表選單', '', '', '', '總團']]);
    }
    writeOwners_(owners.concat([acc.accountId]));
    logOp_('試算表選單', '新增最高管理員', acc.username, '', '');
    return { ok: true, message: '已把「' + acc.username + '」設為最高管理員（目前共 ' + (owners.length + 1) + ' 位）。請他重新登入網站。' };
  });
}

function removeOwnerByUsername_(username) {
  return withLock_(function () {
    var acc = findAccountByName_(username);
    var owners = ownerIds_();
    if (!acc || owners.indexOf(acc.accountId) < 0) return { ok: false, message: '「' + Logic.clean(username) + '」不是最高管理員。' };
    var rest = owners.filter(function (id) { return id !== acc.accountId; });
    if (!rest.length) return { ok: false, message: '系統至少要有一位最高管理員，請先新增另一位再卸下。' };
    writeOwners_(rest);
    logOp_('試算表選單', '卸下最高管理員', acc.username, '', '');
    return { ok: true, message: '已卸下「' + acc.username + '」的最高管理員（他的總團與分團身分不變）。' };
  });
}

// ════════════════ AdminApi.js ════════════════
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
      // LINE 推播額度（附錄第 73 點㉑）：只給總團與最高管理員（沒有最高管理員時團長）
      lineQuota: canManageAll_(who) ? lineQuota_() : null,
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
  if (has((latestConsent_(Logic.ROVER_AUDIENCE) || {}).content)) out.push('個資告知內容（羅浮本人版）');
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
    var reason = Logic.clean(req.leaveReason);
    if (reason && Logic.LEAVE_REASONS.indexOf(reason) < 0) throw new ApiError(ERR.BAD_INPUT, '離開原因只能是' + Logic.LEAVE_REASONS.join('、') + '。');
    var row = cubRow_(cub);
    row[12] = status === '離團' ? reason : '';
    endRoleInRow_(cub, row, d);
    row[5] = ''; row[6] = 0; row[7] = status; row[8] = d; // 綁定碼立即失效
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
    logOp_(who.account.accountId, status === Logic.GRADUATED ? '標記升團' : '標記離團', cub.cubId, cub.status, status + ' ' + d + (row[12] ? '（' + row[12] + '）' : ''));
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
    cub: { cubId: cub.cubId, name: cub.name, squad: cub.squad, joinDate: cub.joinDate, status: cub.status, tenure: Logic.tenure(cub.joinDate, ctx.today).text, currentLevel: p.currentLevel || '', trialStart: cub.trialStart, role: cub.role, canLead: cub.status === '在團' && canLeadSquad_(cub).ok, squadStaff: squadStaffNames_(cub.squad, cub.section), section: cub.section, leaveReason: cub.leaveReason },
    hasProgress: hasProgress, levels: Logic.levelsOf(cub.section), history: cubHistory_(cub),
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
  var a = loadAwards_().filter(function (x) { return x.cubId === cub.cubId && x.unit === Logic.clean(unit) && x.sec === Logic.progressSec(cub.section); })[0];
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
/**
 * 最高管理員（可以有多位、最多 Logic.MAX_OWNERS 位，權限一樣；SPEC 附錄第 46、76、79 點）：
 * 設定分頁「最高管理員帳號ID」用「、」分隔多個帳號ID（舊版只有一個也照讀）；只算啟用中的帳號。
 * 沒有這一列或裡面的帳號都不能用時，是 admin 帳號；都沒有就是空陣列。
 * 這一列不在 Logic.SETTINGS 裡（設定頁看不到、不能改），只能由試算表選單新增或卸下、網站上自己卸任。
 */
function ownerIds_() {
  var configured = [];
  readRows_(SHEET.SETTINGS).forEach(function (r) { if (Logic.clean(r[0]) === OWNER_SETTING_KEY) configured = Logic.ownerList(r[1]); });
  var ok = configured.filter(function (id) { var a = findAccountById_(id); return a && a.status === '啟用'; }).slice(0, Logic.MAX_OWNERS);
  if (ok.length) return ok;
  var a = findAccountByName_(DEFAULT_ADMIN_USERNAME);
  return a ? [a.accountId] : [];
}
/** 第一位最高管理員（只用來判斷「有沒有最高管理員」）；判斷某人是不是要用 isOwnerId_ */
function ownerId_() { return ownerIds_()[0] || ''; }
function isOwnerId_(id) { return !!id && ownerIds_().indexOf(id) >= 0; }

/** 寫入最高管理員清單（試算表選單與卸任用） */
function writeOwners_(ids) {
  var sRows = readRows_(SHEET.SETTINGS);
  var cur = sRows.filter(function (r) { return Logic.clean(r[0]) === OWNER_SETTING_KEY; })[0];
  var vals = [OWNER_SETTING_KEY, ids.join('、'), '最高管理員帳號ID（最多 ' + Logic.MAX_OWNERS + ' 位，用「、」分隔；請用試算表選單「👑 最高管理員」新增或卸下，不要手動修改）'];
  if (cur) updateRows_(SHEET.SETTINGS, [{ row: cur._row, values: vals }]);
  else appendRows_(SHEET.SETTINGS, [vals]);
}

/**
 * [修補] 帳號管理用：跨全分團檢查對象是否為 admin、總團或任一分團團長。
 * 原本只看 loadAdmins_()（目前分團），切換到別的分團時會漏判他分團團長。
 */
function guardOwner_(targetId, who, allAdminRows, opts) {
  var owners = ownerIds_();
  if (!owners.length) return;
  var actorIsOwner = owners.indexOf(who.account.accountId) >= 0;
  if (owners.indexOf(targetId) >= 0) {
    // 最高管理員之間只能互相產生臨時碼（忘記密碼時互相備援）；不能停用、刪除（附錄第 79 點）
    if (opts && opts.tempCode && actorIsOwner) return;
    throw new ApiError(ERR.BAD_INPUT, Logic.OWNER_LOCKED_MESSAGE + (opts && opts.tempCode ? '忘記密碼時請另一位最高管理員產生臨時碼，或用試算表選單重設 admin。' : ''));
  }
  var rows = (allAdminRows || loadAdminRows_()).filter(function (a) { return a.accountId === targetId; });
  var isHigh = rows.some(function (a) { return a.role === Logic.ROLE.LEADER || a.role === Logic.CENTRAL; });
  if (isHigh && !actorIsOwner) throw new ApiError(ERR.BAD_INPUT, Logic.OWNER_ONLY_MESSAGE);
}

registerAdmin_('adminList', 'manageAdmins', function () {
  var acc = accountsById_(), owners = ownerIds_(), owner = owners[0] || '';
  var names = adminNames_();
  // 只列在目前分團有權限的人（總團也列，標記 central）；其他分團的身分在「分團身分」頁（SPEC 附錄第 68 點）
  return {
    ownerExists: !!owner,
    admins: loadAdmins_().map(function (a) {
      var r = a._raw, id = a.accountId;
      return { owner: owners.indexOf(id) >= 0, accountId: id, name: a.name, role: a.role, central: a.scope === Logic.CENTRAL, title: a.title, username: (acc[id] || {}).username || '（帳號已刪除）', joinedAt: ms_(r[3]), assignedBy: names[Logic.clean(r[4])] || Logic.clean(r[4]), lineLinked: !!a.lineUserId };
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
    var v = Logic.validateAdminChange(loadAdmins_(), who.account.accountId, { type: 'add', targetId: target.accountId, role: role }, ownerIds_());
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
    if (isOwnerId_(t.accountId) && who.account.accountId !== t.accountId) throw new ApiError(ERR.BAD_INPUT, Logic.OWNER_LOCKED_MESSAGE);
    // [修補] 避免 admin 切換到別的分團時，透過合成列誤蓋原本分團的設定
    if (t._synthetic) throw new ApiError(ERR.BAD_INPUT, '這個帳號在「' + curSec_() + '」沒有獨立身分列，請到「分團身分」設定。');
    var row = t._raw.slice(0, HEADERS[SHEET.ADMINS].length);
    var before = row[2] + '：' + row[1];
    if (req.role && Logic.clean(req.role) !== t.role) {
      var v = Logic.validateAdminChange(admins, who.account.accountId, { type: 'setRole', targetId: t.accountId, role: Logic.clean(req.role) }, ownerIds_());
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
    var v = Logic.validateAdminChange(admins, who.account.accountId, { type: 'remove', targetId: t.accountId }, ownerIds_());
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
    if (acc.accountId !== who.account.accountId) guardOwner_(acc.accountId, who, null, { tempCode: true });
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
  if (def.scope === 'progress') return def.section === Logic.progressSec(curSec_()) ? '分團' : null;
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
    consent: c && canShared_(who, '個資告知') ? { version: c.version, content: c.content, effective: c.effective } : null,
    // 羅浮本人（成年人版）告知（附錄第 73 點⑲）
    roverConsent: (function () { var rc = latestConsent_(Logic.ROVER_AUDIENCE); return rc && canShared_(who, '個資告知') ? { version: rc.version, content: rc.content, effective: rc.effective } : null; })()
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
  // audience：空白＝家長版；「羅浮本人」＝成年人版（附錄第 73 點⑲），版本各自計算
  var aud = consentAudience_(req.audience);
  return withLock_(function () {
    var c = latestConsent_(aud);
    if (c && c.content.trim() === content) throw new ApiError(ERR.BAD_INPUT, '內容沒有變更。');
    var version = (c ? c.version : 0) + 1;
    appendRows_(SHEET.CONSENT, [[version, content, today_(), aud]]);
    logOp_(who.account.accountId, '個資說明改版', (aud ? aud + '版 ' : '') + '第 ' + version + ' 版', c ? '第 ' + c.version + ' 版' : '', '第 ' + version + ' 版');
    return { version: version, audience: aud };
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

  var ownerIdList = ownerIds_();
  return {
    isOwner: !!who.isOwner,
    // 最高管理員（最多 Logic.MAX_OWNERS 位；附錄第 79 點）
    owners: ownerIdList.map(function (id) {
      var a = accById[id] || {}, row = allAdminRows.filter(function (r) { return r.accountId === id; })[0];
      return { username: a.username || '', name: (row && row.name) || a.nickname || a.username || '', lineLinked: !!(row && row.lineUserId), isMe: id === who.account.accountId };
    }),
    maxOwners: Logic.MAX_OWNERS,
    canResign: !!who.isOwner && ownerIdList.length >= 2,
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
      { label: '最高管理員有兩位以上（一位忘記密碼或離開時不會卡住）', ok: ownerIdList.length >= 2, note: '目前 ' + ownerIdList.length + ' 位；在試算表選單「👑 新增最高管理員」加人' },
      { label: '總團或管理員已設定兩人以上（避免單人交接斷層）', ok: central.length >= 2 || candidates.length >= 1, note: '目前總團 ' + central.length + ' 人、可接任候選 ' + candidates.length + ' 人' },
      { label: '待審核註冊申請已清空', ok: pendingReqs === 0, note: pendingReqs ? '尚有 ' + pendingReqs + ' 筆待審核' : '目前無積壓申請' }
    ]
  };
});

/**
 * 最高管理員自己卸任（附錄第 79 點）：要輸入自己的密碼（錯誤計入登入失敗、可被鎖定），至少要留一位。
 * 新增最高管理員只能在試算表選單（menuAddOwner），網站上不能新增或移交給別人。
 * keepAsCentral === false 時一併移除自己的總團身分（各分團身分不動）。
 */
registerAdmin_('ownerResign', 'manageHandover', function (req, who) {
  if (!who.isOwner) throw new ApiError(ERR.FORBIDDEN, '只有最高管理員可以卸任。');
  var password = String(req.password || '');
  if (!password) throw new ApiError(ERR.BAD_INPUT, '請輸入你目前的密碼以確認卸任。');
  return withLock_(function () {
    var settingsV = loadSettings_().values, me = findAccountById_(who.account.accountId);
    assertNotLocked_('登入', me.username.toLowerCase(), settingsV);
    if (!Logic.verifyPassword(password, me.salt, me.passwordHash, hmacHex_)) {
      recordFailure_('登入', me.username.toLowerCase());
      throw new ApiError(ERR.BAD_INPUT, '目前密碼不正確，沒有卸任。');
    }
    var owners = ownerIds_();
    var rest = owners.filter(function (id) { return id !== me.accountId; });
    if (!rest.length) throw new ApiError(ERR.BAD_INPUT, '系統至少要有一位最高管理員；請先在試算表選單「👑 新增最高管理員」加另一位，再卸任。');
    // 剩下的人寫成明確的清單（不再退回 admin 帳號）
    writeOwners_(rest);
    if (req.keepAsCentral === false) {
      var mine = loadAdminRows_().filter(function (r) { return r.accountId === me.accountId && r.role === Logic.CENTRAL; });
      if (mine.length) deleteRows_(SHEET.ADMINS, mine.map(function (r) { return r._row; }));
    }
    logOp_(who.account.accountId, '卸任最高管理員', me.username, '', req.keepAsCentral === false ? '不保留總團' : '保留總團');
    clearPublicCache_();
    return { owners: rest.length };
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
    var cub, selfReq = r.type === '本人';
    // 羅浮本人的申請（附錄第 73 點⑱）只能在羅浮核准，綁定為「本人」
    if (selfReq && Logic.ADULT_SELF_SECTIONS.indexOf(curSec_()) < 0) throw new ApiError(ERR.BAD_INPUT, '本人申請要切到羅浮後台核准。');
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
    if (!exists) appendRows_(SHEET.BINDINGS, [[r.accountId, cub.cubId, new Date(), new Date(r.at || Date.now()), r.consentVersion, selfReq ? Logic.RELATION.SELF : Logic.RELATION.PARENT]]);
    closeRequest_(r, '已核准', who, cub.cubId, '');
    logOp_(who.account.accountId, selfReq ? '核准羅浮本人申請' : '核准孩子申請', cub.cubId, '', '綁定帳號 ' + p.acc.username);
    return { type: selfReq ? '本人' : '孩子', cubId: cub.cubId };
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
    if (mode === 'delete' && ownerId_() && !isOwnerId_(who.account.accountId)) throw new ApiError(ERR.FORBIDDEN, '只有最高管理員可以完全刪除；其他團長可以用匿名化。');
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

// ════════════════ TeamApi.js ════════════════
/**
 * 小隊輔、正副小隊長、公告欄、批次匯入、家長線上請假（SPEC 附錄第 45 點）
 */

// ───────────── 小隊輔（每個小隊負責的服務員或團長） ─────────────

function loadSquadStaff_() {
  return readRows_(SHEET.SQUAD_STAFF).filter(function (r) { return Logic.clean(r[0]) && Logic.clean(r[1]); }).map(function (r) {
    return { squad: Logic.clean(r[0]), accountId: Logic.clean(r[1]), section: Logic.sectionOf(r[4]), _row: r._row, _raw: r };
  });
}

/** 某分團某小隊的小隊輔姓名（只取仍是該分團管理員的人；各分團的小隊名稱可以重複） */
function squadStaffNames_(squad, section) {
  if (!squad) return [];
  var sec = Logic.sectionOf(section), names = adminNamesIn_(sec);
  return loadSquadStaff_().filter(function (s) { return s.squad === squad && s.section === sec && names[s.accountId]; }).map(function (s) { return names[s.accountId]; });
}

/** 某管理員在某分團負責的小隊（依小隊清單順序），給點名、簽核預設用 */
function squadsOfStaff_(accountId, section) {
  var sec = Logic.sectionOf(section), mine = {};
  loadSquadStaff_().forEach(function (s) { if (s.accountId === accountId && s.section === sec) mine[s.squad] = true; });
  return squadListOf_(sec).filter(function (q) { return mine[q]; });
}

/** 設定某小隊的小隊輔（整組取代）；只能選現任管理員 */
registerAdmin_('squadStaffSave', 'manageSquadStaff', function (req, who) {
  var squad = Logic.clean(req.squad);
  var ids = (req.accountIds || []).map(Logic.clean).filter(String);
  return withLock_(function () {
    if (squadListOf_().indexOf(squad) < 0) throw new ApiError(ERR.NOT_FOUND, '找不到這個小隊。');
    var names = adminNamesIn_();
    if (ids.some(function (id) { return !names[id]; })) throw new ApiError(ERR.BAD_INPUT, '小隊輔只能選團長或服務員，請重新整理後再試。');
    var cur = loadSquadStaff_().filter(function (s) { return s.squad === squad && s.section === curSec_(); });
    var before = cur.map(function (s) { return names[s.accountId] || '（已移除）'; }).join('、');
    if (cur.length) deleteRows_(SHEET.SQUAD_STAFF, cur.map(function (s) { return s._row; }));
    var now = new Date(), seen = {};
    var rows = ids.filter(function (id) { if (seen[id]) return false; seen[id] = true; return true; }).map(function (id) { return [squad, id, who.account.accountId, now, curSec_()]; });
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
  // 級別資格只適用小狼（其他分團的進程第 2 期才做，先不限制）
  if (cub.section !== Logic.DEFAULT_SECTION) return { ok: true };
  if (Logic.ROLE_LEVELS.indexOf(cub.level) >= 0) return { ok: true };
  var seniors = (cubs || secCubs_()).filter(function (c) { return c.status === '在團' && c.squad === cub.squad && Logic.ROLE_LEVELS.indexOf(c.level) >= 0; });
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
      var holder = secCubs_().filter(function (c) { return c.cubId !== cub.cubId && c.status === '在團' && c.squad === cub.squad && c.role === role; })[0];
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
      meetingId: Logic.clean(r[4]), poster: Logic.clean(r[5]), at: ms_(r[6]), visible: Logic.clean(r[7]) !== '下架', target: Logic.targetOf(r[8]), _row: r._row, _raw: r
    };
  });
}

function noticeView_(n, meetings, names) {
  var m = n.meetingId ? meetings[n.meetingId] : null;
  var o = { id: n.id, title: n.title, content: n.content, pinned: n.pinned, target: n.target, date: n.at ? Utilities.formatDate(new Date(n.at), TZ, 'yyyy-MM-dd') : '', meeting: m ? { date: m.date, name: m.name } : null };
  if (names) { o.visible = n.visible; o.poster = names[n.poster] || ''; o.meetingId = n.meetingId; }
  return o;
}

function noticeMeetings_() {
  var map = {};
  loadMeetings_().forEach(function (m) { if (m.enabled && Logic.isDateStr(m.date)) map[m.meetingId] = m; });
  return map;
}

/**
 * 公開：顯示中的公告，置頂在前、新的在前。只回標題、內容、日期、對象（全團或分團）與連結的集會。
 * 公開首頁只顯示全團公告，分團頁加上該分團的公告（由網頁依 target 篩選，附錄第 73 點⑭）；每個對象最多 30 則。
 */
function apiNotices_() { return cachedPublic_('PUB_NOTICES', buildNotices_); }
function buildNotices_() {
  var meetings = noticeMeetings_();
  var per = {};
  var list = loadNotices_().filter(function (n) { return n.visible; })
    .sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.at - a.at; })
    .filter(function (n) { per[n.target] = (per[n.target] || 0) + 1; return per[n.target] <= 30; });
  return { notices: list.map(function (n) { return noticeView_(n, meetings, null); }) };
}
PUBLIC_ACTIONS.notices = apiNotices_;

/** 公告對象（附錄第 73 點⑭）：全團公告只有管理員或總團能發、能改；分團公告由該分團團長、服務員 */
function canEditNotice_(who, n) { return n.target === Logic.ALL ? canManageAll_(who) : n.target === curSec_(); }

registerAdmin_('noticeList', 'postNotice', function (req, who) {
  var meetings = noticeMeetings_(), names = adminNames_(), today = today_();
  return {
    section: curSec_(), canManageAll: canManageAll_(who),
    notices: loadNotices_().filter(function (n) { return Logic.targetIncludes(n.target, curSec_()); }).sort(function (a, b) { return b.at - a.at; }).map(function (n) {
      var o = noticeView_(n, meetings, names); o.canEdit = canEditNotice_(who, n); return o;
    }),
    meetings: Object.keys(meetings).map(function (k) { return meetings[k]; }).filter(function (m) { return m.date >= today && Logic.targetIncludes(m.target, curSec_()); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 30).map(function (m) { return { meetingId: m.meetingId, date: m.date, name: m.name }; })
  };
});

registerAdmin_('noticeSave', 'postNotice', function (req, who) {
  var title = Logic.clean(req.title), content = String(req.content || '').replace(/\r\n/g, '\n').trim();
  if (!title || title.length > 60) throw new ApiError(ERR.BAD_INPUT, '請填寫公告標題（最多 60 字）。');
  if (content.length > 2000) throw new ApiError(ERR.BAD_INPUT, '公告內容最多 2000 字。');
  var meetingId = Logic.clean(req.meetingId);
  return withLock_(function () {
    var linked = meetingId ? noticeMeetings_()[meetingId] : null;
    if (meetingId && (!linked || !Logic.targetIncludes(linked.target, curSec_()))) throw new ApiError(ERR.BAD_INPUT, '找不到連結的集會，請重新選擇。');
    var target = req.target === undefined ? null : Logic.clean(req.target) === Logic.ALL ? Logic.ALL : curSec_();
    if (target === Logic.ALL && !canManageAll_(who)) throw new ApiError(ERR.FORBIDDEN, '全團公告由管理員或總團發布。');
    var list = loadNotices_();
    if (req.id) {
      var n = list.filter(function (x) { return x.id === Logic.clean(req.id) && Logic.targetIncludes(x.target, curSec_()); })[0];
      if (!n) throw new ApiError(ERR.NOT_FOUND, '找不到這則公告。');
      if (!canEditNotice_(who, n)) throw new ApiError(ERR.FORBIDDEN, '全團公告由管理員或總團修改。');
      var v = HEADERS[SHEET.NOTICES].map(function (h, j) { return n._raw[j] === undefined ? '' : n._raw[j]; });
      v[1] = title; v[2] = content; v[3] = req.pinned ? '是' : '否'; v[4] = meetingId;
      if (target) v[8] = target;
      if (req.visible !== undefined) v[7] = req.visible ? '顯示' : '下架';
      updateRows_(SHEET.NOTICES, [{ row: n._row, values: v }]);
      logOp_(who.account.accountId, '修改公告', n.id, n.title, title + (v[7] === '下架' ? '（下架）' : ''));
      return { id: n.id };
    }
    var id = newId_('N', list.map(function (x) { return x.id; }));
    appendRows_(SHEET.NOTICES, [[id, title, content, req.pinned ? '是' : '否', meetingId, who.account.accountId, new Date(), '顯示', target || curSec_()]]);
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
    var settings = loadSettings_().values, squads = squadListOf_(), today = today_();
    var existing = {};
    secCubs_().forEach(function (c) { if (c.status === '在團' || c.status === Logic.TRIAL) existing[c.name] = true; });
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
    if (dups.length && !req.confirm) return { needConfirm: true, warnings: ['已經有同名的團員：' + dups.join('、') + '。確定要再新增一位同名的嗎？'] };
    var ids = loadCubs_().map(function (c) { return c.cubId; }), codes = allCodes_(), rows = [];
    parsed.forEach(function (p) {
      var id = newId_('C', ids); ids.push(id);
      var code = Logic.generateCode(settings['綁定碼長度'], randInt_, codes); codes[code] = true;
      rows.push([id, p[0], p[1], p[2], '', code, settings['綁定碼可用次數'], '在團', '', '', '', curSec_()]);
    });
    appendRows_(SHEET.CUBS, rows);
    logOp_(who.account.accountId, '批次匯入團員', rows.length + ' 位', '', '');
    return { added: rows.length };
  });
});

// ───────────── 家長線上請假（只能幫自己綁定的孩子、只能請今天以後的集會） ─────────────

function apiParentLeave_(req, who) {
  return withLock_(function () {
    var cubId = Logic.clean(req.cubId);
    var binding = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId && b.cubId === cubId; })[0];
    if (!binding) throw new ApiError(ERR.NOT_FOUND, '找不到這位小狼的資料。');
    var cubObj = loadCubs_().filter(function (c) { return c.cubId === cubId; })[0];
    var isSelf = isMinorSelf_(binding, cubObj ? cubObj.section : '');
    if (!resolveWhoPerms_(who, !isSelf, isSelf, cubObj ? cubObj.section : '').tabs.parent_leave) {
      throw new ApiError(ERR.FORBIDDEN, '目前此身分或分團未開放線上請假功能。');
    }
    if (bindingNeedsConsent_(binding, cubObj ? cubObj.section : '')) throw new ApiError(ERR.NEED_CONSENT, '個資告知內容已更新，請先閱讀並同意。');
    var m = loadMeetings_().filter(function (x) { return x.meetingId === Logic.clean(req.meetingId); })[0];
    if (!m || !m.enabled || !Logic.isDateStr(m.date)) throw new ApiError(ERR.NOT_FOUND, '找不到這場集會。');
    if (m.date < today_()) throw new ApiError(ERR.BAD_INPUT, '這場集會已經過了，請聯絡團長或服務員。');
    var cubSec = (loadCubs_().filter(function (c) { return c.cubId === cubId; })[0] || {}).section;
    if (!Logic.targetIncludes(m.target, cubSec)) throw new ApiError(ERR.BAD_INPUT, '這場集會不需要請假。');
    if (!cubsOnDate_(m.date, m.type, cubSec).some(function (c) { return c.cubId === cubId; })) throw new ApiError(ERR.BAD_INPUT, '這場集會不需要請假。');
    var cur = loadAttendance_().filter(function (a) { return a.meetingId === m.meetingId && a.cubId === cubId; })[0];
    if (cur && Logic.isPresent(cur.status)) throw new ApiError(ERR.BAD_INPUT, '這場集會已經點名為' + cur.status + '，要修改請聯絡團長或服務員。');
    var want = req.leave !== false;
    if (want && !cur) appendRows_(SHEET.ATTENDANCE, [[m.meetingId, cubId, '請假', who.account.accountId, new Date()]]);
    if (!want && cur) deleteRows_(SHEET.ATTENDANCE, [cur._row]);
    if ((want && !cur) || (!want && cur)) logOp_(who.account.accountId, want ? '家長請假' : '家長取消請假', cubId, '', m.date);
    return { leave: want };
  });
}
AUTHED_ACTIONS.parentLeave = apiParentLeave_;

/**
 * 家長為「童軍／行義／羅浮」孩子建立「本人帳號」（有手機時使用）：
 * 建立後該帳號僅綁定這一位團員（關係＝本人），無法看到其他團員或他分團內容。
 */
function apiParentCreateScoutAccount_(req, who) {
  return withLock_(function () {
    var cubId = Logic.clean(req.cubId);
    var binding = loadBindings_().filter(function (b) {
      return b.accountId === who.account.accountId && b.cubId === cubId && b.relation !== Logic.RELATION.SELF;
    })[0];
    if (!binding) throw new ApiError(ERR.FORBIDDEN, '只有已綁定該團員的家長可以建立童軍本人帳號。');
    var cub = loadCubs_().filter(function (c) { return c.cubId === cubId; })[0];
    if (!cub) throw new ApiError(ERR.NOT_FOUND, '找不到這位團員的資料。');
    if (Logic.SELF_ELIGIBLE_SECTIONS.indexOf(cub.section) < 0) {
      throw new ApiError(ERR.BAD_INPUT, '目前僅開放「童軍、行義、羅浮」建立團員本人帳號。');
    }
    if (!resolveWhoPerms_(who, true, false, cub.section).tabs.parent_create_scout) {
      throw new ApiError(ERR.FORBIDDEN, '總團目前未開放家長建立童軍本人帳號。');
    }
    var settings = loadSettings_().values;
    var nick = Logic.clean(req.nickname) || cub.name;
    checkAccountInput_(req.username, req.password, nick, settings);
    if (isReservedUsername_(req.username) || findAccountByName_(req.username)) {
      throw new ApiError(ERR.NAME_TAKEN, '這個帳號名稱已經有人使用，請換一個。');
    }
    var accounts = loadAccounts_();
    var accountId = newId_('U', accounts.map(function (a) { return a.accountId; }));
    var salt = randomHex_(32);
    var hash = Logic.hashPassword(String(req.password), salt, HASH_ITERATIONS, hmacHex_);
    var now = new Date();
    appendRows_(SHEET.ACCOUNTS, [[accountId, Logic.clean(req.username), nick, hash, salt, '啟用', now, '', '', '']]);
    bindCub_(accountId, cub, binding.consentVersion || latestConsentVersionFor_(''), Logic.RELATION.SELF, true);
    logOp_(who.account.accountId, '家長建立童軍本人帳號', cub.cubId, '', Logic.clean(req.username) + '（' + cub.section + '）');
    return { accountId: accountId, username: Logic.clean(req.username), cubName: cub.name, section: cub.section };
  });
}
AUTHED_ACTIONS.parentCreateScoutAccount = apiParentCreateScoutAccount_;

// ───────────── 網站內容：認識 22 團（原「了解幼童軍」）、活動時間說明、FB 網址（SPEC 附錄第 49 點） ─────────────

var SITE_KEYS = ['about', 'activity', 'fb'];
/** 還沒設定「認識 22 團」時顯示的範本（全團版，附錄第 73 點），請管理員到後台改成實際內容 */
var DEFAULT_ABOUT = [
  '【這是範本，請到後台「設定 → 網站內容」改成實際內容】',
  '',
  '22 團是什麼？',
  '22 團有五個分團：稚齡童軍（小一、小二）、幼童軍（小三到小六）、童軍（國中）、行義童軍（高中）、羅浮童軍（18 歲以上）。孩子在小隊裡和夥伴一起玩遊戲、學技能、到戶外探索，從「做中學」培養自己動手、照顧別人和團隊合作的習慣。',
  '',
  '我們平常做什麼？',
  '各分團定期舉行團集會，內容包含遊戲、手作、繩結、戶外活動與服務學習；每年另有露營、團慶等全團活動。',
  '',
  '怎麼加入？',
  '歡迎先來體驗：參加幾次一般團集會後就可以正式入團。想帶孩子來體驗，請聯絡：【請填寫聯絡方式】。'
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

/** 公開：認識 22 團、活動時間說明、FB 網址，以及這個月 1 日以後、啟用中的集會（只有日期、名稱、類型、備註） */
function apiSiteInfo_() { return cachedPublic_('PUB_SITE', buildSiteInfo_); }
function buildSiteInfo_() {
  var today = today_(), from = today.slice(0, 8) + '01';
  var v = siteValues_();
  var meetings = loadMeetings_().filter(function (m) { return m.enabled && Logic.isDateStr(m.date) && m.date >= from; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 200)
    .map(function (m) { return { date: m.date, name: m.name, type: m.type, note: m.note, target: m.target }; });
  return { about: v.about, activity: v.activity, fb: v.fb, today: today, meetings: meetings, events: publicEvents_(), publicTabs: Logic.resolvePermissions(loadPermRules_(), { loggedIn: false }).tabs };
}
PUBLIC_ACTIONS.siteInfo = apiSiteInfo_;

registerAdmin_('siteContentGet', 'manageSettings', function () { return siteValues_(); });

registerAdmin_('siteContentSave', 'manageSettings', function (req, who) {
  var text = function (v) { return String(v === undefined || v === null ? '' : v).replace(/\r\n/g, '\n').trim(); };
  var next = { about: text(req.about), activity: text(req.activity), fb: Logic.clean(req.fb) };
  if (next.about.length > 5000) throw new ApiError(ERR.BAD_INPUT, '「認識 22 團」最多 5000 字。');
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
    logOp_(who.account.accountId, '修改網站內容', '認識 22 團／活動時間／FB', '', '');
    return { changed: ups.length + adds.length };
  });
});

// ───────────── 升團（SPEC 附錄第 69、80 點） ─────────────

/**
 * 升團：同一筆團員改到下一個分團（稚齡→小狼→童軍→行義→羅浮），團員ID、家長綁定、舊紀錄都不變。
 * 由原分團的團長（或 admin、總團切到原分團）操作；升團日由團長指定（每年五月團慶），新分團的入團日＝升團日。
 * 小隊清空、職務卸任；原本的入團日、小隊、職務寫進「升團紀錄」。新分團的目前級別依新分團的頒章重算（童軍→行義接續）。
 */
registerAdmin_('cubPromote', 'manageCubs', function (req, who) {
  var date = requireDate_(Logic.clean(req.date), '升團日');
  return withLock_(function () {
    var cub = findCub_(req.cubId); // 只找得到目前分團（原分團）的團員
    if (cub.status !== '在團') throw new ApiError(ERR.BAD_INPUT, '只有在團的團員可以升團。');
    var to = Logic.SECTIONS[Logic.SECTIONS.indexOf(cub.section) + 1];
    if (!to) throw new ApiError(ERR.BAD_INPUT, '羅浮是最後一個分團，不能再升團；離開 22 團請用「標記離團」。');
    var row = cubRow_(cub), oldRole = Logic.clean(row[10]);
    endRoleInRow_(cub, row, date);
    row[2] = ''; row[3] = date; row[9] = ''; row[11] = to; row[12] = '';
    row[4] = Logic.currentLevelOf(loadAwards_().filter(function (a) { return a.cubId === cub.cubId; }), to);
    updateRows_(SHEET.CUBS, [{ row: cub._row, values: row }]);
    appendRows_(SHEET.PROMOTIONS, [[cub.cubId, cub.section, to, date, cub.joinDate, cub.squad, oldRole, who.account.accountId, new Date()]]);
    logOp_(who.account.accountId, '升團', cub.cubId, cub.section, to + ' ' + date);
    return { toSection: to };
  });
});

// ════════════════ EventApi.js ════════════════
// 活動報名與繳費紀錄、進程章與技能章圖片（SPEC 附錄第 50 點）
// 報名只收「姓名、身分別」與團長自訂題目的答案；不收電話、地址、生日等機敏資訊。
// 繳費只記錄金額與是否已繳，不經手金流。

// ───────────── 讀取 ─────────────

function parseJson_(v, fallback) { try { var o = JSON.parse(String(v || '')); return o === null || o === undefined ? fallback : o; } catch (e) { return fallback; } }

function loadEvents_() {
  return readRows_(SHEET.EVENTS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      id: Logic.clean(r[0]), title: Logic.clean(r[1]), desc: String(r[2] === undefined || r[2] === null ? '' : r[2]),
      date: dateStr_(r[3]), endDate: dateStr_(r[4]), regStart: Logic.clean(r[5]), regEnd: Logic.clean(r[6]),
      fee: Number(r[7]) || 0, questions: parseJson_(r[8], []), enabled: Logic.clean(r[9]) !== '關閉', sheetId: Logic.clean(r[12]), archived: !!Logic.clean(r[13]), targets: Logic.parseTargets(r[14]), _row: r._row, _raw: r
    };
  });
}

function loadRegs_() {
  return readRows_(SHEET.EVENT_REGS).filter(function (r) { return Logic.clean(r[0]); }).map(function (r) {
    return {
      id: Logic.clean(r[0]), eventId: Logic.clean(r[1]), accountId: Logic.clean(r[2]), name: Logic.clean(r[3]), identity: Logic.clean(r[4]),
      answers: parseJson_(r[5], {}), amount: Number(r[6]) || 0, paid: Logic.clean(r[7]) === '是', at: ms_(r[8]), active: Logic.clean(r[9]) !== '取消', _row: r._row, _raw: r
    };
  });
}

/** 現在時間，格式和報名起訖一樣（'YYYY-MM-DDTHH:mm'，台灣時間），可以直接比字串 */
function nowStamp_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm"); }
function regState_(ev, now) { return !ev.enabled ? '已關閉' : now < ev.regStart ? '尚未開始' : now > ev.regEnd ? '已截止' : '報名中'; }

/** 給報名的人看的活動資料（白名單） */
function eventView_(ev, now) {
  return { id: ev.id, title: ev.title, desc: ev.desc, date: ev.date, endDate: ev.endDate, regStart: ev.regStart, regEnd: ev.regEnd, fee: ev.fee, targets: ev.targets.slice(), state: regState_(ev, now) };
}

/** 公開（月曆與活動頁用）：啟用中、還沒結束的活動；不含題目與任何報名資料 */
function publicEvents_() {
  var now = nowStamp_(), from = now.slice(0, 8) + '01';
  return loadEvents_().filter(function (e) { return e.enabled && (e.endDate || e.date) >= from; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 50).map(function (e) { return eventView_(e, now); });
}

// ───────────── 報名（要登入；家長、服務員、團長都可以） ─────────────

/**
 * 這個帳號屬於哪些分團（活動報名資格用，附錄第 73 點⑮）：
 * 擔任團長、服務員的分團（admin、總團＝全部），以及綁定「在團／體驗中」孩子所在的分團。
 */
function accountSections_(who) {
  var set = {};
  (who.sections || []).forEach(function (x) { set[x.section] = true; });
  var active = {};
  loadCubs_().forEach(function (c) { if (c.status === '在團' || c.status === Logic.TRIAL) active[c.cubId] = c.section; });
  loadBindings_().forEach(function (b) { if (b.accountId === who.account.accountId && active[b.cubId]) set[active[b.cubId]] = true; });
  return Object.keys(set);
}
/** 可以報名的人：團長、服務員，或有綁定「在團／體驗中」孩子的帳號（SPEC 附錄第 52 點）；有指定 ev 時還要在活動開放的分團 */
function canRegisterEvents_(who, ev, secs) {
  secs = secs || accountSections_(who);
  if (!secs.length) return false;
  if (!ev) return true;
  return secs.some(function (sec) { return Logic.targetsInclude(ev.targets, sec); });
}
var EVENT_NOT_ELIGIBLE = '活動報名只開放 22 團的家長、團長與服務員。如果你是 22 團的家長，請等團長審核通過後再報名。';

function apiEventList_(req, who) {
  var now = nowStamp_(), today = now.slice(0, 10), secs = accountSections_(who), eligible = canRegisterEvents_(who, null, secs);
  // 有身分的人只看開放給自己分團的活動；還沒有任何分團的人照舊看全部（但不能報名）
  var events = loadEvents_().filter(function (e) { return e.enabled && (e.endDate || e.date) >= today && (!eligible || canRegisterEvents_(who, e, secs)); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var mine = loadRegs_().filter(function (r) { return r.accountId === who.account.accountId && r.active; });
  return {
    identities: Logic.EVENT_IDENTITIES, eligible: eligible, notice: eligible ? '' : EVENT_NOT_ELIGIBLE,
    events: events.map(function (e) {
      var v = eventView_(e, now);
      if (eligible) v.questions = e.questions;
      v.mine = mine.filter(function (r) { return r.eventId === e.id; }).map(function (r) { return { regId: r.id, name: r.name, identity: r.identity, answers: r.answers, amount: r.amount, paid: r.paid }; });
      return v;
    })
  };
}
AUTHED_ACTIONS.eventList = apiEventList_;

function apiEventRegister_(req, who) {
  // 先看是不是 22 團的人（訊息照舊），再看總團有沒有開放這個身分線上報名（權限設定 parent_events）
  if (!canRegisterEvents_(who)) throw new ApiError(ERR.FORBIDDEN, EVENT_NOT_ELIGIBLE);
  var myBinds = loadBindings_().filter(function (b) { return b.accountId === who.account.accountId; });
  var secOfCub = {};
  loadCubs_().forEach(function (c) { secOfCub[c.cubId] = c.section; });
  var isPar = myBinds.some(function (b) { return !isMinorSelf_(b, secOfCub[b.cubId]); });
  var isSelf = !who.admin && myBinds.length > 0 && !isPar;
  return afterSync_(withLock_(function () {
    var secs = accountSections_(who);
    if (!canRegisterEvents_(who, null, secs)) throw new ApiError(ERR.FORBIDDEN, EVENT_NOT_ELIGIBLE);
    var ev = loadEvents_().filter(function (e) { return e.id === Logic.clean(req.eventId); })[0];
    if (!ev || !ev.enabled) throw new ApiError(ERR.NOT_FOUND, '找不到這個活動。');
    if (!canRegisterEvents_(who, ev, secs)) throw new ApiError(ERR.FORBIDDEN, '這個活動只開放給' + ev.targets.join('、') + '報名。');
    // 總團的「線上活動報名」權限（parent_events）：只要有一個「活動開放、而且這個人在那裡有在團孩子或身分」的分團開放報名就可以
    //（多個孩子分屬不同分團時，不只看第一個孩子；附錄第 78 點）
    var okSec = secs.filter(function (sec) { return Logic.targetsInclude(ev.targets, sec); })
      .some(function (sec) { return resolveWhoPerms_(who, isPar, isSelf, sec).tabs.parent_events; });
    if (!okSec) throw new ApiError(ERR.FORBIDDEN, '目前此身分或分團未開放線上活動報名。');
    var st = regState_(ev, nowStamp_());
    if (st !== '報名中') throw new ApiError(ERR.BAD_INPUT, '這個活動' + (st === '尚未開始' ? '還沒開始報名。' : '已經截止報名，請聯絡團長。'));
    var v = Logic.validateEventPeople(req.people, ev.questions);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    var regs = loadRegs_();
    var mine = regs.filter(function (r) { return r.eventId === ev.id && r.accountId === who.account.accountId && r.active; });
    if (mine.length + v.people.length > Logic.EVENT_MAX_PER_ACCOUNT) throw new ApiError(ERR.BAD_INPUT, '同一個帳號每個活動最多報名 ' + Logic.EVENT_MAX_PER_ACCOUNT + ' 位。');
    var dup = v.people.filter(function (p) { return mine.some(function (r) { return r.name === p.name; }); })[0];
    if (dup) throw new ApiError(ERR.BAD_INPUT, '「' + dup.name + '」已經報名過了。');
    var ids = regs.map(function (r) { return r.id; }), now = new Date();
    appendRows_(SHEET.EVENT_REGS, v.people.map(function (p) {
      var id = newId_('R', ids); ids.push(id);
      return [id, ev.id, who.account.accountId, p.name, p.identity, JSON.stringify(p.answers), ev.fee, '否', now, '有效', '', ''];
    }));
    logOp_(who.account.accountId, '活動報名', ev.id, '', v.people.length + ' 位');
    return { added: v.people.length, _ev: ev.id };
  }));
}
AUTHED_ACTIONS.eventRegister = apiEventRegister_;

/** 自己取消報名：只能在報名期間內、且還沒登記繳費 */
function apiEventCancel_(req, who) {
  return afterSync_(withLock_(function () {
    var r = loadRegs_().filter(function (x) { return x.id === Logic.clean(req.regId) && x.accountId === who.account.accountId && x.active; })[0];
    if (!r) throw new ApiError(ERR.NOT_FOUND, '找不到這筆報名。');
    var ev = loadEvents_().filter(function (e) { return e.id === r.eventId; })[0];
    if (!ev || regState_(ev, nowStamp_()) !== '報名中') throw new ApiError(ERR.BAD_INPUT, '報名已經截止，要取消請聯絡團長。');
    if (r.paid) throw new ApiError(ERR.BAD_INPUT, '這筆報名已經登記繳費，要取消請聯絡團長。');
    var row = r._raw.slice(0, HEADERS[SHEET.EVENT_REGS].length);
    row[9] = '取消'; row[10] = who.account.accountId; row[11] = new Date();
    updateRows_(SHEET.EVENT_REGS, [{ row: r._row, values: row }]);
    logOp_(who.account.accountId, '取消活動報名', r.eventId, '', '');
    return { _ev: r.eventId };
  }));
}
AUTHED_ACTIONS.eventCancel = apiEventCancel_;

// ───────────── 後台：活動設定、報名名單、繳費紀錄（團長） ─────────────

/**
 * 活動對象（附錄第 73 點⑮，團長 2026-11-19 決定）：「全團」或一個以上的分團。
 * 全團活動只有管理員或總團能開、能改；分團活動由對象裡任一分團的團長管理。
 */
function canManageEvent_(who, ev) {
  if (canManageAll_(who)) return true;
  return ev.targets.indexOf(Logic.ALL) < 0 && ev.targets.indexOf(curSec_()) >= 0;
}
function findManagedEvent_(who, eventId) {
  var ev = loadEvents_().filter(function (e) { return e.id === Logic.clean(eventId); })[0];
  if (!ev || !Logic.targetsInclude(ev.targets, curSec_())) throw new ApiError(ERR.NOT_FOUND, '找不到這個活動。');
  if (!canManageEvent_(who, ev)) throw new ApiError(ERR.FORBIDDEN, '全團活動由管理員或總團管理。');
  return ev;
}
/** 送來的活動對象 → 存進試算表的字串（「全團」或「童軍、行義」） */
function eventTargets_(who, v) {
  if (v === undefined || v === null) return curSec_();
  var list = (Array.isArray(v) ? v : [v]).map(Logic.clean).filter(String);
  if (list.indexOf(Logic.ALL) >= 0) {
    if (!canManageAll_(who)) throw new ApiError(ERR.FORBIDDEN, '全團活動由管理員或總團開設。');
    return Logic.ALL;
  }
  var out = Logic.SECTIONS.filter(function (s) { return list.indexOf(s) >= 0; });
  if (!out.length || out.length !== list.length) throw new ApiError(ERR.BAD_INPUT, '請選擇活動開放的分團。');
  if (out.indexOf(curSec_()) < 0 && !canManageAll_(who)) throw new ApiError(ERR.BAD_INPUT, '活動對象要包含你自己的分團（' + curSec_() + '）。');
  return out.join('、');
}

registerAdmin_('eventAdminList', 'manageEvents', function (req, who) {
  var now = nowStamp_(), regs = loadRegs_().filter(function (r) { return r.active; });
  return {
    identities: Logic.EVENT_IDENTITIES, section: curSec_(), sections: Logic.SECTIONS, canManageAll: canManageAll_(who),
    events: loadEvents_().filter(function (e) { return Logic.targetsInclude(e.targets, curSec_()); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (e) {
      var mine = regs.filter(function (r) { return r.eventId === e.id; });
      var v = eventView_(e, now);
      v.questions = e.questions; v.enabled = e.enabled; v.archived = e.archived; v.canEdit = canManageEvent_(who, e);
      v.count = mine.length; v.paidCount = mine.filter(function (r) { return r.paid; }).length;
      return v;
    })
  };
});

registerAdmin_('eventSave', 'manageEvents', function (req, who) {
  var v = Logic.validateEvent(req);
  if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
  var e = v.event;
  return afterSync_(withLock_(function () {
    var list = loadEvents_();
    var cells = [e.title, e.desc, e.date, e.endDate, e.regStart, e.regEnd, e.fee, JSON.stringify(e.questions), req.enabled === false ? '關閉' : '開放'];
    if (req.id) {
      var cur = findManagedEvent_(who, req.id);
      if (cur.archived) throw new ApiError(ERR.BAD_INPUT, '這個活動已經結束並封存，不能再修改；資料請看存檔試算表。');
      var row = cur._raw.slice(0, HEADERS[SHEET.EVENTS].length);
      while (row.length < HEADERS[SHEET.EVENTS].length) row.push('');
      cells.forEach(function (c, i) { row[i + 1] = c; });
      if (req.targets !== undefined) row[14] = eventTargets_(who, req.targets);
      updateRows_(SHEET.EVENTS, [{ row: cur._row, values: row }]);
      logOp_(who.account.accountId, '修改活動', cur.id, cur.title, e.title + (req.enabled === false ? '（關閉）' : ''));
      return { id: cur.id, _ev: cur.id };
    }
    var id = newId_('E', list.map(function (x) { return x.id; }));
    appendRows_(SHEET.EVENTS, [[id].concat(cells, [who.account.accountId, new Date(), '', '', eventTargets_(who, req.targets)])]);
    logOp_(who.account.accountId, '新增活動', id, '', e.title);
    return { id: id, _ev: id };
  }));
});

registerAdmin_('eventRegs', 'manageEvents', function (req, who) {
  var ev = findManagedEvent_(who, req.eventId);
  var acc = accountsById_();
  var v = eventView_(ev, nowStamp_());
  v.questions = ev.questions; v.enabled = ev.enabled; v.archived = ev.archived;
  return {
    event: v, sheetUrl: ev.sheetId ? EVENT_SHEET_URL + ev.sheetId : '',
    regs: loadRegs_().filter(function (r) { return r.eventId === ev.id && r.active; }).sort(function (a, b) { return a.at - b.at; }).map(function (r) {
      return { regId: r.id, name: r.name, identity: r.identity, answers: r.answers, amount: r.amount, paid: r.paid, at: r.at, by: (acc[r.accountId] || {}).nickname || '（帳號已刪除）' };
    })
  };
});

/** 登記繳費：只記錄金額與是否已繳。updates = [{ regId, amount, paid }] */
registerAdmin_('eventPay', 'manageEvents', function (req, who) {
  var updates = Array.isArray(req.updates) ? req.updates : [];
  if (!updates.length || updates.length > 300) throw new ApiError(ERR.BAD_INPUT, '沒有要儲存的變更。');
  return afterSync_(withLock_(function () {
    var regs = loadRegs_(), ups = [], now = new Date();
    var first = regs.filter(function (x) { return x.id === Logic.clean(updates[0].regId) && x.active; })[0];
    if (!first) throw new ApiError(ERR.NOT_FOUND, '找不到其中一筆報名，請重新整理。');
    findManagedEvent_(who, first.eventId);
    updates.forEach(function (u) {
      var r = regs.filter(function (x) { return x.id === Logic.clean(u.regId) && x.active && x.eventId === first.eventId; })[0];
      if (!r) throw new ApiError(ERR.NOT_FOUND, '找不到其中一筆報名，請重新整理。');
      var amount = Number(u.amount);
      if (!isFinite(amount) || amount < 0 || amount > 1000000 || Math.floor(amount) !== amount) throw new ApiError(ERR.BAD_INPUT, r.name + '：金額需為 0～1000000 的整數。');
      var row = r._raw.slice(0, HEADERS[SHEET.EVENT_REGS].length);
      row[6] = amount; row[7] = u.paid ? '是' : '否'; row[10] = who.account.accountId; row[11] = now;
      ups.push({ row: r._row, values: row });
    });
    updateRows_(SHEET.EVENT_REGS, ups);
    logOp_(who.account.accountId, '登記活動繳費', first.eventId, '', ups.length + ' 筆');
    return { changed: ups.length, _ev: first.eventId };
  }));
});

/** 團長取消一筆報名（保留紀錄，狀態改為取消） */
registerAdmin_('eventRegRemove', 'manageEvents', function (req, who) {
  return afterSync_(withLock_(function () {
    var r = loadRegs_().filter(function (x) { return x.id === Logic.clean(req.regId) && x.active; })[0];
    if (!r) throw new ApiError(ERR.NOT_FOUND, '找不到這筆報名。');
    findManagedEvent_(who, r.eventId);
    var row = r._raw.slice(0, HEADERS[SHEET.EVENT_REGS].length);
    row[9] = '取消'; row[10] = who.account.accountId; row[11] = new Date();
    updateRows_(SHEET.EVENT_REGS, [{ row: r._row, values: row }]);
    logOp_(who.account.accountId, '取消活動報名', r.eventId, '', '');
    return { _ev: r.eventId };
  }));
});

// ───────────── 每個活動一份獨立的存檔試算表（SPEC 附錄第 51 點） ─────────────
// 另開一個 Google 試算表檔案（只有擁有者＝團長看得到），每次報名、取消、登記繳費後整份重寫。
// 主系統的「活動」「活動報名」分頁才是資料來源；存檔失敗不影響報名。

var EVENT_FOLDER_NAME = '幼童軍活動報名存檔';
var EVENT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/';

function eventFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('EVENT_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 資料夾被刪掉了，重建 */ } }
  var folder = DriveApp.createFolder(EVENT_FOLDER_NAME);
  props.setProperty('EVENT_FOLDER_ID', folder.getId());
  return folder;
}

/** 寫進另一份試算表的文字：等號等開頭的內容前面加單引號，避免被當成公式 */
function safeCell_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }

function writeSheet_(book, name, rows) {
  var sh = book.getSheetByName(name) || book.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows.map(function (r) { return r.map(safeCell_); }));
  sh.setFrozenRows(1);
}

/** 建立（第一次）或更新這個活動的存檔試算表，回傳網址。inLock=true 時表示呼叫端已持有 script lock */
function syncEventSheet_(eventId, inLock) {
  var ensureBook = function () {
    DB_CACHE_ = {};
    var ev = loadEvents_().filter(function (e) { return e.id === eventId; })[0];
    if (!ev) throw new ApiError(ERR.NOT_FOUND, '找不到這個活動。');
    if (ev.archived) throw new ApiError(ERR.BAD_INPUT, '這個活動已經封存，存檔試算表不會再更新。');
    var book = null;
    if (ev.sheetId) { try { book = SpreadsheetApp.openById(ev.sheetId); } catch (e) { book = null; } }
    if (!book) {
      book = SpreadsheetApp.create('活動報名｜' + ev.title + '｜' + ev.date);
      try { DriveApp.getFileById(book.getId()).moveTo(eventFolder_()); } catch (e) { /* 搬不進資料夾就留在雲端硬碟根目錄 */ }
      var first = book.getSheets()[0];
      if (first && first.getName() !== '報名名單') first.setName('報名名單');
      var row = HEADERS[SHEET.EVENTS].map(function (h, j) { return ev._raw[j] === undefined ? '' : ev._raw[j]; });
      row[12] = book.getId();
      updateRows_(SHEET.EVENTS, [{ row: ev._row, values: row }]);
    }
    return { ev: ev, book: book };
  };
  // [修補] 建立存檔試算表並回寫 sheetId 時加上鎖保護，避免兩人同時報名建出重複試算表
  var pair = inLock ? ensureBook() : withLock_(ensureBook);
  var ev = pair.ev, book = pair.book;
  var acc = accountsById_(), now = new Date();
  var fmt = function (t) { return t ? Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd HH:mm') : ''; };
  var regs = loadRegs_().filter(function (r) { return r.eventId === ev.id; }).sort(function (a, b) { return a.at - b.at; });
  var head = ['姓名', '身分別'].concat(ev.questions.map(function (q) { return q.label; }), ['報名人', '應繳金額', '已繳', '報名時間', '狀態', '最後更新']);
  var rows = [head].concat(regs.map(function (r) {
    return [r.name, r.identity].concat(ev.questions.map(function (q) { return r.answers[q.id] || ''; }),
      [(acc[r.accountId] || {}).nickname || '（帳號已刪除）', r.amount, r.paid ? '是' : '否', fmt(r.at), r.active ? '有效' : '取消', fmt(ms_(r._raw[11]) || r.at)]);
  }));
  writeSheet_(book, '報名名單', rows);
  var act = regs.filter(function (r) { return r.active; });
  writeSheet_(book, '活動資訊', [['項目', '內容'], ['活動名稱', ev.title], ['活動日期', ev.date + (ev.endDate && ev.endDate !== ev.date ? '～' + ev.endDate : '')],
    ['開始報名', ev.regStart.replace('T', ' ')], ['結束報名', ev.regEnd.replace('T', ' ')], ['每人費用', ev.fee], ['狀態', ev.enabled ? '開放' : '關閉'],
    ['報名人數', act.length], ['已繳人數', act.filter(function (r) { return r.paid; }).length],
    ['應收金額', act.reduce(function (a, r) { return a + r.amount; }, 0)], ['已收金額', act.filter(function (r) { return r.paid; }).reduce(function (a, r) { return a + r.amount; }, 0)],
    ['說明', ev.desc], ['最後同步', fmt(now.getTime())], ['注意', '這份是自動產生的存檔，請不要直接在這裡修改；要改請到網站後台，這裡會自動更新。']]);
  return EVENT_SHEET_URL + book.getId();
}

/** 動作成功後更新存檔試算表；失敗只記錄，不影響主要操作。res._ev 是活動ID，不回傳給前端 */
function afterSync_(res) {
  var id = res && res._ev;
  if (res) delete res._ev;
  if (id) { try { syncEventSheet_(id, false); } catch (e) { console.error('活動存檔試算表更新失敗：' + (e && e.message)); } }
  return res;
}

/** 團長手動同步（或補建）存檔試算表 */
registerAdmin_('eventSheetSync', 'manageEvents', function (req, who) {
  var id = findManagedEvent_(who, req.eventId).id;
  try { return { sheetUrl: syncEventSheet_(id, false) }; }
  catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(ERR.BAD_INPUT, '存檔試算表建立或更新失敗，請稍後再試一次。'); }
});

/**
 * 活動結束後（結束日的隔天起）清除網站上的報名資料；存檔試算表保留，由團長自己封存（SPEC 附錄第 52 點）。
 * 先做最後一次同步，同步成功才清除並標記封存；同步失敗就留到下次再試，避免資料不見。每日排程呼叫。
 */
function purgeEndedEvents_() {
  var today = today_(), done = 0;
  var ended = loadEvents_().filter(function (e) { return !e.archived && Logic.isDateStr(e.endDate || e.date) && (e.endDate || e.date) < today; });
  ended.forEach(function (e0) {
    try {
      withLock_(function () {
        syncEventSheet_(e0.id, true);
        DB_CACHE_ = {};
        var ev = loadEvents_().filter(function (x) { return x.id === e0.id; })[0];
        if (!ev || !ev.sheetId) return;
        var rows = loadRegs_().filter(function (r) { return r.eventId === ev.id; }).map(function (r) { return r._row; });
        if (rows.length) deleteRows_(SHEET.EVENT_REGS, rows);
        var row = HEADERS[SHEET.EVENTS].map(function (h, j) { return ev._raw[j] === undefined ? '' : ev._raw[j]; });
        row[13] = new Date();
        updateRows_(SHEET.EVENTS, [{ row: ev._row, values: row }]);
        logOp_('每日排程', '活動封存', ev.id, rows.length + ' 筆報名', '已移到存檔試算表');
        done++;
      });
    } catch (err) { console.error('活動封存失敗（明天再試）：' + (err && err.message)); }
  });
  return done;
}

/**
 * [修補] 刪除帳號時一併刪除該帳號送出的報名（報名含姓名，屬個資），並回傳受影響的活動ID清單，
 * 讓呼叫端在釋放鎖之後再同步存檔試算表。
 */
function deleteRegsOfAccount_(accountId) {
  var mine = loadRegs_().filter(function (r) { return r.accountId === accountId; });
  if (!mine.length) return [];
  deleteRows_(SHEET.EVENT_REGS, mine.map(function (r) { return r._row; }));
  var seen = {}, evIds = [];
  mine.forEach(function (r) { if (!seen[r.eventId]) { seen[r.eventId] = true; evIds.push(r.eventId); } });
  return evIds;
}

// ───────────── 進程章與技能章的圖片（團長上傳，公開顯示） ─────────────

/** 某分團的章圖：{ '類別|名稱': {image, _row} }（第 6 欄分團，空白＝小狼） */
function loadUnitImages_(section) {
  var sec = Logic.progressSec(section || (typeof CUR_SEC_ !== 'undefined' && CUR_SEC_) || ''), map = {};
  readRows_(SHEET.UNIT_IMAGES).forEach(function (r) {
    if (Logic.sectionOf(r[5]) !== sec) return;
    var k = Logic.clean(r[1]) + '|' + Logic.clean(r[0]);
    if (Logic.clean(r[0]) && Logic.isUnitImage(String(r[2] || ''))) map[k] = { image: String(r[2]), _row: r._row };
  });
  return map;
}

/**
 * 公開：{ '進程|狼': 'data:image/…', '稚齡|技能章|種植': … }，只含還存在的級別與章。
 * 小狼的鍵沿用「類別|名稱」，其他分團前面加「分團|」（稚齡和小狼都有種植章）。
 */
function apiUnitImages_() {
  var out = {};
  Object.keys(Logic.PROGRESS_MODULES).forEach(function (sec) {
    var units = loadUnits_(sec), imgs = loadUnitImages_(sec);
    Object.keys(imgs).forEach(function (k) { if (units[k]) out[(sec === Logic.DEFAULT_SECTION ? '' : sec + '|') + k] = imgs[k].image; });
  });
  return { images: out };
}
PUBLIC_ACTIONS.unitImages = apiUnitImages_;

/** image 是前端縮小後的 data URL；空字串＝移除圖片。只改目前分團的章 */
registerAdmin_('unitImageSave', 'manageItems', function (req, who) {
  var category = Logic.clean(req.category), unit = Logic.clean(req.unit), image = String(req.image || '');
  if (image && !Logic.isUnitImage(image)) throw new ApiError(ERR.BAD_INPUT, '圖片格式不正確或檔案太大，請換一張圖再試。');
  var sec = Logic.progressSec(curSec_());
  return withLock_(function () {
    var key = category + '|' + unit;
    if (!loadUnits_(sec)[key]) throw new ApiError(ERR.NOT_FOUND, '找不到這個級別或技能章。');
    var cur = loadUnitImages_(sec)[key];
    if (!image) { if (cur) deleteRows_(SHEET.UNIT_IMAGES, [cur._row]); }
    else if (cur) updateRows_(SHEET.UNIT_IMAGES, [{ row: cur._row, values: [unit, category, image, who.account.accountId, new Date(), secCell_(sec)] }]);
    else appendRows_(SHEET.UNIT_IMAGES, [[unit, category, image, who.account.accountId, new Date(), secCell_(sec)]]);
    logOp_(who.account.accountId, image ? '上傳章的圖片' : '移除章的圖片', key, '', '');
    return {};
  });
});

// ════════════════ ItemsAdmin.js ════════════════
/**
 * 項目管理（SPEC 7.7，階段 4B，團長專用；附錄第 77 點起各分團只管自己的項目，依目前分團 curSec_()）
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
  return readRows_(SHEET.ITEMS).filter(function (r) { return Logic.clean(r[0]) && (!section || Logic.progressSec(r[7]) === Logic.progressSec(section)); });
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
  var sec = Logic.progressSec(curSec_()), mod = Logic.progressModule(sec);
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
  var sec = Logic.progressSec(curSec_()), mod = Logic.progressModule(sec);
  return withLock_(function () {
    var allRows = readRows_(SHEET.UNITS).filter(function (r) { return Logic.clean(r[0]); });
    var rows = allRows.filter(function (r) { return Logic.progressSec(r[6]) === sec; });
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

// ════════════════ StaffApi.js ════════════════
/**
 * 分團身分與邀請碼（SPEC 附錄第 68 點，多分團骨架）
 * - 管理員分頁一人可有多列：每個分團一列（團長／服務員），總團一列（全部分團）。
 * - 只有管理員（admin 帳號）或總團可以設定；總團、團長只有 admin 能指定或取消（沒有 admin 帳號時總團也可以）。
 * - 小狼以外的分團目前只有身分，還沒有功能；他們登入後看到「分團功能準備中」。
 */

/** 只有管理員（admin）或總團可以用 */
function requireStaffManager_(who) {
  var owners = ownerIds_();
  var isOwner = owners.indexOf(who.account.accountId) >= 0;
  if (!isOwner && !who.isCentral) throw new ApiError(ERR.FORBIDDEN, '你沒有權限執行這個操作。');
  return { accountId: who.account.accountId, isOwner: isOwner, isCentral: !!who.isCentral, ownerId: owners };
}

/** 一列的代號：總團或分團名稱（同一人同一代號只會有一列） */
function staffKey_(r) { return r.role === Logic.CENTRAL ? Logic.CENTRAL : r.section; }

AUTHED_ACTIONS.staffList = function (req, who) {
  var actor = requireStaffManager_(who);
  var acc = accountsById_();
  return {
    sections: Logic.SECTIONS, roles: Logic.STAFF_ROLES, isOwner: actor.isOwner,
    staff: loadAdminRows_().map(function (r) {
      return {
        accountId: r.accountId, key: staffKey_(r), name: r.name, username: (acc[r.accountId] || {}).username || '（帳號已刪除）',
        section: r.section, role: r.role, title: r.title, owner: actor.ownerId.indexOf(r.accountId) >= 0, lineLinked: !!r.lineUserId
      };
    })
  };
};

/** 新增／修改／移除一個分團身分。req: {type, accountId, key（修改、移除時原本的代號）, section, role, title, name} */
AUTHED_ACTIONS.staffSave = function (req, who) {
  var actor = requireStaffManager_(who);
  return withLock_(function () {
    var type = Logic.clean(req.type);
    if (['add', 'update', 'remove'].indexOf(type) < 0) throw new ApiError(ERR.BAD_INPUT, '不支援的操作。');
    var target = accountsById_()[Logic.clean(req.accountId)];
    if (!target) throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    if (type === 'add' && target.status !== '啟用') throw new ApiError(ERR.NOT_FOUND, '找不到這個帳號。');
    var rows = loadAdminRows_();
    var v = Logic.validateStaffChange(rows, actor, {
      type: type, targetId: target.accountId, key: Logic.clean(req.key), section: req.section, role: req.role, title: req.title
    }, actor.ownerId);
    if (!v.ok) throw new ApiError(ERR.BAD_INPUT, v.error);
    var title = Logic.clean(req.title).slice(0, 20);
    var name = Logic.clean(req.name).slice(0, 30) || (v.row && v.row.name) || target.nickname || target.username;
    var desc = function (role, section, t) { return (role === Logic.CENTRAL ? '總團' : section + '／' + role) + (t ? '（' + t + '）' : ''); };
    if (type === 'add') {
      appendRows_(SHEET.ADMINS, [[target.accountId, name, v.role, new Date(), who.account.accountId, '', '', v.section, title]]);
      logOp_(who.account.accountId, '新增分團身分', target.username, '', desc(v.role, v.section, title));
    } else if (type === 'update') {
      var row = v.row._raw.slice(0, HEADERS[SHEET.ADMINS].length);
      var before = desc(v.row.role, v.row.section, v.row.title);
      row[1] = name; row[2] = v.role; row[7] = v.section; row[8] = title;
      updateRows_(SHEET.ADMINS, [{ row: v.row._row, values: row }]);
      logOp_(who.account.accountId, '修改分團身分', target.username, before, desc(v.role, v.section, title));
    } else {
      deleteRows_(SHEET.ADMINS, [v.row._row]);
      // [修補] 移除分團身分時，若該人在該分團已無有效管理員身分則一併清理小隊輔
      if (v.row.role !== Logic.CENTRAL) {
        var remaining = loadAdminRows_();
        var stillAdmin = Logic.effectiveAdmins(remaining, v.row.section).some(function (a) { return a.accountId === target.accountId; });
        if (!stillAdmin) {
          var stRows = loadSquadStaff_().filter(function (s) { return s.accountId === target.accountId && s.section === v.row.section; }).map(function (s) { return s._row; });
          if (stRows.length) deleteRows_(SHEET.SQUAD_STAFF, stRows);
        }
      }
      logOp_(who.account.accountId, '移除分團身分', target.username, desc(v.row.role, v.row.section, v.row.title), '');
    }
    return {};
  });
};

/** 產生邀請碼（已指定分團、身分、職稱；對方用碼註冊即生效）。req: {section, role, title, name} */
AUTHED_ACTIONS.inviteCreate = function (req, who) {
  var actor = requireStaffManager_(who);
  return withLock_(function () {
    var role = Logic.clean(req.role), section = role === Logic.CENTRAL ? '' : Logic.clean(req.section);
    if (Logic.STAFF_ROLES.indexOf(role) < 0) throw new ApiError(ERR.BAD_INPUT, '身分只能是總團、團長或服務員。');
    if (role !== Logic.CENTRAL && Logic.SECTIONS.indexOf(section) < 0) throw new ApiError(ERR.BAD_INPUT, '請選擇分團。');
    if (role !== Logic.ROLE.ASSISTANT && (actor.ownerId ? !actor.isOwner : !actor.isCentral)) throw new ApiError(ERR.BAD_INPUT, '只有管理員（admin）可以邀請總團、團長。');
    var title = Logic.clean(req.title).slice(0, 20), name = Logic.clean(req.name).slice(0, 30);
    var hours = loadSettings_().values['管理員邀請碼有效小時數'];
    var code = Logic.generateCode(loadSettings_().values['綁定碼長度'] + 2, randInt_, allCodes_());
    var now = Date.now(), exp = new Date(now + hours * 3600000);
    appendRows_(SHEET.INVITES, [[code, role, name, who.account.accountId, new Date(now), exp, '未使用', '', '', section, title]]);
    logOp_(who.account.accountId, '產生邀請碼', name, '', (role === Logic.CENTRAL ? '總團' : section + '／' + role) + (title ? '（' + title + '）' : ''));
    return { code: code, expiresAt: exp.getTime() };
  });
};

// ════════════════ RegisApi.js ════════════════
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

// ════════════════ Notify.js ════════════════
/**
 * LINE 主動通知（SPEC 第八節，階段 5）
 * - 只通知「已連結 LINE」的管理員；家長不收任何推播。
 * - 同一小狼同一級別或章只通知一次（通知紀錄）；不再達標時清除紀錄，重新達標可再通知。
 * - 同一次觸發多位達標合併成一則；達標超過設定天數未頒章再提醒一次。
 * - 通知失敗不可以影響簽核、點名等主要操作（呼叫端一律用 notifySafely_）。
 */

/** 做完這些後台動作後重算達標並通知；值為 true 表示用「摘要」文字（項目或設定修改造成的批次變動） */
var NOTIFY_AFTER = {
  // 補登頒章不在這裡：SPEC 7.6「補登不觸發任何推播」（附錄第 78 點）；之後的每日排程照常重算
  signoff: false, signoffRevoke: false, award: false, awardRevoke: false, awardEdit: false,
  attendanceSave: false, cubLeave: false, cubJoin: false, itemSave: true, itemToggle: true, settingsSave: true
};

function notifySafely_(summary) {
  try { syncNotifications_({ summary: !!summary }); }
  catch (e) { try { console.error('通知失敗：' + (e && e.message ? e.message : e)); } catch (e2) { /* 忽略 */ } }
}

/**
 * 掃在團團員：達標未頒章（pending）、項目完成等條件（waiting）、快達標（near）、
 * 完成期限快到或已過（due；稚齡，附錄第 73 點⑨，只在後台提醒）。快達標門檻依各分團設定。
 */
function scanCubs_(ctx, cubs) {
  var pending = [], near = [], waiting = [], due = [];
  cubs.filter(function (c) { return c.status === '在團' && Logic.progressModule(c.section); }).forEach(function (c) {
    var threshold = Logic.sectionSetting(ctx.settings, '快達標門檻（剩幾項以內）', c.section);
    progressOf_(ctx, c.cubId).units.forEach(function (u) {
      var base = { cubId: c.cubId, name: c.name, squad: c.squad, joinDate: c.joinDate, category: u.category, unit: u.unit, section: c.section };
      if (u.status === Logic.STATUS.AWARDED) return;
      if (u.deadlineState) due.push(Object.assign({}, base, { deadline: u.deadline, over: u.deadlineState === 'over', done: u.done, total: u.total }));
      if (u.eligible) pending.push(Object.assign(base, { eligibleDate: u.eligibleDate }));
      else if (u.status === Logic.STATUS.DONE_PENDING) waiting.push(Object.assign(base, { waitingUntil: u.waitingUntil || '', attendSinceLast: u.attendSinceLast || 0, attendRequired: u.attendRequired || 0 }));
      else if (Logic.isNearlyDone(u, threshold)) near.push(Object.assign(base, { remaining: u.remaining }));
    });
  });
  due.sort(function (a, b) { return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0; });
  return { pending: pending, waiting: waiting, near: near, due: due };
}

function unitLabel_(p) { return p.category === Logic.CATEGORY.PROGRESS ? (p.unit === Logic.NEWBIE ? p.unit : p.unit + '級') : p.unit + '技能章'; }
/** 網站網址（結尾有 /）：指令碼屬性 WEB_URL → GitHub 正式網站（SPEC 附錄第 59 點：正式網站是 GitHub Pages） */
function webUrl_() {
  var p = PropertiesService.getScriptProperties().getProperty('WEB_URL');
  if (p) return /\/$/.test(p) ? p : p + '/';
  return DEFAULT_WEB_URL;
}
/** 達標通知只推給該分團已連結 LINE 的團長、服務員（附錄第 73 點⑳） */
function linkedLineIds_(section) { return loadAdmins_(section || Logic.DEFAULT_SECTION).map(function (a) { return a.lineUserId; }).filter(String); }
/** 系統告警（如備份失敗）推給已連結 LINE 的團長與總團 */
function linkedLeaderLineIds_() {
  var seen = {}, ids = [];
  loadAdminRows_().forEach(function (a) {
    if ((a.role === Logic.ROLE.LEADER || a.role === Logic.CENTRAL) && a.lineUserId && !seen[a.lineUserId]) {
      seen[a.lineUserId] = true;
      ids.push(a.lineUserId);
    }
  });
  return ids;
}
/** 有進程模組的分團的在團團員（達標掃描用） */
function progressCubs_() { return loadCubs_().filter(function (c) { return Logic.PROGRESS_SECTIONS.indexOf(c.section) >= 0; }); }

/**
 * 重算達標清單，與通知紀錄比對後推播（依分團各自推給該分團已連結 LINE 的管理員）。
 * 沒有 token 或該分團沒有任何管理員連結 LINE 時不推播、也不寫通知紀錄（之後連結了才通知）。
 * @return {{notified: number, reminded: number, cleared: number, skipped?: string}}
 */
function syncNotifications_(opts) {
  opts = opts || {};
  return withLock_(function () {
    var ctx = progressCtx_();
    var pending = scanCubs_(ctx, progressCubs_()).pending;
    var byKey = {};
    pending.forEach(function (p) { byKey[p.cubId + '|' + p.unit] = p; });
    var rows = readRows_(SHEET.NOTIFY).filter(function (r) { return Logic.clean(r[0]); });
    var key = function (r) { return Logic.clean(r[0]) + '|' + Logic.clean(r[1]); };
    var notified = rows.filter(function (r) { return Logic.clean(r[2]) === '達標'; });
    var diff = Logic.diffNotifications(Object.keys(byKey), notified.map(key));
    // 不再達標（撤銷、已頒發、項目修改）：清除該小狼該級的所有通知紀錄
    var clear = {};
    diff.toClear.forEach(function (k) { clear[k] = true; });
    var del = rows.filter(function (r) { return clear[key(r)]; }).map(function (r) { return r._row; });
    if (del.length) deleteRows_(SHEET.NOTIFY, del);

    // 每個分團分開推：只推給該分團已連結 LINE 的團長、服務員（附錄第 73 點⑳）；該分團沒人連結時不寫紀錄，之後連結了才通知
    var token = PropertiesService.getScriptProperties().getProperty('LINE_MESSAGING_TOKEN');
    var idsOf = {};
    Logic.PROGRESS_SECTIONS.forEach(function (sec) { idsOf[sec] = linkedLineIds_(sec); });
    var anyIds = Logic.PROGRESS_SECTIONS.some(function (sec) { return idsOf[sec].length; });
    if (!token || !anyIds) return { notified: 0, reminded: 0, cleared: del.length, skipped: !token ? 'no_token' : 'no_linked_admin' };

    var now = new Date(), add = [], result = { notified: 0, reminded: 0, cleared: del.length };
    var reminded = {};
    rows.forEach(function (r) { if (Logic.clean(r[2]) === '再提醒') reminded[key(r)] = true; });
    Logic.PROGRESS_SECTIONS.forEach(function (sec) {
      var ids = idsOf[sec];
      if (!ids.length) return;
      var fresh = diff.toNotify.map(function (k) { return byKey[k]; }).filter(function (p) { return p.section === sec; });
      if (fresh.length) {
        var ok = linePush_(ids, opts.summary ? summaryMessage_(fresh) : eligibleMessage_(fresh, '🎉 達標通知'), token);
        if (ok) { fresh.forEach(function (p) { add.push([p.cubId, p.unit, '達標', now]); }); result.notified += fresh.length; }
      }
      // 再提醒：達標通知超過設定天數仍未頒章，只提醒一次（天數依各分團設定）
      var days = Logic.sectionSetting(ctx.settings, '未頒章再提醒天數', sec);
      if (days > 0) {
        var due = notified.filter(function (r) {
          var k = key(r);
          return byKey[k] && byKey[k].section === sec && !reminded[k] && !clear[k] && ms_(r[3]) && Date.now() - ms_(r[3]) >= days * 86400000;
        }).map(function (r) { return byKey[key(r)]; });
        if (due.length && linePush_(ids, eligibleMessage_(due, '⏰ 還沒頒章的提醒'), token)) {
          due.forEach(function (p) { add.push([p.cubId, p.unit, '再提醒', now]); });
          result.reminded += due.length;
        }
      }
    });
    if (add.length) appendRows_(SHEET.NOTIFY, add);
    return result;
  });
}

/** 達標通知：Flex Message（最多 10 位各一張卡片，超過改用文字），附「前往頒章」按鈕 */
function eligibleMessage_(list, title) {
  var alt = title + '：' + list.map(function (p) { return p.name + '（' + unitLabel_(p) + '）'; }).join('、');
  if (list.length > 10) return { type: 'text', text: alt.slice(0, 4500) + '\n' + webUrl_() };
  var bubbles = list.map(function (p) {
    return {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'text', text: title, size: 'sm', color: '#1f4e9c', weight: 'bold' },
        { type: 'text', text: p.name, size: 'xl', weight: 'bold', wrap: true },
        { type: 'text', text: unitLabel_(p) + '　達標', size: 'md', wrap: true },
        { type: 'text', text: [p.squad || '未分小隊', '入團 ' + (p.joinDate || '－'), '達標日 ' + (p.eligibleDate || '－')].join('・'), size: 'sm', color: '#6b7385', wrap: true }
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#1f4e9c', action: { type: 'uri', label: '前往頒章', uri: webUrl_() + 'web/#award=' + encodeURIComponent(p.cubId + ',' + p.unit + (p.section && p.section !== Logic.DEFAULT_SECTION ? ',' + p.section : '')) } }
      ] }
    };
  });
  return { type: 'flex', altText: alt.slice(0, 380), contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles } };
}

/** 項目或設定修改造成的批次變動：一則摘要 */
function summaryMessage_(list) {
  return { type: 'text', text: ('📋 項目或設定修改後，有 ' + list.length + ' 筆新達標：' + list.map(function (p) { return p.name + '（' + unitLabel_(p) + '）'; }).join('、')).slice(0, 4500) + '\n' + webUrl_() };
}

/** 推播給多位管理員（multicast）。失敗時寫操作日誌並累計「通知未送達」；成功則歸零 */
function linePush_(ids, message, token) {
  var props = PropertiesService.getScriptProperties();
  var code = 0;
  try {
    code = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: ids.slice(0, 500), messages: [message] }), muteHttpExceptions: true
    }).getResponseCode();
  } catch (e) { code = -1; }
  if (code === 200) { props.setProperty('NOTIFY_FAILED', '0'); return true; }
  props.setProperty('NOTIFY_FAILED', String(Number(props.getProperty('NOTIFY_FAILED') || 0) + 1));
  logOp_('系統', '通知未送達', 'LINE', '', '回應代碼 ' + code);
  return false;
}

// ───────────── 關鍵字回覆（不計入推播額度） ─────────────

/** 「進度」任何人都回網頁連結（不含個資）；「可晉級」「快達標」「點名」只回覆已連結 LINE 的管理員 */
function handleKeyword_(text, lineUserId, replyToken) {
  if (text === '進度') return lineReply_(replyToken, '查看進度請開啟網頁並登入：\n' + webUrl_());
  if (text !== '可晉級' && text !== '快達標' && text !== '點名') return null;
  // 已連結 LINE 的管理員（任何分團）；LINE 跟著人走
  var rows = loadAdminRows_(), me = rows.filter(function (a) { return a.lineUserId === lineUserId; })[0];
  if (!me) return null;
  // 帳號已停用（或已刪除）的人即使沒解除 LINE，也不回覆名單（附錄第 78 點）
  var meAcc = accountsById_()[me.accountId];
  if (!meAcc || meAcc.status !== '啟用') return null;
  var isOwner = isOwnerId_(me.accountId);
  var secs = Logic.staffSections(rows.filter(function (a) { return a.accountId === me.accountId; }), isOwner);
  var home = Logic.pickSection(secs, '');
  if (text === '點名') return lineReply_(replyToken, rollReplyText_(home ? home.section : Logic.DEFAULT_SECTION));
  var mySecs = secs.map(function (x) { return x.section; }).filter(function (x) { return Logic.PROGRESS_SECTIONS.indexOf(x) >= 0; });
  if (!mySecs.length) return lineReply_(replyToken, '你的分團的進程功能還在準備中。');
  // 只列這個人有身分的分團（admin、總團是每個分團）
  var scan = scanCubs_(progressCtx_(), progressCubs_().filter(function (c) { return mySecs.indexOf(c.section) >= 0; }));
  var lines;
  if (text === '可晉級') {
    lines = scan.pending.map(function (p) { return '・' + p.name + '：' + unitLabel_(p) + '（達標 ' + (p.eligibleDate || '－') + '）'; });
    return lineReply_(replyToken, lines.length ? ('🏅 達標未頒章 ' + lines.length + ' 筆\n' + lines.join('\n')).slice(0, 4500) : '目前沒有達標未頒章的團員。');
  }
  lines = scan.near.map(function (p) { return '・' + p.name + '：' + unitLabel_(p) + '（還差 ' + p.remaining + ' 項）'; });
  return lineReply_(replyToken, lines.length ? ('🔥 快達標 ' + lines.length + ' 筆\n' + lines.join('\n')).slice(0, 4500) : '目前沒有快達標的團員。');
}

/**
 * 關鍵字「點名」（SPEC 附錄第 63 點，只回已連結 LINE 的管理員）：今天或下一場集會、已請假名單、直達點名頁的連結。
 * 只列請假的孩子姓名與小隊；名單和「可晉級」一樣只會回給管理員。
 */
function rollReplyText_(section) {
  var today = today_(), sec = Logic.sectionOf(section);
  var m = loadMeetings_().filter(function (x) { return x.enabled && Logic.isDateStr(x.date) && x.date >= today && Logic.targetIncludes(x.target, sec); })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
  if (!m) return '接下來沒有排定的集會。到網站後台「行事曆」新增：\n' + webUrl_() + 'web/';
  var inMeeting = {};
  cubsOnDate_(m.date, m.type, sec).forEach(function (c) { inMeeting[c.cubId] = c; });
  var leave = [], present = 0;
  loadAttendance_().forEach(function (a) {
    if (a.meetingId !== m.meetingId || !inMeeting[a.cubId]) return;
    if (a.status === '請假') leave.push(inMeeting[a.cubId]);
    else if (Logic.isPresent(a.status)) present++;
  });
  var d = m.date.split('-');
  var wd = '日一二三四五六'.charAt(new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2])).getDay());
  var lines = [(m.date === today ? '📋 今天 ' : '📋 下一場：') + Number(d[1]) + '/' + Number(d[2]) + '（' + wd + '）' + m.name];
  if (m.date === today) lines.push('已點名出席 ' + present + ' 位');
  lines.push(leave.length ? '🌙 已請假 ' + leave.length + ' 位：\n' + leave.map(function (c) { return '・' + c.name + (c.squad ? '（' + c.squad + '）' : ''); }).join('\n') : '🌙 目前沒有人請假');
  lines.push('點名：' + webUrl_() + 'web/#roll=' + encodeURIComponent(m.meetingId + (sec !== Logic.DEFAULT_SECTION ? ',' + sec : '')));
  return lines.join('\n').slice(0, 4500);
}

// ───────────── 每日排程 ─────────────

/** 每天掃一次：抓「項目早就全過、今天剛滿晉級間隔」與再提醒 */
function dailyJob() { if (throttle_('LAST_DAILY_RUN', 60)) runDaily_(); }
function runDaily_() {
  DB_CACHE_ = {};
  try { purgeEndedEvents_(); } catch (e) { console.error('活動封存失敗：' + (e && e.message)); }
  DB_CACHE_ = {};
  notifySafely_(false);
}

/** 安裝每日排程（時間依設定「每日排程時間（幾點）」）；重複執行不會重複安裝 */
function installDailyTrigger() { assertEditorRun_(); installDailyTrigger_(); }
function installDailyTrigger_() {
  removeTriggers_('dailyJob');
  var hour = loadSettings_().values['每日排程時間（幾點）'];
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(hour).create();
  PropertiesService.getScriptProperties().setProperty('DAILY_HOUR', String(hour));
  Logger.log('已安裝每日排程（每天 ' + hour + ' 點）。');
}

/** setup 與設定修改後呼叫：沒有排程或時間改了才重裝 */
function ensureDailyTrigger_() {
  var hour = String(loadSettings_().values['每日排程時間（幾點）']);
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyJob'; });
  if (has && PropertiesService.getScriptProperties().getProperty('DAILY_HOUR') === hour) return false;
  installDailyTrigger_();
  return true;
}

// ───────────── 推播額度（附錄第 73 點㉑：先維持免費方案，後台顯示本月已推播則數，接近上限提醒） ─────────────

/** 本月已推播／上限（LINE 官方帳號的方案額度）；快取 1 小時。沒有 token 或查詢失敗回 null */
function lineQuota_() {
  var token = PropertiesService.getScriptProperties().getProperty('LINE_MESSAGING_TOKEN');
  if (!token) return null;
  var cache = CacheService.getScriptCache(), hit = cache.get('LINE_QUOTA');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* 重查 */ } }
  try {
    var get = function (path) {
      var r = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, { method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      return r.getResponseCode() === 200 ? JSON.parse(r.getContentText() || '{}') : null;
    };
    var q = get('quota'), used = get('quota/consumption');
    if (!q || !used) return null;
    var limit = q.type === 'limited' ? Number(q.value) || 0 : 0;
    var out = { used: Number(used.totalUsage) || 0, limit: limit, near: limit > 0 && Number(used.totalUsage) >= limit * 0.8 };
    cache.put('LINE_QUOTA', JSON.stringify(out), 3600);
    return out;
  } catch (e) { return null; }
}


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
    // [修補] 補完階段 5：備份失敗時透過 LINE 主動推播提醒團長與總團
    try {
      var token = props.getProperty('LINE_MESSAGING_TOKEN');
      var ids = token ? linkedLeaderLineIds_() : [];
      if (token && ids.length) linePush_(ids, { type: 'text', text: '⚠️ 22 團系統備份失敗\n' + result.message + '\n請到後台「備份」檢查。' }, token);
    } catch (e2) { /* 推播失敗不影響備份結果紀錄 */ }
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
function weeklyBackup() { if (throttle_('LAST_WEEKLY_RUN', 60)) runWeekly_(); }
function runWeekly_() {
  DB_CACHE_ = {};
  if (loadSettings_().values['每週備份']) runBackup_();
  checkPermissions_();
}

/**
 * 排程用的公開函式也可能被網頁訪客呼叫（google.script.run），所以限制頻率：
 * 距離上次執行不到 minutes 分鐘就略過。回傳 true 表示可以執行。
 */
function throttle_(key, minutes) {
  var props = PropertiesService.getScriptProperties(), now = Date.now();
  var last = Number(props.getProperty(key)) || 0;
  if (now - last < minutes * 60000) return false;
  props.setProperty(key, String(now));
  return true;
}

/** 備份資料夾名稱（setup 自動建立時使用） */
var BACKUP_FOLDER_NAME = '幼童軍進程系統備份';

/**
 * 自動備份免設定（SPEC 附錄第 38 點）：沒有備份資料夾就在執行者的雲端硬碟建立一個（預設只有自己看得到），
 * 沒有每週備份排程就安裝。已經設定好的不動。
 * @return {string[]} 做了哪些事（給 setup 報告）
 */
function ensureBackup_() {
  var props = PropertiesService.getScriptProperties();
  var done = [];
  var folderId = props.getProperty('BACKUP_FOLDER_ID');
  var ok = false;
  if (folderId) { try { DriveApp.getFolderById(folderId); ok = true; } catch (e) { ok = false; } }
  if (!ok) {
    var folder = DriveApp.createFolder(BACKUP_FOLDER_NAME);
    props.setProperty('BACKUP_FOLDER_ID', folder.getId());
    done.push('建立備份資料夾「' + BACKUP_FOLDER_NAME + '」');
  }
  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'weeklyBackup'; })) {
    installBackupTrigger_();
    done.push('開啟每週日 03:00 自動備份');
  }
  return done;
}

/** 安裝每週備份排程（每週日凌晨 3 點）；重複執行不會重複安裝 */
function installBackupTrigger() { assertEditorRun_(); installBackupTrigger_(); }
function installBackupTrigger_() {
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
 * 階段 5：關鍵字回覆（可晉級、快達標、進度、點名）。
 */
function handleWebhook_(e) {
  var key = PropertiesService.getScriptProperties().getProperty('WEBHOOK_KEY');
  // 密鑰不符：直接忽略
  if (!key || !Logic.constantTimeEqual(String(e.parameter.key || ''), key)) return;
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return; }
  // 只處理格式正確的請求
  if (!body || !Array.isArray(body.events)) return;
  body.events.forEach(function (ev) {
    if (!ev || ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
    if (!ev.source || ev.source.type !== 'user' || !ev.source.userId || !ev.replyToken) return;
    var text = String(ev.message.text || '').trim();
    if (/^\d{6}$/.test(text)) handlePairing_(text, ev.source.userId, ev.replyToken);
    else { DB_CACHE_ = {}; handleKeyword_(text, ev.source.userId, ev.replyToken); }
  });
}

/** 配對碼正確 → 把 LINE userId 寫入該管理員；錯誤則不回覆（不透露任何資訊） */
function handlePairing_(code, lineUserId, replyToken) {
  var cache = CacheService.getScriptCache();
  var accountId = cache.get('PAIR_' + code);
  if (!accountId) return;
  cache.remove('PAIR_' + code);
  var name = withLock_(function () {
    // 寫在這個人的第一列（LINE 跟著人走，任何分團的列都算）
    var a = loadAdminRows_().filter(function (x) { return x.accountId === accountId; })[0];
    if (!a) return null;
    var row = a._raw.slice(0, HEADERS[SHEET.ADMINS].length);
    row[5] = lineUserId; row[6] = new Date();
    updateRows_(SHEET.ADMINS, [{ row: a._row, values: row }]);
    logOp_(accountId, '連結 LINE 通知', a.name, '', ''); // 不記 userId
    return a.name;
  });
  if (name) lineReply_(replyToken, '✅ ' + name + '，已連結 22 團系統的通知。之後團員達標時會在這裡通知你。\n也可以輸入「可晉級」、「快達標」或「點名」查名單。');
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

// ════════════════ RichMenu.js ════════════════
/**
 * LINE 圖文選單一鍵安裝（SPEC 附錄第 60 點）
 * 試算表選單「🐺 幼童軍系統 → 📱 安裝 LINE 圖文選單」呼叫 menuInstallRichMenu()。
 * 步驟：建立選單（六格連結）→ 上傳圖片（docs/line-richmenu.jpg，從 GitHub 網站抓）→ 設為所有人的預設 → 刪掉舊的「22團選單」。
 * 圖片由 tools/richmenu.js 產生；六格位置要和那支程式一致（三欄兩列，左上 → 右上 → 左下 → 右下）。
 * token 只放在 Script Properties（LINE_MESSAGING_TOKEN），不寫進日誌或視窗。
 */
var RICH_MENU_NAME = '22團選單';
var RICH_MENU_SIZE = { width: 2500, height: 1686 };

/** 22 團 FB 粉絲專頁（公開網址；SPEC 附錄第 67 點：右下角直接連到 FB） */
var TEAM_FB_URL = 'https://www.facebook.com/profile.php?id=100064559625116';

/** 六格：[按鈕名稱, 網站頁面]；第六格 FB 用「網站內容」的 FB 網址，沒填就用 22 團 FB 粉絲專頁 */
/** 文字改全團通用（附錄第 73 點⑳）；連結不變，已安裝的選單不用重裝，只有圖片上的字要換 */
var RICH_MENU_CELLS = [['公佈欄', 'notices'], ['進程查詢', 'progress'], ['章查詢', 'badges'], ['認識22團', 'about'], ['活動時間', 'calendar'], ['22團 FB', 'fb']];

/** 六格的範圍與連結（純計算，方便測試） */
function richMenuAreas_(root, fb) {
  var W = RICH_MENU_SIZE.width, H = RICH_MENU_SIZE.height;
  var xs = [0, Math.round(W / 3), Math.round(W * 2 / 3), W], ys = [0, Math.round(H / 2), H];
  return RICH_MENU_CELLS.map(function (c, i) {
    var col = i % 3, row = Math.floor(i / 3);
    var uri = c[1] === 'fb' ? (/^https:\/\/((www|m)\.)?(facebook\.com|fb\.com|fb\.me)\//.test(fb || '') ? fb : TEAM_FB_URL) : root + 'web/#' + c[1];
    return { bounds: { x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: ys[row + 1] - ys[row] },
      action: { type: 'uri', label: c[0], uri: uri } };
  });
}

/** 呼叫 LINE API；不是 200 就丟出含 LINE 說明的錯誤（不含 token） */
function lineApi_(token, method, url, payload, contentType) {
  var o = { method: method, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  if (payload !== undefined) { o.payload = payload; o.contentType = contentType || 'application/json'; }
  var res = UrlFetchApp.fetch(url, o);
  var code = res.getResponseCode(), text = res.getContentText() || '{}', json = {};
  try { json = JSON.parse(text); } catch (e) { json = {}; }
  if (code !== 200) throw new Error('LINE 回應 ' + code + (json.message ? '：' + json.message : ''));
  return json;
}

/** 安裝圖文選單，回傳新選單ID；失敗時刪掉做到一半的選單再丟出錯誤 */
function installRichMenu_(token) {
  var root = webUrl_();
  var fb = siteValues_().fb;
  var old = (lineApi_(token, 'get', 'https://api.line.me/v2/bot/richmenu/list').richmenus || [])
    .filter(function (m) { return m.name === RICH_MENU_NAME; }).map(function (m) { return m.richMenuId; });
  var id = lineApi_(token, 'post', 'https://api.line.me/v2/bot/richmenu', JSON.stringify({
    size: RICH_MENU_SIZE, selected: true, name: RICH_MENU_NAME, chatBarText: '選單', areas: richMenuAreas_(root, fb)
  })).richMenuId;
  try {
    var img = UrlFetchApp.fetch(root + 'docs/line-richmenu.jpg').getBlob();
    lineApi_(token, 'post', 'https://api-data.line.me/v2/bot/richmenu/' + id + '/content', img, 'image/jpeg');
    lineApi_(token, 'post', 'https://api.line.me/v2/bot/user/all/richmenu/' + id);
  } catch (e) {
    try { lineApi_(token, 'delete', 'https://api.line.me/v2/bot/richmenu/' + id); } catch (e2) { /* 刪不掉就算了 */ }
    throw e;
  }
  old.forEach(function (o) { try { lineApi_(token, 'delete', 'https://api.line.me/v2/bot/richmenu/' + o); } catch (e) { /* 舊的刪不掉不影響 */ } });
  logOp_('試算表選單', '安裝 LINE 圖文選單', RICH_MENU_NAME, old.length ? '舊選單 ' + old.length + ' 個' : '', '新選單');
  return id;
}

/** 試算表選單：安裝 LINE 圖文選單（只有能編輯試算表的人看得到；網頁訪客呼叫時 getUi 會直接失敗） */
function menuInstallRichMenu() {
  var ui = SpreadsheetApp.getUi();
  var token = PropertiesService.getScriptProperties().getProperty('LINE_MESSAGING_TOKEN');
  if (!token) { ui.alert('安裝 LINE 圖文選單', '還沒有設定 LINE_MESSAGING_TOKEN：請到 Apps Script「專案設定 → 指令碼屬性」填入官方帳號的 Channel access token。'); return; }
  try {
    installRichMenu_(token);
    ui.alert('安裝 LINE 圖文選單', '完成！用手機打開官方帳號聊天室就會看到新的六格選單（可能要關掉聊天室再打開）。\n\n' +
      '如果 LINE 官方帳號管理後台（manager.line.biz）也有設定圖文選單，這裡安裝的會優先顯示。\n' +
      '要換圖或換連結：改好後再按一次這個選單就會換新。');
  } catch (e) {
    ui.alert('安裝 LINE 圖文選單', '安裝失敗：' + e.message + '\n\n請確認 token 正確、網站（GitHub）上有 docs/line-richmenu.jpg。');
  }
}

// ════════════════ Setup.js ════════════════
/**
 * setup()：一鍵建立所有分頁與標題列、第一次匯入種子資料、產生第一位團長邀請碼。
 * 可重複執行；任何分頁已有資料時一律不覆蓋、不重新匯入。
 * 請在 Apps Script 編輯器手動執行。
 */
/** 給人在 Apps Script 編輯器按「執行」用：結果看執行記錄。不回傳內容（公開函式會被網頁訪客呼叫到，回傳值不能帶邀請碼） */
function setup() { assertEditorRun_(); setupCore_(); }

/**
 * 公開函式（名稱沒有底線結尾）在 GAS 網頁版可以被訪客用 google.script.run 呼叫到（附錄第 56、78 點）。
 * 會改設定或排程的函式先確認是擁有者本人在 Apps Script 編輯器或試算表選單執行：
 * 匿名訪客的 getActiveUser() 是空的，和執行身分（擁有者）不同。
 */
function assertEditorRun_() {
  var a = '', e = '';
  try { a = Session.getActiveUser().getEmail(); e = Session.getEffectiveUser().getEmail(); } catch (x) { /* 取不到就當成不是本人 */ }
  if (!a || a !== e) throw new Error('請由擁有者在 Apps Script 編輯器或試算表選單執行這個函式。');
}

function setupCore_() {
  clearAllCaches_();
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
    ensureSectionSeeds_().forEach(function (x) { report.seeded.push(x); });
    if (dataRowCount_(SHEET.DETAILS) === 0) {
      var details = Logic.buildDetailSeed(SEED.detailsCsv);
      if (details.length) { appendRows_(SHEET.DETAILS, details); report.seeded.push(SHEET.DETAILS + ' ' + details.length + ' 列'); }
    }
    if (dataRowCount_(SHEET.CONSENT) === 0) { appendRows_(SHEET.CONSENT, [[1, SEED.consentText, today_(), '']]); report.seeded.push(SHEET.CONSENT + ' 第 1 版'); }
    // 羅浮本人（成年人版，附錄第 73 點⑲）：還沒有這一份就新增第 1 版，不動家長版
    if (SEED.roverConsentText && !loadConsents_().some(function (c) { return c.audience === Logic.ROVER_AUDIENCE; })) {
      appendRows_(SHEET.CONSENT, [[1, SEED.roverConsentText, today_(), Logic.ROVER_AUDIENCE]]);
      report.seeded.push(SHEET.CONSENT + ' 羅浮本人版第 1 版');
    }

    // 權限設定：只在分頁沒有資料列時匯入預設權限表
    if (dataRowCount_(SHEET.PERMS) === 0) {
      var permRows = Logic.defaultPermRows().slice(1);
      appendRows_(SHEET.PERMS, permRows);
      report.seeded.push(SHEET.PERMS + ' ' + permRows.length + ' 項');
    }

    // 設定：只補上缺少的鍵，不改既有值
    var have = {};
    readRows_(SHEET.SETTINGS).forEach(function (r) { have[Logic.clean(r[0])] = true; });
    var missing = Logic.defaultSettingsRows().slice(1).filter(function (r) { return !have[r[0]]; });
    if (missing.length) { appendRows_(SHEET.SETTINGS, missing); report.seeded.push(SHEET.SETTINGS + ' 補上 ' + missing.length + ' 項'); }

    report.hidden = organizeSheets_(true);
    try { if (ensureDailyTrigger_()) report.seeded.push('開啟每日達標檢查排程'); } catch (e2) { report.seeded.push('⚠️ 每日排程安裝失敗：' + (e2 && e2.message ? e2.message : e2)); }
    try { ensureBackup_().forEach(function (x) { report.seeded.push(x); }); }
    catch (e) { report.seeded.push('⚠️ 自動備份設定失敗：' + (e && e.message ? e.message : e) + '（可稍後在 Apps Script 執行 installBackupTrigger）'); }
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
  if (loadAdminRows_().length) return null;
  var now = Date.now();
  var existing = loadInvites_().filter(function (i) { return i.role === Logic.ROLE.LEADER && Logic.checkInvite(i, now).ok; })[0];
  if (existing) return { code: existing.code, expiresAt: existing.expiresAt, reused: true };
  var len = loadSettings_().values['綁定碼長度'] + 2;
  var code = Logic.generateCode(len, randInt_, allCodes_());
  var exp = new Date(now + FIRST_LEADER_INVITE_HOURS * 3600000);
  appendRows_(SHEET.INVITES, [[code, Logic.ROLE.LEADER, '團長', 'setup', new Date(now), exp, '未使用', '', '', Logic.DEFAULT_SECTION, '']]);
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
  if (!loadUnits_(Logic.DEFAULT_SECTION)[Logic.CATEGORY.PROGRESS + '|' + NB]) {
    appendRows_(SHEET.UNITS, [[NB, Logic.CATEGORY.PROGRESS, '', seed.desc, seed.rule, 5]]);
    done.push(SHEET.UNITS + ' 新增剛入團');
  }
  return done.join('、');
}

/**
 * 匯入其他分團的官方進程與章（附錄第 77 點；目前是稚齡）：項目總表還沒有該分團的項目時，才在最下面新增；
 * 級別與章說明只補該分團還沒有的名稱。只新增列、不改任何既有資料；已匯入就不再執行（團長改過的內容不會被蓋掉）。
 * @return {string[]} 報告文字
 */
function ensureSectionSeeds_() {
  var out = [], sections = (typeof SEED !== 'undefined' && SEED.sections) || {};
  Object.keys(sections).forEach(function (sec) {
    if (!Logic.progressModule(sec)) return;
    var seed = Logic.buildSeed(sections[sec].itemsCsv, sections[sec].progressRules, sec);
    // 格式錯誤的列也算（看原始的分團欄），避免重複匯入
    var hasAny = readRows_(SHEET.ITEMS).some(function (r) { return Logic.clean(r[0]) && Logic.progressSec(r[7]) === sec; });
    if (!hasAny) {
      var taken = {};
      readRows_(SHEET.ITEMS).forEach(function (r) { taken[Logic.clean(r[0])] = true; });
      var rows = seed.itemRows.filter(function (r) { return !taken[r[0]]; });
      if (rows.length) { appendRows_(SHEET.ITEMS, rows); out.push(SHEET.ITEMS + ' 新增' + sec + ' ' + rows.length + ' 項'); }
    }
    var have = loadUnits_(sec);
    var units = seed.unitRows.filter(function (u) { return !have[u[1] + '|' + u[0]]; });
    if (units.length) { appendRows_(SHEET.UNITS, units); out.push(SHEET.UNITS + ' 新增' + sec + ' ' + units.length + ' 列'); }
  });
  return out;
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
  assertEditorRun_();
  var props = PropertiesService.getScriptProperties();
  var n = 0;
  Object.keys(props.getProperties()).forEach(function (k) { if (k.indexOf('T0B_') === 0) { props.deleteProperty(k); n++; } });
  Logger.log('已清除 ' + n + ' 筆 0B 測試資料。');
}
