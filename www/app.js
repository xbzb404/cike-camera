'use strict';

/* ============================================================
   此刻相机 · 签名版
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const pad2 = n => String(n).padStart(2, '0');
const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
const LS_KEY = 'wmc.settings.v2';

const DEFAULTS = {
  title: '此刻相机',
  place: '',
  amapKey: '',
  showTime: true,
  showSeconds: true,
  showPlace: true,
  showCoords: true,
  showWeather: true,
  showCode: true,
  coordGcj: false,
  style: 'classic'
};

const STYLE_IDS = ['classic', 'card', 'hero', 'strip', 'tag', 'minimal'];
const STYLE_META = [
  { id: 'classic', name: '经典' },
  { id: 'card', name: '卡片' },
  { id: 'hero', name: '大字' },
  { id: 'strip', name: '侧栏' },
  { id: 'tag', name: '横幅' },
  { id: 'minimal', name: '极简' }
];
function styleName(id) {
  const m = STYLE_META.find(x => x.id === id);
  return m ? m.name : '经典';
}

function readSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem('wmc.settings.v1');
    if (!raw) return { ...DEFAULTS };
    const s = Object.assign({}, DEFAULTS, JSON.parse(raw));
    // 改名迁移：旧版本存下来的默认名称跟着换掉
    if ((s.title || '').trim() === '水印相机') s.title = DEFAULTS.title;
    if (STYLE_IDS.indexOf(s.style) < 0) s.style = DEFAULTS.style;
    return s;
  } catch (e) {
    return { ...DEFAULTS };
  }
}
let S = readSettings();

function saveSettings() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
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
   画布排版工具
   ============================================================ */
