'use strict';

/* ============================================================
   此刻相机 · v1.3
   ------------------------------------------------------------
   三层结构：
     js/wm-core.js      水印渲染引擎（纯函数，8 种样式）
     js/exif-write.js   标准 EXIF 写入（时间 / GPS / 机型）
     app.js             相机控制 + 拍摄流水线 + UI（本文件）
   ------------------------------------------------------------
   拍摄流水线（v1.3 重写）：
     按下快门
       → 取图：优先 ImageCapture 原生满幅，失败退预览帧
       → 择优：连取 3 帧算拉普拉斯方差，取最清晰那张（防手抖）
       → 合成：按预览所见比例裁剪 + 前置镜像 + 变焦裁切，零误差
       → 取色：采样水印区域亮度，自动切深/浅墨水
       → 绘印：wm-core 按样式绘制
       → 编码：JPEG（质量可调）
       → EXIF：写入 DateTimeOriginal / GPS / Make / Model
       → 签名：ECDSA-P256 签名 → 哈希 → 写入 APP15 签名段
       → 预览 / 保存 / 分享
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const pad2 = n => String(n).padStart(2, '0');

const APP_VERSION = '1.4.0';
const LS_KEY = 'wmc.settings.v3';
const OLD_KEYS = ['wmc.settings.v2', 'wmc.settings.v1'];

const DEFAULTS = {
  title: '此刻相机',
  place: '',
  amapKey: '',
  style: 'classic',
  pos: 'bottom',        // bottom | br | top
  wmScale: 1,           // 0.85 | 1 | 1.15
  autoInk: true,        // 按底图亮度自动切深/浅墨水
  fields: [],           // 自定义字段 [{k,v}]
  showTime: true,
  showSeconds: true,
  showPlace: true,
  showCoords: true,
  showWeather: true,
  showAltitude: false,
  showAccuracy: false,
  showCode: true,
  coordFmt: 'zh',       // zh | dec
  coordGcj: false,
  quality: 'high',      // high | standard
  smartPick: true,
  writeExif: true,
  jpegQuality: 0.94,
  level: false,         // 水平仪（默认关，需要时点开）
  ev: 0,                // 硬件曝光补偿（不是所有机型都支持）
  autoTone: true,       // 自动压高光：成片发白时按亮度分析降一档
  bright: 0             // 手动亮度补偿，-30 ~ +30（百分比）
};

function readSettings() {
  let raw = null;
  try {
    raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      for (const k of OLD_KEYS) {
        const v = localStorage.getItem(k);
        if (v) { raw = v; break; }
      }
    }
  } catch (e) {}
  let s = { ...DEFAULTS };
  if (raw) {
    try {
      s = Object.assign(s, JSON.parse(raw));
    } catch (e) {}
  }
  // 旧版本默认名的迁移
  if ((s.title || '').trim() === '水印相机') s.title = DEFAULTS.title;
  if (!WM.STYLES.some(x => x.id === s.style)) s.style = DEFAULTS.style;
  if (!Array.isArray(s.fields)) s.fields = [];
  if (!['bottom', 'br', 'top'].includes(s.pos)) s.pos = 'bottom';
  if (![0, 3, 10].includes(Number(s.timer))) s.timer = 0;
  return s;
}

let S = readSettings();

function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
}

function styleName(id) {
  const m = WM.STYLES.find(x => x.id === id);
  return m ? m.name : '经典';
}

/* ---------- DOM ---------- */
const stage = $('#stage');
const stageWrap = $('.stage-wrap');
const video = $('#video');
const overlay = $('#overlay');
const guard = $('#stageGuard');
const guardText = $('#guardText');
const btnEnableCam = $('#btnEnableCam');
const toastEl = $('#toast');

/* ============================================================
   相机
   ============================================================ */
let stream = null;
let facing = 'environment';
let imageCapture = null;

/* 焦距 / 变焦 */
let lensList = [];
let lensIndex = 0;
let curDeviceId = null;
let lensMode = 'none';        // optical | zoom | crop | none
let zoom = { type: 'none', v: 1 };

/* 能力 */
let caps = {};
let trackRef = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

function showGuard(text, btnLabel) {
  guardText.textContent = text;
  btnEnableCam.textContent = btnLabel || '重试';
  guard.classList.add('show');
  if (stage) stage.classList.add('guard-on');
}
function hideGuard() {
  guard.classList.remove('show');
  if (stage) stage.classList.remove('guard-on');
}
function showBusy(t) { showGuard(t || '处理中…', '请稍候'); }
function hideBusy() { hideGuard(); }

function stopStream() {
  stopToneLoop();
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  trackRef = null;
  imageCapture = null;
}

function qualityConstraint() {
  return S.quality === 'high'
    ? { width: { ideal: 2560 }, height: { ideal: 1920 } }
    : { width: { ideal: 1920 }, height: { ideal: 1440 } };
}

async function startCamera(deviceId, opts) {
  const keepLenses = !!(opts && opts.keepLenses);
  if (typeof deviceId !== 'string') deviceId = null;
  hideGuard();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showGuard('当前环境不支持直接调用相机。点左下角「相册」可以导入照片加印。', '重试');
    return false;
  }

  stopStream();
  try {
    const video0 = Object.assign({}, qualityConstraint());
    if (deviceId) video0.deviceId = { exact: deviceId };
    else video0.facingMode = { ideal: facing };

    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video0 });
    const track = stream.getVideoTracks()[0];
    trackRef = track;
    const st = (track.getSettings && track.getSettings()) || {};
    devDiag.stream = (st.width || 0) + 'x' + (st.height || 0) +
      (st.focalLengthX ? ' ' + Math.round(st.focalLengthX) + 'mm' : '');
    curDeviceId = st.deviceId || deviceId || null;
    if (st.facingMode) facing = st.facingMode;
    caps = (track.getCapabilities && track.getCapabilities()) || {};

    try { imageCapture = (typeof ImageCapture !== 'undefined') ? new ImageCapture(track) : null; } catch (e) { imageCapture = null; }

    zoom = { type: 'none', v: 1 };
    video.srcObject = stream;
    await video.play().catch(() => {});
    applyVideoTransform();
    layoutStage();
    startToneLoop();
    applyEv(S.ev);

    await setupZoom(track);

    updateToolCaps();
    return true;
  } catch (err) {
    const name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      showGuard('相机权限被拒绝。请在系统设置或浏览器权限里允许「相机」，然后点重试。', '重试');
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      showGuard('没找到可用摄像头。可以点「相册」导入照片加印。', '重试');
    } else {
      showGuard('相机启动失败（' + (name || '未知') + '）。', '重试');
    }
    return false;
  }
}

/* 预览层变换：镜像 + 裁切变焦 */
function applyVideoTransform() {
  const parts = [];
  if (facing === 'user') parts.push('scaleX(-1)');
  if (zoom.type === 'crop' && zoom.v > 1) parts.push('scale(' + zoom.v + ')');
  video.style.transformOrigin = '50% 50%';
  video.style.transform = parts.join(' ') || 'none';
}

/* ---------- 镜头扫描（沿用 v1.2 的逻辑） ---------- */
function facingOfDevice(d) {
  const l = (d && d.label ? d.label : '').toLowerCase();
  if (/back|rear|environment|后置|背面/.test(l)) return 'environment';
  if (/front|user|前置|正面/.test(l)) return 'user';
  return null;
}
function focalToLabel(ratio) {
  const std = [0.5, 0.6, 1, 2, 3, 5, 10];
  let best = std[0];
  for (const v of std) if (Math.abs(v - ratio) < Math.abs(best - ratio)) best = v;
  return (best % 1 === 0 ? best : best.toFixed(1)) + '×';
}

