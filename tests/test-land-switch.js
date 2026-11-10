/* 横竖切换 & 多摄
   ------------------------------------------------------------------
   1) 旋转**绝不能重开摄像头**。1.5.3 及以前 checkStreamOrient 会翻转约束
      调 startCamera，那是「横屏闪一下 + 低端机卡一秒」的根源。
      这里直接数 getUserMedia 的调用次数：竖→横→竖→横，次数不许增加。
   2) 旋转后的取景框尺寸要对（竖 3:4、横 4:3），且不能有 JS 报错。
   3) 多摄：注入 4 个 videoinput（3 后 1 前），镜头条应该出 3 个按钮，
      点第二颗会真的切 deviceId。
*/
'use strict';
const path = require('path');
const { chromium } = require(process.env.PW_PATH || 'playwright-core');

const CHROME = process.env.CHROME_PATH ||
  'C:/Users/zhb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const URL = 'file:///' + path.resolve(__dirname, '..', 'www', 'index.html').replace(/\\/g, '/');

let fail = 0;
function ok(cond, name, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
}

(async () => {
  const b = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
           '--allow-file-access-from-files']
  });

  /* ---------- 一、旋转不重开流 ---------- */
  {
    const c = await b.newContext({
      viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75,
      permissions: ['camera', 'geolocation'],
      geolocation: { latitude: 32.06, longitude: 118.77, accuracy: 8 }
    });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(() => {
      const md = navigator.mediaDevices;
      const orig = md.getUserMedia.bind(md);
      window.__gum = 0;
      md.getUserMedia = (cs) => { window.__gum++; return orig(cs); };
    });
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForTimeout(2600);

    const g0 = await p.evaluate(() => window.__gum);
    ok(g0 >= 1, '相机已启动', 'getUserMedia×' + g0);

    const sizes = [];
    for (const vp of [[873, 393], [393, 873], [873, 393], [393, 873]]) {
      await p.setViewportSize({ width: vp[0], height: vp[1] });
      await p.waitForTimeout(650);
      sizes.push(await p.evaluate(() => {
        const r = document.getElementById('stage').getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), land: document.body.classList.contains('land') };
      }));
    }

    const g1 = await p.evaluate(() => window.__gum);
    ok(g1 === g0, '四次横竖切换没有重开摄像头', '仍为 ' + g1 + ' 次');

    ok(sizes[0].land && sizes[0].w / sizes[0].h > 1.2, '横屏取景框是宽的',
      sizes[0].w + '×' + sizes[0].h);
    ok(!sizes[1].land && sizes[1].h / sizes[1].w > 1.2, '转回竖屏取景框是高的',
      sizes[1].w + '×' + sizes[1].h);
    ok(sizes[2].w === sizes[0].w && sizes[2].h === sizes[0].h, '再次横屏尺寸一致',
      sizes[2].w + '×' + sizes[2].h);
    ok(errs.length === 0, '无 JS 报错', errs.join(' | '));
    await c.close();
  }

  /* ---------- 二、多摄镜头条 ---------- */
  {
    const c = await b.newContext({
      viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75,
      permissions: ['camera', 'geolocation'],
      geolocation: { latitude: 32.06, longitude: 118.77, accuracy: 8 }
    });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(() => {
      const md = navigator.mediaDevices;
      const origGum = md.getUserMedia.bind(md);
      // 真机上的假设备只有一路摄像头，这里合成 3 后置 + 1 前置
      const FAKE = [
        { deviceId: 'cam-back-0', kind: 'videoinput', label: 'camera2 0, facing back', groupId: 'g0' },
        { deviceId: 'cam-back-1', kind: 'videoinput', label: 'camera2 1, facing back', groupId: 'g0' },
        { deviceId: 'cam-back-2', kind: 'videoinput', label: 'camera2 2, facing back', groupId: 'g0' },
        { deviceId: 'cam-front-0', kind: 'videoinput', label: 'camera2 3, facing front', groupId: 'g0' }
      ];
      md.enumerateDevices = async () => FAKE;
      window.__gum = 0;
      window.__lastDevice = '';
      // 假设备不认 deviceId.exact，抹掉它，其余约束照用
      md.getUserMedia = (cs) => {
        window.__gum++;
        const v = Object.assign({}, cs && cs.video);
        if (v && v.deviceId) {
          window.__lastDevice = v.deviceId.exact || v.deviceId.ideal || '';
          delete v.deviceId;
          v.facingMode = { ideal: 'environment' };
        }
        return origGum({ audio: false, video: v });
      };
    });
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForTimeout(2600);

    const lens = await p.evaluate(() => {
      const bar = document.getElementById('lensBar');
      return {
        hidden: bar.hidden,
        labels: Array.from(bar.querySelectorAll('.lens')).map(x => x.textContent.trim()),
        active: Array.from(bar.querySelectorAll('.lens')).findIndex(x => x.classList.contains('active')),
        mode: typeof lensMode !== 'undefined' ? lensMode : '?'
      };
    });
    ok(!lens.hidden, '多摄机型显示镜头条');
    ok(lens.labels.length === 3, '三颗后置镜头都在（前置不混进来）', JSON.stringify(lens.labels));
    ok(lens.active === 0, '默认选中主摄', 'index=' + lens.active);

    const before = await p.evaluate(() => window.__gum);
    await p.evaluate(() => setLens(2));
    await p.waitForTimeout(1400);
    const after = await p.evaluate(() => ({
      gum: window.__gum, dev: window.__lastDevice,
      labels: Array.from(document.querySelectorAll('#lensBar .lens')).map(x => x.textContent.trim()),
      active: Array.from(document.querySelectorAll('#lensBar .lens')).findIndex(x => x.classList.contains('active'))
    }));
    ok(after.gum > before, '点头像后确实换了一路流', before + ' → ' + after.gum);
    ok(after.dev === 'cam-back-2', '切的是被点的那颗镜头', after.dev);
    ok(after.active === 2, '高亮跟到新镜头', 'index=' + after.active);
    ok(errs.length === 0, '多摄路径无 JS 报错', errs.join(' | '));
    await c.close();
  }

  /* ---------- 三、横屏拿到「竖流」时用 CSS 摆正（不重开流） ---------- */
  {
    const c = await b.newContext({
      viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75,
      permissions: ['camera', 'geolocation'],
      geolocation: { latitude: 32.06, longitude: 118.77, accuracy: 8 }
    });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.addInitScript(() => {
      // 造一路 1080×1920 的竖流：模拟「WebView 不跟显示方向走」的机型
      const md = navigator.mediaDevices;
      window.__gum = 0;
      md.getUserMedia = async () => {
        window.__gum++;
        if (!window.__cvs) {
          const cvs = document.createElement('canvas');
          cvs.width = 1080; cvs.height = 1920;
          const x = cvs.getContext('2d');
          x.fillStyle = '#2b3a52'; x.fillRect(0, 0, 1080, 1920);
          x.fillStyle = '#e05555'; x.fillRect(0, 0, 300, 300);
          window.__cvs = cvs;
        }
        return window.__cvs.captureStream(24);
      };
    });
    await p.goto(URL, { waitUntil: 'load' });
    await p.waitForTimeout(2200);

    const portrait = await p.evaluate(() => ({
      rot: videoRotDeg(), vw: video.videoWidth, vh: video.videoHeight
    }));
    ok(portrait.vh > portrait.vw, '流本身是竖的（1080×1920）',
      portrait.vw + '×' + portrait.vh);
    ok(portrait.rot === 0, '竖屏不转（cover 裁切就对了）', 'rot=' + portrait.rot);

    await p.setViewportSize({ width: 873, height: 393 });
    await p.waitForTimeout(800);
    const gumBefore = await p.evaluate(() => window.__gum);
    const landscape = await p.evaluate(() => ({
      rot: videoRotDeg(),
      transform: video.style.transform,
      w: video.style.width, h: video.style.height
    }));
    ok(landscape.rot === 90 || landscape.rot === 270, '横屏把画面转 90° 摆正',
      'rot=' + landscape.rot);
    ok(/rotate/.test(landscape.transform), '走的是 CSS transform', landscape.transform);
    ok(landscape.w.indexOf('var(--vsh') === 0 && landscape.h.indexOf('var(--vsw') === 0,
      '旋转后宽高对调', landscape.w + ' × ' + landscape.h);
    const gumAfter = await p.evaluate(() => window.__gum);
    ok(gumAfter === gumBefore, '摆正画面没有重开摄像头', '仍为 ' + gumAfter + ' 次');
    ok(errs.length === 0, '无 JS 报错', errs.join(' | '));
    await c.close();
  }

  await b.close();
  console.log(fail ? '\n失败 ' + fail + ' 项' : '\n全部通过');
  process.exit(fail ? 1 : 0);
})();
