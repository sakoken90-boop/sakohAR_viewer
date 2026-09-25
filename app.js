// 塩田川 その4 左岸 完成形ビューア
//   世界座標は Y-up：world = (東, 標高, −北)。モデル座標は (東, 北, 標高)。
//   東 = w.x ／ 北 = −w.z ／ 標高 = w.y
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const F = (v, n = 3) => v.toFixed(n);

let M = null;                     // sd_model.json
let renderer, scene, camera, controls, raycaster;
let arRoot, zup, root;            // arRoot > zup(Z-up→Y-up) > root(モデル)
const meshes = {};                // 名前 → Mesh / LineSegments
const matsFace = [], matsStr = [];
let stakeGrp, axisLine, markGrp;
const APP_V = 38;

// ★S66 iPhone / iPad で 鋲基準の AR を使うための逃げ道（Variant Launch）
//   iOS の Safari は WebXR（immersive-ar）を持たないので、既定では
//   AR Quick Look（USDZ・下端が床基準）で開いている。
//   Variant Launch は ★App Clip の中で 本物の WebXR を注入するしくみで、
//   hit-test／dom-overlay／anchors とも対応している（Release 扱い）。
//   → ★キーを入れて 目を入れたときだけ そちらへ回す。
//     キーが無ければ 何も読み込まず、従来どおり Quick Look で開く。
//     ★Android には いっさい影響しない。
//   ★S67 SDK キーを埋め込んだ（launchar.app の Developer 枠）。
//     このキーは ★ドメインに紐づく公開キー で、ブラウザに読ませる前提のもの。
//     公開リポジトリに入るが、登録したドメイン以外では使えない。
//     ★スクリプトの読み込みに redirect=true は付けない。
//       付けると iOS の人が ページを開いた瞬間に Launch Card へ飛ばされてしまい、
//       3D を見たいだけのときに 邪魔になる。★AR を押したときだけ飛ばす。
const VL_KEY = 'FGPbJOgFWENTTF9nLyeQzsHPDZFUYmGo';
const VKEY = 'sd_vlkey', VON = 'sd_vlon';
const vlKey = () => { try { return localStorage.getItem(VKEY) || VL_KEY; } catch (e) { return VL_KEY; } };
// ★キーが埋め込んであれば 既定で「入」。端末で切ることもできる
const vlOn  = () => {
  try { const v = localStorage.getItem(VON); if (v !== null) return v === '1'; } catch (e) {}
  return !!VL_KEY;
};
// ★この端末は AR Quick Look 行きか（＝WebXR が無い iPhone / iPad か）
//   initAR() と 設定パネルの両方から見るので 関数にしてある
function isQuickLook() {
  if (navigator.xr) return false;                 // WebXR があれば そちら
  const a = document.createElement('a');
  return !!(a.relList && a.relList.supports && a.relList.supports('ar'));
}
// SDK は ★使うときにだけ 読み込む（未設定なら 通信もしない）
//
// ★S69 ここに 間違いがあった。
//   launchar.app/sdk/v1 は ★読み込み終わった時点（onload）では
//   まだ window.VLaunch を作っていない。中で 非同期に初期化して、
//   終わってから ★window に vlaunch-initialized を投げてくる。
//   S67 は onload で window.VLaunch を見ていたので ★必ず空振りし、
//   「Variant Launch を開始できませんでした」が 毎回 出ていた。
//   （8 秒の保険も 先に res(false) で片が付いた後なので 効かない）
//   → ★vlaunch-initialized を待つ。
//   detail の中身  launchRequired / webXRStatus / launchUrl / directAppClipUrl
//     webXRStatus  'supported'（もう WebXR が使える＝Variant の中）
//                  'launch-required'（App Clip へ飛ばせば使える）
//                  'unsupported'（この端末では無理）
let vlState = null;                                  // 初期化イベントの中身
function vlLoad() {
  return new Promise((res) => {
    if (window.VLaunch && window.VLaunch.getLaunchUrl) return res({ ok: true, why: '' });
    const k = vlKey(); if (!k) return res({ ok: false, why: 'SDK キーが入っていません。' });
    let done = false;
    const fin = (r) => { if (!done) { done = true; res(r); } };
    const ready = () => !!(window.VLaunch && window.VLaunch.getLaunchUrl);

    // ★本命　初期化の知らせを待つ
    window.addEventListener('vlaunch-initialized', (ev) => {
      vlState = (ev && ev.detail) || {};
      // ★S71 getLaunchUrl が生えていなくても、知らせの中に 飛び先があれば 進める
      const usable = ready() || !!(vlState.launchUrl || vlState.directAppClipUrl);
      fin(usable
        ? { ok: true, why: '', detail: vlState }
        : { ok: false, why: '初期化はされましたが 飛び先が ありませんでした。', detail: vlState });
    }, { once: true });

    const sc = document.createElement('script');
    sc.src = 'https://launchar.app/sdk/v1?key=' + encodeURIComponent(k);
    // ★読み込めなかった：通信が切れている／キーが違う／ドメインが弾かれた
    sc.onerror = () => fin({ ok: false,
      why: 'SDK を読み込めませんでした。通信 または SDK キーを確かめてください。' });
    document.head.appendChild(sc);
    // ★S72 ここが S71 の間違い。
    //   以前は「window.VLaunch が生えたら すぐ ok」にしていたが、
    //   ★VLaunch は 知らせ（vlaunch-initialized）より 先に生える。
    //   その時点の getLaunchUrl は ★まだ中身が揃っておらず 呼ぶと止まる。
    //   現場のお知らせ「知らせ なし／getLaunchUrl あり」が まさにこれ。
    //   → ★知らせを 最優先で待つ。来なかったときだけ ダメ元で VLaunch を使う
    setTimeout(() => {
      if (ready()) fin({ ok: true, why: '', late: true });   // ★知らせは来なかったが 物はある
      else fin({ ok: false,
        why: 'SDK が初期化されませんでした。\n'
           + 'launchar.app の管理画面で ドメイン\n  sakoken90-boop.github.io\n'
           + 'が登録されているか 確かめてください（★省略なしの全部）。' });
    }, 8000);
  });
}

// ★S73 ここが 見落としだった。
//   Variant のビューア（App Clip）の中でも、★ページが SDK を読み込まなければ
//   navigator.xr は 生えない（★WebXR を注いでいるのは SDK 自身）。
//   S66 で「SDK は 押したときだけ読む」ようにしたせいで、開き直した先では
//   xr が無いまま → isQuickLook() が true → AR を押しても Quick Look に回り、
//   App Clip の中では USDZ も開かないので ★「無反応」に見えていた。
//   → ★?vlxr=1 が付いていたら 開いた時点で SDK を読み、xr が生えるのを待つ。
function isVlx() {
  try { return new URLSearchParams(location.search).get('vlxr') === '1'; }
  catch (e) { return false; }
}
// ★S74 返ってこない約束に 時間を切る（黙って止まるのを 無くす）
function withTimeout(p, ms, label) {
  return Promise.race([
    Promise.resolve(p),
    new Promise((_, rj) => setTimeout(
      () => rj(new Error('★' + label + 'が ' + (ms / 1000) + ' 秒 返ってきませんでした。')), ms)),
  ]);
}
function waitXR(ms) {
  return new Promise((res) => {
    if (navigator.xr) return res(true);
    const t0 = Date.now();
    const t = setInterval(() => {
      if (navigator.xr) { clearInterval(t); res(true); }
      else if (Date.now() - t0 > ms) { clearInterval(t); res(false); }
    }, 200);
  });
}
// ★Variant のビューアの中で WebXR を用意する
//   一度 駄目だったら ★二度目からは 待たない（押すたびに 8 秒 待たせない）
let vlXRNG = false;
async function vlPrepXR(ms) {
  if (navigator.xr) return true;
  if (vlXRNG) return false;
  await vlLoad();                       // ★SDK を読む＝これが xr を生やす
  const ok = await waitXR(ms || 8000);
  if (!ok) vlXRNG = true;
  return ok;
}

// ★S72 飛び先が作れるまで 粘る（初期化が遅れているだけのことがある）
//   知らせが後から来れば vlState が埋まるので、そこで ②が使えるようになる
function vlTry(ms) {
  return new Promise((res) => {
    const t0 = Date.now();
    const step = () => {
      const g = vlUrl(vlState);
      if (g.url || Date.now() - t0 > ms) return res(g);
      setTimeout(step, 400);
    };
    step();
  });
}

// ★S71 App Clip への飛び先を作る。★道は3通りあるので 順に試す
//   ① getLaunchUrl(いまのURL + ?vlxr=1)   ★開き直したら そのまま AR に入れる
//   ② 知らせの中の launchUrl              いまのページを開き直すだけ（AR は手で押す）
//   ③ directAppClipUrl                    App Clip へ直に（30 分で切れる）
//   S71 まで ①しか見ていなかったので、①が止まると そこで終わっていた
function vlUrl(detail) {
  const out = { url: null, how: '', err: '' };
  try {
    if (window.VLaunch && window.VLaunch.getLaunchUrl) {
      const u = new URL(location.href); u.searchParams.set('vlxr', '1');
      const lu = VLaunch.getLaunchUrl(u.toString());
      if (lu) { out.url = lu; out.how = '①'; return out; }
    }
  } catch (e) { out.err = String((e && e.message) || e); }
  const d = detail || vlState || {};
  if (d.launchUrl)        { out.url = d.launchUrl;        out.how = '②'; return out; }
  if (d.directAppClipUrl) { out.url = d.directAppClipUrl; out.how = '③'; return out; }
  return out;
}
// ★いまの状態を 短く言葉にする（困ったときに 画面から読めるように）
function vlDesc(d) {
  d = d || vlState || {};
  const s = { 'supported': 'もう使える', 'launch-required': 'App Clip が要る',
              'unsupported': 'この端末では無理' }[d.webXRStatus] || '不明';
  return 'WebXR ' + s
       + '／知らせ ' + (vlState ? 'あり' : 'なし')
       + '／getLaunchUrl ' + (window.VLaunch && window.VLaunch.getLaunchUrl ? 'あり' : 'なし')
       + '／launchUrl ' + (d.launchUrl ? 'あり' : 'なし');
}
// ★どの道で飛んだかを 残す（②③のときは 開き直した先で AR を手で押す必要がある）
function vlNote(g, d) {
  try {
    const h = $('hud');
    if (h) h.textContent = 'Variant Launch へ（' + g.how + '）'
         + (g.how === '①' ? '' : '★開いた先で もう一度「AR（実寸）」を押してください')
         + '　' + vlDesc(d);
  } catch (e) {}
}
               // ★S58 画面の副題に出す。★sw.js の版と必ず合わせる