function setFont(ctx, size, weight) {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

function truncate(ctx, text, maxW) {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const LINE_H = 1.32;

function buildLines(d, s) {
  const L = [];
  if (d.title) L.push({ t: d.title, size: 44 * s, weight: 700, gap: 14 * s });
  if (S.showTime && d.timeText) L.push({ t: d.timeText, size: 31 * s, weight: 500, gap: 6 * s });
  if (S.showPlace && d.location) L.push({ t: d.location, size: 31 * s, weight: 500, gap: 6 * s });
  if (S.showCoords && d.coords) L.push({ t: d.coords, size: 31 * s, weight: 500, gap: 6 * s });
  if (S.showWeather && d.weather) L.push({ t: d.weather, size: 31 * s, weight: 500, gap: 6 * s });
  if (S.showCode && d.code) L.push({ t: '验真码 ' + d.code, size: 27 * s, weight: 600, gap: 0 });
  return L;
}

function blockHeight(L) {
  return L.reduce((h, l) => h + l.size * LINE_H + l.gap, 0);
}

/* ---------- 样式一：经典左竖条 ---------- */
function drawClassic(ctx, W, H, d) {
  const s = W / 1080;
  const L = buildLines(d, s);
  if (!L.length) return;
  const padX = 54 * s;
  const padY = 62 * s;
  const totalH = blockHeight(L);
  const textX = padX + 28 * s;
  const maxW = W - textX - 54 * s;
  let y = H - padY - totalH;

  const barTop = y + 4 * s;
  const barH = Math.max(totalH - 8 * s, 6 * s);
  ctx.save();
  const g = ctx.createLinearGradient(0, barTop, 0, barTop + barH);
  g.addColorStop(0, '#ffd24a');
  g.addColorStop(1, 'rgba(255,210,74,.4)');
  ctx.fillStyle = g;
  roundRect(ctx, padX, barTop, 7 * s, barH, 3.5 * s);
  ctx.fill();
  ctx.restore();

  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,.62)';
  ctx.shadowBlur = 12 * s;
  ctx.shadowOffsetY = 2 * s;
  for (const l of L) {
    setFont(ctx, l.size, l.weight);
    const isCode = l.t.startsWith('验真码');
    ctx.fillStyle = l.weight >= 700 ? '#ffffff' : (isCode ? 'rgba(255,210,74,.95)' : 'rgba(255,255,255,.95)');
    ctx.fillText(truncate(ctx, l.t, maxW), textX, y);
    y += l.size * LINE_H + l.gap;
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/* ---------- 样式二：半透明卡片 ---------- */
function drawCard(ctx, W, H, d) {
  const s = W / 1080;
  const L = buildLines(d, s);
  if (!L.length) return;
  const inner = 32 * s;
  const totalH = blockHeight(L);
  const lastGap = L[L.length - 1].gap;

  let maxTextW = 0;
  for (const l of L) {
    setFont(ctx, l.size, l.weight);
    maxTextW = Math.max(maxTextW, ctx.measureText(l.t).width);
  }
  const boxW = Math.min(maxTextW + inner * 2, W - 88 * s);
  const boxH = totalH - lastGap + inner * 2;
  const x = 44 * s;
  const y = H - 48 * s - boxH;

  ctx.save();
  roundRect(ctx, x, y, boxW, boxH, 24 * s);
  ctx.fillStyle = 'rgba(10,12,16,.46)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.4 * s);
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.stroke();
  ctx.restore();

  let ty = y + inner;
  ctx.textBaseline = 'top';
  const maxW = boxW - inner * 2;
  for (const l of L) {
    setFont(ctx, l.size, l.weight);
    const isCode = l.t.startsWith('验真码');
    ctx.fillStyle = l.weight >= 700 ? '#ffffff' : (isCode ? 'rgba(255,210,74,.95)' : 'rgba(255,255,255,.92)');
    ctx.fillText(truncate(ctx, l.t, maxW), x + inner, ty);
    ty += l.size * LINE_H + l.gap;
  }
}

/* ---------- 样式三：大字时间 ---------- */
function drawHero(ctx, W, H, d) {
  const s = W / 1080;
  const L = [];
  if (d.title) L.push({ t: d.title, size: 38 * s, weight: 700, gap: 8 * s });
  if (S.showPlace && d.location) L.push({ t: d.location, size: 33 * s, weight: 500, gap: 4 * s });
  if (S.showCoords && d.coords) L.push({ t: d.coords, size: 28 * s, weight: 500, gap: 8 * s });
  if (S.showTime && d.dateLine) {
    const t = (S.showWeather && d.weather) ? `${d.dateLine} · ${d.weather}` : d.dateLine;
    L.push({ t, size: 29 * s, weight: 500, gap: 6 * s });
  } else if (S.showWeather && d.weather) {
    L.push({ t: d.weather, size: 29 * s, weight: 500, gap: 6 * s });
  }
  if (S.showTime && d.timeHM) L.push({ t: d.timeHM, size: 116 * s, weight: 800, gap: 4 * s });
  if (S.showCode && d.code) L.push({ t: '验真码 ' + d.code, size: 27 * s, weight: 600, gap: 0 });
  if (!L.length) return;

  const padX = 56 * s;
  const padY = 64 * s;
  const totalH = blockHeight(L);
  const maxW = W - padX * 2;
  let y = H - padY - totalH;

  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,.66)';
  ctx.shadowBlur = 14 * s;
  ctx.shadowOffsetY = 2 * s;
  for (const l of L) {
    setFont(ctx, l.size, l.weight);
    const isCode = l.t.startsWith('验真码');
    ctx.fillStyle = l.weight >= 800 ? '#ffffff' : (isCode ? 'rgba(255,210,74,.95)' : 'rgba(255,255,255,.94)');
    ctx.fillText(truncate(ctx, l.t, maxW), padX, y);
    y += l.size * LINE_H + l.gap;
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/* ---------- 样式四：记录条（左大时间 + 右信息列） ---------- */
function drawLog(ctx, W, H, d) {
  const s = W / 1080;
  const padX = 54 * s;
  const padY = 62 * s;
  const timeSize = 72 * s;
  const dateSize = 26 * s;
  const smallSize = 25 * s;

  const R = [];
  if (S.showPlace && d.location) R.push({ t: d.location, size: smallSize, weight: 500, gap: 8 * s });
  if (S.showCoords && d.coords) R.push({ t: d.coords, size: 23 * s, weight: 500, gap: 8 * s });
  if (S.showWeather && d.weather) R.push({ t: d.weather, size: 23 * s, weight: 500, gap: 8 * s });
  if (S.showCode && d.code) R.push({ t: '验真码 ' + d.code, size: 22 * s, weight: 600, gap: 0 });

  setFont(ctx, timeSize, 800);
  const timeW = (S.showTime && d.timeHM) ? ctx.measureText(d.timeHM).width : 0;
  setFont(ctx, dateSize, 500);
  const dateW = (S.showTime && d.dateLine) ? ctx.measureText(d.dateLine).width : 0;
  setFont(ctx, 40 * s, 700);
  const titleW = d.title ? ctx.measureText(d.title).width : 0;
  const leftW = Math.min(Math.max(timeW, dateW, S.showTime ? 0 : titleW), W * 0.46);

  let rightH = 0;
  for (const l of R) rightH += l.size * 1.3 + l.gap;

  const leftH = (S.showTime ? timeSize * 0.98 + 14 * s + dateSize * 1.2 : 0);
  const blockH = Math.max(leftH, rightH);
  const top = H - padY - blockH;

  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,.66)';
  ctx.shadowBlur = 14 * s;
  ctx.shadowOffsetY = 2 * s;

  let leftWritten = false;
  if (S.showTime && d.timeHM) {
    setFont(ctx, timeSize, 800);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(truncate(ctx, d.timeHM, leftW), padX, top);
    if (d.dateLine) {
      setFont(ctx, dateSize, 500);
      ctx.fillStyle = 'rgba(255,255,255,.86)';
      ctx.fillText(truncate(ctx, d.dateLine, leftW), padX + 2 * s, top + timeSize * 0.98 + 14 * s);
    }
    leftWritten = true;
  } else if (d.title) {
    setFont(ctx, 40 * s, 700);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(truncate(ctx, d.title, leftW), padX, top);
    leftWritten = true;
  }

  if (!R.length) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    return;
  }

  const lineX = leftWritten ? padX + leftW + 30 * s : padX;
  if (leftWritten && blockH > 30 * s) {
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    const lg = ctx.createLinearGradient(0, top, 0, top + blockH);
    lg.addColorStop(0, 'rgba(255,210,74,.9)');
    lg.addColorStop(1, 'rgba(255,210,74,.15)');
    ctx.fillStyle = lg;
    roundRect(ctx, lineX, top + 4 * s, 3 * s, blockH - 8 * s, 1.5 * s);
    ctx.fill();
    ctx.restore();
  }

  const rx = lineX + 26 * s;
  const maxW = W - padX - rx;
  let ry = top;
  for (const l of R) {
    setFont(ctx, l.size, l.weight);
    ctx.fillStyle = l.t.startsWith('验真码') ? 'rgba(255,210,74,.95)' : 'rgba(255,255,255,.94)';
    ctx.fillText(truncate(ctx, l.t, maxW), rx, ry);
    ry += l.size * 1.3 + l.gap;
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/* ---------- 样式五：底部横幅（雾面玻璃带） ---------- */
function drawTag(ctx, W, H, d) {
  const s = W / 1080;
  const padX = 40 * s;
  const boxW = W - padX * 2;
  const boxH = 156 * s;
  const y = H - 44 * s - boxH;

  ctx.save();
  roundRect(ctx, padX, y, boxW, boxH, 24 * s);
  const g = ctx.createLinearGradient(0, y, 0, y + boxH);
  g.addColorStop(0, 'rgba(9,11,15,.58)');
  g.addColorStop(1, 'rgba(9,11,15,.36)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.4 * s);
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.stroke();

  ctx.save();
  roundRect(ctx, padX + 2 * s, y + 2 * s, boxW - 4 * s, boxH - 4 * s, 22 * s);
  ctx.clip();
  const hl = ctx.createLinearGradient(0, y, 0, y + 70 * s);
  hl.addColorStop(0, 'rgba(255,255,255,.16)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(padX, y, boxW, 70 * s);
  ctx.restore();
  ctx.restore();

  const tX = padX + 32 * s;
  const dividerX = padX + boxW * 0.47;
  const leftMaxW = dividerX - tX - 20 * s;
  ctx.textBaseline = 'top';
  let hasLeft = false;
  if (S.showTime && d.timeHM) {
    setFont(ctx, 52 * s, 800);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(truncate(ctx, d.timeHM, leftMaxW), tX, y + 36 * s);
    hasLeft = true;
  }
  if (d.title && !hasLeft) {
    setFont(ctx, 38 * s, 700);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(truncate(ctx, d.title, leftMaxW), tX, y + 44 * s);
    hasLeft = true;
  }
  if (hasLeft && (d.dateLine || (S.showWeather && d.weather))) {
    const sub = [d.dateLine, S.showWeather ? d.weather : ''].filter(Boolean).join(' · ');
    setFont(ctx, 22 * s, 500);
    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.fillText(truncate(ctx, sub, leftMaxW), tX + 3 * s, y + 106 * s);
  }

  // 中间分隔
  ctx.save();
  roundRect(ctx, dividerX, y + 30 * s, 2 * s, boxH - 60 * s, 1 * s);
  ctx.fillStyle = 'rgba(255,255,255,.16)';
  ctx.fill();
  ctx.restore();

  // 右侧信息
  const rLines = [];
  if (S.showPlace && d.location) rLines.push({ t: d.location, size: 25 * s, weight: 500 });
  if (S.showCoords && d.coords) rLines.push({ t: d.coords, size: 22 * s, weight: 500 });
  if (S.showCode && d.code) rLines.push({ t: '验真码 ' + d.code, size: 22 * s, weight: 600 });
  if (S.showWeather && d.weather && !(S.showTime && d.timeHM)) rLines.push({ t: d.weather, size: 23 * s, weight: 500 });

  const rTotal = rLines.reduce((h, l) => h + l.size * 1.34, 0);
  const rx = padX + boxW - 28 * s;
  const maxW = rx - dividerX - 18 * s;
  let ry = y + (boxH - rTotal) / 2;
  ctx.textAlign = 'right';
  for (const l of rLines) {
    setFont(ctx, l.size, l.weight);
    ctx.fillStyle = l.t.startsWith('验真码') ? 'rgba(255,210,74,.95)' : 'rgba(255,255,255,.92)';
    ctx.fillText(truncate(ctx, l.t, maxW), rx, ry);
    ry += l.size * 1.34;
  }
  ctx.textAlign = 'left';
}

/* ---------- 样式六：极简右下角 ---------- */
function drawMinimal(ctx, W, H, d) {
  const s = W / 1080;
  const padX = 56 * s;
  const padY = 64 * s;

  const L = [];
  if (S.showTime && d.timeText) L.push({ t: d.timeText, size: 30 * s, weight: 600, gap: 8 * s });
  else if (d.title) L.push({ t: d.title, size: 30 * s, weight: 600, gap: 8 * s });

  if (S.showPlace && d.location) {
    const t = (S.showWeather && d.weather) ? `${d.location}  ${d.weather}` : d.location;
    L.push({ t, size: 23 * s, weight: 400, gap: 6 * s });
  } else if (S.showWeather && d.weather) {
    L.push({ t: d.weather, size: 23 * s, weight: 400, gap: 6 * s });
  }
  if (S.showCoords && d.coords) L.push({ t: d.coords, size: 21 * s, weight: 400, gap: 6 * s });
  if (S.showCode && d.code) L.push({ t: '验真码 ' + d.code, size: 20 * s, weight: 500, gap: 0 });
  if (!L.length) return;

  const totalH = blockHeight(L);
  const endY = H - padY;
  const startY = endY - totalH;

  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,.7)';
  ctx.shadowBlur = 12 * s;
  ctx.shadowOffsetY = 1 * s;

  let y = startY;
  for (const l of L) {
    setFont(ctx, l.size, l.weight);
    ctx.fillStyle = l.t.startsWith('验真码')
      ? 'rgba(255,210,74,.95)'
      : (l.weight >= 600 ? 'rgba(255,255,255,.97)' : 'rgba(255,255,255,.8)');
    ctx.fillText(truncate(ctx, l.t, W - padX * 2), W - padX, y);
    y += l.size * LINE_H + l.gap;
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 上方细线
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.fillRect(W - padX - 46 * s, startY - 22 * s, 46 * s, Math.max(1.5, 2.4 * s));
  ctx.textAlign = 'left';
}

function drawWatermark(ctx, W, H, d, styleId) {
  const st = styleId || S.style;
  ctx.save();
  if (st === 'card') drawCard(ctx, W, H, d);
  else if (st === 'hero') drawHero(ctx, W, H, d);
  else if (st === 'strip' || st === 'log') drawLog(ctx, W, H, d);
  else if (st === 'tag') drawTag(ctx, W, H, d);
  else if (st === 'minimal') drawMinimal(ctx, W, H, d);
  else drawClassic(ctx, W, H, d);
  ctx.restore();
}

/* ============================================================
   数据
   ============================================================ */
const geo = { lat: null, lng: null, acc: null, addr: '', weather: '' };

function liveBase() {
  return {
    time: new Date(),
    lat: geo.lat,
    lng: geo.lng,
    addr: (S.place || '').trim() || geo.addr || '',
    weather: geo.weather || '',
    src: 'live'
  };
}

/* WGS-84 → GCJ-02（高德/腾讯 用的火星坐标） */
function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  function outOfChina(la, ln) {
    return !(ln > 73.66 && ln < 135.05 && la > 3.86 && la < 53.55);
  }
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

function fmtCoords(lat, lng) {
  if (lat == null || lng == null) return '';
  let a = lat, b = lng, tag = '';
  if (S.coordGcj) {
    const g = wgs84ToGcj02(lat, lng);
    a = g[0]; b = g[1];
    tag = ' GCJ-02';
  }
  return `${a >= 0 ? '北纬' : '南纬'} ${Math.abs(a).toFixed(6)}°  ${b >= 0 ? '东经' : '西经'} ${Math.abs(b).toFixed(6)}°${tag}`;
}

function buildData(base, code) {
  const t = base.time instanceof Date ? base.time : new Date();
  const week = '日一二三四五六'[t.getDay()];
  const hm = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  const sec = S.showSeconds ? ':' + pad2(t.getSeconds()) : '';
  const datePart = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  const timeText = `${datePart} ${hm}${sec} 周${week}`;
  const dateLine = `${t.getFullYear()}年${pad2(t.getMonth() + 1)}月${pad2(t.getDate())}日 周${week}`;
  return {
    title: (S.title || '').trim(),
    timeText,
    dateLine,
    timeHM: hm + sec,
    location: base.addr || '',
    coords: fmtCoords(base.lat, base.lng),
    weather: base.weather || '',
    code: code || ''
  };
}

/* ============================================================
   取景器排版 / 实时水印
   ============================================================ */
function layoutStage() {
  const cs = getComputedStyle(stageWrap);
  const availW = stageWrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  let availH = stageWrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const bar = document.querySelector('.stylebar');
  if (bar) availH -= bar.offsetHeight + 10;
  if (availW <= 0 || availH <= 0) return;

  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1440;
  const ratio = vw / vh;

  let w = availW;
  let h = w / ratio;
  if (h > availH) {
    h = availH;
    w = h * ratio;
  }
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
  drawWatermark(ctx, W, H, buildData(liveBase(), uiCode));
}

async function refreshUiCode() {
  try {
    const pub = await WMC.getPublic();
    const b = liveBase();
    const core = {
      v: 1, kid: pub.kid, ts: b.time.toISOString(),
      lat: b.lat, lng: b.lng, src: b.src, addr: b.addr || ''
    };
    const c = await WMC.makeCode(core);
    if (c !== uiCode) {
      uiCode = c;
      renderOverlay();
    }
  } catch (e) {}
}

/* ============================================================
   相机
   ============================================================ */
let stream = null;
let facing = 'environment';

/* 焦段：① 物理镜头（真光学）→ ② 传感器缩放 → ③ 画面裁切 */
let lensList = [];
let lensIndex = 0;
let curDeviceId = null;
let lensMode = 'none';   // optical | zoom | crop | none
let zoomFactor = 1;

function showGuard(text, btnLabel) {
  guardText.textContent = text;
  btnEnableCam.textContent = btnLabel || '重试';
  guard.classList.add('show');
}
function hideGuard() {
  guard.classList.remove('show');
}
function stopStream() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

async function startCamera(deviceId, opts) {
  const keepLenses = !!(opts && opts.keepLenses);
  if (typeof deviceId !== 'string') deviceId = null;
  hideGuard();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showGuard('当前浏览器不支持直接调用相机。请用手机浏览器打开本页面，或点左下角「相册」导入照片加印。', '重试');
    return false;
  }
  stopStream();
  try {
    const video0 = {
      width: { ideal: 1920 },
      height: { ideal: 1440 }
    };
    if (deviceId) video0.deviceId = { exact: deviceId };
    else video0.facingMode = { ideal: facing };

    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video0 });
    const track = stream.getVideoTracks()[0];
    const st = (track && track.getSettings) ? track.getSettings() : {};
    curDeviceId = st.deviceId || deviceId || null;
    if (st.facingMode) facing = st.facingMode;

    zoomFactor = 1;
    video.srcObject = stream;
    await video.play().catch(() => {});
    applyVideoTransform();
    layoutStage();

    if (!keepLenses) {
      await scanLenses(track);
    } else {
      renderLensBar();
    }
    return true;
  } catch (err) {
    const name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      showGuard('相机权限被拒绝。请在浏览器地址栏左侧的权限设置里允许「相机」，然后点重试。', '重试');
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      showGuard('没有找到可用的摄像头。可以点左下角「相册」导入照片加印。', '重试');
    } else {
      showGuard('相机启动失败（' + (name || '未知错误') + '）。注意：网页相机必须在 HTTPS 环境下使用。', '重试');
    }
    return false;
  }
}

/* 预览层的镜像 / 裁切缩放 */
function applyVideoTransform() {
  const parts = [];
  if (facing === 'user') parts.push('scaleX(-1)');
  if (lensMode === 'crop' && zoomFactor > 1) parts.push('scale(' + zoomFactor + ')');
  video.style.transformOrigin = '50% 50%';
  video.style.transform = parts.join(' ');
}

/* ---------- 焦段 ---------- */
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

/* 打开某个摄像头读焦距后立刻关闭；失败返回 null */
async function probeCamera(deviceId) {
  let s = null;
  try {
    s = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: deviceId } }
    });
    const t = s.getVideoTracks()[0];
    const c = (t && t.getCapabilities) ? t.getCapabilities() : {};
    const st = (t && t.getSettings) ? t.getSettings() : {};
    return { focal: c.focalLengthX || st.focalLengthX || 0, facing: st.facingMode || null };
  } catch (e) {
    return null;
  } finally {
    if (s) s.getTracks().forEach(x => x.stop());
  }
}

