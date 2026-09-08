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

  buildParts(); buildAxis(); buildStakes();
  markGrp = new THREE.Group(); root.add(markGrp);

  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(c); controls.enableDamping = true; controls.dampingFactor = 0.12;
  camera.position.set(c.x + sz.x * 0.35, c.y + sz.length() * 0.28, c.z + sz.length() * 0.45);
  camera.lookAt(c); controls.update();

  bindUI(); buildAnchors(); initFit();
  $('sub').textContent = `三角形 ${M.parts.reduce((a, p) => a + p.f.length, 0).toLocaleString()}／`
    + `設計追距 ${M.range.lo.toFixed(3)}〜${M.range.hi.toFixed(3)}`;
  $('crs').innerHTML = `${M.origin.crs}<br>ローカル原点 X=${M.origin.X0} Y=${M.origin.Y0}<br>${M.origin.note}`;
  $('msg').classList.add('hide');
  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => {
    screenAng = THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || 0);
  });
  renderer.setAnimationLoop(tick);
  initAR();
}

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  sizeLoupe();
}
function tick(time, frame) {
  if (frame) arFrame(frame);
  if (fitOn) fitTick();
  else if (!renderer.xr.isPresenting) controls && controls.update();
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
  for (const [gname, test] of GROUPS) {
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

  $('bMeasure').onclick = () => {
    measureMode = !measureMode; $('bMeasure').classList.toggle('on', measureMode);
    clearMarks(); hud(measureMode ? '計測モード：2点をタップしてください。' : '');
  };
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

// ---------- 計測・情報 ----------
let downXY = null;
function onDown(e) { if (renderer.xr.isPresenting) return; downXY = [e.clientX, e.clientY]; }
function onUp(e) {
  if (renderer.xr.isPresenting || !downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null;
  if (moved > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1,
                              -((e.clientY - r.top) / r.height) * 2 + 1);
  if (fitOn) { record(p); return; }        // 現地合わせ中は「狙い」の記録
  raycaster.setFromCamera(p, camera);
  const targets = Object.values(meshes).filter(o => o.visible && o.isMesh);
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) { if (!measureMode) hud(''); return; }
  const w = hits[0].point.clone(); root.worldToLocal(w);   // モデル座標へ
  const m = { e: w.x, n: w.y, z: w.z };
  const st = station(m.e, m.n);
  const sv = toSv(st.s);
  const info = `<b>${noText(sv)}</b>　離れ <span class="mono">${F(Math.abs(st.off))}</span> m`
    + `（${st.off < 0 ? '左岸' : '右岸'}）　標高 <span class="mono">${F(m.z)}</span> m`
    + `<br><span class="k">設計追距 ${F(st.s)}／${hits[0].object.name}`
    + `／実座標 X=${F(m.n + M.origin.X0)} Y=${F(m.e + M.origin.Y0)}</span>`;
  if (!measureMode) { hud(info); return; }
  picks.push({ m, st, sv });
  mark(m);
  if (picks.length === 1) { hud(info + '<br>2点目をタップしてください。'); return; }
  const a = picks[0].m, b = picks[1].m;
  const dh = Math.hypot(b.e - a.e, b.n - a.n), dz = b.z - a.z;
  hud(`<b>計測</b>　水平 <span class="mono">${F(dh)}</span> m　`
    + `比高 <span class="mono">${dz >= 0 ? '+' : ''}${F(dz)}</span> m　`
    + `斜距離 <span class="mono">${F(Math.hypot(dh, dz))}</span> m`
    + `<br><span class="k">① ${noText(picks[0].sv)} 離れ ${F(Math.abs(picks[0].st.off))} 標高 ${F(a.z)}`
    + `<br>② ${noText(picks[1].sv)} 離れ ${F(Math.abs(picks[1].st.off))} 標高 ${F(b.z)}</span>`);
  picks.length = 0;
  setTimeout(clearMarks, 6000);
}
function mark(m) {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xd23b2f, depthTest: false }));
  s.position.set(m.e, m.n, m.z); s.renderOrder = 9; markGrp.add(s);
}
function clearMarks() { while (markGrp.children.length) markGrp.remove(markGrp.children[0]); picks.length = 0; }


