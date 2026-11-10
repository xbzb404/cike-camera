/* ============================================================
   端到端拍摄测试（需要 Playwright）
   ------------------------------------------------------------
   用 Chromium 的假摄像头 + 假定位，跑完真实链路：
     快门 → 取图（ImageCapture 失败则多帧择优）→ 水印 → JPEG
     → EXIF → ECDSA 签名 → 预览
   然后把成片取出来，在 Node 里独立做三件事：
     1. EXIF 能读回拍摄时间与坐标
     2. 找得到 WMC 签名段
     3. 用签名段里的公钥能验过签名，且图片哈希一致
   ------------------------------------------------------------
   运行：
     PW_PATH=<playwright-core 目录> node tests/e2e-capture.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let chromium;
try {
  ({ chromium } = require(process.env.PW_PATH || 'playwright-core'));
} catch (e) {
  console.error('需要 playwright-core：npm i playwright-core，或用 PW_PATH 指定路径');
  process.exit(2);
}

const WMCExif = require(path.join(__dirname, '..', 'www', 'js', 'exif.js'));
const WMC = require(path.join(__dirname, '..', 'www', 'js', 'crypto-wmc.js'));

const CHROME = process.env.CHROME_PATH ||
  'C:/Users/zhb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const URL = 'file:///' + path.resolve(__dirname, '..', 'www', 'index.html').replace(/\\/g, '/');
const OUT = path.resolve(__dirname, '..', 'build', 'e2e-shot.jpg');

const LAT = 31.230416;
const LNG = 121.473701;

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--allow-file-access-from-files'
    ]
  });
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 920 },
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: LAT, longitude: LNG, accuracy: 8 }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  const state = await page.evaluate(() => ({
    vw: document.querySelector('#video').videoWidth,
    vh: document.querySelector('#video').videoHeight,
    guard: document.querySelector('#stageGuard').classList.contains('show'),
    guardText: document.querySelector('#guardText').textContent
  }));
  console.log('取景器:', state.vw + 'x' + state.vh, state.guard ? '(提示: ' + state.guardText + ')' : '');

  if (!state.vw) throw new Error('假摄像头没有出图，无法继续');

  // 等定位回填（离线环境可能拿不到地址，不影响签名）
  await page.waitForTimeout(1200);

  await page.click('#btnShutter');
  await page.waitForSelector('#preview.show', { timeout: 20000 });
  await page.waitForTimeout(600);

  const res = await page.evaluate(async () => {
    const buf = new Uint8Array(await shotBlob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 4096) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + 4096));
    }
    return {
      b64: btoa(s),
      code: shotCode,
      size: shotBlob.size,
      type: shotBlob.type,
      previewSrc: document.querySelector('#previewImg').src.slice(0, 5),
      codeText: document.querySelector('#previewCode').textContent
    };
  });

  const bytes = Buffer.from(res.b64, 'base64');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bytes);
  console.log(`成片: ${bytes.length} 字节写入 ${path.relative(process.cwd(), OUT)}`);
  console.log(`预览已打开: ${res.previewSrc === 'data:' || res.previewSrc === 'blob:'} / 验真码 ${res.code || '(无)'}`);

  /* ---------- 离线校验 ---------- */
  const report = [];
  const ok = (name, cond, extra) => {
    report.push({ name, pass: !!cond, extra });
    console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`);
  };

  const jp = new Uint8Array(bytes);
  const exif = WMCExif.read(jp);
  ok('成片是 JPEG', bytes[0] === 0xFF && bytes[1] === 0xD8);
  ok('写入了 EXIF 拍摄时间', !!(exif && exif.date), exif && exif.date ? exif.date.toISOString() : '');
  ok('写入了 EXIF GPS', !!(exif && exif.hasGps),
    exif && exif.hasGps ? `${exif.lat.toFixed(5)}, ${exif.lng.toFixed(5)}` : '无');
  ok('GPS 与注入值一致（<1e-5）', exif && Math.abs(exif.lat - LAT) < 1e-5 && Math.abs(exif.lng - LNG) < 1e-5);
  ok('EXIF 机型字段已写', !!(exif && exif.model), exif ? exif.model : '');

  const seg = WMC.jpeg.extract(jp);
  ok('存在 WMC 签名段', !!seg);
  if (seg) {
    ok('签名段带验真码', !!seg.code, seg.code);
    const imhNow = WMC.base32(await WMC.sha256(WMC.jpeg.strip(jp)), 26);
    ok('图像哈希一致（未被改动）', imhNow === seg.imh, imhNow + ' vs ' + seg.imh);
    const target = WMC.signTarget(seg.core || {}, seg.code, seg.imh);
    const good = await WMC.verifySig(seg.pub || {}, target, WMC.fromB64url(seg.sig));
    ok('ECDSA 签名验签通过', good);
    ok('签名段记录的分辨率合理', seg.dev && seg.dev.w > 0 && seg.dev.h > 0, seg.dev ? `${seg.dev.w}x${seg.dev.h}` : '');
    ok('签名段版本号 = 1.3.0', !!(seg.dev && seg.dev.ver === '1.3.0'), seg.dev && seg.dev.ver);
  }

  ok('运行期无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---------- 验真页闭环 ---------- */
  const vp = await ctx.newPage();
  const vErr = [];
  vp.on('pageerror', e => vErr.push(e.message));
  await vp.goto('file:///' + path.resolve(__dirname, '..', 'www', 'verify.html').replace(/\\/g, '/'));
  await vp.setInputFiles('#fileInput', OUT);
  await vp.waitForSelector('#result .verdict h2', { timeout: 15000 });
  await vp.waitForTimeout(400);
  const verdict = await vp.evaluate(() => ({
    title: document.querySelector('#result .verdict h2').textContent.trim(),
    rows: document.querySelector('#result').textContent.replace(/\s+/g, ' ').slice(0, 220)
  }));
  ok('验真页判定为「签名有效·未受信」', /签名有效/.test(verdict.title), verdict.title);
  ok('验真页无 JS 错误', vErr.length === 0);
  await vp.close();

  await browser.close();

  const failed = report.filter(r => !r.pass).length;
  console.log(`\n通过 ${report.length - failed} / ${report.length}`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('测试异常:', e && e.message);
  process.exit(1);
});