let home = null;                   // ★S58 起動時のカメラ（「全体」で戻る先）
let measureMode = false; const picks = [];
const planes = [new THREE.Plane(), new THREE.Plane()];

// ---------- 部品の並びと既定の表示 ----------
const GROUPS = [
  ['面・舗装',   n => ['完成形_面', '天端舗装', '天端_路肩'].includes(n)],
  ['護岸',       n => ['大型張ブロック', '縦帯コンクリート', '横帯工',
                       '基礎コンクリートブロック', '均しコンクリート', '根固めブロック'].includes(n)],
  ['かごマット', n => n.startsWith('かごマット')],
  ['階段工',     n => n.startsWith('階段_')],
  ['特徴線',     n => n.startsWith('線_')],
];
// ★S35 上のどれにも入らない部品も 必ずチェックボックスを出す（AR基準点など）
const GROUPED = (n) => GROUPS.some(([, test]) => test(n));
const OFF = new Set(['かごマット2段_横断図', 'かごマット3段_横断図',
  '線_大型張ブロック', '線_縦帯コンクリート', '線_基礎コンクリートブロック',
  '線_均しコンクリート', '線_根固めブロック', '線_かごマット2段_平面図',
  '線_かごマット3段_平面図', '線_かごマット2段_横断図', '線_かごマット3段_横断図',
  '線_階段_本体', '線_階段_小口止工', '線_横帯工',
  'AR基準点']);          // ★S30 モデル側のポールは USDZ／SketchUp 用。
                        //    ビューアは app.js が自前で描くので既定 OFF（二重＋視界を塞ぐ）

// ---------- 座標の行き来 ----------
const toWorld = (e, n, z) => new THREE.Vector3(e, z, -n);
const fromWorld = (w) => ({ e: w.x, n: -w.z, z: w.y });

// 点 → 設計追距・離れ（＋が右岸）
function station(e, n) {
  const A = M.axis; let bi = 0, bd = Infinity;
  for (let i = 0; i < A.length; i++) {
    const d = (A[i][1] - e) ** 2 + (A[i][2] - n) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  const a = A[bi], t = a[3];
  const tx = Math.sin(t), ty = Math.cos(t);      // 進行方向（東,北）
  const nx = -Math.cos(t), ny = Math.sin(t);     // 右岸向き
  const de = e - a[1], dn = n - a[2];
  return { s: a[0] + de * tx + dn * ty, off: de * nx + dn * ny, fh: a[4], top: a[5] };
}
// 設計追距 → 現況追距（対照表を線形補間）
function toSv(sd) {
  const K = M.stakes;
  for (let i = 0; i < K.length - 1; i++) {
    if (sd >= K[i].ds && sd <= K[i + 1].ds) {
      const r = (sd - K[i].ds) / (K[i + 1].ds - K[i].ds);
      return K[i].sv + (K[i + 1].sv - K[i].sv) * r;
    }
  }
  return sd < K[0].ds ? K[0].sv + (sd - K[0].ds) : K[K.length - 1].sv + (sd - K[K.length - 1].ds);
}
const noText = (sv) => 'NO.' + Math.floor(sv / 20) + '+' + (sv % 20).toFixed(2).padStart(5, '0');

// ---------- 起動 ----------
init();

async function init() {
  try {
    M = await (await fetch('sd_model.json')).json();
  } catch (err) { $('msg').textContent = 'sd_model.json を読めません：' + err; return; }

  renderer = new THREE.WebGLRenderer({ canvas: $('cv'), antialias: true, alpha: true,
                                       preserveDrawingBuffer: true });   // ★S29 印刷用
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.localClippingEnabled = true;
  renderer.xr.enabled = true;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f5f3);
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 4000);
  raycaster = new THREE.Raycaster();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa2a8, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-0.5, 1, 0.4); scene.add(sun);

  arRoot = new THREE.Group(); scene.add(arRoot);
  zup = new THREE.Group(); zup.rotation.x = -Math.PI / 2; arRoot.add(zup);
  root = new THREE.Group(); zup.add(root);

  buildParts(); buildAxis(); buildStakes(); buildSnap();   // ★S63
  markGrp = new THREE.Group(); root.add(markGrp);

  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(c); controls.enableDamping = true; controls.dampingFactor = 0.12;
  // ★S57 ズームが効かない件
  //   OrbitControls の既定は「注視点（controls.target）に向かって寄る」。
  //   このモデルは 195 m の細長い堤防なので、target が真ん中に居るかぎり
  //   端を見ているときに寄っても 真ん中に引き戻される ＝ 効いていないように見える。
  //   ★zoomToCursor で 指（マウス）の位置に向かって寄るようにする。
  controls.zoomToCursor = true;      // ★S61 指の下にモデルがあるときだけ true にする（aimZoom）
  controls.rotateSpeed = ROT_FAR;    // ★S64 距離に応じて 毎フレーム 付け替える（rotSpeed）
  controls.zoomSpeed = 1.6;          // ホイール・ピンチとも 既定 1.0 より速く
  controls.minDistance = 0.5;        // 寄りすぎて面に埋まるのを止める
  controls.maxDistance = Math.max(600, sz.length() * 4);   // 引きすぎて見失うのを止める
  camera.position.set(c.x + sz.x * 0.35, c.y + sz.length() * 0.28, c.z + sz.length() * 0.45);
  camera.lookAt(c); controls.update();
  home = { pos: camera.position.clone(), target: controls.target.clone() };   // ★S58

  // ★S61 ズームが効かない件（その2）
  //   zoomToCursor は 指の方へ寄るので 狙った所に近づけて具合がよい。
  //   ところが この堤防は 195 m の細い帯なので、★指が空を指していることが多い。
  //   そのとき 何もない方へ寄っていき、モデルは横へ逃げる ＝「ズームが効かない」。
  //   → ★指の下にモデルがあるかを その場で調べて、無ければ 指ではなく
  //     画面まんなかのモデルに向かって寄るように切り替える。
  //   OrbitControls より先に判定したいので ★capture 付きで登録する。
  const dom = renderer.domElement;
  dom.addEventListener('wheel', e => aimZoom(e.clientX, e.clientY), { capture: true, passive: true });
  const act = new Map();
  dom.addEventListener('pointerdown', e => {
    act.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (act.size === 2) {
      const [a, b] = [...act.values()];
      aimZoom((a.x + b.x) / 2, (a.y + b.y) / 2);     // 2本指の中点で判定
    }
  }, { capture: true });
  const drop = e => act.delete(e.pointerId);
  dom.addEventListener('pointerup', drop, { capture: true });
  dom.addEventListener('pointercancel', drop, { capture: true });

  // ★S77 逃げ道　AR 中は ★画面を触っても 合わせられるようにする。
  //   Variant のビューアでは 下のボタンが 見えないことがあるため。
  //   ★1回たたく → ①足元に合わせる ／ ★2回たたく → ②向きを合わせる
  let arTapT = 0;
  dom.addEventListener('pointerdown', () => {
    if (!xrSession) return;
    const now = Date.now();
    if (now - arTapT < 450) { arTapT = 0; $('bHeading').click(); return; }
    arTapT = now;
    setTimeout(() => {
      if (arTapT && Date.now() - arTapT >= 450) { arTapT = 0; $('bPlace').click(); }
    }, 470);
  });

  bindUI(); buildAnchors(); initFit();
  $('sub').textContent = `三角形 ${M.parts.reduce((a, p) => a + p.f.length, 0).toLocaleString()}／`
    + `設計追距 ${M.range.lo.toFixed(3)}〜${M.range.hi.toFixed(3)}`
    + (M.built ? `／★データ ${M.built}` : '')
    + `／★アプリ v${APP_V}`;   // ★S41/S58 どの版を見ているか分かるように
  $('crs').innerHTML = `${M.origin.crs}<br>ローカル原点 X=${M.origin.X0} Y=${M.origin.Y0}<br>${M.origin.note}`;
  $('msg').classList.add('hide');
  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => {
    screenAng = THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || 0);
  });
  renderer.setAnimationLoop(tick);
  initAR();
  // ★S66→S73 Variant のビューアの中で開き直されたときは そのまま AR に入る
  //   ★xr は まだ無い。SDK を読んでから 生えるのを待つ（最大 10 秒）
  try {
    if (isVlx()) {
      hud('現地 AR の準備をしています…（10 秒ほど）');
      vlPrepXR(10000).then((ok) => {
        // ★S74 ここで 自動で押していたのが 間違いだった。
        //   WebXR の immersive セッションは ★人が押した操作からしか 始められない
        //   （user activation が要る）。setTimeout の中の click には それが無く、
        //   requestSession が ★返ってこないまま 止まっていた。
        //   → ★押してもらう。ボタンを目立たせて 案内するだけにする
        if (ok) {
          hud('★準備ができました。上の <b>「AR（実寸）」</b>を押してください。');
          const b = $('bAR'); if (b) { b.classList.add('on'); b.textContent = '▶ AR（実寸）'; }
        }
        else hud('★この画面では WebXR が見つかりませんでした。「AR」を押すと Quick Look で開きます。');
      });
    }
  } catch (e) {}
}

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  sizeLoupe();
}
function tick(time, frame) {
  if (frame) arFrame(frame);
  if (fitOn) fitTick();
  else if (!renderer.xr.isPresenting) { rotSpeed(); controls && controls.update(); }   // ★S64
  sizeMarks();                       // ★S59 計測点を いつも同じ大きさに見せる
  renderer.render(scene, camera);
}

// ---------- モデル ----------
function buildParts() {
  for (const p of M.parts) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(p.v.length * 3);
    p.v.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx = new Uint32Array(p.f.length * 3);
    p.f.forEach((f, i) => { idx[i * 3] = f[0]; idx[i * 3 + 1] = f[1]; idx[i * 3 + 2] = f[2]; });
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({
      color: new THREE.Color(p.rgb[0] / 255, p.rgb[1] / 255, p.rgb[2] / 255),
      side: THREE.DoubleSide, clippingPlanes: [], clipShadows: true,
    });
    (p.name === '完成形_面' || p.name.startsWith('天端') ? matsFace : matsStr).push(m);
    const mesh = new THREE.Mesh(g, m); mesh.name = p.name;
    mesh.userData.part = true;
    mesh.visible = !OFF.has(p.name);
    root.add(mesh); meshes[p.name] = mesh;
  }
  for (const l of M.lines) {
    const pts = [];
    for (const poly of l.p) for (let i = 0; i < poly.length - 1; i++) { pts.push(...poly[i], ...poly[i + 1]); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const m = new THREE.LineBasicMaterial({
      color: new THREE.Color(l.rgb[0] / 255, l.rgb[1] / 255, l.rgb[2] / 255), clippingPlanes: [],
    });
    const o = new THREE.LineSegments(g, m); o.name = l.name; o.visible = !OFF.has(l.name);
    root.add(o); meshes[l.name] = o;
  }
}