/* 变焦：只走传感器的 zoom 能力。
   ------------------------------------------------------------
   旧实现有两处问题，都被反馈过：
   1) 「多摄探测」会对每个后置摄像头各开一次流、读能力、再关掉，
      4 摄机型要开合 4 次，每次几百毫秒，画面还会闪 —— 这是卡顿的主因之一。
   2) 拿不到 zoom 能力时用「裁切」冒充变焦。裁切只是把中心区域放大，
      分辨率本来就低（4.9MP 的视频流），再裁就是雪上加霜，越拉越糊。
      用户要的是「调用机器本身摄像头」，不是数字变焦。

   所以这里只保留真实 zoom；设备不给能力就不显示变焦入口。 */
async function setupZoom(track) {
  lensList = [];
  lensMode = 'none';
  lensIndex = 0;
  zoom = { type: 'none', v: 1 };
  applyVideoTransform();
  renderLensBar();
  if (!track) return;

  const c = (track.getCapabilities && track.getCapabilities()) || {};
  const cz = c.zoom;
  const lo = (cz && cz.min) || 1;

  // 打开后先把 zoom 归位。部分机型默认不是 1×，视野会莫名变窄。
  if (cz && track.applyConstraints) {
    try { await track.applyConstraints({ advanced: [{ zoom: lo }] }); } catch (e) {}
  }
  if (!cz || !(cz.max > lo)) return;         // 没有硬件变焦能力，直接不给入口

  const max = Math.min(cz.max, 8);
  const steps = [1, 2, 3, 5]
    .map(z => Math.max(lo, z))
    .filter((z, i, a) => z <= max + 0.01 && a.indexOf(z) === i);
  if (steps.length < 2) return;

  lensMode = 'zoom';
  lensList = steps.map(z => ({
    key: 'z' + z,
    label: (z / lo).toFixed(Math.abs(z / lo - Math.round(z / lo)) < 0.05 ? 0 : 1) + '×',
    zoom: z
  }));
  lensIndex = 0;
  renderLensBar();
}

function renderLensBar() {
  const bar = $('#lensBar');
  if (!bar) return;
  if (lensList.length < 2) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  bar.innerHTML = lensList.map((l, i) =>
    `<button class="lens${i === lensIndex ? ' active' : ''}" data-i="${i}">${l.label}</button>`
  ).join('');
}

async function setLens(i) {
  if (!lensList[i] || i === lensIndex) return;
  const l = lensList[i];
  const prev = lensIndex;
  const prevZoom = zoom;

  if (l.zoom == null) return;
  const t = trackRef;
  try {
    if (!t) throw new Error('no track');
    await t.applyConstraints({ advanced: [{ zoom: l.zoom }] });
    const got = (t.getSettings && t.getSettings().zoom);
    // 有些机型会"接受"约束但不真正执行，读回来对不上就不认
    if (got == null || Math.abs(got - l.zoom) > 0.05) throw new Error('ignored');
    lensIndex = i;
    zoom = { type: 'sensor', v: got };
    applyVideoTransform();
    renderLensBar();
  } catch (e) {
    // 不回退到裁切：宁可维持原倍率，也不要拿糊图冒充变焦
    lensIndex = prev;
    zoom = prevZoom;
    applyVideoTransform();
    renderLensBar();
    toast('这台设备的相机不支持该倍率');
  }
}

/* ---------- 双指缩放 ---------- */
let pinchStart = 0;
let pinchBase = 1;

stage.addEventListener('touchstart', e => {
  if (e.touches.length !== 2) return;
  pinchStart = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  );
  pinchBase = zoom.v || 1;
}, { passive: true });

stage.addEventListener('touchmove', e => {
  if (e.touches.length !== 2 || !pinchStart) return;
  const d = Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY
  );
  const want = Math.min(8, Math.max(1, pinchBase * (d / pinchStart)));
  if (Math.abs(want - (zoom.v || 1)) < 0.06) return;
  applyZoom(want);
}, { passive: true });

stage.addEventListener('touchend', () => { pinchStart = 0; }, { passive: true });

async function applyZoom(z) {
  const t = trackRef;
  const cz = caps.zoom;
  if (!cz || !t) return false;
  const want = Math.min(cz.max, Math.max(cz.min || 1, z));
  try {
    await t.applyConstraints({ advanced: [{ zoom: want }] });
    const got = t.getSettings().zoom;
    if (got == null) return false;
    zoom = { type: 'sensor', v: got };
    applyVideoTransform();
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- 触控对焦 ---------- */
stage.addEventListener('click', e => {
  if (!trackRef) return;
  const r = stage.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  focusAt(x, y, e.clientX - r.left, e.clientY - r.top);
});

let focusLocked = false;

async function focusAt(x, y, px, py) {
  const ring = $('#focusRing');
  if (ring) {
    ring.style.left = px + 'px';
    ring.style.top = py + 'px';
    ring.classList.remove('run');
    void ring.offsetWidth;
    ring.classList.add('run');
  }
  const modes = (caps.focusMode || []);
  try {
    if (modes.includes('manual') || caps.pointsOfInterest) {
      await trackRef.applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }] }] });
    }
    if (modes.includes('single-shot')) {
      await trackRef.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
      setTimeout(() => {
        trackRef.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }, 1200);
    }
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(8);
}

/* ---------- 电筒 / 曝光 ---------- */
async function toggleTorch() {
  if (!trackRef) return;
  const want = !torchOn;
  try {
    await trackRef.applyConstraints({ advanced: [{ torch: want }] });
    torchOn = want;
    toast(torchOn ? '补光灯已开' : '补光灯已关');
  } catch (e) {
    toast('这台设备不支持补光灯');
    torchOn = false;
  }
  syncTools();
}
let torchOn = false;

async function applyEv(v) {
  if (!trackRef || !caps.exposureCompensation) return;
  const r = caps.exposureCompensation;
  const val = Math.min(r.max || 0, Math.max(r.min || 0, Number(v) || 0));
  try { await trackRef.applyConstraints({ advanced: [{ exposureCompensation: val }] }); } catch (e) {}
}

function updateToolCaps() {
  const t = $('#btnTorch');
  if (t) t.hidden = !(caps.torch);
  const ev = $('#evRow');
  if (ev) ev.hidden = !caps.exposureCompensation;
}

/* ============================================================
   取景排版 / 实时水印
   ============================================================ */
/* 横屏判定：短边小于 620 视为手机横放（平板横屏仍按竖排走，空间够） */
function isLandscape() {
  return window.innerWidth > window.innerHeight && window.innerHeight < 620;
}

function layoutStage() {
  const cs = getComputedStyle(stageWrap);
  const availW = stageWrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  let availH = stageWrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  // 横屏时工具条浮在画面上，不再占用文档流高度
  const land = isLandscape();
  const bar = $('.bars');
  if (bar && !land) availH -= bar.offsetHeight + 10;
  if (availW <= 0 || availH <= 0) return;

  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1440;
  const ratio = vw / vh;

  let w = availW;
  let h = w / ratio;
  if (h > availH) { h = availH; w = h * ratio; }
  stage.style.width = Math.round(w) + 'px';
  stage.style.height = Math.round(h) + 'px';
  renderOverlay();
}

let uiCode = '';

function renderOverlay() {
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  if (!W || !H || !video.videoWidth || document.hidden) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.round(W * dpr);
  const ph = Math.round(H * dpr);
  if (overlay.width !== pw || overlay.height !== ph) {
    overlay.width = pw;
    overlay.height = ph;
    overlay.style.width = W + 'px';
    overlay.style.height = H + 'px';
  }
  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const d = WM.buildData(displayBase(liveBase()), S, uiCode);
  // 取景器里底图就是视频，亮度直接从 video 采样
  let ink = 'dark';
  if (S.autoInk) {
    try { ink = sampleVideoInk(S.pos); } catch (e) { ink = 'dark'; }
  }
  WM.draw(ctx, W, H, d, { style: S.style, pos: S.pos, scale: S.wmScale, ink, s: S });
}