/* 扫描可用焦段：只有同朝向存在多个摄像头时才关预览逐个探测 */
async function scanLenses(track) {
  lensList = [];
  lensIndex = 0;
  lensMode = 'none';
  zoomFactor = 1;
  applyVideoTransform();
  renderLensBar();
  if (!track) return;

  const caps = (track.getCapabilities && track.getCapabilities()) || {};
  const sets = (track.getSettings && track.getSettings()) || {};

  let cams = [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    cams = all.filter(d => d.kind === 'videoinput' && d.deviceId);
  } catch (e) { cams = []; }

  // 严格只留当前朝向的摄像头；识别不出的不参与，避免把前后摄当焦段
  let same = cams.filter(d => facingOfDevice(d) === facing);
  if (!same.length) {
    const cur = cams.find(d => d.deviceId === curDeviceId);
    same = cur ? [cur] : [];
  }

  // ① 同朝向多摄 → 切物理镜头（真光学）
  if (same.length >= 2) {
    const backup = curDeviceId;
    const ownFocal = caps.focalLengthX || sets.focalLengthX || 0;
    // 安卓上第二个摄像头必须在主预览关闭后才有机会打开
    stopStream();
    const list = [];
    for (const d of same) {
      if (d.deviceId === backup && ownFocal) {
        list.push({ deviceId: d.deviceId, focal: ownFocal });
        continue;
      }
      const r = await probeCamera(d.deviceId);
      if (!r) continue;
      if (r.facing && r.facing !== facing) continue;
      list.push({ deviceId: d.deviceId, focal: r.focal });
    }
    const reopened = await startCamera(backup, { keepLenses: true });

    if (list.length >= 2 && reopened) {
      if (list.every(x => x.focal > 0)) {
        const asc = list.map(x => x.focal).sort((a, b) => a - b);
        const base = asc[Math.floor(asc.length / 2)];   // 中位焦距 = 1×（主摄）
        list.sort((a, b) => a.focal - b.focal);         // 广角 → 长焦
        lensList = list.map((x, i) => ({
          key: 'dev' + i, label: focalToLabel(x.focal / base), deviceId: x.deviceId, zoom: null
        }));
      } else {
        lensList = list.map((x, i) => ({
          key: 'dev' + i, label: (i + 1) + '×', deviceId: x.deviceId, zoom: null
        }));
      }
      const used = {};
      lensList.forEach(l => {
        if (used[l.label]) l.label = (parseFloat(l.label) + 0.5).toFixed(1) + '×';
        used[l.label] = 1;
      });
      lensMode = 'optical';
      const found = lensList.findIndex(l => l.deviceId === curDeviceId);
      lensIndex = found >= 0 ? found : 0;
      renderLensBar();
      return;
    }
    if (!reopened) return;
  }

  // ② 单摄：传感器缩放（部分机型变焦时会自动切到长焦镜头）
  const zmax = (caps.zoom && caps.zoom.max) || 0;
  if (zmax >= 1.9) {
    const max = Math.min(zmax, 8);
    const steps = [1, 2, 3, 5].filter(z => z <= max + 0.01);
    if (steps.length >= 2) {
      lensMode = 'zoom';
      lensList = steps.map(z => ({ key: 'zoom' + z, label: z + '×', deviceId: null, zoom: z }));
      lensIndex = 0;
      renderLensBar();
      return;
    }
  }

  // ③ 兜底：画面裁切（取景与成片同步放大）
  if (facing === 'environment' && (video.videoWidth || 0) >= 1280) {
    lensMode = 'crop';
    lensList = [1, 2, 3].map(z => ({ key: 'crop' + z, label: z + '×', deviceId: null, zoom: null, crop: z }));
    lensIndex = 0;
    renderLensBar();
  }
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
  bar.innerHTML = lensList
    .map((l, i) => `<button class="lens${i === lensIndex ? ' active' : ''}" data-i="${i}">${l.label}</button>`)
    .join('');
}

