#!/usr/bin/env python3
"""校验 film-notes.toml —— 跑在构建之前，把内容问题挡在生成之前。

跟 check_font.py 一个路数：不联网，退出码表示成败。

    python3 site/tools/check_notes.py            # 中英都查
    python3 site/tools/check_notes.py --zh-only  # 英文还没译完时用
"""
import argparse
import sys
import tomllib
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
NOTES = SITE / "content" / "film-notes.toml"
EXPECTED = 62

# 直接用构建时的那一个 slugify，不在这里再写一份。
# 写两份必然漂移——这两处曾经真的不一致过（一份 [^a-z0-9]、一份 [^\w\-] + UNICODE），
# 差别要到某个带重音的片名出现时才会暴露。
sys.path.insert(0, str(SITE))
from build import slugify  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="校验 film-notes.toml")
    ap.add_argument("--zh-only", action="store_true",
                    help="只查中文（英文翻译还没做完时用）")
    args = ap.parse_args()

    if not NOTES.exists():
        sys.exit(f"✗ 找不到 {NOTES}")

    with NOTES.open("rb") as f:
        cfg = tomllib.load(f)

    entries = cfg.get("entry", [])
    bad: list[str] = []

    if len(entries) != EXPECTED:
        bad.append(f"应该有 {EXPECTED} 条，实际 {len(entries)} 条")

    for key in ("statement",):
        if not cfg.get(key):
            bad.append(f"缺英文 {key}")
        if not cfg.get("zh", {}).get(key):
            bad.append(f"缺中文 zh.{key}")

    seen: dict[str, int] = {}
    for i, e in enumerate(entries, 1):
        zh = e.get("zh", {})
        name = zh.get("title") or e.get("title") or "?"
        tag = f"第 {i} 条（{name}）"

        for key in ("title", "year"):
            if not e.get(key):
                bad.append(f"{tag} 缺 {key}")
        if not zh.get("title"):
            bad.append(f"{tag} 缺 zh.title")
        if not zh.get("text"):
            bad.append(f"{tag} 缺 zh.text")
        if not args.zh_only and not e.get("text"):
            bad.append(f"{tag} 缺 text（英文）")

        # 占位符：全站统一用【】包起来，页面上会显示成橙色虚线框
        checks = [("zh.text", zh.get("text", ""))]
        if not args.zh_only:
            checks.append(("text", e.get("text", "")))
        for key, val in checks:
            if "【" in str(val):
                bad.append(f"{tag} 的 {key} 还是占位符")

        s = slugify(e.get("title", ""))
        if not s:
            bad.append(f"{tag} 的 title 生成不出 slug")
        elif s in seen:
            bad.append(f"slug 撞车「{s}」：第 {seen[s]} 条和第 {i} 条")
        else:
            seen[s] = i

    if bad:
        print(f"✗ {NOTES.name} 有 {len(bad)} 个问题：")
        for b in bad:
            print(f"    {b}")
        sys.exit(1)

    n_class = sum(1 for e in entries if e.get("note_kind") == "class")
    scope = "中文" if args.zh_only else "中英"
    print(f"✓ {len(entries)} 条{scope}齐全，slug 无撞车，课堂笔记 {n_class} 条")


if __name__ == "__main__":
    main()