// ---------- 現地 AR（実寸・手動で位置合わせ）----------
let xrSession = null, hitSource = null, refSpace = null, reticle = null;
let anchorW = null, heading = 0, zOff = 0, headingBase = 0;

function initAR() {
  const sel = $('anchor');
  M.stakes.forEach((k, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = `${k.sv_no.replace('+00.000', '')}（設計 ${k.ds.toFixed(2)}）`;
    sel.appendChild(o);
  });
  sel.selectedIndex = Math.min(3, M.stakes.length - 1);

  const ring = new THREE.RingGeometry(0.10, 0.14, 32).rotateX(-Math.PI / 2);
  reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x2f6f4e }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

  // iPhone/iPad は AR Quick Look（USDZ）、Android は WebXR に振り分ける
  const a = document.createElement('a');
  const quickLook = a.relList && a.relList.supports && a.relList.supports('ar');
  if (quickLook) { $('bAR').textContent = 'AR（実寸）'; }

  $('bAR').onclick = async () => {
    if (quickLook) { $('arq').click(); return; }      // iOS：Quick Look で 1:1 配置
    if (xrSession) { xrSession.end(); return; }
    if (!navigator.xr) { alert('この端末／ブラウザは現地 AR に未対応です。\niPhone/iPad は Safari で開いてください（AR Quick Look を使います）。\nAndroid は Chrome でお使いください。'); return; }
    if (!await navigator.xr.isSessionSupported('immersive-ar')) {
      alert('この端末では現地 AR（immersive-ar）が使えません。\nAndroid では「Google Play開発者サービス（AR）」の更新で使えるようになることがあります。'); return;
    }
    try { await startAR(); } catch (e) { alert('AR を開始できません：' + e); }
  };
  $('arRot').oninput = () => { heading = headingBase + THREE.MathUtils.degToRad(+$('arRot').value); $('arRotV').textContent = (+$('arRot').value).toFixed(1) + '°'; arApply(); };
  $('arZ').oninput = () => { zOff = +$('arZ').value / 100; $('arZV').textContent = zOff.toFixed(2); arApply(); };
  $('bPlace').onclick = () => {
    if (!reticle.visible) { $('arTip').textContent = '床が認識できていません。少しゆっくり動かして輪郭を出してください。'; return; }
    anchorW = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    arApply();
    $('arTip').textContent = '置きました。次に、堤防の上流側の地面に向けて「② 上流へ向ける」を押してください。';
  };
  $('bHeading').onclick = () => {
    if (!anchorW) { $('arTip').textContent = '先に「① 足元に合わせる」を押してください。'; return; }
    if (!reticle.visible) { $('arTip').textContent = '床が認識できていません。'; return; }
    const tgt = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    const d = tgt.clone().sub(anchorW); d.y = 0;
    if (d.length() < 0.6) { $('arTip').textContent = 'もう少し離れた地面に向けてください（1 m 以上）。'; return; }
    const k = M.stakes[+$('anchor').value];
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
  const k = M.stakes[+$('anchor').value];
  const pl = new THREE.Vector3(k.x, k.z, -k.y);        // zup 適用後のローカル座標
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  arRoot.quaternion.copy(q);
  arRoot.position.copy(anchorW).sub(pl.clone().applyQuaternion(q));
  arRoot.position.y += zOff;
}

