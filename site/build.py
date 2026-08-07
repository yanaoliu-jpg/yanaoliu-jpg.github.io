#!/usr/bin/env python3
"""
摄影作品集静态网站构建脚本。

    python3 build.py            增量构建（图片已是最新就跳过，很快）
    python3 build.py --force    强制重新生成所有图片
    python3 build.py --serve    构建完之后起一个本地服务器预览

原图只读，脚本绝不修改 ../素材/ 里的任何文件。
所有产物写进 dist/，部署的就是这个目录。

新增一个系列：
    1. 在 content/ 里复制一份 good-night.toml，改名字
    2. 改里面的 slug / title / source（source 指向 ../素材/ 下的文件夹）
    3. 跑 python3 build.py
"""

from __future__ import annotations

import argparse
import base64
import html
import io
import os
import re
import shutil
import subprocess
import sys
import tomllib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from PIL import Image, ExifTags, ImageFilter

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------

SITE = Path(__file__).resolve().parent
SRC_ROOT = SITE.parent / "素材"
# 产物放在仓库根目录的 docs/：GitHub Pages 只认「仓库根」或「/docs」两个位置，
# 用 /docs 就不用折腾额外分支，网页设置里点两下即可发布。
DIST = SITE.parent / "docs"
WORK = SITE / "_work"
CONTENT = SITE / "content"
TEMPLATES = SITE / "templates"
STATIC = SITE / "static"

# 生成的宽度（长边像素）。浏览器按屏幕大小和网速自己挑一个。
WIDTHS = [900, 1600, 2400, 3200]

# 压缩参数。这几个数字是针对这批高 ISO 夜景实测出来的：
# AVIF q72 的暗部误差优于 JPEG q90，体积却只有它的四成。
AVIF_QUALITY = 72
WEBP_QUALITY = 85
JPEG_QUALITY = 86

# JPEG 只是给既不支持 AVIF 也不支持 WebP 的浏览器兜底——那是 2020 年以前的老家伙，
# 不会跑在 4K 屏上。所以最大的那档不出 JPEG，能省掉近三分之一的仓库体积。
JPEG_MAX_WIDTH = 2400

# 小尺寸缩图后锐度会掉，轻微补一点；大尺寸不补，因为这批片子噪点多，
# 锐化会把噪点一起放大，还会让文件明显变大。
SHARPEN_BELOW = 2000
SHARPEN_ARGS = ["-unsharp", "0x0.6+0.35+0.02"]

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".JPG", ".JPEG"}

# ── 双语 ────────────────────────────────────────────────────────
# 英文站在根目录，中文站在 /zh/。图片只生成一份，两边共用。
# 每个 toml 里 [zh] 那一段是中文文案，没写的项自动回落到英文。
LANGS = {
    "en": {
        "dir": "",
        "html_lang": "en",
        "photographs": "photographs",
        "all_work": "All work",
        "scroll": "Scroll",
        "skip_photos": "Skip to the photographs",
        "skip_work": "Skip to the work",
        "series_count": "series",
        "home_eyebrow": "Photographs",
        "switch_label": "中文",
        "switch_title": "Read in Chinese",
        "open_full": "Open photograph {n} of {total} full screen",
        "viewer_label": "Full screen photograph",
        "close": "Close",
        "prev": "Previous photograph",
        "next": "Next photograph",
    },
    "zh": {
        "dir": "zh",
        "html_lang": "zh-Hans",
        "photographs": "张",
        "all_work": "全部作品",
        "scroll": "向下",
        "skip_photos": "跳到照片",
        "skip_work": "跳到作品",
        "series_count": "组",
        "home_eyebrow": "摄影",
        "switch_label": "EN",
        "switch_title": "Read in English",
        "open_full": "放大查看第 {n} 张，共 {total} 张",
        "viewer_label": "全屏查看",
        "close": "关闭",
        "prev": "上一张",
        "next": "下一张",
    },
}

ZH_MONTHS = {m: f"{m} 月" for m in range(1, 13)}

