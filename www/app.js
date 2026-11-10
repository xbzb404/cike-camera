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

const APP_VERSION = '1.5.1';
const LS_KEY = 'wmc.settings.v3';
const OLD_KEYS = ['wmc.settings.v2', 'wmc.settings.v1'];

const DEFAULTS = {
  title: '此刻相机',
  place: '',
  amapKey: '',
  style: 'classic',
  pos: 'bl',            // bl | br | tl | tr（左下/右下/左上/右上）
  size: '1080',         // 预览流长边：720 | 1080 | 1440
  view: 'fill',         // fill 填满取景框（默认，取景框尽量大）| wide 完整视角
  full: false,          // 全屏取景（只能手动开，退出用右上角按钮）
  wmScale: 1,           // 0.85 | 1 | 1.15
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
  still: 'auto',        // 成片尺寸：auto | 长边像素（960/1280/1920/2560/3840，横竖拍像素数相同）
  smartPick: true,
  writeExif: true,
  jpegQuality: 0.94,
  level: false,         // 水平仪（默认关，需要时点开）
  ev: 0,                // 硬件曝光补偿（不是所有机型都支持）
  autoTone: true,       // 自动影调：过曝归位 + 黑场白场归位
  bright: 0,            // 手动亮度补偿，-30 ~ +30（百分比）
  videoRot: 'auto'      // 画面方向：auto | 0 | 90 | 270
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
  // 位置从两段式（bottom/br/top）扩成四角，旧值做等价映射
  const POS_MAP = { bottom: 'bl', top: 'tl' };
  if (POS_MAP[s.pos]) s.pos = POS_MAP[s.pos];
  if (!['bl', 'br', 'tl', 'tr'].includes(s.pos)) s.pos = 'bl';
  if (!['720', '1080', '1440'].includes(String(s.size))) s.size = '1080';
  // 视野：默认「填满」。
  // 旧版默认「完整」（contain），4:3 的流塞进取景框后会缩成中间一条，
  // 看着就是「取景框怎么这么小」；1.4.7 起默认填满，并把还停在
  // 「完整」的老设置一次性迁过来（之后用户自己改回去就不再干预）。
  if (Number(s.viewMigrated) < 2) { s.view = 'fill'; s.viewMigrated = 2; }
  if (!['fill', 'wide'].includes(s.view)) s.view = 'fill';
  // 老用户的设置里没有这个字段，必须显式补 true，否则 Object.assign 之后是 undefined
  // EV 一律不继承历史值。
  // ------------------------------------------------------------
  // 这个字段是「硬件曝光补偿」，滑到 +2 就是实打实多曝两档，画面必白。
  // 之前它被持久化，用户为了「亮一点」拉过一次之后，每次启动都带着 +2，
  // 于是「怎么拍都发白」—— 这是反馈里最冤的一个坑。
  // 曝光补偿属于「当下场景的临时判断」，不该跨会话记忆。
  s.ev = 0;
  if (!['auto', '0', '90', '270'].includes(String(s.videoRot))) s.videoRot = 'auto';
  // 成片尺寸：旧版只有 high/standard 两档，standard 等价迁到长边 960（≈0.7MP）。
  if (!s.stillMigrated) {
    s.still = s.quality === 'standard' ? '960' : 'auto';
    s.stillMigrated = true;
  }
  // 现在存的是档位 id（'12' / '4k' / '1080' / 'vga'…）。
  // 老版本存的 12 / 8 / 5 / 2 正好也是新档位 id（12MP/8MP/5MP/2MP），
  // 语义一致，直接沿用；其它认不出的值一律归 auto。
  if (s.still !== 'auto' && !/^[0-9a-z]{1,4}$/i.test(String(s.still))) s.still = 'auto';
  // 1.4.8：窗口改成系统真旋转（fullSensor），画面方向由 display rotation
  // 决定。老版本里为了把躺倒的画面扳正而手动设过 90/270 的，一次性清回
  // auto，否则会和系统旋转叠成 180°（「UI 倒了 / 画面不跟着转」的源头之一）。
  if (!s.videoRotMigrated) { s.videoRot = 'auto'; s.videoRotMigrated = true; }
  if (typeof s.full !== 'boolean') s.full = false;
  return s;
}

/* 成片尺寸档位。
   ------------------------------------------------------------
   全是摄像头真正会给出的标准 4:3 分辨率（这台相机的取景本来就是 3:4 /
   4:3，用 16:9 的档位只会被裁成 4:3，名不副实，所以不列）。
   列表按 `getCapabilities()` 报的最大分辨率过滤：设备给不到的档位不显示。
   出片只约束「长边」—— 横拍 1920×1440、竖拍 1440×1920，像素一样多，
   只是方向不同（大小固定，方向改变）。
   auto 返回 null，表示「设备能给多大就给多大」。 */
const STILL_STEPS = [
  { id: '12', name: '12MP', w: 4000, h: 3000 },
  { id: '8', name: '8MP', w: 3264, h: 2448 },
  { id: '5', name: '5MP', w: 2592, h: 1944 },
  { id: '3', name: '3MP', w: 2048, h: 1536 },
  { id: '2', name: '2MP', w: 1920, h: 1440 },
  { id: '1', name: '1MP', w: 1280, h: 960 },
  { id: 'vga', name: 'VGA', w: 640, h: 480 }
];
const STILL_DEFAULT = ['2', '1', 'vga'];

function stillSteps() {
  const capW = (caps.width && caps.width.max) || 0;
  const capH = (caps.height && caps.height.max) || 0;
  const capLong = Math.max(capW, capH);
  const capPx = capW * capH;
  // 摄像头还没打开（capabilities 为空）时先给一组最常用的标准档，
  // 打开相机后按真实能力重建一次。
  if (!capLong) return STILL_STEPS.filter(s => STILL_DEFAULT.includes(s.id));
  return STILL_STEPS.filter(s => {
    const long = Math.max(s.w, s.h);
    // 长边压 4000：再大 WebView 的预览输出多半不支持，抓帧反而失败
    if (long > Math.min(capLong, 4000)) return false;
    // 像素总数也不能超过设备上限（避免 4K 这种宽高比不同导致的越界）
    if (capPx && s.w * s.h > capPx * 1.02) return false;
    return true;
  }).sort((a, b) => b.w * b.h - a.w * a.h);
}

function stillTarget() {
  const st = STILL_STEPS.find(x => x.id === String(S.still));
  if (!st) return null;
  return { long: Math.max(st.w, st.h), w: st.w, h: st.h };
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

/* ---------- 停流占位 ----------
   srcObject 一置空，WebView 就把 <video> 画成自带的「灰底 + 巨大播放箭头」。
   切后台、换镜头、改预览尺寸都会走到这里，于是用户切回来就看见那张丑图。
   办法：停流**之前**抓一帧存成 <img>，盖在上面；video 隐藏。 */
function setLive(on) {
  if (!stage) return;
  stage.classList.toggle('nolive', !on);
}

function grabPoster() {
  const p = $('#poster');
  if (!p) return;
  if (!video.videoWidth || !video.videoHeight) return;
  // 手动指定过画面旋转的机型，这里的坐标换算容易出错，直接放弃抓帧，
  // 退回纯色底（总比 WebView 的播放按钮好看）
  if (videoRotDeg()) return;

  // 只抓「画面」那一块，不是整张卡片：视野选完整时上下有留边，
  // 把留边也抓进去会让静态帧看起来比实时画面更宽。
  const fr = frameRect();
  const W = fr.w, H = fr.h;
  if (!W || !H) return;

  const vw = video.videoWidth, vh = video.videoHeight;
  const k = Math.min(1, 600 / Math.max(W, H));
  const cw = Math.max(2, Math.round(W * k));
  const ch = Math.max(2, Math.round(H * k));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#0a0e17';
  ctx.fillRect(0, 0, cw, ch);

  // 与 CSS 的 object-fit 保持一致：fill 用 cover 裁边，wide 用 contain 铺满那块矩形
  const cover = S.view !== 'wide';
  const s = cover ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
  const dw = vw * s, dh = vh * s;
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  if (facing === 'user') ctx.scale(-1, 1);
  try { ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh); } catch (e) { ctx.restore(); return; }
  ctx.restore();

  // 水印是画在 overlay 上的独立图层，不一起烤进去的话，
  // 切后台那一刻水印会「消失」，看起来像画面断了一截。
  // overlay 与画面区域同尺寸，直接 1:1 贴上去。
  const ov = $('#overlay');
  if (ov && ov.width) {
    try { ctx.drawImage(ov, 0, 0, cw, ch); } catch (e) {}
  }

  // 静态帧也只占画面那块，位置跟着 frameRect 走
  p.style.left = fr.x + 'px';
  p.style.top = fr.y + 'px';
  p.style.width = W + 'px';
  p.style.height = H + 'px';

  // 切后台时同步执行，0.78 的质量在 600px 上大约 40~60KB，代价可接受
  try { p.src = c.toDataURL('image/jpeg', 0.78); } catch (e) {}
}

