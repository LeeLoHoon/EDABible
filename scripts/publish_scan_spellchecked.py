#!/usr/bin/env python3
"""Publish scan spellchecked draft into app public data.

Inputs:
- /home/easy/bible/new/scan_rebuild_spellchecked/chapters/*.json
- reports/scan-spellcheck/summary.json

Outputs:
- public/bible/*.json
- public/review/scan-review.json
- public/review/crops/*.png
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path


ROOT = Path("/home/easy/git/EDABible")
PUBLIC_BIBLE = ROOT / "public/bible"
PUBLIC_REVIEW = ROOT / "public/review"
SPELLCHECKED = Path("/home/easy/bible/new/scan_rebuild_spellchecked/chapters")
SUMMARY = ROOT / "reports/scan-spellcheck/summary.json"

AUTO_REASONS = {"auto-repaired", "editorial-heading-omitted", "near-duplicate-omitted"}


def compact(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", text)


def manual_item(item: dict) -> bool:
    return not set(item.get("reasons", [])).issubset(AUTO_REASONS)


def publish_bible() -> dict:
    index = json.loads((PUBLIC_BIBLE / "index.json").read_text(encoding="utf-8"))
    published = []
    short = []
    missing = []
    for entry in index:
        source = SPELLCHECKED / f"{entry['book']}.json"
        if not source.exists():
            missing.append(entry["book"])
            continue
        data = json.loads(source.read_text(encoding="utf-8"))
        chapters_by_number = data.get("chapters", {})
        chapters = []
        for chapter_no in range(1, int(entry["standardChapters"]) + 1):
            row = chapters_by_number.get(str(chapter_no))
            if not row:
                missing.append(f"{entry['book']} {chapter_no}")
                continue
            text = row.get("text", "").strip()
            if len(compact(text)) < 40:
                short.append(f"{entry['book']} {chapter_no}")
            chapters.append({"chapter": chapter_no, "text": text})
        doc = {
            "order": entry["order"],
            "book": entry["book"],
            "abbr": entry["abbr"],
            "chapters": chapters,
        }
        (PUBLIC_BIBLE / entry["file"]).write_text(
            json.dumps(doc, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8",
        )
        entry["chapters"] = len(chapters)
        published.append(entry["book"])
    (PUBLIC_BIBLE / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    return {"published": len(published), "missing": missing, "short": short}


def publish_review() -> dict:
    data = json.loads(SUMMARY.read_text(encoding="utf-8"))
    PUBLIC_REVIEW.mkdir(parents=True, exist_ok=True)
    crop_dir = PUBLIC_REVIEW / "crops"
    if crop_dir.exists():
        shutil.rmtree(crop_dir)
    crop_dir.mkdir(parents=True, exist_ok=True)

    items = []
    copied = 0
    for item in data["items"]:
        if not manual_item(item):
            continue
        next_item = {
            "id": f"{len(items) + 1:04d}",
            "book": item["book"],
            "chapter": int(item["chapter"]),
            "line": int(item["line"]),
            "reasons": item.get("reasons", []),
            "before": item.get("before", ""),
            "original": item.get("original", ""),
            "suggested": item.get("suggested", ""),
            "after": item.get("after", ""),
            "source": item.get("source"),
            "image": "",
        }
        source = item.get("source") or {}
        image = source.get("image")
        if image and Path(image).exists():
            target_name = f"{next_item['id']}_{Path(image).name}"
            shutil.copy2(image, crop_dir / target_name)
            next_item["image"] = f"review/crops/{target_name}"
            copied += 1
        items.append(next_item)

    review = {
        "generatedFrom": str(SUMMARY),
        "total": len(items),
        "copiedImages": copied,
        "items": items,
    }
    (PUBLIC_REVIEW / "scan-review.json").write_text(
        json.dumps(review, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {"reviewItems": len(items), "copiedImages": copied}


def main() -> int:
    result = {"bible": publish_bible(), "review": publish_review()}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["bible"]["missing"] or result["bible"]["short"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
