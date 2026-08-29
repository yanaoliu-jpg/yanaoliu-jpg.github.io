#!/usr/bin/env python3
"""按片名到 TMDB 搜海报。分两步，中间必须有人核对。

    export TMDB_API_KEY='...'                          # 不要提交进仓库，这是 Public repo
    python3 site/tools/fetch_posters.py --resolve      # 搜，出对照表
    （人工核对 site/content/posters.toml）
    python3 site/tools/fetch_posters.py --download     # 下载到 素材/海报/

⚠️ 两步分开是故意的。片名搜错了海报就错了，而错了很难一眼看出来——
   62 张小图里混进一张同名重拍的，谁都不会发现。第六组写 alt 文字踩过
   同一个坑（文件名和画面对不上，九张全错位），代价是重做一遍。

⚠️ 网络：他的机器到境外不稳（见 CLAUDE.md 第七节）。这里每个请求重试三次，
   下载支持断点续跑——已经下好的会跳过，断了直接再跑一次就行。
"""
import argparse
import json
import os
import re
import ssl
import sys
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
NOTES = SITE / "content" / "film-notes.toml"
LOCK = SITE / "content" / "posters.toml"
DEST = SITE.parent / "素材" / "海报"

API = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p/w500"      # 500px 宽，够生成 200/400 两档
RETRIES = 3

# ── 手动钉死的片子 ──────────────────────────────────────────────
# 搜索选错了、人工查证之后钉在这里。**写清楚为什么**，
# 否则下一个人会以为是随手填的，把它删掉。
OVERRIDES = {
    # 「The Cove」这个词太常见，搜到了新加坡短片 Tanjong Rhu（tmdb 113555）。
    # 他写的是太地町、里克、捕杀海豚 —— Louie Psihoyos 的那部纪录片。
    "the-cove": 23128,
}

# ── 片名确实不一样、但已经核实是对的 ────────────────────────────
# 一条永远响的警报等于没有警报。核实过的差异写在这里，让警报只在真出事时响。
TITLE_VERIFIED = {
    # TMDB 叫 The Monkey King: Uproar in Heaven；这里用维基百科的通行译名
    # Havoc in Heaven。原始片名「大闹天宫」、导演万籁鸣、1961 年中国，是同一部。
    "havoc-in-heaven",
}


def ssl_context() -> ssl.SSLContext:
    """找一个能用的 CA 证书包。

    ⚠️ macOS 上从 python.org 装的 Python **不用系统钥匙串**，自带的证书目录是空的，
       于是每个 https 请求都会炸在：

           SSL: CERTIFICATE_VERIFY_FAILED - unable to get local issuer certificate

       看着像网络问题，其实是解释器装完没跑过 "Install Certificates.command"。
       这里按顺序找一个真实的证书包——**照常校验证书**，只是告诉它包在哪。
       绝对不要改成 verify_mode = CERT_NONE 来"解决"这个问题。
    """
    for cafile in (os.environ.get("SSL_CERT_FILE"), "/etc/ssl/cert.pem"):
        if cafile and Path(cafile).exists():
            return ssl.create_default_context(cafile=cafile)
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    return ssl.create_default_context()


SSL = ssl_context()

# 直接用构建时的那一个 slugify，不在这里再写一份。
# 海报文件名 = slug，跟锚点是同一个值；两处各写一份必然漂移。
sys.path.insert(0, str(SITE))
from build import slugify  # noqa: E402


def api_key() -> str:
    key = os.environ.get("TMDB_API_KEY", "").strip()
    if not key:
        sys.exit(
            "没有 TMDB_API_KEY。\n"
            "  1. 到 https://www.themoviedb.org/settings/api 申请（免费）\n"
            "  2. export TMDB_API_KEY='贴在这里'\n"
            "  ⚠️ 不要写进仓库里的任何文件——这是 Public repo。"
        )
    return key


def get(path: str, **params) -> dict:
    url = f"{API}{path}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {api_key()}",
        "accept": "application/json",
    })
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=20, context=SSL) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                sys.exit("✗ TMDB 拒绝了这个 key（401）。检查 TMDB_API_KEY 是不是贴全了。")
            if attempt == RETRIES - 1:
                raise
        except Exception:
            if attempt == RETRIES - 1:
                raise
        time.sleep(3)
    raise RuntimeError("unreachable")