function stopStream() {
  stopToneLoop();
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  trackRef = null;
  imageCapture = null;
  // 必须解绑：留着已经结束的 srcObject，video 会一直显示最后一帧（或全黑），
  // 用户看到的就是「卡住」，而按快门抓到的正是这张死帧。
  try { video.pause(); } catch (e) {}
  try { video.srcObject = null; } catch (e) {}
}

/* 重开一路流。设备 id 可能已经轮换（例如外接摄像头被拔掉），失败就退回默认镜头 */
async function restartCamera() {
  stopStream();
  await sleep(80);
  let ok = false;
  if (curDeviceId) ok = await startCamera(curDeviceId);
  if (!ok) ok = await startCamera(null);
  return ok;
}

/* 预览流约束。
   ------------------------------------------------------------
   旧值请求 2560×1920（4:3 横向），WebView 实际回的是 1920×2560 —— 4.9MP 的流。
   这个尺寸 Android WebView 推不到 30fps，而且掉帧之后每一帧的曝光积分时间被拉长，
   于是三个症状一起出现：卡（帧率低）、糊（长时间曝光带来运动模糊）、
   发白（同一场景下更长的积分 = 更高的平均亮度）。
   原生相机的做法本来就是「预览用低分辨率保流畅，拍照走满幅」，这里照做。 */
/* ---------- 屏幕刷新率 ----------
   Web 没有 API 能直接读屏幕 Hz，但 rAF 的回调节奏就是屏幕的刷新节奏：
   120Hz 屏每 8.3ms 回调一次，60Hz 是 16.7ms。取 30 帧间隔的中位数再吸附到
   常见档位，就能把 60 / 90 / 120 分出来（偶发掉帧不会误判）。 */
let screenHz = 0;
let renderFps = 0;

function detectRefreshRate() {
  return new Promise(res => {
    const gaps = [];
    let last = 0, n = 0;
    const tick = ts => {
      if (last) gaps.push(ts - last);
      last = ts;
      if (++n < 31) { requestAnimationFrame(tick); return; }
      if (!gaps.length) { res(60); return; }
      gaps.sort((a, b) => a - b);
      const med = gaps[Math.floor(gaps.length / 2)] || 16.7;
      const raw = 1000 / med;
      const cand = [30, 48, 60, 90, 120, 144];
      let best = 60, diff = 1e9;
      for (const c of cand) {
        const d = Math.abs(c - raw);
        if (d < diff) { diff = d; best = c; }
      }
      res(diff < 7 ? best : Math.round(raw));
    };
    requestAnimationFrame(tick);
  });
}

/* 摄像头预览的实际上限普遍是 60fps，屏幕再高也没用；
   屏幕本身只有 30Hz（省电模式）时就没必要硬拉。 */
function targetFps() {
  const hz = screenHz || 60;
  return hz < 45 ? Math.max(24, hz) : 60;
}

/* ---------- 预览流约束 ----------
   两个历史包袱都在这里，别改回去：

   ① 尺寸一律按 **4:3 横版** 要。传感器是横的，WebView 能给的整幅档位也是
     1440×1080 / 1920×1080 这一类。以前按竖版 810×1080 要，浏览器为了填满
     竖框，会从整幅里**裁**出中间一条交给你 —— 这就是「视角被拉近 2 倍多」
     的真正原因，跟 CSS 的 cover 无关。

   ② 绝不给 aspectRatio。理由同上：它会让浏览器用裁切来凑比例。

   帧率按屏幕刷新率给，用户那块 120Hz 屏不该只跑 30。 */
/* 横屏时如果摄像头仍给竖版的流（部分机型不跟 display rotation 走），
   取景框是宽的、流是高的，cover 会把画面横向放大成中间一条竖带 ——
   看起来就是「视角根本没切换」。这时候把请求的宽高对调再要一次。
   只做一次（用 key 记住这个方向已经试过），避免来回重启摄像头。 */
let streamFlip = false;
let aspectFixKey = '';
let streamFixTimer = 0;

function streamConstraint() {
  // 预览流固定要横版 4:3，不跟方向换成竖版。
  // 原因：WebView 遇到「竖版请求」时会自己从传感器画面中心裁一块出来，
  // 等效 1.8~2.4 倍数码变焦 —— 之前「视角比原生相机近一大截」就是这么来的。
  // 竖拍要的竖版流只在按快门那一刻临时协商（见 grabHiRes），预览不受影响。
  let h = Number(S.size) || 1080;
  let w = Math.round(h * 4 / 3);
  if (streamFlip) { const t = w; w = h; h = t; }
  return {
    width: { ideal: w },
    height: { ideal: h },
    frameRate: { ideal: targetFps(), min: 24 }
  };
}

/* 打开相机可能被多处同时触发：启动、切前后摄、改尺寸、从后台回来。
   并发时后一次 getUserMedia 会和前一次抢同一个摄像头，表现就是「卡住不动」。
   用一个代次号把过期的启动请求全部作废。 */
let startSeq = 0;
let camStarting = false;

/* 打开一路流，失败就逐级降级。
   有些设备（包括浏览器自带的假摄像头）不接受「分辨率 + 帧率」这种复合约束，
   会直接抛 OverconstrainedError —— 表现就是「没找到可用摄像头」。
   降级顺序：完整约束 → 只保留尺寸 → 只要能出画面。 */
async function openStream(deviceId, video0) {
  const base = () => (deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } });
  const tries = [
    video0,
    Object.assign(base(), { width: { ideal: video0.width.ideal }, height: { ideal: video0.height.ideal } }),
    base()
  ];
  let lastErr = null;
  for (const v of tries) {
    try {
      const got = await navigator.mediaDevices.getUserMedia({ audio: false, video: v });
      if (got && got.getVideoTracks().length) return got;
      got && got.getTracks().forEach(t => t.stop());
    } catch (e) {
      lastErr = e;
      // 权限被拒就别再试了，降级也打不开
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
    }
  }
  throw lastErr || new Error('NotFoundError');
}