let inkCanvas = null;
function sampleVideoInk(pos) {
  if (!video.videoWidth) return 'dark';
  if (!inkCanvas) {
    inkCanvas = document.createElement('canvas');
    inkCanvas.width = 24;
    inkCanvas.height = 16;
  }
  const c = inkCanvas.getContext('2d', { willReadFrequently: true });
  // 与水印区域对应的源区域
  const bandH = Math.round(video.videoHeight * 0.34);
  const sy = pos === 'top' ? 0 : video.videoHeight - bandH;
  c.drawImage(video, 0, sy, video.videoWidth, bandH, 0, 0, 24, 16);
  const px = c.getImageData(0, 0, 24, 16).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  return (sum / (px.length / 4) / 255) > 0.62 ? 'light' : 'dark';
}

/* ---------- 曝光 / 影调 ----------
   「拍出来发白」有三个来源，这里一并处理：
     ① 快门按得太早，AE 还没收敛        → 拍前先空跑几帧；
     ② Android WebView 的 takePhoto() 偶尔返回偏亮的帧
                                         → 与同一时刻预览帧比高光溢出比例，明显更白就换成预览帧；
     ③ 场景本身过曝                     → 按高光溢出比例压一档亮度并补对比度。
   压暗用 canvas ctx.filter（GPU 合成），作用在水印绘制与签名之前，不影响验真。 */
let tone = { lut: null, preview: 'none', key: '' };

/* 取图路径诊断：装机后能直接在设置里看到这次到底走了哪条路，
   不用连电脑抓 console。字段刻意短，方便截图反馈。 */
const devDiag = { stream: '', via: '', raw: '', out: '', tone: null };
let toneTimer = 0;
let toneCanvas = null;

function statsOf(src) {
  if (!window.WMCTone || !src) return null;
  const w = src.videoWidth || src.width || 0;
  const h = src.videoHeight || src.height || 0;
  if (!w || !h) return null;
  const TW = 192;
  const th = Math.max(1, Math.round(TW * h / w));
  if (!toneCanvas) toneCanvas = document.createElement('canvas');
  if (toneCanvas.width !== TW || toneCanvas.height !== th) {
    toneCanvas.width = TW;
    toneCanvas.height = th;
  }
  const c = toneCanvas.getContext('2d', { willReadFrequently: true });
  try {
    c.drawImage(src, 0, 0, TW, th);
    return WMCTone.analyze(c.getImageData(0, 0, TW, th).data, 2);
  } catch (e) {
    return null;
  }
}

/* 手动亮度滑块 -30..+30 → 曝光补偿 -0.3..+0.3 档 */
function manualExposure() {
  return Math.max(-1, Math.min(1, (Number(S.bright) || 0) / 100));
}

function toneActive() {
  return !!(window.WMCTone && (S.autoTone || Math.abs(manualExposure()) > 0.005));
}

/* 取景预览：CSS filter 只能近似「去灰」那一段，做不了查表。
   这里刻意不做全局压暗 —— 那正是之前把画面压成灰雾的原因。 */
function toneFilter() {
  return tone.preview || 'none';
}

function applyToneToPreview() {
  video.style.filter = toneFilter();
}

/* 从取景器采样，按分位生成查找表；变化足够大才更新，避免忽明忽暗 */
function refreshTone(force) {
  if (!window.WMCTone || !video.videoWidth) return;
  const s = statsOf(video);
  if (!s) return;
  const exp = manualExposure();
  const key = (S.autoTone ? '1' : '0') + exp.toFixed(2) + s.p1.toFixed(3) + '|' + s.p995.toFixed(3);
  if (!force && key === tone.key) return;
  const lut = toneActive() ? WMCTone.buildLut(s, { exposure: exp, wb: !!S.autoTone }) : null;
  tone = { lut, preview: WMCTone.previewFilter(lut), key };
  applyToneToPreview();
}

/* 成片：把 LUT 真正钉到像素上。发生在水印绘制与签名之前，不影响验真。
   整个包在 try 里：个别 WebView 上 getImageData 会抛（画布被标记污染），
   那种情况宁可输出原图，也不能让整次拍摄失败。 */
function applyToneLut(canvas) {
  if (!toneActive()) return canvas;
  try {
    const s = statsOf(canvas);
    if (!s) return canvas;
    const lut = WMCTone.buildLut(s, { exposure: manualExposure(), wb: !!S.autoTone });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    WMCTone.applyLut(img.data, lut);
    ctx.putImageData(img, 0, 0);
    devDiag.tone = {
      black: Math.round(lut.black), white: Math.round(lut.white),
      gamma: +(lut.gamma || 1).toFixed(2),
      wb: [lut.gains.r, lut.gains.g, lut.gains.b].map(v => +v.toFixed(2))
    };
  } catch (e) {
    devDiag.tone = 'error: ' + (e && e.message ? e.message : e);
  }
  return canvas;
}

/* ---------- 水平仪 ----------
   旧版只读 gamma，那只在竖屏成立。横屏时手机的「左右」对应 beta，
   所以一转屏就彻底失准 —— 这就是「不会自适应横屏」。
   这里按 screen.orientation.angle 选轴，并对角度做一阶低通平滑，
   避免手抖时数字乱跳。 */
let levelRoll = 0;
let levelBound = false;

function levelAngle(e) {
  const ang = (screen.orientation && typeof screen.orientation.angle === 'number')
    ? screen.orientation.angle
    : (typeof window.orientation === 'number' ? window.orientation : 0);
  const g = e.gamma, b = e.beta;
  // 归一化到 0/90/180/270
  const a = ((ang % 360) + 360) % 360;
  if (a === 90) return b;            // 手机顺时针横放：左右倾斜走 beta
  if (a === 270) return -b;
  if (a === 180) return -g;          // 倒置
  return g;                          // 竖屏
}

function initLevel() {
  if (levelBound) return;
  const wrap = document.getElementById('levelWrap');
  const line = document.getElementById('levelLine');
  const degEl = document.getElementById('levelDeg');
  if (!wrap || !line) return;

  const onOrient = (e) => {
    if (!S.level) return;
    let roll = levelAngle(e);
    if (roll == null || !isFinite(roll)) return;
    // beta/gamma 在接近 ±90 时是奇异点，钳到 ±60 免得乱转
    roll = Math.max(-60, Math.min(60, roll));
    // 一阶低通，α=0.35：跟手，又不抖
    levelRoll = levelRoll * 0.65 + roll * 0.35;
    const abs = Math.abs(levelRoll);
    line.style.transform = 'rotate(' + (-levelRoll).toFixed(2) + 'deg)';
    if (degEl) degEl.textContent = abs.toFixed(1) + '°';
    wrap.classList.toggle('ok', abs < 1.0);
  };

  window.addEventListener('deviceorientation', onOrient, true);
  levelBound = true;
}

function applyLevel() {
  const wrap = document.getElementById('levelWrap');
  if (wrap) wrap.hidden = !S.level;
}

/* 把取图路径渲染到设置面板，装机后不用连电脑就能看到 */
function renderDiag() {
  const el = document.getElementById('camDiag');
  if (!el) return;
  const t = devDiag.tone;
  const toneTxt = !t ? '—'
    : (typeof t === 'string' ? t
      : 'black ' + t.black + ' / white ' + t.white + ' / γ ' + t.gamma +
        (t.wb ? ' / WB ' + t.wb.join(',') : ''));
  el.innerHTML =
    '<div><span>预览流</span><b>' + (devDiag.stream || '—') + '</b></div>' +
    '<div><span>取图</span><b class="' +
      (devDiag.via && devDiag.via.indexOf('video') >= 0 ? 'bad' : '') + '">' +
      (devDiag.via || '—') + (devDiag.raw ? ' · ' + devDiag.raw : '') + '</b></div>' +
    '<div><span>成片</span><b>' + (devDiag.out || '—') + '</b></div>' +
    '<div><span>影调</span><b>' + toneTxt + '</b></div>';
}

