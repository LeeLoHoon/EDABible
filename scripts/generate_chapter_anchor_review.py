#!/usr/bin/env python3
"""Generate chapter-start review files for OCR rebuild.

The app JSON rebuild cannot be trusted until every chapter start is anchored to
the scanned OCR text. This script creates review batches with candidate page
locations for missing/uncertain chapter anchors.
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

try:
    from rapidfuzz import fuzz
except ModuleNotFoundError as exc:
    raise SystemExit("Install rapidfuzz in the active Python environment.") from exc


ROOT = Path("/home/easy/git/EDABible")
PUBLIC = ROOT / "public/bible"
APPLIED = Path("/home/easy/bible/new/applied_body")
CROPS = Path("/home/easy/bible/new/crops")
OUT = ROOT / "reports/chapter-anchors"

BUILD_SCRIPT = ROOT / "scripts/build_public_bible_from_applied_ocr.py"
spec = importlib.util.spec_from_file_location("build_public", BUILD_SCRIPT)
build_public = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(build_public)


def compact(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", text)


def normalize(text: str) -> str:
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def load_pages(pdf: str) -> list[dict]:
    pages = []
    offset = 0
    compact_offset = 0
    for path in sorted((APPLIED / pdf).glob("p*.txt")):
        page = int(path.stem[1:])
        raw_lines = path.read_text(encoding="utf-8").splitlines()
        lines = []
        for raw in raw_lines:
            line = normalize(raw)
            if not line:
                continue
            line_compact = compact(line)
            if not line_compact:
                continue
            lines.append(
                {
                    "text": line,
                    "compact": line_compact,
                    "page": page,
                    "charStart": offset,
                    "compactStart": compact_offset,
                }
            )
            offset += len(line) + 1
            compact_offset += len(line_compact)
        pages.append({"page": page, "lines": lines})
    return pages


def load_dropcaps(pdf: str) -> dict[int, list[dict]]:
    drops: dict[int, list[dict]] = {}
    ocr_dir = Path("/home/easy/bible/new/ocr_paddle") / pdf
    for path in sorted(ocr_dir.glob("p*.json")):
        page = int(path.stem[1:])
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for item in items:
            text = normalize(item.get("text", ""))
            if not re.fullmatch(r"\d{1,3}", text):
                continue
            box = item.get("box") or []
            if not isinstance(box, list) or len(box) < 4:
                continue
            try:
                x1, y1, x2, y2 = [float(value) for value in box[:4]]
            except (TypeError, ValueError):
                continue
            height = y2 - y1
            width = x2 - x1
            confidence = float(item.get("confidence", 0.0))
            value = int(text)
            if height < 52 or width < 24 or confidence < 0.65:
                continue
            drops.setdefault(value, []).append(
                {
                    "page": page,
                    "q": int(item.get("q", 0)),
                    "text": text,
                    "confidence": round(confidence, 4),
                    "box": [round(x1), round(y1), round(x2), round(y2)],
                    "image": str(CROPS / pdf / f"p{page:04d}_q{int(item.get('q', 0))}.png"),
                }
            )
    return drops


def flatten_pages(pages: list[dict]) -> tuple[list[dict], str]:
    lines = []
    source_compact = []
    for page in pages:
        for line in page["lines"]:
            lines.append(line)
            source_compact.append(line["compact"])
    return lines, "".join(source_compact)


def line_for_compact_pos(lines: list[dict], pos: int) -> dict:
    current = lines[0] if lines else {}
    for line in lines:
        if line["compactStart"] <= pos:
            current = line
        else:
            break
    return current


def candidate_positions(anchor: str, lines: list[dict], source_compact: str, limit: int = 5) -> list[dict]:
    needle = anchor[: min(30, len(anchor))]
    if len(needle) < 10:
        return []
    exacts = []
    start = 0
    while True:
        pos = source_compact.find(needle[: max(12, min(22, len(needle)))], start)
        if pos < 0:
            break
        line = line_for_compact_pos(lines, pos)
        exacts.append({"score": 1.0, "position": pos, "line": line})
        start = pos + 1
        if len(exacts) >= limit:
            return exacts

    window = len(needle) + 10
    scored = []
    step = 4
    for pos in range(0, max(1, len(source_compact) - window), step):
        score = fuzz.ratio(needle, source_compact[pos : pos + window]) / 100
        if score >= 0.72:
            line = line_for_compact_pos(lines, pos)
            scored.append({"score": round(score, 4), "position": pos, "line": line})
    scored.sort(key=lambda item: item["score"], reverse=True)
    dedup = []
    seen = set()
    for item in scored:
        key = (item["line"].get("page"), item["line"].get("compactStart"))
        if key in seen:
            continue
        seen.add(key)
        dedup.append(item)
        if len(dedup) >= limit:
            break
    return dedup


def chapter_anchor(text: str) -> str:
    return build_public.chapter_anchor(text)


def build_review() -> dict:
    index = json.loads((PUBLIC / "index.json").read_text(encoding="utf-8"))
    by_pdf = {pdf: flatten_pages(load_pages(pdf)) for pdf in "abcde"}
    dropcaps = {pdf: load_dropcaps(pdf) for pdf in "abcde"}
    report = {"books": []}

    for entry in index:
        pdf = build_public.BOOK_TO_PDF[entry["book"]]
        lines, source_compact = by_pdf[pdf]
        current_doc = json.loads((PUBLIC / entry["file"]).read_text(encoding="utf-8"))
        chapters = []
        for chapter in current_doc["chapters"]:
            anchor = chapter_anchor(chapter["text"])
            candidates = candidate_positions(anchor, lines, source_compact)
            candidate_pages = {candidate["line"].get("page") for candidate in candidates if candidate["line"].get("page")}
            layout_candidates = dropcaps[pdf].get(int(chapter["chapter"]), [])
            if candidate_pages:
                layout_candidates = [
                    item for item in layout_candidates if any(abs(item["page"] - page) <= 4 for page in candidate_pages)
                ] or dropcaps[pdf].get(int(chapter["chapter"]), [])[:8]
            else:
                layout_candidates = layout_candidates[:8]
            chapters.append(
                {
                    "chapter": chapter["chapter"],
                    "anchor": anchor,
                    "layoutCandidates": layout_candidates[:8],
                    "candidates": [
                        {
                            "score": candidate["score"],
                            "page": candidate["line"].get("page"),
                            "line": candidate["line"].get("text"),
                            "crops": [
                                str(CROPS / pdf / f"p{int(candidate['line'].get('page')):04d}_q{q}.png")
                                for q in range(1, 5)
                                if candidate["line"].get("page")
                            ],
                        }
                        for candidate in candidates
                    ],
                    "confirm": None,
                }
            )
        report["books"].append({"book": entry["book"], "pdf": pdf, "file": entry["file"], "chapters": chapters})
    return report


def write_markdown(report: dict) -> None:
    for old in OUT.glob("*-chapter-anchor-review.md"):
        old.unlink()
    for book in report["books"]:
        unresolved = [
            chapter
            for chapter in book["chapters"]
            if not chapter["candidates"] or chapter["candidates"][0]["score"] < 0.92
        ]
        if not unresolved:
            continue
        rows = [f"# {book['book']} Chapter Anchor Review", ""]
        rows.append("Fill `confirm:` with `page=<n>` when the correct candidate is visible.")
        rows.append("")
        for chapter in unresolved:
            rows.append(f"## {book['book']} {chapter['chapter']}장")
            rows.append(f"- anchor: `{chapter['anchor'][:80]}`")
            if chapter.get("layoutCandidates"):
                rows.append("- layout candidates:")
                for idx, candidate in enumerate(chapter["layoutCandidates"], start=1):
                    rows.append(
                        f"  - L{idx}: page `p{candidate['page']:04d}` q`{candidate['q']}` "
                        f"conf `{candidate['confidence']}` box `{candidate['box']}`"
                    )
                    rows.append(f"    - image: `{candidate['image']}`")
            for idx, candidate in enumerate(chapter["candidates"], start=1):
                rows.append(f"- candidate {idx}: score `{candidate['score']}` page `p{candidate['page']:04d}`")
                rows.append(f"  - line: `{candidate['line']}`")
                for crop in candidate["crops"]:
                    rows.append(f"  - image: `{crop}`")
            if not chapter["candidates"]:
                rows.append("- candidate: none")
            rows.append("- confirm:")
            rows.append("")
        path = OUT / f"{book['pdf']}-{book['file'].removesuffix('.json')}-chapter-anchor-review.md"
        path.write_text("\n".join(rows), encoding="utf-8")


def write_draft_map(report: dict) -> None:
    draft = {}
    for book in report["books"]:
        draft[book["book"]] = {}
        for chapter in book["chapters"]:
            best = chapter["candidates"][0] if chapter["candidates"] else None
            layout = chapter.get("layoutCandidates", [])
            best_layout = layout[0] if layout else None
            draft[book["book"]][str(chapter["chapter"])] = {
                "page": best_layout["page"] if best_layout else (best["page"] if best and best["score"] >= 0.92 else None),
                "q": best_layout["q"] if best_layout else None,
                "score": best["score"] if best else None,
                "anchor": chapter["anchor"],
                "confirmed": False,
            }
    (OUT / "chapter_map.draft.json").write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report = build_review()
    (OUT / "chapter_anchor_candidates.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_markdown(report)
    write_draft_map(report)
    unresolved = sum(
        1
        for book in report["books"]
        for chapter in book["chapters"]
        if not chapter["candidates"] or chapter["candidates"][0]["score"] < 0.92
    )
    total = sum(len(book["chapters"]) for book in report["books"])
    print(json.dumps({"totalChapters": total, "needsReview": unresolved}, ensure_ascii=False))
    print(f"Wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
