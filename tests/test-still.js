/* 验证「成片分辨率」三档：自动 / 12MP / 2MP。
   真机不给 12MP 也没关系 —— 这里检查的是「输出不超过目标、且不会为了凑数放大」。 */
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
  for (const s of ['auto', '12', '2']) rows.push([s, await shot(s)]);
  for (const [s, r] of rows) console.log(s.padEnd(5), JSON.stringify(r));

  const dim = t => { const m = /(\d+)x(\d+)/.exec(t); return m ? [+m[1], +m[2]] : [0, 0]; };
  const [, auto] = rows.find(r => r[0] === 'auto');
  const [, m12] = rows.find(r => r[0] === '12');
  const [, m2] = rows.find(r => r[0] === '2');
  const [aw] = dim(auto.out), [w12] = dim(m12.out), [w2] = dim(m2.out);

  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + detail : ''));
    if (!cond) fail++;
  };
  ok('2MP 档输出不超过 1633 宽', w2 <= 1633 && w2 > 0, w2 + 'px');
  ok('12MP 档输出不超过 4000 宽', w12 <= 4000 && w12 > 0, w12 + 'px');
  ok('12MP 不小于 2MP', w12 >= w2, w12 + ' vs ' + w2);
  ok('自动档不小于 2MP', aw >= w2, aw + ' vs ' + w2);
  ok('无 JS 报错', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(fail ? '\n失败 ' + fail : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
