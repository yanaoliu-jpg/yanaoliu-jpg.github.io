#!/usr/bin/env python3
"""
检查中文字体子集够不够用（不联网）。

    python3 site/tools/check_font.py

什么时候用：`subset_font.py` 因为网络问题跑不起来的时候。
它只对比「网页里用到的字」和「字体里有的字」，不下载任何东西，
所以断网也能跑。

覆盖率够就可以照常推送——字体只在中文文案新增了汉字时才需要重新生成。
"""

import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
DIST = SITE.parent / "docs"
FONT = DIST / "static" / "fonts" / "noto-serif-sc-subset.woff2"
CJK = r"[　-〿一-鿿＀-￯—‘-”…]"


def main() -> None:
    pages = sorted(DIST.glob("**/index.html"))
    if not pages:
        sys.exit(f"{DIST} 里没有网页。先跑 python3 site/build.py")

    chars: set[str] = set()
    for page in pages:
        html = re.sub(r"<script.*?</script>", "",
                      page.read_text(encoding="utf-8"), flags=re.S)
        chars |= set(re.findall(CJK, html))

    if not chars:
        print("网页里没有中文，不需要中文字体。")
        return

    if not FONT.exists():
        sys.exit(f"✗ 找不到字体 {FONT}，需要跑 subset_font.py")

    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        sys.exit("需要 fonttools： pip3 install fonttools brotli")

    font = TTFont(FONT)
    have: set[str] = set()
    for table in font["cmap"].tables:
        have |= {chr(c) for c in table.cmap}

    missing = sorted(chars - have)
    print(f"网页用到 {len(chars)} 个中日韩字符，字体 {FONT.stat().st_size / 1024:.1f} KB")
    if missing:
        print(f"✗ 缺 {len(missing)} 个字：{''.join(missing)}")
        print("  等网络好了跑 python3 site/tools/subset_font.py，在那之前先别推中文改动")
        sys.exit(1)
    print("✓ 全部覆盖，可以照常推送")


if __name__ == "__main__":
    main()
