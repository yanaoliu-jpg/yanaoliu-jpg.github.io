#!/usr/bin/env python3
"""从 Google Fonts 取拉丁子集的变量字体（正体 + 斜体），自托管到 static/fonts/。

    python3 site/tools/fetch_latin_font.py

只在换字体时跑。跟 subset_font.py 一样用 curl 不用 urllib——这台机器上
Python 直连 Google 会 SSL 超时（CLAUDE.md 第七节）。

取法：请求 css2 接口（带 Chrome 的 UA，否则 Google 只给老格式），
在返回的 CSS 里按 font-style 找 /* latin */ 那一块的 woff2 地址。那一块覆盖 U+0000-00FF
和 U+2000-206F，所以 Malèna 的 è、弯引号、破折号都在。

2026-10-01 从 DM Sans 换成 EB Garamond（见 摄影集改版设计.md 第四节）：
作品名用斜体，所以正体、斜体各取一份——DM Sans 那时只要一份。
换字体的时候只改 FAMILY 和 STYLES，然后去 style.css 改 @font-face。
"""
import re
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
FONTS = SITE / "static" / "fonts"
FAMILY = "EB+Garamond:ital,wght@0,400..800;1,400..800"   # 正体 + 斜体，字重轴 400–800（Garamond 最细就是 400）
STYLES = {"normal": "eb-garamond-latin.woff2", "italic": "eb-garamond-italic-latin.woff2"}
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def curl(url: str, out: Path | None = None) -> bytes:
    cmd = ["curl", "-fsSL", "--retry", "3", "--retry-delay", "3", "--max-time", "60",
           "-A", UA, url]
    if out:
        cmd += ["-o", str(out)]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"下载失败：{r.stderr.decode()[:300]}\n  现有字体没有被动过。")
    return r.stdout


def main() -> None:
    css = curl(f"https://fonts.googleapis.com/css2?family={FAMILY}&display=swap").decode()
    urls = {}
    for style in STYLES:
        m = re.search(r"/\* latin \*/\s*@font-face\s*\{[^}]*?font-style:\s*" + style
                      + r";[^}]*?url\((https://[^)]+\.woff2)\)", css, re.S)
        if not m:
            sys.exit(f"返回的 CSS 里找不到 {style} 的 /* latin */ 那一块——检查 FAMILY 写法或网络")
        urls[style] = m.group(1)

    # 两份都先下到临时文件、都验过大小再一起改名：一份下坏了，两份都不动
    tmps = {style: FONTS / (name + ".new") for style, name in STYLES.items()}
    try:
        for style, tmp in tmps.items():
            curl(urls[style], tmp)
            size = tmp.stat().st_size
            if size < 20_000:
                sys.exit(f"{tmp.name} 只下到 {size} 字节，不像字体。没有覆盖任何东西。")
    except SystemExit:
        for tmp in tmps.values():
            tmp.unlink(missing_ok=True)
        raise
    for style, name in STYLES.items():
        out = FONTS / name
        tmps[style].rename(out)
        print(f"✓ {out.relative_to(SITE)}  {out.stat().st_size / 1024:.1f} KB")
        print(f"  来源 {urls[style]}")


if __name__ == "__main__":
    main()