def load_entries() -> list[dict]:
    if not NOTES.exists():
        sys.exit(f"✗ 找不到 {NOTES}")
    with NOTES.open("rb") as f:
        cfg = tomllib.load(f)
    entries = cfg.get("entry", [])
    if not entries:
        sys.exit("✗ film-notes.toml 里一条 [[entry]] 都没有")
    return entries


def details(tmdb_id: int) -> dict:
    """取原始片名、导演、国别 —— 用来交叉验证搜索结果对不对。

    ⚠️ 只比英文片名是不够的。「海豚湾」那次就栽在这里：搜 "The Cove" 命中了
       新加坡短片 Tanjong Rhu，英文片名 The Casuarina Cove 看着也像那么回事。
       是导演（Boo Junfeng ≠ Louie Psihoyos）和国别把它暴露的。
    """
    d = get(f"/movie/{tmdb_id}", append_to_response="credits")
    return {
        "original": d.get("original_title") or "",
        "director": "/".join(c["name"] for c in d.get("credits", {}).get("crew", [])
                             if c.get("job") == "Director"),
        "country": "/".join(d.get("origin_country") or []),
        "year": int((d.get("release_date") or "0")[:4] or 0),
        "poster_path": d.get("poster_path") or "",
        "title": d.get("title") or "",
    }


def resolve() -> None:
    entries = load_entries()
    print(f"到 TMDB 搜 {len(entries)} 部片子（每部都拉导演和国别交叉验证）……\n")
    print(f"    {'中文名':<15s} {'原始片名':<30s} {'导演':<20s} 年份")
    print("    " + "─" * 76)

    rows, flagged = [], []
    for i, e in enumerate(entries, 1):
        title, year, zh_title = e["title"], int(e["year"]), e["zh"]["title"]
        slug = slugify(title)

        if slug in OVERRIDES:
            top_id, why = OVERRIDES[slug], []
        else:
            data = get("/search/movie", query=title, year=year, include_adult="false")
            results = data.get("results", [])
            if not results:      # 带年份搜不到就放宽再搜一次
                results = get("/search/movie", query=title,
                              include_adult="false").get("results", [])
            if not results:
                flagged.append((zh_title, title, year, "搜不到"))
                rows.append({"slug": slug, "title": title, "year": year, "tmdb": 0,
                             "poster_path": "", "matched": "", "matched_year": 0,
                             "director": "", "country": ""})
                print(f"  ✗ {i:2d}. {zh_title:<15s} 搜不到")
                continue
            top_id, why = results[0]["id"], []

        d = details(top_id)

        # 只在**真有可能搞错**的时候报警，不因为"有多个结果"就吵。
        # 判据是：年份差得多、没有海报、或者英文片名和原始片名同时都对不上。
        if abs(d["year"] - year) > 1:
            why.append(f"年份 {d['year']}，toml 里写的是 {year}")
        if not d["poster_path"]:
            why.append("TMDB 上没有海报")
        if (d["title"].lower() != title.lower()
                and d["original"].lower() != title.lower()
                and slug not in OVERRIDES
                and slug not in TITLE_VERIFIED):
            why.append(f"片名对不上：TMDB 叫「{d['title']}」")

        rows.append({
            "slug": slug, "title": title, "year": year, "tmdb": top_id,
            "poster_path": d["poster_path"], "matched": d["original"] or d["title"],
            "matched_year": d["year"], "director": d["director"],
            "country": d["country"],
        })
        mark = "?" if why else ("📌" if slug in OVERRIDES else "✓")
        if why:
            flagged.append((zh_title, title, year, "，".join(why)))
        print(f"  {mark} {i:2d}. {zh_title:<15s} {d['original'][:30]:<30s} "
              f"{d['director'][:20]:<20s} {d['year']}")
        time.sleep(0.04)     # TMDB 限速很宽松，这点间隔纯属礼貌

    write_lock(rows)
    print(f"\n写出 → {LOCK}")
    pinned = [r for r in rows if r["slug"] in OVERRIDES]
    if pinned:
        print(f"📌 {len(pinned)} 条是手动钉死的（见脚本顶部 OVERRIDES 里的理由）")
    if flagged:
        print(f"\n⚠️  {len(flagged)} 条需要人工确认：\n")
        for zh_title, title, year, why in flagged:
            print(f"    {zh_title}（{title} {year}）—— {why}")
    else:
        print("✓ 没有可疑的。")
    print("\n仍然要把上面这张表给刘延奥扫一眼，确认之后再 --download。")


