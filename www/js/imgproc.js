/* ============================================================
   图像处理基础算法（纯函数，可在 Node 里跑）
   ------------------------------------------------------------
   负责三件事：
     1. focusScore —— 对焦/清晰度评分（拉普拉斯方差），用于多帧择优
     2. selectBest —— 综合清晰度与高光溢出挑一帧，避免「选中最清楚但过曝的那张」
     3. downscalePlan —— 大比例缩小时的逐级减半计划，改善重采样质量

   为什么不用「整帧缩到 320px 再算」：那样等于先做了一次低通滤波，
   高频细节被抹掉，帧与帧之间的清晰度差异被压平，择优基本靠运气。
   这里改为取画面中央 60% 区域、以较高分辨率采样，只在 ROI 上算。
   ============================================================ */
(function (root) {
  'use strict';

  function toGray(data) {
    const n = data.length >> 2;
    const g = new Float32Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      g[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return g;
  }

  /* 4 邻域拉普拉斯：4c - (上 + 下 + 左 + 右) */
  function laplacian(g, w, h, out) {
    const lap = out || new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        lap[i] = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      }
    }
    return lap;
  }

  /**
   * RGBA → { score, texture, mean }
   * score   : 拉普拉斯方差，越大越清晰（同场景帧间可直接比大小）
   * texture : 平均梯度强度，用来识别「白墙/天空」这种本来就没有细节的画面
   * mean    : 平均灰度
   */
  function focusScore(data, w, h) {
    if (!data || w < 3 || h < 3) return { score: 0, texture: 0, mean: 0 };
    const g = toGray(data);
    const lap = laplacian(g, w, h);
    let s = 0, s2 = 0, absSum = 0, gsum = 0, n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = lap[i];
        s += v; s2 += v * v; absSum += v < 0 ? -v : v; n++;
      }
    }
    for (let p = 0; p < g.length; p++) gsum += g[p];
    if (!n) return { score: 0, texture: 0, mean: 0 };
    const mean = s / n;
    return {
      score: Math.max(0, s2 / n - mean * mean),
      texture: absSum / n,
      mean: gsum / g.length
    };
  }

  /**
   * 多帧择优。
   * cands: [{ score, blown }]，返回下标。
   * 过曝的帧即使更「清晰」（高光边缘反而拉高方差）也要压分，
   * 因为白掉的细节是救不回来的。
   */
  function selectBest(cands) {
    if (!cands || !cands.length) return -1;
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i] || {};
      const score = Number(c.score) || 0;
      const blown = Math.max(0, Math.min(1, Number(c.blown) || 0));
      const v = score * (1 - Math.min(0.9, 3 * blown));
      if (v > bv) { bv = v; bi = i; }
    }
    return bi;
  }

  /**
   * 逐级减半计划。返回中间画布尺寸列表（不含最终目标尺寸）。
   * 源图 4000 → 目标 1000 时返回 [{2000,1500}]，
   * 即 4000→2000→1000 两次双线性缩放，比一次 4 倍缩放干净得多。
   */
  function downscalePlan(sw, sh, targetW, maxSteps) {
    const out = [];
    const limit = maxSteps || 4;
    if (!(sw > 0) || !(sh > 0) || !(targetW > 0)) return out;
    if (sw <= targetW) return out;
    let w = sw, h = sh;
    while (w / 2 >= targetW * 1.05 && out.length < limit) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      out.push({ w, h });
    }
    return out;
  }

  /**
   * 非锐化掩模（unsharp mask），就地修改 imageData。
   *
   * 为什么成片必须过这一步：
   * WebView 拿到的预览流已经经历过「传感器 → YUV → 纹理 → 再编码」，
   * 每一步都是一次低通，边缘的高频被削掉一层。原生相机之所以看着锐，
   * 一半是 ISP 在出图前就做了边缘增强。我们拿不到 RAW，只能事后补。
   *
   * 用 4 邻域均值当模糊层，中心加权还原：
   *   out = v + (v - blur) * amount
   * amount 取 0.35~0.7 是安全区；再高会在文字和桌沿上出白边（halo）。
   *
   * 限制：超过 maxPixels 就跳过 —— 12MP 逐像素跑 JS 要 600ms 以上，
   * 用户按完快门等太久反而更像「卡住」。宁可轻微软一点也不迟滞。
   */
  function unsharp(imageData, w, h, amount, maxPixels) {
    if (!imageData || w < 3 || h < 3) return imageData;
    const cap = maxPixels == null ? 8.4e6 : maxPixels;
    if (w * h > cap) return imageData;

    const a = amount == null ? 0.55 : Math.max(0, Math.min(1.2, amount));
    if (a <= 0.001) return imageData;

    const src = imageData.data;
    const out = new Uint8ClampedArray(src.length);
    const w4 = w * 4;

    // 第一行与最后一行原样拷贝，省掉内层的边界判断
    for (let x = 0; x < w; x++) {
      const t = x * 4, b = (src.length - w4) + t;
      out[t] = src[t]; out[t + 1] = src[t + 1]; out[t + 2] = src[t + 2]; out[t + 3] = src[t + 3];
      out[b] = src[b]; out[b + 1] = src[b + 1]; out[b + 2] = src[b + 2]; out[b + 3] = src[b + 3];
    }

    for (let y = 1; y < h - 1; y++) {
      const row = y * w4;
      // 每行首尾像素同样原样保留
      let i = row;
      out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; out[i + 3] = src[i + 3];
      i = row + (w - 1) * 4;
      out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; out[i + 3] = src[i + 3];

      for (let x = 1; x < w - 1; x++) {
        i = row + x * 4;
        const iu = i - w4, id = i + w4, il = i - 4, ir = i + 4;
        for (let c = 0; c < 3; c++) {
          const v = src[i + c];
          const blur = (src[iu + c] + src[id + c] + src[il + c] + src[ir + c]) * 0.25;
          out[i + c] = v + (v - blur) * a;
        }
        out[i + 3] = src[i + 3];
      }
    }

    src.set(out);
    return imageData;
  }

  const API = { toGray, laplacian, focusScore, selectBest, downscalePlan, unsharp };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WMImg = API;
})(typeof window !== 'undefined' ? window : globalThis);