async function startAR() {
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.body },
  });
  xrSession = session;
  await renderer.xr.setSession(session);
  refSpace = await session.requestReferenceSpace('local');
  const viewer = await session.requestReferenceSpace('viewer');
  hitSource = await session.requestHitTestSource({ space: viewer });

  scene.background = null; controls.enabled = false;
  $('sheet').classList.remove('open'); $('bPanel').classList.remove('on');
  $('arui').classList.add('show'); $('bAR').textContent = 'AR終了'; $('bAR').classList.add('on');
  stakeGrp.visible = false;
  $('arTip').textContent = '床を映して輪郭が出たら「① 足元に合わせる」を押してください。';

  session.addEventListener('end', () => {
    xrSession = null; hitSource = null; reticle.visible = false;
    scene.background = new THREE.Color(0xf4f5f3); controls.enabled = true;
    arRoot.position.set(0, 0, 0); arRoot.quaternion.identity();
    anchorW = null; heading = 0; headingBase = 0; zOff = 0;
    $('arui').classList.remove('show'); $('bAR').textContent = 'AR'; $('bAR').classList.remove('on');
    stakeGrp.visible = $('cStakes').checked;
    $('arRot').value = 0; $('arZ').value = 0;
  });
}

function arFrame(frame) {
  if (!hitSource || !refSpace) return;
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
  return M.anchors.map(a => ({ ...a, z: (ov[a.name] != null ? +ov[a.name] : a.z_plan) }));
}

function buildAnchors() { anchorGrp = new THREE.Group(); root.add(anchorGrp); redrawAnchors(); }
let fitSkip = null;      // ★S30 現地合わせ中、立っている点のポールは描かない
function redrawAnchors() {
  while (anchorGrp.children.length) anchorGrp.remove(anchorGrp.children[0]);
  for (const a of anchorZ()) {
    if (fitSkip && a.name === fitSkip) continue;   // ★カメラがこの中に入るので隠す
    const h = 2.0;
    const g = new THREE.CylinderGeometry(0.035, 0.035, h, 8).rotateX(Math.PI / 2).translate(a.x, a.y, a.z + h / 2);
    anchorGrp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xd23b2f })));
    const sp = label(a.name, a.z.toFixed(3) + ' m');
    sp.position.set(a.x, a.y, a.z + h + 1.2); sp.scale.set(6, 2.3, 1);
    anchorGrp.add(sp);
  }
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
    $('fitTip').textContent = '★もう1点、できるだけ遠い基準点でも「記録」すると、平均が効いて精度が上がります。';
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
  fitOn = false; removeEventListener('deviceorientation', onOrient, true);
  if (fitStream) { fitStream.getTracks().forEach(t => t.stop()); fitStream = null; }
  $('vid2').srcObject = null; showLoupe(false);
  fitSkip = null; redrawAnchors();                  // ★S30 元に戻す
  $('vid').classList.remove('show'); $('xh').classList.remove('show'); $('fitui').classList.remove('show');
  $('bFit').classList.remove('on');
  controls.enabled = true; scene.background = new THREE.Color(0xf4f5f3);
  corr.identity(); shots.length = 0; yawTrim = pitchTrim = 0;
  camera.fov = 55; camera.updateProjectionMatrix();
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
  $('cLoupe').onchange = e => showLoupe(e.target.checked);
  $('loupeZ').onchange = sizeLoupe;
  $('bPrint').onclick = printView;
  const zbox = $('fitZ'), ov = anchorZ();
  A.forEach((a, i) => {
    const d = document.createElement('div'); d.className = 'zrow';
    d.innerHTML = `<span>${a.name}</span><input type="number" step="0.001" data-n="${a.name}"
      value="${ov[i].z.toFixed(3)}"><span class="k" style="width:auto">計画 ${a.z_plan.toFixed(3)}</span>`;
    zbox.appendChild(d);
  });
  $('fitZSave').onclick = () => {
    const o = {}; zbox.querySelectorAll('input').forEach(i => o[i.dataset.n] = +i.value);
    localStorage.setItem(ZKEY, JSON.stringify(o)); redrawAnchors();
    $('fitTip').textContent = '標高を保存しました。もう一度「記録」で合わせ直してください。';
  };
  $('fitZReset').onclick = () => {
    localStorage.removeItem(ZKEY); redrawAnchors();
    zbox.querySelectorAll('input').forEach(i => { const a = A.find(x => x.name === i.dataset.n); i.value = a.z_plan.toFixed(3); });
  };
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
