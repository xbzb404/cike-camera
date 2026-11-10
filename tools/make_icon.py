#!/usr/bin/env python3
"""生成启动器图标。

旧图标的问题不是「画得不好看」，是**层次叠了三层**：
深色圆角方块 → 里面一层半透明描边方框 → 再里面才是相机。
Android 12 的启动画面会把它再套进一个白底圆圈里，于是一屏上出现
四个同心容器，看起来就是「方块套方块」。

这里换成单层：满幅圆形深色底 + 一枚相机，四角透明。
系统无论裁圆还是加底，都只是给这个圆再包一层，同心、不打架。

用法：python build/make_icon.py
输出：shell/res/mipmap-xxxhdpi-v4/ic_launcher.png（432×432）
"""
from pathlib import Path

from PIL import Image, ImageDraw

N = 432          # 自适应图标标准画布：108dp × 4 (xxxhdpi)
S = 4            # 超采样倍数，缩回去才有干净的边缘
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "shell" / "res" / "mipmap-xxxhdpi-v4" / "ic_launcher.png"

# 与 App 深色 UI 同一套色：底 #0a0e17 系，主色黄 #f5b544 系
BG_TOP = (29, 40, 58)
BG_BOT = (9, 13, 20)
YELLOW = (246, 190, 78)
YELLOW_DARK = (232, 160, 40)
INK = (13, 17, 24)


def main() -> None:
    W = N * S
    canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))

    # ---- 圆形底：竖直渐变 ----
    bg = Image.new("RGBA", (W, W))
    bd = ImageDraw.Draw(bg)
    for y in range(W):
        t = (y / (W - 1)) ** 0.85          # 上亮下暗，指数让上半部更通透
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        bd.line([(0, y), (W, y)], fill=c + (255,))

    mask = Image.new("L", (W, W), 0)
    md = ImageDraw.Draw(mask)
    pad = 2 * S                            # 留 2px 透明边，避免裁切毛边
    md.ellipse([pad, pad, W - pad, W - pad], fill=255)
    canvas.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(canvas, "RGBA")

    # ---- 相机机身 ----
    d.rounded_rectangle([118 * S, 158 * S, 314 * S, 286 * S],
                        radius=30 * S, fill=YELLOW)
    # 顶部取景凸起（略暗一档，拉出层次）。中心必须和机身中心 216 对齐，
    # 之前写 168..242 偏左 11px，缩小后一眼就能看出歪。
    d.rounded_rectangle([180 * S, 134 * S, 252 * S, 170 * S],
                        radius=12 * S, fill=YELLOW_DARK)

    # ---- 闪光灯 ----
    d.ellipse([278 * S, 170 * S, 300 * S, 192 * S], fill=INK)
    d.ellipse([284 * S, 176 * S, 294 * S, 186 * S], fill=(62, 76, 96))

    # ---- 镜头：由外到内四层同心圆 ----
    cx, cy = 216, 222
    for r, col in ((58, INK), (45, (26, 34, 48)), (31, (40, 54, 76))):
        d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=col)
    # 玻璃反光：一道斜向的浅色弧 + 一个高光点
    d.ellipse([(cx - 34) * S, (cy - 34) * S, (cx - 8) * S, (cy - 8) * S],
              fill=(126, 158, 200, 110))
    d.ellipse([(cx - 21) * S, (cy - 27) * S, (cx - 9) * S, (cy - 15) * S],
              fill=(255, 255, 255, 215))

    icon = canvas.resize((N, N), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT, "PNG", optimize=True)
    print("wrote", OUT, icon.size, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