# 版面：图片高度上限 84vh，宽度上限 min(92vw, 1500px)。
# sizes 属性要跟 CSS 里的 .plate__frame 保持一致，否则浏览器会挑错尺寸。
MAX_VH = 84
MAX_VW = 92
MAX_PX = 1500


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def run(args: list, **kw) -> subprocess.CompletedProcess:
    """跑一个外部命令，失败就带上完整错误信息抛出。"""
    proc = subprocess.run(args, capture_output=True, text=True, **kw)
    if proc.returncode != 0:
        cmd = " ".join(str(a) for a in args[:6])
        raise RuntimeError(
            f"命令失败：{cmd} ...\n"
            f"  退出码 {proc.returncode}\n"
            f"  stderr: {proc.stderr.strip()[:800]}"
        )
    return proc


def require_tools() -> None:
    missing = [t for t in ("magick", "cwebp") if shutil.which(t) is None]
    if missing:
        sys.exit(
            f"缺少工具：{', '.join(missing)}\n"
            f"装一下： brew install imagemagick webp"
        )


def fmt_shutter(value) -> str | None:
    """0.002 -> '1/500s'，2.5 -> '2.5s'"""
    if value is None:
        return None
    v = float(value)
    if v <= 0:
        return None
    return f"{v:g}s" if v >= 1 else f"1/{round(1 / v)}s"


def slugify(text: str) -> str:
    s = re.sub(r"[^\w\-]+", "-", text.strip().lower(), flags=re.UNICODE)
    return re.sub(r"-{2,}", "-", s).strip("-")


def render(template: str, **values) -> str:
    """把模板里的 {{ key }} 换成对应的值。缺失的 key 会报错而不是静默留空。"""

    def sub(match: re.Match) -> str:
        key = match.group(1).strip()
        if key not in values:
            raise KeyError(f"模板里的 {{{{ {key} }}}} 没有提供值")
        return str(values[key])

    return re.sub(r"\{\{\s*([\w_]+)\s*\}\}", sub, template)


def esc(text) -> str:
    return html.escape(str(text), quote=True)


# ---------------------------------------------------------------------------
# 读照片
# ---------------------------------------------------------------------------


@dataclass
class Photo:
    path: Path
    stem: str
    width: int  # 转正之后的宽（EXIF 里标了旋转的，这里已经换过来了）
    height: int
    shot_at: datetime | None
    # 时间是不是真的来自 EXIF。有些照片经过微信、手机相册导出之后元数据被清空，
    # 只能退而用文件创建时间——那个日期大致可信，但几点几分纯属文件系统的产物，
    # 不能当成快门时刻显示出来。
    time_is_real: bool
    # 系列级 date 覆盖了逐张日期时置 False（见 date_label）
    show_date: bool = True
    iso: int | None = None
    aperture: float | None = None
    shutter: str | None = None
    focal: int | None = None
    alt: str = ""
    lqip: str = ""
    variants: dict = field(default_factory=dict)

    @property
    def aspect(self) -> float:
        return self.width / self.height

    @property
    def is_portrait(self) -> bool:
        return self.height > self.width

    @property
    def date_label(self) -> str:
        # 系列在 TOML 里写了 date 时，说明我们只知道月份、不知道具体哪天，
        # 那就一天都不标——标一个来自文件系统的假日期，比留空糟糕得多。
        if not self.show_date or not self.shot_at:
            return ""
        return self.shot_at.strftime("%Y.%m.%d")

    @property
    def time_label(self) -> str:
        # 只有真·EXIF 时间才显示到分钟
        if not (self.shot_at and self.time_is_real):
            return ""
        return self.shot_at.strftime("%H:%M")

    @property
    def datetime_attr(self) -> str:
        if not self.shot_at:
            return ""
        fmt = "%Y-%m-%dT%H:%M" if self.time_is_real else "%Y-%m-%d"
        return self.shot_at.strftime(fmt)

    @property
    def exif_label(self) -> str:
        bits = []
        if self.focal:
            bits.append(f"{self.focal}mm")
        if self.aperture:
            bits.append(f"f/{self.aperture:g}")
        if self.shutter:
            bits.append(self.shutter)
        if self.iso:
            bits.append(f"ISO {self.iso}")
        return " · ".join(bits)


