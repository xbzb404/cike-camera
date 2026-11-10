/* ============================================================
   图像算法测试：对焦评分 / 多帧择优 / 渐进降采样
   ------------------------------------------------------------
   这几条都是在验证「算法本身讲不讲究」，不依赖浏览器：
     · 清晰图必须比模糊图得分高
     · 纯色块得分为 0（不能因为没纹理就误判成糊）
     · 过曝帧即使更「锐」也要被压分
     · 大比例缩小时必须分步减半
   运行：node tests/test-imgproc.js
   ============================================================ */
'use strict';

const path = require('path');
const assert = require('assert');
const Img = require(path.join(__dirname, '..', 'www', 'js', 'imgproc.js'));

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}

/* 生成灰度图（转成 RGBA） */
function makeGray(w, h, fn) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const i = (y * w + x) * 4;
      a[i] = a[i + 1] = a[i + 2] = v;
      a[i + 3] = 255;
    }
  }
  return a;
}

/* 3×3 均值模糊，模拟失焦 */
function blur(data, w, h) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          s += data[(yy * w + xx) * 4];
          n++;
        }
      }
      const i = (y * w + x) * 4;
      const v = s / n;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

const W = 96, H = 96;
const checker = makeGray(W, H, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 235 : 20);
const smooth = makeGray(W, H, (x, y) => (x / W) * 255);
const flat = makeGray(W, H, () => 128);
const noise = makeGray(W, H, (x, y) => 128 + (((x * 37 + y * 91) % 23) - 11) * 9);

console.log('\n[1] 对焦评分');
ok('棋盘格「实测」比模糊后高', () => {
  const a = Img.focusScore(checker, W, H).score;
  const b = Img.focusScore(blur(checker, W, H), W, H).score;
  assert.ok(a > b * 2, `清晰 ${a.toFixed(0)} vs 模糊 ${b.toFixed(0)}`);
});
ok('渐变图得分远低于棋盘格', () => {
  const g = Img.focusScore(smooth, W, H).score;
  const c = Img.focusScore(checker, W, H).score;
  assert.ok(g < c / 50, `渐变 ${g.toFixed(2)} 棋盘 ${c.toFixed(0)}`);
});
ok('纯色块得分为 0、纹理为 0', () => {
  const r = Img.focusScore(flat, W, H);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.texture, 0);
});
ok('细噪点的纹理值明显大于纯色', () => {
  assert.ok(Img.focusScore(noise, W, H).texture > Img.focusScore(flat, W, H).texture + 5);
});
ok('参数不合法时不抛异常', () => {
  assert.strictEqual(Img.focusScore(null, W, H).score, 0);
  assert.strictEqual(Img.focusScore(flat, 2, 2).score, 0);
});

console.log('\n[2] 多帧择优');
ok('清晰度优先：分高者胜出', () => {
  assert.strictEqual(Img.selectBest([{ score: 100, blown: 0 }, { score: 300, blown: 0 }]), 1);
});
ok('过曝帧被压分：白掉的「锐」不算锐', () => {
  // 300 分但 30% 溢出 → 300*(1-0.9)=30；180 分干净 → 180
  assert.strictEqual(Img.selectBest([{ score: 300, blown: 0.3 }, { score: 180, blown: 0 }]), 1);
});
ok('完全一样的帧取第一张', () => {
  assert.strictEqual(Img.selectBest([{ score: 50, blown: 0 }, { score: 50, blown: 0 }]), 0);
});
ok('缺字段不崩', () => {
  assert.strictEqual(Img.selectBest([{}, { score: 10 }]), 1);
  assert.strictEqual(Img.selectBest([]), -1);
});

