/* ============================================================
   影调（曝光）分析测试
   ------------------------------------------------------------
   针对「拍出来发白」这条问题，验证三件事：
     1. 高光溢出比例算得对（决定降几档）
     2. 正常场景不要乱动（晴天天空本来就有高光）
     3. takePhoto 比预览帧更白时要判定为「该换掉」
   运行：node tests/test-tone.js
   ============================================================ */
'use strict';

const path = require('path');
const assert = require('assert');
const Tone = require(path.join(__dirname, '..', 'www', 'js', 'tone.js'));

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); fail++; }
}

/* 造一张 RGBA 图：rgb 为 [r,g,b]，count 为像素数 */
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

const WHITE = [255, 255, 255];
const GREY = [128, 128, 128];
const BLACK = [0, 0, 0];

console.log('\n[1] 统计量');
ok('全灰 mean≈128、无溢出', () => {
  const s = Tone.analyze(img([{ rgb: GREY, count: 1000 }]), 1);
  assert.ok(Math.abs(s.mean - 128) < 1, 'mean=' + s.mean);
  assert.strictEqual(s.blown, 0);
  assert.strictEqual(s.dark, 0);
});
ok('全白 blown=1', () => {
  const s = Tone.analyze(img([{ rgb: WHITE, count: 500 }]), 1);
  assert.strictEqual(s.blown, 1);
});
ok('全黑 dark=1', () => {
  const s = Tone.analyze(img([{ rgb: BLACK, count: 500 }]), 1);
  assert.strictEqual(s.dark, 1);
});
ok('抽样步长不改变结论', () => {
  const a = img([{ rgb: WHITE, count: 300 }, { rgb: GREY, count: 700 }]);
  const s1 = Tone.analyze(a, 1), s4 = Tone.analyze(a, 4);
  assert.ok(Math.abs(s1.blown - s4.blown) < 0.02, s1.blown + ' vs ' + s4.blown);
});
ok('空数据不炸', () => {
  const s = Tone.analyze(new Uint8ClampedArray(0), 1);
  assert.strictEqual(s.n, 0);
  assert.strictEqual(Tone.brightnessFor(s), 1);
});

console.log('\n[2] 亮度建议');
ok('严重发白（30% 溢出）压到 0.80', () => {
  const s = Tone.analyze(img([{ rgb: WHITE, count: 300 }, { rgb: [200, 200, 200], count: 700 }]), 1);
  assert.ok(s.blown > 0.28, 'blown=' + s.blown);
  assert.strictEqual(Tone.brightnessFor(s), 0.80);
});
ok('明显发白（18% 溢出 + 均值偏高）压到 0.80', () => {
  const s = Tone.analyze(img([{ rgb: WHITE, count: 180 }, { rgb: [200, 200, 200], count: 820 }]), 1);
  assert.strictEqual(Tone.brightnessFor(s), 0.80);
});
ok('中等发白（12% 溢出）压到 0.88', () => {
  const s = Tone.analyze(img([{ rgb: WHITE, count: 120 }, { rgb: [150, 150, 150], count: 880 }]), 1);
  assert.strictEqual(Tone.brightnessFor(s), 0.88);
});
ok('整体偏亮但没溢出 → 0.92', () => {
  const s = Tone.analyze(img([{ rgb: [210, 210, 210], count: 1000 }]), 1);
  assert.strictEqual(Tone.brightnessFor(s), 0.92);
});
ok('正常晴天（少量高光、均值 140）不动', () => {
  const s = Tone.analyze(img([{ rgb: WHITE, count: 50 }, { rgb: [137, 137, 137], count: 950 }]), 1);
  assert.ok(s.blown < 0.06, 'blown=' + s.blown);
  assert.strictEqual(Tone.brightnessFor(s), 1);
});
ok('偏暗夜景提亮到 1.08', () => {
  const s = Tone.analyze(img([{ rgb: [30, 30, 30], count: 1000 }]), 1);
  assert.strictEqual(Tone.brightnessFor(s), 1.08);
});
ok('压暗时补对比度', () => {
  assert.strictEqual(Tone.contrastFor(1), 1);
  assert.ok(Tone.contrastFor(0.8) > 1.1, 'contrast=' + Tone.contrastFor(0.8));
});

console.log('\n[3] takePhoto 偏亮判定');
ok('原生图 30% 溢出、预览帧 5% → 换掉', () => {
  const photo = Tone.analyze(img([{ rgb: WHITE, count: 300 }, { rgb: [190, 190, 190], count: 700 }]), 1);
  const frame = Tone.analyze(img([{ rgb: WHITE, count: 50 }, { rgb: [120, 120, 120], count: 950 }]), 1);
  assert.strictEqual(Tone.shouldReplacePhoto(photo, frame), true);
});
ok('两者都正常 → 不动', () => {
  const photo = Tone.analyze(img([{ rgb: [130, 130, 130], count: 1000 }]), 1);
  const frame = Tone.analyze(img([{ rgb: [128, 128, 128], count: 1000 }]), 1);
  assert.strictEqual(Tone.shouldReplacePhoto(photo, frame), false);
});
ok('原生图只是略亮（3%）→ 不值得牺牲分辨率', () => {
  const photo = Tone.analyze(img([{ rgb: WHITE, count: 60 }, { rgb: [140, 140, 140], count: 940 }]), 1);
  const frame = Tone.analyze(img([{ rgb: WHITE, count: 10 }, { rgb: [138, 138, 138], count: 990 }]), 1);
  assert.strictEqual(Tone.shouldReplacePhoto(photo, frame), false);
});
ok('预览帧缺失时不换', () => {
  const photo = Tone.analyze(img([{ rgb: WHITE, count: 500 }, { rgb: GREY, count: 500 }]), 1);
  assert.strictEqual(Tone.shouldReplacePhoto(photo, null), false);
});

console.log('\n[4] 防抖与 filter 字符串');
ok('差异小于 3.5% 不更新预览', () => {
  assert.strictEqual(Tone.shouldUpdate(1, 1.02), false);
  assert.strictEqual(Tone.shouldUpdate(1, 0.88), true);
  assert.strictEqual(Tone.shouldUpdate(null, 0.9), true);
});
ok('无修正时返回 none', () => {
  assert.strictEqual(Tone.cssFilter(1, 1), 'none');
  assert.strictEqual(Tone.cssFilter(1.001, 1.002), 'none');
});
ok('有修正时生成合法 CSS', () => {
  const f = Tone.cssFilter(0.8, 1.18);
  assert.ok(/^brightness\(0\.800\) contrast\(1\.180\)$/.test(f), f);
});
ok('参数越界被夹住', () => {
  const f = Tone.cssFilter(0.01, 9);
  assert.ok(/brightness\(0\.500\) contrast\(1\.500\)/.test(f), f);
});

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