function startToneLoop() {
  stopToneLoop();
  refreshTone(true);
  // 2.4s 一次：每轮都要 getImageData，是持续耗电和掉帧的来源之一。
  // 影调只在场景明暗变化时才会动，这个频率足够。
  toneTimer = setInterval(() => {
    if (document.hidden) return;
    if (!toneActive()) return;
    refreshTone(false);
  }, 2400);
}

function stopToneLoop() {
  if (toneTimer) { clearInterval(toneTimer); toneTimer = 0; }
}

async function refreshUiCode() {  try {
    const pub = await WMC.getPublic();
    const b = liveBase();
    const core = { v: 1, kid: pub.kid, ts: b.time.toISOString(), lat: b.lat, lng: b.lng, src: b.src, addr: b.addr || '' };
    const c = await WMC.makeCode(core);
    if (c !== uiCode) { uiCode = c; renderOverlay(); }
  } catch (e) {}
}

/* ============================================================
   数据 / 坐标
   ============================================================ */
const geo = { lat: null, lng: null, acc: null, alt: null, addr: '', weather: '' };

function liveBase() {
  return {
    time: new Date(),
    lat: geo.lat,
    lng: geo.lng,
    acc: geo.acc,
    altitude: geo.alt,
    addr: (S.place || '').trim() || geo.addr || '',
    weather: geo.weather || '',
    src: 'live'
  };
}

/* WGS-84 → GCJ-02 */
function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  const outOfChina = (la, ln) => !(ln > 73.66 && ln < 135.05 && la > 3.86 && la < 53.55);
  function tLat(x, y) {
    let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return r;
  }
  function tLng(x, y) {
    let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    r += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    r += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return r;
  }
  if (outOfChina(lat, lng)) return [lat, lng];
  let dLat = tLat(lng - 105.0, lat - 35.0);
  let dLng = tLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lng + dLng];
}

/**
 * 画面上的坐标可以按设置换成 GCJ-02（和国内地图 App 读数一致），
 * 但签名里必须永远是原始 WGS-84，否则验签信息与实际定位不符。
 */
function displayBase(base) {
  if (!S.coordGcj || base.lat == null) return base;
  const g = wgs84ToGcj02(base.lat, base.lng);
  return Object.assign({}, base, { lat: g[0], lng: g[1], gcj: true });
}

/* 干净拷贝：保留原图用于「改水印」重出图，避免在带水印的图上反复叠加 */
function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/* ============================================================
   拍摄流水线
   ============================================================ */
function nextFrame() {
  return new Promise(res => {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => res());
    else setTimeout(res, 90);
  });
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function grabFrame() {
  const W = video.videoWidth, H = video.videoHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').drawImage(video, 0, 0, W, H);
  return c;
}

/* 画质评估：只取画面中央 62% 区域，按较高分辨率采样。
   整帧缩到 320px 会把高频细节滤掉，帧间差异被压平，择优就成了抽签。 */
function frameQuality(canvas) {
  const sw = canvas.width, sh = canvas.height;
  const rw = Math.round(sw * 0.62), rh = Math.round(sh * 0.62);
  const sx = Math.round((sw - rw) / 2), sy = Math.round((sh - rh) / 2);
  const TW = Math.min(640, Math.max(160, rw));
  const th = Math.max(1, Math.round(TW * rh / rw));

  const c = document.createElement('canvas');
  c.width = TW; c.height = th;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, sx, sy, rw, rh, 0, 0, TW, th);
  const data = ctx.getImageData(0, 0, TW, th).data;

  const f = window.WMImg ? WMImg.focusScore(data, TW, th) : { score: 0, texture: 0 };
  const t = window.WMCTone ? WMCTone.analyze(data, 2) : null;
  return { score: f.score, texture: f.texture, stats: t };
}

/**
 * 取图：优先原生满幅，失败退预览帧（多帧择优）
 * @returns {Promise<{src:CanvasImageSource,w:number,h:number,via:string,score:number}>}
 */
/* 先让相机空跑几帧：AE/AWB 没收敛就按快门，成片常常一片惨白 */
async function warmUp(frames) {
  const n = Math.max(1, frames || 3);
  for (let i = 0; i < n; i++) await nextFrame();
}

async function grabBestImage() {
  await warmUp(3);

  // ① ImageCapture：拿到的是传感器满分辨率原图，画质最好
  if (imageCapture && S.quality === 'high' && typeof imageCapture.takePhoto === 'function') {
    try {
      const blob = await imageCapture.takePhoto();
      const bmp = await createImageBitmap(blob);
      return { src: bmp, w: bmp.width, h: bmp.height, via: 'capture', score: 0, stats: statsOf(bmp) };
    } catch (e) {
      // 部分 WebView / 机型不支持，静默降级
    }
  }

  // ② 预览帧：取多帧后择优。帧间要留出间隔，
  //    紧挨着的两帧几乎一样，抓不到手抖和对焦拉风箱带来的差异。
  const n = S.smartPick ? 3 : 1;
  const cands = [];
  for (let i = 0; i < n; i++) {
    await nextFrame();
    if (i) await sleep(80);
    const f = grabFrame();
    cands.push({ canvas: f, q: frameQuality(f) });
  }
  const idx = Math.max(0, WMImg.selectBest(cands.map(c => ({
    score: c.q.score, blown: c.q.stats ? c.q.stats.blown : 0
  }))));
  const pick = cands[idx];
  return {
    src: pick.canvas, w: pick.canvas.width, h: pick.canvas.height,
    via: 'video', score: pick.q.score, stats: pick.q.stats, cands: cands.length
  };
}

/* cover 裁剪：让源图按目标比例居中裁切 */
function coverRect(iw, ih, targetR) {
  const ir = iw / ih;
  if (ir > targetR) {
    const w = ih * targetR;
    return { x: (iw - w) / 2, y: 0, w, h: ih };
  }
  const h = iw / targetR;
  return { x: 0, y: (ih - h) / 2, w: iw, h };
}

/**
 * 合成画布：把取到的图按“所见即所得”画出来
 * 预览里看到什么（含前置镜像、变焦裁切、比例裁切），成片就是什么
 */
