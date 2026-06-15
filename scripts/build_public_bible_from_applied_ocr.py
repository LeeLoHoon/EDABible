#!/usr/bin/env python3
"""Build EDABible JSON from applied OCR page text.

This is intentionally conservative:
- source text comes from /home/easy/bible/new/applied_body
- existing public/bible JSON is used only for book metadata and chapter-start anchors
- editorial note boxes are filtered before chapter slicing
- books with missing/non-monotonic anchors are skipped and reported
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

try:
    from rapidfuzz import fuzz
except ModuleNotFoundError as exc:
    raise SystemExit("Install rapidfuzz in the active Python environment.") from exc


ROOT = Path("/home/easy/git/EDABible")
PUBLIC = ROOT / "public/bible"
APPLIED = Path("/home/easy/bible/new/applied_body")
OUT = Path("/home/easy/bible/new/out_from_applied")
REPORT = ROOT / "reports/ocr-consensus-resolved/build-public-from-applied.json"

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

EDITORIAL_HEADINGS = {
    "하늘과 땅의 창조",
    "사람의 불순종",
    "가인과 아벨",
    "인류의 족보",
    "하나님께서 아브람과 언약을 맺으시다",
    "하갈과 이스마엘",
    "이삭과 리브가",
    "아브라함이 죽다",
    "이삭이 야곱을 축복하다",
    "하나님께서 아브람을 부르시다",
    "하나님께서 야브라함음 시험하시다",
}


def compact(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", text)


def normalize_line(line: str) -> str:
    line = line.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    line = re.sub(r"\s+", " ", line).strip()
    line = re.sub(r"^\d{1,3}(?:-\d{1,3})?\s*", "", line)
    return line.strip()


def is_header(line: str) -> bool:
    value = line.replace(" ", "")
    if re.fullmatch(r"\d{1,4}", value):
        return True
    if re.fullmatch(rf"(?:{BOOK_RE.pattern})\d*(?:[-~]\d+)?", value):
        return True
    if re.fullmatch(rf"\d{{1,4}}(?:{BOOK_RE.pattern})\d*(?:[-~]\d+)?", value):
        return True
    return False


def is_note_heading(line: str) -> bool:
    value = line.strip()
    if re.search(r"\(\d{1,3}:\d{1,3}(?:-\d{1,3})?\)", value):
        return True
    if re.search(r"\(\d{1,3}:\d{1,3}(?:-\d{1,3})?(?:;\s*\d{1,3}:\d{1,3})*\)", value):
        return True
    return False


def is_editorial_heading(line: str) -> bool:
    value = line.strip()
    value_compact = compact(value)
    if value in EDITORIAL_HEADINGS:
        return True
    if len(value_compact) <= 26 and not re.search(r"[.!?\"']", value) and not re.match(r"\d", value):
        if any(word in value for word in ("창조", "언약", "심판", "족보", "시험", "기도", "머리말", "서문")):
            return True
        if re.search(r"(하시다|되시다|받다|쌓다|덮다|죽다|부르시다|맺으시다)$", value_compact):
            return True
        if len(value_compact) <= 14 and not re.search(
            r"(했다|말했다|하셨다|되었다|이었다|있었다|죽었다|낳았다|살았다|갔다|왔다|보았다|주었다|받았다)$",
            value_compact,
        ):
            return True
    return False


def read_pdf_source(pdf: str) -> str:
    lines: list[str] = []
    skip_note = False
    recent: list[str] = []
    for path in sorted((APPLIED / pdf).glob("p*.txt")):
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = normalize_line(raw)
            if not line:
                skip_note = False
                continue
            if is_header(line):
                continue
            if is_note_heading(line):
                skip_note = True
                continue
            if skip_note:
                continue
            if is_editorial_heading(line):
                continue
            if len(compact(line)) < 4:
                continue
            key = compact(line)
            if key in recent:
                continue
            recent.append(key)
            recent = recent[-12:]
            lines.append(line)
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def compact_with_map(text: str) -> tuple[str, list[int]]:
    chars = []
    mapping = []
    for idx, ch in enumerate(text):
        if re.match(r"[0-9A-Za-z가-힣]", ch):
            chars.append(ch)
            mapping.append(idx)
    return "".join(chars), mapping


def chapter_anchor(text: str) -> str:
    lines = [normalize_line(line) for line in text.splitlines() if normalize_line(line)]
    text = " ".join(line for line in lines if not is_editorial_heading(line))
    text = re.sub(r"\(\d+\)", " ", text)
    key = compact(text)
    return key[:34]


def find_anchor(anchor: str, source_compact: str, start: int) -> tuple[int, float]:
    for size in (34, 30, 26, 22, 18, 14):
        needle = anchor[:size]
        if len(needle) < 12:
            continue
        pos = source_compact.find(needle, start)
        if pos >= 0:
            return pos, 1.0
    best_pos = -1
    best_score = 0.0
    needle = anchor[:28]
    if len(needle) < 12:
        return -1, 0.0
    window = len(needle) + 8
    step = 3
    search_end = len(source_compact) - window
    for pos in range(start, max(start, search_end), step):
        score = fuzz.ratio(needle, source_compact[pos : pos + window]) / 100
        if score > best_score:
            best_pos = pos
            best_score = score
        if score >= 0.92:
            return pos, score
    return (best_pos, best_score) if best_score >= 0.86 else (-1, best_score)


def slice_book(entry: dict, source_text: str, source_compact: str, mapping: list[int]) -> tuple[dict | None, dict]:
    book = entry["book"]
    current_doc = json.loads((PUBLIC / entry["file"]).read_text(encoding="utf-8"))
    anchors = [(chapter["chapter"], chapter_anchor(chapter["text"])) for chapter in current_doc["chapters"]]
    starts = []
    cursor = 0
    for chapter, anchor in anchors:
        pos, score = find_anchor(anchor, source_compact, cursor)
        starts.append({"chapter": chapter, "anchor": anchor, "position": pos, "score": round(score, 4)})
        if pos < 0:
            cursor += 1
        else:
            cursor = pos + max(8, min(len(anchor), 24))
    missing = [item for item in starts if item["position"] < 0]
    non_monotonic = [
        (prev, curr)
        for prev, curr in zip(starts, starts[1:])
        if prev["position"] >= 0 and curr["position"] >= 0 and curr["position"] <= prev["position"]
    ]
    if missing or non_monotonic:
        return None, {"book": book, "ok": False, "missing": missing, "nonMonotonic": non_monotonic, "starts": starts}

    chapters = []
    for idx, item in enumerate(starts):
        start_idx = mapping[item["position"]]
        next_pos = starts[idx + 1]["position"] if idx + 1 < len(starts) else len(mapping) - 1
        end_idx = mapping[next_pos] if idx + 1 < len(starts) else len(source_text)
        chapter_text = source_text[start_idx:end_idx].strip()
        chapter_text = re.sub(r"\n{3,}", "\n\n", chapter_text)
        chapters.append({"chapter": item["chapter"], "text": chapter_text})
    doc = {
        "order": entry["order"],
        "book": book,
        "abbr": entry["abbr"],
        "chapters": chapters,
    }
    short = [chapter["chapter"] for chapter in chapters if len(compact(chapter["text"])) < 60]
    return doc, {"book": book, "ok": not short, "short": short, "starts": starts}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    index = json.loads((PUBLIC / "index.json").read_text(encoding="utf-8"))
    sources = {}
    for pdf in PDF_BOOKS:
        text = read_pdf_source(pdf)
        source_compact, mapping = compact_with_map(text)
        sources[pdf] = (text, source_compact, mapping)

    report = []
    built = []
    skipped = []
    for entry in index:
        pdf = BOOK_TO_PDF[entry["book"]]
        doc, item_report = slice_book(entry, *sources[pdf])
        report.append(item_report)
        if doc and item_report.get("ok"):
            out_file = OUT / entry["file"]
            out_file.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            built.append(entry["book"])
        else:
            skipped.append(entry["book"])
            shutil.copy2(PUBLIC / entry["file"], OUT / entry["file"])

    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    REPORT.write_text(json.dumps({"built": built, "skipped": skipped, "report": report}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"built": len(built), "skipped": len(skipped), "skippedBooks": skipped}, ensure_ascii=False, indent=2))
    print(f"Wrote {OUT}")
    print(f"Wrote {REPORT}")
    return 0 if built else 1


if __name__ == "__main__":
    raise SystemExit(main())
