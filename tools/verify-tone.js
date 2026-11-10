'use strict';
/* 用真实照片验证影调引擎：把 wm-core/tone 的 LUT 跑在「软件拍的」那张上，
   与「原生相机」的直方图对照。纯离线验算，不进 APK。 */
const path = require('path');
const { chromium } = require(process.env.PW_PATH || 'playwright-core');

const CHROME = process.env.CHROME_PATH ||
  'C:/Users/zhb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const SRC = process.env.SRC_IMG ||
  'C:/Users/zhb/Downloads/此刻_20261110_123928_TL4XGZS7.jpg';
const REF = process.env.REF_IMG ||
  'C:/Users/zhb/Downloads/IMG_20261110_123945.jpg';

const fs0 = require('fs');
const toUrl = (p) => 'data:image/jpeg;base64,' + fs0.readFileSync(path.resolve(p)).toString('base64');

(async () => {
  const b = await chromium.launch({
    executablePath: CHROME,
    args: ['--allow-file-access-from-files', '--disable-web-security']
  });
  const c = await b.newContext({ viewport: { width: 900, height: 700 } });
  const p = await c.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message));

  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ path: path.resolve(__dirname, '..', 'www', 'js', 'tone.js') });

  const load = async (url) => p.evaluate(async (u) => {
    const img = new Image();
    img.src = u;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    window.__cv = cv;
    return { w: cv.width, h: cv.height };
  }, url);

  const stat = async (label) => p.evaluate((label) => {
    const cv = window.__cv;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const s = window.WMCTone.analyze(d, 3);
    // 计算标准差
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 12) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; sum2 += l * l; n++;
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    return {
      label,
      size: cv.width + 'x' + cv.height,
      mean: +mean.toFixed(1), std: +std.toFixed(1),
      p1: Math.round(s.p1 * 255), p50: Math.round(s.p50 * 255),
      p98: Math.round(s.p98 * 255), p995: Math.round(s.p995 * 255),
      blown: +(s.blown * 100).toFixed(2),
      rgb: [Math.round(s.mr), Math.round(s.mg), Math.round(s.mb)],
      span: Math.round((s.p995 - s.p1) * 255)
    };
  }, label);

  const out = [];

  // 参考：原生相机
  await load(toUrl(REF));
  out.push(await stat('原生相机'));

  // 软件原片
  await load(toUrl(SRC));
  out.push(await stat('软件·未处理'));

  // 软件 + 新 LUT
  await p.evaluate(() => {
    const cv = window.__cv;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const s = window.WMCTone.analyze(img.data, 3);
    const lut = window.WMCTone.buildLut(s, { exposure: 0, wb: true });
    window.WMCTone.applyLut(img.data, lut);
    ctx.putImageData(img, 0, 0);
    window.__lut = { black: lut.black, white: lut.white, gains: lut.gains };
  });
  out.push(await stat('软件＋新LUT'));

  // 导出处理后图片
  await p.evaluate(() => {
    const cv = window.__cv;
    const a = document.createElement('a');
    window.__b64 = cv.toDataURL('image/jpeg', 0.94);
  });
  const b64 = await p.evaluate(() => window.__b64);
  const fs = require('fs');
  fs.writeFileSync(path.join(__dirname, '_tone-out.jpg'),
    Buffer.from(b64.split(',')[1], 'base64'));

  const lut = await p.evaluate(() => window.__lut);

  console.log('\n=== 影调引擎实测 ===');
  console.log('LUT: black=' + lut.black.toFixed(1) + '  white=' + lut.white.toFixed(1) +
    '  WB增益 R' + lut.gains.r.toFixed(3) + ' G' + lut.gains.g.toFixed(3) + ' B' + lut.gains.b.toFixed(3));
  console.log('----------------------------------------------------------------------------');
  console.log('样本'.padEnd(14) + '均值'.padStart(6) + '标准差'.padStart(8) +
    'P1'.padStart(6) + 'P50'.padStart(6) + 'P98'.padStart(6) + 'P99.5'.padStart(7) +
    '动态范围'.padStart(9) + '   RGB均值');
  for (const r of out) {
    console.log(
      r.label.padEnd(14) +
      String(r.mean).padStart(6) + String(r.std).padStart(8) +
      String(r.p1).padStart(6) + String(r.p50).padStart(6) +
      String(r.p98).padStart(6) + String(r.p995).padStart(7) +
      String(r.span).padStart(9) + '   ' + r.rgb.join('/')
    );
  }
  console.log('----------------------------------------------------------------------------');

  const ref = out[0], before = out[1], after = out[2];
  console.log('标准差（对比度）：原生 ' + ref.std + ' | 处理前 ' + before.std +
    ' → 处理后 ' + after.std + '（原生为 100% 时：' +
    (100 * before.std / ref.std).toFixed(0) + '% → ' + (100 * after.std / ref.std).toFixed(0) + '%）');
  console.log('动态范围：原生 ' + ref.span + ' | 处理前 ' + before.span +
    ' → 处理后 ' + after.span);
  console.log('通道偏差（max-min）：原生 ' +
    (Math.max(...ref.rgb) - Math.min(...ref.rgb)) + ' | 处理前 ' +
    (Math.max(...before.rgb) - Math.min(...before.rgb)) + ' → 处理后 ' +
    (Math.max(...after.rgb) - Math.min(...after.rgb)));

  await b.close();
})();