def read_photo(path: Path) -> Photo:
    with Image.open(path) as im:
        raw_w, raw_h = im.size
        exif = im.getexif()

    base = {ExifTags.TAGS.get(k, k): v for k, v in exif.items()}
    sub = {ExifTags.TAGS.get(k, k): v for k, v in exif.get_ifd(0x8769).items()}

    # EXIF 方向 5-8 表示图片存的时候是躺着的，显示时要转 90 度。
    # 不处理的话网页上竖片会横躺——这是最常见的坑。
    orientation = base.get("Orientation", 1)
    width, height = (raw_h, raw_w) if orientation in (5, 6, 7, 8) else (raw_w, raw_h)

    shot_at = None
    time_is_real = False
    stamp = sub.get("DateTimeOriginal") or base.get("DateTime")
    if stamp:
        try:
            shot_at = datetime.strptime(str(stamp), "%Y:%m:%d %H:%M:%S")
            time_is_real = True
        except ValueError:
            pass

    if shot_at is None:
        # EXIF 被抹掉了（微信、手机相册导出常见）。退而求其次用文件创建时间，
        # 至少排序不会乱成随机。macOS 有 st_birthtime，其他系统退回修改时间。
        st = path.stat()
        shot_at = datetime.fromtimestamp(getattr(st, "st_birthtime", st.st_mtime))

    focal = sub.get("FocalLength")
    aperture = sub.get("FNumber")
    iso = sub.get("ISOSpeedRatings")
    if isinstance(iso, (tuple, list)):
        iso = iso[0]

    return Photo(
        path=path,
        stem=path.stem,
        width=width,
        height=height,
        shot_at=shot_at,
        time_is_real=time_is_real,
        iso=int(iso) if iso else None,
        aperture=float(aperture) if aperture else None,
        shutter=fmt_shutter(sub.get("ExposureTime")),
        focal=round(float(focal)) if focal else None,
    )


def discover(src_dir: Path) -> list[Photo]:
    if not src_dir.is_dir():
        sys.exit(f"找不到素材文件夹：{src_dir}")
    files = sorted(p for p in src_dir.iterdir() if p.suffix in IMAGE_SUFFIXES)
    if not files:
        sys.exit(f"{src_dir} 里没有找到照片")
    photos = [read_photo(p) for p in files]
    # 按拍摄时间排序：这组照片本身就是一条时间线，顺序不能乱。
    photos.sort(key=lambda p: (p.shot_at or datetime.max, p.stem))
    return photos


# ---------------------------------------------------------------------------
# 出图
# ---------------------------------------------------------------------------


def widths_for(photo: Photo) -> list[int]:
    """只生成不超过原图长边的尺寸——放大没有意义。"""
    longest = max(photo.width, photo.height)
    keep = [w for w in WIDTHS if w <= longest]
    return keep or [longest]


def is_fresh(photo: Photo, out_dir: Path, widths: list[int]) -> bool:
    src_mtime = photo.path.stat().st_mtime
    for w in widths:
        for ext in formats_for(w):
            f = out_dir / f"{photo.stem}-{w}.{ext}"
            if not f.exists() or f.stat().st_mtime < src_mtime:
                return False
    return True


def make_stages(photo: Photo, widths: list[int]) -> dict[int, Path]:
    """把原图解码一次，同时导出各个尺寸的中间 PNG。

    一次解码而不是每个尺寸解一次——3200 万像素的图解码不便宜。
    """
    WORK.mkdir(parents=True, exist_ok=True)
    args = ["magick", str(photo.path), "-auto-orient", "-colorspace", "sRGB"]
    stages: dict[int, Path] = {}
    for w in widths:
        out = WORK / f"{photo.stem}-{w}.png"
        stages[w] = out
        args += ["(", "-clone", "0", "-resize", f"{w}x{w}>"]
        if w < SHARPEN_BELOW:
            args += SHARPEN_ARGS
        args += ["-write", str(out), "+delete", ")"]
    args.append("null:")
    run(args)
    return stages


