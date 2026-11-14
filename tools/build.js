#!/usr/bin/env node
// 建置工具：
// 1. 產生 gas/SeedData.js（種子資料、晉級條件、預設告知同意文字），讓 setup() 在 GAS 裡讀得到
// 2. 把 gas/*.js 合併成 dist/Code.gs，團長可一次複製貼到 Apps Script 編輯器（不必安裝 clasp）
// 用法：npm run build
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// GAS 載入順序（Logic 最先，Setup 最後）
const ORDER = ['Logic.js', 'Config.js', 'SeedData.js', 'Db.js', 'Auth.js', 'Api.js', 'Webhook.js', 'Menu.js', 'Setup.js'];

function buildSeedData() {
  const itemsCsv = read('data/items.csv');
  // 晉級條件：取 SPEC 第十二節「進程晉級條件」清單
  const spec = read('docs/SPEC.md');
  const sec = spec.slice(spec.indexOf('### 進程晉級條件'), spec.indexOf('### 進程項目'));
  const rules = {};
  for (const line of sec.split('\n')) {
    const m = /^- (羚羊|狼|鹿|豹)：(.+)$/.exec(line.trim());
    if (m) rules[m[1]] = m[2];
  }
  if (Object.keys(rules).length !== 4) throw new Error('SPEC 第十二節晉級條件應有 4 級');
  // 告知同意文字：取 PRIVACY.md 標記之間的內容
  const priv = read('docs/PRIVACY.md');
  const a = priv.indexOf('<!-- 告知同意文字開始 -->');
  const b = priv.indexOf('<!-- 告知同意文字結束 -->');
  if (a < 0 || b < 0) throw new Error('PRIVACY.md 缺少告知同意文字標記');
  const consentText = priv.slice(a + '<!-- 告知同意文字開始 -->'.length, b).trim();
  return '/**\n * 種子資料（自動產生，請勿手動修改；改 data/items.csv、docs/SPEC.md、docs/PRIVACY.md 後執行 npm run build）\n' +
    ' * 只供 setup() 第一次匯入；匯入後試算表才是唯一來源。\n */\n' +
    'var SEED = ' + JSON.stringify({ itemsCsv, progressRules: rules, consentText }, null, 1) + ';\n';
}

function main() {
  const seed = buildSeedData();
  fs.writeFileSync(path.join(root, 'gas/SeedData.js'), seed);
  const parts = ORDER.map((f) => `// ════════════════ ${f} ════════════════\n` + read('gas/' + f));
  const bundle = '/**\n * 幼童軍進程系統後端（自動產生的合併檔，請勿手動修改）\n' +
    ' * 來源：gas/ 資料夾各檔案。修改後執行 npm run build 重新產生。\n' +
    ' * 部署：整份複製貼到 Apps Script 的「程式碼.gs」（取代原內容）後儲存。\n */\n\n' + parts.join('\n');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/Code.gs'), bundle);
  console.log('已產生 gas/SeedData.js 與 dist/Code.gs');
}

if (require.main === module) main();
module.exports = { buildSeedData, ORDER };
