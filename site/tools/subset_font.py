#!/usr/bin/env python3
"""
重新生成中文字体子集。

    python3 tools/subset_font.py

什么时候要跑：**改完中文文案、跑完 build.py 之后**。

为什么需要：完整的思源宋体有 15MB，全量塞进网页是不可接受的。
这个脚本扫描已经生成好的网页，找出实际用到的每一个中日韩字符，
只把这些字打包成一个 woff2（现在大约 100KB）。

所以顺序很重要：先 build.py 生成网页，再跑这个。
如果你加了新字却忘了跑，那几个字会掉回系统默认字体——
Mac 上是苹方，Windows 上是微软雅黑，跟旁边的衬线排版打架，
而且不会报错，很容易漏掉。脚本最后会替你检查一遍。
"""

import re
import subprocess
import sys
import urllib.parse
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
DIST = SITE.parent / "docs"
OUT = SITE / "static" / "fonts" / "noto-serif-sc-subset.woff2"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# 中日韩汉字、全角标点、中文常用的破折号和引号
CJK = r"[　-〿一-鿿＀-￯—‘-”…]"


def curl(url: str, out: Path | None = None) -> bytes:
    """用 curl 而不是 urllib：这台机器上 Python 直连 Google 会 SSL 超时。"""
    cmd = ["curl", "-sS", "--max-time", "60", "-A", UA, url]
    if out:
        cmd += ["-o", str(out)]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"下载失败：{r.stderr.decode()[:300]}")
    return r.stdout


def main() -> None:
    pages = sorted(DIST.glob("**/index.html"))
    if not pages:
        sys.exit(f"{DIST} 里没有网页。先跑 python3 build.py")

    chars: set[str] = set()
    for page in pages:
        html = page.read_text(encoding="utf-8")
        html = re.sub(r"<script.*?</script>", "", html, flags=re.S)  # 排除内嵌数据
        chars |= set(re.findall(CJK, html))

    if not chars:
        print("网页里没有中文，不需要中文字体。")
        return

    print(f"扫描 {len(pages)} 个页面，用到 {len(chars)} 个中日韩字符")

    text = "".join(sorted(chars))
    css_url = ("https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@300..600"
               "&display=swap&text=" + urllib.parse.quote(text))
    css = curl(css_url).decode()

    urls = re.findall(r"url\((https://[^)]+)\)", css)
    if not urls:
        sys.exit("Google Fonts 没有返回字体地址，检查一下网络")

    curl(urls[0], OUT)
    print(f"已写入 {OUT.relative_to(SITE)}  {OUT.stat().st_size / 1024:.1f} KB")

    # 验一遍：缺字是静默失败，不查就会漏
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        print("⚠ 没装 fonttools，跳过覆盖率检查（pip3 install fonttools brotli）")
        return

    font = TTFont(OUT)
    have: set[str] = set()
    for table in font["cmap"].tables:
        have |= {chr(c) for c in table.cmap}
    missing = sorted(chars - have)
    if missing:
        sys.exit(f"✗ 字体里缺 {len(missing)} 个字：{''.join(missing)}")
    print(f"✓ {len(chars)} 个字符全部覆盖")
    print("\n别忘了再跑一次 python3 build.py，把新字体复制到 docs/")


if __name__ == "__main__":
    main()
