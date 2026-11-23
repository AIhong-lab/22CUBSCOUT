/**
 * LINE 主動通知（SPEC 第八節，階段 5）
 * - 只通知「已連結 LINE」的管理員；家長不收任何推播。
 * - 同一小狼同一級別或章只通知一次（通知紀錄）；不再達標時清除紀錄，重新達標可再通知。
 * - 同一次觸發多位達標合併成一則；達標超過設定天數未頒章再提醒一次。
 * - 通知失敗不可以影響簽核、點名等主要操作（呼叫端一律用 notifySafely_）。
 */

/** 做完這些後台動作後重算達標並通知；值為 true 表示用「摘要」文字（項目或設定修改造成的批次變動） */
var NOTIFY_AFTER = {
  signoff: false, signoffRevoke: false, award: false, awardRevoke: false, awardEdit: false, backfill: false,
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
/** 有進程模組的分團的在團團員（達標掃描用） */
function progressCubs_() { return loadCubs_().filter(function (c) { return Logic.PROGRESS_SECTIONS.indexOf(c.section) >= 0; }); }

/**
 * 重算達標清單，與通知紀錄比對後推播。
 * 沒有 token 或沒有任何管理員連結 LINE 時不推播、也不寫通知紀錄（之後連結了才通知）。
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
        { type: 'button', style: 'primary', color: '#1f4e9c', action: { type: 'uri', label: '前往頒章', uri: webUrl_() + 'web/#award=' + encodeURIComponent(p.cubId + ',' + p.unit) } }
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

/** 「進度」任何人都回網頁連結（不含個資）；「可晉級」「快達標」只回覆已連結 LINE 的管理員 */
function handleKeyword_(text, lineUserId, replyToken) {
  if (text === '進度') return lineReply_(replyToken, '查看進度請開啟網頁並登入：\n' + webUrl_());
  if (text !== '可晉級' && text !== '快達標' && text !== '點名') return null;
  // 已連結 LINE 的管理員（任何分團）；LINE 跟著人走
  var rows = loadAdminRows_(), me = rows.filter(function (a) { return a.lineUserId === lineUserId; })[0];
  if (!me) return null;
  var isOwner = (accountsById_()[me.accountId] || {}).username === DEFAULT_ADMIN_USERNAME;
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
  lines.push('點名：' + webUrl_() + 'web/#roll=' + encodeURIComponent(m.meetingId));
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
function installDailyTrigger() {
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
  installDailyTrigger();
  return true;
}