async function startCamera(deviceId, opts) {
  const keepLenses = !!(opts && opts.keepLenses);
  if (typeof deviceId !== 'string') deviceId = null;
  const seq = ++startSeq;
  camStarting = true;
  hideGuard();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showGuard('当前环境不支持直接调用相机。点左下角「相册」可以导入照片加印。', '重试');
    return false;
  }

  // 先把上一帧留下来遮住 video，再停流 —— 顺序反了就会闪一下播放按钮
  grabPoster();
  setLive(false);
  stopStream();
  try {
    const video0 = Object.assign({}, streamConstraint());
    if (deviceId) video0.deviceId = { exact: deviceId };
    else video0.facingMode = { ideal: facing };

    const got = await openStream(deviceId, video0);
    if (seq !== startSeq) {
      // 期间又有人发起了新的启动，这次的流直接扔掉，否则两路流会打架
      got.getTracks().forEach(t => t.stop());
      return false;
    }
    stream = got;
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
    // 等首帧真正上屏再撤占位图，否则会黑闪一下
    await new Promise(res => {
      if (video.readyState >= 2) return res();
      let done = false;
      const fin = () => { if (done) return; done = true; res(); };
      try { video.addEventListener('loadeddata', fin, { once: true }); } catch (e) {}
      setTimeout(fin, 700);
    });
    setLive(true);
    applyVideoTransform();
    layoutStage();
    startToneLoop();
    applyEv(S.ev);

    await setupFocus(track);
    await setupZoom(track);

    updateToolCaps();
    // 摄像头开了才知道它真支持到多大，这时候重建一次「图片尺寸」档位
    renderStillSeg();
    camStarting = false;
    // 首帧稳定后校验一次「流的方向和窗口方向是否一致」，不一致会自己修
    setTimeout(checkStreamOrient, 700);
    return true;
  } catch (err) {
    camStarting = false;
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

/* 预览层变换：镜像 + 裁切变焦 + 画面方向校正 */
function videoRotDeg() {
  if (S.videoRot && S.videoRot !== 'auto') {
    const n = Number(S.videoRot);
    return (n === 90 || n === 270) ? n : 0;
  }
  // 自动 = 信任 WebView 的 display rotation（Android 上它会把 sensor 帧转到
  // 屏幕方向再交给 <video>），这里不再二次旋转。
  // 少数机型不做旋转，画面会躺 90°，用设置里的「画面方向」手动扳正即可。
  return 0;
}

function applyVideoTransform() {
  const rot = videoRotDeg();
  const parts = [];
  if (rot) {
    // 旋转后宽高要对调，否则画面会被拉成长条。--vsw/--vsh 由 layoutStage 写入。
    video.style.position = 'absolute';
    video.style.left = '50%';
    video.style.top = '50%';
    video.style.width = 'var(--vsh, 100%)';
    video.style.height = 'var(--vsw, 100%)';
    parts.push('translate(-50%,-50%)');
    parts.push('rotate(' + rot + 'deg)');
  } else {
    video.style.position = '';
    video.style.left = '';
    video.style.top = '';
    video.style.width = '';
    video.style.height = '';
  }
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
  const fr = frameRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  // 点在留边上时按最近的画面边界算，别把归一化坐标算出 [0,1] 之外
  const x = Math.min(1, Math.max(0, (px - fr.x) / fr.w));
  const y = Math.min(1, Math.max(0, (py - fr.y) / fr.h));
  focusAt(x, y, px, py);
});

let focusLocked = false;

/* ---------- 自动对焦 ----------
   之前只有点画面才触发一次对焦，其余时间完全靠摄像头的默认行为。
   不少 Android WebView 默认给的是固定焦点或微距，远景一直糊，
   用户感受就是「这个相机不会对焦」。
   这里按能力协商：支持连续对焦就开连续；只支持单次/自动就每 3 秒补一脚。 */
let autoFocusTimer = 0;

async function setupFocus(track) {
  if (autoFocusTimer) { clearInterval(autoFocusTimer); autoFocusTimer = 0; }
  if (!track || !track.applyConstraints) return;
  const modes = (track.getCapabilities && track.getCapabilities().focusMode) ||
    (caps && caps.focusMode) || [];
  if (!modes.length) return;

  if (modes.includes('continuous')) {
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      // 有些机型会「接受」约束但不执行，读回来对不上就不认
      const got = track.getSettings && track.getSettings().focusMode;
      if (got === 'continuous') return;
    } catch (e) {}
  }

  const one = modes.includes('single-shot') ? 'single-shot'
    : (modes.includes('auto') ? 'auto' : null);
  if (!one) return;
  const kick = () => {
    if (document.hidden || !trackRef || trackRef !== track) return;
    track.applyConstraints({ advanced: [{ focusMode: one }] }).catch(() => {});
  };
  kick();
  autoFocusTimer = setInterval(kick, 3000);
}

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
/* 方向状态。
   ------------------------------------------------------------
   1.4.8 起壳的 screenOrientation 是 10（fullSensor）：四个方向全跟随
   重力，而且**无视系统「自动旋转」开关**。所以正常路径是系统自己转窗口，
   摄像头也跟着给横版的流，我们什么都不用转。

   1.4.7 用的是 13（fullUser），它会尊重用户的旋转锁 —— 手机上关掉自动
   旋转的人，窗口永远不动，界面只能自己 CSS 转 90°，于是「UI 倒了、
   视角没转」全来了。这是那一版翻车的真正原因。

   现在的原则：**能不自己转就不自己转**。
     · 窗口真的横了（innerWidth > innerHeight）→ 什么都不做；
     · 陀螺仪说横了、窗口还没转 → 先等 380ms 看系统转不转，转了就算了，
       没转（个别 ROM 不给面子）才 CSS 转 90° 兜底。
   转的时候方向按重力算，转错会上下颠倒 —— 这里修过一次符号。 */
const orient = {
  auto: true,       // 是否跟随设备
  q: 0,             // 设备姿态：0 竖 / 90 / -90 横 / 180 倒置
  lockedQ: 0,       // 锁定时的方向
  cand: 0, candN: 0,// 候选方向与连续命中次数（防抖）
  hasSensor: false
};

let selfRot = 0;          // 我们自己把 #app 转了多少度（0 = 没转）
let logicalLand = false;  // 当前界面按横屏还是竖屏排版
let pendLand = null;      // 设备已经转过去、但系统窗口还没转的过渡态
let rotTimer = 0;
let animTimer = 0;

function winLand() { return window.innerWidth > window.innerHeight; }
function deviceLand() { return orient.q === 90 || orient.q === -90; }

/* 目标方向。
   ------------------------------------------------------------
   关键：**窗口方向永远优先**。壳是 fullSensor，系统自己会转窗口，
   而且它比我们晚 3 帧的陀螺仪读数更可靠。只有「陀螺仪说转了、窗口
   还没转」这个过渡态（pendLand）才听传感器的 —— 那是给自己留的
   兜底，用来在个别不转窗口的 ROM 上手动 CSS 转 90°。
   以前这里让传感器盖过窗口，结果系统刚转完、陀螺仪还是旧值时，
   界面又被反向转回去，就成了「UI 倒过来」。 */
function targetLand() {
  if (!orient.auto) return orient.lockedQ === 90 || orient.lockedQ === -90;
  if (pendLand !== null) return pendLand;
  return winLand();
}

/* 当前界面按哪个方向排版 */
function isLandscape() { return logicalLand; }

/* #app 的布局空间。自己转过 90° 时 CSS 把宽高换成了 100vh/100vw，
   这时去量 clientWidth 会读到旋转前的旧值（取景框被压成一小条就是
   这么来的），所以直接用视口尺寸推算，不依赖任何测量。 */
function appSpace() {
  return selfRot
    ? { w: window.innerHeight, h: window.innerWidth }
    : { w: window.innerWidth, h: window.innerHeight };
}

/* 归一到 0 / ±90（180 在相机里等于正立） */
function toQuarter(deg) {
  const d = ((Math.round((deg || 0) / 90) * 90) % 360 + 360) % 360;
  if (d === 90) return 90;
  if (d === 270) return -90;
  return 0;
}

