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
#
# ⚠️ 3200px 那档在 2026-08 拿掉了。它占图片体积的 41%（110 MB），
#    却只有 4K 屏用得上——招生官用的基本是笔记本，2400px 在视网膜屏上
#    也够铺满 1200px 的显示宽度。
#    拿掉它是为了给影片腾地方：`docs/` 就是 GitHub Pages 发布的站点，
#    **硬上限 1 GB**，而一部十分钟的 720p 片子就要 233 MB。
#    真要加回来：把 3200 写回下面这一行，跑 `build.py`（增量构建会自己补出来）。
WIDTHS = [900, 1600, 2400]

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
        "skip_film": "Skip to the film",
        "series_count": "series",
        "home_eyebrow": "Photographs",
        "switch_label": "中文",
        "switch_title": "Read in Chinese",
        "next_series": "Next series",
        "next_film": "Next film",
        "series_word": "Series",
        "film_word": "Film",
        "film_count": "film",
        "films_count": "films",
        "seconds": "seconds",
        "no_video": "Your browser cannot play this video.",
        "download_video": "Download the film (MP4)",
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
        "skip_film": "跳到影片",
        "series_count": "组",
        "home_eyebrow": "摄影",
        "switch_label": "EN",
        "switch_title": "Read in English",
        "next_series": "下一组",
        "next_film": "下一部",
        "series_word": "第{n}组",
        "film_word": "影片",
        "film_count": "部影片",
        "films_count": "部影片",
        "seconds": "秒",
        "no_video": "你的浏览器放不了这个视频。",
        "download_video": "下载影片（MP4）",
        "open_full": "放大查看第 {n} 张，共 {total} 张",
        "viewer_label": "全屏查看",
        "close": "关闭",
        "prev": "上一张",
        "next": "下一张",
    },
}

ZH_MONTHS = {m: f"{m} 月" for m in range(1, 13)}

# 「第五组」里的那个「五」。到 99 组够用了，超过了他也早就该精选而不是堆量。
CN_DIGITS = "〇一二三四五六七八九"

# 版面：照片高度上限 72vh，宽度上限 min(92vw, 1400px)。
#
# ⚠️ 这三个数字必须跟 style.css 里的 --plate-vh 和 .plate 的 width 完全一致。
# 它们被写进 <img sizes="..."> ——浏览器靠它决定下载哪个分辨率。
# 对不上的话画面不会变形（CSS 说了算），但会下错档：要么糊，要么白下载大图。
MAX_VH = 72
MAX_VW = 92
MAX_PX = 1400

# 目录页封面的版面，同样必须跟 style.css 对上（见 .works / .work）：
#   INDEX_COVER_H  ↔  .works 的 --cover-h        并排时每张封面的高度
#   INDEX_STACK_PX ↔  @media (max-width: 900px)  换成竖向堆叠的断点
#   INDEX_STACK_VH ↔  堆叠时 .work 的 52vh
INDEX_COVER_H = "clamp(300px, 24vw + 54px, 400px)"
INDEX_STACK_PX = 900
INDEX_STACK_VH = 52

# ── 视频 ────────────────────────────────────────────────────────
# 只出两种，跟图片那套「新格式主力 + 老格式兜底」是同一个道理：
#   .webm (AV1)   现代浏览器，实测 6.6 MB
#   .mp4  (H.264) 所有浏览器兜底，实测 15.2 MB
#
# mp4 不是可选项，是必需品：源文件是 HEVC，Safari 能放，Chrome/Firefox 大多不行。
# 源是 1440p，网页降到 1080p —— 30 秒的片子看不出差别，体积省一半。
VIDEO_HEIGHT = 1080
VIDEO_AV1_CRF = 34
VIDEO_H264_CRF = 21


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


