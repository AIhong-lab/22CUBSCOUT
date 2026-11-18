/**
 * 產生 LINE 圖文選單圖片 docs/line-richmenu.jpg（2500×1686，三欄兩列六格，SPEC 附錄第 49、60 點）
 * 章的圖直接取自 web/index.html（BADGES、triBadge），和網站長得一樣。
 * 用法：node tools/richmenu.js [輸出路徑]
 * 六格的位置要和 gas/RichMenu.js 的 RICH_MENU_AREAS 一致（左上 → 右上 → 左下 → 右下）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'docs/line-richmenu.jpg');

// 從網站取出章的 SVG 產生器
const web = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
const a = web.indexOf('const FLEUR');
const b = web.indexOf('\n', web.indexOf('const triBadge'));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(web.slice(a, b).replace(/^const /gm, 'var ') , ctx);
const svgSize = (s) => s.replace('<svg ', '<svg width="100%" height="100%" ');

// 自己畫的圖示（100×100），不用表情符號，各平台看起來都一樣
const ICON = {
  notice: `<svg viewBox="0 0 100 100" width="100%" height="100%"><rect x="10" y="14" width="80" height="62" rx="9" fill="#C98A4B"/><rect x="16" y="20" width="68" height="50" rx="5" fill="#E8B57A"/>
    <rect x="24" y="28" width="30" height="36" rx="3" fill="#fff" transform="rotate(-5 39 46)"/><rect x="50" y="30" width="26" height="22" rx="3" fill="#FFE27A" transform="rotate(4 63 41)"/>
    <g stroke="#B9C4D6" stroke-width="3" stroke-linecap="round" transform="rotate(-5 39 46)"><path d="M29 40H49M29 48H49M29 56H42"/></g>
    <circle cx="39" cy="31" r="4" fill="#E3101B" /><circle cx="63" cy="33" r="4" fill="#1360B5"/>
    <path d="M30 76L22 90M70 76L78 90" stroke="#9A6534" stroke-width="5" stroke-linecap="round"/></svg>`,
  scout: `<svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="42" fill="#2F9E52"/><circle cx="50" cy="50" r="34" fill="#E9F7EE"/>
    <g transform="translate(50 50) scale(3.1)" fill="#2F9E52"><path d="M0-8C3-5 3-1 0 3C-3-1-3-5 0-8Z"/><path d="M-1 1C-4-4-9-2-7 2C-5 0-3 1-1 3Z"/><path d="M1 1C4-4 9-2 7 2C5 0 3 1 1 3Z"/><rect x="-5" y="3" width="10" height="2.2" rx="1.1"/></g></svg>`,
  calendar: `<svg viewBox="0 0 100 100" width="100%" height="100%"><rect x="10" y="16" width="80" height="74" rx="10" fill="#fff"/><path d="M10 26a10 10 0 0 1 10-10h60a10 10 0 0 1 10 10v12H10Z" fill="#E3101B"/>
    <rect x="27" y="8" width="7" height="18" rx="3.5" fill="#14213D"/><rect x="66" y="8" width="7" height="18" rx="3.5" fill="#14213D"/>
    <g fill="#C9D3E3">${[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => `<rect x="${19 + c * 17}" y="${46 + r * 14}" width="11" height="9" rx="2"/>`).join('')).join('')}</g>
    <rect x="36" y="60" width="11" height="9" rx="2" fill="#F5C21B"/><circle cx="41.5" cy="64.5" r="9" fill="none" stroke="#E3101B" stroke-width="3"/></svg>`,
  fb: `<svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="42" fill="#1877F2"/><path d="M55 86V58h9l2-11H55v-7c0-3 1.5-5.5 6-5.5h5.5V25c-1-.2-4.5-.6-8.5-.6-8.4 0-14 5-14 14.3V47h-9v11h9v28Z" fill="#fff"/></svg>`,
};

const cells = [
  { icon: ICON.notice, t: '公佈欄', s: '最新通知・團集會', bg: '#1F4E9A', fg: '#fff', sub: '#D6E2F7' },
  { icon: svgSize(ctx.BADGES['狼']), t: '進程查詢', s: '羚羊・狼・鹿・豹', bg: '#FFF8E6', fg: '#14213D', sub: '#5B6478' },
  { icon: svgSize(ctx.triBadge('#1360B5', '🧭')), t: '技能章查詢', s: '服務・健身・技巧', bg: '#F5B82E', fg: '#14213D', sub: '#3D2F0A' },
  { icon: ICON.scout, t: '了解幼童軍', s: '我們是誰・怎麼加入', bg: '#FFF8E6', fg: '#14213D', sub: '#5B6478' },
  { icon: ICON.calendar, t: '活動時間', s: '團集會・活動報名', bg: '#E8473B', fg: '#fff', sub: '#FFE1DD' },
  { icon: ICON.fb, t: '22團 FB', s: '活動照片與動態', bg: '#FFF8E6', fg: '#14213D', sub: '#5B6478' },
];

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:2500px;height:1686px;background:#14213D;font-family:"Noto Sans CJK TC","Noto Sans TC","PingFang TC",sans-serif;
  display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:18px;padding:18px}
.c{position:relative;border-radius:48px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;
  box-shadow:inset 0 -14px 0 rgba(0,0,0,.12)}
.c::before{content:"";position:absolute;width:520px;height:520px;border-radius:50%;background:rgba(255,255,255,.14);top:-200px;right:-170px}
.c::after{content:"";position:absolute;width:260px;height:260px;border-radius:50%;background:rgba(0,0,0,.05);bottom:-90px;left:-80px}
.ic{width:340px;height:340px;margin-bottom:34px;position:relative;z-index:1;filter:drop-shadow(0 12px 0 rgba(0,0,0,.13))}
.t{font-size:124px;font-weight:900;letter-spacing:6px;line-height:1.1;position:relative;z-index:1}
.s{font-size:56px;font-weight:700;margin-top:18px;position:relative;z-index:1;letter-spacing:2px}
</style>${cells.map((c) => `<div class="c" style="background:${c.bg}"><div class="ic">${c.icon}</div><div class="t" style="color:${c.fg}">${c.t}</div><div class="s" style="color:${c.sub}">${c.s}</div></div>`).join('')}`;

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 2500, height: 1686 }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.screenshot({ path: out, type: 'jpeg', quality: 86 });
  await br.close();
  const kb = Math.round(fs.statSync(out).size / 1024);
  if (kb > 1000) throw new Error('圖片超過 LINE 上限 1MB：' + kb + 'KB');
  console.log('已產生 ' + out + '（' + kb + 'KB）');
})();