function buildAxis() {
  const pts = [];
  for (const a of M.axis) pts.push(a[1], a[2], a[4]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  axisLine = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x2b6cb0, dashSize: 2, gapSize: 1.2 }));
  axisLine.computeLineDistances(); root.add(axisLine);
}

function label(text, sub) {
  const cv = document.createElement('canvas'), s = 2;
  cv.width = 256 * s; cv.height = 96 * s;
  const x = cv.getContext('2d'); x.scale(s, s);
  x.fillStyle = 'rgba(255,255,255,.92)'; x.strokeStyle = '#1b3a5c'; x.lineWidth = 2;
  x.beginPath();
  if (x.roundRect) x.roundRect(4, 4, 248, 60, 8); else x.rect(4, 4, 248, 60);
  x.fill(); x.stroke();
  x.fillStyle = '#16202b'; x.font = 'bold 26px system-ui'; x.textAlign = 'center';
  x.fillText(text, 128, 32);
  x.fillStyle = '#5d6b78'; x.font = '17px system-ui'; x.fillText(sub, 128, 54);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  sp.scale.set(9, 3.4, 1); return sp;
}

function buildStakes() {
  stakeGrp = new THREE.Group(); root.add(stakeGrp);
  for (const k of M.stakes) {
    const z = (k.z || 5) + 6.5;
    const sp = label(k.sv_no.replace('+00.000', '').replace(/\+0?/, '+'), '設計 ' + k.ds.toFixed(2));
    sp.position.set(k.x, k.y, z); stakeGrp.add(sp);
    const g = new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(k.x, k.y, k.z || 5), new THREE.Vector3(k.x, k.y, z - 1.6)]);
    stakeGrp.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x2b6cb0 })));
  }
}

// ---------- UI ----------
function allMats() { return [...matsFace, ...matsStr, ...Object.values(meshes).map(o => o.material)]; }

function bindUI() {
  const box = $('parts');
  for (const [gname, test] of GROUPS.concat([['その他', n => !GROUPED(n)]])) {
    const names = Object.keys(meshes).filter(test);
    if (!names.length) continue;
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = gname; box.appendChild(h);
    for (const n of names) {
      const o = meshes[n];
      const row = document.createElement('div'); row.className = 'row';
      const col = o.material.color;
      row.innerHTML = `<label><input type="checkbox" ${o.visible ? 'checked' : ''}>
        <span class="sw" style="background:#${col.getHexString()}"></span><span>${n}</span></label>`;
      row.querySelector('input').onchange = (ev) => { o.visible = ev.target.checked; };
      box.appendChild(row);
    }
  }
  // ★S58 ズームのボタン。ピンチ／ホイールが効かない端末でも これなら確実に寄れる
  const zoomBy = (f) => {
    const off = camera.position.clone().sub(controls.target);
    const d = Math.min(Math.max(off.length() * f, controls.minDistance), controls.maxDistance);
    camera.position.copy(controls.target).add(off.setLength(d));
    controls.update();
  };
  $('zmIn').onclick = () => zoomBy(0.6);     // 1回で 40% 寄る
  $('zmOut').onclick = () => zoomBy(1 / 0.6);
  $('zmFit').onclick = () => {
    if (!home) return;
    camera.position.copy(home.pos); controls.target.copy(home.target); controls.update();
    hud('');
  };

  // ★S60 最新に更新（キャッシュと Service Worker を消して読み直す）
  //   キャッシュが入れ替わらないときの 逃げ道。localStorage は触らないので
  //   現地で入れた基準点の標高は残る。
  if ($('bUpdate')) $('bUpdate').onclick = async () => {
    $('bUpdate').textContent = '更新しています…';
    try {
      if (window.caches) {
        const ks = await caches.keys();
        await Promise.all(ks.map(k => caches.delete(k)));
      }
      if (navigator.serviceWorker) {
        const rs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(rs.map(r => r.unregister()));
      }
    } catch (e) {}
    location.reload();
  };

  $('bAll').onclick = () => setAll(true);
  $('bNone').onclick = () => setAll(false);
  $('bPanel').onclick = () => { $('sheet').classList.toggle('open'); $('bPanel').classList.toggle('on'); };

  const op = (sl, val, mats) => {
    const f = () => {
      const v = sl.value / 100; val.textContent = sl.value;
      for (const m of mats) { m.opacity = v; m.transparent = v < 1; m.depthWrite = v >= 1; m.needsUpdate = true; }
    };
    sl.oninput = f;
  };
  op($('opSurf'), $('opSurfV'), matsFace);
  op($('opStr'), $('opStrV'), matsStr);

  const sl = $('sSlice');
  sl.min = 0; sl.max = M.axis.length - 1; sl.value = Math.floor(M.axis.length / 2);
  sl.oninput = updateSlice; $('cSlice').onchange = updateSlice; $('sThick').oninput = updateSlice;
  updateSlice();

  $('cStakes').onchange = e => { stakeGrp.visible = e.target.checked; };
  $('cAxis').onchange = e => { axisLine.visible = e.target.checked; };
  $('cAnchor').onchange = e => { anchorsOn = e.target.checked; anchorGrp.visible = anchorsOn; };

  $('bMeasure').onclick = () => {
    measureMode = !measureMode; $('bMeasure').classList.toggle('on', measureMode);
    clearMarks();
    hud(measureMode ? ('計測モード：2点をタップしてください。'
        + (snapOn ? '<br><span class="k">★特徴線の節点（法肩・天端・法尻・ブロックの角など）に吸い付きます。'
                    + '外すときは 表示 →「計測」→ スナップ の目を外す</span>' : '')) : '');
  };
  // ★S66 Variant Launch（iOS の鋲基準 AR）の設定
  if ($('cVL')) {
    $('cVL').checked = vlOn();
    $('vlKey').value = vlKey();
    const vlNote = () => {
      if (!isQuickLook()) {                          // Android など では触れない
        $('cVL').disabled = true; $('vlKey').disabled = true; $('vlSave').disabled = true;
      }
    };
    $('cVL').onchange = () => {
      try { localStorage.setItem(VON, $('cVL').checked ? '1' : '0'); } catch (e) {}
      if ($('cVL').checked && !vlKey()) alert('SDK キーを入れて「保存」を押してください。');
      // ★S68 説明文と警告帯を すぐ合わせる
      hud('AR の開き方を切り替えました。画面を開き直すと 説明の表示も変わります。');
      try { swapUsdz(); } catch (e) {}
    };
    $('vlSave').onclick = () => {
      const k = $('vlKey').value.trim();
      try { localStorage.setItem(VKEY, k); } catch (e) {}
      $('vlSave').textContent = k ? '保存した' : '消した';
      setTimeout(() => { $('vlSave').textContent = '保存'; }, 1500);
    };
    vlNote();
  }

  // ★S63 スナップの入／切
  if ($('cSnap')) {
    $('cSnap').checked = snapOn;
    $('cSnap').onchange = () => { snapOn = $('cSnap').checked; };
  }
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
}

function setAll(v) {
  for (const n in meshes) meshes[n].visible = v;
  document.querySelectorAll('#parts input').forEach(i => i.checked = v);
}

function updateSlice() {
  const on = $('cSlice').checked;
  const a = M.axis[+$('sSlice').value];
  const half = (+$('sThick').value / 10) / 2;
  $('sThickV').textContent = (+$('sThick').value / 10).toFixed(1) + 'm';
  const sv = toSv(a[0]);
  $('sSliceV').textContent = on ? `${noText(sv)}` : '—';
  if (on) $('sSliceV').title = '設計追距 ' + a[0].toFixed(3);
  const t = a[3], tx = Math.sin(t), ty = Math.cos(t);
  const nrm = new THREE.Vector3(tx, 0, -ty).normalize();     // 世界系（Y-up）
  const P = toWorld(a[1], a[2], a[4]);
  const A = P.clone().addScaledVector(nrm, -half), B = P.clone().addScaledVector(nrm, half);
  planes[0].setFromNormalAndCoplanarPoint(nrm, A);
  planes[1].setFromNormalAndCoplanarPoint(nrm.clone().negate(), B);
  const list = on ? planes : [];
  for (const n in meshes) meshes[n].material.clippingPlanes = list;
  if (on) hud(`断面 ${noText(sv)}　設計追距 ${a[0].toFixed(3)}　`
    + `計画河床高 ${F(a[4])}　計画堤防高 ${F(a[5])}`);
}

function hud(html) { const h = $('hud'); h.innerHTML = html; h.classList.toggle('show', !!html); }
// ★S58 現地合わせ／AR 中は ズームボタンを隠す（画面を塞がないように）
function zoomUI(on) { const z = $('zoomui'); if (z) z.classList.toggle('hide', !on); }

// ---------- 計測・情報 ----------
let downXY = null;
function onDown(e) { if (renderer.xr.isPresenting) return; downXY = [e.clientX, e.clientY]; }

// ★S57 ダブルタップ（ダブルクリック）で その点を注視点にする
//   zoomToCursor で寄れるようになっても、回転の中心は target のままなので、
//   端の方を見ているときに回すと 大きく振られる。見たい所を target に移せば
//   その場で回せて そこを中心に寄れる。
let lastTap = 0, lastTapXY = [0, 0];
function reTarget(p) {
  raycaster.setFromCamera(p, camera);
  const tg = Object.values(meshes).filter(o => o.visible && o.isMesh);
  const hit = raycaster.intersectObjects(tg, false)[0];
  if (!hit) return false;
  controls.target.copy(hit.point);
  controls.update();
  hud('ここを中心にしました。この点に向かって回転・ズームできます。');
  return true;
}