function composeCanvas(raw) {
  const vw = stage.clientWidth, vh = stage.clientHeight;
  const targetR = (vw && vh) ? vw / vh : raw.w / raw.h;

  const rect = coverRect(raw.w, raw.h, targetR);
  const z = (zoom.type === 'crop' && zoom.v > 1) ? zoom.v : 1;
  const zw = rect.w / z;
  const zh = zw / targetR;
  const zx = rect.x + (rect.w - zw) / 2;
  const zy = rect.y + (rect.h - zh) / 2;

  let outW = Math.round(zw);
  let outH = Math.round(zh);
  const MAXW = 4096;
  if (outW > MAXW) {
    outH = Math.round(outH * MAXW / outW);
    outW = MAXW;
  }

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = 'high';

  if (facing === 'user') {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }
  // 大比例缩小（≥2 倍）时先逐级减半再落到目标尺寸，
  // 一次到位会让双线性采样跳过大片像素，出现锯齿和糊边
  let srcEl = raw.src, sX = zx, sY = zy, sW = zw, sH = zh;
  if (window.WMImg) {
    for (const st of WMImg.downscalePlan(zw, zh, outW)) {
      const t = document.createElement('canvas');
      t.width = st.w;
      t.height = st.h;
      const tc = t.getContext('2d');
      tc.imageSmoothingQuality = 'high';
      tc.drawImage(srcEl, sX, sY, sW, sH, 0, 0, st.w, st.h);
      srcEl = t; sX = 0; sY = 0; sW = st.w; sH = st.h;
    }
  }

  // 影调不在这里做：CSS filter 只能近似，而且会二次损失动态范围。
  // 构图完成后由 applyToneLut 用查找表精确处理。
  ctx.drawImage(srcEl, sX, sY, sW, sH, 0, 0, outW, outH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

function canvasToBlob(canvas, quality) {
  return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', quality || S.jpegQuality));
}

/**
 * 绘制水印 + 编码 + EXIF + 签名
 * @param {HTMLCanvasElement} canvas 已绘制照片像素
 * @param {object} base 拍摄信息
 * @param {object} override 可选，临时覆盖设置（预览里换样式用）
 */
async function renderPhoto(canvas, base, override) {
  const st = override ? Object.assign({}, S, override) : S;

  const canSign = !!(window.WMC && window.crypto && window.crypto.subtle);
  let code = '';
  let core = null;

  if (canSign) {
    const pub = await WMC.getPublic();
    core = {
      v: 1,
      kid: pub.kid,
      ts: (base.time instanceof Date ? base.time : new Date()).toISOString(),
      lat: base.lat,
      lng: base.lng,
      src: base.src || 'live',
      addr: base.addr || ''
    };
    code = await WMC.makeCode(core);
  }

  // 取色 → 决定墨水
  const ctx = canvas.getContext('2d');
  let ink = 'dark';
  if (st.autoInk) {
    try { ink = WM.measureInk(ctx, canvas.width, canvas.height, st.pos === 'top' ? 'top' : 'bottom'); } catch (e) {}
  }

  const d = WM.buildData(displayBase(base), st, code);
  WM.draw(ctx, canvas.width, canvas.height, d, {
    style: st.style, pos: st.pos, scale: st.wmScale, ink, s: st
  });

  let blob = await canvasToBlob(canvas, S.jpegQuality);
  let bytes = new Uint8Array(await blob.arrayBuffer());

  // 写入标准 EXIF（时间 / GPS / 机型 / 备注）
  if (st.writeExif && window.WMCExifWrite) {
    try {
      bytes = WMCExifWrite.inject(bytes, {
        time: base.time instanceof Date ? base.time : new Date(),
        lat: base.lat,
        lng: base.lng,
        altitude: base.altitude,
        make: 'WMC',
        model: 'WMC Camera / ' + (navigator.platform || 'Android'),
        software: 'Moment Camera ' + APP_VERSION,
        description: 'Moment Camera · ' + d.timeText,
        xpTitle: d.title || '此刻相机',
        comment: '此刻相机' + (code ? ' · 验真码 ' + code : ''),
        width: canvas.width,
        height: canvas.height
      });
    } catch (e) {
      // EXIF 写失败不影响出图
    }
  }

  if (!canSign) {
    return { blob: new Blob([bytes], { type: 'image/jpeg' }), code: '', core: null, unsigned: true, canvas };
  }

  const imh = WMC.base32(await WMC.sha256(bytes), 26);
  const sig = await WMC.sign(core, code, imh);
  const payload = {
    wmc: 'WMC1',
    v: 1,
    core,
    code,
    imh,
    sig: WMC.toB64url(sig),
    pub: (await WMC.getPublic()).pub,
    fp: (await WMC.getPublic()).fp,
    kid: core.kid,
    at: Date.now(),
    dev: devInfo(canvas)
  };
  const signed = WMC.jpeg.embed(bytes, payload);
  return { blob: new Blob([signed], { type: 'image/jpeg' }), code, core, payload, canvas, ink };
}

function devInfo(canvas) {
  return {
    ua: (navigator.userAgent || '').slice(0, 120),
    w: canvas ? canvas.width : (video.videoWidth || 0),
    h: canvas ? canvas.height : (video.videoHeight || 0),
    dpr: window.devicePixelRatio || 1,
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '') + '/' + new Date().getTimezoneOffset(),
    ver: APP_VERSION
  };
}

/* ---------- 快门 ---------- */
let busy = false;
let lastRaw = null;          // 上一张的原始画布（用于改水印重出图）
let lastBase = null;
let shotBlob = null;
let shotCode = '';
const history = [];          // 本次会话拍摄记录

function shutterFlash() {
  const f = $('#flash');
  if (!f) return;
  f.classList.remove('run');
  void f.offsetWidth;
  f.classList.add('run');
}


async function capture() {
  if (busy) return;
  if (!video.videoWidth) { toast('相机还没准备好'); return; }
  busy = true;
  const btn = $('#btnShutter');
  if (btn) btn.disabled = true;

  try {
    shutterFlash();
    showBusy('正在成像…');

    let raw = await grabBestImage();
    devDiag.via = raw.via || '?';
    devDiag.raw = raw.w + 'x' + raw.h;

    // takePhoto() 在部分机型上比预览帧明显更白（高光大片溢出）。
    // 同一时刻再抓一帧对比，原生图更糟就改用预览帧，宁可少点分辨率也不要白片。
    if (raw.via === 'capture' && window.WMCTone) {
      const frame = grabFrame();
      const fs = statsOf(frame);
      if (WMCTone.shouldReplacePhoto(raw.stats, fs)) {
        devDiag.via = 'capture→video(偏亮)';
        raw = { src: frame, w: frame.width, h: frame.height, via: 'video', stats: fs };
        console.info('[wmc] takePhoto 偏亮，已改用预览帧', raw.stats && raw.stats.blown, fs && fs.blown);
      }
    }

    const base = liveBase();

    const canvas = composeCanvas(raw);
    lastRaw = cloneCanvas(canvas);   // 未套影调的构图，改水印时重算
    devDiag.out = canvas.width + 'x' + canvas.height;
    applyToneLut(canvas);
    renderDiag();
    lastBase = base;

    showBusy('正在签名…');
    const r = await renderPhoto(canvas, base);
    shotBlob = r.blob;
    shotCode = r.code;

    pushHistory(r.blob, r.code, base);
    openPreview(r.blob, r.code);
    if (r.unsigned) toast('当前环境不支持签名（需 https），这张没有签名');
  } catch (e) {
    toast('拍摄失败：' + (e && e.message ? e.message : e));
  } finally {
    hideBusy();
    busy = false;
    if (btn) btn.disabled = false;
  }
}

/* ---------- 历史 ---------- */
function pushHistory(blob, code, base) {
  const url = URL.createObjectURL(blob);
  history.unshift({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    blob, url, code, time: new Date(),
    w: lastRaw ? lastRaw.width : 0,
    h: lastRaw ? lastRaw.height : 0
  });
  if (history.length > 24) {
    const drop = history.pop();
    URL.revokeObjectURL(drop.url);
  }
  renderHistory();
}

function renderHistory() {
  const grid = $('#historyGrid');
  if (!grid) return;
  if (!history.length) {
    grid.innerHTML = '<p class="empty">还没有拍摄记录。拍下的照片会暂时列在这里，方便挑选和批量保存。</p>';
    $('#btnSaveAll').hidden = true;
    return;
  }
  $('#btnSaveAll').hidden = false;
  grid.innerHTML = history.map((h, i) =>
    `<button class="shot" data-i="${i}">
       <img src="${h.url}" alt="">
       <span>${pad2(h.time.getHours())}:${pad2(h.time.getMinutes())}:${pad2(h.time.getSeconds())}</span>
     </button>`
  ).join('');
}

/* ============================================================
   预览 / 保存
   ============================================================ */
function openPreview(blob, code) {
  const url = URL.createObjectURL(blob);
  const img = $('#previewImg');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = url;
  img.src = url;
  $('#previewCode').textContent = code ? '验真码 ' + code : '（当前环境不支持签名）';
  $('#preview').classList.add('show');
}

function closePreview() {
  $('#preview').classList.remove('show');
}

function stampName(prefix) {
  const n = new Date();
  const ts = `${n.getFullYear()}${pad2(n.getMonth() + 1)}${pad2(n.getDate())}_${pad2(n.getHours())}${pad2(n.getMinutes())}${pad2(n.getSeconds())}`;
  return `${prefix || '此刻'}_${ts}${shotCode ? '_' + shotCode.replace(/-/g, '') : ''}.jpg`;
}

async function saveBlob(blob, name) {
  if (!blob) return false;
  if (window.WMCAndroid && typeof window.WMCAndroid.saveImage === 'function') {
    try {
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('读取图片失败'));
        fr.readAsDataURL(blob);
      });
      const r = String(window.WMCAndroid.saveImage(dataUrl, name));
      return r.indexOf('OK') === 0;
    } catch (e) {
      return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return true;
}

