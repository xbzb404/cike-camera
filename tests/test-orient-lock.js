/* 方向自检（锁竖屏 + UI 旋转方案）
   ============================================================
   1.5.5 起壳把窗口钉死竖屏（screenOrientation=1），横屏完全由网页层
   `#app rotate(±90deg)` 完成 —— 用户要的「只有 UI 转」：
   转手机时 Activity 不旋转、WebView 不 resize、摄像头不重新协商。

   这个测试用假桥记录原生调用，并验证：
     1) 启动时把窗口锁成竖屏（发 1）；
     2) 自动模式下横放事件 → #app 真的转 90°，布局进横排；
     3) 转的时候窗口尺寸不变（说明没有任何 resize / 系统旋转参与）；
     4) 点锁定后界面钉在当前方向，再灌一堆横放事件一点不动；
     5) 解除锁定后重新跟随。
     6) 成片方向和预览一致（靠 selfRot，由 test-still 覆盖几何部分）。
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
    viewport: { width: 393, height: 873 },
    permissions: ['camera']
  });
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

  /* beta/gamma 决定重力方向。gamma=±90 是「手机右侧朝下/朝上」的横放姿态 */
  const tilt = (beta, gamma, n) => p.evaluate(([beta, gamma, n]) => {
    for (let i = 0; i < n; i++) {
      const e = new Event('deviceorientation');
      Object.defineProperty(e, 'beta', { value: beta });
      Object.defineProperty(e, 'gamma', { value: gamma });
      window.dispatchEvent(e);
    }
  }, [beta, gamma, n]);

  const state = () => p.evaluate(() => {
    const app = document.getElementById('app');
    const st = document.getElementById('stage').getBoundingClientRect();
    return {
      q90: document.body.classList.contains('q90'),
      q270: document.body.classList.contains('q270'),
      selfrot: document.body.classList.contains('selfrot'),
      land: document.body.classList.contains('land'),
      locked: document.querySelector('#btnOrient').classList.contains('on'),
      transform: getComputedStyle(app).transform,
      inner: [window.innerWidth, window.innerHeight],
      stage: [Math.round(st.width), Math.round(st.height)],
      calls: (window.__orientCalls || []).slice()
    };
  });

  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  ' + detail : ''));
    if (!cond) fail++;
  };

  /* 0) 启动即锁竖屏 */
  const boot = await state();
  ok('启动时把窗口锁成竖屏（发 1）', boot.calls[0] === 1, JSON.stringify(boot.calls));
  ok('初始是竖排', !boot.land && !boot.selfrot);

  /* 1) 横放 → UI 自己转，窗口尺寸不动 */
  await tilt(0, 90, 5);
  await p.waitForTimeout(700);
  const land = await state();
  console.log('横放', JSON.stringify(land));
  ok('横放后界面进入横排', land.land && land.selfrot);
  ok('#app 被旋转了 90°（矩阵里出现 ±1）',
    /matrix\(([^)]+)\)/.test(land.transform) &&
    Math.abs(parseFloat(land.transform.match(/matrix\(([^,]+)/)[1])) < 0.01,
    land.transform);
  ok('窗口本身没有 resize（还是 393×873）',
    land.inner[0] === 393 && land.inner[1] === 873, JSON.stringify(land.inner));
  // getBoundingClientRect 给的是**物理屏幕**上的包围盒：整体转过 90° 后
  // 宽高互换，所以视觉上的 4:3（宽>高）在这里表现为「高>宽」。
  ok('横屏取景框视觉上是 4:3（物理包围盒宽高互换）',
    Math.abs(land.stage[1] / land.stage[0] - 4 / 3) < 0.03,
    land.stage[0] + '×' + land.stage[1] + ' → 视觉 ' + land.stage[1] + '×' + land.stage[0]);

  /* 2) 锁定：钉在当前方向，不再发任何原生方向指令 */
  const callsBefore = land.calls.length;
  await p.click('#btnOrient');
  await p.waitForTimeout(400);
  const locked = await state();
  ok('锁定不改变当前方向', locked.land === land.land && locked.q90 === land.q90,
    `land=${locked.land} q90=${locked.q90}`);
  ok('锁定不再发原生方向指令（窗口本来就锁竖屏）',
    locked.calls.length === callsBefore, `${callsBefore} → ${locked.calls.length}`);
  ok('锁定按钮进入激活态', locked.locked === true);

  /* 3) 锁定后灌反向横放：一点都不能动 */
  const before = locked;
  await tilt(0, -90, 8);
  await tilt(0, 90, 8);
  await p.waitForTimeout(700);
  const after = await state();
  ok('锁定后陀螺仪不再影响排版',
    after.q90 === before.q90 && after.q270 === before.q270 &&
    after.selfrot === before.selfrot && after.land === before.land);

  /* 4) 解锁 → 跟随陀螺仪 */
  await p.click('#btnOrient');
  await p.waitForTimeout(300);
  await tilt(0, -90, 6);
  await p.waitForTimeout(700);
  const back = await state();
  ok('解锁后重新跟随重力', back.selfrot, `q90=${back.q90} q270=${back.q270}`);

  /* 5) 竖回来 */
  await tilt(90, 0, 6);
  await p.waitForTimeout(700);
  const portrait = await state();
  ok('竖回来之后界面回到竖排',
    !portrait.land && !portrait.selfrot, `land=${portrait.land}`);

  ok('无 JS 报错', errs.length === 0, errs.join(' | '));

  await b.close();
  console.log(fail ? `\n失败 ${fail} 项` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