/* 传感器缩放不被支持时，退回画面裁切档 */
function cropFallback(target) {
  lensMode = 'crop';
  lensList = [1, 2, 3].map(z => ({ key: 'crop' + z, label: z + '×', deviceId: null, zoom: null, crop: z }));
  const i = lensList.findIndex(l => l.crop === target);
  lensIndex = i >= 0 ? i : 0;
  zoomFactor = lensList[lensIndex].crop;
  applyVideoTransform();
  renderLensBar();
}

async function setLens(i) {
  if (!lensList[i] || i === lensIndex) return;
  const l = lensList[i];
  const prev = lensIndex;
  lensIndex = i;
  renderLensBar();

  // 裁切档：只改取景与成片的取景框
  if (l.crop != null) {
    zoomFactor = l.crop;
    applyVideoTransform();
    return;
  }

  // 传感器缩放档：应用后回读，确认设备真的换了倍率
  if (l.zoom != null) {
    const t = stream && stream.getVideoTracks()[0];
    try {
      if (!t) throw new Error('no track');
      await t.applyConstraints({ advanced: [{ zoom: l.zoom }] });
      const got = (t.getSettings && t.getSettings().zoom);
      if (got == null || Math.abs(got - l.zoom) > 0.02) throw new Error('zoom-ignored');
    } catch (e) {
      cropFallback(Math.min(3, Math.max(2, Math.round(l.zoom))));
      toast('已切换为数码变焦');
    }
    return;
  }

  // 物理镜头
  const ok = await startCamera(l.deviceId, { keepLenses: true });
  if (!ok) {
    lensIndex = prev;
    renderLensBar();
    toast('切换镜头失败');
  }
}

