// 塩田川ビューア オフライン用
const V = 'sd-viewer-v29';  // ★S68 AR の説明文を Variant 経由かどうかで出し分けた
const CORE = ['./', './index.html', './app.js', './sd_model.json',
              './model.usdz', './model_ground.usdz', './model_bank.usdz', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

// ★S60 ここが今回の肝
//   これまでは すべて「キャッシュを即返して 裏で取り直す」だった。
//   データやモデル（1 MB 近い）には合っているが、★コード（index.html / app.js）には
//   合わない。直しても 端末では 前の版が出続け、しかも何回開き直せば入れ替わるのか
//   誰にも分からなかった（現に v19・v20 が現場に届かなかった）。
//   → ★コードだけ ネット優先（2.5 秒で諦めてキャッシュ）に変えた。
//     現場で圏外でも キャッシュに落ちるので これまでどおり動く。
const CODE = /(^|\/)(index\.html)?$|\/app\.js$/;

const TIMEOUT = 2500;

self.addEventListener('install', e => {
  // ★addAll は ブラウザの HTTP キャッシュを迂回させる（cache:'reload'）
  e.waitUntil(caches.open(V)
    .then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ネット優先。TIMEOUT を過ぎたら キャッシュを返し、ネットが返ったら裏で入れ替える
function netFirst(req) {
  return new Promise(resolve => {
    let done = false;
    const give = (r) => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => { caches.match(req).then(give); }, TIMEOUT);
    fetch(req, { cache: 'no-store' }).then(res => {
      clearTimeout(timer);
      caches.open(V).then(c => c.put(req, res.clone()));
      give(res);
    }).catch(() => {
      clearTimeout(timer);
      caches.match(req).then(r => give(r || new Response('', { status: 504 })));
    });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  if (same) {
    if (req.mode === 'navigate' || CODE.test(url.pathname)) {
      e.respondWith(netFirst(req));            // ★コードは ネット優先
      return;
    }
    // データ・モデルは これまでどおり キャッシュ優先＋裏で取り直す
    e.respondWith(caches.match(req).then(r => {
      const net = fetch(req).then(res => {
        const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); return res;
      }).catch(() => r);
      return r || net;
    }));
  } else {
    // three.js（CDN）は 取れたら更新、駄目ならキャッシュ
    e.respondWith(fetch(req).then(res => {
      const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); return res;
    }).catch(() => caches.match(req)));
  }
});