function applyOrientation(opts) {
  const gyro = !!(opts && opts.gyro);
  const want_land = targetLand();

  // 自己转的角度：只有「目标方向和窗口方向不一致」时才需要转
  let want = 0;
  if (want_land !== winLand()) {
    const q = (orient.q === 90 || orient.q === -90) ? orient.q : 90;
    // 设备横着、窗口还竖着 → 按重力方向转 ±90（截图验证过：方向取反就会
    // 上下颠倒）。窗口横、目标竖（少见）→ 反过来转。
    want = want_land ? q : -q;
  }

  // 陀螺仪先报「横了」，窗口可能下一帧才转。这时候立刻自己转 90° 就会
  // 出现「先闪一下转过去、再被系统转回来」的双重旋转，看起来又卡又乱。
  // 先等 380ms：系统转了 resize 会来，自己就不用转了。
  if (gyro && want !== selfRot) {
    clearTimeout(rotTimer);
    rotTimer = setTimeout(() => { rotTimer = 0; applyOrientation(); }, 380);
    return;
  }
  clearTimeout(rotTimer);
  rotTimer = 0;

  selfRot = want;
  logicalLand = want ? want_land : winLand();

  const body = document.body;
  body.classList.toggle('q90', want === 90);
  body.classList.toggle('q270', want === -90);
  body.classList.toggle('selfrot', want !== 0);
  body.classList.toggle('land', logicalLand);

  // 旋转时把 #app 的宽高写成显式像素，别让 CSS 的 100vh/100vw 在某些
  // WebView 上算偏（写死之后 layoutStage 的推算和实际盒子一定一致）
  const appEl = $('#app');
  if (appEl) {
    if (want) {
      appEl.style.width = window.innerHeight + 'px';
      appEl.style.height = window.innerWidth + 'px';
    } else {
      appEl.style.width = '';
      appEl.style.height = '';
    }
  }

  // 旋转会改变可用宽高，等一帧再排。排之前先挂上 .layout-anim，
  // 让取景框尺寸 / 控件位移走 260ms 缓动 —— 直接跳变看着太生硬。
  requestAnimationFrame(() => {
    document.body.classList.add('layout-anim');
    layoutStage();
    renderOverlay();
    paintStyleThumbs();
    clearTimeout(animTimer);
    animTimer = setTimeout(() => document.body.classList.remove('layout-anim'), 460);
  });

  // 横屏后如果摄像头给的还是竖版的流（cover 会横向放大成一条竖带，
  // 看起来就是「视角没切换」），补一次校正。延迟一点，等首帧到。
  clearTimeout(streamFixTimer);
  streamFixTimer = setTimeout(checkStreamOrient, 420);
}

/* 横屏后校验一眼：摄像头给的流有没有跟着转过来。
   横取景框 + 竖流的组合在 cover 下会被放大成中间一条竖带，也就是用户说的
   「切到横屏了但视角没切换」。发现这种情况就把请求宽高对调重启一次。 */
function checkStreamOrient() {
  if (!video.videoWidth || !video.videoHeight) return;
  if (camStarting || resuming || busy) return;
  if (!(video.videoHeight > video.videoWidth && winLand())) return;
  const key = (winLand() ? 'L' : 'P') + (selfRot ? 's' : 'n');
  if (aspectFixKey === key) return;
  aspectFixKey = key;
  streamFlip = !streamFlip;
  if (!video.srcObject) return;
  startCamera(curDeviceId, { keepLenses: true });
}

/* 重力单位向量（W3C DeviceOrientation 规范）。
   竖立正对用户 → beta≈90，gy≈-1；左右横放 → gamma≈±90，gx≈∓1。 */
function gravityOf(beta, gamma) {
  const b = (beta || 0) * Math.PI / 180;
  const g = (gamma || 0) * Math.PI / 180;
  return {
    gx: -Math.cos(b) * Math.sin(g),
    gy: -Math.sin(b),
    gz: Math.cos(b) * Math.cos(g)
  };
}

function angleFromGravity(gx, gy) {
  const mag = Math.hypot(gx, gy);
  if (mag < 0.5) return -1;         // 手机平放，陀螺仪对横竖没有发言权
  if (Math.abs(gy) >= Math.abs(gx)) {
    return gy < 0 ? 0 : 180;        // 正立 / 倒置
  }
  // gx>0：重力落在机身右侧 → 右边朝下 → 顶部朝左横放
  return gx > 0 ? 90 : -90;
}

let orientBound = false;
function initOrientation() {
  if (orientBound) return;
  orientBound = true;

  const onOrient = (e) => {
    if (e.beta == null && e.gamma == null) return;
    orient.hasSensor = true;
    const { gx, gy } = gravityOf(e.beta, e.gamma);
    const q = angleFromGravity(gx, gy);
    if (q === -1) return;               // 平放，保持上一次的姿态
    if (q === orient.cand) orient.candN++;
    else { orient.cand = q; orient.candN = 1; }
    if (orient.candN < 3) return;       // 连续 3 帧同一方向才认，防手抖
    if (q === orient.q) return;
    orient.q = q;
    if (!orient.auto) return;

    const dLand = deviceLand();
    if (dLand === winLand()) {
      // 系统已经转过来了（或本来就方向一致），不需要自己转
      pendLand = null;
      applyOrientation();
      return;
    }
    // 设备转了、窗口没转：先挂起，等 380ms 看系统转不转
    pendLand = dLand;
    applyOrientation({ gyro: true });
  };

  window.addEventListener('deviceorientation', onOrient, true);
  // 窗口尺寸变了（系统旋转窗口 / 分屏 / 桌面端拉伸）→ 立刻重排。
  // 只有窗口方向真的跟 pendLand 一致了，才作废「等系统转」的状态；
  // 软键盘之类不改方向的 resize 不能把兜底旋转给取消掉。
  window.addEventListener('resize', () => {
    clearTimeout(rotTimer);
    rotTimer = 0;
    if (pendLand !== null && winLand() === pendLand) pendLand = null;
    applyOrientation();
  });
  // 个别 WebView 转窗口时不发 resize，只发 orientationchange
  window.addEventListener('orientationchange', () => {
    setTimeout(applyOrientation, 60);
  });
}

/* 授权：iOS 13+ 需要用户手势里显式申请；Android WebView 直接可用。 */
async function requestOrientPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    try {
      const r = await D.requestPermission();
      return r === 'granted';
    } catch (e) { return false; }
  }
  return true;
}

function setOrientAuto(on) {
  orient.auto = on;
  pendLand = null;
  if (!on) {
    // 锁的是「现在看到的这个方向」，而不是陀螺仪读数（手机平放时读数是 0）
    orient.lockedQ = logicalLand
      ? ((orient.q === 90 || orient.q === -90) ? orient.q : 90)
      : 0;
    toast('已锁定：' + (orient.lockedQ ? '横屏' : '竖屏') + '（手机转动不再跟随）');
  } else {
    toast('已恢复自动旋转');
  }
  document.body.classList.toggle('orient-lock', !on);
  applyOrientation();
  syncTools();
}

/* 全屏取景（手动开关）。
   ------------------------------------------------------------
   非全屏：顶栏 / 工具条 / 快门都在文档流里各占一行，画面拿到剩下的
   全部高度；手机横过来时窗口自己转（screenOrientation=fullSensor），
   界面按横屏正常排版，水印自动挪到空着的角落 —— 旋转的意义只是「换个
   水印位置」，不折腾界面。
   全屏：顶栏、工具条、快门全部变成浮层压在画面上，取景吃满整屏，
   竖屏横屏都成立。 */
function setFull(on) {
  S.full = !!on;
  saveSettings();
  document.body.classList.toggle('full', S.full);
  applyOrientation();
  syncTools();
  toast(S.full ? '全屏取景（点右上角按钮退出）' : '已退出全屏');
}

