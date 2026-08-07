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
    iso: int | None
    aperture: float | None
    shutter: str | None
    focal: int | None
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
        return self.shot_at.strftime("%Y.%m.%d") if self.shot_at else ""

    @property
    def time_label(self) -> str:
        return self.shot_at.strftime("%H:%M") if self.shot_at else ""

    @property
    def datetime_attr(self) -> str:
        return self.shot_at.strftime("%Y-%m-%dT%H:%M") if self.shot_at else ""

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
    stamp = sub.get("DateTimeOriginal") or base.get("DateTime")
    if stamp:
        try:
            shot_at = datetime.strptime(str(stamp), "%Y:%m:%d %H:%M:%S")
        except ValueError:
            pass

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
            photo.variants[ext] = [
                (w, f"../img/{slug}/{photo.stem}-{w}.{ext}") for w in useful
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


def srcset(variants: list[tuple[int, str]]) -> str:
    return ", ".join(f"{url} {w}w" for w, url in variants)


def sizes_attr(photo: Photo) -> str:
    """跟 CSS 里 .plate__frame 的宽度算法保持一致，浏览器才能挑对尺寸。"""
    return f"min({MAX_VW}vw, {MAX_PX}px, {MAX_VH * photo.aspect:.0f}vh)"


def plate_html(photo: Photo, index: int, total: int) -> str:
    largest = photo.variants["jpg"][-1]
    return f"""
        <figure class="plate{' plate--portrait' if photo.is_portrait else ''}"
                id="plate-{index + 1}"
                style="--ar: {photo.aspect:.4f}">
          <button class="plate__open" type="button" data-index="{index}"
                  aria-label="放大查看第 {index + 1} 张，共 {total} 张">
            <span class="plate__frame"
                  style="background-image: url(data:image/jpeg;base64,{photo.lqip})">
              <picture>
                <source type="image/avif" srcset="{srcset(photo.variants['avif'])}"
                        sizes="{sizes_attr(photo)}">
                <source type="image/webp" srcset="{srcset(photo.variants['webp'])}"
                        sizes="{sizes_attr(photo)}">
                <img src="{largest[1]}" srcset="{srcset(photo.variants['jpg'])}"
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
            <span class="plate__num">{index + 1:02d}</span>
            <time datetime="{photo.datetime_attr}">{photo.date_label}<span
              class="plate__time"> · {photo.time_label}</span></time>
            <span class="plate__exif">{esc(photo.exif_label)}</span>
          </figcaption>
        </figure>"""


def photo_data(photos: list[Photo]) -> str:
    """给全屏浏览用的数据。手写 JSON，避免为一点点数据引入依赖。"""
    import json

    return json.dumps(
        [
            {
                "avif": srcset(p.variants["avif"]),
                "webp": srcset(p.variants["webp"]),
                "jpg": srcset(p.variants["jpg"]),
                "src": p.variants["jpg"][-1][1],
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

    total_bytes = build_images(photos, slug, force)

    plates = "\n".join(plate_html(p, i, len(photos)) for i, p in enumerate(photos))

    span = ""
    dated = [p.shot_at for p in photos if p.shot_at]
    if dated:
        lo, hi = min(dated), max(dated)
        span = (
            lo.strftime("%B %Y")
            if lo.strftime("%Y%m") == hi.strftime("%Y%m")
            else f"{lo.strftime('%B')} – {hi.strftime('%B %Y')}"
        )

    body = render(
        (TEMPLATES / "series.html").read_text(encoding="utf-8"),
        title=esc(cfg["title"]),
        eyebrow=esc(cfg.get("eyebrow", "")),
        year=esc(cfg.get("year", "")),
        statement=paragraphs(cfg.get("statement", "")),
        count=len(photos),
        span=esc(span),
        place=esc(cfg.get("place", "")),
        plates=plates,
        colophon=esc(cfg.get("colophon", "")),
        author=esc(cfg.get("author", "")),
        photo_data=photo_data(photos),
    )

    page = render(
        (TEMPLATES / "base.html").read_text(encoding="utf-8"),
        title=f"{esc(cfg['title'])} — {esc(cfg.get('author', 'Photographs'))}",
        description=esc(cfg.get("description", "")),
        root="..",
        body=body,
    )

    out = DIST / slug / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page, encoding="utf-8")

    return {"slug": slug, "title": cfg["title"], "count": len(photos),
            "bytes": total_bytes, "photos": photos}


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


def write_root_redirect(slug: str) -> None:
    """现在网站只有一个系列，根路径直接转到它。

    以后加了作品总目录，根路径换成目录页，而 /<slug>/ 这个网址不变——
    已经发出去给招生官的链接不会失效。
    """
    (DIST / "index.html").write_text(
        f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting…</title>
<meta http-equiv="refresh" content="0; url=./{slug}/">
<link rel="canonical" href="./{slug}/">
<meta name="robots" content="noindex">
</head>
<body><p><a href="./{slug}/">继续 →</a></p></body>
</html>
""",
        encoding="utf-8",
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="构建摄影作品集网站")
    ap.add_argument("--force", action="store_true", help="强制重新生成所有图片")
    ap.add_argument("--serve", action="store_true", help="构建完起本地服务器预览")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    require_tools()
    DIST.mkdir(parents=True, exist_ok=True)

    configs = sorted(CONTENT.glob("*.toml"))
    if not configs:
        sys.exit(f"{CONTENT} 里没有找到 .toml 文案文件")

    built = []
    for cfg_path in configs:
        with cfg_path.open("rb") as f:
            cfg = tomllib.load(f)
        built.append(build_series(cfg, args.force))

    copy_static()
    write_root_redirect(built[0]["slug"])
    WORK.exists() and shutil.rmtree(WORK, ignore_errors=True)

    print("\n构建完成：")
    for b in built:
        print(f"  {b['title']}: {b['count']} 张，图片共 {b['bytes'] / 1e6:.1f} MB")
    print(f"  产物目录：{DIST}")

    if args.serve:
        os.chdir(DIST)
        print(f"\n预览地址： http://localhost:{args.port}/   （Ctrl+C 停止）")
        subprocess.run([sys.executable, "-m", "http.server", str(args.port)])


if __name__ == "__main__":
    main()
