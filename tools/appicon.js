/**
 * 產生手機桌面的 App 圖示（PWA，SPEC 附錄第 62 點）：web/icons/ 下的 PNG。
 * 圖案用網站內建的 Q 版狼級菱形章（web/index.html 的 BADGES），深藍底，和 LINE 選單同色系。
 * 用法：node tools/appicon.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const a = web.indexOf('const FLEUR');
const b = web.indexOf('\n', web.indexOf('const triBadge'));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(web.slice(a, b).replace(/^const /gm, 'var '), ctx);
const wolf = ctx.BADGES['狼'].replace('<svg ', '<svg width="100%" height="100%" ');

// [檔名, 邊長, 章佔畫面的比例]；maskable 圖示四周會被裁切，章要小一點
const OUT = [['icon-192.png', 192, 0.86], ['icon-512.png', 512, 0.86], ['maskable-512.png', 512, 0.66], ['apple-touch-icon.png', 180, 0.84]];

(async () => {
  const br = await chromium.launch();
  for (const [name, size, ratio] of OUT) {
    const p = await br.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(`<!doctype html><style>*{margin:0}body{width:${size}px;height:${size}px;display:grid;place-items:center;
      background:radial-gradient(circle at 50% 38%,#24407a 0%,#14213D 72%)}div{width:${size * ratio}px;height:${size * ratio}px;filter:drop-shadow(0 ${size * 0.02}px 0 rgba(0,0,0,.25))}</style><div>${wolf}</div>`);
    await p.screenshot({ path: path.join(root, 'web/icons', name) });
    await p.close();
  }
  await br.close();
  console.log('已產生 web/icons/ 下的 App 圖示');
})();
