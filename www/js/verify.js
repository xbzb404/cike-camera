'use strict';

/* ============================================================
   照片验真页
   ============================================================ */

const $ = s => document.querySelector(s);
const TRUST_KEY = 'wmc.trust.v1';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function trustList() {
  try {
    const a = JSON.parse(localStorage.getItem(TRUST_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}
function setTrustList(a) {
  try { localStorage.setItem(TRUST_KEY, JSON.stringify(a)); } catch (e) {}
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '';
  const p = n => String(n).padStart(2, '0');
  const week = '日一二三四五六'[d.getDay()];
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} 周${week}`;
}

function fmtCoord(lat, lng) {
  if (lat == null || lng == null) return '';
  return `${lat >= 0 ? '北纬' : '南纬'} ${Math.abs(lat).toFixed(6)}° ${lng >= 0 ? '东经' : '西经'} ${Math.abs(lng).toFixed(6)}°`;
}

const SRC_LABEL = {
  live: '实拍 · 本机相机（拍摄即签名）',
  'import-exif': '相册导入 · 时间与坐标取自原图 EXIF',
  'import-device': '相册导入 · 原图无坐标，坐标取自当时设备定位',
  'import-none': '相册导入 · 无坐标记录'
};

function row(k, v, mono) {
  if (!v) return '';
  return `<div class="row"><span class="k">${esc(k)}</span><span class="v${mono ? ' mono' : ''}">${esc(v)}</span></div>`;
}

let lastResult = null;

async function verifyFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const seg = WMC.jpeg.extract(bytes);
  const thumb = URL.createObjectURL(file);

  if (!seg) {
    lastResult = null;
    $('#result').innerHTML = `
      <div class="card">
        <img class="prev" src="${thumb}" alt="">
        <div class="verdict">
          <span class="dot" style="background:#7b8595"></span>
          <div>
            <h2>未找到签名</h2>
            <small>这个文件里没有此刻相机的签名段。常见原因：截图保存、微信/QQ 转发压缩、被图片编辑工具重新导出、或本来就不是本应用生成的照片。</small>
          </div>
        </div>
        <div class="rows">${row('文件名', file.name)}${row('大小', (file.size / 1024).toFixed(0) + ' KB')}</div>
      </div>`;
    return;
  }

  const stripped = WMC.jpeg.strip(bytes);
  const imh = WMC.base32(await WMC.sha256(stripped), 26);
  const hashOk = imh === seg.imh;
  let sigOk = false;
  try {
    const target = WMC.signTarget(seg.core || {}, seg.code, seg.imh);
    sigOk = await WMC.verifySig(seg.pub || {}, target, WMC.fromB64url(seg.sig));
  } catch (e) {
    sigOk = false;
  }
  const trusted = trustList().indexOf(seg.fp) >= 0;

  let color, title, sub;
  if (!sigOk) {
    color = 'var(--bad)';
    title = '签名无效';
    sub = '签名段存在，但用签名者公钥验算不通过。这个文件很可能被篡改过，或者签名是伪造的。下面的内容不可采信。';
  } else if (!hashOk) {
    color = 'var(--bad)';
    title = '文件已被修改';
    sub = '签名本身有效，但图像内容与签名时记录的哈希不一致。可能是二次编辑、重新导出，或经过压缩转发。若拿到的是「原图/文件」，请要求对方重新发送。';
  } else if (!trusted) {
    color = 'var(--warn)';
    title = '签名有效，签名者未受信';
    sub = '图片未被改动，签名也可验证。但这个指纹还没有被本机信任，请与拍摄者核对指纹后再决定是否采信。';
  } else {
    color = 'var(--ok)';
    title = '可信：签名有效，文件未被改动';
    sub = '签名者已在本机受信，图像内容与签名时的哈希一致。';
  }

  const c = seg.core || {};
  const dev = seg.dev || {};
  const sizeTxt = dev.w && dev.h ? `${dev.w} × ${dev.h}` : '';

  lastResult = { seg, hashOk, sigOk, trusted };

  $('#result').innerHTML = `
    <div class="card">
      <img class="prev" src="${thumb}" alt="">
      <div class="verdict">
        <span class="dot" style="background:${color}"></span>
        <div>
          <h2>${esc(title)}</h2>
          <small>${esc(sub)}</small>
        </div>
      </div>
      <div class="rows">
        ${row('签名者', WMC.group4(seg.fp || ''), true)}
        ${row('信任状态', trusted ? '本机已信任' : '未信任')}
        ${row('记录时间', fmtTime(c.ts))}
        ${row('经纬度', fmtCoord(c.lat, c.lng), true)}
        ${row('地点', c.addr)}
        ${row('来源', SRC_LABEL[c.src] || c.src)}
        ${row('验真码', seg.code, true)}
        ${sizeTxt ? row('原始分辨率', sizeTxt) : ''}
        ${row('签名时间', fmtTime(new Date(seg.at || 0).toISOString()))}
        ${row('图片哈希', (seg.imh || '') + (hashOk ? '（一致）' : '（不一致）'), true)}
      </div>
      <div class="actions">
        ${!trusted && sigOk ? '<button class="btn" id="btnTrust">信任此签名者</button>' : ''}
        <button class="btn ghost" id="btnAgain">换一张</button>
      </div>
    </div>`;

  const bt = $('#btnTrust');
  if (bt) {
    bt.addEventListener('click', () => {
      const list = trustList();
      if (list.indexOf(seg.fp) < 0) list.push(seg.fp);
      setTrustList(list);
      renderTrusted();
      toast('已信任该签名者');
      verifyFile(file);
    });
  }
  $('#btnAgain').addEventListener('click', () => $('#fileInput').click());
}

function renderTrusted() {
  const list = trustList();
  const wrap = $('#trustedWrap');
  const box = $('#trustedList');
  if (!list.length) {
    wrap.hidden = true;
    box.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  box.innerHTML = list.map(fp =>
    `<div class="trusted-item"><span>${esc(WMC.group4(fp))}</span><button data-fp="${esc(fp)}">移除</button></div>`
  ).join('');
  box.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      setTrustList(trustList().filter(x => x !== b.dataset.fp));
      renderTrusted();
      toast('已移除');
    });
  });
}

function bind() {
  const drop = $('#drop');
  const input = $('#fileInput');

  $('#btnPick').addEventListener('click', () => input.click());
  input.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) verifyFile(f).catch(err => toast('读取失败：' + err.message));
  });

  ['dragenter', 'dragover'].forEach(ev => {
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.remove('over');
    });
  });
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) verifyFile(f).catch(err => toast('读取失败：' + err.message));
  });

  window.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.files;
    if (items && items[0]) verifyFile(items[0]).catch(err => toast('读取失败：' + err.message));
  });

  renderTrusted();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bind);
} else {
  bind();
}
