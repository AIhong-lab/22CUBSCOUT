/**
 * Service Worker（PWA，SPEC 附錄第 62 點）：讓網站可以「加入主畫面」，並把網頁本身存在手機裡。
 * - 只處理同一個網站的 GET（網頁、圖示、manifest）；呼叫 Google 後端的 API（POST、別的網域）完全不經過這裡，
 *   所以孩子的資料不會被存進快取。
 * - 網頁用「先連網、失敗才用快取」：有網路時永遠拿最新版（git push 後馬上生效），沒網路時至少打得開。
 * - 改了這個檔案要把 VERSION 加 1，舊快取才會清掉。
 */
const VERSION = 'v1';
const CACHE = '22cub-' + VERSION;
const SHELL = ['./', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('22cub-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API 與外部網址：不處理
  if (req.mode === 'navigate') {
    // 網頁本身：先連網，成功就順便更新快取；失敗（沒訊號）才拿快取的版本
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  // 圖示、manifest：先用快取，沒有才連網
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
