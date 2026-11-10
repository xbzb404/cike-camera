'use strict';
/* ============================================================
   影调引擎单测
   ------------------------------------------------------------
   重点不是「参数改对了」，而是曲线的数学性质：
   单调、端点归位、暗场不漂白、白平衡不误判。
   运行：node tests/test-tone.js
   ============================================================ */

const assert = require('assert');
const Tone = require('../www/js/tone.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}

/* 构造合成图：按 [{rgb,count}] 铺像素 */
function img(spec) {
  let n = 0;
  for (const s of spec) n += s.count;
  const a = new Uint8ClampedArray(n * 4);
  let i = 0;
  for (const s of spec) {
    for (let k = 0; k < s.count; k++, i += 4) {
      a[i] = s.rgb[0]; a[i + 1] = s.rgb[1]; a[i + 2] = s.rgb[2]; a[i + 3] = 255;
    }
  }
  return a;
}

const GREY = [128, 128, 128];
const WHITE = [255, 255, 255];
const DARK = [26, 26, 26];

console.log('\n[1] analyze 分位与高光白点');
ok('中位与百分位算得对', () => {
  const s = Tone.analyze(img([{ rgb: GREY, count: 1000 }]), 1);
  assert.ok(Math.abs(s.p50 - 128 / 255) < 0.01, 'p50=' + s.p50);
  assert.ok(Math.abs(s.p1 - 128 / 255) < 0.02, 'p1=' + s.p1);
});
ok('7% 纯白 → p99.5 触顶', () => {
  const s = Tone.analyze(img([{ rgb: WHITE, count: 70 }, { rgb: [143, 143, 143], count: 930 }]), 1);
  assert.ok(s.p995 > 0.98, 'p995=' + s.p995);
  assert.ok(Math.abs(s.p50 - 143 / 255) < 0.01, 'p50=' + s.p50);
});
ok('高光区均值独立于全图均值', () => {
  // 90% 深蓝 + 10% 白：全图均值偏蓝，但高光均值应接近中性
  const s = Tone.analyze(img([
    { rgb: [10, 20, 90], count: 900 }, { rgb: WHITE, count: 100 }
  ]), 1);
  assert.ok(s.mb > s.mr, '全图应偏蓝');
  assert.ok(Math.abs(s.hr - s.hg) < 12 && Math.abs(s.hg - s.hb) < 12,
    '高光应中性: ' + [s.hr, s.hg, s.hb].map(Math.round).join('/'));
});
ok('空数据不炸', () => {
  const s = Tone.analyze(new Uint8ClampedArray(0), 1);
  assert.strictEqual(s.n, 0);
});

console.log('\n[2] 曲线单调性（非单调会撕裂）');
ok('三条通道曲线都严格不下降', () => {
  const cases = [
    [{ rgb: [143, 143, 143], count: 900 }, { rgb: WHITE, count: 100 }],
    [{ rgb: DARK, count: 1000 }],
    [{ rgb: [90, 100, 120], count: 1000 }]
  ];
  for (const c of cases) {
    const lut = Tone.buildLut(Tone.analyze(img(c), 1), {});
    for (const ch of ['r', 'g', 'b']) {
      for (let v = 1; v < 256; v++) {
        assert.ok(lut[ch][v] >= lut[ch][v - 1],
          ch + '[' + v + ']=' + lut[ch][v] + ' < ' + lut[ch][v - 1]);
      }
    }
  }
});
ok('黑端归零、白端留余量（不触顶）', () => {
  const lut = Tone.buildLut(Tone.analyze(img([
    { rgb: [30, 30, 30], count: 10 }, { rgb: GREY, count: 900 }, { rgb: [240, 240, 240], count: 90 }
  ]), 1), {});
  assert.ok(lut.r[0] <= 3, 'LUT[0]=' + lut.r[0]);
  // v1.5 起白端渐近到 0.985 而不是硬顶 255：
  // 触顶 255 意味着成片里出现一片 0 细节的死白，这正是「发白」的观感来源。
  assert.ok(lut.r[255] >= 248 && lut.r[255] <= 253, 'LUT[255]=' + lut.r[255]);
});

console.log('\n[3] 对比度与亮度行为');
ok('低对比画面 → 动态范围被拉开', () => {
  // 模拟实测那张图：像素挤在 69~144
  const s = Tone.analyze(img([
    { rgb: [69, 69, 69], count: 250 },
    { rgb: [111, 111, 111], count: 500 },
    { rgb: [144, 144, 144], count: 240 },
    { rgb: [250, 250, 250], count: 10 }
  ]), 1);
  const lut = Tone.buildLut(s, {});
  const before = 144 - 69;
  const after = lut.r[144] - lut.r[69];
  assert.ok(after > before * 1.4, '拉伸后 ' + after + ' 应远大于 ' + before);
});
ok('中位锚定到 0.46 附近', () => {
  const s = Tone.analyze(img([{ rgb: [110, 110, 110], count: 1000 }]), 1);
  const lut = Tone.buildLut(s, {});
  assert.ok(Math.abs(lut.r[110] - 118) < 20, 'LUT[110]=' + lut.r[110]);
});
ok('暗场景不被漂白', () => {
  const s = Tone.analyze(img([{ rgb: [18, 18, 18], count: 950 }, { rgb: [60, 60, 60], count: 50 }]), 1);
  const lut = Tone.buildLut(s, {});
  assert.ok(lut.r[18] < 70, '暗部被抬到 ' + lut.r[18] + '，太亮');
});
ok('手动曝光向左压暗', () => {
  const s = Tone.analyze(img([{ rgb: GREY, count: 1000 }]), 1);
  const a = Tone.buildLut(s, { exposure: 0 });
  const b = Tone.buildLut(s, { exposure: -0.3 });
  assert.ok(b.r[128] < a.r[128], b.r[128] + ' 应小于 ' + a.r[128]);
});
ok('手动曝光向右提亮', () => {
  const s = Tone.analyze(img([{ rgb: GREY, count: 1000 }]), 1);
  const a = Tone.buildLut(s, { exposure: 0 });
  const b = Tone.buildLut(s, { exposure: 0.3 });
  assert.ok(b.r[128] > a.r[128], b.r[128] + ' 应大于 ' + a.r[128]);
});

console.log('\n[4] 白平衡（白点法）');
ok('大面积单色场景不被误校正', () => {
  // 全画幅青色物体 + 少量中性高光：灰世界会把青色洗掉，白点法不会
  const s = Tone.analyze(img([
    { rgb: [40, 120, 140], count: 900 },
    { rgb: [235, 235, 235], count: 100 }
  ]), 1);
  const g = Tone.grayGains(s);
  assert.ok(Math.abs(g.r - 1) < 0.06 && Math.abs(g.b - 1) < 0.06,
    '不该动: ' + JSON.stringify(g));
});
ok('偏黄光源被纠正', () => {
  const s = Object.assign({}, Tone.analyze(img([{ rgb: GREY, count: 10 }]), 1),
    { hr: 250, hg: 235, hb: 180 });
  const g = Tone.grayGains(s);
  assert.ok(g.r < 0.98, 'R 应被压: ' + g.r);
  assert.ok(g.b > 1.02, 'B 应被抬: ' + g.b);
});
ok('高光不够亮时不动白平衡', () => {
  const s = Tone.analyze(img([{ rgb: [30, 40, 60], count: 1000 }]), 1);
  const g = Tone.grayGains(s);
  assert.strictEqual(g.r, 1); assert.strictEqual(g.g, 1); assert.strictEqual(g.b, 1);
});

console.log('\n[5] 取图路径判定');
ok('轻微过曝不弃用原生图', () => {
  assert.strictEqual(Tone.shouldReplacePhoto(
    { n: 1000, blown: 0.12, mean: 180 }, { n: 1000, blown: 0.04, mean: 150 }), false);
});
ok('严重死白才弃用', () => {
  assert.strictEqual(Tone.shouldReplacePhoto(
    { n: 1000, blown: 0.62, mean: 245 }, { n: 1000, blown: 0.10, mean: 170 }), true);
});
ok('均值极高且差距大才换', () => {
  assert.strictEqual(Tone.shouldReplacePhoto(
    { n: 1000, blown: 0.20, mean: 240 }, { n: 1000, blown: 0.10, mean: 180 }), true);
});
ok('数据不全时不换', () => {
  assert.strictEqual(Tone.shouldReplacePhoto(null, { n: 1 }), false);
  assert.strictEqual(Tone.shouldReplacePhoto({ n: 1 }, null), false);
});

console.log('\n[6] 预览近似');
ok('LUT 存在时 previewFilter 不返回 none', () => {
  const s = Tone.analyze(img([{ rgb: [143, 143, 143], count: 900 }, { rgb: WHITE, count: 100 }]), 1);
  const f = Tone.previewFilter(Tone.buildLut(s, {}));
  assert.ok(f !== 'none' && /contrast\(/.test(f), f);
});
ok('null 输入返回 none', () => {
  assert.strictEqual(Tone.previewFilter(null), 'none');
});

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
