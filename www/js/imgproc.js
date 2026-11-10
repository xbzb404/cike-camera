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

  const API = { toGray, laplacian, focusScore, selectBest, downscalePlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WMImg = API;
})(typeof window !== 'undefined' ? window : globalThis);
