#!/usr/bin/env python3
"""Run a second OCR engine and compare it with existing Tesseract drafts.

This script does not modify app Bible JSON. It writes:
  /home/easy/bible/new/ocr_<engine>/<pdf>/pNNNN.txt
  reports/dual-ocr/<pdf>-pages.json

Usage:
  /home/easy/bible/new/ocr-venv/bin/python scripts/dual_ocr_verify.py --engine paddle a 53 54 73 80

PaddleOCR note:
  paddlepaddle 3.3.1 failed on this machine in the detection stage.
  The working local combination was paddleocr 3.7.0 + paddlepaddle 3.2.2 + numpy 2.3.x.
"""
from __future__ import annotations

import difflib
import json
import re
import sys
from pathlib import Path

BASE = Path("/home/easy/bible/new")
CROPS = BASE / "crops"
TESS_OCR = BASE / "ocr"
REPORT_DIR = Path("reports/dual-ocr")


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
    return difflib.SequenceMatcher(None, aa, bb).ratio()


def load_easyocr():
    try:
        import easyocr  # type: ignore
    except ModuleNotFoundError:
        raise SystemExit(
            "easyocr is not installed. Run with "
            "/home/easy/bible/new/ocr-venv/bin/python after installing EasyOCR."
        )
    return easyocr.Reader(["ko", "en"], gpu=False, verbose=False)


def load_paddleocr():
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except ModuleNotFoundError:
        raise SystemExit("paddleocr is not installed in this Python environment.")
    return PaddleOCR(
        lang="korean",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


def read_easy_page(reader, pdf: str, page: int, engine: str) -> tuple[str, list[dict]]:
    out_dir = BASE / f"ocr_{engine}" / pdf
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"p{page:04d}.txt"
    out_json = out_dir / f"p{page:04d}.json"

    if out_file.exists() and out_json.exists():
        return out_file.read_text(encoding="utf-8"), json.loads(out_json.read_text(encoding="utf-8"))

    page_items: list[dict] = []
    chunks: list[str] = []
    for q in range(1, 5):
        image = CROPS / pdf / f"p{page:04d}_q{q}.png"
        if not image.exists():
            continue
        results = reader.readtext(str(image), detail=1, paragraph=False)
        chunks.append(f"===== [q{q}] =====")
        for box, text, conf in results:
            item = {
                "q": q,
                "text": text,
                "confidence": float(conf),
                "box": [[float(x), float(y)] for x, y in box],
            }
            page_items.append(item)
            chunks.append(text)

    page_text = "\n".join(chunks).strip() + "\n"
    out_file.write_text(page_text, encoding="utf-8")
    out_json.write_text(json.dumps(page_items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return page_text, page_items


def read_paddle_page(reader, pdf: str, page: int, engine: str) -> tuple[str, list[dict]]:
    out_dir = BASE / f"ocr_{engine}" / pdf
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"p{page:04d}.txt"
    out_json = out_dir / f"p{page:04d}.json"

    if out_file.exists() and out_json.exists():
        return out_file.read_text(encoding="utf-8"), json.loads(out_json.read_text(encoding="utf-8"))

    page_items: list[dict] = []
    chunks: list[str] = []
    for q in range(1, 5):
        image = CROPS / pdf / f"p{page:04d}_q{q}.png"
        if not image.exists():
            continue
        chunks.append(f"===== [q{q}] =====")
        for result in reader.predict(str(image)):
            texts = result.get("rec_texts", [])
            scores = result.get("rec_scores", [])
            boxes = result.get("rec_boxes", [])
            for i, text in enumerate(texts):
                score = float(scores[i]) if i < len(scores) else 0.0
                box = boxes[i].tolist() if i < len(boxes) and hasattr(boxes[i], "tolist") else []
                item = {
                    "q": q,
                    "text": text,
                    "confidence": score,
                    "box": box,
                }
                page_items.append(item)
                chunks.append(text)

    page_text = "\n".join(chunks).strip() + "\n"
    out_file.write_text(page_text, encoding="utf-8")
    out_json.write_text(json.dumps(page_items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return page_text, page_items


def low_confidence_items(items: list[dict], limit: int = 30) -> list[dict]:
    lows = [
        {
            "q": item["q"],
            "confidence": round(item["confidence"], 3),
            "text": item["text"],
        }
        for item in items
        if item.get("confidence", 1.0) < 0.45 and re.search(r"[가-힣]", item.get("text", ""))
    ]
    return lows[:limit]


def compare_page(reader, engine: str, pdf: str, page: int) -> dict:
    tess_file = TESS_OCR / pdf / f"p{page:04d}.txt"
    tess_text = tess_file.read_text(encoding="utf-8") if tess_file.exists() else ""
    if engine == "easy":
        engine_text, engine_items = read_easy_page(reader, pdf, page, engine)
    elif engine == "paddle":
        engine_text, engine_items = read_paddle_page(reader, pdf, page, engine)
    else:
        raise SystemExit(f"Unsupported engine: {engine}")
    sim = similarity(tess_text, engine_text)
    return {
        "pdf": pdf,
        "page": page,
        "tesseractChars": len(compact(tess_text)),
        f"{engine}Chars": len(compact(engine_text)),
        "similarity": round(sim, 4),
        "needsReview": sim < 0.82 or len(compact(engine_text)) < len(compact(tess_text)) * 0.55,
        "lowConfidenceOCR": low_confidence_items(engine_items),
        "tesseractSample": normalize(tess_text)[:500],
        f"{engine}Sample": normalize(engine_text)[:500],
    }


def main() -> int:
    args = sys.argv[1:]
    engine = "easy"
    if args[:2] == ["--engine", "easy"] or args[:2] == ["--engine", "paddle"]:
        engine = args[1]
        args = args[2:]

    if len(args) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    pdf = args[0]
    pages = [int(arg) for arg in args[1:]]
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    reader = load_easyocr() if engine == "easy" else load_paddleocr()
    results = [compare_page(reader, engine, pdf, page) for page in pages]
    summary = {
        "pdf": pdf,
        "pages": pages,
        "engineA": "tesseract kor traineddata",
        "engineB": "EasyOCR ko+en" if engine == "easy" else "PaddleOCR korean PP-OCRv5",
        "pageCount": len(results),
        "reviewCount": sum(1 for item in results if item["needsReview"]),
        "avgSimilarity": round(sum(item["similarity"] for item in results) / len(results), 4),
        "results": results,
    }

    report = REPORT_DIR / f"{pdf}-{engine}-pages.json"
    report.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {report}")
    print(
        json.dumps(
            {
                "pageCount": summary["pageCount"],
                "reviewCount": summary["reviewCount"],
                "avgSimilarity": summary["avgSimilarity"],
            },
            ensure_ascii=False,
        )
    )
    for item in results:
        status = "REVIEW" if item["needsReview"] else "ok"
        print(f"{pdf} p{item['page']:04d}: {status} similarity={item['similarity']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
