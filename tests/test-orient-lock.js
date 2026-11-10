/* 方向锁定自检
   ============================================================
   1.5.2 及以前的「锁定」只在网页层停止跟随陀螺仪，系统窗口还是照转，
      于是界面被 CSS 反向转 90° 摆正 —— 用户看到的就是「锁了还跟着转、
      还闪一下重排」。
   1.5.3 起锁定改走原生 WMCAndroid.setOrientation()：
      · 锁 → 14（SCREEN_ORIENTATION_LOCKED，钉在当前方向）
      · 解 → 4 （SCREEN_ORIENTATION_SENSOR，恢复跟随重力）

   这个测试用假桥记录调用，并验证「锁定后陀螺仪完全不参与排版」：
     1) 自动模式下横放事件会让界面进入横排（说明测试本身有效）；
     2) 点锁定后桥收到 14，界面回到竖排；
     3) 再灌一堆横放事件，界面一点都不能动；
     4) 再点一次解除，桥收到 4。

   运行：node tests/test-orient-lock.js
   ============================================================ */
'use strict';

const path = require('path');
const { chromium } = require(path.resolve(process.env.PW_PATH || 'playwright-core'));
const CHROME = process.env.CHROME_PATH ||
  'C:/Users/zhb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const URL = 'file:///' + path.resolve(__dirname, '..', 'www', 'index.html').replace(/\\/g, '/');

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--allow-file-access-from-files' ] });
  const ctx = await b.newContext({
    viewport: { width: 430, height: 920 },
    permissions: ['camera']
  });
  // 假原生桥：把 setOrientation 的参数记下来
  await ctx.addInitScript(() => {
    window.__orientCalls = [];
    window.WMCAndroid = {
      setOrientation(v) { window.__orientCalls.push(v); }
    };
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(2200);

  /* 灌一条陀螺仪事件：beta/gamma 决定重力方向，横放 ≈ (0, 90) */
  const tilt = (beta, gamma, n) => p.evaluate(([beta, gamma, n]) => {
    for (let i = 0; i < n; i++) {
      const e = new Event('deviceorientation');
      Object.defineProperty(e, 'beta', { value: beta });
      Object.defineProperty(e, 'gamma', { value: gamma });
      window.dispatchEvent(e);
    }
  }, [beta, gamma, n]);

  const state = () => p.evaluate(() => ({
    q90: document.body.classList.contains('q90'),
    q270: document.body.classList.contains('q270'),
    selfrot: document.body.classList.contains('selfrot'),
    land: document.body.classList.contains('land'),
    locked: document.querySelector('#btnOrient').classList.contains('on'),
    calls: (window.__orientCalls || []).slice()
  }));

  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + detail : ''));
    if (!cond) fail++;
  };

  /* 1) 自动模式：横放应当真的把界面转过去 */
  await tilt(0, 90, 5);
  await p.waitForTimeout(900);
  const auto = await state();
  console.log('自动', JSON.stringify(auto));
  ok('自动模式横放会转界面', auto.q90 || auto.q270, `q90=${auto.q90} q270=${auto.q270}`);

  /* 2) 锁定 */
  await p.click('#btnOrient');
  await p.waitForTimeout(500);
  const locked = await state();
  console.log('锁定', JSON.stringify(locked));
  ok('锁定时给原生发 14（LOCKED）', locked.calls[locked.calls.length - 1] === 14, JSON.stringify(locked.calls));
  ok('锁定后界面回到竖排', !locked.q90 && !locked.q270 && !locked.selfrot && !locked.land);
  ok('锁定按钮进入激活态', locked.locked === true);

  /* 3) 锁定后再横放：界面一动都不能动 */
  const before = locked;
  await tilt(0, 90, 8);
  await tilt(0, -90, 8);
  await p.waitForTimeout(900);
  const after = await state();
  console.log('锁后横放', JSON.stringify(after));
  ok('锁定后陀螺仪不再影响排版',
    after.q90 === before.q90 && after.q270 === before.q270 &&
    after.selfrot === before.selfrot && after.land === before.land);
  ok('锁定后不再重复发方向指令', after.calls.length === before.calls.length,
    `${before.calls.length} → ${after.calls.length}`);

  /* 4) 解除锁定 */
  await p.click('#btnOrient');
  await p.waitForTimeout(400);
  const unlocked = await state();
  console.log('解锁', JSON.stringify(unlocked));
  ok('解除时给原生发 4（SENSOR）', unlocked.calls[unlocked.calls.length - 1] === 4,
    JSON.stringify(unlocked.calls));

  /* 5) 解锁后横放又能转了 */
  await tilt(0, 90, 6);
  await p.waitForTimeout(900);
  const back = await state();
  ok('解锁后重新跟随重力', back.q90 || back.q270, `q90=${back.q90} q270=${back.q270}`);

  ok('无 JS 报错', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