video.addEventListener('loadedmetadata', layoutStage);
video.addEventListener('resize', layoutStage);

/* ============================================================
   签名出图
   ============================================================ */
function canvasToBlob(canvas, quality) {
  return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', quality || 0.94));
}

function devInfo() {
  return {
    ua: (navigator.userAgent || '').slice(0, 120),
    w: video.videoWidth || 0,
    h: video.videoHeight || 0,
    dpr: window.devicePixelRatio || 1,
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '') + '/' + new Date().getTimezoneOffset()
  };
}

/**
 * 在 canvas 上绘水印并生成带签名段的 JPEG
 * @param {HTMLCanvasElement} canvas 已绘制照片像素
 * @param {object} base {time, lat, lng, addr, weather, src}
 */
async function processPhoto(canvas, base) {
  const canSign = !!(window.WMC && window.crypto && window.crypto.subtle);
  if (!canSign) {
    // 非安全环境（如直接双击打开本地文件）无法调用 WebCrypto：只出图，不签名
    const c0 = canvas.getContext('2d');
    drawWatermark(c0, canvas.width, canvas.height, buildData(base, ''));
    const b0 = await canvasToBlob(canvas, 0.94);
    return { blob: b0, code: '', core: null, payload: null, unsigned: true };
  }

  const pub = await WMC.getPublic();
  const core = {
    v: 1,
    kid: pub.kid,
    ts: (base.time instanceof Date ? base.time : new Date()).toISOString(),
    lat: base.lat,
    lng: base.lng,
    src: base.src || 'live',
    addr: base.addr || ''
  };
  const code = await WMC.makeCode(core);

  const ctx = canvas.getContext('2d');
  drawWatermark(ctx, canvas.width, canvas.height, buildData(base, code));

  const blob = await canvasToBlob(canvas, 0.94);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const imh = WMC.base32(await WMC.sha256(bytes), 26);
  const sig = await WMC.sign(core, code, imh);

  const payload = {
    wmc: 'WMC1',
    v: 1,
    core,
    code,
    imh,
    sig: WMC.toB64url(sig),
    pub: pub.pub,
    fp: pub.fp,
    kid: pub.kid,
    at: Date.now(),
    dev: devInfo()
  };
  const signed = WMC.jpeg.embed(bytes, payload);
  return { blob: new Blob([signed], { type: 'image/jpeg' }), code, core, payload };
}