async function saveShot() {
  if (!shotBlob) return;
  const ok = await saveBlob(shotBlob, stampName('此刻'));
  toast(ok ? '已保存到 Pictures/此刻相机' : '保存失败');
}

async function saveAll() {
  if (!history.length) return;
  let ok = 0;
  for (const h of history) {
    const name = `此刻_${h.time.getFullYear()}${pad2(h.time.getMonth() + 1)}${pad2(h.time.getDate())}_${pad2(h.time.getHours())}${pad2(h.time.getMinutes())}${pad2(h.time.getSeconds())}${h.code ? '_' + h.code.replace(/-/g, '') : ''}.jpg`;
    if (await saveBlob(h.blob, name)) ok++;
  }
  toast(`已保存 ${ok} / ${history.length} 张`);
}

async function shareShot() {
  if (!shotBlob) return;
  const file = new File([shotBlob], stampName('此刻'), { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '此刻照片' }); } catch (e) {}
  } else {
    saveShot();
  }
}

/* 改水印重出图 */
async function reRender() {
  if (!lastRaw || !lastBase) { toast('没有可重出的照片'); return; }
  busy = true;
  showBusy('正在重新出图…');
  try {
    const r = await renderPhoto(applyToneLut(cloneCanvas(lastRaw)), lastBase);
    shotBlob = r.blob;
    shotCode = r.code;
    openPreview(r.blob, r.code);
    toast('已按新水印重新出图');
  } catch (e) {
    toast('重出图失败：' + (e && e.message ? e.message : e));
  } finally {
    hideBusy();
    busy = false;
  }
}

/* ============================================================
   定位 / 地址 / 天气
   ============================================================ */
