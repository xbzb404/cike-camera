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

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