/* ---------- 预览 / 保存 ---------- */
let shotBlob = null;
let shotCode = '';

function showBusy(text) {
  guardText.textContent = text || '处理中…';
  guard.classList.add('show');
}
function hideBusy() {
  guard.classList.remove('show');
}

async function capture() {
  if (!video.videoWidth) {
    toast('相机还没准备好');
    return;
  }
  const W = video.videoWidth;
  const H = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (facing === 'user') {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  // 裁切档：取中心区域放大，与取景器看到的一致
  const z = (lensMode === 'crop' && zoomFactor > 1) ? zoomFactor : 1;
  if (z > 1) {
    const sw = Math.round(W / z);
    const sh = Math.round(H / z);
    ctx.drawImage(video, Math.round((W - sw) / 2), Math.round((H - sh) / 2), sw, sh, 0, 0, W, H);
  } else {
    ctx.drawImage(video, 0, 0, W, H);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  showBusy('正在签名…');
  try {
    const r = await processPhoto(canvas, liveBase());
    shotBlob = r.blob;
    shotCode = r.code;
    openPreview(r.blob, r.code);
    if (r.unsigned) toast('当前环境不支持签名（需 https），这张照片没有签名');
  } catch (e) {
    toast('签名失败：' + (e && e.message ? e.message : e));
  } finally {
    hideBusy();
  }
}

function openPreview(blob, code) {
  const url = URL.createObjectURL(blob);
  const img = $('#previewImg');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  img.dataset.url = url;
  img.src = url;
  $('#previewCode').textContent = code ? '验真码 ' + code : '';
  $('#preview').classList.add('show');
}

function stampName(prefix) {
  const n = new Date();
  const ts = `${n.getFullYear()}${pad2(n.getMonth() + 1)}${pad2(n.getDate())}_${pad2(n.getHours())}${pad2(n.getMinutes())}${pad2(n.getSeconds())}`;
  return `${prefix || '此刻'}_${ts}${shotCode ? '_' + shotCode.replace(/-/g, '') : ''}.jpg`;
}

async function saveShot() {
  if (!shotBlob) return;
  // 原生壳：走 Java 接口直接写入系统相册（WebView 不支持 blob 下载）
  if (window.WMCAndroid && typeof window.WMCAndroid.saveImage === 'function') {
    try {
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('读取图片失败'));
        fr.readAsDataURL(shotBlob);
      });
      const r = String(window.WMCAndroid.saveImage(dataUrl, stampName('此刻')));
      if (r.indexOf('OK') === 0) toast('已保存到相册 Pictures/此刻相机');
      else toast('保存失败：' + r);
    } catch (e) {
      toast('保存失败：' + (e && e.message ? e.message : e));
    }
    return;
  }
  const url = URL.createObjectURL(shotBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = stampName('此刻');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  toast('已保存 · 请用「原图/文件」方式转发，压缩会破坏签名');
}

