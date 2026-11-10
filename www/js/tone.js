/* ============================================================
   影调引擎（纯函数，可在 Node 里跑）
   ------------------------------------------------------------
   为什么不再用 brightness/contrast 系数：

   旧做法把整幅乘一个 0.80 的亮度系数。乘法会等比例压掉全部像素，
   高光从 218 掉到 174，暗部从 15 掉到 12 —— 动态范围反而缩小，
   画面看上去就是「灰」。这正是被反馈的「发白」：实测 P99 只有 174，
   而原生相机是 231。

   现在改成查表曲线（LUT）：
   · 黑场：把 1% 分位拉到 4，暗部立起来
   · 白场：把 99.5% 分位软压缩到 246，高光不糊
   · 中间调：S 形微提对比
   暗部细节与高光层次同时保住，动态范围是「扩」不是「缩」。

   另附灰世界白平衡：视频流常见蓝通道偏高，整幅发青发灰。
   ============================================================ */
(function (root) {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* data: Uint8ClampedArray(RGBA)，step: 每 N 个像素取一个（抽样加速）
     输出亮度分位 + 高光区的通道均值（白点参考）。 */
  function analyze(data, step) {
    const st = Math.max(1, step | 0 || 4);
    const hist = new Uint32Array(256);
    let n = 0, sum = 0, blown = 0, dark = 0, mid = 0;
    let sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < data.length; i += 4 * st) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += l;
      sr += r; sg += g; sb += b;
      n++;
      if (l > 250) blown++;
      else if (l < 12) dark++;
      else if (l > 200) mid++;
      hist[Math.min(255, l | 0)]++;
    }
    if (!n) {
      return { n: 0, mean: 0, blown: 0, dark: 0, mid: 0, p1: 0, p50: 0, p95: 0, p98: 0, p995: 0, mr: 0, mg: 0, mb: 0, hr: 0, hg: 0, hb: 0 };
    }

    let acc = 0, p1 = -1, p50 = -1, p95 = -1, p98 = -1, p995 = -1;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (p1 < 0 && acc >= n * 0.01) p1 = v;
      if (p50 < 0 && acc >= n * 0.5) p50 = v;
      if (p95 < 0 && acc >= n * 0.95) p95 = v;
      if (p98 < 0 && acc >= n * 0.98) p98 = v;
      if (p995 < 0 && acc >= n * 0.995) p995 = v;
    }
    p95 = Math.max(0, p95);

    // 第二遍只统计「高光区」的通道均值：光源的颜色在高光里最接近本色，
    // 比全图均值可靠得多（全图均值会被大面积同色物体带偏）。
    let hn = 0, hr = 0, hg = 0, hb = 0;
    for (let i = 0; i < data.length; i += 4 * st) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (0.299 * r + 0.587 * g + 0.114 * b >= p95) {
        hr += r; hg += g; hb += b; hn++;
      }
    }

    return {
      n,
      mean: sum / n,
      blown: blown / n,
      dark: dark / n,
      mid: mid / n,
      p1: Math.max(0, p1) / 255,
      p50: Math.max(0, p50) / 255,
      p95: p95 / 255,
      p98: Math.max(0, p98) / 255,
      p995: Math.max(0, p995) / 255,
      mr: sr / n, mg: sg / n, mb: sb / n,
      hr: hn ? hr / hn : sr / n,
      hg: hn ? hg / hn : sg / n,
      hb: hn ? hb / hn : sb / n
    };
  }

  /* ---------------- 曲线 ---------------- */

  /* 单条通道曲线：拉伸到 [black, white]，高光段用指数软膝收回 */
  function curveAt(v, black, white, knee, gain) {
    const span = Math.max(8, white - black);
    let t = ((v - black) / span) * gain;

    if (t <= 0) return 0;
    if (t > knee) {
      // knee 以上渐近到 1，避免硬切造成高光断层
      const u = (t - knee) / (1 - knee);
      const k = 1 - Math.exp(-u * 2.4);
      const kd = 1 - Math.exp(-2.4);
      t = knee + (1 - knee) * (k / kd);
    }
    return clamp(Math.round(t * 255), 0, 255);
  }

  /* 白平衡增益。用「白点法」（Perfect Reflector / White Patch），
     而不是灰世界：灰世界假设全图均值应为中性，遇到大面积同色物体
     （青色机身、红衣服、绿墙）就会把物体颜色当成色偏抹掉，
     这正是处理后「更灰」的原因之一。高光区像素最接近光源本色，
     用它估计增益稳定得多（Buchsbaum 1980；Land 1977）。
     增益限制 ±10%，且 3% 以内视为噪声不动。 */
  function grayGains(s) {
    const flat = { r: 1, g: 1, b: 1 };
    if (!s || !s.n || !s.hr || !s.hg || !s.hb) return flat;
    // 高光不够亮时不可信（夜景里最亮处可能只是路灯），直接不动
    const hMean = (s.hr + s.hg + s.hb) / 3;
    if (hMean < 118) return flat;

    const mean = hMean;
    const cap = (x) => clamp(x, 0.90, 1.10);
    const dead = (x) => (Math.abs(x - 1) < 0.03 ? 1 : x);
    return {
      r: dead(cap(mean / s.hr)),
      g: dead(cap(mean / s.hg)),
      b: dead(cap(mean / s.hb))
    };
  }

  /* 生成 3 条 256 项查找表。
     opts.exposure: 用户手动亮度 (-1..+1)
     opts.wb: 是否做白平衡
     opts.contrast: S 曲线强度 0..1（默认 0.32）

     思路来自三条线：
     · Reza/Zuiderveld 的 CLAHE 指出，低对比图像的病灶是「直方图过度集中」，
       只做线性拉伸收效有限，必须有中心区域的斜率提升；
     · Mertens 的曝光融合用 saturation/contrast 作为质量权重，
       说明「局部对比」本身是画质的一部分，不只是色调偏好；
     · Hasinoff 的 HDR+ 在合并后套标准 tone mapping，
       关键是把黑场和白场各自归位，而不是整体乘一个系数。

     所以这里做成三段：黑场归位 → 中位锚定 + S 曲线 → 高光软膝。 */
  function buildLut(s, opts) {
    const o = opts || {};
    const on = !!(s && s.n);
    const exposure = clamp(o.exposure || 0, -1, 1);
    const contrast = clamp(o.contrast == null ? 0.32 : o.contrast, 0, 1);
    const useWb = o.wb !== false;

    // 黑场：1% 分位。只回收 60%，留一点脚，避免暗部被压成死黑一片。
    const black = on ? clamp(s.p1 * 255 * 0.6, 0, 22) : 0;

    // 白场：优先用 99.5 分位。但若 p99.5 远高于 p98，说明那只是零星高光
    //（屏幕反光、灯珠），拿它当白场会把整幅压在下面，高光永远顶不上去。
    // 这种「长尾」分布改用 p98 加余量，让主体高光真正展开。
    let white = 255;
    if (on) {
      const hi995 = (s.p995 || 1) * 255;
      const hi98 = (s.p98 || 1) * 255;
      const useHi = (hi995 - hi98 > 60) ? hi98 + 40 : hi995;
      white = clamp(useHi, 168, 255);
    }
    if (white - black < 60) white = Math.min(255, black + 60);

    // 中位锚定：把 50% 分位送到 0.46 附近，整体明暗就不偏了。
    // 伽马限制在 [0.72, 1.38]，天黑场景不会被硬拉成白天。
    let gamma = 1;
    if (on) {
      const mid = clamp(((s.p50 || 0.5) * 255 - black) / (white - black), 0.02, 0.98);
      gamma = clamp(Math.log(0.46) / Math.log(mid), 0.72, 1.38);
    }
    // 手动曝光以伽马形式叠加，和自动曲线共用一条通道
    gamma = clamp(gamma / Math.pow(2, exposure * 0.9), 0.55, 2.2);

    const knee = 0.84;
    const g2 = useWb ? grayGains(s) : { r: 1, g: 1, b: 1 };

    const mk = (chGain) => {
      const t = new Uint8Array(256);
      for (let v = 0; v < 256; v++) {
        // ① 归一化 + 伽马（抬中间调）
        let x = clamp((v - black) / Math.max(8, white - black), 0, 1);
        x = Math.pow(x, gamma);
        // ② S 曲线：暗部再压一点、亮部再抬一点，产出「通透」而不是「灰」
        const sm = x * x * (3 - 2 * x);
        x = x * (1 - contrast) + sm * contrast;
        // ③ 高光软膝，防止 S 曲线把亮部顶爆
        if (x > knee) {
          const u = (x - knee) / (1 - knee);
          const k = 1 - Math.exp(-u * 2.4);
          const kd = 1 - Math.exp(-2.4);
          x = knee + (1 - knee) * (k / kd);
        }
        t[v] = clamp(Math.round(x * 255 * chGain), 0, 255);
      }
      return t;
    };

    return { r: mk(g2.r), g: mk(g2.g), b: mk(g2.b), black, white, gamma, gains: g2 };
  }

  /* 把 LUT 应用到 ImageData（原地）。纯查表，无浮点运算。 */
  function applyLut(data, lut) {
    const R = lut.r, G = lut.g, B = lut.b;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = R[data[i]];
      data[i + 1] = G[data[i + 1]];
      data[i + 2] = B[data[i + 2]];
    }
    return data;
  }

  /* ---------------- 取景预览用的近似 ----------------
     CSS filter 做不了查表，用 contrast 近似「去灰」那一段，
     不做全局压暗（那正是之前把画面压灰的原因）。
     预览只是参考，成片走 applyLut 会更准。 */
  function previewFilter(lut) {
    if (!lut) return 'none';
    const span = Math.max(40, lut.white - lut.black);
    const c = clamp(255 / span, 1, 1.42);
    const avgGain = (lut.gains.r + lut.gains.g + lut.gains.b) / 3;
    // 用亮度偏移把画面居中，避免 contrast 直接拉爆高光
    const b = clamp(avgGain * (lut.b ? 1 : 1), 0.85, 1.15);
    if (Math.abs(c - 1) < 0.02 && Math.abs(b - 1) < 0.02) return 'none';
    return 'contrast(' + c.toFixed(3) + ') brightness(' + b.toFixed(3) + ')';
  }

  /* ---------------- 取图路径判定 ---------------- */

  /* 只有在原生图几乎整片死白时才弃用它。
     旧规则按「溢出比例差 > 6%」判断，误伤了大量正常场景：
     屏幕、台灯、白墙在原生 12MP 图上本来就是高光，
     视频流因为动态范围窄把它压平了，于是每次都判成「原生图偏亮」，
     把 12MP 的原生图换成了 5MP 的视频帧 —— 画质、视野、色彩全崩。 */
  function shouldReplacePhoto(photo, frame) {
    if (!photo || !photo.n || !frame || !frame.n) return false;
    if (photo.blown > 0.55) return true;                       // 过半像素死白
    if (photo.mean > 236 && frame.mean < photo.mean - 30) return true;
    return false;
  }

  /* 曝光是否值得更新，避免预览亮度来回跳 */
  function shouldUpdate(prev, next) {
    if (!prev) return true;
    return Math.abs(prev - next) >= 0.035;
  }

  /* 兼容旧接口 */
  function cssFilter(b, c) {
    const bb = clamp(b, 0.5, 1.6);
    const cc = clamp(c, 0.8, 1.5);
    if (Math.abs(bb - 1) < 0.005 && Math.abs(cc - 1) < 0.005) return 'none';
    return 'brightness(' + bb.toFixed(3) + ') contrast(' + cc.toFixed(3) + ')';
  }

  const API = {
    analyze, buildLut, applyLut, previewFilter, grayGains, curveAt,
    shouldReplacePhoto, shouldUpdate, cssFilter
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WMCTone = API;
})(typeof window !== 'undefined' ? window : globalThis);
