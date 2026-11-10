/* ============================================================
   WMC 签名层：密钥、签名/验签、哈希、JPEG 内嵌签名段
   浏览器与 Node 通用（依赖全局 crypto.subtle / btoa / atob）
   ============================================================ */
(function (root) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- 编码工具 ---------- */
  const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 字符，去掉 I O 0 1，避免肉眼混淆

  function toB64url(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function base32(u8, len) {
    let bits = 0, val = 0, out = '';
    for (let i = 0; i < u8.length && out.length < len; i++) {
      val = ((val << 8) | u8[i]) & 0xffffff;
      bits += 8;
      while (bits >= 5 && out.length < len) {
        out += B32.charAt((val >>> (bits - 5)) & 31);
        bits -= 5;
      }
    }
    if (out.length < len && bits > 0) out += B32.charAt((val << (5 - bits)) & 31);
    return out;
  }

  async function sha256(bytes) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return new Uint8Array(buf);
  }

  function concat() {
    let n = 0;
    for (let i = 0; i < arguments.length; i++) n += arguments[i].length;
    const out = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < arguments.length; i++) {
      out.set(arguments[i], o);
      o += arguments[i].length;
    }
    return out;
  }

  /* ---------- 密钥 ---------- */
  const DB_NAME = 'wmc-keys';
  const STORE = 'keys';

  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  function dbGet(db, key) {
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  }
  function dbPut(db, key, val) {
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }

  async function fingerprint(pubJwk) {
    const x = fromB64url(pubJwk.x);
    const y = fromB64url(pubJwk.y);
    const h = await sha256(concat(x, y));
    return base32(h, 16);
  }

  function group4(s) {
    return (s.match(/.{1,4}/g) || [s]).join('-');
  }

  let keyCache = null;

  async function getKey() {
    if (keyCache) return keyCache;
    const db = await openDB();
    let rec = await dbGet(db, 'main');
    if (!rec) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
      const fp = await fingerprint(pubJwk);
      rec = {
        priv: kp.privateKey,
        pub: { kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x, y: pubJwk.y },
        kid: fp.slice(0, 6),
        fp: fp,
        createdAt: Date.now()
      };
      await dbPut(db, 'main', rec);
    }
    keyCache = rec;
    return rec;
  }

  async function getPublic() {
    const k = await getKey();
    return { kid: k.kid, fp: k.fp, fpGrouped: group4(k.fp), pub: k.pub };
  }

  /* ---------- 规范化载荷 ---------- */
  function num6(v) {
    return (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(6);
  }

  function coreString(core) {
    return [
      'WMC1',
      core.v || 1,
      core.kid || '',
      core.ts || '',
      num6(core.lat),
      num6(core.lng),
      core.src || '',
      core.addr || ''
    ].join('|');
  }

  function signTarget(core, code, imh) {
    return coreString(core) + '|' + (code || '') + '|' + (imh || '');
  }

  async function makeCode(core) {
    const h = await sha256(enc.encode(coreString(core)));
    return group4(base32(h, 8));
  }

  async function sign(core, code, imh) {
    const k = await getKey();
    const data = enc.encode(signTarget(core, code, imh));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.priv, data);
    return new Uint8Array(sig);
  }

  async function verifySig(pubJwk, target, sigBytes) {
    try {
      const key = await crypto.subtle.importKey(
        'jwk', { kty: 'EC', crv: 'P-256', x: pubJwk.x, y: pubJwk.y, ext: true },
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      );
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, enc.encode(target));
    } catch (e) {
      return false;
    }
  }

  /* ---------- JPEG 段操作 ---------- */
  const MARK = 'WMC1';
  const SEG_MARKER = 0xEF; // APP15

  function scanSegments(bytes) {
    const segs = [];
    let i = 2;
    while (i < bytes.length - 3) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const m = bytes[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xD9) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      segs.push({ marker: m, start: i, len: len });
      if (m === 0xDA) break; // SOS 之后是图像数据
      i += 2 + len;
    }
    return segs;
  }

  function embed(jpegBytes, obj) {
    const json = JSON.stringify(obj);
    const body = concat(enc.encode(MARK), enc.encode(json));
    if (body.length + 2 > 65533) throw new Error('签名段过长');
    const seg = new Uint8Array(body.length + 4);
    seg[0] = 0xFF;
    seg[1] = SEG_MARKER;
    seg[2] = ((body.length + 2) >> 8) & 0xFF;
    seg[3] = (body.length + 2) & 0xFF;
    seg.set(body, 4);
    return concat(jpegBytes.subarray(0, 2), seg, jpegBytes.subarray(2));
  }

  function findOurSegment(bytes) {
    const segs = scanSegments(bytes);
    for (const s of segs) {
      if (s.marker !== SEG_MARKER) continue;
      const from = s.start + 4;
      const to = s.start + 2 + s.len;
      const str = dec.decode(bytes.subarray(from, to));
      if (str.startsWith(MARK)) return { seg: s, json: str.slice(MARK.length) };
    }
    return null;
  }

  function extract(jpegBytes) {
    const hit = findOurSegment(jpegBytes);
    if (!hit) return null;
    try {
      return JSON.parse(hit.json);
    } catch (e) {
      return null;
    }
  }

  function strip(jpegBytes) {
    const hit = findOurSegment(jpegBytes);
    if (!hit) return jpegBytes;
    const s = hit.seg;
    return concat(jpegBytes.subarray(0, s.start), jpegBytes.subarray(s.start + 2 + s.len));
  }

  const api = {
    sha256, base32, toB64url, fromB64url, group4, concat,
    getKey, getPublic, fingerprint,
    coreString, signTarget, makeCode, sign, verifySig,
    jpeg: { embed, extract, strip, findOurSegment, scanSegments }
  };

  root.WMC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