async function shareShot() {
  if (!shotBlob) return;
  const file = new File([shotBlob], stampName('此刻'), { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '此刻照片' });
    } catch (e) {}
  } else {
    saveShot();
  }
}

/* ============================================================
   定位 / 地址 / 天气
   ============================================================ */
async function jget(url, ms = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
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
    '&location=' + g[1].toFixed(6) + ',' + g[0].toFixed(6) +
    '&extensions=all&radius=800&roadlevel=0';
  const j = await jget(url);
  if (!j || String(j.status) !== '1' || !j.regeocode) return '';
  const r = j.regeocode;
  let addr = r.formatted_address || '';
  if (!addr) {
    const ac = r.addressComponent || {};
    addr = (ac.province || '') + (ac.city || '') + (ac.district || '') + (ac.township || '') + (ac.streetNumber && ac.streetNumber.street ? ac.streetNumber.street : '');
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
  const parts = [j.principalSubdivision, j.city, j.locality, j.localityInfo && j.localityInfo.adminLevel5]
    .filter(Boolean);
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
  const manual = (S.place || '').trim();
  if (manual) {
    el.textContent = '手动地点 · ' + manual;
    return;
  }
  if (geo.lat == null) {
    el.textContent = '定位中…（可拍照，稍后自动补上地点）';
    return;
  }
  const pos = geo.lat.toFixed(5) + ', ' + geo.lng.toFixed(5);
  el.textContent = geo.addr ? (geo.addr + ' · ' + pos) : ('未解析到地址 · ' + pos);
}

async function resolvePlace() {
  const lat = geo.lat;
  const lng = geo.lng;
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
  $('#geoStatus').textContent = map[err.code] || '定位失败';
}

function initGeo() {
  if (!navigator.geolocation) {
    $('#geoStatus').textContent = '设备不支持定位';
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
   相册导入（读取 EXIF 时间与 GPS）
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
    if ((S.place || '').trim()) {
      addr = S.place.trim();
    } else if (lat != null && lng != null) {
      showBusy('正在解析原图坐标…');
      addr = await fetchAddress(lat, lng);
    }

    url = URL.createObjectURL(file);
    const img = await loadImage(url);
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);

    showBusy('正在签名…');
    const base = { time, lat, lng, addr, weather: '', src };
    const r = await processPhoto(canvas, base);
    shotBlob = r.blob;
    shotCode = r.code;
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
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

/* ---------- 水印样式面板 ---------- */
function snapshotFrame(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (video.videoWidth) {
    const vr = video.videoWidth / video.videoHeight;
    const cr = w / h;
    let sw = video.videoWidth, sh = video.videoHeight, sx = 0, sy = 0;
    if (vr > cr) { sw = Math.round(video.videoHeight * cr); sx = Math.round((video.videoWidth - sw) / 2); }
    else { sh = Math.round(video.videoWidth / cr); sy = Math.round((video.videoHeight - sh) / 2); }
    try { ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h); } catch (e) {}
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
  grid.innerHTML = STYLE_META.map(m => (
    '<div class="style-item" data-style="' + m.id + '" role="button" tabindex="0">' +
      '<canvas width="340" height="340"></canvas>' +
      '<div class="si-foot"><span>' + m.name + '</span><i class="si-check"></i></div>' +
    '</div>'
  )).join('');
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

/* 缩略图用显式像素尺寸，避免 flex/grid 内 aspect-ratio 撑不开高度 */
function sizeStyleThumbs() {
  const grid = $('#styleGrid');
  if (!grid) return;
  const cs = getComputedStyle(grid);
  const inner = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const w = Math.max(72, Math.floor((inner - 11) / 2));
  const h = w;
  grid.querySelectorAll('.style-item canvas').forEach(c => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  });
  return { w, h };
}

function paintStyleThumbs() {
  const grid = $('#styleGrid');
  if (!grid) return;
  const sz = sizeStyleThumbs() || { w: 340, h: 340 };
  const base = snapshotFrame(sz.w, sz.h);
  const d = buildData(liveBase(), uiCode);
  grid.querySelectorAll('.style-item').forEach(item => {
    const c = item.querySelector('canvas');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(base, 0, 0);
    drawWatermark(ctx, c.width, c.height, d, item.dataset.style);
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
}

function syncUI() {
  $('#inpTitle').value = S.title || '';
  $('#inpPlace').value = S.place || '';
  $('#inpAmap').value = S.amapKey || '';
  $('#inpPlace').placeholder = geo.addr ? ('自动：' + geo.addr) : '自动定位地址';
  $('#swTime').checked = !!S.showTime;
  $('#swSeconds').checked = !!S.showSeconds;
  $('#swPlace').checked = !!S.showPlace;
  $('#swCoords').checked = !!S.showCoords;
  $('#swWeather').checked = !!S.showWeather;
  $('#swCode').checked = !!S.showCode;
  $('#swGcj').checked = !!S.coordGcj;
  const nameEl = $('#styleName');
  if (nameEl) nameEl.textContent = styleName(S.style);
  document.querySelectorAll('.style-item').forEach(it => {
    it.classList.toggle('on', it.dataset.style === S.style);
  });
  updateStatus();
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
  $('#sheet').classList.add('show');
  $('#sheetMask').classList.add('show');
}
function closeSheet() {
  $('#sheet').classList.remove('show');
  $('#sheetMask').classList.remove('show');
  renderOverlay();
}

function bindUI() {
  $('#btnSettings').addEventListener('click', openSheet);
  $('#btnDone').addEventListener('click', closeSheet);
  $('#sheetMask').addEventListener('click', closeSheet);

  $('#inpTitle').addEventListener('input', e => {
    S.title = e.target.value;
    saveSettings();
    renderOverlay();
  });

  $('#inpPlace').addEventListener('input', e => {
    S.place = e.target.value;
    saveSettings();
    updateStatus();
    renderOverlay();
  });

  $('#inpAmap').addEventListener('input', e => {
    S.amapKey = e.target.value.trim();
    saveSettings();
    lastGeoKey = '';
    initGeo();
    toast(S.amapKey ? '已设置高德 Key，正在重新解析地址' : '已清除高德 Key');
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
    ['#swTime', 'showTime'],
    ['#swSeconds', 'showSeconds'],
    ['#swPlace', 'showPlace'],
    ['#swCoords', 'showCoords'],
    ['#swWeather', 'showWeather'],
    ['#swCode', 'showCode'],
    ['#swGcj', 'coordGcj']
  ];
  toggles.forEach(([sel, key]) => {
    $(sel).addEventListener('change', e => {
      S[key] = e.target.checked;
      saveSettings();
      renderOverlay();
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
  $('#btnRelocate').addEventListener('click', () => {
    lastGeoKey = '';
    geo.addr = '';
    geo.weather = '';
    toast('正在重新定位…');
    initGeo();
    renderOverlay();
  });
  $('#btnGallery').addEventListener('click', () => $('#fileInput').click());

  $('#fileInput').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importFile(file);
  });

  $('#btnEnableCam').addEventListener('click', startCamera);
  $('#btnSave').addEventListener('click', saveShot);
  $('#btnShare').addEventListener('click', shareShot);

  const closePreview = () => {
    $('#preview').classList.remove('show');
    if (!stream) startCamera();
  };
  $('#btnClosePreview').addEventListener('click', closePreview);
  $('#btnRetake').addEventListener('click', closePreview);

  $('#btnCopyFp').addEventListener('click', async () => {
    const fp = $('#fpText').dataset.fp || '';
    if (!fp) return;
    try {
      await navigator.clipboard.writeText(fp);
      toast('公钥指纹已复制');
    } catch (e) {
      toast('复制失败，请长按指纹文字');
    }
  });

  if (navigator.share && navigator.canShare) {
    $('#btnShare').hidden = false;
  }

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
    const wait = Math.max(0, 560 - (performance.now() - t0));
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 620);
    }, wait);
  };
  if (video && video.readyState >= 2) {
    run();
    return;
  }
  const onReady = () => { video.removeEventListener('loadeddata', onReady); run(); };
  if (video) video.addEventListener('loadeddata', onReady);
  setTimeout(run, 2200);
}

function boot() {
  bindUI();
  syncUI();
  initGeo();
  startCamera();
  setInterval(renderOverlay, 500);
  setInterval(refreshUiCode, 1000);
  refreshUiCode();
  hideSplash();

  if (location.hash === '#settings') openSheet();

  if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.__WMC_NATIVE__) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
