#!/usr/bin/env python3
"""
重新生成中文字体子集。

    python3 site/tools/subset_font.py

什么时候要跑：**改完中文文案、跑完 build.py 之后**。

为什么需要：完整的思源宋体有 20 MB，全量塞进网页是不可接受的。
这个脚本扫描已经生成好的网页，找出实际用到的每一个中日韩字符，
只把这些字打包成一个 woff2。

所以顺序很重要：先 build.py 生成网页，再跑这个，然后再 build.py 一次
把新字体复制进 docs/。如果你加了新字却忘了跑，那几个字会掉回系统默认字体
——Mac 上是苹方，Windows 上是微软雅黑，跟旁边的衬线排版打架，
而且不会报错。脚本最后会替你检查一遍。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 2026-08：这个脚本被整个重写过一次，因为老做法有一个**静默投毒**的坑。

老做法是把要用的字拼进 Google Fonts 的 `css2?...&text=<所有汉字>`，
让 Google 那边裁好再下回来。加了 62 篇影评之后字数涨到 1553，实测：

    500 字  → URL  4,587 字符 → 5.7 KB CSS，正常
   1000 字  → URL  9,087 字符 → 113 KB CSS  ← Google 默默忽略 text=
   1553 字  → URL 14,064 字符 → 113 KB CSS  ← 同上

**三次都是 HTTP 200。** 超过某个长度之后 Google 不报错，而是退回按
unicode-range 切片投递（一百多个 @font-face）。老脚本取 `urls[0]`——
第一个切片——于是写出一个 4.5 KB、一个想要的字都没有的字体文件，
还把好的那份覆盖掉了。

现在改成：**下载一次完整的变量字体，之后全部在本地裁。**
没有 URL 长度上限，加多少内容都不会再撞墙。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
DIST = SITE.parent / "docs"
OUT = SITE / "static" / "fonts" / "noto-serif-sc-subset.woff2"

# 完整字体缓存在 素材/ 下面 —— 那个目录在 .gitignore 里，不会进仓库。
# 下载一次就够，之后每次裁都用本地这一份，不联网。
FULL = SITE.parent / "素材" / "字体" / "NotoSerifSC[wght].ttf"
FULL_URL = ("https://raw.githubusercontent.com/google/fonts/main/"
            "ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# 中日韩汉字、全角标点、中文常用的破折号和引号
CJK = r"[　-〿一-鿿＀-￯—‘-”…]"

MIN_FULL_BYTES = 5_000_000     # 完整字体约 20 MB；明显小于这个数就是没下全


def fetch_full_font() -> None:
    """把完整的变量字体下回来，缓存到 素材/字体/。已经有了就直接用。

    ⚠️ 先下到 .part 再改名。他的网络到 GitHub 会断（CLAUDE.md 第七节），
       断在一半的文件如果直接叫最终名字，下次就会被当成"已经有了"。
    """
    if FULL.exists() and FULL.stat().st_size >= MIN_FULL_BYTES:
        print(f"完整字体已缓存：{FULL}  {FULL.stat().st_size / 1e6:.1f} MB")
        return

    FULL.parent.mkdir(parents=True, exist_ok=True)
    part = FULL.with_suffix(".ttf.part")
    print(f"下载完整字体（约 20 MB，只下这一次）……")
    r = subprocess.run(
        ["curl", "-fSL", "--retry", "3", "--retry-delay", "3",
         "--max-time", "600", "-A", UA, FULL_URL, "-o", str(part)],
        capture_output=True,
    )
    if r.returncode != 0:
        part.unlink(missing_ok=True)
        sys.exit(f"下载失败：{r.stderr.decode()[:300]}\n"
                 f"  网络问题的话过一会再试，现有的字体没有被动过。")
    if part.stat().st_size < MIN_FULL_BYTES:
        size = part.stat().st_size
        part.unlink()
        sys.exit(f"下回来的文件只有 {size / 1e6:.1f} MB，不像完整字体。没有覆盖任何东西。")
    part.rename(FULL)
    print(f"  已缓存到 {FULL}  {FULL.stat().st_size / 1e6:.1f} MB")


def scan_chars() -> set[str]:
    pages = sorted(DIST.glob("**/index.html"))
    if not pages:
        sys.exit(f"{DIST} 里没有网页。先跑 python3 site/build.py")
    chars: set[str] = set()
    for page in pages:
        html = page.read_text(encoding="utf-8")
        html = re.sub(r"<script.*?</script>", "", html, flags=re.S)  # 排除内嵌数据
        chars |= set(re.findall(CJK, html))
    print(f"扫描 {len(pages)} 个页面，用到 {len(chars)} 个中日韩字符")
    return chars


def main() -> None:
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        sys.exit("需要 fonttools 和 brotli：pip3 install fonttools brotli")

    chars = scan_chars()
    if not chars:
        print("网页里没有中文，不需要中文字体。")
        return

    fetch_full_font()

    font = TTFont(FULL)
    opts = subset.Options()
    opts.flavor = "woff2"
    # 保留字重轴：style.css 里那条 @font-face 写的是 font-weight: 300 600，
    # 靠的是这是一个可变字体。轴掉了字重就只剩一档。
    opts.recalc_bounds = True
    opts.notdef_outline = True
    opts.name_IDs = ["*"]
    opts.name_legacy = True

    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=[ord(c) for c in chars])
    sub.subset(font)

    # ⚠️ 先写临时文件、验完再覆盖。老脚本是先覆盖再验，
    #    于是那次坏掉的下载直接把好字体冲掉了，只能 git checkout 找回来。
    tmp = OUT.with_suffix(".woff2.new")
    font.flavor = "woff2"
    font.save(tmp)

    check = TTFont(tmp)
    have: set[str] = set()
    for table in check["cmap"].tables:
        have |= {chr(c) for c in table.cmap}
    missing = sorted(chars - have)
    if missing:
        tmp.unlink(missing_ok=True)
        sys.exit(f"✗ 裁出来的字体缺 {len(missing)} 个字：{''.join(missing)}\n"
                 f"  没有覆盖现有字体。")
    axes = [a.axisTag for a in check["fvar"].axes] if "fvar" in check else []

    before = OUT.stat().st_size if OUT.exists() else 0
    shutil.move(str(tmp), str(OUT))
    after = OUT.stat().st_size
    delta = f"（原来 {before / 1024:.1f} KB）" if before else ""
    print(f"✓ {len(chars)} 个字符全部覆盖，字重轴 {axes or '无'}")
    print(f"  已写入 {OUT.relative_to(SITE)}  {after / 1024:.1f} KB {delta}")
    print("\n别忘了再跑一次 python3 site/build.py，把新字体复制到 docs/")


if __name__ == "__main__":
    main()
