// 塩田川ビューア オフライン用
const V = 'sd-viewer-v7';   // ★S33 水際で置く版（datum 5.50）を追加
const CORE = ['./', './index.html', './app.js', './sd_model.json',
              './model.usdz', './model_ground.usdz', './model_bank.usdz', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const same = new URL(req.url).origin === location.origin;
  if (same) {
    // 自分のファイルはキャッシュ優先（現場で電波が無くても開く）
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); return res;
    })));
  } else {
    // three.js（CDN）は取れたら更新、駄目ならキャッシュ
    e.respondWith(fetch(req).then(res => {
      const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); return res;
    }).catch(() => caches.match(req)));
  }
});
