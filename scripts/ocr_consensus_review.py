#!/usr/bin/env python3
"""Build a human review queue from multiple OCR engines.

The script compares PaddleOCR line candidates against Tesseract and EasyOCR.
It does not edit Bible JSON. It writes a JSON report and a short Markdown batch
of lines that are hard to confirm automatically.

Usage:
  python3 scripts/ocr_consensus_review.py a 1 120
"""
from __future__ import annotations

import difflib
import json
import re
import sys
from pathlib import Path

BASE = Path("/home/easy/bible/new")
REPORT_DIR = Path("reports/ocr-consensus")


def normalize(text: str) -> str:
    text = re.sub(r"=+ \[[^\]]+\] =+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def compact(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", normalize(text))


def similarity(a: str, b: str) -> float:
    aa = compact(a)
    bb = compact(b)
    if not aa and not bb:
        return 1.0
    if not aa or not bb:
        return 0.0
    return difflib.SequenceMatcher(None, aa, bb).ratio()


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    lines = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = normalize(raw)
        if line and not line.startswith("====="):
            lines.append(line)
    return lines


def read_items(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def is_noise(text: str) -> bool:
    value = normalize(text)
    if not value:
        return True
    if re.fullmatch(r"[\d\s\-~|()[\]{}.,:;\"'`]+", value):
        return True
    if re.fullmatch(r"\d{2,4}\s*(창세기|출애굽기|레위기|민수기|신명기).*", value):
        return True
    if re.fullmatch(r"(창세기|출애굽기|레위기|민수기|신명기)\s*\d.*", value):
        return True
    if len(compact(value)) < 4:
        return True
    return False


def best_match(text: str, candidates: list[str]) -> dict:
    best = {"text": "", "similarity": 0.0}
    for candidate in candidates:
        score = similarity(text, candidate)
        if score > best["similarity"]:
            best = {"text": candidate, "similarity": score}
    return best


def review_reason(item: dict, tess: dict, easy: dict) -> list[str]:
    reasons = []
    confidence = item.get("confidence", 0.0)
    paddle_tess = tess["similarity"]
    paddle_easy = easy["similarity"]
    tess_easy = similarity(tess["text"], easy["text"])
    best_pair = max(paddle_tess, paddle_easy, tess_easy)

    # If any two engines strongly agree, keep it out of the human queue.
    if best_pair >= 0.9:
        return []

    if confidence < 0.86 and best_pair < 0.86:
        reasons.append(f"low-paddle-confidence:{confidence:.3f}")
    if best_pair < 0.82:
        reasons.append(f"engine-disagreement:{best_pair:.3f}")
    if re.search(r"[ㄱ-ㅎㅏ-ㅣ]", item["text"]):
        reasons.append("jamo-noise")
    return reasons


def build_page(pdf: str, page: int) -> dict:
    paddle_items = read_items(BASE / "ocr_paddle" / pdf / f"p{page:04d}.json")
    easy_items = read_items(BASE / "ocr_easy" / pdf / f"p{page:04d}.json")
    tess_lines = read_lines(BASE / "ocr" / pdf / f"p{page:04d}.txt")
    easy_lines = [normalize(item["text"]) for item in easy_items if not is_noise(item.get("text", ""))]

    accepted = 0
    review = []
    for item in paddle_items:
        text = normalize(item.get("text", ""))
        if is_noise(text):
            continue
        candidate = {
            "q": item.get("q"),
            "text": text,
            "confidence": float(item.get("confidence", 0.0)),
        }
        tess = best_match(text, tess_lines)
        easy = best_match(text, easy_lines)
        reasons = review_reason(candidate, tess, easy)
        if reasons:
            review.append(
                {
                    **candidate,
                    "reasons": reasons,
                    "tesseract": tess,
                    "easyocr": easy,
                    "crop": f"/home/easy/bible/new/crops/{pdf}/p{page:04d}_q{item.get('q')}.png",
                }
            )
        else:
            accepted += 1

    return {
        "page": page,
        "accepted": accepted,
        "review": review,
    }


def write_markdown(pdf: str, pages: list[dict], limit: int = 80) -> list[Path]:
    for old in REPORT_DIR.glob(f"{pdf}-review-batch-*.md"):
        old.unlink()

    batches: list[Path] = []
    rows: list[str] = []
    count = 0
    batch = 1
    for page in pages:
        for item in page["review"]:
            count += 1
            rows.append(
                "\n".join(
                    [
                        f"## {count}. {pdf} p{page['page']:04d} q{item['q']}",
                        f"- image: `{item['crop']}`",
                        f"- reasons: `{', '.join(item['reasons'])}`",
                        f"- Paddle: `{item['text']}`",
                        f"- Tesseract({item['tesseract']['similarity']:.3f}): `{item['tesseract']['text']}`",
                        f"- EasyOCR({item['easyocr']['similarity']:.3f}): `{item['easyocr']['text']}`",
                        "- confirm:",
                    ]
                )
            )
            if len(rows) == limit:
                path = REPORT_DIR / f"{pdf}-review-batch-{batch:03d}.md"
                path.write_text(f"# OCR Review Batch {batch:03d}\n\n" + "\n\n".join(rows) + "\n", encoding="utf-8")
                batches.append(path)
                rows = []
                batch += 1
    if rows or not batches:
        path = REPORT_DIR / f"{pdf}-review-batch-{batch:03d}.md"
        path.write_text(f"# OCR Review Batch {batch:03d}\n\n" + "\n\n".join(rows) + "\n", encoding="utf-8")
        batches.append(path)
    return batches


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    pdf = sys.argv[1]
    start = int(sys.argv[2])
    end = int(sys.argv[3])

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    pages = [build_page(pdf, page) for page in range(start, end + 1)]
    review_count = sum(len(page["review"]) for page in pages)
    accepted_count = sum(page["accepted"] for page in pages)

    report = {
        "pdf": pdf,
        "range": [start, end],
        "acceptedCount": accepted_count,
        "reviewCount": review_count,
        "pages": pages,
    }
    json_path = REPORT_DIR / f"{pdf}-review.json"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_paths = write_markdown(pdf, pages)

    print(f"Wrote {json_path}")
    print(f"Wrote {len(md_paths)} markdown batch file(s)")
    print(json.dumps({"acceptedCount": accepted_count, "reviewCount": review_count}, ensure_ascii=False))
    worst = sorted(pages, key=lambda page: len(page["review"]), reverse=True)[:10]
    for page in worst:
        print(f"{pdf} p{page['page']:04d}: review={len(page['review'])} accepted={page['accepted']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
