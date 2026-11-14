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
