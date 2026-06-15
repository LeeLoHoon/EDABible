#!/usr/bin/env python3
"""Apply resolved OCR review lines into page-level body text.

This writes page text files under /home/easy/bible/new/applied_body/<pdf>/pNNNN.txt.
Resolved review lines are replaced with their selected candidate, while remaining
flagged lines are omitted and reported as incomplete chapter/page ranges.
"""
from __future__ import annotations

import json
import re
from pathlib import Path


BASE = Path("/home/easy/bible/new")
PADDLE = BASE / "ocr_paddle"
OUT = BASE / "applied_body"
REPORT_DIR = Path("reports/ocr-consensus-resolved")
INCOMPLETE_REPORT = REPORT_DIR / "incomplete-chapters.md"
SUMMARY_REPORT = REPORT_DIR / "applied-summary.json"
LOCKED_FLAGS = REPORT_DIR / "remaining-flags.md"

NOISE_CHARS = "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ√_`|ㆍ<>"
BAD_FRAGMENTS = [
    "에뉴",
    "이컷",
    "게텔",
    "메센",
    "믿아들",
    "히나님",
    "있시",
    "하니",
    "하나남",
    "하져",
    "종앉",
    "낭앉",
    "수어다",
    "보니나연",
    "샐",
    "이랄",
    "포도발",
    "비깥",
    "므낭",
    "므낮",
]
BOOK_NAMES = [
    "창세기",
    "출애굽기",
    "레위기",
    "민수기",
    "신명기",
    "여호수아",
    "사사기",
    "룻기",
    "사무엘상",
    "사무엘하",
    "열왕기상",
    "열왕기하",
    "역대상",
    "역대하",
    "에스라",
    "느헤미야",
    "에스더",
    "욥기",
    "시편",
    "잠언",
    "전도서",
    "아가",
    "이사야",
    "예레미야",
    "예레미야애가",
    "에스겔",
    "다니엘",
    "호세아",
    "요엘",
    "아모스",
    "오바댜",
    "요나",
    "미가",
    "나훔",
    "하박국",
    "스바냐",
    "학개",
    "스가랴",
    "말라기",
    "마태복음",
    "마가복음",
    "누가복음",
    "요한복음",
    "사도행전",
    "로마서",
    "고린도전서",
    "고린도후서",
    "갈라디아서",
    "에베소서",
    "빌립보서",
    "골로새서",
    "데살로니가전서",
    "데살로니가후서",
    "디모데전서",
    "디모데후서",
    "디도서",
    "빌레몬서",
    "히브리서",
    "야고보서",
    "베드로전서",
    "베드로후서",
    "요한일서",
    "요한이서",
    "요한삼서",
    "유다서",
    "요한계시록",
]
BOOK_RE = re.compile("|".join(map(re.escape, sorted(BOOK_NAMES, key=len, reverse=True))))


