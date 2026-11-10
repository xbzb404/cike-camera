#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 shell/smali 重新汇编成 shell/classes.dex（改壳代码时用）。

为什么要这一步
--------------
这个项目的壳是「一个 Activity + 一个 @JavascriptInterface 桥」，没有 Gradle、
没有 Android SDK。但有两件事网页层做不到，只能落到原生：

  · 真正锁死窗口方向 —— WebView 里 `screen.orientation.lock()` 永远抛异常
    （Chromium 明确不支持），只有 Activity.setRequestedOrientation() 算数；
  · 收起系统状态栏 —— 只能给 Window 挂 FLAG_FULLSCREEN。

所以把壳的 dex 反汇编成 smali 放进仓库（shell/smali），改完用这个脚本
汇编回 shell/classes.dex。工具链（smali/dexlib2/util + guava）首次运行时
从 Maven Central 下到 build/.tools/smali/，和 apksig 一样不进仓库。

用法：
  python tools/build_dex.py              # 汇编，覆盖 shell/classes.dex
  python tools/build_dex.py -o out.dex   # 输出到别处（对比用）
  python tools/build_dex.py --disasm     # 反向：把 shell/classes.dex 拆回 smali
"""
import argparse
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SMALI_SRC = ROOT / "shell" / "smali"
DEX_OUT = ROOT / "shell" / "classes.dex"
TOOLS = ROOT / "build" / ".tools" / "smali"

MAVEN = "https://repo1.maven.org/maven2/"
JARS = [
    ("org/smali/smali/2.5.2/smali-2.5.2.jar", "smali.jar"),
    ("org/smali/baksmali/2.5.2/baksmali-2.5.2.jar", "baksmali.jar"),
    ("org/smali/dexlib2/2.5.2/dexlib2-2.5.2.jar", "dexlib2.jar"),
    ("org/smali/util/2.5.2/util-2.5.2.jar", "util.jar"),
    ("com/beust/jcommander/1.78/jcommander-1.78.jar", "jcommander.jar"),
    ("org/antlr/antlr-runtime/3.5.2/antlr-runtime-3.5.2.jar", "antlr.jar"),
    ("com/google/guava/guava/31.1-jre/guava-31.1-jre.jar", "guava.jar"),
    ("com/google/guava/failureaccess/1.0.1/failureaccess-1.0.1.jar", "failureaccess.jar"),
    ("com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.jar", "jsr305.jar"),
]


def ensure_tools() -> Path:
    """下载 + 解包工具链，返回可当 classpath 用的目录。"""
    cp = TOOLS / "cp"
    if (cp / "org" / "jf" / "smali" / "Main.class").exists():
        return cp
    TOOLS.mkdir(parents=True, exist_ok=True)
    cp.mkdir(parents=True, exist_ok=True)
    for path, name in JARS:
        jar = TOOLS / name
        if not jar.exists():
            print(f"  下载 {name} …")
            urllib.request.urlretrieve(MAVEN + path, jar)
        with zipfile.ZipFile(jar) as z:
            z.extractall(cp)
    return cp


def java(cp: Path, main: str, args: list) -> None:
    cmd = ["java", "-cp", str(cp), main] + args
    r = subprocess.run(cmd, cwd=str(ROOT))
    if r.returncode != 0:
        sys.exit(f"{main} 失败（退出码 {r.returncode}）")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=str(DEX_OUT))
    ap.add_argument("--disasm", action="store_true", help="dex → smali（覆盖 shell/smali）")
    args = ap.parse_args()

    cp = ensure_tools()
    if args.disasm:
        src = Path(args.out) if args.out != str(DEX_OUT) else DEX_OUT
        if SMALI_SRC.exists():
            shutil.rmtree(SMALI_SRC)
        java(cp, "org.jf.baksmali.Main", ["d", str(src), "-o", str(SMALI_SRC)])
        print(f"已反汇编 {src} → {SMALI_SRC}")
        return

    out = Path(args.out)
    if out.exists():
        out.unlink()
    java(cp, "org.jf.smali.Main", ["a", str(SMALI_SRC), "-o", str(out), "--api", "24"])
    print(f"已汇编 {SMALI_SRC} → {out}（{out.stat().st_size} 字节）")


if __name__ == "__main__":
    main()
