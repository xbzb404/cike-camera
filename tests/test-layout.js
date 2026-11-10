/* ============================================================
   排版自检：用假 canvas 记录 draw 调用，验证
     1) 同一列的文字行之间不重叠
     2) 文字不越出画面边界
     3) 所有 8 种样式 × 3 种位置 × 3 种字号都能画完不抛错
   运行：node tests/test-layout.js
   ============================================================ */
'use strict';

const path = require('path');
const assert = require('assert');
const WM = require(path.join(__dirname, '..', 'www', 'js', 'wm-core.js'));

/* 引擎在自适应缩放时会用一个离屏 canvas 做“预演”，
   Node 里没有 DOM，这里给个最小替身，让该分支也能被测到。 */
global.document = {
  createElement() {
    return {
      width: 1, height: 1,
      getContext() { return fakeCtx(1, 1); }
    };
  }
};

/* ---------------- 假 canvas ---------------- */
function fakeCtx(W, H) {
  const texts = [];
  let fontSize = 16;
  let align = 'left';
  let baseline = 'alphabetic';

  const ctx = {
    canvas: { width: W, height: H },
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arcTo() {}, rect() {}, fill() {}, stroke() {}, clip() {},
    translate() {}, scale() {}, setTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    drawImage() {},
    set font(v) {
      const m = /(\d+(?:\.\d+)?)px/.exec(v);
      if (m) fontSize = parseFloat(m[1]);
    },
    get font() { return fontSize + 'px sans'; },
    set textAlign(v) { align = v; },
    get textAlign() { return align; },
    set textBaseline(v) { baseline = v; },
    get textBaseline() { return baseline; },
    measureText(t) {
      // 中文按 1.0 em、其余按 0.55 em 估算，足够判断越界
      let w = 0;
      for (const ch of String(t)) w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.55;
      return { width: w };
    },
    fillText(t, x, y) {
      texts.push({ t: String(t), x, y, size: fontSize, align });
    }
  };
  ctx.__texts = texts;
  return ctx;
}

/* ---------------- 测试数据 ---------------- */
const S = {
  title: 'XX 项目部 · 张三',
  showTime: true, showSeconds: true, showPlace: true, showCoords: true,
  showWeather: true, showAltitude: true, showAccuracy: true, showCode: true,
  coordFmt: 'zh',
  fields: [{ k: '标段', v: '三标' }, { k: '工序', v: '混凝土浇筑' }]
};

const base = {
  time: new Date(2026, 10, 10, 14, 32, 17),
  lat: 31.230416, lng: 121.473701, acc: 8, altitude: 12.4,
  addr: '江苏省南京市玄武区中山东路 1 号（近 XX 大厦）',
  weather: '18°C 多云'
};

const d = WM.buildData(base, S, 'K7MQ-3PZA');

const SIZES = [
  { W: 1080, H: 1440, name: '1080p 4:3' },
  { W: 4000, H: 3000, name: '12MP' },
  { W: 420, H: 560, name: '缩略图' }
];
const POS = ['bottom', 'br', 'top'];
const SCALES = [0.85, 1, 1.15];

let fail = 0;
let checks = 0;

function report(tag, errs) {
  checks++;
  if (errs.length) {
    fail++;
    console.log(`  ✗ ${tag}`);
    for (const e of errs.slice(0, 4)) console.log('      ' + e);
  }
}

for (const meta of WM.STYLES) {
  for (const sz of SIZES) {
    for (const pos of POS) {
      for (const scale of SCALES) {
        const ctx = fakeCtx(sz.W, sz.H);
        const tag = `${meta.id} / ${sz.name} / pos=${pos} / scale=${scale}`;
        const errs = [];

        try {
          WM.draw(ctx, sz.W, sz.H, d, { style: meta.id, pos, scale, ink: 'dark', s: S });
        } catch (e) {
          errs.push('抛异常: ' + e.message);
        }

        const texts = ctx.__texts;

        // ① 越界检查（留 1px 容差）
        for (const t of texts) {
          const w = ctx.measureText.call(fakeMeasure(t.size), t.t).width;
          const left = t.align === 'right' ? t.x - w : t.x;
          const right = t.align === 'right' ? t.x : t.x + w;
          if (left < -1 || right > sz.W + 1) {
            errs.push(`"${t.t.slice(0, 12)}" 横向越界 x=${left.toFixed(0)}..${right.toFixed(0)} > ${sz.W}`);
          }
          if (t.y < -1 || t.y > sz.H + 1) {
            errs.push(`"${t.t.slice(0, 12)}" 纵向越界 y=${t.y.toFixed(0)} > ${sz.H}`);
          }
        }

        // ② 重叠检查：按 x 起点分组（同一列），上下行间距不得小于字号 * 0.85
        const cols = new Map();
        for (const t of texts) {
          const key = Math.round(t.x / 8);
          if (!cols.has(key)) cols.set(key, []);
          cols.get(key).push(t);
        }
        for (const list of cols.values()) {
          list.sort((a, b) => a.y - b.y);
          for (let i = 1; i < list.length; i++) {
            const a = list[i - 1], b = list[i];
            const gap = b.y - a.y;
            const need = Math.min(a.size, b.size) * 0.86;
            if (gap < need) {
              errs.push(`重叠 "${a.t.slice(0, 10)}" 与 "${b.t.slice(0, 10)}" 间距 ${gap.toFixed(1)} < ${need.toFixed(1)}`);
            }
          }
        }

        report(tag, errs);
      }
    }
  }
}

/* 帮助函数：借用同尺寸量宽 */
function fakeMeasure(size) {
  return {
    measureText(t) {
      let w = 0;
      for (const ch of String(t)) w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? size : size * 0.55;
      return { width: w };
    }
  };
}

console.log(`\n检查 ${checks} 组，失败 ${fail} 组`);
process.exit(fail ? 1 : 0);