function onUp(e) {
  if (renderer.xr.isPresenting || !downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null;
  if (moved > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1,
                              -((e.clientY - r.top) / r.height) * 2 + 1);
  if (fitOn) { record(p); return; }        // 現地合わせ中は「狙い」の記録
  // ★S57 計測中でなければ、ダブルタップを 注視点の移動として拾う
  if (!measureMode) {
    const now = performance.now();
    const near = Math.hypot(e.clientX - lastTapXY[0], e.clientY - lastTapXY[1]) < 24;
    if (now - lastTap < 350 && near) { lastTap = 0; if (reTarget(p)) return; }
    lastTap = now; lastTapXY = [e.clientX, e.clientY];
  }
  raycaster.setFromCamera(p, camera);
  const targets = Object.values(meshes).filter(o => o.visible && o.isMesh);
  const hits = raycaster.intersectObjects(targets, false);
  // ★S63 計測中は まず 特徴線の節点／線上に吸い付く（面より優先）
  const sn = measureMode ? findSnap(e.clientX - r.left, e.clientY - r.top) : null;
  if (!sn && !hits.length) { if (!measureMode) hud(''); return; }
  let m, src;
  if (sn) {
    m = sn.m; src = `★${sn.kind}　${sn.name.replace(/^線_/, '')}`;
  } else {
    const w = hits[0].point.clone(); root.worldToLocal(w);   // モデル座標へ
    m = { e: w.x, n: w.y, z: w.z }; src = hits[0].object.name;
  }
  const st = station(m.e, m.n);
  const sv = toSv(st.s);
  const info = `<b>${noText(sv)}</b>　離れ <span class="mono">${F(Math.abs(st.off))}</span> m`
    + `（${st.off < 0 ? '左岸' : '右岸'}）　標高 <span class="mono">${F(m.z)}</span> m`
    + `<br><span class="k">設計追距 ${F(st.s)}／${src}`
    + `／実座標 X=${F(m.n + M.origin.X0)} Y=${F(m.e + M.origin.Y0)}</span>`;
  if (!measureMode) { hud(info); return; }
  picks.push({ m, st, sv, src });
  mark(m, !!sn);
  if (picks.length === 1) { hud(info + '<br>2点目をタップしてください。'); return; }
  const a = picks[0].m, b = picks[1].m;
  const dh = Math.hypot(b.e - a.e, b.n - a.n), dz = b.z - a.z;
  hud(`<b>計測</b>　水平 <span class="mono">${F(dh)}</span> m　`
    + `比高 <span class="mono">${dz >= 0 ? '+' : ''}${F(dz)}</span> m　`
    + `斜距離 <span class="mono">${F(Math.hypot(dh, dz))}</span> m`
    + `<br><span class="k">① ${noText(picks[0].sv)} 離れ ${F(Math.abs(picks[0].st.off))} 標高 ${F(a.z)}　${picks[0].src}`
    + `<br>② ${noText(picks[1].sv)} 離れ ${F(Math.abs(picks[1].st.off))} 標高 ${F(b.z)}　${picks[1].src}</span>`);
  picks.length = 0;
  setTimeout(clearMarks, 6000);
}
// ★S63 計測のスナップ（特徴線の 節点 と 線上）
//   特徴線の節点は そのまま ★出来形計測対象点（法肩・天端頂点・天端外縁・法尻…
//   張ブロックや基礎の角）なので、そこに吸い付けば 手で狙うより ずっと正確に測れる。
//   面をそのまま拾うと 三角形のどこか になり、0.01 m 単位で ばらつく。
let snapOn = true;
let SNAP = null;         // {p: Float32Array(xyz…), li: Int32Array(線の番号), end: Uint8Array, names: []}
const SNAP_PX = 22;      // 節点に吸い付く画面上の半径（px）
const SNAP_LPX = 14;     // 線に吸い付く半径（px）

function buildSnap() {
  const xs = [], li = [], en = [], names = [];
  M.lines.forEach((l, k) => {
    names.push(l.name);
    for (const poly of l.p) {
      for (let i = 0; i < poly.length; i++) {
        xs.push(poly[i][0], poly[i][1], poly[i][2]);
        li.push(k); en.push(i === 0 || i === poly.length - 1 ? 1 : 0);
      }
    }
  });
  SNAP = { p: new Float32Array(xs), li: Int32Array.from(li), end: Uint8Array.from(en), names };
}

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3();
let _sw = 0, _sh = 0;      // ★画面の大きさは findSnap の頭で1回だけ読む
// 画面座標（px）に落とす。カメラの後ろなら null
//   ★getBoundingClientRect() をここで呼ぶと 1万回のレイアウト読み取りになって
//     端末で固まる。必ず外で読んで _sw/_sh に入れておくこと
function toScreen(v, out) {
  _s3.copy(v).applyMatrix4(root.matrixWorld);
  const cam = _s3.distanceTo(camera.position);
  _s3.project(camera);
  if (_s3.z > 1) return null;
  out.x = (_s3.x + 1) / 2 * _sw; out.y = (1 - _s3.y) / 2 * _sh;
  return cam;
}

// 画面の (px,py) に いちばん近い スナップ先を返す
function findSnap(px, py) {
  if (!snapOn || !SNAP) return null;
  const rr = renderer.domElement.getBoundingClientRect();
  _sw = rr.width; _sh = rr.height;
  const vis = SNAP.names.map(n => { const o = meshes[n]; return !!(o && o.visible); });
  const q = new THREE.Vector2();
  const R2 = SNAP_PX * SNAP_PX;
  let best = null;
  const P = SNAP.p;
  for (let i = 0, j = 0; j < P.length; i++, j += 3) {
    if (!vis[SNAP.li[i]]) continue;
    _s1.set(P[j], P[j + 1], P[j + 2]);
    const cam = toScreen(_s1, q);
    if (cam === null) continue;
    const dd = (q.x - px) * (q.x - px) + (q.y - py) * (q.y - py);
    if (dd > R2) continue;
    // ★ほぼ同じ所に重なっているときは 手前の点を選ぶ
    if (!best || dd < best.dd - 36 || (dd < best.dd + 36 && cam < best.cam)) {
      best = { dd, cam, i, name: SNAP.names[SNAP.li[i]], end: SNAP.end[i] };
    }
  }
  if (best) {
    const j = best.i * 3;
    return { m: { e: P[j], n: P[j + 1], z: P[j + 2] },
             kind: best.end ? '端点' : '節点', name: best.name };
  }
  // ★節点が無ければ 線の上（垂線の足）に吸い付く
  const R2L = SNAP_LPX * SNAP_LPX;
  const a = new THREE.Vector2(), b = new THREE.Vector2();
  let bl = null;
  M.lines.forEach((l, k) => {
    const o = meshes[l.name]; if (!o || !o.visible) return;
    for (const poly of l.p) {
      for (let i = 0; i < poly.length - 1; i++) {
        _s1.fromArray(poly[i]); if (toScreen(_s1, a) === null) continue;
        _s2.fromArray(poly[i + 1]); const c2 = toScreen(_s2, b); if (c2 === null) continue;
        const vx = b.x - a.x, vy = b.y - a.y;
        const L2 = vx * vx + vy * vy; if (L2 < 1e-9) continue;
        let t = ((px - a.x) * vx + (py - a.y) * vy) / L2;
        t = Math.max(0, Math.min(1, t));
        const qx = a.x + vx * t, qy = a.y + vy * t;
        const dd = (qx - px) * (qx - px) + (qy - py) * (qy - py);
        if (dd > R2L) continue;
        if (!bl || dd < bl.dd) {
          bl = { dd, name: l.name,
                 m: { e: poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t,
                      n: poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t,
                      z: poly[i][2] + (poly[i + 1][2] - poly[i][2]) * t } };
        }
      }
    }
  });
  return bl ? { m: bl.m, kind: '線上', name: bl.name } : null;
}

// ★S64 回転が速すぎる件（とくに寄っているとき）
//   OrbitControls の回転は「画面の高さいっぱいのドラッグ ＝ 約180°」で、
//   ★カメラが近いか遠いかに関係なく 同じ角度だけ回る。
//   寄っているときは 画面に写る範囲が狭いので、同じ角度でも 振れ幅が大きく感じる。
//   → ★注視点までの距離で 回転の速さを変える。
//   速さを変えたいときは 下の3つの数字だけ直せばよい。
const ROT_FAR  = 0.60;   // 引いているとき（既定の 1.0 より遅い）
const ROT_NEAR = 0.15;   // 寄っているとき（引いているときの 1/4）
const ROT_D    = 60;     // この距離（m）以上は ROT_FAR のまま
function rotSpeed() {
  if (!controls) return;
  const d = camera.position.distanceTo(controls.target);
  controls.rotateSpeed = ROT_NEAR + (ROT_FAR - ROT_NEAR) * Math.min(1, d / ROT_D);
}

// ★S61 ズームの狙いを決める
const _pt = new THREE.Vector2();
const _vd = new THREE.Vector3();
function pickAt(nx, ny) {
  _pt.set(nx, ny);
  raycaster.setFromCamera(_pt, camera);
  const tg = Object.values(meshes).filter(o => o.visible && o.isMesh);
  return raycaster.intersectObjects(tg, false)[0] || null;
}
function aimZoom(clientX, clientY) {
  if (!controls || !controls.enabled) return;
  const r = renderer.domElement.getBoundingClientRect();
  const nx = ((clientX - r.left) / r.width) * 2 - 1;
  const ny = -((clientY - r.top) / r.height) * 2 + 1;
  if (pickAt(nx, ny)) { controls.zoomToCursor = true; return; }   // 指の下にモデルあり
  // ★指が空を指している → 指には寄らない。注視点を 画面まんなかの奥行きに置き直す
  //   （カメラの向きは変えないので 画面は跳ねない）
  controls.zoomToCursor = false;
  const c = pickAt(0, 0);
  if (c) { controls.target.copy(c.point); return; }
  camera.getWorldDirection(_vd);
  const d = home ? camera.position.distanceTo(home.target) : controls.target.distanceTo(camera.position);
  controls.target.copy(camera.position).addScaledVector(_vd, d);
}

// ★S59 計測のクリック点
//   これまでは 半径 0.35 m（直径 0.70 m）の球を そのまま置いていた。
//   張ブロックの厚みが 0.12 m なので 寄るほど 球で狙った点が隠れる。
//   ★画面上の大きさを一定（半径 MARK_PX ピクセル）にして、寄っても大きくならないようにした。
const MARK_PX = 4.5;            // 画面上の半径（ピクセル）。直径 9 px くらいの点
function mark(m, snapped) {
  // ★S63 スナップしたときは 水色の点にして 吸い付いたことが分かるようにする
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: snapped ? 0x0aa3c2 : 0xd23b2f, depthTest: false }));
  s.position.set(m.e, m.n, m.z); s.renderOrder = 9; markGrp.add(s);
  sizeMarks();
}
// ★毎フレーム 大きさを直す（カメラからの距離に比例させる）
const _mp = new THREE.Vector3();
function sizeMarks() {
  if (!markGrp || markGrp.children.length === 0) return;
  const H = (renderer.domElement.clientHeight || innerHeight);
  const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / H * MARK_PX;
  for (const s of markGrp.children) {
    s.getWorldPosition(_mp);
    s.scale.setScalar(Math.max(0.005, _mp.distanceTo(camera.position) * k));
  }
}
function clearMarks() { while (markGrp.children.length) markGrp.remove(markGrp.children[0]); picks.length = 0; }


// ---------- 現地 AR（実寸・手動で位置合わせ）----------
let xrSession = null, hitSource = null, refSpace = null, reticle = null;
let anchorW = null, heading = 0, zOff = 0, headingBase = 0;

// ★S36 「基準の杭」は AR基準点（鋲）と 測点杭 の両方から選べる
function arPoint() {
  const v = $('anchor').value;
  return v[0] === 'a' ? anchorZ()[+v.slice(1)] : M.stakes[+v.slice(1)];
}

