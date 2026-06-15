#!/usr/bin/env python3
"""Create spell-check drafts from scan-rebuilt chapter JSON.

The script does not modify public Bible JSON. It writes corrected draft chapters
under /home/easy/bible/new/scan_rebuild_spellchecked and review reports under
reports/scan-spellcheck.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

try:
    from kiwipiepy import Kiwi  # type: ignore
except ModuleNotFoundError as exc:
    raise SystemExit("Run with /home/easy/bible/new/ocr-venv/bin/python") from exc


SRC = Path("/home/easy/bible/new/scan_rebuild/chapters")
OUT = Path("/home/easy/bible/new/scan_rebuild_spellchecked")
REPORT = Path("reports/scan-spellcheck")

SCRIPT_RE = re.compile(r"[^0-9A-Za-z가-힣]+")
JAMO_RE = re.compile(r"[ㄱ-ㅎㅏ-ㅣㆍ]")
ODD_ASCII_RE = re.compile(r"[A-Za-z]{2,}|[Kk][Ff]?|[oO](?=\s|$)")

COMMON_REPAIRS = [
    ("하니을", "하나님을"),
    ("하니님", "하나님"),
    ("히나님", "하나님"),
    ("말쓴", "말씀"),
    ("말쓴하셨다", "말씀하셨다"),
    ("하져다", "하셨다"),
    ("하섯다", "하셨다"),
    ("하없다", "하셨다"),
    ("말있다", "말했다"),
    ("수어다", "숨었다"),
    ("동사나무", "동산 나무"),
    ("듣나무", "든 나무"),
    ("아카지아", "아카시아"),
    ("뭘 듯이", "뛸 듯이"),
    ("자갈받", "자갈밭"),
    ("잡초받", "잡초밭"),
    ("풀받", "풀밭"),
    ("마음받", "마음밭"),
    ("믿아들", "맏아들"),
    ("맡아들", "맏아들"),
    ("마지말", "마지막"),
    ("발뒤끔치", "발뒤꿈치"),
    ("가없은", "가엾은"),
    ("퇴페", "퇴폐"),
    ("잔지에", "잔치에"),
    ("불건", "물건"),
    ("마런", "마련"),
    ("포도받", "포도밭"),
    ("포도발", "포도밭"),
    ("비깥", "바깥"),
    ("므낭세", "므낫세"),
    ("므낮세", "므낫세"),
    ("아라탓", "아라랏"),
    ("아라란", "아라랏 산"),
    ("오배상", "오백 살"),
    ("세과하가아베우난아다", "셈과 함과 야벳을 낳았다"),
]

BAD_FRAGMENTS = [
    "하나남",
    "히나님",
    "수어다",
    "동사나무",
    "듣나무",
    "아카지아",
    "믿아들",
    "마지말",
    "발뒤끔치",
    "가없은",
    "퇴페",
    "잔지",
    "불건",
    "마런",
    "에뉴",
    "이컷",
    "게텔",
    "메센",
    "종앉",
    "낭앉",
    "보니나연",
    "포도발",
    "비깥",
    "므낭",
    "므낮",
    "야켓",
    "야벤",
    "받에",
    "받에서",
    "받을",
    "느리는",
]

HEADING_ENDINGS = (
    "하다",
    "하시다",
    "되다",
    "받다",
    "죽다",
    "돌아오다",
    "다스리다",
    "구하다",
    "세우다",
    "맺으시다",
    "주시다",
)

EXACT_EDITORIAL_HEADINGS = {
    "분향단",
    "속죄세",
    "대야",
    "성막",
    "성막뜰",
    "성막천",
    "언약궤",
    "제사장위임식",
    "제사장의예복",
    "유월절규례",
    "성전",
    "성전뜰",
    "기도",
    "창조",
    "새언약",
    "발람의예언",
    "하박국의기도",
    "다니엘의기도",
    "호르산에서모압까지",
    "라암셋에서요단여리고까지",
}

HEADING_TERMS = (
    "구리뱀",
    "족보",
    "기도",
)


def normalize(text: str) -> str:
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def compact(text: str) -> str:
    return SCRIPT_RE.sub("", normalize(text))


def repair_line(text: str) -> str:
    value = normalize(text)
    value = re.sub(r"\s*[_ㆍ<>、。％%《「」Ｌ]\s*$", "", value)
    for source, target in COMMON_REPAIRS:
        value = value.replace(source, target)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def kiwi_risk(kiwi: Kiwi, text: str) -> float:
    value = normalize(text)
    key = compact(value)
    if not key:
        return 0.0
    tokens = kiwi.tokenize(value)
    if not tokens:
        return 4.0
    unknown = sum(1 for token in tokens if token.tag in {"UNK", "W_UNKNOWN"})
    long_unspaced = len(re.findall(r"[가-힣]{13,}", value))
    return unknown * 1.5 + long_unspaced * 1.0


def looks_like_editorial_heading(text: str) -> bool:
    value = normalize(text)
    key = compact(value)
    if not key or len(key) > 28:
        return False
    if re.search(r"[.!?\"'“”‘’]", value):
        return False
    if re.match(r"^\d", key):
        return False
    if key in EXACT_EDITORIAL_HEADINGS:
        return True
    if any(term in key for term in HEADING_TERMS) and key.endswith(HEADING_ENDINGS) and len(key) <= 24:
        return True
    return False


def line_reasons(kiwi: Kiwi, original: str, repaired: str) -> list[str]:
    reasons: list[str] = []
    if original != repaired:
        reasons.append("auto-repaired")
    remaining_bad = [fragment for fragment in BAD_FRAGMENTS if fragment in repaired]
    if remaining_bad:
        reasons.append("bad-fragment:" + ",".join(remaining_bad[:4]))
    if JAMO_RE.search(repaired):
        reasons.append("jamo-noise")
    if ODD_ASCII_RE.search(repaired):
        reasons.append("ascii-noise")
    if re.search(r"\b[0-9]{1,3}\s*$", repaired):
        reasons.append("trailing-number")
    risk = kiwi_risk(kiwi, repaired)
    if risk >= 5.0 and (JAMO_RE.search(repaired) or ODD_ASCII_RE.search(repaired)):
        reasons.append(f"kiwi-risk:{risk:.1f}")
    return reasons


def split_lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if normalize(line)]


def process_chapter(kiwi: Kiwi, book: str, chapter: str, text: str) -> tuple[str, list[dict], int]:
    out_lines: list[str] = []
    review: list[dict] = []
    changed = 0
    recent: list[str] = []
    for line_no, original in enumerate(split_lines(text), start=1):
        repaired = repair_line(original)
        if looks_like_editorial_heading(repaired):
            review.append(
                {
                    "book": book,
                    "chapter": chapter,
                    "line": line_no,
                    "original": original,
                    "suggested": "",
                    "reasons": ["editorial-heading-omitted"],
                }
            )
            changed += 1
            continue
        key = compact(repaired)
        if key and key in recent:
            review.append(
                {
                    "book": book,
                    "chapter": chapter,
                    "line": line_no,
                    "original": original,
                    "suggested": "",
                    "reasons": ["near-duplicate-omitted"],
                }
            )
            changed += 1
            continue
        recent.append(key)
        recent = recent[-12:]
        reasons = line_reasons(kiwi, original, repaired)
        if reasons:
            review.append(
                {
                    "book": book,
                    "chapter": chapter,
                    "line": line_no,
                    "original": original,
                    "suggested": repaired,
                    "reasons": reasons,
                }
            )
        if repaired != original:
            changed += 1
        out_lines.append(repaired)
    return "\n".join(out_lines), review, changed


def write_markdown(items: list[dict], limit: int = 120) -> list[Path]:
    for old in REPORT.glob("review-batch-*.md"):
        old.unlink()
    paths: list[Path] = []
    batch: list[str] = []
    batch_no = 1
    for idx, item in enumerate(items, start=1):
        batch.append(
            "\n".join(
                [
                    f"## {idx}. {item['book']} {item['chapter']}장 line {item['line']}",
                    f"- reasons: `{', '.join(item['reasons'])}`",
                    f"- original: `{item['original']}`",
                    f"- suggested: `{item['suggested']}`",
                    "- confirm:",
                ]
            )
        )
        if len(batch) >= limit:
            path = REPORT / f"review-batch-{batch_no:03d}.md"
            path.write_text(f"# Scan Spellcheck Review {batch_no:03d}\n\n" + "\n\n".join(batch) + "\n", encoding="utf-8")
            paths.append(path)
            batch = []
            batch_no += 1
    if batch or not paths:
        path = REPORT / f"review-batch-{batch_no:03d}.md"
        path.write_text(f"# Scan Spellcheck Review {batch_no:03d}\n\n" + "\n\n".join(batch) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


def main() -> int:
    kiwi = Kiwi()
    chapters_out = OUT / "chapters"
    chapters_out.mkdir(parents=True, exist_ok=True)
    REPORT.mkdir(parents=True, exist_ok=True)

    review_items: list[dict] = []
    summary: list[dict] = []
    total_chapters = 0
    total_changed = 0
    for path in sorted(SRC.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        book = data["book"]
        out_data = {**data, "chapters": {}}
        book_changed = 0
        book_review = 0
        for chapter, row in data["chapters"].items():
            total_chapters += 1
            text, review, changed = process_chapter(kiwi, book, chapter, row.get("text", ""))
            next_row = {**row, "text": text, "lineCount": len(split_lines(text))}
            out_data["chapters"][chapter] = next_row
            review_items.extend(review)
            book_changed += changed
            book_review += len(review)
        total_changed += book_changed
        summary.append({"book": book, "changedLines": book_changed, "reviewLines": book_review})
        (chapters_out / path.name).write_text(json.dumps(out_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    review_items.sort(key=lambda item: (0 if "auto-repaired" not in item["reasons"] else 1, item["book"], int(item["chapter"]), item["line"]))
    paths = write_markdown(review_items)
    report = {
        "source": str(SRC),
        "out": str(OUT),
        "totalChapters": total_chapters,
        "changedLines": total_changed,
        "reviewLines": len(review_items),
        "batchCount": len(paths),
        "summary": summary,
        "items": review_items,
    }
    (REPORT / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ["totalChapters", "changedLines", "reviewLines", "batchCount", "out"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
