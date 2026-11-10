#!/usr/bin/env python3
"""改一处壳资源：Android 12+ 的开屏不再弹「图标页」。

现象：点开 App 先闪一屏图标（系统 SplashScreen 画的），再切到我们自己的
开屏动画，中间图标大小、位置都跳一下，看着像卡了一下。

系统的开屏页是强制存在的，躲不掉，但可以把它做成「和开屏动画同一个背景、
不画图标」，于是启动过程就是一块深色底 → 开屏动画淡入，看不出接缝。

做法：只改 resources.arsc 里 AppTheme 的两个值，长度都不变，不需要动
任何 offset / size：
  · windowSplashScreenAnimatedIcon 的 @mipmap/ic_launcher
    → 一条透明色（type 从 0x01 REFERENCE 改成 0x1c ARGB8，data=0）。
    Theme 取这个属性时拿到 ColorDrawable(透明)，等于什么都不画。
  · windowSplashScreenBackground #080a0e → #0b0e14（和开屏动画的底色一致）。

识别方式不依赖属性 ID：取 @7f010000（ic_launcher）的那条就是要改的图标，
取 #ff080a0e 的那条就是要改的背景。

用法：python tools/patch_splash.py [--check]
"""
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARSC = ROOT / "shell" / "resources.arsc"

ICON_REF = 0x7F010000      # @mipmap/ic_launcher
OLD_BG = 0xFF080A0E
NEW_BG = 0xFF0B0E14        # 与 styles.css 里 .splash 渐变的底色一致
TYPE_REF = 0x01
TYPE_ARGB8 = 0x1C
TYPE_RGB8 = 0x1D


def walk_types(buf):
    """遍历所有 ResTable_type，产出 (chunk 偏移, 条目起始, 条目数, 配置版本)。"""
    table_size = struct.unpack_from("<I", buf, 4)[0]
    pos = 12                                  # 跳过 ResTable_header
    while pos < table_size - 8:
        ctype, hsize, csize = struct.unpack_from("<HHI", buf, pos)
        if ctype == 0x0200:                   # PACKAGE
            p = pos + hsize
            while p < pos + csize - 8:
                t2, h2, s2 = struct.unpack_from("<HHI", buf, p)
                if t2 == 0x0201:              # TYPE
                    cnt, estart = struct.unpack_from("<II", buf, p + 12)
                    ver = struct.unpack_from("<H", buf, p + 28)[0] if h2 >= 44 else 0
                    yield p, h2, p + estart, cnt, ver
                if s2 == 0:
                    break
                p += s2
        if csize == 0:
            break
        pos += csize


def main() -> None:
    check = "--check" in sys.argv
    buf = bytearray(ARSC.read_bytes())
    changed = 0

    for base, hsize, estart, cnt, ver in walk_types(buf):
        for i in range(cnt):
            eo = struct.unpack_from("<I", buf, base + hsize + i * 4)[0]
            if eo == 0xFFFFFFFF:
                continue
            p = estart + eo
            _size, flags = struct.unpack_from("<HH", buf, p)
            if not (flags & 0x0001):           # 不是 bag（样式/数组）就跳过
                continue
            nmaps = struct.unpack_from("<I", buf, p + 12)[0]
            for k in range(nmaps):
                q = p + 16 + k * 12
                nid = struct.unpack_from("<I", buf, q)[0]
                vtype = buf[q + 7]   # Res_value: size(2) res0(1) type(1) data(4)
                vdata = struct.unpack_from("<I", buf, q + 8)[0]
                if vtype == TYPE_REF and vdata == ICON_REF:
                    print(f"  style@0x{base:x} v{ver}: {nid:#x} 图标 {vdata:#x} → 透明")
                    buf[q + 7] = TYPE_ARGB8
                    struct.pack_into("<I", buf, q + 8, 0)
                    changed += 1
                elif vtype in (TYPE_ARGB8, TYPE_RGB8) and vdata == OLD_BG:
                    print(f"  style@0x{base:x} v{ver}: {nid:#x} 底 {vdata:#010x} → {NEW_BG:#010x}")
                    struct.pack_into("<I", buf, q + 8, NEW_BG)
                    changed += 1

    if not changed:
        print("已经是打过补丁的状态（没找到要改的条目）")
        return
    if check:
        print("dry-run，未写盘")
        return
    ARSC.write_bytes(bytes(buf))
    print(f"wrote {ARSC} ({len(buf)} bytes, {changed} 处)")


if __name__ == "__main__":
    main()