def formats_for(width: int) -> tuple[str, ...]:
    return ("avif", "webp", "jpg") if width <= JPEG_MAX_WIDTH else ("avif", "webp")


def encode_all(stage: Path, dest_base: Path, width: int) -> None:
    # AVIF：主力格式，暗部表现最好
    run(["magick", str(stage), "-strip", "-quality", str(AVIF_QUALITY),
         f"{dest_base}.avif"])
    # WebP：备用。-sharp_yuv 让色度转换更准，对夜景里的暖光尤其明显
    run(["cwebp", "-q", str(WEBP_QUALITY), "-m", "6", "-sharp_yuv", "-quiet",
         str(stage), "-o", f"{dest_base}.webp"])
    # JPEG：老浏览器兜底。4:4:4 = 不对色度降采样，
    # 否则窗户的暖黄光和夜空的粉紫会被压糊
    if "jpg" in formats_for(width):
        run(["magick", str(stage), "-strip", "-sampling-factor", "4:4:4",
             "-interlace", "JPEG", "-quality", str(JPEG_QUALITY), f"{dest_base}.jpg"])


def make_lqip(stage: Path) -> str:
    """生成一个 20px 宽的模糊占位图，直接内嵌进 HTML。

    深色页面上，图没加载完时看到一团模糊的暗影，比看到一个空白框好得多。
    """
    with Image.open(stage) as im:
        im = im.convert("RGB")
        im.thumbnail((20, 20), Image.LANCZOS)
        im = im.filter(ImageFilter.GaussianBlur(0.4))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=45, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def build_images(photos: list[Photo], slug: str, force: bool) -> int:
    out_dir = DIST / "img" / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    total_bytes = 0

    for i, photo in enumerate(photos, 1):
        widths = widths_for(photo)
        label = f"  [{i}/{len(photos)}] {photo.stem}"

        if not force and is_fresh(photo, out_dir, widths):
            print(f"{label}  已是最新，跳过")
            stages = {}
            smallest = out_dir / f"{photo.stem}-{widths[0]}.jpg"
            photo.lqip = make_lqip(smallest)
        else:
            n = sum(len(formats_for(w)) for w in widths)
            print(f"{label}  {photo.width}×{photo.height} → {len(widths)} 尺寸，共 {n} 个文件")
            stages = make_stages(photo, widths)
            for w in widths:
                encode_all(stages[w], out_dir / f"{photo.stem}-{w}", w)
            photo.lqip = make_lqip(stages[widths[0]])

        photo.variants = {}
        for ext in ("avif", "webp", "jpg"):
            useful = [w for w in widths if ext in formats_for(w)]
            # 存成相对 dist/ 根目录的路径。页面在哪一层由 prefix 决定——
            # 英文系列页在 /slug/，中文系列页在 /zh/slug/，深度不同。
            photo.variants[ext] = [
                (w, f"img/{slug}/{photo.stem}-{w}.{ext}") for w in useful
            ]
            total_bytes += sum(
                (out_dir / f"{photo.stem}-{w}.{ext}").stat().st_size for w in useful
            )

        for stage in stages.values():
            stage.unlink(missing_ok=True)

    return total_bytes


# ---------------------------------------------------------------------------
# 出 HTML
# ---------------------------------------------------------------------------


def srcset(variants: list[tuple[int, str]], prefix: str) -> str:
    return ", ".join(f"{prefix}{url} {w}w" for w, url in variants)


def sizes_attr(photo: Photo) -> str:
    """跟 CSS 里 .plate__frame 的宽度算法保持一致，浏览器才能挑对尺寸。"""
    return f"min({MAX_VW}vw, {MAX_PX}px, {MAX_VH * photo.aspect:.0f}vh)"


