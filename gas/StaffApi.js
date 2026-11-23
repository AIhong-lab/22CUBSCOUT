/**
 * 分團身分與邀請碼（SPEC 附錄第 68 點，多分團骨架）
 * - 管理員分頁一人可有多列：每個分團一列（團長／服務員），總團一列（全部分團）。
 * - 只有管理員（admin 帳號）或總團可以設定；總團、團長只有 admin 能指定或取消（沒有 admin 帳號時總團也可以）。
 * - 小狼以外的分團目前只有身分，還沒有功能；他們登入後看到「分團功能準備中」。
 */

/** 只有管理員（admin）或總團可以用 */
function requireStaffManager_(who) {
  var owner = ownerId_();
  var isOwner = !!owner && who.account.accountId === owner;
  if (!isOwner && !who.isCentral) throw new ApiError(ERR.FORBIDDEN, '你沒有權限執行這個操作。');
  return { accountId: who.account.accountId, isOwner: isOwner, isCentral: !!who.isCentral, ownerId: owner };
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
        section: r.section, role: r.role, title: r.title, owner: !!actor.ownerId && r.accountId === actor.ownerId, lineLinked: !!r.lineUserId
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
