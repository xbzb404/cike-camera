/* 验证「图片尺寸」档位：自动 / 2MP（1920×1440）/ 1MP（1280×960）。
   检查三点：
     1) 指定档位只缩不放，长边不超过目标；
     2) 横拍竖拍拿到的长边一致（大小固定），方向跟着转；
     3) 档位列表按摄像头能力生成，不出现设备给不到的档位。 */
const path = require('path');
const { chromium } = require(path.resolve(process.env.PW_PATH || 'playwright-core'));
const CHROME = process.env.CHROME_PATH ||
  'C:/Users/zhb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--allow-file-access-from-files' ] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 920 }, permissions: ['camera'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file:///' + path.resolve(__dirname, '../www/index.html').replace(/\\/g, '/'));
  await p.waitForTimeout(2200);

  /* 档位列表：应当由摄像头能力生成，且自动项永远在 */
  const seg = await p.evaluate(() => ({
    buttons: Array.from(document.querySelectorAll('#segStill button')).map(b => b.dataset.v),
    steps: stillSteps().map(s => ({ id: s.id, long: Math.max(s.w, s.h) })),
    capsLong: Math.max((caps.width && caps.width.max) || 0, (caps.height && caps.height.max) || 0)
  }));
  console.log('档位', JSON.stringify(seg));

  const shot = async (still) => {
    await p.evaluate(v => { S.still = v; saveSettings(); syncUI(); }, still);
    await p.evaluate(() => { devDiag.out = ''; devDiag.via = ''; });
    await p.click('#btnShutter');
    await p.waitForFunction(() => devDiag.out && devDiag.out.length > 0, { timeout: 25000 });
    const r = await p.evaluate(() => ({ out: devDiag.out, via: devDiag.via, raw: devDiag.raw }));
    // 成片预览是异步弹出来的：等它真的出现再关，否则下一枪会被遮罩挡住
    await p.waitForFunction(
      () => document.querySelector('#preview').classList.contains('show'), { timeout: 20000 }).catch(() => {});
    await p.evaluate(() => { try { closePreview(); } catch (e) {} });
    await p.waitForFunction(
      () => !document.querySelector('#preview').classList.contains('show'), { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(400);
    return r;
  };

  const rows = [];
  for (const s of ['auto', '2', '1']) rows.push([s, await shot(s)]);
  for (const [s, r] of rows) console.log(s.padEnd(5), JSON.stringify(r));

  const dim = t => { const m = /(\d+)x(\d+)/.exec(t); return m ? [+m[1], +m[2]] : [0, 0]; };
  const longOf = t => { const [w, h] = dim(t); return Math.max(w, h); };
  const [, auto] = rows.find(r => r[0] === 'auto');
  const [, m2] = rows.find(r => r[0] === '2');
  const [, m1] = rows.find(r => r[0] === '1');

  /* 横屏再拍一张：同一个档位，长边应当和竖拍一样，只是宽高对调 */
  await p.setViewportSize({ width: 900, height: 420 });
  await p.waitForTimeout(600);
  const land = await shot('2');

  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + detail : ''));
    if (!cond) fail++;
  };
  ok('档位列表包含「自动」', seg.buttons.includes('auto'), seg.buttons.join(','));
  ok('档位都不超过摄像头最大长边', seg.steps.every(s => s.long <= Math.min(seg.capsLong, 4000)),
    seg.steps.map(s => s.id + ':' + s.long).join(','));
  ok('2MP 档长边不超过 1920', longOf(m2.out) <= 1920 && longOf(m2.out) > 0, m2.out);
  ok('1MP 档长边不超过 1280', longOf(m1.out) <= 1280 && longOf(m1.out) > 0, m1.out);
  ok('档位越大长边越大', longOf(m2.out) >= longOf(m1.out), m2.out + ' vs ' + m1.out);
  ok('自动档不小于 1MP', longOf(auto.out) >= longOf(m1.out), auto.out + ' vs ' + m1.out);
  ok('竖拍是竖图', dim(m2.out)[1] > dim(m2.out)[0], m2.out);
  ok('横拍是横图', dim(land.out)[0] > dim(land.out)[1], land.out);
  ok('横竖拍长边一致（大小固定，方向改变）',
    Math.abs(longOf(land.out) - longOf(m2.out)) <= 2, m2.out + ' / ' + land.out);
  ok('无 JS 报错', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(fail ? '\n失败 ' + fail : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