def plate_html(photo: Photo, index: int, total: int, prefix: str, L: dict) -> str:
    largest = prefix + photo.variants["jpg"][-1][1]
    return f"""
        <figure class="plate{' plate--portrait' if photo.is_portrait else ''}"
                id="plate-{index + 1}"
                style="--ar: {photo.aspect:.4f}">
          <button class="plate__open" type="button" data-index="{index}"
                  aria-label="{esc(L['open_full'].format(n=index + 1, total=total))}">
            <span class="plate__frame"
                  style="background-image: url(data:image/jpeg;base64,{photo.lqip})">
              <picture>
                <source type="image/avif" srcset="{srcset(photo.variants['avif'], prefix)}"
                        sizes="{sizes_attr(photo)}">
                <source type="image/webp" srcset="{srcset(photo.variants['webp'], prefix)}"
                        sizes="{sizes_attr(photo)}">
                <img src="{largest}" srcset="{srcset(photo.variants['jpg'], prefix)}"
                     sizes="{sizes_attr(photo)}"
                     width="{photo.width}" height="{photo.height}"
                     alt="{esc(photo.alt)}"
                     loading="{'eager' if index == 0 else 'lazy'}"
                     decoding="async"
                     {'fetchpriority="high"' if index == 0 else ''}>
              </picture>
            </span>
          </button>
          <figcaption class="plate__caption">
            <span class="plate__num">{index + 1:02d}</span>{
              f'''
            <time datetime="{photo.datetime_attr}">{photo.date_label}{
                f'<span class="plate__time"> · {photo.time_label}</span>'
                if photo.time_label else ''}</time>'''
              if photo.date_label else ''}
            <span class="plate__exif">{esc(photo.exif_label)}</span>
          </figcaption>
        </figure>"""


