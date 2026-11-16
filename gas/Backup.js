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
    installBackupTrigger();
    done.push('開啟每週日 03:00 自動備份');
  }
  return done;
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