def no_avif_marker(out_dir: Path, stem: str) -> Path:
    """「这张图不用 AVIF」的记号（见 build_images 里量体积那段）。

    没有这个记号的话，增量构建每次都会发现 AVIF 文件不见了、
    于是把整张图重编一遍——本来是省体积，结果每次构建都变慢。
    """
    return out_dir / f"{stem}.noavif"


def is_fresh(photo: Photo, out_dir: Path, widths: list[int]) -> bool:
    src_mtime = photo.path.stat().st_mtime
    skip_avif = no_avif_marker(out_dir, photo.stem).exists()
    for w in widths:
        for ext in formats_for(w):
            if ext == "avif" and skip_avif:
                continue
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
        weight = {}
        for ext in ("avif", "webp", "jpg"):
            useful = [w for w in widths if ext in formats_for(w)]
            # 存成相对 dist/ 根目录的路径。页面在哪一层由 prefix 决定——
            # 英文系列页在 /slug/，中文系列页在 /zh/slug/，深度不同。
            photo.variants[ext] = [
                (w, f"img/{slug}/{photo.stem}-{w}.{ext}") for w in useful
            ]
            weight[ext] = sum(
                (out_dir / f"{photo.stem}-{w}.{ext}").stat().st_size for w in useful
            )

        # ── 编完之后量一量，谁大就不要谁 ──────────────────────────
        # AVIF 在这批照片上一直是最小的（1600px 实测 208 / 230 / 343 KB），
        # 但**影片的封面帧**上它反常地涨到 617 KB，而 WebP 只要 26 KB——
        # 那种平坦低细节的画面会让 ImageMagick 的 AVIF 通道失灵
        # （实测 q72→616KB、q60→370KB、q50→387KB，连单调都不满足）。
        #
        # 与其去调 ImageMagick，不如量出来：AVIF 不比 WebP 小就整个不用它。
        # 必须**整张图一起丢**，不能只丢某一档——<picture> 是先按 type 选中
        # 一个 <source>，再在它的 srcset 里挑尺寸；只丢大档的话，视网膜屏会
        # 选中 AVIF 那条、却只找得到小尺寸，反而更糊。
        marker = no_avif_marker(out_dir, photo.stem)
        if weight["avif"] >= weight["webp"] > 0:
            print(f"      ↳ AVIF 比 WebP 还大（{weight['avif']/1024:.0f} vs "
                  f"{weight['webp']/1024:.0f} KB），这张不用 AVIF")
            for w, _ in photo.variants["avif"]:
                (out_dir / f"{photo.stem}-{w}.avif").unlink(missing_ok=True)
            photo.variants["avif"] = []
            weight["avif"] = 0
            marker.write_text("")
        elif marker.exists():
            marker.unlink()

        total_bytes += sum(weight.values())

        for stage in stages.values():
            stage.unlink(missing_ok=True)

    return total_bytes


# ---------------------------------------------------------------------------
# 出 HTML
# ---------------------------------------------------------------------------


def srcset(variants: list[tuple[int, str]], prefix: str) -> str:
    return ", ".join(f"{prefix}{url} {w}w" for w, url in variants)


def picture_sources(photo: Photo, prefix: str, sizes: str, indent: str) -> str:
    """<picture> 里 <img> 之前的那几行 <source>。

    variants 里某个格式是空的就整条不出——目前只有 AVIF 会被丢掉
    （见 build_images 里量体积那段）。出一条 srcset 为空的 <source>
    在部分浏览器上会让整张图不显示，所以必须是不出，不是出个空的。
    """
    out = []
    for ext, mime in (("avif", "image/avif"), ("webp", "image/webp")):
        if photo.variants.get(ext):
            out.append(f'{indent}<source type="{mime}" '
                       f'srcset="{srcset(photo.variants[ext], prefix)}" sizes="{sizes}">')
    return "\n".join(out)


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
{picture_sources(photo, prefix, sizes_attr(photo), " " * 16)}
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
                "avif": srcset(p.variants.get("avif", []), prefix),
                "webp": srcset(p.variants.get("webp", []), prefix),
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
        "kind": "series",
        "count": len(photos),
        "bytes": total_bytes,
        "cover": cover,
        "photos": photos,
    }


