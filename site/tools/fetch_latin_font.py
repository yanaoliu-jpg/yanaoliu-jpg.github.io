#!/usr/bin/env python3
"""从 Google Fonts 取一个拉丁子集的变量字体，自托管到 static/fonts/。

    python3 site/tools/fetch_latin_font.py

只在换字体时跑。跟 subset_font.py 一样用 curl 不用 urllib——这台机器上
Python 直连 Google 会 SSL 超时（CLAUDE.md 第七节）。

取法：请求 css2 接口（带 Chrome 的 UA，否则 Google 只给老格式），
在返回的 CSS 里找 /* latin */ 那一块的 woff2 地址。那一块覆盖 U+0000-00FF
和 U+2000-206F，所以 Malèna 的 è、弯引号、破折号都在。

换字体的时候只改 FAMILY 和 OUT 两行，然后去 style.css 改 @font-face。
"""
import re
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
OUT = SITE / "static" / "fonts" / "dm-sans-latin.woff2"
FAMILY = "DM+Sans:opsz,wght@9..40,300..600"     # 光学尺寸轴 + 字重轴，站上用 300–600
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
    m = re.search(r"/\* latin \*/\s*@font-face\s*\{[^}]*?url\((https://[^)]+\.woff2)\)",
                  css, re.S)
    if not m:
        sys.exit("返回的 CSS 里找不到 /* latin */ 那一块——检查 FAMILY 写法或网络")

    # 先下到临时文件、验过大小再改名：下坏了不能把好的冲掉
    tmp = OUT.with_suffix(".woff2.new")
    curl(m.group(1), tmp)
    size = tmp.stat().st_size
    if size < 20_000:
        tmp.unlink()
        sys.exit(f"只下到 {size} 字节，不像字体。没有覆盖任何东西。")
    tmp.rename(OUT)
    print(f"✓ {OUT.relative_to(SITE)}  {size / 1024:.1f} KB")
    print(f"  来源 {m.group(1)}")


if __name__ == "__main__":
    main()