function initAR() {
  const sel = $('anchor');
  (M.anchors || []).forEach((a, i) => {          // ★鋲を先に並べる
    const o = document.createElement('option');
    o.value = 'a' + i; o.textContent = `★${a.name}（鋲・設計 ${a.ds.toFixed(0)}／離れ ${a.off}）`;
    sel.appendChild(o);
  });
  M.stakes.forEach((k, i) => {
    const o = document.createElement('option');
    o.value = 's' + i; o.textContent = `${k.sv_no.replace('+00.000', '')}（設計 ${k.ds.toFixed(2)}）`;
    sel.appendChild(o);
  });
  sel.selectedIndex = Math.min(3, M.stakes.length - 1);

  const ring = new THREE.RingGeometry(0.10, 0.14, 32).rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x2f6f4e }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

  // iPhone/iPad は AR Quick Look（USDZ）、Android は WebXR に振り分ける
  // ★S66 WebXR がある端末は そちらを使う。
  //   Variant のビューアの中では navigator.xr が生えるので ここで false になり、
  //   そのまま Android と同じ 鋲基準の AR に入る。
  const quickLook = isQuickLook();
  if (quickLook) { $('bAR').textContent = 'AR（実寸）'; }
  // ★S47 この端末で 下の版の選択が効くのかどうかを その場で出す
  // ★S68 Variant Launch を使うときは 下の datum 選択は使わない。
  //   3通りの言い方を きちんと出し分ける（誤解のもとになるため）
  const vlUse = quickLook && vlOn() && vlKey();
  $('uPlat').innerHTML =
    !quickLook
      ? '★この端末は <b>Android など</b>です。AR は <b>WebXR</b>（鋲基準）で開くので、'
        + '<b>下の選択は使いません</b>。全部品が はじめから正しい高さで出ます。'
    : vlUse
      ? '★この端末は <b>iPhone / iPad</b> です。いまは <b>Variant Launch 経由の WebXR</b>'
        + '（鋲基準）で開く設定なので、<b>下の選択は使いません</b>。'
        + '全部品が はじめから正しい高さで出ます。<br>'
        + '※ Quick Look に戻したいときは 下の「AR（iPhone / iPad・実験）」の目を外してください。'
      : '★この端末は <b>iPhone / iPad</b> です。AR（実寸）は <b>Quick Look</b> で開くので、'
        + '下の選択が効きます。';

  $('bAR').onclick = async () => {
    // ★S73 押すたびに 見直す。Variant のビューアの中では
    //   SDK を読んだ あとから navigator.xr が生えるので、開いた時の判定を信じない
    if (isVlx() && !navigator.xr) {
      $('bAR').textContent = '準備中…（AR）';
      await vlPrepXR(8000);
      $('bAR').textContent = 'AR（実寸）';
    }
    const ql = isQuickLook();
    if (ql) {
      // ★S73 すでに Variant のビューアの中なら もう飛ばさない（堂々めぐりになる）
      if (isVlx()) {
        alert('この画面では 現地 AR（WebXR）が用意できませんでした。\n'
            + 'このまま Quick Look（下端が床基準）で開きます。');
        $('arq').click(); return;
      }
      // ★S66 目が入っていて キーがあれば Variant Launch の App Clip へ回す
      if (vlOn() && vlKey()) {
        $('bAR').textContent = '準備中…';
        const r = await vlLoad();                     // ★S69 待ち方を直した
        $('bAR').textContent = 'AR（実寸）';
        let why = r.why;
        const d = r.detail || vlState || {};
        if (r.ok) {
          // ★この端末が そもそも対象外なら 素直に Quick Look へ（黙って回す）
          if (d.webXRStatus === 'unsupported') {
            $('arq').click(); return;
          }
          // ★S71 飛び先は 3通りある。1つ目で止まっても 次を試す
          // ★S72 まだ初期化の途中のことがあるので 最大 6 秒 粘る
          $('bAR').textContent = '準備中…（飛び先）';
          const g = await vlTry(6000);
          $('bAR').textContent = 'AR（実寸）';
          if (g.url) { vlNote(g, vlState || d); location.href = g.url; return; }
          why = g.err
            ? '飛び先を作るときに止まりました：' + g.err
            : '飛び先（launchUrl）が どの道でも作れませんでした。';
        }
        alert('Variant Launch を開始できませんでした。\n'
            + (why ? '\n' + why + '\n' : '')
            + '\n状態：' + vlDesc(vlState || d)
            + '\n\nこのまま Quick Look で開きます。');
      }
      $('arq').click(); return;                       // iOS：Quick Look で 1:1 配置
    }
    if (xrSession) { xrSession.end(); return; }
    if (!navigator.xr) { alert('この端末／ブラウザは現地 AR に未対応です。\niPhone/iPad は Safari で開いてください（AR Quick Look を使います）。\nAndroid は Chrome でお使いください。'); return; }
    // ★S74 返ってこないまま 止まることがあるので ★時間を切る。
    //   黙って止まるのが いちばん困る。必ず 何か出す
    let sup;
    try { sup = await withTimeout(navigator.xr.isSessionSupported('immersive-ar'), 6000, '対応の問い合わせ'); }
    catch (e) { hud(''); alert('現地 AR を始められません。\n' + e.message); return; }
    if (!sup) {
      alert('この端末では現地 AR（immersive-ar）が使えません。\nAndroid では「Google Play開発者サービス（AR）」の更新で使えるようになることがあります。'); return;
    }
    hud('AR を開始しています…');
    // ★S76 startAR の中で 段階ごとに 時間を切ってあり、
    //   しくじったら ★記録をまとめて出す ので、ここで重ねて出さない
    try { await startAR(); }
    catch (e) { hud(''); }
  };
  $('anchor').onchange = () => { if (anchorW) arApply(); };
  const bEnd = $('bAREnd');                      // ★S78 AR用UO の中の 終了ボタン
  if (bEnd) bEnd.onclick = () => { if (xrSession) xrSession.end(); };
  $('arRot').oninput = () => { heading = headingBase + THREE.MathUtils.degToRad(+$('arRot').value); $('arRotV').textContent = (+$('arRot').value).toFixed(1) + '°'; arApply(); };
  $('arZ').oninput = () => { zOff = +$('arZ').value / 100; $('arZV').textContent = zOff.toFixed(2); arApply(); };
  $('bPlace').onclick = () => {
    // ★S77 床の輪郭が出ていれば そこ。出ていなければ ★端末の前 1.5 m・1.2 m 下
    //   （床の検出が効かない場面でも ★必ず 先に進めるようにする）
    let t = null;
    if (reticle.visible) t = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    else t = provPoint(1.5);
    if (!t) { $('arTip').textContent = 'まだ場所が定まりません。少し動かしてから もう一度 押してください。'; return; }
    anchorW = t; arProv = false; arApply();
    $('arTip').textContent = reticle.visible
      ? '置きました。次に、堤防の上流側の地面（できれば別の鋲）に向けて「② 向きを合わせる」を押してください。'
      : '★床が使えないので 足元を 目分量で置きました（精度は落ちます）。次に「② 向きを合わせる」を押してください。';
  };
  $('bHeading').onclick = () => {
    if (!anchorW) { $('arTip').textContent = '先に「① 足元に合わせる」を押してください。'; return; }
    // ★S77 床が無ければ ★いま向いている方向の 5 m 先 を狙った所とみなす
    const tgt = reticle.visible
      ? new THREE.Vector3().setFromMatrixPosition(reticle.matrix)
      : provPoint(5);
    if (!tgt) { $('arTip').textContent = 'まだ向きが定まりません。少し動かしてから もう一度 押してください。'; return; }
    const d = tgt.clone().sub(anchorW); d.y = 0;
    if (d.length() < 0.6) { $('arTip').textContent = 'もう少し離れた地面に向けてください（1 m 以上）。'; return; }
    const k = arPoint();
    const a = nearestAxis(k.ds);
    const tl = new THREE.Vector3(Math.sin(a[3]), 0, -Math.cos(a[3]));   // 上流向き（世界系の向きに直す前）
    headingBase = Math.atan2(d.x, d.z) - Math.atan2(tl.x, tl.z);
    $('arRot').value = 0; $('arRotV').textContent = '0.0°';
    heading = headingBase; arApply();
    $('arTip').textContent = '向きを合わせました。ずれていれば「回転」「高さ」で微調整してください。';
  };
}

function nearestAxis(sd) {
  let b = M.axis[0], bd = Infinity;
  for (const a of M.axis) { const d = Math.abs(a[0] - sd); if (d < bd) { bd = d; b = a; } }
  return b;
}

function arApply() {
  if (!anchorW) return;
  const k = arPoint();
  const pl = new THREE.Vector3(k.x, k.z, -k.y);        // zup 適用後のローカル座標
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  arRoot.quaternion.copy(q);
  arRoot.position.copy(anchorW).sub(pl.clone().applyQuaternion(q));
  arRoot.position.y += zOff;
}

// ★S76 AR 中の見た目を まとめて切り替える。
//   ★これを セッションを始める ★前 に呼ぶのが 肝。
//   Variant の dom-overlay は「root 以外の要素を隠す」まね事で作られていて、
//   ★セッションに入った後の DOM の書き換えが 画面に出ないことがある。
//   実際 S75 で入れた「①カメラの起動…」の表示も ★一度も出なかった。
//   → ★入る前に AR の見た目にしてしまう。しくじったら 戻す。
// ★S78 重ね表示の 入れ物。
//   Variant の dom-overlay は「★root 以外を隠す」まね事なので、
//   ★3D の画（canvas）と AR用UI を ★ひとつの箱に入れて、その箱を root にする。
//   body を root にしていた S77 までは、その子が まるごと隠れていたとみられる
//   （カメラだけ見えて モデルも ボタンも 出なかった）。
function arOverlay(on) {
  try {
    let ov = document.getElementById('arov');
    if (on) {
      if (!ov) { ov = document.createElement('div'); ov.id = 'arov'; document.body.appendChild(ov); }
      ov.appendChild($('cv'));          // ★入れ替え（appendChild は 移動）
      ov.appendChild($('arui'));
      return ov;
    }
    if (ov) { document.body.appendChild($('cv')); document.body.appendChild($('arui')); }
    return null;
  } catch (e) { return null; }
}