function layoutStage() {
  const land = logicalLand;
  const rot = selfRot !== 0;
  const full = !!S.full;
  const cs = getComputedStyle(stageWrap);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  const padB = parseFloat(cs.paddingBottom) || 0;

  let availW, availH;
  if (rot || full) {
    // 自己转过 90°：元素盒子的宽高已经被换成 (视口高, 视口宽)，
    // 这时量 clientWidth 会拿到旋转前的旧值，必须用视口尺寸推算。
    // 全屏同理：取景要吃满整屏，不按文档流里剩下的高度算。
    const sp = appSpace();
    availW = sp.w - padL - padR;
    availH = sp.h - padT - padB;
    if (!land && !full) {
      // 锁成竖屏但窗口是横的：顶栏/工具条/快门还在文档流里
      const appCs = getComputedStyle($('#app'));
      availH -= parseFloat(appCs.paddingTop) || 0;
      ['topbar', 'bars', 'controls'].forEach(c => {
        const el = $('.' + c);
        if (el) availH -= el.offsetHeight;
      });
    }
  } else {
    availW = stageWrap.clientWidth - padL - padR;
    availH = stageWrap.clientHeight - padT - padB;
    // 工具条现在竖屏横屏都待在文档流里（横屏不再搬去左侧黑边），
    // 它占掉的那一行必须从可用高度里扣出来，否则取景框会顶到它底下。
    const bar = $('.bars');
    if (bar) availH -= bar.offsetHeight + 10;
  }
  if (availW <= 0 || availH <= 0) return;

  // 取景框尺寸固定、方向跟着转 —— 不是「横屏就把框拉成一条扁带」。
  //   竖屏：3:4，按宽度撑开；
  //   横屏：4:3，就是竖屏那张框转 90°，按高度反算（宽度不会被拉满）；
  //   全屏：铺满整屏（全屏本来就是「画面最大」的模式）。
  // 注意不是「按视频流比例排版」：那会让 4:3 的流在竖屏里缩成一条矮带。
  let w, h;
  if (full) {
    w = availW;
    h = availH;
  } else if (land) {
    const targetR = 4 / 3;
    h = availH;
    w = h * targetR;
    if (w > availW) { w = availW; h = w / targetR; }
  } else {
    const targetR = 3 / 4;
    w = availW;
    h = w / targetR;
    if (h > availH) { h = availH; w = h * targetR; }
  }

  const W = Math.round(w), H = Math.round(h);
  if (stage.style.width !== W + 'px') stage.style.width = W + 'px';
  if (stage.style.height !== H + 'px') stage.style.height = H + 'px';
  // 画面方向校正需要知道取景框的实际尺寸（旋转后宽高对调）
  stage.style.setProperty('--vsw', W + 'px');
  stage.style.setProperty('--vsh', H + 'px');
  // 视野：wide 时 video 用 contain（整幅都看得见，代价是留边）
  stage.classList.toggle('view-wide', S.view === 'wide');

  // 横屏不再重排界面：工具条、快门、顶栏都留在竖屏时的位置上，
  // 唯一的变化是取景框按 4:3 重算、水印按旋转后的方向落到同一个角。
  applyVideoTransform();
  renderOverlay();
}

let uiCode = '';

function isTopPos(p) { return p === 'top' || p === 'tl' || p === 'tr'; }
function isRightPos(p) { return p === 'br' || p === 'tr'; }

/* 水印落点 = 用户选的那个角，旋转不改。
   横屏时画面整体转了 90°，水印跟着画面一起转，落在「旋转之后的那个角」
   —— 左下还是左下，只是屏幕上的物理位置跟着转。这就是用户要的
   「按旋转方向旋转，并移动到左下位置」。
   以前横屏会自动跳到右上角，结果「右下角的水印转一下跑到右上角」，
   一眼就看出不对，已经去掉了。 */
function effPos() {
  return S.pos;
}

/* 画面在取景框里实际占的那块矩形。
   视野选「完整」（contain）时上下或左右会留边，水印必须落在**画面**里，
   否则会飘到留边上，看起来悬空、还压不到实景。 */
function frameRect() {
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return { x: 0, y: 0, w: W || 1, h: H || 1 };
  const vw = video.videoWidth, vh = video.videoHeight;
  if (S.view !== 'wide' || !vw || !vh) return { x: 0, y: 0, w: W, h: H };
  const s = Math.min(W / vw, H / vh);
  if (!isFinite(s) || s <= 0) return { x: 0, y: 0, w: W, h: H };
  const w = Math.round(vw * s), h = Math.round(vh * s);
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
}

function renderOverlay() {
  if (!video.videoWidth || document.hidden) return;
  // overlay 只盖住画面本身，不盖整张取景框卡片 ——
  // 这样水印的「左下角」就是画面的左下角，和成片一致
  const fr = frameRect();
  const W = fr.w, H = fr.h;
  if (!W || !H) return;

  // dpr 以前被钳在 2，可多数安卓机是 2.75 / 3 —— canvas 按 2 倍渲染，
  // 再被浏览器放大到 3 倍物理像素上显示，水印文字的边缘就被拉出一圈
  // 灰白色的雾（用户说的「文字雾化」「底部白雾」就是这个）。
  // 现在跟到真实 dpr（上限 3），同时给总像素封顶，避免大屏全屏吃爆内存。
  let dpr = Math.min(window.devicePixelRatio || 1, 3);
  const MAX_PX = 1.2e7;
  if (W * H * dpr * dpr > MAX_PX) dpr = Math.sqrt(MAX_PX / (W * H));
  const pw = Math.round(W * dpr);
  const ph = Math.round(H * dpr);
  if (overlay.width !== pw || overlay.height !== ph) {
    overlay.width = pw;
    overlay.height = ph;
    overlay.style.width = W + 'px';
    overlay.style.height = H + 'px';
  }
  overlay.style.left = fr.x + 'px';
  overlay.style.top = fr.y + 'px';
  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const d = WM.buildData(displayBase(liveBase()), S, uiCode);
  // 水印配色固定：不再按底图明暗自动切深/浅墨水。
  // 自动切换的问题是在浅色墙面/白纸前会突然变成深色字，同一台机器同一个
  // 角落来回跳，看着像「水印在变色」。现在一律用深底白字那套。
  const pos = effPos();
  const ink = 'dark';
  // 只有全屏才给界面让位：顶栏、工具条、快门都变成浮层压在画面上，
  // 贴角的水印会被盖住。非全屏时控件都在画面之外（横屏也一样，不搬位置），
  // 水印老老实实贴角就行。
  ctx.save();
  if (S.full) {
    const topEl = $('.topbar'), botEl = $('.controls');
    const topH = topEl ? topEl.offsetHeight : 0;
    const botH = botEl ? botEl.offsetHeight : 0;
    const shift = isTopPos(pos) ? topH + 12 : -(botH + 10);
    if (shift) ctx.translate(0, shift);
  }
  // 预览水印按画面短边缩放（成片同一套算法）。横屏取景框短边只有 270 左右，
  // 直接按比例算会比竖屏小一圈、贴角看着像「缩进角落的小字」。
  // 给预览一个最小基准，横竖切过来水印视觉大小才一致（成片不受影响）。
  const shortSide = Math.min(W, H) || 1;
  const wmFix = shortSide < 340 ? 340 / shortSide : 1;
  WM.draw(ctx, W, H, d, { style: S.style, pos, scale: S.wmScale * wmFix, ink, s: S });
  ctx.restore();
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
const devDiag = { stream: '', via: '', raw: '', out: '', tone: null, hz: 0, fps: 0, af: '', sharp: null };
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

/* 取景预览的滤镜。
   ------------------------------------------------------------
   这里原先是无条件给 video 挂 CSS filter。对一个 1920×2560 的视频层
   每帧都跑一遍 GPU 滤镜通道，代价极高 —— 这是「刷新率极低」的第二大来源
   （第一是预览流本身分辨率太高）。
   v1.5：现在只在「确实需要动亮度」时才挂 —— 用户拉过亮度滑块，或者
   自动曝光归位算出的增益明显偏离 1（这时成片会被压暗，预览必须同步，
   否则就是「看着白、拍出来白」各说各话）。阈值 0.10 避免无谓地挂滤镜。 */
function toneFilter() {
  if (!window.WMCTone) return 'none';
  const manual = Math.abs(manualExposure()) > 0.005;
  const gain = tone.lut ? (tone.lut.gain || 1) : 1;
  const autoDamp = !!S.autoTone && Math.abs(gain - 1) > 0.10;
  if (!manual && !autoDamp) return 'none';
  return WMCTone.previewFilter(tone.lut) || 'none';
}

let appliedFilter = 'none';
function applyToneToPreview() {
  const want = toneFilter();
  if (want === appliedFilter) return;      // 不重复写 style，避免触发重排
  appliedFilter = want;
  video.style.filter = want;
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
      ev: +(lut.ev || 0).toFixed(2),
      wb: [lut.gains.r, lut.gains.g, lut.gains.b].map(v => +v.toFixed(2))
    };
  } catch (e) {
    devDiag.tone = 'error: ' + (e && e.message ? e.message : e);
  }
  return canvas;
}

