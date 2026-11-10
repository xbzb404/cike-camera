/* ============================================================
   极简 JPEG/EXIF 解析：只取拍摄时间、GPS、机型号
   ============================================================ */
(function (root) {
  'use strict';

  const TYPES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function findExif(bytes) {
    let i = 2;
    while (i < bytes.length - 4) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const m = bytes[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xD9 || m === 0xDA) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (m === 0xE1 && len > 8) {
        const p = i + 4;
        if (bytes[p] === 0x45 && bytes[p + 1] === 0x78 && bytes[p + 2] === 0x69 && bytes[p + 3] === 0x66) {
          return { start: p + 6, end: i + 2 + len };
        }
      }
      i += 2 + len;
    }
    return null;
  }

  function readExif(bytes) {
    const r = findExif(bytes);
    if (!r) return null;
    return parseTiff(bytes, r.start);
  }

  function parseTiff(bytes, b) {
    const bo = String.fromCharCode(bytes[b], bytes[b + 1]);
    const le = bo === 'II';
    if (!le && bo !== 'MM') return null;

    const u16 = o => le ? (bytes[o] | (bytes[o + 1] << 8)) : ((bytes[o] << 8) | bytes[o + 1]);
    const u32 = o => le
      ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
      : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    const s32 = o => {
      const v = u32(o);
      return v > 0x7fffffff ? v - 0x100000000 : v;
    };

    if (u16(b + 2) !== 0x2A) return null;
    const ifd0 = b + u32(b + 4);

    function readEntries(ifdOffset) {
      const count = u16(ifdOffset);
      const map = {};
      for (let k = 0; k < count; k++) {
        const e = ifdOffset + 2 + k * 12;
        const tag = u16(e);
        const type = u16(e + 2);
        const n = u32(e + 4);
        const size = (TYPES[type] || 1) * n;
        const valOff = size <= 4 ? e + 8 : b + u32(e + 8);
        map[tag] = { type, n, off: valOff, size };
      }
      return map;
    }

    function ascii(entry) {
      if (!entry) return '';
      let s = '';
      for (let k = 0; k < entry.n; k++) {
        const c = bytes[entry.off + k];
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s.trim();
    }

    function shortVal(entry) {
      if (!entry) return null;
      return entry.type === 3 ? u16(entry.off) : u32(entry.off);
    }

    function rational(off) {
      const num = u32(off);
      const den = u32(off + 4);
      return den === 0 ? 0 : num / den;
    }

    const ifd = readEntries(ifd0);

    let exifIfd = null;
    if (ifd[0x8769]) exifIfd = readEntries(b + u32(ifd[0x8769].off));

    let gpsIfd = null;
    if (ifd[0x8825]) gpsIfd = readEntries(b + u32(ifd[0x8825].off));

    const out = { date: null, lat: null, lng: null, make: '', model: '', hasGps: false };

    out.make = ascii(ifd[0x010F]);
    out.model = ascii(ifd[0x0110]);

    // 拍摄时间：优先 DateTimeOriginal，其次 DateTimeDigitized / DateTime
    let dtStr = exifIfd ? ascii(exifIfd[0x9003]) : '';
    if (!dtStr && exifIfd) dtStr = ascii(exifIfd[0x9004]);
    if (!dtStr) dtStr = ascii(ifd[0x0132]);
    const offStr = exifIfd ? ascii(exifIfd[0x9011]) : '';
    out.date = parseExifDate(dtStr, offStr);

    // GPS
    if (gpsIfd && gpsIfd[0x0002] && gpsIfd[0x0004]) {
      const latRef = ascii(gpsIfd[0x0001]) || 'N';
      const lngRef = ascii(gpsIfd[0x0003]) || 'E';
      const la = gpsIfd[0x0002];
      const lo = gpsIfd[0x0004];
      const lat = rational(la.off) + rational(la.off + 8) / 60 + rational(la.off + 16) / 3600;
      const lng = rational(lo.off) + rational(lo.off + 8) / 60 + rational(lo.off + 16) / 3600;
      if (lat > 0 || lng > 0) {
        out.lat = latRef.charAt(0).toUpperCase() === 'S' ? -lat : lat;
        out.lng = lngRef.charAt(0).toUpperCase() === 'W' ? -lng : lng;
        out.hasGps = true;
      }
    }

    // 像素尺寸：标准放在 Exif 子 IFD（0xA002/0xA003），部分机型写在 IFD0，两处都看
    out.width = shortVal((exifIfd && exifIfd[0xA002]) || ifd[0xA002]);
    out.height = shortVal((exifIfd && exifIfd[0xA003]) || ifd[0xA003]);

    return out;
  }

  function parseExifDate(s, offset) {
    if (!s) return null;
    const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    const Y = +m[1], M = +m[2], D = +m[3], h = +m[4], mi = +m[5], se = +m[6];
    if (Y < 1990 || Y > 2100) return null;

    const off = /^([+-])(\d{2}):?(\d{2})$/.exec(offset || '');
    if (!off) {
      // EXIF 里没写时区：按设备本地时间理解
      return new Date(Y, M - 1, D, h, mi, se);
    }
    const sign = off[1] === '-' ? -1 : 1;
    const mins = sign * (+off[2] * 60 + +off[3]);
    return new Date(Date.UTC(Y, M - 1, D, h, mi, se) - mins * 60000);
  }

  const api = { read: readExif, parseTiff, parseExifDate };
  root.WMCExif = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