def normalize(text: str) -> str:
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def compact(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", normalize(text))


def is_noise(text: str) -> bool:
    value = normalize(text)
    if not value:
        return True
    if re.fullmatch(r"[\d\s\-~|()[\]{}.,:;\"'`]+", value):
        return True
    if re.fullmatch(r"\d{2,4}\s*(%s).*" % BOOK_RE.pattern, value):
        return True
    if re.fullmatch(r"(%s)\s*\d.*" % BOOK_RE.pattern, value):
        return True
    if len(compact(value)) < 4:
        return True
    return False


def is_flagged(text: str) -> bool:
    if not text:
        return True
    return (
        any(ch in text for ch in NOISE_CHARS)
        or any(fragment in text for fragment in BAD_FRAGMENTS)
        or bool(re.search(r"[가-힣]{14,}", text))
    )


def clean_final(text: str) -> str:
    value = normalize(text)
    value = re.sub(r"\s*[_ㆍ<>\-?、。％%《「」Ｌ]\s*$", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def line_key(pdf: str, page: int, q: int, text: str) -> tuple[str, int, int, str]:
    return (pdf, page, q, compact(text))


def load_locked_flags() -> dict[tuple[str, int, int], list[str]]:
    if not LOCKED_FLAGS.exists():
        return {}
    current_pdf = None
    locked: dict[tuple[str, int, int], list[str]] = {}
    for line in LOCKED_FLAGS.read_text(encoding="utf-8").splitlines():
        pdf_match = re.match(r"^##\s+([abcde])\s+\(", line)
        if pdf_match:
            current_pdf = pdf_match.group(1)
            continue
        item_match = re.match(r"^-\s+p(\d{4})\s+q(\d+):\s+`(.*)`", line)
        if current_pdf and item_match:
            page = int(item_match.group(1))
            q = int(item_match.group(2))
            text = item_match.group(3)
            locked.setdefault((current_pdf, page, q), []).append(text)
    return locked


def load_resolved(pdf: str) -> tuple[dict[tuple[str, int, int, str], dict], list[dict]]:
    data = json.loads((REPORT_DIR / f"{pdf}-resolved.json").read_text(encoding="utf-8"))
    locked_flags = load_locked_flags()
    resolved = {}
    flags = []
    for page in data["pages"]:
        page_no = int(page["page"])
        for item in page["review"]:
            selected = clean_final(item.get("selected", ""))
            locked_key = (pdf, page_no, int(item["q"]))
            locked_text = None
            if locked_flags.get(locked_key):
                locked_text = locked_flags[locked_key].pop(0)
            entry = {
                "selected": selected,
                "flagged": locked_text is not None,
                "lockedText": locked_text,
                "source": item.get("selectedSource", ""),
                "crop": item.get("crop", ""),
            }
            resolved[line_key(pdf, page_no, int(item["q"]), item["text"])] = entry
            if entry["flagged"]:
                flags.append({"pdf": pdf, "page": page_no, "q": item["q"], **entry})
    return resolved, flags


def header_for_page(pdf: str, page: int) -> dict:
    items = read_paddle_items(pdf, page)
    texts = [normalize(item.get("text", "")) for item in items[:12]]
    joined = " ".join(texts)
    book = None
    chapters = None
    match = BOOK_RE.search(joined.replace(" ", ""))
    if match:
        book = match.group(0)
    chapter_match = re.search(rf"(?:{BOOK_RE.pattern})\s*(\d+(?:[-~]\d+)?)", joined.replace(" ", ""))
    if chapter_match:
        chapters = chapter_match.group(1)
    return {"book": book or "미상", "chapters": chapters or "미상"}


def read_paddle_items(pdf: str, page: int) -> list[dict]:
    path = PADDLE / pdf / f"p{page:04d}.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def apply_pdf(pdf: str) -> dict:
    resolved, flags = load_resolved(pdf)
    out_dir = OUT / pdf
    out_dir.mkdir(parents=True, exist_ok=True)
    page_count = 0
    written_lines = 0
    omitted_lines = 0
    replaced_lines = 0

    for path in sorted((PADDLE / pdf).glob("p*.json")):
        page = int(path.stem[1:])
        page_count += 1
        lines = []
        last_q = None
        for item in json.loads(path.read_text(encoding="utf-8")):
            q = int(item.get("q", 0))
            text = normalize(item.get("text", ""))
            if is_noise(text):
                continue
            key = line_key(pdf, page, q, text)
            replacement = resolved.get(key)
            if replacement:
                if replacement["flagged"]:
                    omitted_lines += 1
                    continue
                text = replacement["selected"]
                replaced_lines += 1
            text = clean_final(text)
            if not text or is_noise(text):
                continue
            if last_q is not None and q != last_q:
                lines.append("")
            lines.append(text)
            last_q = q
            written_lines += 1
        (out_dir / f"p{page:04d}.txt").write_text("\n".join(lines).strip() + "\n", encoding="utf-8")

    return {
        "pdf": pdf,
        "pages": page_count,
        "writtenLines": written_lines,
        "replacedLines": replaced_lines,
        "omittedFlaggedLines": omitted_lines,
        "flags": flags,
    }


def chapter_labels_for_flags(results: list[dict]) -> list[dict]:
    rows = []
    seen = set()
    for result in results:
        for flag in result["flags"]:
            header = header_for_page(flag["pdf"], flag["page"])
            key = (flag["pdf"], flag["page"], flag["q"], flag["selected"])
            if key in seen:
                continue
            seen.add(key)
            rows.append({**flag, **header})
    return rows


def write_incomplete_report(rows: list[dict]) -> None:
    grouped: dict[tuple[str, str, str], list[dict]] = {}
    for row in rows:
        grouped.setdefault((row["pdf"], row["book"], row["chapters"]), []).append(row)

    lines = ["# Incomplete Chapters After Auto Apply", ""]
    lines.append(f"Total omitted flagged lines: {len(rows)}")
    lines.append("")
    for (pdf, book, chapters), items in sorted(grouped.items(), key=lambda x: (x[0][0], x[1][0]["page"])):
        lines.append(f"## {pdf} / {book} {chapters} ({len(items)} lines)")
        for item in items:
            lines.append(f"- p{item['page']:04d} q{item['q']}: `{item['selected']}`")
            if item.get("lockedText") and item["lockedText"] != item["selected"]:
                lines.append(f"  - locked-original: `{item['lockedText']}`")
            lines.append(f"  - image: `{item['crop']}`")
        lines.append("")
    INCOMPLETE_REPORT.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    results = [apply_pdf(pdf) for pdf in "abcde"]
    rows = chapter_labels_for_flags(results)
    write_incomplete_report(rows)
    summary = [
        {key: value for key, value in result.items() if key != "flags"}
        for result in results
    ]
    SUMMARY_REPORT.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Wrote {OUT}")
    print(f"Wrote {INCOMPLETE_REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
