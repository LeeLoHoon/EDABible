#!/usr/bin/env python3
"""Rebuild Bible body structure from scan OCR coordinates.

This script starts from scanned-page OCR, not from the existing app body text.
It writes auditable intermediate files under /home/easy/bible/new/scan_rebuild:

- pages/<pdf>/pNNNN.json: classified OCR lines, including exclusions
- chapter_map.draft.json: chapter-start candidates from drop-cap layout
- chapter_anchor_review.md: compact review list for weak/missing anchors
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from PIL import Image


ROOT = Path("/home/easy/git/EDABible")
PUBLIC = ROOT / "public/bible"
SRC = Path("/home/easy/bible/new")
PADDLE = SRC / "ocr_paddle"
PNG = SRC / "png250"
CROPS = SRC / "crops"
OUT = SRC / "scan_rebuild"

PDF_BOOKS = {
    "a": ["창세기", "출애굽기", "레위기", "민수기", "신명기"],
    "d": ["여호수아", "사사기", "룻기", "사무엘상", "사무엘하", "열왕기상", "열왕기하", "역대상", "역대하", "에스라", "느헤미야", "에스더"],
    "b": ["욥기", "시편", "잠언", "전도서", "아가"],
    "c": ["이사야", "예레미야", "예레미야애가", "에스겔", "다니엘", "호세아", "요엘", "아모스", "오바댜", "요나", "미가", "나훔", "하박국", "스바냐", "학개", "스가랴", "말라기"],
    "e": ["마태복음", "마가복음", "누가복음", "요한복음", "사도행전", "로마서", "고린도전서", "고린도후서", "갈라디아서", "에베소서", "빌립보서", "골로새서", "데살로니가전서", "데살로니가후서", "디모데전서", "디모데후서", "디도서", "빌레몬서", "히브리서", "야고보서", "베드로전서", "베드로후서", "요한일서", "요한이서", "요한삼서", "유다서", "요한계시록"],
}

BOOK_TO_PDF = {book: pdf for pdf, books in PDF_BOOKS.items() for book in books}
BOOK_NAMES = sorted(BOOK_TO_PDF, key=len, reverse=True)
BOOK_RE = re.compile("|".join(map(re.escape, BOOK_NAMES)))
BOOK_ALIASES = {
    "룻기": ["룻기", "릇기", "롯기"],
    "욥기": ["욥기", "옵기", "읍기"],
}

MANUAL_ANCHORS = {
    ("사무엘상", 6): {"pdf": "d", "page": 108, "q": 2, "box": [118, 1125, 148, 1159]},
    ("시편", 111): {"pdf": "b", "page": 164, "q": 2, "box": [29, 1223, 59, 1264]},
    ("시편", 117): {"pdf": "b", "page": 168, "q": 1, "box": [22, 287, 52, 327]},
    ("잠언", 7): {"pdf": "b", "page": 216, "q": 2, "box": [100, 1125, 130, 1149]},
    ("미가", 6): {"pdf": "c", "page": 414, "q": 2, "box": [97, 1125, 127, 1157]},
}

CROP_BOXES = {
    1: (0.050, 0.020, 0.530, 0.575),
    2: (0.050, 0.515, 0.530, 0.960),
    3: (0.470, 0.020, 0.950, 0.575),
    4: (0.470, 0.515, 0.950, 0.960),
}

CHAPTER_COUNTS = {
    entry["book"]: int(entry["standardChapters"])
    for entry in json.loads((PUBLIC / "index.json").read_text(encoding="utf-8"))
}


def compact(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", text)


def normalize(text: str) -> str:
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def page_png(pdf: str, page: int) -> Path:
    return PNG / pdf / f"{pdf}-{page:03d}.png"


def global_box(pdf: str, page: int, q: int, box: list[float]) -> list[int]:
    with Image.open(page_png(pdf, page)) as im:
        width, height = im.size
    x0r, y0r, _, _ = CROP_BOXES[q]
    x0 = int(x0r * width)
    y0 = int(y0r * height)
    return [
        round(x0 + float(box[0])),
        round(y0 + float(box[1])),
        round(x0 + float(box[2])),
        round(y0 + float(box[3])),
    ]


def is_noise(text: str) -> bool:
    value = compact(text)
    if not value:
        return True
    if len(value) == 1 and not re.fullmatch(r"\d", value):
        return True
    if re.fullmatch(r"[0-9]{2,4}", value):
        return True
    if re.fullmatch(r"[A-Za-z0-9]{1,3}", value) and not re.fullmatch(r"\d{1,3}", value):
        return True
    return False


def is_note_heading(text: str) -> bool:
    value = normalize(text)
    if re.search(r"\(\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?(?:;\s*\d{1,3}:\d{1,3})*", value):
        return True
    if re.search(r"\([가-힣]{1,5}\s*\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?", value):
        return True
    if re.search(r"\([가-힣]{1,5}\s*\d{1,3}(?:[-–]\d{1,3})?$", value):
        return True
    if "묵상글" in value:
        return True
    return False


def note_exclusion_ranges(items: list[dict]) -> dict[int, list[tuple[int, int]]]:
    by_q: dict[int, list[dict]] = defaultdict(list)
    for item in sorted(items, key=reading_key):
        by_q[item["q"]].append(item)

    def note_range_from(q: int, start: int) -> tuple[int, int] | None:
        rows = [
            row
            for row in by_q.get(q, [])
            if row["box"][1] >= start - 24 and not is_noise(row["text"]) and not is_dropcap_item(row)
        ]
        if not rows:
            return None
        top = rows[0]["box"][1]
        bottom = rows[0]["box"][3]
        previous_bottom = bottom
        for row in rows[1:]:
            row_top = row["box"][1]
            if row_top - previous_bottom > 70:
                break
            bottom = max(bottom, row["box"][3])
            previous_bottom = row["box"][3]
        return top, bottom

    ranges: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for item in sorted(items, key=reading_key):
        if not is_note_heading(item["text"]):
            continue
        q = item["q"]
        top = item["box"][1]
        current = note_range_from(q, top)
        if current is not None:
            ranges[q].append(current)
        if q == 1:
            continuation = note_range_from(3, top)
            if continuation is not None:
                ranges[3].append(continuation)
        if q == 2:
            continuation = note_range_from(4, top)
            if continuation is not None:
                ranges[4].append(continuation)
        if q == 3:
            continuation = note_range_from(4, top)
            if continuation is not None:
                ranges[4].append(continuation)
    return ranges


def is_note_item(item: dict, ranges: dict[int, list[tuple[int, int]]]) -> bool:
    top = item["box"][1]
    bottom = item["box"][3]
    for start, end in ranges.get(item["q"], []):
        if top >= start - 24 and bottom <= end + 24:
            return True
    return False


def load_items(pdf: str, page: int) -> list[dict]:
    raw = json.loads((PADDLE / pdf / f"p{page:04d}.json").read_text(encoding="utf-8"))
    with Image.open(page_png(pdf, page)) as im:
        page_width, page_height = im.size
    out = []
    for item in raw:
        text = normalize(item.get("text", ""))
        box = item.get("box") or []
        q = int(item.get("q", 0))
        if q not in CROP_BOXES or len(box) < 4:
            continue
        gbox = global_box(pdf, page, q, box)
        out.append(
            {
                "q": q,
                "text": text,
                "confidence": round(float(item.get("confidence", 0.0)), 4),
                "box": gbox,
                "pageWidth": page_width,
                "pageHeight": page_height,
                "sourceBox": box,
            }
        )
    return out


def is_dropcap_item(item: dict) -> bool:
    text = item["text"]
    x1, y1, x2, y2 = item["box"]
    height = y2 - y1
    width = x2 - x1
    return re.fullmatch(r"\d{1,3}", compact(text)) is not None and height >= 50 and width >= 20 and item["confidence"] >= 0.60


def classify_item(item: dict, note_ranges: dict[int, list[tuple[int, int]]]) -> str:
    text = item["text"]
    x1, y1, x2, y2 = item["box"]
    height = y2 - y1
    width = x2 - x1
    page_height = item["pageHeight"]
    if y1 < int(0.075 * page_height):
        return "header"
    if is_dropcap_item(item):
        return "dropcap"
    if is_note_heading(text):
        return "note"
    if is_note_item(item, note_ranges):
        return "note"
    if is_noise(text):
        return "noise"
    return "body"


def reading_key(item: dict) -> tuple[int, int, int]:
    q_order = {1: 0, 2: 1, 3: 2, 4: 3}
    return (q_order.get(item["q"], 9), item["box"][1], item["box"][0])


def dedupe_body(items: list[dict]) -> list[dict]:
    out = []
    recent: list[str] = []
    for item in sorted(items, key=reading_key):
        if item["kind"] != "body":
            out.append(item)
            continue
        key = compact(item["text"])
        if key and key in recent:
            copy = dict(item)
            copy["kind"] = "duplicate"
            out.append(copy)
            continue
        recent.append(key)
        recent = recent[-18:]
        out.append(item)
    return out


def first_body_anchor(book_range: dict[str, int], page_docs: list[dict]) -> dict | None:
    for doc in page_docs:
        page = doc["page"]
        if not (book_range["startPage"] <= page <= book_range["endPage"]):
            continue
        for item in sorted(doc["items"], key=reading_key):
            if item["kind"] != "body":
                continue
            if not compact(item["text"]):
                continue
            box = item["box"]
            return {
                "page": page,
                "q": item["q"],
                "box": [max(0, box[0] - 120), box[1], max(0, box[0] - 90), box[3]],
                "raw": "synthetic-book-start",
                "confidence": 1.0,
                "image": str(CROPS / book_range["pdf"] / f"p{page:04d}_q{item['q']}.png"),
                "synthetic": True,
            }
    return None


def header_chapters(book: str, header: str) -> list[int]:
    def chapter_prefix(raw: str, minimum: int, maximum: int) -> int | None:
        best = None
        for end in range(1, min(3, len(raw)) + 1):
            value = int(raw[:end])
            if minimum <= value <= maximum:
                best = value
        return best

    for name in BOOK_ALIASES.get(book, [book]):
        pos = header.find(name)
        if pos < 0:
            continue
        tail = header[pos + len(name) :]
        match = re.match(r"\s*(\d{1,6})(?:[-–](\d{1,6}))?", tail)
        if not match:
            return []
        max_chapter = CHAPTER_COUNTS[book]
        start = chapter_prefix(match.group(1), 1, max_chapter)
        if start is None:
            return []
        end = chapter_prefix(match.group(2), start, max_chapter) if match.group(2) else start
        if end is None:
            end = start
        return [chapter for chapter in range(start, end + 1) if 1 <= chapter <= max_chapter]
    return []


def header_transition_anchor(book: str, chapter: int, book_range: dict[str, int], page_docs: list[dict]) -> dict | None:
    previous = chapter - 1
    for doc in page_docs:
        page = doc["page"]
        if not (book_range["startPage"] <= page <= book_range["endPage"]):
            continue
        chapters = header_chapters(book, doc["header"])
        if chapter not in chapters:
            continue
        if previous > 0 and previous not in chapters and min(chapters) != chapter:
            continue
        body_items = [item for item in sorted(doc["items"], key=reading_key) if item["kind"] == "body"]
        starters = [
            item
            for item in body_items
            if re.match(r"^1(?:[-–]\d{1,3})?(?=\D|$)", normalize(item["text"]))
            and (item["box"][2] - item["box"][0]) >= 120
            and not re.search(r"\([가-힣]{1,5}\s*\d{1,3}:\d{1,3}", item["text"])
        ]
        if not starters:
            if previous > 0 and previous in chapters and len(chapters) > 1:
                continue
            starters = [
                item
                for item in body_items
                if (item["box"][2] - item["box"][0]) >= 120
                and not re.search(r"\([가-힣]{1,5}\s*\d{1,3}:\d{1,3}", item["text"])
            ][:1]
        if not starters:
            continue
        item = starters[0]
        box = item["box"]
        return {
            "page": page,
            "q": item["q"],
            "box": [max(0, box[0] - 120), box[1], max(0, box[0] - 90), box[3]],
            "raw": "synthetic-header-transition",
            "confidence": 0.9,
            "image": str(CROPS / book_range["pdf"] / f"p{page:04d}_q{item['q']}.png"),
            "synthetic": True,
        }
    return None


def classify_page(pdf: str, page: int) -> dict:
    items = load_items(pdf, page)
    note_ranges = note_exclusion_ranges(items)
    classified = []
    for item in items:
        copy = dict(item)
        copy["kind"] = classify_item(copy, note_ranges)
        classified.append(copy)
    dropcap_items = [item for item in classified if item["kind"] == "dropcap"]
    for item in classified:
        if item["kind"] != "heading":
            continue
        for dropcap in dropcap_items:
            if item["q"] != dropcap["q"]:
                continue
            if abs(item["box"][1] - dropcap["box"][1]) <= 32 and item["box"][0] > dropcap["box"][0]:
                item["kind"] = "body"
                break
    prompt_note_active: set[int] = set()
    for item in sorted(classified, key=reading_key):
        q = item["q"]
        text = normalize(item["text"])
        if item["kind"] == "dropcap":
            prompt_note_active.discard(q)
            continue
        if item["kind"] in {"header", "noise", "duplicate"}:
            continue
        if q in prompt_note_active and re.match(r"^\d{1,3}(?:[-–]\d{1,3})?(?=\D|$)", text):
            prompt_note_active.remove(q)
        if re.match(r"^[①-⑳▪•]", text):
            prompt_note_active.add(q)
            item["kind"] = "note"
            continue
        if q in prompt_note_active:
            item["kind"] = "note"
    body_text = "\n".join(
        item["text"] for item in sorted(classified, key=reading_key) if item["kind"] == "body"
    )
    dropcaps = []
    for item in classified:
        if item["kind"] != "dropcap":
            continue
        value = compact(item["text"])
        dropcaps.append(
            {
                "raw": item["text"],
                "value": int(value),
                "q": item["q"],
                "box": item["box"],
                "confidence": item["confidence"],
                "image": str(CROPS / pdf / f"p{page:04d}_q{item['q']}.png"),
            }
        )
    header = " ".join(item["text"] for item in sorted(classified, key=reading_key) if item["kind"] == "header")
    return {
        "pdf": pdf,
        "page": page,
        "header": header,
        "items": sorted(classified, key=reading_key),
        "dropcaps": dropcaps,
        "bodyText": body_text,
    }


def infer_book_page_ranges(pages: dict[str, list[dict]]) -> dict[str, dict[str, int]]:
    ranges: dict[str, dict[str, int]] = {}
    for pdf, page_docs in pages.items():
        books = PDF_BOOKS[pdf]
        seen: dict[str, list[int]] = defaultdict(list)
        for doc in page_docs:
            text = doc["header"]
            for book in books:
                names = BOOK_ALIASES.get(book, [book])
                if any(name in text for name in names):
                    seen[book].append(doc["page"])
        starts: dict[str, int] = {}
        for idx, book in enumerate(books):
            if idx == 0:
                starts[book] = 1
            elif seen[book]:
                starts[book] = max(1, min(seen[book]) - 1)
            else:
                starts[book] = 0
        for idx, book in enumerate(books):
            if starts[book]:
                start = starts[book]
            else:
                prev_starts = [starts[prev] for prev in books[:idx] if starts[prev]]
                start = (prev_starts[-1] if prev_starts else 1)
            if idx + 1 < len(books):
                next_start = next((starts[next_book] for next_book in books[idx + 1 :] if starts[next_book]), None)
                end = (next_start - 1) if next_start else page_docs[-1]["page"]
            else:
                end = page_docs[-1]["page"]
            ranges[book] = {"pdf": pdf, "startPage": start, "endPage": max(start, end)}
    return ranges


def chapter_candidates_for_book(book: str, book_range: dict[str, int], page_docs: list[dict]) -> dict[str, list[dict]]:
    max_chapter = CHAPTER_COUNTS[book]
    pdf = book_range["pdf"]
    start = book_range["startPage"]
    end = book_range["endPage"]
    candidates: dict[str, list[dict]] = {str(ch): [] for ch in range(1, max_chapter + 1)}
    for doc in page_docs:
        page = doc["page"]
        if not (start <= page <= end):
            continue
        for drop in doc["dropcaps"]:
            values = [drop["value"]]
            if drop["value"] > max_chapter and str(drop["value"]).endswith("0"):
                values.append(int(str(drop["value"])[:-1]))
            for value in values:
                if 1 <= value <= max_chapter:
                    candidates[str(value)].append(
                        {
                            "page": page,
                            "q": drop["q"],
                            "box": drop["box"],
                            "raw": drop["raw"],
                            "confidence": drop["confidence"],
                            "image": drop["image"],
                        }
                    )
    for rows in candidates.values():
        rows.sort(key=lambda row: (row["page"], row["q"], row["box"][1], -row["confidence"]))
    start_anchor = first_body_anchor(book_range, page_docs)
    if start_anchor is not None:
        chapter_one = candidates.get("1", [])
        if not chapter_one or chapter_one[0]["page"] > book_range["startPage"] + 3:
            candidates["1"].insert(0, start_anchor)
    for chapter in range(2, max_chapter + 1):
        key = str(chapter)
        if candidates[key]:
            continue
        anchor = header_transition_anchor(book, chapter, book_range, page_docs)
        if anchor is not None:
            candidates[key].append(anchor)
    for (manual_book, chapter), anchor in MANUAL_ANCHORS.items():
        if manual_book != book:
            continue
        key = str(chapter)
        candidates[key].insert(
            0,
            {
                "page": anchor["page"],
                "q": anchor["q"],
                "box": anchor["box"],
                "raw": "manual-anchor",
                "confidence": 1.0,
                "image": str(CROPS / anchor["pdf"] / f"p{anchor['page']:04d}_q{anchor['q']}.png"),
                "manual": True,
            },
        )
    return candidates


def choose_monotonic(candidates: dict[str, list[dict]]) -> dict[str, dict | None]:
    chosen: dict[str, dict | None] = {}
    last_page = 0
    for chapter in range(1, len(candidates) + 1):
        rows = candidates[str(chapter)]
        viable = [row for row in rows if row["page"] >= last_page]
        if not viable:
            chosen[str(chapter)] = None
            continue
        best = viable[0]
        chosen[str(chapter)] = best
        last_page = best["page"]
    return chosen


def anchor_sort_key(anchor: dict) -> tuple[int, int, int, int]:
    q_order = {1: 0, 2: 1, 3: 2, 4: 3}
    box = anchor["box"]
    return (anchor["page"], q_order.get(anchor["q"], 9), box[1], box[0])


def item_sort_key(page: int, item: dict) -> tuple[int, int, int, int]:
    q_order = {1: 0, 2: 1, 3: 2, 4: 3}
    box = item["box"]
    return (page, q_order.get(item["q"], 9), box[1], box[0])


def is_before_or_at_anchor(item: dict, anchor: dict) -> bool:
    if item["page"] != anchor["page"] or item["q"] != anchor["q"]:
        return item_sort_key(item["page"], item) <= anchor_sort_key(anchor)
    item_box = item["box"]
    anchor_box = anchor["box"]
    same_line = abs(item_box[1] - anchor_box[1]) <= 28 and item_box[0] > anchor_box[0]
    if same_line:
        return False
    return item_sort_key(item["page"], item) <= anchor_sort_key(anchor)


def clean_body_line(text: str) -> str:
    text = normalize(text)
    text = re.sub(r"^\d{1,3}(?:[-–]\d{1,3})?\s*", "", text)
    return text.strip()


def build_chapter_drafts(
    book: str,
    book_range: dict[str, int],
    chapter_rows: dict[str, dict],
    page_docs: list[dict],
) -> dict:
    anchors = []
    missing = []
    for chapter, row in chapter_rows.items():
        selected = row["selected"]
        if selected is None:
            missing.append(int(chapter))
            continue
        anchor = dict(selected)
        anchor["chapter"] = int(chapter)
        anchors.append(anchor)
    anchors.sort(key=anchor_sort_key)

    items = []
    for doc in page_docs:
        page = doc["page"]
        if not (book_range["startPage"] <= page <= book_range["endPage"]):
            continue
        for item in doc["items"]:
            if item["kind"] != "body":
                continue
            line = clean_body_line(item["text"])
            if not line:
                continue
            items.append({"page": page, "q": item["q"], "box": item["box"], "text": line})
    items.sort(key=lambda item: item_sort_key(item["page"], item))

    chapters = {}
    for index, anchor in enumerate(anchors):
        start_key = anchor_sort_key(anchor)
        end_key = anchor_sort_key(anchors[index + 1]) if index + 1 < len(anchors) else None
        lines = []
        recent = []
        for item in items:
            key = item_sort_key(item["page"], item)
            if is_before_or_at_anchor(item, anchor):
                continue
            if end_key is not None and key >= end_key:
                continue
            line_key = compact(item["text"])
            if line_key in recent:
                continue
            recent.append(line_key)
            recent = recent[-18:]
            lines.append(item["text"])
        chapters[str(anchor["chapter"])] = {
            "chapter": anchor["chapter"],
            "anchor": anchor,
            "text": "\n".join(lines).strip(),
            "lineCount": len(lines),
        }
    return {"book": book, "range": book_range, "missingChapters": missing, "chapters": chapters}


def write_outputs(page_docs_by_pdf: dict[str, list[dict]]) -> dict:
    page_out = OUT / "pages"
    for pdf, docs in page_docs_by_pdf.items():
        target = page_out / pdf
        target.mkdir(parents=True, exist_ok=True)
        for doc in docs:
            (target / f"p{doc['page']:04d}.json").write_text(
                json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    ranges = infer_book_page_ranges(page_docs_by_pdf)
    chapter_map = {}
    review_lines = ["# Scan Chapter Anchor Review", ""]
    total = missing = weak = 0
    for book, book_range in ranges.items():
        pdf = book_range["pdf"]
        candidates = chapter_candidates_for_book(book, book_range, page_docs_by_pdf[pdf])
        chosen = choose_monotonic(candidates)
        chapter_map[book] = {"range": book_range, "chapters": {}}
        review_book_lines = []
        for chapter, selected in chosen.items():
            total += 1
            rows = candidates[chapter]
            chapter_map[book]["chapters"][chapter] = {
                "selected": selected,
                "candidates": rows[:8],
                "confirmed": False,
            }
            if selected is None or (rows and selected != rows[0]) or len(rows) != 1:
                if selected is None:
                    missing += 1
                else:
                    weak += 1
                review_book_lines.append(f"## {book} {chapter}장")
                review_book_lines.append(f"- selected: `{selected}`")
                for idx, row in enumerate(rows[:8], start=1):
                    review_book_lines.append(
                        f"- C{idx}: p{row['page']:04d} q{row['q']} raw `{row['raw']}` conf `{row['confidence']}` image `{row['image']}`"
                    )
                if not rows:
                    review_book_lines.append("- candidate: none")
                review_book_lines.append("- confirm:")
                review_book_lines.append("")
        if review_book_lines:
            review_lines.append(f"# {book}")
            review_lines.append("")
            review_lines.extend(review_book_lines)

    (OUT / "book_page_ranges.json").write_text(json.dumps(ranges, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "chapter_map.draft.json").write_text(json.dumps(chapter_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "chapter_anchor_review.md").write_text("\n".join(review_lines), encoding="utf-8")
    chapters_out = OUT / "chapters"
    chapters_out.mkdir(parents=True, exist_ok=True)
    chapter_summary = []
    for book, row in chapter_map.items():
        pdf = row["range"]["pdf"]
        draft = build_chapter_drafts(book, row["range"], row["chapters"], page_docs_by_pdf[pdf])
        (chapters_out / f"{book}.json").write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        chapter_summary.append(
            {
                "book": book,
                "builtChapters": len(draft["chapters"]),
                "missingChapters": draft["missingChapters"],
                "shortChapters": [
                    int(chapter)
                    for chapter, chapter_row in draft["chapters"].items()
                    if len(compact(chapter_row["text"])) < 40
                ],
            }
        )
    (OUT / "chapter_draft_summary.json").write_text(
        json.dumps(chapter_summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {"totalChapters": total, "missing": missing, "weak": weak, "out": str(OUT)}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    page_docs_by_pdf = {}
    for pdf in "adbce":
        docs = []
        for path in sorted((PADDLE / pdf).glob("p*.json")):
            page = int(path.stem[1:])
            docs.append(classify_page(pdf, page))
        page_docs_by_pdf[pdf] = docs
    summary = write_outputs(page_docs_by_pdf)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