async function jget(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function weatherText(code) {
  const c = Number(code);
  if (c === 0) return '晴';
  if (c === 1) return '晴间多云';
  if (c === 2) return '多云';
  if (c === 3) return '阴';
  if (c === 45) return '雾';
  if (c === 48) return '雾凇';
  if (c >= 51 && c <= 57) return '毛毛雨';
  if (c === 61) return '小雨';
  if (c === 63) return '中雨';
  if (c === 65) return '大雨';
  if (c === 66 || c === 67) return '冻雨';
  if (c === 71) return '小雪';
  if (c === 73) return '中雪';
  if (c === 75) return '大雪';
  if (c === 77) return '雪粒';
  if (c === 80 || c === 81) return '阵雨';
  if (c === 82) return '强阵雨';
  if (c === 85 || c === 86) return '阵雪';
  if (c === 95) return '雷阵雨';
  if (c === 96 || c === 99) return '雷暴冰雹';
  return '天气';
}

async function geocodeAmap(lat, lng, key) {
  const g = wgs84ToGcj02(lat, lng);
  const url = 'https://restapi.amap.com/v3/geocode/regeo?key=' + encodeURIComponent(key) +
    '&location=' + g[1].toFixed(6) + ',' + g[0].toFixed(6) + '&extensions=all&radius=800&roadlevel=0';
  const j = await jget(url);
  if (!j || String(j.status) !== '1' || !j.regeocode) return '';
  const r = j.regeocode;
  let addr = r.formatted_address || '';
  if (!addr) {
    const ac = r.addressComponent || {};
    addr = (ac.province || '') + (ac.city || '') + (ac.district || '') + (ac.township || '') +
      (ac.streetNumber && ac.streetNumber.street ? ac.streetNumber.street : '');
  }
  const poi = (r.pois && r.pois[0] && r.pois[0].name) || '';
  if (poi && addr && addr.indexOf(poi) < 0) addr += '（近' + poi + '）';
  return addr;
}

async function geocodeNominatim(lat, lng) {
  const n = await jget(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=zh-CN&zoom=18&addressdetails=1`);
  if (!n || !n.address) return '';
  const a = n.address;
  const parts = [
    a.state || a.province,
    a.city || a.town || a.county,
    a.city_district || a.district || a.county,
    a.suburb || a.township || a.village || a.neighbourhood,
    a.road || a.pedestrian || a.footway,
    a.house_number
  ].filter(Boolean);
  const uniq = [];
  for (const p of parts) if (uniq.indexOf(p) < 0) uniq.push(p);
  return uniq.join('');
}

async function geocodeBdc(lat, lng) {
  const j = await jget(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`);
  if (!j) return '';
  const parts = [j.principalSubdivision, j.city, j.locality, j.localityInfo && j.localityInfo.adminLevel5].filter(Boolean);
  const uniq = [];
  for (const p of parts) if (uniq.indexOf(p) < 0) uniq.push(p);
  return uniq.join('');
}

async function fetchAddress(lat, lng) {
  if (lat == null || lng == null) return '';
  const key = (S.amapKey || '').trim();
  if (key) {
    const a = await geocodeAmap(lat, lng, key);
    if (a) return a;
  }
  const n = await geocodeNominatim(lat, lng);
  if (n) return n;
  return await geocodeBdc(lat, lng);
}

async function fetchWeather(lat, lng) {
  const j = await jget(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`, 7000);
  const cur = j && j.current;
  if (!cur || cur.temperature_2m == null) return '';
  return `${Math.round(cur.temperature_2m)}°C ${weatherText(cur.weather_code)}`;
}

let watchId = null;
let lastGeoKey = '';

function updateStatus() {
  const el = $('#geoStatus');
  if (!el) return;
  const manual = (S.place || '').trim();
  if (manual) { el.textContent = '手动地点 · ' + manual; return; }
  if (geo.lat == null) { el.textContent = '定位中…（可先拍，地点稍后补）'; return; }
  const pos = geo.lat.toFixed(5) + ', ' + geo.lng.toFixed(5);
  el.textContent = (geo.addr ? geo.addr : '未解析到地址') + (geo.acc ? ` · ±${Math.round(geo.acc)}m` : '');
}

async function resolvePlace() {
  const lat = geo.lat, lng = geo.lng;
  if (lat == null) return;
  const [addr, wx] = await Promise.all([fetchAddress(lat, lng), fetchWeather(lat, lng)]);
  if (lat !== geo.lat) return;
  if (addr) geo.addr = addr;
  if (wx) geo.weather = wx;
  updateStatus();
  renderOverlay();
  const ph = $('#inpPlace');
  if (ph && !ph.value) ph.placeholder = geo.addr ? ('自动：' + geo.addr) : '自动定位地址';
}

function onPos(pos) {
  const c = pos.coords;
  geo.lat = c.latitude;
  geo.lng = c.longitude;
  geo.acc = c.accuracy;
  geo.alt = (c.altitude != null && isFinite(c.altitude)) ? c.altitude : geo.alt;
  const key = geo.lat.toFixed(3) + ',' + geo.lng.toFixed(3);
  updateStatus();
  renderOverlay();
  if (key !== lastGeoKey) {
    lastGeoKey = key;
    resolvePlace();
  }
}

function onGeoError(err) {
  const map = { 1: '定位权限被拒绝', 2: '定位不可用', 3: '定位超时' };
  const el = $('#geoStatus');
  if (el) el.textContent = map[err.code] || '定位失败';
}

function initGeo() {
  if (!navigator.geolocation) {
    const el = $('#geoStatus');
    if (el) el.textContent = '设备不支持定位';
    return;
  }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(onPos, onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 20000,
    timeout: 20000
  });
}

/* ============================================================
   相册导入
   ============================================================ */
function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('图片读取失败'));
    img.src = url;
  });
}

async function importFile(file) {
  showBusy('正在读取原图信息…');
  let url = null;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let exif = null;
    try { exif = WMCExif.read(buf); } catch (e) { exif = null; }

    const hasGps = !!(exif && exif.hasGps);
    const time = (exif && exif.date) || (file.lastModified ? new Date(file.lastModified) : new Date());
    let lat = hasGps ? exif.lat : geo.lat;
    let lng = hasGps ? exif.lng : geo.lng;
    let src = hasGps ? 'import-exif' : 'import-device';
    if (!hasGps && lat == null) src = 'import-none';

    let addr = '';
    if ((S.place || '').trim()) addr = S.place.trim();
    else if (lat != null && lng != null) {
      showBusy('正在解析原图坐标…');
      addr = await fetchAddress(lat, lng);
    }

    url = URL.createObjectURL(file);
    const img = await loadImage(url);
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d').drawImage(img, 0, 0, W, H);

    showBusy('正在签名…');
    const base = { time, lat, lng, addr, weather: geo.weather || '', src, acc: null, altitude: null };
    lastRaw = cloneCanvas(canvas);
    lastBase = base;
    const r = await renderPhoto(canvas, base);
    shotBlob = r.blob;
    shotCode = r.code;
    pushHistory(r.blob, r.code, base);
    openPreview(r.blob, r.code);

    const parts = [];
    parts.push(exif && exif.date ? '时间取自原图 EXIF' : '原图无拍摄时间，用文件时间');
    parts.push(hasGps ? '坐标取自原图 EXIF' : (lat != null ? '原图无 GPS，用当前定位' : '原图无 GPS，未记录坐标'));
    if (r.unsigned) parts.push('未签名（需 https）');
    toast(parts.join('；'));
  } catch (e) {
    toast('导入失败：' + (e && e.message ? e.message : e));
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 2000);
    hideBusy();
  }
}

/* ============================================================
   UI
   ============================================================ */
function snapshotFrame(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (video.videoWidth) {
    const r = coverRect(video.videoWidth, video.videoHeight, w / h);
    try { ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, w, h); } catch (e) {}
  } else {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#2b3648'); g.addColorStop(1, '#141a24');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  if (facing === 'user') {
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    const tc = t.getContext('2d');
    tc.translate(w, 0); tc.scale(-1, 1); tc.drawImage(c, 0, 0);
    return t;
  }
  return c;
}

function buildStyleGrid() {
  const grid = $('#styleGrid');
  if (!grid || grid.dataset.built) return;
  grid.innerHTML = WM.STYLES.map(m =>
    `<div class="style-item" data-style="${m.id}" role="button" tabindex="0">
       <canvas width="340" height="340"></canvas>
       <div class="si-foot"><span>${m.name}</span><i class="si-check"></i></div>
     </div>`
  ).join('');
  grid.dataset.built = '1';
  grid.addEventListener('click', e => {
    const b = e.target.closest('.style-item');
    if (!b) return;
    S.style = b.dataset.style;
    saveSettings();
    syncUI();
    renderOverlay();
    paintStyleThumbs();
  });
}

function sizeStyleThumbs() {
  const grid = $('#styleGrid');
  if (!grid) return;
  const cs = getComputedStyle(grid);
  const inner = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const w = Math.max(72, Math.floor((inner - 11) / 2));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  grid.querySelectorAll('.style-item canvas').forEach(c => {
    c.style.width = w + 'px';
    c.style.height = w + 'px';
    c.width = Math.round(w * dpr);
    c.height = Math.round(w * dpr);
  });
  return { w, h: w };
}

function paintStyleThumbs() {
  const grid = $('#styleGrid');
  if (!grid) return;
  sizeStyleThumbs();
  // 缩略图 canvas 的「绘制尺寸」是 dpr 放大后的像素（例如 170 CSS px × 3 = 510），
  // 底图与坐标都必须用同一个尺寸，否则底图只铺左上角、文字按整张算 → 字看着超大并溢出。
  const c0 = grid.querySelector('.style-item canvas');
  const bw = (c0 && c0.width) || 340;
  const bh = (c0 && c0.height) || 340;
  const base = snapshotFrame(bw, bh);
  const d = WM.buildData(displayBase(liveBase()), S, uiCode);
  let ink = 'dark';
  if (S.autoInk) {
    try { ink = WM.measureInk(base.getContext('2d'), bw, bh, S.pos === 'top' ? 'top' : 'bottom'); } catch (e) {}
  }
  grid.querySelectorAll('.style-item').forEach(item => {
    const c = item.querySelector('canvas');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(base, 0, 0, c.width, c.height);
    WM.draw(ctx, c.width, c.height, d, {
      style: item.dataset.style, pos: S.pos, scale: S.wmScale, ink, s: S
    });
    item.classList.toggle('on', item.dataset.style === S.style);
  });
  base.width = base.height = 0;
}

function openStyleSheet() {
  buildStyleGrid();
  $('#styleSheet').classList.add('show');
  $('#styleMask').classList.add('show');
  requestAnimationFrame(() => setTimeout(paintStyleThumbs, 40));
}
function closeStyleSheet() {
  $('#styleSheet').classList.remove('show');
  $('#styleMask').classList.remove('show');
  if ($('#preview').classList.contains('show')) reRender();
}

function syncUI() {
  $('#inpTitle').value = S.title || '';
  $('#inpPlace').value = S.place || '';
  $('#inpAmap').value = S.amapKey || '';
  $('#inpPlace').placeholder = geo.addr ? ('自动：' + geo.addr) : '自动定位地址';
  $('#inpFields').value = (S.fields || []).map(f => f.k ? `${f.k}：${f.v}` : f.v).join('\n');

  const map = {
    swTime: 'showTime', swSeconds: 'showSeconds', swPlace: 'showPlace',
    swCoords: 'showCoords', swWeather: 'showWeather', swCode: 'showCode',
    swGcj: 'coordGcj', swAlt: 'showAltitude', swAcc: 'showAccuracy',
    swInk: 'autoInk', swExif: 'writeExif', swSmart: 'smartPick', swGrid: 'grid',
    swTone: 'autoTone'
  };
  for (const id in map) {
    const el = document.getElementById(id);
    if (el) el.checked = !!S[map[id]];
  }

  const bs = $('#brightSlider');
  if (bs) {
    bs.value = String(S.bright || 0);
    const bv = $('#brightVal');
    if (bv) bv.textContent = (S.bright > 0 ? '+' : '') + (S.bright || 0);
  }

  const nameEl = $('#styleName');
  if (nameEl) nameEl.textContent = styleName(S.style);

  setSeg('segPos', S.pos);
  setSeg('segScale', String(S.wmScale));
  setSeg('segQuality', S.quality);
  setSeg('segCoord', S.coordFmt);

  $$('.style-item').forEach(it => it.classList.toggle('on', it.dataset.style === S.style));
  updateStatus();
  syncTools();
  applyLevel();
}

function setSeg(id, val) {
  const box = document.getElementById(id);
  if (!box) return;
  $$('button', box).forEach(b => b.classList.toggle('on', b.dataset.v === String(val)));
}

function syncTools() {
  const t = document.getElementById('btnTorch');
  if (t) t.classList.toggle('on', torchOn);
  const l = document.getElementById('btnLevel');
  if (l) l.classList.toggle('on', !!S.level);
  const ev = document.getElementById('evVal');
  if (ev) ev.textContent = (S.ev > 0 ? '+' : '') + Number(S.ev).toFixed(1);
  const sl = document.getElementById('evSlider');
  if (sl && Number(sl.value) !== Number(S.ev)) sl.value = S.ev;
}

async function fillFingerprint() {
  try {
    const pub = await WMC.getPublic();
    $('#fpText').textContent = pub.fpGrouped;
    $('#fpText').dataset.fp = pub.fp;
  } catch (e) {
    $('#fpText').textContent = '生成失败';
  }
}

function openSheet() {
  syncUI();
  fillFingerprint();
  renderDiag();
  $('#sheet').classList.add('show');
  $('#sheetMask').classList.add('show');
}
function closeSheet() {
  $('#sheet').classList.remove('show');
  $('#sheetMask').classList.remove('show');
  renderOverlay();
}

function openGallery() {
  renderHistory();
  $('#gallery').classList.add('show');
  $('#galleryMask').classList.add('show');
}
function closeGallery() {
  $('#gallery').classList.remove('show');
  $('#galleryMask').classList.remove('show');
}


/* ---------- 绑定 ---------- */
function bindUI() {
  $('#btnSettings').addEventListener('click', openSheet);
  $('#btnDone').addEventListener('click', closeSheet);
  $('#sheetMask').addEventListener('click', closeSheet);

  $('#inpTitle').addEventListener('input', e => { S.title = e.target.value; saveSettings(); renderOverlay(); });
  $('#inpPlace').addEventListener('input', e => {
    S.place = e.target.value; saveSettings(); updateStatus(); renderOverlay();
  });
  $('#inpFields').addEventListener('input', e => {
    S.fields = e.target.value.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map(line => {
        const i = line.indexOf('：') >= 0 ? line.indexOf('：') : line.indexOf(':');
        if (i < 0) return { k: '', v: line };
        return { k: line.slice(0, i).trim(), v: line.slice(i + 1).trim() };
      });
    saveSettings();
    renderOverlay();
  });

  $('#inpAmap').addEventListener('input', e => {
    S.amapKey = e.target.value.trim();
    saveSettings();
    lastGeoKey = '';
    initGeo();
    toast(S.amapKey ? '已设置高德 Key，正在重新解析' : '已清除高德 Key');
  });

  $('#btnAutoPlace').addEventListener('click', () => {
    S.place = '';
    saveSettings();
    $('#inpPlace').value = '';
    lastGeoKey = '';
    initGeo();
    toast('已改为自动定位');
    renderOverlay();
  });

  const toggles = [
    ['#swTime', 'showTime'], ['#swSeconds', 'showSeconds'], ['#swPlace', 'showPlace'],
    ['#swCoords', 'showCoords'], ['#swWeather', 'showWeather'], ['#swCode', 'showCode'],
    ['#swGcj', 'coordGcj'], ['#swAlt', 'showAltitude'], ['#swAcc', 'showAccuracy'],
    ['#swInk', 'autoInk'], ['#swExif', 'writeExif'], ['#swSmart', 'smartPick'],
    ['#swTone', 'autoTone']
  ];
  toggles.forEach(([sel, key]) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', e => {
      S[key] = e.target.checked;
      saveSettings();
      if (key === 'autoTone') refreshTone(true);
      renderOverlay();
    });
  });

  // 亮度滑块：实时作用到取景器，拍下来也按这个系数出片
  const bs = $('#brightSlider');
  if (bs) {
    const onMove = () => {
      S.bright = Number(bs.value) || 0;
      const bv = $('#brightVal');
      if (bv) bv.textContent = (S.bright > 0 ? '+' : '') + S.bright;
      applyToneToPreview();
    };
    bs.addEventListener('input', onMove);
    bs.addEventListener('change', () => { onMove(); saveSettings(); });
  }

  // 分段选择器
  const segs = [
    ['segPos', v => { S.pos = v; }],
    ['segScale', v => { S.wmScale = Number(v); }],
    ['segQuality', v => { S.quality = v; }],
    ['segCoord', v => { S.coordFmt = v; }]
  ];
  segs.forEach(([id, apply]) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      apply(b.dataset.v);
      saveSettings();
      syncUI();
      renderOverlay();
      if (id === 'segQuality') startCamera(curDeviceId, { keepLenses: true });
    });
  });

  $('#btnStyle').addEventListener('click', openStyleSheet);
  $('#btnStyleDone').addEventListener('click', closeStyleSheet);
  $('#styleMask').addEventListener('click', closeStyleSheet);

  $('#btnShutter').addEventListener('click', capture);
  $('#btnSwitch').addEventListener('click', () => {
    facing = facing === 'environment' ? 'user' : 'environment';
    startCamera();
  });
  $('#lensBar').addEventListener('click', e => {
    const b = e.target.closest('.lens');
    if (b) setLens(Number(b.dataset.i));
  });

  const btnRelocate = $('#btnRelocate');
  if (btnRelocate) btnRelocate.addEventListener('click', () => {
    lastGeoKey = ''; geo.addr = ''; geo.weather = '';
    toast('正在重新定位…');
    initGeo();
    renderOverlay();
  });

  $('#btnGallery').addEventListener('click', openGallery);
  $('#btnGalleryClose').addEventListener('click', closeGallery);
  $('#galleryMask').addEventListener('click', closeGallery);
  $('#btnPickFile').addEventListener('click', () => $('#fileInput').click());
  $('#btnSaveAll').addEventListener('click', saveAll);

  $('#historyGrid').addEventListener('click', e => {
    const b = e.target.closest('.shot');
    if (!b) return;
    const h = history[Number(b.dataset.i)];
    if (!h) return;
    shotBlob = h.blob;
    shotCode = h.code;
    openPreview(h.blob, h.code);
    closeGallery();
  });

  $('#fileInput').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importFile(file);
  });

  $('#btnEnableCam').addEventListener('click', () => startCamera());
  $('#btnSave').addEventListener('click', saveShot);
  $('#btnShare').addEventListener('click', shareShot);
  $('#btnClosePreview').addEventListener('click', closePreview);
  $('#btnRetake').addEventListener('click', closePreview);
  $('#btnEditWm').addEventListener('click', () => {
    closePreview();
    openStyleSheet();
  });

  // 工具条
  $('#btnTorch').addEventListener('click', toggleTorch);
  const bl = $('#btnLevel');
  if (bl) bl.addEventListener('click', () => {
    S.level = !S.level;
    saveSettings();
    applyLevel();
    syncTools();
    if (S.level) initLevel();
    toast(S.level ? '水平仪已开，转屏会自动换轴' : '水平仪已关');
  });
  const evSlider = $('#evSlider');
  if (evSlider) {
    evSlider.addEventListener('input', e => {
      S.ev = Number(e.target.value);
      saveSettings();
      syncTools();
      applyEv(S.ev);
    });
  }

  $('#btnCopyFp').addEventListener('click', async () => {
    const fp = $('#fpText').dataset.fp || '';
    if (!fp) return;
    try { await navigator.clipboard.writeText(fp); toast('公钥指纹已复制'); }
    catch (e) { toast('复制失败，请长按文字'); }
  });

  if (navigator.share && navigator.canShare) $('#btnShare').hidden = false;

  window.addEventListener('resize', layoutStage);
  window.addEventListener('resize', () => {
    if ($('#styleSheet').classList.contains('show')) paintStyleThumbs();
  });
  window.addEventListener('orientationchange', () => setTimeout(layoutStage, 320));
  document.addEventListener('gesturestart', e => e.preventDefault());
}

/* ============================================================
   启动
   ============================================================ */
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const t0 = performance.now();
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    const wait = Math.max(0, 620 - (performance.now() - t0));
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 620);
    }, wait);
  };
  if (video && video.readyState >= 2) { run(); return; }
  const onReady = () => { video.removeEventListener('loadeddata', onReady); run(); };
  if (video) video.addEventListener('loadeddata', onReady);
  setTimeout(run, 2400);
}

function boot() {
  bindUI();
  syncUI();
  initLevel();
  initLevel();
  initGeo();
  startCamera();
  setInterval(renderOverlay, 1000);
  setInterval(refreshUiCode, 1000);
  refreshUiCode();
  hideSplash();

  if (location.hash === '#settings') openSheet();

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__WMC_NATIVE__) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

video.addEventListener('loadedmetadata', layoutStage);
video.addEventListener('resize', layoutStage);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
