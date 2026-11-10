/* ============================================================
   EXIF 写入 / 读取 往返自测
   运行：node tests/test-exif.js
   ------------------------------------------------------------
   验证 exif-write.js 写出的段，能被 exif.js（读取端）完整解析回来。
   这是“写进去但别人读不到”这类问题的唯一可靠检查手段。
   ============================================================ */
'use strict';

const path = require('path');
const assert = require('assert');

const WMCExif = require(path.join(__dirname, '..', 'www', 'js', 'exif.js'));
const WMCExifWrite = require(path.join(__dirname, '..', 'www', 'js', 'exif-write.js'));

/* 造一个最小可用的 JPEG 外壳：SOI + APP0(JFIF) + SOS + 假数据 */
function fakeJpeg() {
  const jfif = [0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const app0len = jfif.length + 2;
  const body = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
  const sos = [0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00];
  return Uint8Array.from([
    0xFF, 0xD8,
    0xFF, 0xE0, (app0len >> 8) & 0xFF, app0len & 0xFF, ...jfif,
    ...sos,
    ...body,
    0xFF, 0xD9
  ]);
}

let pass = 0;
function check(name, fn) {
  fn();
  pass++;
  console.log('  ✓ ' + name);
}

console.log('EXIF 往返测试');

const time = new Date(2026, 10, 10, 14, 32, 17); // 2026-11-10 14:32:17 本地
const lat = 31.230416;
const lng = 121.473701;
const alt = 42.5;

const jpeg = fakeJpeg();

check('未写入前，读不到 EXIF', () => {
  const before = WMCExif.read(jpeg);
  assert.strictEqual(before, null);
});

const injected = WMCExifWrite.inject(jpeg, {
  time, lat, lng, altitude: alt,
  make: 'WMC',
  model: 'WMC Camera / Android',
  software: 'Moment Camera 1.3.0',
  description: 'Moment Camera · 测试',
  xpTitle: '此刻相机',
  comment: '此刻相机 验真码 ABCD-EFGH',
  width: 4000,
  height: 3000
});

check('插入后仍是合法 JPEG（SOI 开头）', () => {
  assert.strictEqual(injected[0], 0xFF);
  assert.strictEqual(injected[1], 0xD8);
  // APP1 紧跟 APP0 之后
  const app0len = (injected[4] << 8) | injected[5];
  const p = 4 + app0len;
  assert.strictEqual(injected[p], 0xFF);
  assert.strictEqual(injected[p + 1], 0xE1);
  assert.strictEqual(String.fromCharCode(...injected.subarray(p + 4, p + 8)), 'Exif');
});

const parsed = WMCExif.read(injected);

check('解析出拍摄时间', () => {
  assert.ok(parsed && parsed.date, '应能解析 date');
  assert.strictEqual(parsed.date.getTime(), time.getTime());
});

check('解析出 GPS 坐标（误差 < 1e-5 度）', () => {
  assert.ok(parsed.hasGps, '应标记 hasGps');
  assert.ok(Math.abs(parsed.lat - lat) < 1e-5, `lat=${parsed.lat}`);
  assert.ok(Math.abs(parsed.lng - lng) < 1e-5, `lng=${parsed.lng}`);
});

check('解析出机型 / 厂商（ASCII 字段）', () => {
  assert.strictEqual(parsed.make, 'WMC');
  assert.strictEqual(parsed.model, 'WMC Camera / Android');
});

check('中文备注走 UserComment(UNICODE) 与 XPTitle(UTF-16)', () => {
  const raw = Buffer.from(injected);
  assert.ok(raw.includes(Buffer.from('UNICODE\0', 'latin1')), '应有 UNICODE 前缀');
  // UserComment 里的 UTF-16LE '此刻相机'
  assert.ok(raw.includes(Buffer.from('此刻相机', 'utf16le')), '应能检索到 UTF-16 中文');
});

check('解析出像素尺寸', () => {
  assert.strictEqual(parsed.width, 4000);
  assert.strictEqual(parsed.height, 3000);
});

check('南纬 / 西经也能正确取负号', () => {
  const j = WMCExifWrite.inject(fakeJpeg(), { time, lat: -33.8688, lng: -70.6693 });
  const r = WMCExif.read(j);
  assert.ok(Math.abs(r.lat + 33.8688) < 1e-5, `lat=${r.lat}`);
  assert.ok(Math.abs(r.lng + 70.6693) < 1e-5, `lng=${r.lng}`);
});

check('重复 inject 不会叠加第二个 EXIF 段', () => {
  const twice = WMCExifWrite.inject(injected, { time, lat, lng });
  assert.strictEqual(twice.length, injected.length);
});

check('无坐标时不写 GPS IFD，且不报错', () => {
  const j = WMCExifWrite.inject(fakeJpeg(), { time, make: 'WMC' });
  const r = WMCExif.read(j);
  assert.ok(r && r.date);
  assert.strictEqual(r.hasGps, false);
});

check('段长度不超过 JPEG 单段上限（64KB）', () => {
  const seg = WMCExifWrite.buildSegment({
    time, lat, lng, make: 'WMC', model: 'x'.repeat(300), description: 'y'.repeat(600)
  });
  assert.ok(seg.length < 65533);
});

console.log(`\n全部通过：${pass} 项`);