# ---------------------------------------------------------------------------
# 影片
# ---------------------------------------------------------------------------


def require_ffmpeg() -> None:
    """只在真的有影片要处理时才检查——只放照片的人不该被逼着装 ffmpeg。"""
    missing = [t for t in ("ffmpeg", "ffprobe") if shutil.which(t) is None]
    if missing:
        sys.exit(
            f"缺少工具：{', '.join(missing)}（有影片要处理时才需要）\n"
            f"装一下： brew install ffmpeg"
        )


def probe(path: Path, entries: str, extra: list | None = None) -> str:
    args = ["ffprobe", "-v", "error", *(extra or []),
            "-show_entries", entries, "-of", "default=noprint_wrappers=1:nokey=1",
            str(path)]
    return run(args).stdout.strip()


def fmt_duration(seconds: float, lang: str) -> str:
    s = round(seconds)
    if s < 60:
        return f"{s} {LANGS[lang]['seconds']}"
    return f"{s // 60}:{s % 60:02d}"


def encode_video(src: Path, out_dir: Path, slug: str, cfg: dict, force: bool) -> int:
    """转出 webm(AV1) 和 mp4(H.264)。

    比源文件新就跳过——一条 30 秒的片子转一次要一分多钟，
    每次构建都从头来会让 build.py 变得没法用（跟图片那套 is_fresh 同一个道理）。

    档位可以按片子在 toml 里覆盖（height / av1_crf / h264_crf）。
    30 秒的叙事短片值得 1080p；5 分钟的访谈片全是人在说话，720p 完全够，
    而且体积差得很远——实测同一部片子 1080p 要 248 MB、720p 只要 85 MB。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    scale = f"scale=-2:{cfg.get('height', VIDEO_HEIGHT)}"
    jobs = [
        (out_dir / f"{slug}.webm", [
            "-c:v", "libsvtav1", "-crf", str(cfg.get("av1_crf", VIDEO_AV1_CRF)),
            "-preset", "6",
            "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "96k"]),
        # +faststart 把索引挪到文件开头，浏览器不用下完整个文件就能起播
        (out_dir / f"{slug}.mp4", [
            "-c:v", "libx264", "-crf", str(cfg.get("h264_crf", VIDEO_H264_CRF)),
            "-preset", "slow",
            "-profile:v", "high", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"]),
    ]
    src_mtime = src.stat().st_mtime
    total = 0
    for dest, args in jobs:
        if not force and dest.exists() and dest.stat().st_mtime >= src_mtime:
            print(f"  {dest.name}  已是最新，跳过")
        else:
            print(f"  {dest.name}  转码中…（一分钟上下，别急）")
            run(["ffmpeg", "-v", "error", "-y", "-i", str(src),
                 "-vf", scale, *args, str(dest)])
        total += dest.stat().st_size
    return total


def build_film(cfg: dict, force: bool) -> dict:
    """一部影片。返回的字典跟 build_series 形状一致，后面的代码不用分叉太多。"""
    require_ffmpeg()
    slug = cfg.get("slug") or slugify(cfg["title"])
    src = SRC_ROOT / cfg["source"] / cfg["video"]
    if not src.is_file():
        sys.exit(f"找不到视频文件：{src}")

    print(f"\n▸ {cfg['title']}  ({src.relative_to(SRC_ROOT.parent)})  影片")
    w, h = (int(x) for x in probe(src, "stream=width,height",
                                 ["-select_streams", "v:0"]).split())
    duration = float(probe(src, "format=duration"))
    print(f"  源 {w}×{h} / {duration:.1f} 秒 → 网页 {cfg.get('height', VIDEO_HEIGHT)}p")

    total_bytes = encode_video(src, DIST / "video" / slug, slug, cfg, force)

    # 封面帧走**图片流水线**，跟另外七个封面用同一套 AVIF/WebP/JPEG 四档，
    # 首页那张卡不需要任何特殊照顾。
    #
    # 抽出来的帧写在 _work/ 里（构建结束会删掉），然后把它的 mtime 改成视频的 mtime——
    # 这样 is_fresh() 才能正确判断「视频没变就不必重出封面」。不改的话每次构建
    # 都会重新编码四档封面。
    WORK.mkdir(parents=True, exist_ok=True)
    frame = WORK / f"{slug}-poster.jpg"
    run(["ffmpeg", "-v", "error", "-y", "-ss", str(cfg.get("poster_at", 1)),
         "-i", str(src), "-frames:v", "1", "-q:v", "2", str(frame)])
    os.utime(frame, (src.stat().st_mtime, src.stat().st_mtime))

    cover = read_photo(frame)
    cover.alt = cfg.get("poster_alt", "")
    cover.show_date = False
    if not cover.alt:
        print("  ⚠ 封面帧没有 poster_alt（读屏软件会读不出来）")
    total_bytes += build_images([cover], slug, force)

    when = None
    if cfg.get("date"):
        try:
            when = datetime.strptime(str(cfg["date"]), "%Y-%m")
        except ValueError:
            sys.exit(f"{cfg['title']} 的 date 要写成 \"YYYY-MM\"，现在是 {cfg['date']!r}")

    return {
        "cfg": cfg,
        "kind": "film",
        "slug": slug,
        "order": cfg.get("order", 999),
        "forced_date": when,
        "count": 0,
        "duration": duration,
        "aspect": w / h,
        "bytes": total_bytes,
        "cover": cover,
        "photos": [],
    }


def text_of(cfg: dict, lang: str, key: str, default: str = "") -> str:
    """取某个语言的文案。中文没写的项自动回落到英文，不会开天窗。"""
    if lang != "en":
        val = cfg.get(lang, {}).get(key)
        if val is not None:
            return val
    return cfg.get(key, default)


def cn_number(n: int) -> str:
    """5 -> 五，10 -> 十，15 -> 十五，20 -> 二十，25 -> 二十五。"""
    if n < 10:
        return CN_DIGITS[n]
    tens, ones = divmod(n, 10)
    return ("" if tens == 1 else CN_DIGITS[tens]) + "十" + (CN_DIGITS[ones] if ones else "")


def eyebrow_for(s: dict, lang: str) -> str:
    """标题上方那行「Series 05 / 第五组」，影片则是「Film / 影片」。

    默认自动生成——手写的话，加到第十组时迟早会写重号或跳号，
    而这行字出现在系列页和目录页两处，错了很显眼。
    真要特殊写法，在 toml 里写 eyebrow 就能覆盖。

    ⚠️ 编号用的是 s["number"]，**不是 order**。影片不占编号：
    影片排在最前面（order 0），但它不是「第一组照片」，
    七组照片仍然是 01–07。number 由 main() 里只数照片系列算出来。
    """
    written = text_of(s["cfg"], lang, "eyebrow")
    if written:
        return written
    if s["kind"] == "film":
        return LANGS[lang]["film_word"]
    word, n = LANGS[lang]["series_word"], s["number"]
    return word.format(n=cn_number(n)) if "{n}" in word else f"{word} {n:02d}"


def detail_bits(s: dict, lang: str) -> tuple:
    """目录页和「下一组」里那行「9 张 · 2025 年 7 月」。影片写时长。"""
    L = LANGS[lang]
    head = (fmt_duration(s["duration"], lang) if s["kind"] == "film"
            else f"{s['count']} {L['photographs']}")
    return (head, format_span(s, lang))


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


def year_span(series: list[dict], lang: str) -> str:
    """所有作品横跨的年份，写成「2023–2026」/「2023 至 2026」。

    首页那句 meta description（搜索结果和分享链接里露出的那一行）原来是手写年份的，
    两次加新作品之后都忘了改，挂着「between 2023 and 2024」而实际已经到 2025、2026。
    现在 toml 里写 {years}，由这里填，不可能再过期。
    """
    years = [p.shot_at.year for s in series for p in s["photos"] if p.shot_at]
    if not years:
        return ""
    lo, hi = min(years), max(years)
    if lo == hi:
        return str(lo)
    return f"{lo} 至 {hi}" if lang == "zh" else f"{lo}–{hi}"


def render_series(s: dict, lang: str, site: dict, nxt: dict) -> None:
    """把一个系列渲染成某一种语言的页面。图片是共用的，只有文字和路径不同。

    nxt 是**下一组**（最后一组绕回第一组）。看完一组之后如果只有左上角
    一个「全部作品」，招生官就得退回目录、重新找、再点进去；十组就是十次往返。
    绕回去而不是在最后一组停下，是为了任何一个入口进来都不会走到死路——
    直接点开第三组链接的人，同样能一路读完剩下的。
    """
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
        eyebrow=esc(eyebrow_for(s, lang)),
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
        **nextup_values(s, nxt, lang, root),
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


def nextup_values(s: dict, nxt: dict, lang: str, root: str) -> dict:
    """系列页和影片页共用的那一小块「下一组 / 下一部」。

    ⚠️ href 是 ../slug/ 不是 {root}/slug/。每个页面都住在自己语言那一层
    （/slug/ 和 /zh/slug/），下一个永远是**同级目录**，只上一层。
    写成 {root}/ 的话中文页会跳到 ../../good-night/ ——那是英文页，
    读者读着中文突然掉进英文站。这个坑踩过一次。
    """
    L = LANGS[lang]
    return dict(
        # 前缀是 nextup_ 不是 next_：next_label 已经被全屏查看的「下一张」占了
        nextup_href=f"../{nxt['slug']}/",
        nextup_label=esc(L["next_film"] if nxt["kind"] == "film" else L["next_series"]),
        nextup_title=esc(text_of(nxt["cfg"], lang, "title")),
        # 跟 .work__detail 同一套：每段一个 nowrap 的 <span>，段与段之间留空格。
        # 直接拼成一个长字符串的话，窄屏上会断在「November –」后面，
        # 把一个日期范围劈成两行。
        nextup_meta=" ".join(
            f"<span>{esc(x)}</span>"
            for x in (eyebrow_for(nxt, lang), *detail_bits(nxt, lang)) if x
        ),
        back_href=f"{root}/",
        back_label=esc(L["all_work"]),
    )


def render_film(s: dict, lang: str, site: dict, nxt: dict) -> None:
    """一部影片的页面。跟系列页共用同一套版式，只是照片换成了一个 <video>。

    播放器不带任何 JavaScript：`<video controls poster>` 原生就够用。
    preload="metadata" 保证打开页面只下几十 KB 元数据 + 一张封面帧，
    点了播放才去下正片——这跟「关掉 JS 也要能看」是同一条原则。
    """
    cfg, L = s["cfg"], LANGS[lang]
    depth = 2 if L["dir"] else 1
    prefix = "../" * depth
    root = "/".join([".."] * depth)

    title = text_of(cfg, lang, "title")
    author = text_of(cfg, lang, "author", text_of(site, lang, "name"))
    cover = s["cover"]
    base = f"{prefix}video/{s['slug']}/{s['slug']}"

    # 顺序有讲究：浏览器挑**第一个它放得动的** source。
    # AV1/WebM 只有 6.6 MB，放在前面；H.264/MP4 15.2 MB，兜底。
    sources = "\n".join([
        f'        <source src="{base}.webm" type="video/webm; codecs=av01.0.05M.08">',
        f'        <source src="{base}.mp4" type="video/mp4">',
    ])

    # 奖项名很长（「National Outstanding Honor · Public Service Announcement · HOSA 2026」），
    # 而 .masthead__meta span 是 nowrap —— 整串塞进一个 span 会在手机上撑出
    # 216px 的横向溢出（实测）。按分隔点拆开：每段仍然不折，段与段之间可以换行，
    # 中间那个「·」由 CSS 的 ::after 补回来，读起来跟原来一模一样。
    award = [x.strip() for x in text_of(cfg, lang, "award").split("·") if x.strip()]
    meta = " ".join(
        f"<span>{esc(x)}</span>" for x in (
            fmt_duration(s["duration"], lang),
            *award,
            format_span(s, lang),
        ) if x
    )

    body = render(
        (TEMPLATES / "film.html").read_text(encoding="utf-8"),
        title=esc(title),
        eyebrow=esc(eyebrow_for(s, lang)),
        year=esc(str(text_of(cfg, lang, "year"))),
        statement=paragraphs(text_of(cfg, lang, "statement")),
        meta=meta,
        aspect=f"{s['aspect']:.4f}",
        poster=f"{prefix}{cover.variants['jpg'][-1][1]}",
        sources=sources,
        no_video=esc(L["no_video"]),
        download_video=esc(L["download_video"]),
        video_href=f"{base}.mp4",
        colophon=esc(text_of(cfg, lang, "colophon")),
        author=esc(author),
        scroll=esc(L["scroll"]),
        skip=esc(L["skip_film"]),
        switch_href=switch_href(lang, s["slug"]),
        switch_label=esc(L["switch_label"]),
        switch_title=esc(L["switch_title"]),
        **nextup_values(s, nxt, lang, root),
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
    # 封面的 sizes：必须跟 style.css 里 .work 的宽度算法逐字对上，
    # 浏览器全靠它决定下哪一档分辨率（见文件顶部 MAX_VH 那段的同款警告）。
    #
    # ⚠️ 原来写的是 min(100%, …vh)。`100%` 在 sizes 里不是合法值——
    #    整条属性会被丢掉、回退成 100vw，于是 1440×900 @2x 上一张只显示
    #    266px 宽的封面下了 3200px 的图。sizes 里只能用长度，不能用百分比。
    #
    #   > 900px  并排：宽度 = 宽高比 × --cover-h（clamp(300px, 24vw + 54px, 400px)）
    #   ≤ 900px  堆叠：宽度 = min(容器宽, 52vh × 宽高比)，容器宽 = 100vw 减左右留白
    sizes = (
        f"(max-width: {INDEX_STACK_PX}px)"
        f" min(100vw - 3rem, {INDEX_STACK_VH * cover.aspect:.0f}vh),"
        f" calc({cover.aspect:.4f} * {INDEX_COVER_H})"
    )
    # 每段各自成块，段与段之间留一个空格。
    # 那个空格不是排版失误，是**唯一的断行机会**——每个 span 都是 nowrap，
    # 中间不留空白的话整行没法折断，窄栏里会直接撑破容器。
    # 目录页只写「张数 · 时间」，不写城市：三组都在北京，重复三遍不提供任何新信息，
    # 却会把窄栏的说明挤成两行、底边参差。城市在各自的系列页里仍然写着。
    detail = " ".join(
        f"<span>{esc(x)}</span>" for x in detail_bits(s, lang) if x
    )
    eyebrow = eyebrow_for(s, lang)
    year = str(text_of(cfg, lang, "year"))

    return f"""
      <li class="work{' work--film' if s['kind'] == 'film' else ''}" style="--ar: {cover.aspect:.4f}">
        <a class="work__link" href="./{s['slug']}/">
          <span class="work__frame"
                style="background-image: url(data:image/jpeg;base64,{cover.lqip})">
            <picture>
{picture_sources(cover, prefix, sizes, " " * 14)}
              <img src="{prefix}{cover.variants['jpg'][-1][1]}"
                   srcset="{srcset(cover.variants['jpg'], prefix)}" sizes="{sizes}"
                   width="{cover.width}" height="{cover.height}"
                   alt="{esc(cover.alt)}" loading="lazy" decoding="async">
            </picture>
          </span>
          <span class="work__meta">
            <span class="work__eyebrow">{esc(eyebrow)}{' · ' + esc(year) if year else ''}</span>
            <span class="work__title">{esc(text_of(cfg, lang, 'title'))}</span>
            <span class="work__detail">{detail}</span>
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

    # 影片不算进「N 组 · M 张」——它既不是一组照片，里面也没有"张"。
    # 有影片时在后面单列一项，没有就整条不出现。
    photo_sets = [s for s in ordered if s["kind"] == "series"]
    films = [s for s in ordered if s["kind"] == "film"]
    meta = " ".join(
        f"<span>{esc(x)}</span>" for x in (
            f"{len(photo_sets)} {L['series_count']}",
            f"{sum(s['count'] for s in photo_sets)} {L['photographs']}",
            # 英文要区分单复数：1 film / 2 films。中文两者相同。
            f"{len(films)} {L['films_count' if len(films) > 1 else 'film_count']}" if films else "",
        ) if x
    )

    body = render(
        (TEMPLATES / "index.html").read_text(encoding="utf-8"),
        name=esc(name),
        home_eyebrow=esc(L["home_eyebrow"]),
        intro=paragraphs(text_of(site, lang, "intro")),
        works="\n".join(work_card(s, lang, prefix) for s in ordered),
        meta=meta,
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
        description=esc(
            text_of(site, lang, "description").replace("{years}", year_span(series, lang))
        ),
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
        # toml 里写 kind = "film" 的是影片，其余都按照片系列处理
        builder = build_film if cfg.get("kind") == "film" else build_series
        built.append(builder(cfg, args.force))

    # 「下一组」按 order 首尾相接。slug 参与排序只是为了 order 撞车时结果稳定，
    # 不然两次构建可能给出不同的顺序。
    chain = sorted(built, key=lambda s: (s["order"], s["slug"]))
    next_of = {s["slug"]: chain[(i + 1) % len(chain)] for i, s in enumerate(chain)}

    # 编号只数照片系列。影片排在最前面（order 0），但它不是「第一组照片」——
    # 七组照片仍然是 Series 01–07，影片那行写「Film / 影片」。
    n = 0
    for s in chain:
        if s["kind"] == "series":
            n += 1
            s["number"] = n
        else:
            s["number"] = None

    # 图片只生成一次，页面按语言各渲染一遍
    for lang in LANGS:
        for s in built:
            render = render_film if s["kind"] == "film" else render_series
            render(s, lang, site, next_of[s["slug"]])
        write_index(built, site, lang)

    copy_static()
    WORK.exists() and shutil.rmtree(WORK, ignore_errors=True)

    print("\n构建完成：")
    warnings = []
    for b in built:
        cfg = b["cfg"]
        what = (f"{b['duration']:.1f} 秒影片" if b["kind"] == "film"
                else f"{b['count']} 张")
        print(f"  {text_of(cfg, 'en', 'title')}: {what}，"
              f"共 {b['bytes'] / 1e6:.1f} MB，封面 {b['cover'].stem}")
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
    n_series = sum(1 for b in built if b["kind"] == "series")
    n_films = len(built) - n_series
    tail = f" + {n_films} 部影片" if n_films else ""
    print(f"  共 {n_series} 个系列 {sum(b['count'] for b in built)} 张{tail}")
    for w in warnings:
        print(f"  ⚠ {w}")
    print(f"  产物目录：{DIST}")

    if args.serve:
        os.chdir(DIST)
        print(f"\n预览地址： http://localhost:{args.port}/   （Ctrl+C 停止）")
        subprocess.run([sys.executable, "-m", "http.server", str(args.port)])


if __name__ == "__main__":
    main()
