/* ============================================================
   曝光/影调分析（纯函数，可在 Node 里跑）
   ------------------------------------------------------------
   拍照「发白」有两种典型情况，这一步负责把它们量化并从成片上补救：

   1. 高光溢出：亮部被推到 255 后细节丢失。看 blown（>250 的像素占比）。
   2. 整体过亮：均值被拉高，画面灰白。看 mean。

   给出的建议是一个亮度/对比度系数，用 canvas ctx.filter 施加，
   对 GPU 友好，而且发生在水印绘制与签名之前，不影响验真。
   ============================================================ */
(function (root) {
  'use strict';

  /* data: Uint8ClampedArray(RGBA)，step: 每 N 个像素取一个（抽样加速） */
  function analyze(data, step) {
    const st = Math.max(1, step | 0 || 4);
    let n = 0, sum = 0, blown = 0, dark = 0, mid = 0;
    for (let i = 0; i < data.length; i += 4 * st) {
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += l;
      n++;
      if (l > 250) blown++;
      else if (l < 12) dark++;
      else if (l > 200) mid++;
    }
    if (!n) return { n: 0, mean: 0, blown: 0, dark: 0, mid: 0 };
    return {
      n,
      mean: sum / n,
      blown: blown / n,
      dark: dark / n,
      mid: mid / n
    };
  }

  /* 建议的亮度系数：1 表示不动，<1 压暗。
     阈值偏保守：要「明显发白」才动手，正常晴天场景（天空占一部分高光）不动它，
     否则会把本来正常的照片压灰。 */
  function brightnessFor(s) {
    if (!s || !s.n) return 1;
    if (s.blown >= 0.28 || (s.blown >= 0.18 && s.mean >= 165)) return 0.80;
    if (s.blown >= 0.12 || (s.blown >= 0.07 && s.mean >= 178)) return 0.88;
    if (s.mean >= 198) return 0.92;
    if (s.mean < 42 && s.blown < 0.02) return 1.08;
    return 1;
  }

  /* 压暗时补一点对比度，避免「暗而灰」 */
  function contrastFor(b) {
    if (b >= 0.99) return 1;
    return 1 + (1 - b) * 0.9;   // b=0.76 → 1.216
  }

  /* 高光溢出比例差多少才值得换一张 */
  function shouldReplacePhoto(photo, frame) {
    if (!photo || !photo.n) return false;
    if (!frame || !frame.n) return false;
    // 原生照片明显比预览帧更过曝 → 说明这条取图路径不可信
    if (photo.blown > 0.10 && photo.blown - frame.blown > 0.06) return true;
    if (photo.mean > 205 && frame.mean < photo.mean - 18) return true;
    return false;
  }

  /* 两次采样差别足够大才更新，避免预览亮度来回跳 */
  function shouldUpdate(prev, next) {
    if (!prev) return true;
    return Math.abs(prev - next) >= 0.035;
  }

  function cssFilter(b, c) {
    const bb = Math.max(0.5, Math.min(1.6, b));
    const cc = Math.max(0.8, Math.min(1.5, c));
    if (Math.abs(bb - 1) < 0.005 && Math.abs(cc - 1) < 0.005) return 'none';
    return 'brightness(' + bb.toFixed(3) + ') contrast(' + cc.toFixed(3) + ')';
  }

  const API = { analyze, brightnessFor, contrastFor, shouldReplacePhoto, shouldUpdate, cssFilter };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WMCTone = API;
})(typeof window !== 'undefined' ? window : globalThis);
