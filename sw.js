// 塩田川ビューア オフライン用
const V = 'sd-viewer-v12';  // ★S42 実測Zをデータ既定に
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
    // ★S41 キャッシュを即返しつつ、裏で取り直してキャッシュを更新する
    //   （旧：キャッシュ優先のみ。sw.js の版を上げ忘れると 古いモデルが出続けた）
    e.respondWith(caches.match(req).then(r => {
      const net = fetch(req).then(res => {
        const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); return res;
      }).catch(() => r);
      return r || net;        // キャッシュがあれば即返す。次に開いたときに新しくなる
    }));
  } else {
    // three.js（CDN）は取れたら更新、駄目ならキャッシュ
    e.respondWith(fetch(req).then(res => {
      const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); return res;
    }).catch(() => caches.match(req)));
  }
});
