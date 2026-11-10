#!/usr/bin/env python3
"""生成启动器图标（现代扁平风）。

设计约束：
  · 单一容器 —— 一个圆角方形到底，不套任何内层边框。旧图标之所以丑，
    是因为「深色方块 → 描边小方框 → 相机」三层叠在一起，Android 12
    的启动画面再套一层圆底，一屏四个同心容器。
  · 单一图形 —— 只有「机身 + 一枚镜头」，没有闪光灯、没有装饰暗边。
    图标在桌面上的实际显示尺寸是 48~72px，多一个元素就多一团糊。
  · 高对比 —— 琥珀渐变底 + 深蓝机身。缩到 48px 仍然可辨。
  · 内容占 62% —— 留足安全区，系统裁圆或加白底都不会切到图形。

用法：python tools/make_icon.py
输出：shell/res/mipmap-xxxhdpi-v4/ic_launcher.png（432×432）
"""
from pathlib import Path

from PIL import Image, ImageDraw

N = 432          # 108dp × 4（xxxhdpi）
S = 4            # 超采样倍数
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "shell" / "res" / "mipmap-xxxhdpi-v4" / "ic_launcher.png"

# 底：琥珀 → 橙，斜向渐变。比原来的深色底在桌面上更醒目，
# 也和 App 里那套黄色水印是同一个色系。
TOP = (255, 199, 84)
BOT = (240, 146, 26)

# 图形：深蓝，取 App 背景色，冷暖对比拉开
INK = (13, 20, 33)
INK_SOFT = (34, 48, 70)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_square(w, radius):
    """圆角方形 + 对角渐变。先造渐变再贴圆角遮罩，边缘不会出现硬台阶。"""
    img = Image.new("RGBA", (w, w), (0, 0, 0, 0))
    grad = Image.new("RGBA", (w, w))
    gd = ImageDraw.Draw(grad)
    # 对角渐变：t 同时吃 x 与 y，左上偏亮
    for y in range(w):
        for_x = y / (w - 1)
        c = lerp(TOP, BOT, for_x ** 0.92)
        gd.line([(0, y), (w, y)], fill=c + (255,))

    mask = Image.new("L", (w, w), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, w - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def main() -> None:
    W = N * S
    radius = int(96 * S)          # 432 画布上 96px ≈ 22%，接近 iOS 的圆角比例
    canvas = gradient_square(W, radius)

    d = ImageDraw.Draw(canvas, "RGBA")

    d = ImageDraw.Draw(canvas, "RGBA")

    # 机身
    bx0, by0, bx1, by1 = 100, 152, 332, 306
    d.rounded_rectangle([bx0 * S, by0 * S, bx1 * S, by1 * S], radius=44 * S, fill=INK)

    # ---- 顶部取景凸起：与机身同色，宽度居中 ----
    d.rounded_rectangle([176 * S, 126 * S, 256 * S, 168 * S], radius=18 * S, fill=INK)

    # ---- 镜头：一枚，居中 ----
    cx, cy = 216, 229
    d.ellipse([(cx - 62) * S, (cy - 62) * S, (cx + 62) * S, (cy + 62) * S], fill=INK_SOFT)
    d.ellipse([(cx - 44) * S, (cy - 44) * S, (cx + 44) * S, (cy + 44) * S], fill=INK)
    # 一道斜向高光，说明这是玻璃而不是黑洞
    d.arc([(cx - 44) * S, (cy - 44) * S, (cx + 44) * S, (cy + 44) * S],
          start=196, end=286, fill=(255, 214, 130, 190), width=int(9 * S))
    d.ellipse([(cx - 20) * S, (cy - 26) * S, (cx - 6) * S, (cy - 12) * S],
              fill=(255, 255, 255, 40))

    # ---- 右上角一点小小的闪光灯，只作为节奏，不抢主体 ----
    d.ellipse([286 * S, 170 * S, 312 * S, 196 * S], fill=(255, 226, 168, 235))

    icon = canvas.resize((N, N), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT, "PNG", optimize=True)
    print("wrote", OUT, icon.size, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
