/* ============================================================
   exif-write · 给 JPEG 写入标准 EXIF
   ------------------------------------------------------------
   为什么需要它：
     canvas 导出的 JPEG 是“裸图”，没有拍摄时间、GPS、机型。
     只在 JPEG 里塞自定义签名段（WMC1）的话，照片一进相册、
     一到微信/系统图库、一上传到别的系统，时间地点全丢。
     本模块生成一个合规的 APP1/Exif 段，包含：
       IFD0  : Make / Model / Software / DateTime / Orientation /
               ImageDescription / ExifIFD 指针 / GPS 指针
       Exif  : DateTimeOriginal / DateTimeDigitized / OffsetTime* /
               UserComment / ColorSpace / PixelXDimension / PixelYDimension
       GPS   : VersionID / LatRef+Lat / LngRef+Lng / AltRef+Altitude /
               TimeStamp / DateStamp / MapDatum
   ------------------------------------------------------------
   只依赖 Uint8Array，浏览器与 Node 通用。
   ============================================================ */
(function (root) {
  'use strict';

  const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEF: 7, SLONG: 9, SRATIONAL: 10 };

  /* ---------------- 值编码 ---------------- */
  function asciiBytes(str) {
    const s = String(str == null ? '' : str);
    const out = new Uint8Array(s.length + 1);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[i] = c < 256 ? c : 0x3F; // 非 ASCII 统一降级为 '?'
    }
    out[s.length] = 0;
    return out;
  }

  /* UTF-16LE（带结尾 0x0000），Windows 的 XPTitle/XPComment 用这个 */
  function utf16Bytes(str) {
    const s = String(str == null ? '' : str);
    const out = new Uint8Array((s.length + 1) * 2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[i * 2] = c & 0xFF;
      out[i * 2 + 1] = (c >> 8) & 0xFF;
    }
    return out;
  }

  function isAscii(str) {
    return !/[^\x20-\x7E]/.test(String(str == null ? '' : str));
  }

  function bytesOf(list) {
    return Uint8Array.from(list);
  }

  function u16le(v) {
    return [v & 0xFF, (v >> 8) & 0xFF];
  }

  function u32le(v) {
    const x = v >>> 0;
    return [x & 0xFF, (x >>> 8) & 0xFF, (x >>> 16) & 0xFF, (x >>> 24) & 0xFF];
  }

  /* 十进制秒数 → [度, 分, 秒] 三个有理数 */
  function dms(v) {
    const a = Math.abs(v);
    let deg = Math.floor(a);
    let min = Math.floor((a - deg) * 60);
    let sec = (a - deg - min / 60) * 3600;
    // 秒保留 4 位小数，避免溢出成 60.0000
    sec = Math.round(sec * 10000) / 10000;
    if (sec >= 60) { sec -= 60; min += 1; }
    if (min >= 60) { min -= 60; deg += 1; }
    const out = [];
    for (const [num, den] of [[deg, 1], [min, 1], [Math.round(sec * 10000), 10000]]) {
      out.push(...u32le(num), ...u32le(den));
    }
    return out;
  }

  function rational(num, den) {
    return [...u32le(num), ...u32le(den)];
  }

  /* ---------------- IFD 构建 ---------------- */
  // entry = { tag, type, count, bytes }  bytes 已按 TIFF 小端编码
  function E(tag, type, count, bytes) {
    return { tag, type, count, bytes };
  }

  function asciiE(tag, str) {
    const b = asciiBytes(str);
    return E(tag, T.ASCII, b.length, b);
  }

  function shortE(tag, v) {
    return E(tag, T.SHORT, 1, Uint8Array.from(u16le(v)));
  }

  function longE(tag, v) {
    return E(tag, T.LONG, 1, Uint8Array.from(u32le(v)));
  }

  function rationalE(tag, count, byteList) {
    return E(tag, T.RATIONAL, count, Uint8Array.from(byteList));
  }

  function ifdSize(entries) {
    return 2 + 12 * entries.length + 4;
  }

  function dataSize(entries) {
    let n = 0;
    for (const e of entries) if (e.bytes.length > 4) n += e.bytes.length + (e.bytes.length & 1);
    return n;
  }

  function writeIfd(out, at, entries, dataAt) {
    let p = at;
    const put16 = (v) => { out[p++] = v & 0xFF; out[p++] = (v >> 8) & 0xFF; };
    const put32 = (v) => { out[p++] = v & 0xFF; out[p++] = (v >>> 8) & 0xFF; out[p++] = (v >>> 16) & 0xFF; out[p++] = (v >>> 24) & 0xFF; };

    put16(entries.length);
    let dp = dataAt;
    for (const e of entries) {
      put16(e.tag);
      put16(e.type);
      put32(e.count);
      if (e.bytes.length <= 4) {
        const pad = new Uint8Array(4);
        pad.set(e.bytes);
        for (let i = 0; i < 4; i++) out[p++] = pad[i];
      } else {
        put32(dp);
        out.set(e.bytes, dp);
        dp += e.bytes.length + (e.bytes.length & 1);
      }
    }
    put32(0); // next IFD
  }

  function exifDateTime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function offsetString(d) {
    const m = -d.getTimezoneOffset();
    const sign = m >= 0 ? '+' : '-';
    const a = Math.abs(m);
    return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
  }

  /**
   * 生成完整的 APP1 EXIF 段（含 FF E1 与长度）
   * @param {object} meta
   *   { time:Date, lat, lng, altitude, make, model, software, description, comment, width, height }
   */
  function buildSegment(meta) {
    const m = meta || {};
    const t = m.time instanceof Date ? m.time : new Date();

    // ---- IFD0 ----
    const ifd0 = [];
    if (m.description) ifd0.push(asciiE(0x010E, m.description));
    if (m.make) ifd0.push(asciiE(0x010F, m.make));
    if (m.model) ifd0.push(asciiE(0x0110, m.model));
    ifd0.push(shortE(0x0112, 1)); // Orientation = 1（已按方向绘制过）
    if (m.software) ifd0.push(asciiE(0x0131, m.software));
    ifd0.push(asciiE(0x0132, exifDateTime(t)));
    // Windows 资源管理器 / 相册能直接显示的中文标题与备注
    if (m.xpTitle) {
      const b = utf16Bytes(m.xpTitle);
      ifd0.push(E(0x9C9B, T.BYTE, b.length, b));
    }
    if (m.comment) {
      const b = utf16Bytes(m.comment);
      ifd0.push(E(0x9C9E, T.BYTE, b.length, b));
    }
    const exifPtrIdx = ifd0.push(longE(0x8769, 0)) - 1; // 先占位
    const hasGps = (m.lat != null && m.lng != null);
    let gpsPtrIdx = -1;
    if (hasGps) gpsPtrIdx = ifd0.push(longE(0x8825, 0)) - 1;

    // ---- Exif IFD ----
    const exif = [];
    exif.push(asciiE(0x9003, exifDateTime(t)));
    exif.push(asciiE(0x9004, exifDateTime(t)));
    exif.push(asciiE(0x9010, offsetString(t)));
    exif.push(asciiE(0x9011, offsetString(t)));
    if (m.comment) {
      // ASCII 用 'ASCII\0\0\0' 前缀；含中文时用 'UNICODE\0' + UTF-16LE，这样别人也能读对
      const ascii = isAscii(m.comment);
      const body = ascii ? asciiBytes(m.comment) : utf16Bytes(m.comment);
      const head = ascii
        ? Uint8Array.from([0x41, 0x53, 0x43, 0x49, 0x49, 0x00, 0x00, 0x00])   // 'ASCII'
        : Uint8Array.from([0x55, 0x4E, 0x49, 0x43, 0x4F, 0x44, 0x45, 0x00]);  // 'UNICODE'
      const buf = new Uint8Array(head.length + body.length);
      buf.set(head); buf.set(body, head.length);
      exif.push(E(0x9286, T.UNDEF, buf.length, buf));
    }
    exif.push(shortE(0xA001, 1)); // ColorSpace = sRGB
    if (m.width) exif.push(longE(0xA002, m.width | 0));
    if (m.height) exif.push(longE(0xA003, m.height | 0));

    // ---- GPS IFD ----
    const gps = [];
    if (hasGps) {
      gps.push(E(0x0000, T.BYTE, 4, Uint8Array.from([2, 3, 0, 0])));
      gps.push(asciiE(0x0001, m.lat >= 0 ? 'N' : 'S'));
      gps.push(rationalE(0x0002, 3, dms(m.lat)));
      gps.push(asciiE(0x0003, m.lng >= 0 ? 'E' : 'W'));
      gps.push(rationalE(0x0004, 3, dms(m.lng)));
      if (m.altitude != null && isFinite(m.altitude)) {
        const alt = Math.round(Math.abs(m.altitude) * 100);
        gps.push(E(0x0005, T.BYTE, 1, Uint8Array.from([m.altitude >= 0 ? 0 : 1])));
        gps.push(rationalE(0x0006, 1, rational(alt, 100)));
      }
      // UTC 时间（GPS 里必须用 UTC）
      const utcH = t.getUTCHours(), utcM = t.getUTCMinutes(), utcS = t.getUTCSeconds();
      gps.push(rationalE(0x0007, 3, [...rational(utcH, 1), ...rational(utcM, 1), ...rational(utcS, 1)]));
      const p = n => String(n).padStart(2, '0');
      gps.push(asciiE(0x001D, `${t.getUTCFullYear()}:${p(t.getUTCMonth() + 1)}:${p(t.getUTCDate())}`));
      gps.push(asciiE(0x0012, 'WGS-84'));
    }

    // ---- 布局 ----
    const ifd0Off = 8;
    const data0Off = ifd0Off + ifdSize(ifd0);
    const exifOff = data0Off + dataSize(ifd0);
    const dataExifOff = exifOff + ifdSize(exif);
    const gpsOff = dataExifOff + dataSize(exif);
    const dataGpsOff = gpsOff + (hasGps ? ifdSize(gps) : 0);

    const total = dataGpsOff + dataSize(gps);

    // 写入指针
    ifd0[exifPtrIdx] = longE(0x8769, exifOff);
    if (gpsPtrIdx >= 0) ifd0[gpsPtrIdx] = longE(0x8825, gpsOff);

    // TIFF 缓冲（前 8 字节为 header）
    const tiff = new Uint8Array(total);
    tiff[0] = 0x49; tiff[1] = 0x49;         // 'II' 小端
    tiff[2] = 0x2A; tiff[3] = 0x00;         // 42
    tiff.set(Uint8Array.from(u32le(8)), 4); // IFD0 偏移

    writeIfd(tiff, ifd0Off, ifd0, data0Off);
    writeIfd(tiff, exifOff, exif, dataExifOff);
    if (hasGps) writeIfd(tiff, gpsOff, gps, dataGpsOff);

    // 组 APP1：FF E1 | len | 'Exif\0\0' | TIFF
    const body = new Uint8Array(6 + tiff.length);
    body.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // 'Exif\0\0'
    body.set(tiff, 6);
    const segLen = body.length + 2;
    if (segLen > 0xFFFF) throw new Error('EXIF 段过大');
    const seg = new Uint8Array(4 + body.length);
    seg[0] = 0xFF; seg[1] = 0xE1;
    seg[2] = (segLen >> 8) & 0xFF;
    seg[3] = segLen & 0xFF;
    seg.set(body, 4);
    return seg;
  }

  /* ---------------- 插入 / 替换 ---------------- */
  function hasExif(bytes) {
    let i = 2;
    while (i < bytes.length - 4) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const mk = bytes[i + 1];
      if (mk === 0xFF) { i++; continue; }
      if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue; }
      if (mk === 0xD9 || mk === 0xDA) break;
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (mk === 0xE1 && len > 8) {
        if (bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) return true;
      }
      i += 2 + len;
    }
    return false;
  }

  /**
   * 把 EXIF 段插到 JPEG 最前面（SOI 之后，JFIF 之后）
   * 已存在 EXIF 时不再重复插入。
   */
  function inject(jpeg, meta) {
    const bytes = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
    if (hasExif(bytes)) return bytes;
    const seg = buildSegment(meta);
    let at = 2;
    // 跳过 JFIF/APP0，保持文件结构习惯
    if (bytes.length > 4 && bytes[2] === 0xFF && bytes[3] === 0xE0) {
      const len = (bytes[4] << 8) | bytes[5];
      at = 4 + len;
    }
    const out = new Uint8Array(bytes.length + seg.length);
    out.set(bytes.subarray(0, at), 0);
    out.set(seg, at);
    out.set(bytes.subarray(at), at + seg.length);
    return out;
  }

  const api = { buildSegment, inject, hasExif, asciiBytes, T };
  root.WMCExifWrite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