function arSkin(on) {
  try {
    arOverlay(on);                       // ★S78 先に 箱に入れる／出す
    document.documentElement.classList.toggle('arx', on);
    document.body.classList.toggle('arx', on);
    try { renderer.setClearAlpha(on ? 0 : 1); } catch (e) {}
    scene.background = on ? null : new THREE.Color(0xf4f5f3);
    controls.enabled = !on; zoomUI(!on);
    if (on) { $('sheet').classList.remove('open'); $('bPanel').classList.remove('on'); }
    $('arui').classList.toggle('show', on);
    // ★AR 中は 書き換えが 画面に出ないことがあるので 案内も ★先に入れておく
    if (on) $('arTip').textContent = '★モデルは まず 目の前 3 m に 仮置きしています。'
      + '基準の杭の所に立って、足元を映しながら「① 足元に合わせる」を押してください。';
    $('bAR').textContent = on ? 'AR終了' : (isQuickLook() ? 'AR（実寸）' : 'AR');
    $('bAR').classList.toggle('on', on);
    stakeGrp.visible = on ? false : $('cStakes').checked;
    hud('');
  } catch (e) {}
}
// ★S76 AR 中は 画面に出せないので 段階を ためておき、終わってから 見せる
let arLog = [];
function arLogShow(head) {
  const t = arLog.join('\n');
  arLog = [];
  if (t) alert(head + '\n\n' + t);
}

async function startAR() {
  // ★S66 Variant のビューアの中では dom-overlay を ★必須にする
  const vlx = isVlx();
  arLog = [];
  const step = (s) => {
    arLog.push(new Date().toLocaleTimeString() + '　' + s);
    hud('AR を開始しています…　' + s);          // ★出れば出るで よい
  };

  step('⓪画面を AR 用にする');
  arSkin(true);
  // ★描き直しを 2 コマ待ってから 入る（切り替えを 確実に 間に合わせる）
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    step('①カメラの起動');
    const session = await withTimeout(navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: vlx ? ['hit-test', 'dom-overlay'] : ['hit-test'],
      optionalFeatures: vlx ? [] : ['dom-overlay'],
      // ★S78 root を ★body から #arui に変えた。
      //   Variant は「root 以外を隠す」まね事なので、body を渡すと
      //   ★body の子（ヘッダー・AR用UI）が まるごと隠れていたとみられる。
      //   先方も「フレームワークが触らない 専用の箱」を root に、と書いている。
      domOverlay: { root: document.getElementById('arov') || document.body },
    }), 20000, '①カメラの起動');
    xrSession = session;

    step('②描画の引き渡し');
    await withTimeout(renderer.xr.setSession(session), 10000, '②描画の引き渡し');

    step('③基準の空間');
    refSpace = null;
    for (const t of ['local', 'local-floor', 'viewer']) {
      try { refSpace = await withTimeout(session.requestReferenceSpace(t), 8000, '③基準の空間（' + t + '）'); step('　→ ' + t + ' が取れた'); break; }
      catch (e) { step('　→ ' + t + ' は駄目'); }
    }
    if (!refSpace) throw new Error('★基準の空間が どれも取れませんでした。');

    step('④床の検出');
    try {
      const viewer = await withTimeout(session.requestReferenceSpace('viewer'), 8000, '④基準（viewer）');
      hitSource = await withTimeout(session.requestHitTestSource({ space: viewer }), 10000, '④床の検出');
      step('　→ 床の検出 ★使える');
    } catch (e) { hitSource = null; step('　→ 床の検出 は使えない（' + ((e && e.message) || e) + '）'); }

    // ★S78 ★arFrame を待たずに ここで 仮置きする。
    //   local の原点は ★セッションを始めた時の端末の位置・向き なので、
    //   (0, -1.2, -3) は「★始めた時の 目の前 3 m・1.2 m 下」になる。
    //   S77 は arFrame の中で置いていたが、それが 呼ばれていない疑いがある
    if (!anchorW) { anchorW = new THREE.Vector3(0, -1.2, -3); arProv = true; arApply(); }

    step('⑤できあがり');
    $('arTip').textContent = hitSource
      ? '床を映して輪郭が出たら「① 足元に合わせる」を押してください。'
      : '★床の検出が使えませんでした。画面の中央が 足元に来るように構えて「① 足元に合わせる」を押してください。';

    // ★S78 ★画面タップは XR の select で拾う。
    //   これは dom-overlay が効いていなくても 必ず届く（WebXR の決まり）。
    //   ★1回 → ①足元に合わせる ／ ★2回（0.6 秒以内）→ ②向きを合わせる
    let selT = 0, selTimer = null;
    session.addEventListener('select', () => {
      const now = Date.now();
      if (now - selT < 600) {
        selT = 0; if (selTimer) { clearTimeout(selTimer); selTimer = null; }
        try { $('bHeading').click(); } catch (e) {}
        return;
      }
      selT = now;
      selTimer = setTimeout(() => { selTimer = null; selT = 0;
        try { $('bPlace').click(); } catch (e) {} }, 620);
    });

    session.addEventListener('end', () => {
      arSkin(false);                                  // ★S76 見た目を 戻す
      xrSession = null; hitSource = null; reticle.visible = false;
      viewerPos = null; viewerFwd = null; arProv = false;   // ★S77
      arRoot.position.set(0, 0, 0); arRoot.quaternion.identity();
      anchorW = null; heading = 0; headingBase = 0; zOff = 0;
      $('arRot').value = 0; $('arZ').value = 0;
      // ★AR 中は 画面に出せなかったので ここで まとめて見せる
      arLogShow('★AR の記録（うまく行った分も含みます）');
    });
  } catch (e) {
    arSkin(false);                                    // ★しくじったら 戻す
    step('★止まった：' + ((e && e.message) || e));
    arLogShow('★AR を開始できませんでした。どこまで進んだか：');
    throw e;
  }
}

// ★S77 端末（カメラ）の いまの位置と 向き。AR に入った直後の ★仮置き に使う
let viewerPos = null, viewerFwd = null, arProv = false;
// ★仮に置く場所　前方 d m ・ 1.2 m 下（＝だいたい 足元）
function provPoint(d) {
  if (!viewerPos || !viewerFwd) return null;
  const p = viewerPos.clone().addScaledVector(viewerFwd, d);
  p.y = viewerPos.y - 1.2;
  return p;
}

function arFrame(frame) {
  if (!refSpace) return;
  // ★S77 端末の位置・向きを 毎コマ 取っておく（床の検出が使えなくても これは取れる）
  const vp = frame.getViewerPose(refSpace);
  if (vp) {
    const m = new THREE.Matrix4().fromArray(vp.transform.matrix);
    viewerPos = (viewerPos || new THREE.Vector3()).setFromMatrixPosition(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    f.y = 0; if (f.lengthSq() < 1e-6) f.set(0, 0, -1); f.normalize();
    viewerFwd = (viewerFwd || new THREE.Vector3()).copy(f);
    // ★S77 まだ合わせていない間は 前方 3 m に ★仮置き して ★とにかく見えるようにする
    //   （これが無いと AR に入った直後 モデルが どこにあるか 分からない）
    if (!anchorW) {
      const p = provPoint(3);
      if (p) { anchorW = p; arProv = true; arApply(); }
    }
  }
  if (!hitSource) { reticle.visible = false; return; }
  const hits = frame.getHitTestResults(hitSource);
  if (hits.length) {
    const pose = hits[0].getPose(refSpace);
    reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix);
  } else reticle.visible = false;
}


// ================= 現地合わせ（カメラ重ね）=================
//   立っている基準点は測量で出した既知点なのでカメラ位置は確定。
//   姿勢は端末の重力センサ（上下・傾きは正確、方位だけ当てにならない）。
//   ★画面中央の十字に別の基準点を重ねて記録すると、
//     「その向きがちょうどその点を向く」ように姿勢を補正する。
//     十字で合わせるので画角に関係なく厳密に決まる（検算で誤差 0.000°）。
//   ※基準点6点はほぼ一直線に並ぶ（開き角 2〜5°）ので、画角は解けない。
//     画角は一度スライダーで合わせれば端末ごとに保存する。
let fitOn = false, fitStream = null, fitQ = new THREE.Quaternion();
let corr = new THREE.Quaternion();      // 姿勢の補正
let yawTrim = 0, pitchTrim = 0, fovCal = 65, screenAng = 0;
// （S29：単発の記録は shots[] に統合した）
let anchorGrp = null;
const ZKEY = 'sd_anchor_z', FKEY = 'sd_fov';

function anchorZ() {
  let ov = {};
  try { ov = JSON.parse(localStorage.getItem(ZKEY) || '{}'); } catch (e) {}
  // ★S42 既定は a.z（AR基準点_実測Z.csv で作り直せば その値。無ければ計画値）
  //   端末ごとの上書き（localStorage）があれば そちらが優先
  return M.anchors.map(a => ({ ...a, z: (ov[a.name] != null ? +ov[a.name] : (a.z != null ? a.z : a.z_plan)) }));
}

function buildAnchors() { anchorGrp = new THREE.Group(); root.add(anchorGrp); redrawAnchors(); }
let fitSkip = null;      // ★S30 現地合わせ中、立っている点のポールは描かない
let anchorsOn = true;    // ★S35 AR基準点（ポール＋名前）の表示
function redrawAnchors() {
  while (anchorGrp.children.length) anchorGrp.remove(anchorGrp.children[0]);
  for (const a of anchorZ()) {
    if (fitSkip && a.name === fitSkip) continue;   // ★カメラがこの中に入るので隠す
    const h = 2.0;
    const g = new THREE.CylinderGeometry(0.035, 0.035, h, 8).rotateX(Math.PI / 2).translate(a.x, a.y, a.z + h / 2);
    anchorGrp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd23b2f })));
    // ★S37 合わせ十字（地面に置く十字の的）。USDZ に入れているものと同じ形
    const L = (a.name === 'AR1' ? 3.0 : 2.0), tn = nearestAxis(a.ds)[3];
    const mt = new THREE.MeshBasicMaterial({ color: 0xe61ea0 });
    for (const rot of [0, Math.PI / 2]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(L, 0.04, 0.01), mt);
      b.position.set(a.x, a.y, a.z + 0.005);
      b.rotation.z = -tn + rot;          // モデル座標は (東,北)。接線方位に合わせる
      anchorGrp.add(b);
    }
    const sp = label(a.name, a.z.toFixed(3) + ' m');
    sp.position.set(a.x, a.y, a.z + h + 1.2); sp.scale.set(6, 2.3, 1);
    anchorGrp.add(sp);
  }
  anchorGrp.visible = anchorsOn;      // ★S35 描き直しても表示状態を保つ
}

const camPos = () => {
  const A = anchorZ().find(x => x.name === $('fitAt').value) || anchorZ()[0];
  return toWorld(A.x, A.y, A.z + (+$('fitEye').value || 1.55));
};
const dirTo = (name) => {
  const a = anchorZ().find(x => x.name === name);
  return toWorld(a.x, a.y, a.z).sub(camPos()).normalize();
};
const FWD = new THREE.Vector3(0, 0, -1);