console.log('\n[3] 渐进降采样');
ok('4 倍缩小拆成两步', () => {
  const p = Img.downscalePlan(4000, 3000, 1000);
  assert.strictEqual(p.length, 1, JSON.stringify(p));
  assert.deepStrictEqual(p[0], { w: 2000, h: 1500 });
});
ok('8 倍缩小拆成多级，末级仍大于目标（最后一步由主画布完成）', () => {
  const p = Img.downscalePlan(8000, 6000, 1000);
  assert.ok(p.length >= 2 && p.length <= 4, JSON.stringify(p));
  assert.deepStrictEqual(p[0], { w: 4000, h: 3000 });
  const last = p[p.length - 1];
  assert.ok(last.w >= 1000 && last.w <= 2100, JSON.stringify(last));
  assert.ok(Math.abs(last.w / last.h - 4 / 3) < 0.01, '宽高比应保持');
});
ok('缩小不到 2 倍时一步到位', () => {
  assert.strictEqual(Img.downscalePlan(2875, 2160, 1440).length, 0);
});
ok('放大时不插步骤', () => {
  assert.strictEqual(Img.downscalePlan(800, 600, 1600).length, 0);
});
ok('非法参数返回空计划', () => {
  assert.strictEqual(Img.downscalePlan(0, 0, 100).length, 0);
  assert.strictEqual(Img.downscalePlan(4000, 3000, 0).length, 0);
});
ok('每一步都严格小于上一步、大于目标', () => {
  const p = Img.downscalePlan(6000, 4000, 800);
  let prevW = 6000;
  for (const s of p) {
    assert.ok(s.w < prevW, '应递减');
    assert.ok(s.w >= 800 * 1.05, '不应小于目标');
    prevW = s.w;
  }
});

/* ---------------- 锐化 ---------------- */
function ramp(w, h) {
  // 一条硬边：左半 60，右半 190。锐化会在边缘两侧拉出过冲
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = x < w / 2 ? 60 : 190;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  }
  return { data: d, width: w, height: h };
}

ok('锐化在硬边两侧拉出过冲（暗侧更暗、亮侧更亮）', () => {
  const w = 32, h = 16;
  const img = ramp(w, h);
  const before = Array.from(img.data);
  Img.unsharp(img, w, h, 0.6);
  const row = 8 * w;
  const left = (row + w / 2 - 1) * 4;   // 边左侧最后一个像素
  const right = (row + w / 2) * 4;      // 边右侧第一个像素
  assert.ok(img.data[left] < before[left], '暗侧应更暗：' + img.data[left] + ' vs ' + before[left]);
  assert.ok(img.data[right] > before[right], '亮侧应更亮：' + img.data[right] + ' vs ' + before[right]);
});

ok('锐化不改变平坦区域与透明度', () => {
  const w = 16, h = 16;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 128; d[i + 3] = 200; }
  const img = { data: d, width: w, height: h };
  Img.unsharp(img, w, h, 0.8);
  for (let i = 0; i < d.length; i += 4) {
    assert.strictEqual(d[i], 128, '平坦区不应被改变');
    assert.strictEqual(d[i + 3], 200, 'alpha 不应被改变');
  }
});

ok('强度为 0 时是恒等变换', () => {
  const w = 24, h = 8;
  const img = ramp(w, h);
  const before = Array.from(img.data);
  Img.unsharp(img, w, h, 0);
  assert.deepStrictEqual(Array.from(img.data), before);
});

ok('超过像素上限时跳过（避免 12MP 逐像素卡住快门）', () => {
  const w = 40, h = 40;
  const img = ramp(w, h);
  const before = Array.from(img.data);
  Img.unsharp(img, w, h, 0.6, 100);
  assert.deepStrictEqual(Array.from(img.data), before);
});

ok('边缘一圈像素原样保留，不会越界读', () => {
  const w = 12, h = 12;
  const img = ramp(w, h);
  const before = Array.from(img.data);
  Img.unsharp(img, w, h, 0.9);
  for (let x = 0; x < w; x++) {
    const t = x * 4, b = ((h - 1) * w + x) * 4;
    assert.strictEqual(img.data[t], before[t]);
    assert.strictEqual(img.data[b], before[b]);
  }
});

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
