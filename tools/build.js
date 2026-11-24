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
// 要匯入的其他分團進程（data/sections/<分團>.csv；稚齡 2026-11-23 團長確認已核對）
const SEED_SECTIONS = ['稚齡'];
const ORDER = ['Logic.js', 'Config.js', 'SeedData.js', 'Db.js', 'Auth.js', 'Api.js', 'Menu.js', 'AdminApi.js', 'TeamApi.js', 'EventApi.js', 'ItemsAdmin.js', 'StaffApi.js', 'Notify.js', 'Backup.js', 'Webhook.js', 'RichMenu.js', 'Setup.js'];

function buildSeedData() {
  const itemsCsv = read('data/items.csv');
  const detailsCsv = read('data/details.csv');
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
  // 其他分團的進程與章（附錄第 77 點）：已由該分團團長核對、要匯入的分團才放進來
  const sections = {};
  const unitCsv = read('data/sections/級別與章說明.csv').trim().split('\n').slice(1).map((l) => l.split(','));
  for (const sec of SEED_SECTIONS) {
    const progressRules = {};
    for (const r of unitCsv) if (r[0] === sec && r[2] === '進程') progressRules[r[1]] = r.slice(4).join(',').replace(/進程內容：\s*$/, '').trim();
    sections[sec] = { itemsCsv: read('data/sections/' + sec + '.csv'), progressRules };
  }
  return '/**\n * 種子資料（自動產生，請勿手動修改；改 data/items.csv、data/details.csv、docs/SPEC.md、docs/PRIVACY.md 後執行 npm run build）\n' +
    ' * 只供 setup() 第一次匯入；匯入後試算表才是唯一來源。\n */\n' +
    'var SEED = ' + JSON.stringify({ itemsCsv, detailsCsv, progressRules: rules, consentText, sections }, null, 1) + ';\n';
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
  // 網頁也可以直接由 GAS 提供：把 web/index.html 原樣複製成 dist/Index.html，貼到 Apps Script 的 HTML 檔「Index」
  // 由 GAS 提供時拿掉內容安全政策那一行（GAS 自己的框架需要載入 Google 的程式）
  fs.writeFileSync(path.join(root, 'dist/Index.html'), read('web/index.html').split('\n').filter((l) => !l.includes('http-equiv="Content-Security-Policy"')).join('\n'));
  console.log('已產生 gas/SeedData.js、dist/Code.gs 與 dist/Index.html');
}

if (require.main === module) main();
module.exports = { buildSeedData, ORDER, SEED_SECTIONS };