// ★S29 記録は複数点を溜めて 最小二乗（方位・仰角の平均）で姿勢の補正を作る
//    重力センサで上下・傾きは出ているので、未知なのは方位。仰角の系統ずれも一緒に均す。
const UP = new THREE.Vector3(0, 1, 0);
const shots = [];                       // {target, q, ndc}
const bearing = (v) => Math.atan2(v.x, v.z);
const elev    = (v) => Math.asin(THREE.MathUtils.clamp(v.y, -1, 1));
const wrap    = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 画面上の点（NDC）が指している向き。ndc 省略で画面中央（＝十字）
function shotDir(q, ndc) {
  const d = new THREE.Vector3(0, 0, -1);
  if (ndc) {
    const ty = Math.tan(THREE.MathUtils.degToRad(fovCal) / 2);
    d.set(ndc.x * ty * (innerWidth / innerHeight), ndc.y * ty, -1).normalize();
  }
  return d.applyQuaternion(q);
}

function solveCorr() {
  if (!shots.length) { corr.identity(); return null; }
  let sy = 0, sp = 0; const md = new THREE.Vector3();
  const each = [];
  for (const s of shots) {
    const v0 = shotDir(s.q, s.ndc), d = dirTo(s.target);
    const dy = wrap(bearing(d) - bearing(v0)), dp = elev(d) - elev(v0);
    sy += dy; sp += dp; md.add(d); each.push({ s, dy, dp, d });
  }
  const my = sy / shots.length, mp = sp / shots.length;
  md.normalize();
  const ax = new THREE.Vector3().crossVectors(UP, md).normalize();
  corr.copy(new THREE.Quaternion().setFromAxisAngle(UP, my));
  if (ax.lengthSq() > 1e-9) corr.multiply(new THREE.Quaternion().setFromAxisAngle(ax, -mp));
  // 残差（各点が どれだけ外れているか）
  let worst = 0, wn = '';
  for (const e of each) {
    const v = shotDir(e.s.q, e.s.ndc).applyQuaternion(corr);
    const err = v.angleTo(e.d);
    const L = camPos().distanceTo(anchorWorld(e.s.target));
    if (err > worst) { worst = err; wn = e.s.target; }
    e.err = err; e.L = L;
  }
  return { my, mp, worst, wn, each };
}

function anchorWorld(name) {
  const a = anchorZ().find(x => x.name === name);
  return toWorld(a.x, a.y, a.z);
}

// 十字（またはタップした点）に重ねて記録
function record(ndc) {
  const target = $('fitTo').value;
  const i = shots.findIndex(s => s.target === target);
  const rec = { target, q: fitQ.clone(), ndc: (ndc && ndc.isVector2) ? ndc.clone() : null };
  if (i >= 0) shots[i] = rec; else shots.push(rec);      // 同じ点は上書き
  const r = solveCorr();
  yawTrim = pitchTrim = 0;
  $('fitYaw').value = 0; $('fitYawV').textContent = '0.00°';
  $('fitShots').textContent = `記録 ${shots.length} 点`;
  $('fitState').textContent = shots.length === 1
    ? `${target} で合わせ済` : `${shots.length} 点の平均で合わせ済`;
  if (shots.length === 1) {
    $('fitTip').textContent = `★${target} を記録しました（緑＝記録済）。`
      + '続けて 別の基準点でも「記録」すると 平均が効いて精度が上がります。'
      + '狙う点は 自動で 次に遠い未記録の点に進みます（チップを押せば手で選べます）。';
  } else {
    const deg = THREE.MathUtils.radToDeg(r.worst);
    $('fitTip').textContent =
      `${shots.length} 点の平均。最大残差 ${deg.toFixed(3)}°（${r.wn}／`
      + `${r.each.find(e => e.s.target === r.wn).L.toFixed(0)} m 先で `
      + `${(r.each.find(e => e.s.target === r.wn).L * Math.tan(r.worst)).toFixed(2)} m）。`
      + '大きいときは 立ち位置・カメラの高さ・杭の標高を確かめてください。';
  }
  nextTarget();
}

// ★S31 どの点を記録したか・いまどれを狙うかを チップで見せる
function renderChips() {
  const box = $('fitChips'); if (!box) return;
  const at = $('fitAt').value, aim = $('fitTo').value;
  box.innerHTML = '';
  for (const a of anchorZ()) {
    const b = document.createElement('button');
    b.className = 'chip';
    const done = shots.some(s => s.target === a.name);
    if (a.name === at) { b.classList.add('here'); b.textContent = a.name + '（立）'; }
    else {
      if (done) b.classList.add('done');
      if (a.name === aim) b.classList.add('aim');
      b.textContent = a.name + (done ? ' ✓' : '');
      b.onclick = () => { $('fitTo').value = a.name; renderChips(); };
    }
    box.appendChild(b);
  }
}

// 次に狙う点＝まだ記録していない中で 一番遠い点
function nextTarget() {
  const at = $('fitAt').value, A = anchorZ();
  // ★S30 立っている点は狙えない（自分の足元）。選択肢から外す
  for (const o of $('fitTo').options) o.disabled = (o.value === at);
  const a = A.find(x => x.name === at) || A[0];
  const cand = A.filter(b => b.name !== a.name && !shots.some(s => s.target === b.name));
  const list = (cand.length ? cand : A.filter(b => b.name !== a.name))
    .map(b => ({ b, d: Math.hypot(b.x - a.x, b.y - a.y) })).sort((x, y) => y.d - x.d);
  if (list.length) $('fitTo').value = list[0].b.name;
  renderChips();
}

// 端末の姿勢 → クォータニオン（重力基準。方位は当てにしない）
const _e = new THREE.Euler(), _q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2), _q0 = new THREE.Quaternion();
const ZEE = new THREE.Vector3(0, 0, 1);
function onOrient(ev) {
  const a = THREE.MathUtils.degToRad(ev.alpha || 0), b = THREE.MathUtils.degToRad(ev.beta || 0),
        g = THREE.MathUtils.degToRad(ev.gamma || 0);
  _e.set(b, a, -g, 'YXZ');
  fitQ.setFromEuler(_e); fitQ.multiply(_q1);
  fitQ.multiply(_q0.setFromAxisAngle(ZEE, -screenAng));
}

async function startFit() {
  try {
    fitStream = await navigator.mediaDevices.getUserMedia(
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
  } catch (e) { alert('カメラを使えません：' + e.message + '\nHTTPS で開いているか確認してください。'); return; }
  zoomUI(false);                                    // ★S58 現地合わせ中は隠す
  const v = $('vid'); v.srcObject = fitStream; await v.play().catch(() => {});
  const v2 = $('vid2'); v2.srcObject = fitStream; v2.play().catch(() => {});   // ★S29 ルーペ
  if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
    try { const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') alert('「動作と方向」の許可が要ります。Safari の設定から許可してください。'); } catch (e) {}
  }
  screenAng = THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || 0);
  addEventListener('deviceorientation', onOrient, true);
  fitOn = true; controls.enabled = false; scene.background = null;
  $('vid').classList.add('show'); $('xh').classList.add('show'); $('fitui').classList.add('show');
  shots.length = 0; $('fitShots').textContent = '記録 0 点';
  fitSkip = $('fitAt').value; redrawAnchors();      // ★S30 足元のポールを隠す
  nextTarget(); sizeLoupe(); showLoupe($('cLoupe').checked);
  $('bFit').classList.add('on'); $('sheet').classList.remove('open'); $('bPanel').classList.remove('on');
  $('fitState').textContent = '未合わせ';
  $('fitTip').textContent = '① 立っている基準点と カメラの高さ（レンズまで）を入れる　'
    + '② 見えている中で ★一番遠い基準点を選び、画面中央の十字にその杭を重ねて「記録」　'
    + '③ もう1〜2点でも記録すると 平均が効く（ルーペで拡大できます）';
}
function endFit() {
  fitOn = false; zoomUI(true);                      // ★S58
  removeEventListener('deviceorientation', onOrient, true);
  if (fitStream) { fitStream.getTracks().forEach(t => t.stop()); fitStream = null; }
  $('vid2').srcObject = null; showLoupe(false);
  fitSkip = null; redrawAnchors();                  // ★S30 元に戻す
  $('vid').classList.remove('show'); $('xh').classList.remove('show'); $('fitui').classList.remove('show');
  $('bFit').classList.remove('on');
  controls.enabled = true; scene.background = new THREE.Color(0xf4f5f3);
  corr.identity(); shots.length = 0; yawTrim = pitchTrim = 0;
  camera.fov = 55; camera.updateProjectionMatrix();
}