def photo_data(photos: list[Photo], prefix: str) -> str:
    """给全屏浏览用的数据。手写 JSON，避免为一点点数据引入依赖。"""
    import json

    return json.dumps(
        [
            {
                "avif": srcset(p.variants["avif"], prefix),
                "webp": srcset(p.variants["webp"], prefix),
                "jpg": srcset(p.variants["jpg"], prefix),
                "src": prefix + p.variants["jpg"][-1][1],
                "w": p.width,
                "h": p.height,
                "alt": p.alt,
                "date": p.date_label,
                "time": p.time_label,
                "exif": p.exif_label,
            }
            for p in photos
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def build_series(cfg: dict, force: bool) -> dict:
    slug = cfg.get("slug") or slugify(cfg["title"])
    src_dir = SRC_ROOT / cfg["source"]

    print(f"\n▸ {cfg['title']}  ({src_dir.relative_to(SRC_ROOT.parent)})")
    photos = discover(src_dir)
    print(f"  找到 {len(photos)} 张，按拍摄时间排序")

    alts = cfg.get("alt", {})
    missing_alt = []
    for p in photos:
        p.alt = alts.get(p.stem, "")
        if not p.alt:
            missing_alt.append(p.stem)
    if missing_alt:
        print(f"  ⚠ 这几张没有 alt 文字（读屏软件会读不出来）：{', '.join(missing_alt)}")

    # TOML 里可以写 date = "2024-05"：用于 EXIF 被抹掉、只知道大概月份的系列。
    # 写了就不再逐张标日期——只知道月份却标出"某月某日"是在编造精确度。
    forced = cfg.get("date")
    when = None
    if forced:
        try:
            when = datetime.strptime(str(forced), "%Y-%m")
        except ValueError:
            sys.exit(f"{cfg['title']} 的 date 要写成 \"YYYY-MM\"，现在是 {forced!r}")
        for p in photos:
            p.show_date = False
        print(f"  日期按 TOML 指定的 {when:%Y-%m}（不逐张标注）")

    total_bytes = build_images(photos, slug, force)

    # 目录页要用的封面。TOML 里可以写 cover = "文件名（不含扩展名）"，不写就用第一张。
    cover = photos[0]
    wanted = cfg.get("cover")
    if wanted:
        match = next((p for p in photos if p.stem == wanted), None)
        if match:
            cover = match
        else:
            print(f"  ⚠ 找不到指定的封面 {wanted}，改用第一张 {cover.stem}")

    return {
        "cfg": cfg,
        "slug": slug,
        "order": cfg.get("order", 999),
        "forced_date": when,
        "count": len(photos),
        "bytes": total_bytes,
        "cover": cover,
        "photos": photos,
    }


def text_of(cfg: dict, lang: str, key: str, default: str = "") -> str:
    """取某个语言的文案。中文没写的项自动回落到英文，不会开天窗。"""
    if lang != "en":
        val = cfg.get(lang, {}).get(key)
        if val is not None:
            return val
    return cfg.get(key, default)


def format_span(s: dict, lang: str) -> str:
    """把拍摄时间跨度写成人话。中英文的日期写法完全不同，分开处理。"""
    when = s["forced_date"]
    if when:
        return (f"{when.year} 年 {when.month} 月" if lang == "zh"
                else when.strftime("%B %Y"))

    dated = [p.shot_at for p in s["photos"] if p.shot_at]
    if not dated:
        return ""
    lo, hi = min(dated), max(dated)
    same_month = lo.strftime("%Y%m") == hi.strftime("%Y%m")
    if lang == "zh":
        if same_month:
            return f"{lo.year} 年 {lo.month} 月"
        if lo.year == hi.year:
            return f"{lo.year} 年 {lo.month}–{hi.month} 月"
        return f"{lo.year} 年 {lo.month} 月 – {hi.year} 年 {hi.month} 月"
    if same_month:
        return lo.strftime("%B %Y")
    return f"{lo.strftime('%B')} – {hi.strftime('%B %Y')}"


def render_series(s: dict, lang: str, site: dict) -> None:
    """把一个系列渲染成某一种语言的页面。图片是共用的，只有文字和路径不同。"""
    cfg, L = s["cfg"], LANGS[lang]
    # 英文系列页在 /slug/，中文在 /zh/slug/ ——到 dist 根目录的深度不一样
    depth = 2 if L["dir"] else 1
    prefix = "../" * depth
    root = "/".join([".."] * depth)

    title = text_of(cfg, lang, "title")
    author = text_of(cfg, lang, "author", text_of(site, lang, "name"))
    span = format_span(s, lang)
    photos = s["photos"]

    count_label = f"{s['count']} {L['photographs']}"

    body = render(
        (TEMPLATES / "series.html").read_text(encoding="utf-8"),
        title=esc(title),
        eyebrow=esc(text_of(cfg, lang, "eyebrow")),
        year=esc(str(text_of(cfg, lang, "year"))),
        statement=paragraphs(text_of(cfg, lang, "statement")),
        count_label=esc(count_label),
        span=esc(span),
        place=esc(text_of(cfg, lang, "place")),
        plates="\n".join(
            plate_html(p, i, len(photos), prefix, L) for i, p in enumerate(photos)
        ),
        colophon=esc(text_of(cfg, lang, "colophon")),
        author=esc(author),
        photo_data=photo_data(photos, prefix),
        back_href=f"{root}/",
        back_label=esc(L["all_work"]),
        scroll=esc(L["scroll"]),
        skip=esc(L["skip_photos"]),
        switch_href=switch_href(lang, s["slug"]),
        switch_label=esc(L["switch_label"]),
        switch_title=esc(L["switch_title"]),
        viewer_label=esc(L["viewer_label"]),
        close_label=esc(L["close"]),
        prev_label=esc(L["prev"]),
        next_label=esc(L["next"]),
    )

    page = render(
        (TEMPLATES / "base.html").read_text(encoding="utf-8"),
        html_lang=L["html_lang"],
        title=f"{esc(title)} — {esc(author)}",
        description=esc(text_of(cfg, lang, "description")),
        root=root,
        alternates=alternate_links(s["slug"]),
        body=body,
    )

    out = DIST / L["dir"] / s["slug"] / "index.html" if L["dir"] else DIST / s["slug"] / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")


def switch_href(lang: str, slug: str = "") -> str:
    """语言切换按钮：指向对方语言的**同一个**页面，不是跳回首页。

      英文系列 /slug/      → ../zh/slug/
      中文系列 /zh/slug/   → ../../slug/
      英文首页 /           → ./zh/
      中文首页 /zh/        → ../
    """
    if lang == "en":
        return f"../zh/{slug}/" if slug else "./zh/"
    return f"../../{slug}/" if slug else "../"


def alternate_links(slug: str = "") -> str:
    """告诉搜索引擎这两个网址是同一内容的不同语言版本。"""
    base = "https://yanaoliu-jpg.github.io"
    tail = f"/{slug}/" if slug else "/"
    return (
        f'<link rel="alternate" hreflang="en" href="{base}{tail}">\n'
        f'<link rel="alternate" hreflang="zh-Hans" href="{base}/zh{tail}">\n'
        f'<link rel="alternate" hreflang="x-default" href="{base}{tail}">'
    )


def typography(text: str) -> str:
    """把直引号换成印刷体的弯引号。

    衬线正文里 don't 和 don’t 的差别一眼就能看出来。
    放在这里自动处理，比要求写文案的人记得敲特殊字符靠谱。
    """
    text = text.replace("--", "—")
    text = re.sub(r'"([^"\n]*)"', "“\\1”", text)   # 成对双引号
    text = re.sub(r"(?<=\w)'(?=\w)", "’", text)          # don't / classmate's
    text = re.sub(r"(?<=\w)'(?![\w])", "’", text)        # students'
    return text


def paragraphs(text: str) -> str:
    """把纯文本按空行切成 <p>。占位符（【】包起来的）加个记号，方便一眼看到还没填。"""
    out = []
    for block in re.split(r"\n\s*\n", text.strip()):
        if not block.strip():
            continue
        cls = ' class="placeholder"' if "【" in block else ""
        out.append(f"<p{cls}>{esc(typography(block.strip()))}</p>")
    return "\n          ".join(out)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def copy_static() -> None:
    dest = DIST / "static"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(STATIC, dest)
    # 告诉 GitHub Pages 不要用 Jekyll 处理，否则下划线开头的文件会被吃掉
    (DIST / ".nojekyll").write_text("")


def work_card(s: dict, lang: str, prefix: str) -> str:
    """目录页上的一个作品条目。"""
    cfg, cover, L = s["cfg"], s["cover"], LANGS[lang]
    sizes = f"min(100%, {52 * cover.aspect:.0f}vh)"
    detail = " · ".join(
        x for x in (
            f"{s['count']} {L['photographs']}",
            format_span(s, lang),
            text_of(cfg, lang, "place"),
        ) if x
    )
    eyebrow = text_of(cfg, lang, "eyebrow")
    year = str(text_of(cfg, lang, "year"))

    return f"""
      <li class="work" style="--ar: {cover.aspect:.4f}">
        <a class="work__link" href="./{s['slug']}/">
          <span class="work__frame"
                style="background-image: url(data:image/jpeg;base64,{cover.lqip})">
            <picture>
              <source type="image/avif" srcset="{srcset(cover.variants['avif'], prefix)}" sizes="{sizes}">
              <source type="image/webp" srcset="{srcset(cover.variants['webp'], prefix)}" sizes="{sizes}">
              <img src="{prefix}{cover.variants['jpg'][-1][1]}"
                   srcset="{srcset(cover.variants['jpg'], prefix)}" sizes="{sizes}"
                   width="{cover.width}" height="{cover.height}"
                   alt="{esc(cover.alt)}" loading="lazy" decoding="async">
            </picture>
          </span>
          <span class="work__meta">
            <span class="work__eyebrow">{esc(eyebrow)}{' · ' + esc(year) if year else ''}</span>
            <span class="work__title">{esc(text_of(cfg, lang, 'title'))}</span>
            <span class="work__detail">{esc(detail)}</span>
          </span>
        </a>
      </li>"""


def write_index(series: list[dict], site: dict, lang: str) -> None:
    """作品总目录页。

    英文在 /，中文在 /zh/。每个系列仍然住在 /<slug>/ 和 /zh/<slug>/ ——
    已经发给招生官的链接永远不会失效。
    """
    L = LANGS[lang]
    depth = 1 if L["dir"] else 0
    prefix = "../" * depth
    root = "/".join([".."] * depth) if depth else "."
    name = text_of(site, lang, "name")

    ordered = sorted(series, key=lambda s: (s["order"], text_of(s["cfg"], lang, "title")))
    body = render(
        (TEMPLATES / "index.html").read_text(encoding="utf-8"),
        name=esc(name),
        home_eyebrow=esc(L["home_eyebrow"]),
        intro=paragraphs(text_of(site, lang, "intro")),
        works="\n".join(work_card(s, lang, prefix) for s in ordered),
        count_label=esc(f"{len(ordered)} {L['series_count']}"),
        total_label=esc(f"{sum(s['count'] for s in ordered)} {L['photographs']}"),
        footer=esc(text_of(site, lang, "footer")),
        scroll=esc(L["scroll"]),
        skip=esc(L["skip_work"]),
        switch_href=switch_href(lang),
        switch_label=esc(L["switch_label"]),
        switch_title=esc(L["switch_title"]),
    )
    page = render(
        (TEMPLATES / "base.html").read_text(encoding="utf-8"),
        html_lang=L["html_lang"],
        title=esc(name),
        description=esc(text_of(site, lang, "description")),
        root=root,
        alternates=alternate_links(),
        body=body,
    )
    out = DIST / L["dir"] / "index.html" if L["dir"] else DIST / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description="构建摄影作品集网站")
    ap.add_argument("--force", action="store_true", help="强制重新生成所有图片")
    ap.add_argument("--serve", action="store_true", help="构建完起本地服务器预览")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    require_tools()
    DIST.mkdir(parents=True, exist_ok=True)

    # 下划线开头的是站点级配置，不是作品系列
    site = {}
    site_path = CONTENT / "_site.toml"
    if site_path.exists():
        with site_path.open("rb") as f:
            site = tomllib.load(f)

    configs = sorted(p for p in CONTENT.glob("*.toml") if not p.name.startswith("_"))
    if not configs:
        sys.exit(f"{CONTENT} 里没有找到作品系列的 .toml 文件")

    built = []
    for cfg_path in configs:
        with cfg_path.open("rb") as f:
            cfg = tomllib.load(f)
        built.append(build_series(cfg, args.force))

    # 图片只生成一次，页面按语言各渲染一遍
    for lang in LANGS:
        for s in built:
            render_series(s, lang, site)
        write_index(built, site, lang)

    copy_static()
    WORK.exists() and shutil.rmtree(WORK, ignore_errors=True)

    print("\n构建完成：")
    warnings = []
    for b in built:
        cfg = b["cfg"]
        print(f"  {text_of(cfg, 'en', 'title')}: {b['count']} 张，"
              f"图片共 {b['bytes'] / 1e6:.1f} MB，封面 {b['cover'].stem}")
        for lang in LANGS:
            for key in ("title", "statement", "description"):
                if "【" in str(text_of(cfg, lang, key)):
                    warnings.append(f"{text_of(cfg, 'en', 'title')} 的 {lang}.{key} 还是占位符")
    for lang in LANGS:
        for key in ("name", "intro", "description"):
            if "【" in str(text_of(site, lang, key)):
                warnings.append(f"首页 {lang}.{key} 还是占位符")

    langs = " / ".join(f"/{LANGS[l]['dir']}" if LANGS[l]["dir"] else "/" for l in LANGS)
    print(f"  语言：{langs}（图片共用，不重复生成）")
    print(f"  共 {len(built)} 个系列 {sum(b['count'] for b in built)} 张")
    for w in warnings:
        print(f"  ⚠ {w}")
    print(f"  产物目录：{DIST}")

    if args.serve:
        os.chdir(DIST)
        print(f"\n预览地址： http://localhost:{args.port}/   （Ctrl+C 停止）")
        subprocess.run([sys.executable, "-m", "http.server", str(args.port)])


if __name__ == "__main__":
    main()