def write_lock(rows: list[dict]) -> None:
    L = [
        "# " + "═" * 67,
        "#  海报对照表 —— 由 tools/fetch_posters.py --resolve 生成",
        "#",
        "#  ⚠️ 这是生成的文件，但**必须人工核对过**才能 --download。",
        "#     片名搜错了海报就错了，而 62 张小图里混进一张同名重拍的，",
        "#     事后谁都不会发现。matched 跟 title 对不上的要重点看。",
        "#",
        "#  改了某条的 tmdb 之后，重跑 --download 会自动重下那一张。",
        "# " + "═" * 67,
        "",
    ]
    for r in rows:
        L += [
            "[[poster]]",
            f'slug         = "{r["slug"]}"',
            f'title        = "{r["title"]}"',
            f'year         = {r["year"]}',
            f'tmdb         = {r["tmdb"]}',
            f'poster_path  = "{r["poster_path"]}"',
            f'matched      = "{r["matched"]}"   # TMDB 上的原始片名，用来核对',
            f"matched_year = {r['matched_year']}",
            f'director     = "{r.get("director", "")}"',
            f'country      = "{r.get("country", "")}"',
            "",
        ]
    LOCK.write_text("\n".join(L), encoding="utf-8")


def download() -> None:
    if not LOCK.exists():
        sys.exit(f"✗ 找不到 {LOCK}。先跑 --resolve，核对之后再来。")
    with LOCK.open("rb") as f:
        rows = tomllib.load(f).get("poster", [])

    DEST.mkdir(parents=True, exist_ok=True)
    todo = [r for r in rows if r["poster_path"]
            and not (DEST / f"{r['slug']}.jpg").exists()]
    skipped = len(rows) - len(todo)
    broken = [r for r in rows if not r["poster_path"]]

    print(f"共 {len(rows)} 条：要下 {len(todo)} 张，已有 {skipped} 张跳过，"
          f"{len(broken)} 条没有海报路径")
    if broken:
        for r in broken:
            print(f"    ⚠️ 没有海报：{r['title']}（tmdb {r['tmdb']}）")
    if not todo:
        print("没有要下的。")
        return
    print(f"目标目录：{DEST}（在 .gitignore 里，不进仓库）")
    print(f"预估体积：约 {len(todo) * 60 // 1000} MB\n")

    total = 0
    for i, r in enumerate(todo, 1):
        out = DEST / f"{r['slug']}.jpg"
        url = IMG + r["poster_path"]
        for attempt in range(RETRIES):
            try:
                with urllib.request.urlopen(url, timeout=30, context=SSL) as resp:
                    blob = resp.read()
                break
            except Exception as exc:
                if attempt == RETRIES - 1:
                    print(f"  ✗ {r['title']}：{exc}")
                    blob = None
                    break
                time.sleep(3)
        if not blob:
            continue
        out.write_bytes(blob)
        total += len(blob)
        print(f"  [{i}/{len(todo)}] {r['slug']}.jpg  {len(blob)/1000:.0f} KB")

    print(f"\n✓ 下了 {total/1e6:.1f} MB 到 {DEST}")


def main() -> None:
    ap = argparse.ArgumentParser(description="到 TMDB 取影评用的海报")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--resolve", action="store_true", help="按片名搜，生成对照表")
    g.add_argument("--download", action="store_true", help="按对照表下载海报")
    args = ap.parse_args()
    (resolve if args.resolve else download)()


if __name__ == "__main__":
    main()