// ============ ★S43 基準点の標高（現地入力） ============
//   ・入れた値は localStorage に入り、現地合わせ（自作AR）に すぐ効く
//   ・AR（実寸）の USDZ は作り置きなので すぐには動かせない。
//     代わりに「十字を鋲に重ねた あと 何 m 上げ下げするか」を出す
const zBase = (a) => (a.z != null ? a.z : a.z_plan);   // データに入っている値＝USDZ の高さ
function zNow() {
  let ov = {}; try { ov = JSON.parse(localStorage.getItem(ZKEY) || '{}'); } catch (e) {}
  return ov;
}
function zRender(A) {
  const ov = zNow();
  for (const id of ['fitZ', 'zbox2']) {
    const box = $(id); if (!box) continue;
    box.innerHTML = '';
    A.forEach(a => {
      const v = (ov[a.name] != null ? +ov[a.name] : zBase(a));
      const d = document.createElement('div'); d.className = 'zrow';
      d.innerHTML = '<span>' + a.name + '</span>'
        + '<input type="number" step="0.001" inputmode="decimal" data-n="' + a.name
        + '" value="' + v.toFixed(3) + '">'
        + '<span class="k" style="width:auto">元値 ' + zBase(a).toFixed(3)
        + (a.z_meas ? '（実測）' : '（計画）') + '</span>';
      box.appendChild(d);
    });
  }
  zOffset(A);
}
// AR（実寸）用：十字を鋲に重ねたあとの上げ下げ量
function zOffset(A) {
  const box = $('zOff'); if (!box) return;
  const ov = zNow();
  const rows = A.map(a => {
    const v = (ov[a.name] != null ? +ov[a.name] : zBase(a));
    return { n: a.name, d: v - zBase(a) };
  }).filter(r => Math.abs(r.d) >= 0.005);
  if (!rows.length) {
    box.innerHTML = '<b>AR（実寸）</b>：いまの入力は 元値と同じなので、十字を鋲に重ねるだけで合います。';
    return;
  }
  box.innerHTML = '<b>AR（実寸）で使うとき</b>（USDZ は作り置きなので、その場では動きません）<br>'
    + '十字を鋲に重ねたあと、<b>2本指で上下</b>に この分だけ動かしてください。<br>'
    + rows.map(r => '<span class="mono">' + r.n + '　'
        + (r.d > 0 ? 'モデルを ' + r.d.toFixed(3) + ' m 下げる'
                   : 'モデルを ' + (-r.d).toFixed(3) + ' m 上げる') + '</span>').join('<br>')
    + '<br>★きちんと直すには 書き出した CSV を PC に送って 作り直してください。';
}
function zCollect() {
  const o = {};
  const box = $('zbox2') || $('fitZ');
  box.querySelectorAll('input').forEach(i => { const v = +i.value; if (isFinite(v)) o[i.dataset.n] = v; });
  return o;
}
function initZ(A) {
  zRender(A);
  const save = () => {
    localStorage.setItem(ZKEY, JSON.stringify(zCollect()));
    zRender(A); redrawAnchors();
    const tip = $('fitTip'); if (tip) tip.textContent = '標高を保存しました。もう一度「記録」で合わせ直してください。';
  };
  const reset = () => { localStorage.removeItem(ZKEY); zRender(A); redrawAnchors(); };
  // 2か所の入力欄を連動させる
  for (const id of ['fitZ', 'zbox2']) {
    const box = $(id); if (!box) continue;
    box.addEventListener('input', e => {
      const n = e.target.dataset.n; if (!n) return;
      for (const j of ['fitZ', 'zbox2']) {
        const o = $(j); if (!o || o === box) continue;
        const q = o.querySelector('input[data-n="' + n + '"]'); if (q) q.value = e.target.value;
      }
    });
  }
  ['fitZSave', 'zSave'].forEach(id => { if ($(id)) $(id).onclick = save; });
  ['fitZReset', 'zReset'].forEach(id => { if ($(id)) $(id).onclick = reset; });
  if ($('zOut')) $('zOut').onclick = () => {
    const ov = zNow();
    const L = ['点名,実測標高,参考(いまの値),備考'];
    A.forEach(a => {
      const has = ov[a.name] != null && Math.abs(+ov[a.name] - zBase(a)) >= 0.0005;
      L.push([a.name, has ? (+ov[a.name]).toFixed(3) : '', zBase(a).toFixed(3),
              (a.memo || '').replace(/,/g, '、')].join(','));
    });
    const s = L.join('\r\n') + '\r\n';
    $('zCsv').value = s;
    if (navigator.clipboard) navigator.clipboard.writeText(s).catch(() => {});
    $('zCsv').select();
  };
  if ($('zIn')) $('zIn').onclick = () => {
    const o = zNow(); let n = 0;
    ($('zCsv').value || '').split(/\r?\n/).forEach(line => {
      if (!line || line[0] === '#') return;
      const c = line.split(',');
      if (c.length < 2) return;
      const nm = c[0].replace(/^﻿/, '').trim(), v = parseFloat(c[1]);
      if (A.some(a => a.name === nm) && isFinite(v)) { o[nm] = v; n++; }
    });
    localStorage.setItem(ZKEY, JSON.stringify(o));
    zRender(A); redrawAnchors();
    $('zOff').insertAdjacentHTML('afterbegin', '<b>' + n + ' 点 読み込みました。</b><br>');
  };
}

function initFit() {
  fovCal = +(localStorage.getItem(FKEY) || 65);
  const A = M.anchors;
  for (const id of ['fitAt', 'fitTo']) {
    const sel = $(id);
    A.forEach(a => { const o = document.createElement('option'); o.value = a.name;
      o.textContent = `${a.name}（設計追距 ${a.ds.toFixed(0)}）`; sel.appendChild(o); });
  }
  $('fitAt').selectedIndex = 0; $('fitTo').selectedIndex = 1;
  // ★S29 立っている点を変えたら 記録を捨てて 狙う点を一番遠い点にし直す
  $('fitAt').onchange = () => { shots.length = 0; corr.identity();
    $('fitShots').textContent = '記録 0 点'; $('fitState').textContent = '未合わせ';
    if (fitOn) { fitSkip = $('fitAt').value; redrawAnchors(); }
    nextTarget(); };
  $('fitTo').onchange = renderChips;
  $('cLoupe').onchange = e => showLoupe(e.target.checked);
  $('loupeZ').onchange = sizeLoupe;
  $('bPrint').onclick = printView;
  // ★S32 AR（実寸）で使う USDZ を切り替える
  // ★S45 ピンチ（拡大縮小）を殺すかどうかも ここで href に付ける。
  //      #allowsContentScaling=0 は AR Quick Look の URL フラグメント（Safari 12.2 以降）。
  //      フラグメントはサーバに送られないので sw.js のキャッシュには影響しない。
  const LKEY = 'sd_ar_lockscale';
  const swapUsdz = () => {
    const f = $('uGround').checked ? 'model_ground.usdz'
            : $('uBank').checked   ? 'model_bank.usdz' : 'model.usdz';
    const lock = $('uLock').checked;
    try { localStorage.setItem(LKEY, lock ? '1' : '0'); } catch (e) {}
    $('arq').setAttribute('href', f + (lock ? '#allowsContentScaling=0' : ''));
    // ★S46 全体版は高さを合わせられない（levitate は上方向だけ）。選んだら警告を出す
    // ★S68 Variant 経由のときは Quick Look の高さ制約は関係ないので出さない
    const vlNow = isQuickLook() && vlOn() && vlKey();
    $('uWarn').style.display = ($('uFull').checked && !vlNow) ? '' : 'none';
  };
  try { $('uLock').checked = (localStorage.getItem(LKEY) !== '0'); } catch (e) {}   // 既定は固定する
  $('uFull').onchange = swapUsdz; $('uGround').onchange = swapUsdz; $('uBank').onchange = swapUsdz;
  $('uLock').onchange = swapUsdz;
  swapUsdz();
  // ★S43 実測標高を現地で入れる。現地合わせ用と設定パネル用の2か所に同じ表を出す
  initZ(A);
  $('bFit').onclick = () => { fitOn ? endFit() : startFit(); };
  $('fitEnd').onclick = endFit;
  $('fitTap').onclick = record;
  $('fitReset').onclick = () => { corr.identity(); shots.length = 0; yawTrim = pitchTrim = 0;
    $('fitYaw').value = 0; $('fitYawV').textContent = '0.00°'; $('fitShots').textContent = '記録 0 点';
    nextTarget();
    $('fitState').textContent = '未合わせ'; $('fitTip').textContent = '狙う点を選んで、十字に重ねて「記録」。'; };
  $('fitYaw').oninput = () => { const d = +$('fitYaw').value / 20;
    yawTrim = THREE.MathUtils.degToRad(d); $('fitYawV').textContent = d.toFixed(2) + '°'; };
  $('fitFov').value = fovCal; $('fitFovV').textContent = fovCal.toFixed(1) + '°';
  $('fitFov').oninput = () => { fovCal = +$('fitFov').value; $('fitFovV').textContent = fovCal.toFixed(1) + '°';
    localStorage.setItem(FKEY, fovCal); };
}

function fitTick() {
  camera.position.copy(camPos());
  if (camera.fov !== fovCal) { camera.fov = fovCal; camera.updateProjectionMatrix(); }
  const t = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawTrim);
  camera.quaternion.copy(t.multiply(corr).multiply(fitQ));
}


// ---------- ★S29 ルーペ（十字まわりの拡大） ----------
function sizeLoupe() {
  const v = $('vid2'); if (!v) return;
  const z = +($('loupeZ') ? $('loupeZ').value : 3) || 3;
  v.style.width = innerWidth + 'px';   v.style.marginLeft = (-innerWidth / 2) + 'px';
  v.style.height = innerHeight + 'px'; v.style.marginTop = (-innerHeight / 2) + 'px';
  v.style.transform = 'scale(' + z + ')';
  const m = $('loupeMag'); if (m) m.textContent = '×' + z + '　十字に杭を重ねる';
}
function showLoupe(on) {
  $('loupe').classList.toggle('show', !!on && fitOn);
  $('loupeMag').classList.toggle('show', !!on && fitOn);
  if (on) sizeLoupe();
}

// ---------- ★S29 印刷（PC 向け） ----------
// 画面を1枚の画像にする。現地合わせ中はカメラ映像も下に敷く
function snapshot() {
  renderer.render(scene, camera);                       // 直前に描き直してから取り出す
  const c = renderer.domElement;
  if (!fitOn) return c.toDataURL('image/png');
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
  const g = o.getContext('2d'), v = $('vid');
  if (v && v.videoWidth) {                              // object-fit:cover と同じ切り出し
    const s = Math.max(o.width / v.videoWidth, o.height / v.videoHeight);
    const w = v.videoWidth * s, h = v.videoHeight * s;
    g.drawImage(v, (o.width - w) / 2, (o.height - h) / 2, w, h);
  } else { g.fillStyle = '#000'; g.fillRect(0, 0, o.width, o.height); }
  g.drawImage(c, 0, 0);
  return o.toDataURL('image/png');
}

function printView() {
  const img = snapshot();
  const on = Object.keys(meshes).filter(n => meshes[n].visible && !n.startsWith('線_'));
  const ln = Object.keys(meshes).filter(n => meshes[n].visible && n.startsWith('線_'));
  const d = new Date();
  const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
    + `${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:`
    + `${String(d.getMinutes()).padStart(2, '0')}`;
  let slice = '—';
  if ($('cSlice').checked) {
    const a = M.axis[+$('sSlice').value];
    slice = `${noText(toSv(a[0]))}（設計追距 ${a[0].toFixed(3)}）　厚み ${(+$('sThick').value / 10).toFixed(1)} m`;
  }
  const rows = [
    ['工事', '二級河川塩田川 河川改修工事（その4）　左岸'],
    ['範囲', `設計追加距離 ${M.range.lo.toFixed(3)}〜${M.range.hi.toFixed(3)}`],
    ['断面（スライス）', slice],
    ['表示中の部品', on.length ? on.join('／') : '（なし）'],
    ['表示中の特徴線', ln.length ? ln.map(n => n.slice(2)).join('／') : '（なし）'],
    ['座標系', M.origin.crs + `　ローカル原点 X=${M.origin.X0} Y=${M.origin.Y0}`],
    ['データ作成', M.built || '—'],
    ['出力日時', ts],
  ];
  const hudTxt = $('hud').classList.contains('show') ? $('hud').innerText.replace(/\n/g, '　') : '';
  if (hudTxt) rows.splice(3, 0, ['画面の情報', hudTxt]);
  const table = $('pInfo').checked
    ? '<table>' + rows.map(r => `<tr><th style="width:22%">${r[0]}</th><td>${r[1]}</td></tr>`).join('') + '</table>'
    : '';
  $('printsheet').innerHTML =
    `<h1>塩田川 その4 左岸 完成形　画面出力</h1><img src="${img}" alt="">${table}`;
  setTimeout(() => window.print(), 60);
}