/* 成片锐化。
   预览流在到达我们手里之前已经被低通了好几轮（YUV 转换、纹理缩放、编解码），
   边缘的高频掉了一层 —— 这是「看着软」的直接来源之一。原生相机之所以锐，
   一半功劳在 ISP 出图前的边缘增强；我们拿不到 RAW，只能在合成后补一次
   非锐化掩模。

   顺序很关键：必须在影调之后、画水印之前。
   · 放在影调之前：S 曲线会把锐化产生的过冲再放大，暗部边缘出白边；
   · 放在水印之后：水印文字会被一起锐化，笔画发毛。
   强度随缩放比例微调：被放大过的图原本更软，给得多一点；
   缩小过的本身够紧，给多了显脏。 */
function sharpenCanvas(canvas, raw) {
  if (!window.WMImg || !WMImg.unsharp) return canvas;
  try {
    const srcW = (raw && raw.w) || 0;
    const ratio = srcW ? canvas.width / srcW : 1;
    let amount = 0.52;
    if (ratio > 1.05) amount = 0.7;
    else if (ratio < 0.9) amount = 0.42;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = canvas.width * canvas.height;
    // 超过 8.4MP 直接跳过：12MP 逐像素跑一遍 JS 要 600ms 以上，
    // 用户按完快门干等，体感是「卡住」而不是「在处理」。如实标出来。
    if (px > 8.4e6) {
      devDiag.sharp = '跳过（' + (px / 1e6).toFixed(1) + 'MP 太大）';
      return canvas;
    }
    WMImg.unsharp(img, canvas.width, canvas.height, amount, 8.4e6);
    ctx.putImageData(img, 0, 0);
    devDiag.sharp = { amount: +amount.toFixed(2), px: px };
  } catch (e) {
    devDiag.sharp = 'skip: ' + (e && e.message ? e.message : e);
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
/* 实测预览渲染帧率。rAF 的回调节奏就是屏幕真正刷出来的节奏，
   和摄像头给的帧率、WebView 的合成能力都对得上。
   每 8 秒测 1 秒，避免常驻 rAF 白耗电。 */
function startFpsMeter() {
  const once = () => {
    if (document.hidden || !video.srcObject) return;
    let n = 0, t0 = 0;
    const loop = ts => {
      if (!t0) t0 = ts;
      n++;
      if (ts - t0 < 1000) { requestAnimationFrame(loop); return; }
      renderFps = n;
      devDiag.fps = n;
      renderDiag();
    };
    requestAnimationFrame(loop);
  };
  setTimeout(once, 2500);
  setInterval(once, 8000);
}

function renderDiag() {
  const el = document.getElementById('camDiag');
  if (!el) return;
  const t = devDiag.tone;
  const toneTxt = !t ? '—'
    : (typeof t === 'string' ? t
      : 'black ' + t.black + ' / white ' + t.white + ' / γ ' + t.gamma +
        ' / 曝光 ' + (t.ev > 0 ? '+' : '') + (t.ev == null ? 0 : t.ev) + 'EV' +
        (t.wb ? ' / WB ' + t.wb.join(',') : ''));
  el.innerHTML =
    '<div><span>预览流</span><b>' + (devDiag.stream || '—') + '</b></div>' +
    '<div><span>屏幕 / 实际</span><b>' +
      (devDiag.hz ? devDiag.hz + 'Hz' : '—') + ' / ' +
      (devDiag.fps ? devDiag.fps + 'fps' : '—') + '</b></div>' +
    '<div><span>取图</span><b class="' +
      (devDiag.via && devDiag.via.indexOf('video') >= 0 ? 'bad' : '') + '">' +
      (devDiag.via || '—') + (devDiag.raw ? ' · ' + devDiag.raw : '') + '</b></div>' +
    '<div><span>成片</span><b>' + (devDiag.out || '—') + '</b></div>' +
    '<div><span>对焦</span><b>' + (devDiag.af || '—') + '</b></div>' +
    '<div><span>锐化</span><b>' +
      (devDiag.sharp == null ? '—'
        : (typeof devDiag.sharp === 'string' ? devDiag.sharp
          : '强度 ' + devDiag.sharp.amount + ' / ' +
            (devDiag.sharp.px / 1e6).toFixed(1) + 'MP')) + '</b></div>' +
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

async function refreshUiCode() {
  if (document.hidden) return;      // 后台不做无谓的签名
  try {
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

/* ---------------- 成像：对焦收敛 → 连续抓帧 → 择优 ----------------

   之前的实现是 warmUp(3) 之后抓 3 帧，帧间隔 80ms，总共不到 250ms。
   问题是：continuous 对焦模式下，按下快门那一刻镜头经常正在来回拉，
   抓到的是「行程中」的帧 —— 所以同样的场景，有时清楚有时糊。
   用户说的「不稳定」就是这个。

   现在分三步：
   1. 先丢一次单次对焦指令，把镜头从「持续搜索」切到「打一次靶」；
   2. 每 ~90ms 抓一帧并算 ROI 拉普拉斯方差，最多等 700ms，
      分数连续两帧不再上涨就提前收工（AF 收敛通常 150~450ms）；
   3. 在候选里挑分数最高的一帧，不是「最后一帧」。
   ------------------------------------------------------------ */

/* 触发一次单次对焦。连续对焦的镜头在快门瞬间往往正在移动，必须先叫停。 */
async function kickFocusOnce(track) {
  if (!track || !track.applyConstraints) return false;
  const modes = (caps && caps.focusMode) || [];
  const one = modes.includes('single-shot') ? 'single-shot'
    : (modes.includes('auto') ? 'auto' : null);
  if (!one) return false;
  try {
    await track.applyConstraints({ advanced: [{ focusMode: one }] });
    return true;
  } catch (e) {
    return false;
  }
}

/* 等对焦收敛，返回这段时间里最清晰的一帧 */
async function focusBurst(track, opts) {
  const o = opts || {};
  const budget = o.budget == null ? 700 : o.budget;
  const gap = o.gap == null ? 90 : o.gap;
  const minFrames = o.minFrames || 3;

  const kicked = await kickFocusOnce(track);
  const t0 = performance.now();
  const scores = [];
  let stall = 0, lastScore = -1, bestScore = -1, bestQ = null, bestCanvas = null;

  while (true) {
    await nextFrame();
    const c = grabFrame();
    const q = frameQuality(c);
    // 只留最好的那张。12MP 一帧占 48MB，连留五帧在手机上直接 OOM；
    // 被淘汰的路人要立刻释放后备存储，不能等 GC。
    if (q.score > bestScore) {
      if (bestCanvas) { bestCanvas.width = 0; bestCanvas.height = 0; }
      bestScore = q.score; bestCanvas = c; bestQ = q;
    } else {
      c.width = 0; c.height = 0;
    }
    scores.push(q.score);

    // 分数已经封顶且不再上涨，就不必把 700ms 等满
    if (scores.length >= minFrames) {
      if (lastScore > 0 && q.score <= lastScore * 1.02) stall++;
      else stall = 0;
      if (stall >= 2) break;
    }
    lastScore = q.score;
    if (performance.now() - t0 >= budget) break;
    await sleep(gap);
  }

  return {
    canvas: bestCanvas,
    q: bestQ || { score: 0, stats: null },
    frames: scores.length,
    score: bestScore,
    ms: Math.round(performance.now() - t0),
    focused: kicked
  };
}

/* 把采集分辨率临时推到最高再抓帧。
   Android WebView 的 ImageCapture.takePhoto() 在多数机型上只是把当前视频轨
   快照一份，分辨率等于预览流（我们实测输出 1920×1440），拿不到传感器满幅。
   真正的高分辨率只有一条路：重新协商约束，让采集管线按更大的档位出帧。
   抓完立刻恢复预览档位 —— 大分辨率下帧率会掉，不能一直留着。 */
async function grabHiRes(track, target) {
  if (!track || !track.applyConstraints) return null;
  const capW = (caps.width && caps.width.max) || 0;
  const capH = (caps.height && caps.height.max) || 0;
  if (!capW || !capH) return null;

  const curW = video.videoWidth || 0, curH = video.videoHeight || 0;
  const curLong = Math.max(curW, curH);
  // auto（target 为 null）推到设备上限；指定档位就奔目标长边去。
  // 按当前取景方向要对应比例的流：竖拍要竖版（1440×1920），横拍要横版
  // （1920×1440）—— 这样同一个档位横竖拍拿到的长边才一致。
  // 上限压到 4000 宽 / 3000 高：再大 WebView 的预览输出多半不支持，
  // 协商失败反而更糟。
  const capLong = Math.min(capW, Math.round(capH * 4 / 3), 4000);
  const wantLong = Math.min(capLong, target ? Math.max(target.long, curLong) : capLong);
  const short = Math.round(wantLong * 3 / 4);
  let wantW, wantH;
  if (isLandscape()) { wantW = wantLong; wantH = short; }
  else { wantW = short; wantH = wantLong; }
  // 提不上 20% 就没意义，别为几万像素折腾一次黑屏
  if (wantLong < curLong * 1.2) return null;

  const prev = streamConstraint();
  const restore = async () => {
    try {
      await track.applyConstraints({
        width: { ideal: prev.width.ideal },
        height: { ideal: prev.height.ideal },
        frameRate: { ideal: prev.frameRate.ideal }
      });
    } catch (e) {}
    applyVideoTransform();
    layoutStage();
  };

  try {
    // 切换分辨率会让预览黑一下，先把当前这一帧（含水印）抓成静态帧盖住，
    // 快门按下后画面才不会「闪黑 → 复亮」
    try { grabPoster(); } catch (e) {}
    setLive(false);
    await track.applyConstraints({
      width: { ideal: wantW },
      height: { ideal: wantH }
    });
    // 等长边真的变大了，最多 900ms。
    // 按长边判断而不是 videoWidth：竖拍要的是 1440×1920，宽度比原来更小，
    // 拿宽度做判据会永远等不到。
    const t0 = performance.now();
    let ok = false;
    while (performance.now() - t0 < 900) {
      await nextFrame();
      if (Math.max(video.videoWidth, video.videoHeight) >= curLong * 1.2) { ok = true; break; }
    }
    if (!ok) return null;

    // 分辨率变了，AF 要重新走一遍，这里用短一点的窗口
    const r = await focusBurst(track, { budget: 380, gap: 80, minFrames: 2 });
    r.hiRes = video.videoWidth + 'x' + video.videoHeight;
    return r;
  } catch (e) {
    return null;
  } finally {
    await restore();
    setLive(true);
  }
}

async function grabBestImage() {
  await warmUp(2);

  // ① ImageCapture：若能拿到明显大于预览流的位图，说明是真·传感器满幅，
  //    直接用。否则它只是视频轨快照，跟抓帧没有区别，还可能更慢。
  if (imageCapture && typeof imageCapture.takePhoto === 'function') {
    try {
      const blob = await imageCapture.takePhoto();
      const bmp = await createImageBitmap(blob);
      const curW = video.videoWidth || 0, curH = video.videoHeight || 0;
      // 两个条件都要满足才算「真满幅」：
      //   ① 宽高都明显大于预览流（只大一点点的是同一条轨的快照）；
      //   ② 宽高比和预览流接近 —— 有些机型会交一张 16:9 的裁切图，
      //      横向更宽但上下被剪掉，用它反而丢掉画面。
      const bigger = bmp.width >= Math.max(1, curW) * 1.25 &&
        bmp.height >= Math.max(1, curH) * 1.25;
      const sameAspect = curW && curH
        ? Math.abs((bmp.width / bmp.height) - (curW / curH)) < 0.12
        : true;
      if (bigger && sameAspect) {
        return { src: bmp, w: bmp.width, h: bmp.height, via: 'capture', score: 0, stats: statsOf(bmp) };
      }
      // 尺寸和预览流一样，或者比例被裁过 —— 不是满幅，丢掉，走下面的高分辨率路径
      try { bmp.close && bmp.close(); } catch (e) {}
    } catch (e) {
      // 部分 WebView / 机型不支持，静默降级
    }
  }

  // ② 高分辨率：临时把约束推到目标档位（auto 就推到设备上限），抓完恢复。
  //    目标比当前预览还小时不必折腾 —— 预览帧本身就够，多缩一次只是多一道损失。
  const tgt = stillTarget();
  const curLong = Math.max(video.videoWidth || 0, video.videoHeight || 0);
  if (!tgt || tgt.long > curLong * 1.06) {
    const hi = await grabHiRes(trackRef, tgt);
    if (hi) {
      return {
        src: hi.canvas, w: hi.canvas.width, h: hi.canvas.height,
        via: 'hires', score: hi.score, stats: hi.q.stats,
        frames: hi.frames, afMs: hi.ms
      };
    }
  }

  // ③ 预览帧：等对焦收敛后择优
  const b = await focusBurst(trackRef, S.smartPick
    ? { budget: 700, gap: 90, minFrames: 3 }
    : { budget: 120, gap: 60, minFrames: 2 });
  return {
    src: b.canvas, w: b.canvas.width, h: b.canvas.height,
    via: 'video', score: b.score, stats: b.q.stats,
    frames: b.frames, afMs: b.ms
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

/* 把整幅素材转 90°：先转再裁，保证成片方向和取景器里看到的一致 */
function rotateSource(src, deg) {
  const w = src.videoWidth || src.width || 0;
  const h = src.videoHeight || src.height || 0;
  const c = document.createElement('canvas');
  c.width = h;
  c.height = w;
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.translate(h / 2, w / 2);
  x.rotate(deg * Math.PI / 180);
  x.drawImage(src, -w / 2, -h / 2);
  return { src: c, w: h, h: w };
}

/**
 * 合成画布：把取到的图按“所见即所得”画出来
 * 预览里看到什么（含画面方向、前置镜像、变焦裁切、比例裁切），成片就是什么
 */
function composeCanvas(raw) {
  const rot = videoRotDeg();
  if (rot) {
    const r = rotateSource(raw.src, rot);
    raw = Object.assign({}, raw, { src: r.src, w: r.w, h: r.h });
  }
  const vw = stage.clientWidth, vh = stage.clientHeight;
  // 视野「完整」时成片不再按取景框裁：整幅画面都留下，
  // 否则预览里看到的两侧场景拍下来又没了，等于白给。
  // 这时照片比例会跟着摄像头走（可能不是 3:4），是有意的。
  const targetR = (S.view === 'wide' && raw.w && raw.h)
    ? raw.w / raw.h
    : ((vw && vh) ? vw / vh : raw.w / raw.h);

  const rect = coverRect(raw.w, raw.h, targetR);
  const z = (zoom.type === 'crop' && zoom.v > 1) ? zoom.v : 1;
  const zw = rect.w / z;
  const zh = zw / targetR;
  const zx = rect.x + (rect.w - zw) / 2;
  const zy = rect.y + (rect.h - zh) / 2;

  let outW = Math.round(zw);
  let outH = Math.round(zh);
  // 用户指定了尺寸档位：按「长边」约束，只缩不放。
  // 横拍 1920×1440、竖拍 1440×1920 —— 同一个档位转 90°，像素数一样多。
  // 源图本身没那么多像素时放大只是把同样信息摊到更多格子上，看着更糊，
  // 还骗自己「这是 4K」。这种情况保持原尺寸，诊断里如实显示实际值。
  const tgt = stillTarget();
  if (tgt) {
    const long = Math.max(outW, outH);
    if (long > tgt.long) {
      const k = tgt.long / long;
      outW = Math.round(outW * k);
      outH = Math.round(outH * k);
    }
  }
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

  // 水印配色固定（深底白字），不跟着底图明暗变
  const ctx = canvas.getContext('2d');
  const ink = 'dark';

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


/* 抓一帧算平均亮度，用来判断这是不是一张全黑的死帧。
   切后台回来、或刚重新开流时，video 常常还是黑的，这时候出片就是纯黑照片。 */
function frameMean(src) {
  if (!src) return -1;
  try {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return sum / (d.length / 4);
  } catch (e) {
    return -1;   // 读不到就不拦，宁可放行也不要卡住拍摄
  }
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

    // 全黑保护：轨道失效时 grabBestImage 会抓到一张全黑帧，
    // 不拦住就会「点了能拍，但照片全黑」。这里自动重开一次摄像头再抓。
    let mean = frameMean(raw.src);
    if (mean >= 0 && mean < 3.5) {
      devDiag.via = '全黑·重开摄像头';
      renderDiag();
      await restartCamera();
      await sleep(260);
      raw = await grabBestImage();
      mean = frameMean(raw.src);
      if (mean >= 0 && mean < 3.5) {
        toast('摄像头没有画面，已重新打开，请再按一次');
        return;
      }
    }

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
    // 选了固定档位却拿不到那么多像素时，如实标出目标值 ——
    // 否则用户会以为「4K」生效了，实际只有设备能给的那点
    const tgtS = stillTarget();
    if (tgtS && Math.abs(Math.max(canvas.width, canvas.height) - tgtS.long) > 2) {
      devDiag.out += '（目标长边 ' + tgtS.long + '）';
    }
    devDiag.af = raw.afMs != null
      ? (raw.afMs + 'ms / ' + (raw.frames || 1) + '帧')
      : (raw.via === 'capture' ? '原生满幅' : '—');
    applyToneLut(canvas);
    sharpenCanvas(canvas, raw);
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
  // 与预览、成片同一套固定配色，缩略图才不会跟实际出片对不上
  const ink = 'dark';
  grid.querySelectorAll('.style-item').forEach(item => {
    const c = item.querySelector('canvas');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(base, 0, 0, c.width, c.height);
    WM.draw(ctx, c.width, c.height, d, {
      style: item.dataset.style, pos: effPos(), scale: S.wmScale, ink, s: S
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
    swExif: 'writeExif', swSmart: 'smartPick', swGrid: 'grid',
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
  renderStillSeg();                 // 档位按摄像头能力动态生成，再标选中项
  setSeg('segSize', String(S.size));
  setSeg('segView', S.view || 'wide');
  setSeg('segRot', String(S.videoRot || 'auto'));
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

/* 「图片尺寸」档位不写死：全是摄像头真正会给出的标准分辨率，
   再按 getCapabilities 报的最大值过滤 —— 设备给不到的档位直接不列。 */
function renderStillSeg() {
  const box = $('#segStill');
  if (!box) return;
  const list = stillSteps();
  // 换过设备 / 老版本存的值不在列表里：回 auto
  if (S.still !== 'auto' && !list.some(s => s.id === String(S.still))) {
    S.still = 'auto';
    saveSettings();
  }
  const sig = list.map(s => s.id).join(',');
  if (box.dataset.sig !== sig) {
    const btn = (v, text, title) =>
      '<button data-v="' + v + '"' + (title ? ' title="' + title + '"' : '') + '>' + text + '</button>';
    const capLong = Math.max((caps.width && caps.width.max) || 0, (caps.height && caps.height.max) || 0);
    let html = btn('auto', '自动', capLong
      ? '最高 ' + Math.min(capLong, 4000) + 'px（横竖自动）'
      : '设备能给多大就给多大');
    for (const s of list) {
      const long = Math.max(s.w, s.h);
      const short = Math.min(s.w, s.h);
      html += btn(s.id, s.name, s.w + '×' + s.h + '（横拍）/ ' + short + '×' + long + '（竖拍）');
    }
    box.innerHTML = html;
    box.dataset.sig = sig;
  }
  setSeg('segStill', S.still);
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
  const ob = document.getElementById('btnOrient');
  if (ob) {
    ob.title = orient.auto ? '方向：自动' : '方向：已锁定';
    ob.classList.toggle('on', !orient.auto);
  }
  const fb = document.getElementById('btnFull');
  if (fb) {
    fb.title = S.full ? '退出全屏' : '全屏取景';
    fb.classList.toggle('on', !!S.full);
  }
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
    ['#swExif', 'writeExif'], ['#swSmart', 'smartPick'],
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
    ['segStill', v => { S.still = v; }],
    ['segSize', v => { S.size = v; }],
    ['segView', v => { S.view = v; }],
    ['segCoord', v => { S.coordFmt = v; }],
    ['segRot', v => { S.videoRot = v; }]
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
      if (id === 'segRot' || id === 'segView') { layoutStage(); renderOverlay(); }
      else renderOverlay();
      // 分辨率只影响按快门时的采集档位，不必重启摄像头
      if (id === 'segSize') startCamera(curDeviceId, { keepLenses: true });
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

  // 方向：自动 ⇄ 锁定当前
  const btnOrient = $('#btnOrient');
  if (btnOrient) btnOrient.addEventListener('click', async () => {
    if (orient.auto) {
      // 第一次进入「自动」之外的状态前，先确认拿得到传感器
      await requestOrientPermission();
      setOrientAuto(false);
    } else {
      setOrientAuto(true);
    }
  });
  // 全屏取景：只能手动开，退出用右上角的浮动按钮（或再点一次顶栏按钮）
  const bf = $('#btnFull');
  if (bf) bf.addEventListener('click', () => setFull(!S.full));
  const bx = $('#btnExitFull');
  if (bx) bx.addEventListener('click', (e) => { e.stopPropagation(); setFull(false); });

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
      // 不写入 localStorage：曝光补偿只对当前场景有效，跨会话记忆会害人
      syncTools();
      applyEv(S.ev);
    });
    evSlider.addEventListener('change', () => {
      if (Math.abs(S.ev) >= 1.5) toast('EV ' + (S.ev > 0 ? '+' : '') + S.ev.toFixed(1) +
        ' 偏高，画面容易发白；重启 App 会自动归零');
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
  initOrientation();
  document.body.classList.toggle('full', !!S.full);
  applyOrientation();
  initGeo();
  // 先用 60fps 的默认值开流，别让用户干等刷新率测完
  startCamera();
  detectRefreshRate().then(hz => {
    screenHz = hz;
    devDiag.hz = hz;
    renderDiag();
    // 只有「屏幕本身就低刷」时才值得重开一路流；高刷屏的上限仍是 60
    if (targetFps() < 60 && video.srcObject && !camStarting) {
      startCamera(curDeviceId, { keepLenses: true });
    }
  });
  startFpsMeter();
  setInterval(renderOverlay, 1000);
  setInterval(refreshUiCode, 1000);
  refreshUiCode();
  hideSplash();

  if (location.hash === '#settings') openSheet();

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__WMC_NATIVE__) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ---------- 生命周期 ----------
   之前完全没有处理「切后台 / 锁屏 / 换页」：WebView 只是把页面挂起，
   摄像头轨道被系统掐掉，回来时 video 还挂着已经失效的 srcObject。
   用户看到的就是「退出或切换页面后再打开会卡住」，而按快门抓到的是全黑死帧。
   现在隐藏时主动关流，回到前台重新开流。 */
let resuming = false;

function camSleep() {
  if (autoFocusTimer) { clearInterval(autoFocusTimer); autoFocusTimer = 0; }
  // 必须在 stopStream 之前抓帧：之后 video 已经没有画面可抓了
  grabPoster();
  setLive(false);
  stopStream();
}

async function camWake() {
  if (resuming || camStarting) return;
  if (video.srcObject && video.readyState >= 2) return;
  resuming = true;
  try {
    await restartCamera();
    layoutStage();
    renderOverlay();
  } finally {
    resuming = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) camSleep();
  else camWake();
});
window.addEventListener('pagehide', camSleep);
window.addEventListener('pageshow', () => { if (!document.hidden) camWake(); });

/* ---------- 转屏 ----------
   壳锁竖屏，系统不会给 orientationchange；真正驱动方向的是陀螺仪
   （见 initOrientation）。这里只负责窗口尺寸变化（软键盘、分屏、
   平板旋转）后的重排，不再重开摄像头 —— cover 已经能吃下任何比例，
   重开一路流只会让画面闪一下、卡一下。 */
function onOrientation() {
  layoutStage();
  renderOverlay();
}

window.addEventListener('orientationchange', () => setTimeout(onOrientation, 260));
window.addEventListener('resize', onOrientation);

video.addEventListener('loadedmetadata', layoutStage);
video.addEventListener('resize', layoutStage);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
