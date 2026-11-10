#!/usr/bin/env python3
"""生成启动器图标 —— 直接取 App 自己的开屏图标，保证桌面、开屏、网页一致。

以前这里是手写的 PIL 绘图，和 www/icons/icon.svg 是两套设计，桌面上看到的
图标永远比开屏里那个丑。现在唯一真源就是 icon.svg：
  · 开屏页 <img class="splash-logo" src="icons/icon.svg">
  · 桌面图标 shell/res/mipmap-xxxhdpi-v4/ic_launcher.png
两个都用同一张图，用户点开 App 时不会出现「图标闪一下变成另一个」。

做法：用本机 Chromium 把 SVG 渲染成 1024×1024，再 LANCZOS 缩到 432
（xxxhdpi 的 108dp）。Python 侧没有 SVG 渲染器，PIL 画不出渐变/模糊滤镜。

用法：python tools/make_icon.py
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "www" / "icons" / "icon.svg"
OUT = ROOT / "shell" / "res" / "mipmap-xxxhdpi-v4" / "ic_launcher.png"
N = 432          # 108dp × 4
SUPER = 1024     # 先大图渲染再缩，边缘和光晕才干净


def render(svg_text: str, path: Path) -> None:
    js = r"""
const { chromium } = require(process.env.PW_PATH || 'playwright-core');
(async () => {
  const [svgFile, outFile, size] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const p = await b.newPage({ viewport: { width: +size, height: +size }, deviceScaleFactor: 1 });
  const svg = require('fs').readFileSync(svgFile, 'utf8');
  await p.setContent(
    '<style>html,body{margin:0;padding:0;background:transparent;width:100%;height:100%}' +
    'svg{display:block;width:100%;height:100%}</style>' + svg);
  await p.waitForTimeout(120);
  await p.screenshot({ path: outFile, omitBackground: true });
  await b.close();
})();
"""
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        (td / "icon.svg").write_text(svg_text, encoding="utf-8")
        (td / "r.js").write_text(js, encoding="utf-8")
        env = dict(os.environ)
        env.setdefault("PW_PATH", "C:/Users/zhb/WorkBuddy/2026-09-07-08-50-25/node_modules/playwright-core")
        env.setdefault("CHROME_PATH",
                       "C:/Users/zhb/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe")
        subprocess.run(["node", str(td / "r.js"), str(td / "icon.svg"), str(path), str(SUPER)],
                       cwd=str(td), env=env, check=True)


def main() -> None:
    from PIL import Image

    big = ROOT / "build" / "_icon-big.png"
    big.parent.mkdir(parents=True, exist_ok=True)
    render(SVG.read_text(encoding="utf-8"), big)

    img = Image.open(big).convert("RGBA")
    icon = img.resize((N, N), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT, "PNG", optimize=True)
    print("wrote", OUT, icon.size, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    sys.exit(main())
