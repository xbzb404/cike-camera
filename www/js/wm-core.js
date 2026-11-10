/* ============================================================
   wm-core · 水印渲染引擎
   ------------------------------------------------------------
   纯函数模块：只负责“把数据画成水印”，不碰相机 / DOM / 存储。
   对外 API（挂到 window.WM）：
     STYLES                 样式清单 [{id,name}]
     buildData(base, s, code)  计算要画的文本
     draw(ctx, W, H, d, opts)  在任意 canvas 上绘制水印
     measureInk(ctx, W, H, pos) 采样画面亮度，返回 'dark' | 'light'
     pal(ink)               取调色板
   ------------------------------------------------------------
   设计约定
   · 所有尺寸以 1080px 宽为基准，s = W / 1080 等比缩放，
     因此 1080p / 4K / 缩略图用同一套代码，不会糊也不会溢出。
   · 颜色全部走 pal()，深色照片用白字、浅色照片用深字，
     避免“拍雪地/白墙时水印看不见”的老问题。
   ============================================================ */
(function (root) {
  'use strict';

  const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
  const LINE_H = 1.32;

  const STYLES = [
    { id: 'classic', name: '经典' },
    { id: 'card', name: '卡片' },
    { id: 'hero', name: '大字' },
    { id: 'strip', name: '记录条' },
    { id: 'tag', name: '横幅' },
    { id: 'minimal', name: '极简' },
    { id: 'badge', name: '标签' },
    { id: 'stamp', name: '印章' }
  ];

  /* ---------------- 基础工具 ---------------- */
  const pad2 = n => String(n).padStart(2, '0');

  function setFont(ctx, size, weight) {
    ctx.font = `${weight} ${Math.max(1, size)}px ${FONT}`;
  }

  function truncate(ctx, text, maxW) {
    if (maxW <= 0) return '';
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /* ---------------- 调色板 ---------------- */
  function pal(ink) {
    // ink = 'light' 表示底图偏亮 → 用深色字；其余用白字
    if (ink !== 'light') {
      return {
        ink: 'dark',
        text: '#ffffff',
        sub: 'rgba(255,255,255,.94)',
        dim: 'rgba(255,255,255,.74)',
        accent: '#ffd24a',
        shadow: 'rgba(0,0,0,.62)',
        box: 'rgba(10,12,16,.48)',
        box2: 'rgba(9,11,15,.34)',
        line: 'rgba(255,255,255,.16)',
        plaque: 'rgba(8,10,14,.60)'
      };
    }
    return {
      ink: 'light',
      text: '#10141c',
      sub: 'rgba(14,18,26,.92)',
      dim: 'rgba(14,18,26,.66)',
      accent: '#8a5b00',
      shadow: 'rgba(255,255,255,.9)',
      box: 'rgba(255,255,255,.66)',
      box2: 'rgba(255,255,255,.52)',
      line: 'rgba(18,22,30,.18)',
      plaque: 'rgba(255,255,255,.72)'
    };
  }

  /* 采样一块区域的亮度：0 全黑 → 1 全白 */
  function meanLuma(ctx, x, y, w, h) {
    const sw = 24, sh = 16;
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const cc = c.getContext('2d', { willReadFrequently: true });
    try {
      cc.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
    } catch (e) {
      return 0.35;
    }
    const px = cc.getImageData(0, 0, sw, sh).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    }
    return sum / (px.length / 4) / 255;
  }

  /* ---------------- 位置 ----------------
     旧实现只有 'top' 和 'br' 两个特例，其余一律当左下，
     所以竖屏够用，一横屏就没有可用位置。
     这里把位置拆成「上/下」×「左/右」两个正交维度：
       bl / br / tl / tr   （bottom / top 作为旧值保留为 bl / tl） */
  function posTop(p) { return p === 'top' || p === 'tl' || p === 'tr'; }
  function posRight(p) { return p === 'br' || p === 'tr'; }

  /* 水印所在区域的亮度 → 决定用深墨还是浅墨 */
  function measureInk(ctx, W, H, pos) {
    const bandH = Math.round(H * 0.34);
    const y = posTop(pos) ? 0 : H - bandH;
    const l = meanLuma(ctx, 0, y, W, bandH);
    // 主观阈值：画面偏亮就用深字，否则白字
    return l > 0.62 ? 'light' : 'dark';
  }

  /* ---------------- 数据 ---------------- */
  function fmtCoords(lat, lng, opt) {
    if (lat == null || lng == null) return '';
    const fmt = (opt && opt.coordFmt) || 'zh';
    if (fmt === 'dec') {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
    const a = Math.abs(lat), b = Math.abs(lng);
    const ns = lat >= 0 ? '北纬' : '南纬';
    const ew = lng >= 0 ? '东经' : '西经';
    return `${ns} ${a.toFixed(6)}°  ${ew} ${b.toFixed(6)}°`;
  }

  function buildData(base, s, code) {
    s = s || {};
    const t = base.time instanceof Date ? base.time : new Date();
    const week = '日一二三四五六'[t.getDay()];
    const hm = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
    const sec = s.showSeconds ? ':' + pad2(t.getSeconds()) : '';
    const datePart = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
    const timeText = `${datePart} ${hm}${sec} 周${week}`;
    const dateLine = `${t.getFullYear()}年${pad2(t.getMonth() + 1)}月${pad2(t.getDate())}日 周${week}`;
    const fields = [];
    if (s.fields && s.fields.length) {
      for (const f of s.fields.slice(0, 8)) {
        const k = (f.k || '').trim(), v = (f.v || '').trim();
        if (!v) continue;
        fields.push({ t: k ? `${k}：${v}` : v, k: !!k });
      }
    }
    return {
      title: (s.title || '').trim(),
      timeText,
      dateLine,
      timeHM: hm + sec,
      weekday: '周' + week,
      location: base.addr || '',
      coords: (base.lat != null && base.lng != null)
        ? fmtCoords(base.lat, base.lng, s) + (base.gcj ? ' GCJ-02' : '')
        : '',
      altitude: (base.altitude != null && s.showAltitude) ? `海拔 ${Math.round(base.altitude)} 米` : '',
      accuracy: (base.acc != null && s.showAccuracy) ? `精度 ±${Math.round(base.acc)} 米` : '',
      weather: base.weather || '',
      code: code || '',
      fields
    };
  }

  /* ---------------- 行模型 ----------------
     u = 画布单位（W / 1080）。字号与行距都必须乘上它，
     否则在缩略图这类非 1080 宽的画布上，字会按 1080 的绝对像素画，看着大得离谱。 */
  function buildLines(d, s, sc, P, u) {
    const L = [];
    const push = (t, size, weight, gap, cls) => {
      if (t) L.push({ t, size: size * sc * u, weight, gap: gap * sc * u, cls: cls || '' });
    };
    if (d.title) push(d.title, 44, 700, 14, 'title');
    if (s.showTime && d.timeText) push(d.timeText, 31, 500, 6, 'body');
    if (s.showPlace && d.location) push(d.location, 31, 500, 6, 'body');
    if (s.showCoords && d.coords) push(d.coords, 31, 500, 6, 'body');
    if (s.showAltitude && d.altitude) push(d.altitude, 28, 500, 6, 'body');
    if (s.showAccuracy && d.accuracy) push(d.accuracy, 26, 500, 6, 'dim');
    if (s.showWeather && d.weather) push(d.weather, 31, 500, 6, 'body');
    for (const f of (d.fields || [])) push(f.t, 28, f.k ? 600 : 500, 6, 'body');
    if (s.showCode && d.code) push('验真码 ' + d.code, 27, 600, 0, 'code');
    return L;
  }

  function blockHeight(L) {
    return L.reduce((h, l) => h + l.size * LINE_H + l.gap, 0);
  }

  function colorOf(l, P) {
    if (l.cls === 'code') return P.accent;
    if (l.cls === 'title') return P.text;
    if (l.cls === 'dim') return P.dim;
    return l.weight >= 700 ? P.text : P.sub;
  }

  /* 垂直锚点：pos = top | bottom（右下/左下在水平方向另算） */
  function anchorY(H, contentH, padY, pos) {
    return posTop(pos) ? padY : H - padY - contentH;
  }

  /* ---------------- 样式：经典左竖条 ---------------- */
  function drawClassic(ctx, W, H, d, o) {
    const s = W / 1080, sc = o.scale, P = o.P;
    const L = buildLines(d, o.s, sc, P, s);
    if (!L.length) return;
    const padX = 54 * s, padY = 62 * s;
    const totalH = blockHeight(L);
    const right = posRight(o.pos);
    const textX = right ? null : padX + 28 * s;
    const maxW = W - padX - 54 * s - 28 * s;
    let y = anchorY(H, totalH, padY, o.pos);

    ctx.save();
    const barX = right ? W - padX - 7 * s : padX;
    const barTop = y + 4 * s;
    const barH = Math.max(totalH - 8 * s, 6 * s);
    const g = ctx.createLinearGradient(0, barTop, 0, barTop + barH);
    g.addColorStop(0, P.accent);
    g.addColorStop(1, o.P.ink === 'light' ? 'rgba(138,91,0,.35)' : 'rgba(255,210,74,.4)');
    ctx.fillStyle = g;
    roundRect(ctx, barX, barTop, 7 * s, barH, 3.5 * s);
    ctx.fill();
    ctx.restore();

    ctx.textBaseline = 'top';
    ctx.textAlign = right ? 'right' : 'left';
    ctx.shadowColor = P.shadow;
    ctx.shadowBlur = 12 * s;
    ctx.shadowOffsetY = 2 * s;
    const tx = right ? W - padX - 28 * s : textX;
    for (const l of L) {
      setFont(ctx, l.size, l.weight);
      ctx.fillStyle = colorOf(l, P);
      ctx.fillText(truncate(ctx, l.t, maxW), tx, y);
      y += l.size * LINE_H + l.gap;
    }
    ctx.restore();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.textAlign = 'left';
  }

  /* ---------------- 样式：半透明卡片 ---------------- */
  function drawCard(ctx, W, H, d, o) {
    const s = W / 1080, sc = o.scale, P = o.P;
    const L = buildLines(d, o.s, sc, P, s);
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
    const x = (posRight(o.pos)) ? W - 44 * s - boxW : 44 * s;
    const y = anchorY(H, boxH, 48 * s, o.pos);

    ctx.save();
    roundRect(ctx, x, y, boxW, boxH, 24 * s);
    ctx.fillStyle = P.box;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.strokeStyle = P.line;
    ctx.stroke();
    ctx.restore();

    let ty = y + inner;
    ctx.textBaseline = 'top';
    const maxW = boxW - inner * 2;
    for (const l of L) {
      setFont(ctx, l.size, l.weight);
      ctx.fillStyle = colorOf(l, P);
      ctx.fillText(truncate(ctx, l.t, maxW), x + inner, ty);
      ty += l.size * LINE_H + l.gap;
    }
  }

  /* ---------------- 样式：大字时间 ---------------- */
  function drawHero(ctx, W, H, d, o) {
    const s = W / 1080, sc = o.scale, P = o.P;
    const L = [];
    const push = (t, size, weight, gap, cls) => { if (t) L.push({ t, size: size * sc * s, weight, gap: gap * sc * s, cls }); };
    if (d.title) push(d.title, 38, 700, 8, 'title');
    if (o.s.showPlace && d.location) push(d.location, 33, 500, 4, 'body');
    if (o.s.showCoords && d.coords) push(d.coords, 28, 500, 8, 'body');
    if (o.s.showTime && d.dateLine) {
      const t = (o.s.showWeather && d.weather) ? `${d.dateLine} · ${d.weather}` : d.dateLine;
      push(t, 29, 500, 6, 'body');
    } else if (o.s.showWeather && d.weather) {
      push(d.weather, 29, 500, 6, 'body');
    }
    if (o.s.showTime && d.timeHM) push(d.timeHM, 116, 800, 4, 'title');
    for (const f of (d.fields || [])) push(f.t, 28, f.k ? 600 : 500, 6, 'body');
    if (o.s.showCode && d.code) push('验真码 ' + d.code, 27, 600, 0, 'code');
    if (!L.length) return;

    const padX = 56 * s, padY = 64 * s;
    const totalH = blockHeight(L);
    const maxW = W - padX * 2;
    let y = anchorY(H, totalH, padY, o.pos);

    ctx.textBaseline = 'top';
    ctx.textAlign = posRight(o.pos) ? 'right' : 'left';
    ctx.shadowColor = P.shadow;
    ctx.shadowBlur = 14 * s;
    ctx.shadowOffsetY = 2 * s;
    const tx = posRight(o.pos) ? W - padX : padX;
    for (const l of L) {
      setFont(ctx, l.size, l.weight);
      ctx.fillStyle = colorOf(l, P);
      ctx.fillText(truncate(ctx, l.t, maxW), tx, y);
      y += l.size * LINE_H + l.gap;
    }
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.textAlign = 'left';
  }

  /* ---------------- 样式：记录条（左大时间 + 右信息列） ---------------- */
  function drawStrip(ctx, W, H, d, o) {
    const s = W / 1080, sc = o.scale, P = o.P, S = o.s;
    const padX = 54 * s, padY = 62 * s;
    const timeSize = 72 * sc * s, dateSize = 26 * sc * s, smallSize = 25 * sc * s;

    const R = [];
    if (S.showPlace && d.location) R.push({ t: d.location, size: smallSize, weight: 500, gap: 8 * s, cls: 'body' });
    if (S.showCoords && d.coords) R.push({ t: d.coords, size: 23 * sc * s, weight: 500, gap: 8 * s, cls: 'body' });
    if (S.showAltitude && d.altitude) R.push({ t: d.altitude, size: 22 * sc * s, weight: 500, gap: 8 * s, cls: 'body' });
    if (S.showWeather && d.weather) R.push({ t: d.weather, size: 23 * sc * s, weight: 500, gap: 8 * s, cls: 'body' });
    for (const f of (d.fields || [])) R.push({ t: f.t, size: 22 * sc * s, weight: f.k ? 600 : 500, gap: 8 * s, cls: 'body' });
    if (S.showCode && d.code) R.push({ t: '验真码 ' + d.code, size: 22 * sc * s, weight: 600, gap: 0, cls: 'code' });

    setFont(ctx, timeSize, 800);
    const timeW = (S.showTime && d.timeHM) ? ctx.measureText(d.timeHM).width : 0;
    setFont(ctx, dateSize, 500);
    const dateW = (S.showTime && d.dateLine) ? ctx.measureText(d.dateLine).width : 0;
    setFont(ctx, 40 * sc * s, 700);
    const titleW = d.title ? ctx.measureText(d.title).width : 0;
    const leftW = Math.min(Math.max(timeW, dateW, S.showTime ? 0 : titleW), W * 0.5);

    let rightH = 0;
    for (const l of R) rightH += l.size * 1.3 + l.gap;
    const leftH = (S.showTime ? timeSize * 0.98 + 14 * s + dateSize * 1.2 : 0);
    const blockH = Math.max(leftH, rightH);
    const top = anchorY(H, blockH, padY, o.pos);

    ctx.textBaseline = 'top';
    ctx.shadowColor = P.shadow;
    ctx.shadowBlur = 14 * s;
    ctx.shadowOffsetY = 2 * s;

    let leftWritten = false;
    if (S.showTime && d.timeHM) {
      setFont(ctx, timeSize, 800);
      ctx.fillStyle = P.text;
      ctx.fillText(truncate(ctx, d.timeHM, leftW), padX, top);
      if (d.dateLine) {
        setFont(ctx, dateSize, 500);
        ctx.fillStyle = P.dim;
        ctx.fillText(truncate(ctx, d.dateLine, leftW), padX + 2 * s, top + timeSize * 0.98 + 14 * s);
      }
      leftWritten = true;
    } else if (d.title) {
      setFont(ctx, 40 * sc * s, 700);
      ctx.fillStyle = P.text;
      ctx.fillText(truncate(ctx, d.title, leftW), padX, top);
      leftWritten = true;
    }

    if (!R.length) {
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      return;
    }

    const lineX = leftWritten ? padX + leftW + 30 * s : padX;
    if (leftWritten && blockH > 30 * s) {
      ctx.save();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      const lg = ctx.createLinearGradient(0, top, 0, top + blockH);
      lg.addColorStop(0, P.accent);
      lg.addColorStop(1, o.P.ink === 'light' ? 'rgba(138,91,0,.2)' : 'rgba(255,210,74,.15)');
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
      ctx.fillStyle = colorOf(l, P);
      ctx.fillText(truncate(ctx, l.t, maxW), rx, ry);
      ry += l.size * 1.3 + l.gap;
    }

    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }

  /* ---------------- 样式：底部横幅（雾面玻璃带） ---------------- */
  function drawTag(ctx, W, H, d, o) {
    const s = W / 1080, sc = o.scale, P = o.P, S = o.s;
    const padX = 40 * s;
    const boxW = W - padX * 2;

    // 先算右侧信息行，箱体高度按内容撑开，避免多行时溢出
    const rLines = [];
    if (S.showPlace && d.location) rLines.push({ t: d.location, size: 25 * sc * s, weight: 500, cls: 'body' });
    if (S.showCoords && d.coords) rLines.push({ t: d.coords, size: 22 * sc * s, weight: 500, cls: 'body' });
    if (S.showAltitude && d.altitude) rLines.push({ t: d.altitude, size: 21 * sc * s, weight: 500, cls: 'body' });
    for (const f of (d.fields || []).slice(0, 2)) rLines.push({ t: f.t, size: 21 * sc * s, weight: f.k ? 600 : 500, cls: 'body' });
    if (S.showCode && d.code) rLines.push({ t: '验真码 ' + d.code, size: 22 * sc * s, weight: 600, cls: 'code' });
    if (S.showWeather && d.weather && !(S.showTime && d.timeHM)) rLines.push({ t: d.weather, size: 23 * sc * s, weight: 500, cls: 'body' });

    const rTotal = rLines.reduce((h, l) => h + l.size * 1.34, 0);
    const boxH = Math.max(156 * sc * s, rTotal + 56 * s, 132 * s);
    const y = anchorY(H, boxH, 44 * s, o.pos);

    ctx.save();
    roundRect(ctx, padX, y, boxW, boxH, 24 * s);
    const g = ctx.createLinearGradient(0, y, 0, y + boxH);
    g.addColorStop(0, P.box);
    g.addColorStop(1, P.box2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.strokeStyle = P.line;
    ctx.stroke();

    ctx.save();
    roundRect(ctx, padX + 2 * s, y + 2 * s, boxW - 4 * s, boxH - 4 * s, 22 * s);
    ctx.clip();
    const hl = ctx.createLinearGradient(0, y, 0, y + 70 * s);
    hl.addColorStop(0, P.ink === 'light' ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.16)');
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
      setFont(ctx, 52 * sc * s, 800);
      ctx.fillStyle = P.text;
      ctx.fillText(truncate(ctx, d.timeHM, leftMaxW), tX, y + 36 * s);
      hasLeft = true;
    }
    if (d.title && !hasLeft) {
      setFont(ctx, 38 * sc * s, 700);
      ctx.fillStyle = P.text;
      ctx.fillText(truncate(ctx, d.title, leftMaxW), tX, y + 44 * s);
      hasLeft = true;
    }
    if (hasLeft && (d.dateLine || (S.showWeather && d.weather))) {
      const sub = [d.dateLine, S.showWeather ? d.weather : ''].filter(Boolean).join(' · ');
      setFont(ctx, 22 * sc * s, 500);
      ctx.fillStyle = P.dim;
      ctx.fillText(truncate(ctx, sub, leftMaxW), tX + 3 * s, y + 106 * sc * s);
    }

    ctx.save();
    roundRect(ctx, dividerX, y + 30 * s, 2 * s, boxH - 60 * s, 1 * s);
    ctx.fillStyle = P.line;
    ctx.fill();
    ctx.restore();

    const rx = padX + boxW - 28 * s;
    const maxW = rx - dividerX - 18 * s;
    let ry = y + (boxH - rTotal) / 2;
    ctx.textAlign = 'right';
    for (const l of rLines) {
      setFont(ctx, l.size, l.weight);
      ctx.fillStyle = colorOf(l, P);
      ctx.fillText(truncate(ctx, l.t, maxW), rx, ry);
      ry += l.size * 1.34;
    }
    ctx.textAlign = 'left';
  }

  /* ---------------- 样式：极简右下角 ---------------- */
  function drawMinimal(ctx, W, H, d, o) {
    const s = W / 1080, sc = o.scale, P = o.P, S = o.s;
    const padX = 56 * s, padY = 64 * s;
    const L = [];
    const push = (t, size, weight, gap, cls) => { if (t) L.push({ t, size: size * sc * s, weight, gap: gap * s, cls }); };
    if (S.showTime && d.timeText) push(d.timeText, 30, 600, 8, 'title');
    else if (d.title) push(d.title, 30, 600, 8, 'title');

    if (S.showPlace && d.location) {
      const t = (S.showWeather && d.weather) ? `${d.location}  ${d.weather}` : d.location;
      push(t, 23, 400, 6, 'body');
    } else if (S.showWeather && d.weather) {
      push(d.weather, 23, 400, 6, 'body');
    }
    if (S.showCoords && d.coords) push(d.coords, 21, 400, 6, 'body');
    if (S.showAltitude && d.altitude) push(d.altitude, 20, 400, 6, 'body');
    for (const f of (d.fields || [])) push(f.t, 21, f.k ? 600 : 400, 6, 'body');
    if (S.showCode && d.code) push('验真码 ' + d.code, 20, 500, 0, 'code');
    if (!L.length) return;

    const totalH = blockHeight(L);
    const right = posRight(o.pos);
    const endY = posTop(o.pos) ? padY : H - padY;
    let y = posTop(o.pos) ? padY : endY - totalH;

    ctx.textAlign = right ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.shadowColor = P.shadow;
    ctx.shadowBlur = 12 * s;
    ctx.shadowOffsetY = 1 * s;
    const tx = right ? W - padX : padX;
    for (const l of L) {
      setFont(ctx, l.size, l.weight);
      ctx.fillStyle = colorOf(l, P);
      ctx.fillText(truncate(ctx, l.t, W - padX * 2), tx, y);
      y += l.size * LINE_H + l.gap;
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    ctx.fillStyle = P.ink === 'light' ? 'rgba(16,20,28,.35)' : 'rgba(255,255,255,.45)';
    const lineY = posTop(o.pos) ? y + 14 * s : y - totalH - 22 * s;
    ctx.fillRect(right ? W - padX - 46 * s : padX, lineY, 46 * s, Math.max(1.5, 2.4 * s));
    ctx.textAlign = 'left';
  }

  /* ---------------- 样式：左上角标签（胶囊） ---------------- */
  function drawBadge(ctx, W, H, d, o) {
    const s = W / 1080, sc = o.scale, P = o.P, S = o.s;
    const pad = 46 * s;
    const L1 = [];
    if (S.showTime && d.timeText) L1.push({ t: d.timeText, size: 30 * sc * s, weight: 700, cls: 'title' });
    else if (d.title) L1.push({ t: d.title, size: 30 * sc * s, weight: 700, cls: 'title' });

    const L2 = [];
    if (S.showPlace && d.location) L2.push({ t: d.location, size: 23 * sc * s, weight: 500, cls: 'body' });
    if (S.showCoords && d.coords) L2.push({ t: d.coords, size: 20 * sc * s, weight: 500, cls: 'body' });
    if (S.showAltitude && d.altitude) L2.push({ t: d.altitude, size: 19 * sc * s, weight: 500, cls: 'body' });
    if (S.showWeather && d.weather) L2.push({ t: d.weather, size: 19 * sc * s, weight: 500, cls: 'body' });
    for (const f of (d.fields || []).slice(0, 2)) L2.push({ t: f.t, size: 19 * sc * s, weight: f.k ? 600 : 500, cls: 'body' });
    if (S.showCode && d.code) L2.push({ t: '验真码 ' + d.code, size: 19 * sc * s, weight: 600, cls: 'code' });

    if (!L1.length && !L2.length) return;

    const innerX = 30 * s, innerY = 24 * s, gapV = 10 * s;
    let maxW = 0;
    for (const l of L1.concat(L2)) {
      setFont(ctx, l.size, l.weight);
      maxW = Math.max(maxW, ctx.measureText(l.t).width);
    }
    const h1 = L1.length ? L1[0].size * 1.2 : 0;
    const h2 = L2.reduce((a, l) => a + l.size * 1.34, 0);
    const boxW = Math.min(maxW + innerX * 2, W - pad * 2);
    const boxH = innerY * 2 + h1 + (L2.length ? gapV + h2 : 0);

    // 标签固定贴在顶部两角（位置设置只决定左上还是右上）
    const x = posRight(o.pos) ? W - pad - boxW : pad;
    const y = pad;

    ctx.save();
    roundRect(ctx, x, y, boxW, boxH, 26 * s);
    ctx.fillStyle = P.plaque;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.2 * s);
    ctx.strokeStyle = P.line;
    ctx.stroke();

    // 左侧强调条
    ctx.save();
    roundRect(ctx, x, y, boxW, boxH, 26 * s);
    ctx.clip();
    ctx.fillStyle = P.accent;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x, y, 6 * s, boxH);
    ctx.restore();
    ctx.restore();

    ctx.textBaseline = 'top';
    let ty = y + innerY;
    for (const l of L1) {
      setFont(ctx, l.size, l.weight);
      ctx.fillStyle = colorOf(l, P);
      ctx.fillText(truncate(ctx, l.t, boxW - innerX * 2), x + innerX, ty);
      ty += l.size * 1.2;
    }
    if (L2.length) {
      ty += gapV;
      for (const l of L2) {
        setFont(ctx, l.size, l.weight);
        ctx.fillStyle = colorOf(l, P);
        ctx.fillText(truncate(ctx, l.t, boxW - innerX * 2), x + innerX, ty);
        ty += l.size * 1.34;
      }
    }
  }

  /* ---------------- 样式：印章（右下角圆角框 + 大字时间） ---------------- */
  function drawStamp(ctx, W, H, d, o) {
    const s = W / 1080, sc = o.scale, P = o.P, S = o.s;
    const pad = 52 * s;
    const padX = 34 * s, padY = 26 * s;

    const big = (S.showTime && d.timeHM) ? d.timeHM : (d.title || '');
    if (!big) return;

    const lines = [];
    if (S.showTime && d.dateLine) lines.push({ t: d.dateLine, size: 24 * sc * s, weight: 500, cls: 'body' });
    if (S.showPlace && d.location) lines.push({ t: d.location, size: 22 * sc * s, weight: 500, cls: 'body' });
    if (S.showCoords && d.coords) lines.push({ t: d.coords, size: 20 * sc * s, weight: 500, cls: 'body' });
    if (S.showWeather && d.weather) lines.push({ t: d.weather, size: 20 * sc * s, weight: 500, cls: 'body' });

    setFont(ctx, 84 * sc * s, 800);
    let w = ctx.measureText(big).width;
    for (const l of lines) {
      setFont(ctx, l.size, l.weight);
      w = Math.max(w, ctx.measureText(l.t).width);
    }
    const boxW = Math.min(w + padX * 2, W - pad * 2);
    const bigH = 84 * sc * s * 0.92;
    const restH = lines.reduce((a, l) => a + l.size * 1.3, 0);
    const boxH = padY * 2 + bigH + (lines.length ? 8 * s + restH : 0);

    const right = posRight(o.pos);
    const x = right ? W - pad - boxW : pad;
    const y = anchorY(H, boxH, pad, o.pos);

    ctx.save();
    roundRect(ctx, x, y, boxW, boxH, 18 * s);
    ctx.fillStyle = P.box;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2.6 * s);
    ctx.strokeStyle = P.accent;
    ctx.stroke();
    ctx.restore();

    ctx.textBaseline = 'top';
    let ty = y + padY;
    setFont(ctx, 84 * sc * s, 800);
    ctx.fillStyle = P.text;
    ctx.fillText(truncate(ctx, big, boxW - padX * 2), x + padX, ty);
    ty += bigH + 8 * s;
    for (const l of lines) {
      setFont(ctx, l.size, l.weight);
      ctx.fillStyle = P.dim;
      ctx.fillText(truncate(ctx, l.t, boxW - padX * 2), x + padX, ty);
      ty += l.size * 1.3;
    }
  }

  const DRAWERS = {
    classic: drawClassic,
    card: drawCard,
    hero: drawHero,
    strip: drawStrip,
    log: drawStrip,
    tag: drawTag,
    minimal: drawMinimal,
    badge: drawBadge,
    stamp: drawStamp
  };

  /* ---------------- 自适应：内容过高时整体缩小 ---------------- */
  let probeCanvas = null;
  function probeCtx() {
    if (!probeCanvas) {
      probeCanvas = document.createElement('canvas');
      probeCanvas.width = 1;
      probeCanvas.height = 1;
    }
    return probeCanvas.getContext('2d');
  }

  /**
   * 先空跑一遍，量出水印内容的实际纵向范围。
   * 返回 { minY, maxY, lastSize }；失败返回 null。
   */
  function measureExtent(W, H, d, o, fn) {
    const c = probeCtx();
    if (!c) return null;
    const res = { minY: Infinity, maxY: -Infinity, lastSize: 30, count: 0 };
    const orig = c.fillText;
    c.fillText = function (t, x, y) {
      const w = c.measureText ? 0 : 0;
      res.count++;
      if (y < res.minY) res.minY = y;
      if (y > res.maxY) res.maxY = y;
      const m = /(\d+(?:\.\d+)?)px/.exec(c.font || '');
      if (m) res.lastSize = parseFloat(m[1]);
      return orig.call(c, t, x, y);
    };
    try {
      fn(c, W, H, d, o);
    } finally {
      c.fillText = orig;
    }
    if (!res.count || res.minY === Infinity) return null;
    return res;
  }

  /**
   * 绘制水印
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} W 画布宽
   * @param {number} H 画布高
   * @param {object} d buildData 的结果
   * @param {object} opts { style, pos, scale, ink, s }
   */
  function draw(ctx, W, H, d, opts) {
    const o = Object.assign({
      style: 'classic', pos: 'bottom', scale: 1, ink: 'dark', s: {}
    }, opts || {});
    o.P = pal(o.ink);
    const fn = DRAWERS[o.style] || drawClassic;

    // 内容比画布还高（竖幅裁剪、字号调大、自定义字段过多）时，整体等比缩小
    try {
      const ext = measureExtent(W, H, d, o, fn);
      if (ext) {
        const pad = 44 * (W / 1080);
        const availH = H - pad * 2;
        const contentH = (ext.maxY - ext.minY) + ext.lastSize * 1.3;
        if (contentH > availH && contentH > 0) {
          o.scale = o.scale * Math.max(0.5, availH / contentH);
        }
      }
    } catch (e) {}

    ctx.save();
    try {
      fn(ctx, W, H, d, o);
    } catch (e) {
      // 单一样式异常不影响出图
      if (root.console) console.warn('watermark draw failed', e);
    }
    ctx.restore();
  }

  root.WM = { STYLES, buildData, draw, measureInk, pal, setFont, truncate, roundRect, fmtCoords };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WM;
})(typeof self !== 'undefined' ? self : globalThis);
