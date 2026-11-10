#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
此刻相机 · APK 打包脚本
============================================================
把 www/ 前端 + shell/ 壳资源 重新打包成 APK，并做 v2/v3 签名。

为什么不用 Gradle：
  这个项目是「WebView 壳 + 前端资源」结构，业务代码全在 assets/www 里，
  壳（classes.dex / 资源表）不需要重新编译。所以只需重新压包 + 签名，
  不需要 Android SDK / Gradle，几十毫秒就能出一个包。

关键约束（Android 11+ 强制）：
  * resources.arsc 必须以 STORED（不压缩）方式存放
  * 且其数据区偏移必须是 4 的倍数
  否则安装时报 "requires the resources.arsc of installed APKs to be
  stored uncompressed and aligned on a 4-byte boundary"。

用法：
  python build/build_apk.py                 # 打包 + 签名
  python build/build_apk.py --no-sign       # 只打包，输出未签名包
  python build/build_apk.py --version 5 --name 1.4.0
"""

import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL = ROOT / "shell"
WWW = ROOT / "www"
BUILD = ROOT / "build"

APP_NAME = "此刻相机"
DEFAULT_CODE = 6
DEFAULT_NAME = "1.3.2"

# 本地签名材料（都已 gitignore）
KEYSTORE = BUILD / "wmc.keystore"
KEY_PROPS = BUILD / "keystore.properties"
KS_PASS_DEFAULT = "wmc-local-build"
ALIAS = "wmc"

# 第三方工具（运行时再取，不进仓库）
TOOLS = BUILD / ".tools"
APKSIG_JAR = TOOLS / "apksig.jar"
APKSIG_URL = ("https://dl.google.com/dl/android/maven2/com/android/tools/"
              "build/apksig/8.5.0/apksig-8.5.0.jar")

SKIP_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}


# ---------------------------------------------------------------- manifest
def patch_manifest(data, version_code, version_name):
    """直接改二进制 AndroidManifest.xml 里的 versionCode / versionName。

    AXML 的字符串池可能是 UTF-8 也可能是 UTF-16（aapt 默认 UTF-16），
    这里两种都处理。versionName 用等长字符串原地覆盖（"1.2.0" → "1.3.0"），
    versionCode 是 int，直接改 4 字节。
    """
    buf = bytearray(data)

    # ---- 定位字符串池 ----
    pool_off = None
    pos = 8
    while pos < len(buf) - 8:
        ctype, hsize, csize = struct.unpack_from("<HHI", buf, pos)
        if ctype == 0x0001:
            pool_off = pos
            break
        if csize == 0:
            break
        pos += csize
    if pool_off is None:
        raise RuntimeError("AndroidManifest.xml 里找不到字符串池")

    cnt, styc, flags, sstart, stystart = struct.unpack_from("<IIIII", buf, pool_off + 8)
    utf8 = bool(flags & (1 << 8))
    enc = "utf-8" if utf8 else "utf-16-le"
    offsets = list(struct.unpack_from("<%dI" % cnt, buf, pool_off + hsize))
    base = pool_off + sstart

    def read(i):
        """返回 (数据起始偏移, 字节长度, 文本)"""
        p = base + offsets[i]
        if utf8:
            p += 1                      # 跳过 UTF-16 长度
            n = buf[p]; p += 1
            if n & 0x80:                # UTF-8 长度两字节
                n = ((n & 0x7F) << 8) | buf[p]; p += 1
            return p, n, bytes(buf[p:p + n]).decode("utf-8", "replace")
        n = struct.unpack_from("<H", buf, p)[0]; p += 2
        if n & 0x8000:
            n = ((n & 0x7FFF) << 16) | struct.unpack_from("<H", buf, p)[0]
            p += 2
        blen = n * 2
        return p, blen, bytes(buf[p:p + blen]).decode("utf-16-le", "replace")

    # ---- 覆盖 versionName ----
    old_new = ("1.2.0".encode(enc), version_name.encode(enc))
    if len(old_new[0]) != len(old_new[1]):
        raise RuntimeError("versionName 必须与原值等长，才能原地改写")
    hit = 0
    for i in range(cnt):
        p, n, _ = read(i)
        if bytes(buf[p:p + n]) == old_new[0]:
            buf[p:p + n] = old_new[1]
            hit += 1
    if hit:
        print(f"  versionName → {version_name}")
    else:
        print("  ! 未找到 old versionName，跳过（可能已改过）")

    # ---- 改写 versionCode ----
    name_idx = None
    for i in range(cnt):
        _, _, s = read(i)
        if s == "versionCode":
            name_idx = i
            break
    if name_idx is None:
        print("  ! 字符串池里没有 versionCode")
        return bytes(buf)

    pos = 8
    while pos < len(buf) - 8:
        ctype, hsize, csize = struct.unpack_from("<HHI", buf, pos)
        if ctype == 0x0102:  # START_ELEMENT
            # ResXMLTree_attrExt: ns(4) name(4) attrStart(2) attrSize(2) attrCount(2) …
            ns, nm, astart, asize, acount = struct.unpack_from("<IIHHH", buf, pos + 16)
            ap = pos + 16 + astart
            for k in range(acount):
                o = ap + k * 20
                # ResXMLTree_attribute: ns(4) name(4) rawValue(4) size(2) res0(1) type(1) data(4)
                a_ns, a_name, a_raw, a_size, a_res0, a_type = struct.unpack_from("<IIIHBB", buf, o)
                if a_name == name_idx:
                    struct.pack_into("<I", buf, o + 16, version_code)
                    print(f"  versionCode → {version_code}")
                    return bytes(buf)
        if csize == 0:
            break
        pos += csize

    print("  ! 没找到 versionCode 属性")
    return bytes(buf)


# ---------------------------------------------------------------- zip
def add_aligned_stored(zf, name, data):
    """以 STORED 方式写入，并用 extra field 把数据区对齐到 4 字节。

    zip 本地头 = 30 字节 + 文件名 + extra，extra 最小 4 字节（2+2+数据）。
    """
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o644 << 16
    info.create_system = 0

    off = zf.fp.tell()
    header_base = off + 30 + len(name.encode("utf-8"))
    pad = (-header_base) % 4
    if pad:
        pad += 4  # extra 至少要 4 字节：id(2) + size(2)
    if pad:
        info.extra = struct.pack("<HH", 0xD935, pad - 4) + b"\x00" * (pad - 4)
    zf.writestr(info, data)


def add_deflated(zf, name, data):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    info.create_system = 0
    zf.writestr(info, data)


def iter_files(root, prefix):
    for p in sorted(root.rglob("*")):
        if p.is_dir() or p.name in SKIP_NAMES:
            continue
        yield p, prefix + "/" + p.relative_to(root).as_posix()


def pack(version_code, version_name, out_path):
    manifest = (SHELL / "AndroidManifest.xml").read_bytes()
    manifest = patch_manifest(manifest, version_code, version_name)

    if out_path.exists():
        out_path.unlink()

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        add_deflated(zf, "AndroidManifest.xml", manifest)
        add_deflated(zf, "classes.dex", (SHELL / "classes.dex").read_bytes())
        add_aligned_stored(zf, "resources.arsc", (SHELL / "resources.arsc").read_bytes())

        for p, name in iter_files(SHELL / "res", "res"):
            add_deflated(zf, name, p.read_bytes())
        for p, name in iter_files(WWW, "assets/www"):
            add_deflated(zf, name, p.read_bytes())

    verify_alignment(out_path)
    return out_path


def verify_alignment(apk):
    """自检：resources.arsc 必须 STORED 且数据偏移 %4 == 0"""
    with zipfile.ZipFile(apk) as zf:
        info = zf.getinfo("resources.arsc")
        if info.compress_type != zipfile.ZIP_STORED:
            raise RuntimeError("resources.arsc 没被 STORED")
        with open(apk, "rb") as f:
            raw = f.read()
        # 本地文件头偏移
        cd_off = raw.rfind(b"PK\x01\x02")
        # 直接从 CD 里取该条目的本地头偏移
        local_off = None
        with zipfile.ZipFile(apk) as z2:
            for zi in z2.infolist():
                if zi.filename == "resources.arsc":
                    local_off = zi.header_offset
        if local_off is None:
            raise RuntimeError("找不到 resources.arsc")
        nlen, elen = struct.unpack_from("<HH", raw, local_off + 26)
        data_off = local_off + 30 + nlen + elen
        if data_off % 4:
            raise RuntimeError(f"resources.arsc 未对齐：offset={data_off}")
        print(f"  对齐检查 OK：resources.arsc @ {data_off}（%4={data_off % 4}）")


# ---------------------------------------------------------------- sign
def ensure_tools():
    TOOLS.mkdir(parents=True, exist_ok=True)
    if not APKSIG_JAR.exists():
        print("  · 下载 apksig.jar …")
        import urllib.request
        urllib.request.urlretrieve(APKSIG_URL, APKSIG_JAR)
    cls = TOOLS / "SignApk.class"
    if not cls.exists() or (BUILD / "SignApk.java").stat().st_mtime > cls.stat().st_mtime:
        javac = shutil.which("javac")
        if not javac:
            raise RuntimeError("需要 javac（JDK 17+）来编译签名器")
        print("  · 编译 SignApk …")
        subprocess.run([javac, "-encoding", "UTF-8", "-cp", str(APKSIG_JAR), "-d", str(TOOLS),
                        str(BUILD / "SignApk.java")], check=True)


def ensure_keystore():
    if KEYSTORE.exists():
        for line in KEY_PROPS.read_text(encoding="utf-8").splitlines():
            if line.startswith("storepass="):
                return line.split("=", 1)[1].strip()
        return KS_PASS_DEFAULT

    keytool = shutil.which("keytool")
    if not keytool:
        raise RuntimeError("需要 keytool（随 JDK 提供）来生成签名密钥")
    print("  · 生成签名密钥（仅本机，不入库）")
    subprocess.run([
        keytool, "-genkeypair", "-v",
        "-keystore", str(KEYSTORE), "-alias", ALIAS,
        "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
        "-storepass", KS_PASS_DEFAULT, "-keypass", KS_PASS_DEFAULT,
        "-dname", "CN=Watermark Camera, OU=WMC, O=WMC, L=Nanjing, ST=Jiangsu, C=CN"
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    KEY_PROPS.write_text(f"storepass={KS_PASS_DEFAULT}\nkeypass={KS_PASS_DEFAULT}\n"
                         f"alias={ALIAS}\n", encoding="utf-8")
    return KS_PASS_DEFAULT


def sign(in_apk, out_apk, password):
    java = shutil.which("java")
    if not java:
        raise RuntimeError("需要 java 来执行签名")
    cp = os.pathsep.join([str(APKSIG_JAR), str(TOOLS)])

    def run(extra):
        r = subprocess.run([java, "-cp", cp, "SignApk"] + extra,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           encoding="utf-8", errors="replace")
        return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()

    rc, out = run([str(in_apk), str(out_apk), str(KEYSTORE), password, password, ALIAS])
    if rc != 0:
        raise RuntimeError("签名失败：\n" + out)
    print("  " + out)

    rc, out = run(["--verify", str(out_apk)])
    if rc != 0:
        raise RuntimeError("签名自检失败：\n" + out)
    print("  " + out)


# ---------------------------------------------------------------- main
def main():
    args = sys.argv[1:]
    code = DEFAULT_CODE
    name = DEFAULT_NAME
    do_sign = True
    if "--no-sign" in args:
        do_sign = False
    if "--version" in args:
        code = int(args[args.index("--version") + 1])
    if "--name" in args:
        name = args[args.index("--name") + 1]

    print(f"打包 {APP_NAME} v{name} (versionCode {code})")
    unsigned = BUILD / f"{APP_NAME}-{name}-unsigned.apk"
    pack(code, name, unsigned)
    print(f"  未签名包：{unsigned.name}  {unsigned.stat().st_size / 1024:.0f} KB")

    if do_sign:
        ensure_tools()
        pw = ensure_keystore()
        signed = BUILD / f"{APP_NAME}-{name}.apk"
        sign(unsigned, signed, pw)
        print(f"  签名包：{signed}")
        unsigned.unlink(missing_ok=True)
    print("完成")


if __name__ == "__main__":
    main()
