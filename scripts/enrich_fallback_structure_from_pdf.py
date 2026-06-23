#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
import subprocess
import tempfile
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CHAPTERS_PATH = ROOT / "data/bible-chapters.jsonl"
BOOKS_PATH = ROOT / "data/bible-books.json"
BIBLE_WORK = Path("/home/easy/git/bible")
RAW_SEGMENTS_PATH = BIBLE_WORK / "work/ocr_full/raw_segments.jsonl"
PDF_DIR = BIBLE_WORK
OUT_REPORT = ROOT / ".tmp/pdf-structure-enrichment.json"
RENDER_DIR = ROOT / ".tmp/pdf-pages"
OCR_CACHE_DIR = ROOT / ".tmp/pdf-page-ocr"
COL_SPLIT_X = 630

VERSE_COUNTS = {
    "출애굽기": [22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33, 18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38],
    "레위기": [17, 16, 17, 35, 19, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23, 55, 46, 34],
    "민수기": [54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30, 25, 18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13],
}


def norm_text(text):
    return re.sub(r"[^가-힣0-9A-Za-z]", "", text).lower()


def fix_ocr_anchor(text):
    fixes = {
        "야공": "야곱",
        "요심": "요셉",
        "이스리일": "이스라엘",
        "이스라일": "이스라엘",
        "하나남": "하나님",
        "한나님": "하나님",
        "틀": "를",
        "올": "을",
        "암": "않",
    }
    for src, dst in fixes.items():
        text = text.replace(src, dst)
    return text


def display_body(text):
    text = re.sub(r"\[\[[^\]]+\]\]\s*", " ", text)
    text = re.sub(r"\(\d{1,3}(?:-\d{1,3})?\)\s*", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def norm_with_map(text):
    chars = []
    idx_map = []
    for i, ch in enumerate(text):
        if re.match(r"[가-힣0-9A-Za-z]", ch):
            chars.append(ch.lower())
            idx_map.append(i)
    return "".join(chars), idx_map


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path, rows):
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows),
        encoding="utf-8",
    )


def load_raw_segments():
    raw = []
    by_page = defaultdict(list)
    for idx, line in enumerate(RAW_SEGMENTS_PATH.read_text(encoding="utf-8").splitlines()):
        seg = json.loads(line)
        seg["_idx"] = idx
        raw.append(seg)
        by_page[(seg["source_pdf"], int(seg["page"]))].append(seg)
    return raw, by_page


def grams(text, n=4, limit=120):
    normalized = norm_text(text)
    out = []
    for i in range(0, max(0, len(normalized) - n + 1), 2):
        g = normalized[i : i + n]
        if len(g) == n:
            out.append(g)
    seen = []
    used = set()
    for g in out:
        if g not in used:
            used.add(g)
            seen.append(g)
        if len(seen) >= limit:
            break
    return seen


def build_segment_index(raw):
    inv = defaultdict(list)
    for seg in raw:
        text = norm_text(seg.get("text", ""))
        if len(text) < 4:
            continue
        local = set(text[i : i + 4] for i in range(0, len(text) - 3, 2))
        for g in local:
            inv[g].append(seg["_idx"])
    return inv


def chapter_candidates(row, inv, raw, topn=48):
    sample = display_body(row["text"])[:900]
    sample_head = display_body(row["text"])[:180]
    head_grams = set(grams(sample_head, n=4, limit=60))
    gs = grams(sample)
    if not gs:
        return []
    buckets = Counter()
    for g in gs:
        hits = inv.get(g, [])
        if len(hits) > 1500:
            continue
        for idx in hits:
            buckets[(idx // 18) * 18] += 1
    candidates = []
    for start, hits in buckets.most_common(topn * 5):
        refined = start
        best_local = -1
        for i in range(start, min(len(raw), start + 36)):
            text = norm_text(raw[i].get("text", ""))
            local = set(text[j : j + 4] for j in range(0, max(0, len(text) - 3), 2))
            overlap = len(head_grams & local)
            if overlap > 0:
                refined = i
                best_local = overlap
                break
            if overlap > best_local:
                best_local = overlap
                refined = i
        pdf = raw[refined]["source_pdf"]
        page = int(raw[refined]["page"])
        score = hits / max(1, len(gs))
        candidates.append({
            "idx": refined,
            "score": round(score, 4),
            "pdf": pdf,
            "page": page,
            "raw_y0": int(raw[refined].get("y0", 0)),
        })
    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[:topn]


def choose_monotonic(cands_by_chapter, chapters):
    layers = []
    for ch in chapters:
        cands = cands_by_chapter.get(ch, [])
        if not cands:
            layers.append([])
            continue
        layers.append(cands)

    dp = []
    parent = []
    for i, cands in enumerate(layers):
        scores = []
        parents = []
        for cand in cands:
            base = cand["score"]
            if i == 0:
                scores.append(base)
                parents.append(None)
                continue
            best_score = -1e9
            best_j = None
            for j, prev in enumerate(layers[i - 1]):
                if j >= len(dp[i - 1]):
                    continue
                if prev["idx"] < cand["idx"]:
                    gap = cand["idx"] - prev["idx"]
                    gap_penalty = 0.0 if gap < 2200 else min(0.25, (gap - 2200) / 12000)
                    s = dp[i - 1][j] + base - gap_penalty
                    if s > best_score:
                        best_score = s
                        best_j = j
            scores.append(best_score)
            parents.append(best_j)
        dp.append(scores)
        parent.append(parents)

    if not dp or not dp[-1]:
        return {}
    j = max(range(len(dp[-1])), key=lambda k: dp[-1][k])
    chosen = {}
    for i in range(len(layers) - 1, -1, -1):
        if j is None or j >= len(layers[i]):
            break
        chosen[chapters[i]] = layers[i][j]
        j = parent[i][j]
    return chosen


def render_page(pdf, page):
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    out = RENDER_DIR / f"{Path(pdf).stem}-{page:04d}.png"
    if out.exists():
        return out
    with tempfile.TemporaryDirectory(dir=RENDER_DIR) as tmp:
        prefix = Path(tmp) / f"{Path(pdf).stem}-{page:04d}"
        subprocess.run(
            ["pdftoppm", "-f", str(page), "-l", str(page), "-png", "-r", "220", str(PDF_DIR / pdf), str(prefix)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=25,
        )
        matches = sorted(Path(tmp).glob("*.png"))
        if not matches:
            raise RuntimeError(f"render failed: {pdf}:{page}")
        Image.open(matches[0]).save(out)
    return out


def load_easyocr():
    import easyocr
    import torch

    return easyocr.Reader(
        ["ko"],
        gpu=torch.cuda.is_available(),
        model_storage_directory=str(BIBLE_WORK / "work/easyocr_models"),
        download_enabled=False,
        verbose=False,
    )


def ocr_page(reader, pdf, page):
    OCR_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = OCR_CACHE_DIR / f"{Path(pdf).stem}-{page:04d}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    image = render_page(pdf, page)
    rows = reader.readtext(
        str(image),
        detail=1,
        paragraph=False,
        text_threshold=0.3,
        low_text=0.2,
        link_threshold=0.2,
        canvas_size=2560,
        mag_ratio=2.0,
    )
    out = []
    for box, text, conf in rows:
        xs = [int(p[0]) for p in box]
        ys = [int(p[1]) for p in box]
        out.append({
            "pdf": pdf,
            "page": page,
            "text": str(text).strip(),
            "conf": float(conf),
            "x0": min(xs),
            "x1": max(xs),
            "y0": min(ys),
            "y1": max(ys),
        })
    cache_path.write_text(json.dumps(out, ensure_ascii=False) + "\n", encoding="utf-8")
    return out


def reading_key(row):
    col = 0 if row["x0"] < COL_SPLIT_X else 1
    return (row["page"], col, row["y0"], row["x0"])


def parse_marker(text, expected_start):
    s = re.sub(r"[^0-9\-]", "", text.replace("—", "-").replace("–", "-"))
    if not s:
        return None
    if "-" in s:
        parts = [p for p in s.split("-") if p]
        if len(parts) >= 2:
            a, b = int(parts[0]), int(parts[1])
            if 1 <= a <= b <= 176 and b - a <= 20:
                return a, b
        return None
    n = int(s)
    if len(s) >= 2 and str(expected_start) and s.startswith(str(expected_start)):
        tail = s[len(str(expected_start)) :]
        if tail:
            b = int(tail)
            if expected_start <= b <= min(176, expected_start + 20):
                return expected_start, b
    if expected_start >= 10 and n > expected_start and n <= expected_start + 8:
        return expected_start, n
    if n == expected_start:
        return n, n
    return None


def valid_for_chapter(book, chapter, start, end):
    counts = VERSE_COUNTS.get(book)
    if not counts or not (1 <= chapter <= len(counts)):
        return True
    max_verse = counts[chapter - 1]
    return 1 <= start <= end <= max_verse


def likely_marker(row):
    t = row["text"]
    if not re.search(r"\d", t):
        return False
    if re.search(r":|년|월|일|장", t):
        return False
    if row["y0"] < 520 or row["y0"] > 1840:
        return False
    if row["y1"] - row["y0"] > 80:
        return False
    if row["x0"] < 280 or 600 <= row["x0"] <= 760:
        return True
    return False


def likely_heading(row):
    text = row["text"].strip()
    if not (4 <= len(text) <= 34):
        return False
    if row["conf"] < 0.23:
        return False
    if row["y0"] < 450 or row["y0"] > 1840:
        return False
    if re.search(r"\d|[:()]|[.!?\"“”]", text):
        return False
    if len(norm_text(text)) < 4:
        return False
    width = row["x1"] - row["x0"]
    if width > 720:
        return False
    bad_terms = ("하나님께서", "말씀하셨다", "그들이", "그러나", "그리고", "되었다", "있었다", "말했다")
    if any(term in text for term in bad_terms) and width > 360:
        return False
    return True


def best_offset(anchor, chapter_text, min_after=0):
    anchor_norm = norm_text(fix_ocr_anchor(anchor))[:60]
    if len(anchor_norm) < 5:
        return None, 0.0
    text_norm, idx_map = norm_with_map(chapter_text)
    if not text_norm:
        return None, 0.0
    min_norm = 0
    while min_norm < len(idx_map) and idx_map[min_norm] < min_after:
        min_norm += 1
    for size in (18, 14, 10, 7, 5, 4, 3):
        needle = anchor_norm[:size]
        if len(needle) < size:
            continue
        pos = text_norm.find(needle, min_norm)
        if pos >= 0 and text_norm.find(needle, pos + 1) < 0:
            return idx_map[pos], 1.0
    window_len = min(max(len(anchor_norm) + 18, 26), 90)
    best = (None, 0.0)
    step = 8
    for pos in range(min_norm, max(min_norm + 1, len(text_norm) - window_len + 1), step):
        chunk = text_norm[pos : pos + window_len]
        ratio = SequenceMatcher(None, anchor_norm, chunk).ratio()
        if ratio > best[1]:
            best = (idx_map[pos], ratio)
    if best[1] >= 0.48:
        return best
    return None, best[1]


def is_word_boundary(text, offset):
    if offset <= 0:
        return True
    prev = text[offset - 1]
    if prev.isspace() or prev in "([{\"'“‘":
        return True
    if prev in ".!?。다요죠까라\"”’":
        return True
    return False


def next_body_anchor(rows, marker):
    same_col = [r for r in rows if (r["x0"] < COL_SPLIT_X) == (marker["x0"] < COL_SPLIT_X)]
    after = [
        r for r in same_col
        if r["page"] == marker["page"]
        and r["y0"] >= marker["y0"] - 12
        and r["y0"] <= marker["y0"] + 95
        and len(norm_text(r["text"])) >= 8
        and not likely_marker(r)
    ]
    if not after:
        after = [
            r for r in same_col
            if (r["page"], r["y0"]) > (marker["page"], marker["y0"])
            and len(norm_text(r["text"])) >= 8
            and not likely_marker(r)
        ][:2]
    after.sort(key=lambda r: (abs(r["y0"] - marker["y0"]), r["x0"]))
    return after[0]["text"] if after else ""


def collect_existing_headings(text):
    return re.findall(r"\[\[([^\]]+)\]\]", text)


def strip_leading_chapter_heading(text, chapter):
    m = re.match(rf"\s*{chapter}\s*장\s+(.{{2,40}}?)\s+(어느 날|하나님께서|하나님이|그들을|그 후|모세가|이스라엘|레위|야곱|아론)", text)
    if m:
        heading = re.sub(r"\s+", " ", m.group(1)).strip(" .")
        rest = (m.group(2) + text[m.end() :]).lstrip()
        if len(heading) >= 2 and rest:
            return rest, heading
    m = re.match(rf"\s*{chapter}\s*장\s+(.{{2,40}}?)(?:[.。]\s+|\n|\s{{2,}})", text)
    if not m:
        m = re.match(rf"\s*{chapter}\s*장\s+([가-힣0-9A-Za-z ,·ㆍ:：-]{{2,40}}?)(?=\s+[\"'“‘가-힣])", text)
    if not m:
        return text, None
    heading = re.sub(r"\s+", " ", m.group(1)).strip(" .")
    rest = text[m.end() :].lstrip()
    if len(heading) >= 2 and rest:
        return rest, heading
    return text, None


def first_body_offset(text):
    pos = 0
    while True:
        m = re.match(r"\s*\[\[[^\]]+\]\]\s*", text[pos:])
        if not m:
            break
        pos += m.end()
    while pos < len(text) and text[pos].isspace():
        pos += 1
    return pos


def insert_items(text, items):
    items = sorted(items, key=lambda item: (item["offset"], 0 if item["type"] == "heading" else 1))
    result = text
    delta = 0
    inserted_markers = set(re.findall(r"\((\d{1,3}(?:-\d{1,3})?)\)", text))
    inserted_headings = set(collect_existing_headings(text))
    for item in items:
        off = item["offset"] + delta
        if item["type"] == "marker":
            label = item["label"]
            if label in inserted_markers:
                continue
            prefix = f"({label}) "
            result = result[:off] + prefix + result[off:]
            delta += len(prefix)
            inserted_markers.add(label)
        else:
            label = item["label"]
            if label in inserted_headings:
                continue
            prefix = f"\n\n[[{label}]]\n"
            result = result[:off] + prefix + result[off:].lstrip()
            delta += len(prefix)
            inserted_headings.add(label)
    return re.sub(r"\n{3,}", "\n\n", result).strip()


def enrich_chapter(row, rows, allow_headings=False):
    text, prefix_heading = strip_leading_chapter_heading(row["text"], int(row["chapter"]))
    items = []
    report = {"headings": [], "markers": [], "unmatched": []}
    existing_headings = set(collect_existing_headings(text))
    if prefix_heading and prefix_heading not in existing_headings:
        items.append({"type": "heading", "label": prefix_heading, "offset": 0})
        report["headings"].append({"label": prefix_heading, "offset": 0, "source": "leading-prefix"})

    ordered = sorted(rows, key=reading_key)
    expected = 1
    last_offset = first_body_offset(text)
    for marker in [r for r in ordered if likely_marker(r)]:
        parsed = parse_marker(marker["text"], expected)
        if not parsed:
            continue
        a, b = parsed
        if not valid_for_chapter(row["book"], int(row["chapter"]), a, b):
            report["unmatched"].append({"type": "marker", "label": f"{a}-{b}" if a != b else str(a), "ocr": marker["text"], "reason": "outside-chapter-verse-count"})
            continue
        if a < expected or a > expected + 2:
            continue
        anchor = next_body_anchor(ordered, marker)
        off, score = best_offset(anchor, text, last_offset)
        label = str(a) if a == b else f"{a}-{b}"
        if off is None:
            report["unmatched"].append({"type": "marker", "label": label, "ocr": marker["text"], "anchor": anchor[:80], "score": round(score, 3)})
            continue
        if not is_word_boundary(text, off):
            report["unmatched"].append({"type": "marker", "label": label, "ocr": marker["text"], "anchor": anchor[:80], "score": round(score, 3), "reason": "not-word-boundary"})
            continue
        items.append({"type": "marker", "label": label, "offset": off})
        report["markers"].append({"label": label, "offset": off, "ocr": marker["text"], "anchor": anchor[:80], "score": round(score, 3)})
        expected = b + 1
        last_offset = max(last_offset, off)

    if report["markers"] and report["markers"][0]["label"].split("-", 1)[0] != "1":
        dropped = report["markers"]
        report["unmatched"].append({"type": "marker-group", "reason": "first-marker-not-one", "dropped": dropped})
        report["markers"] = []
        items = [item for item in items if item["type"] != "marker"]

    if not allow_headings:
        return (insert_items(text, items) if items else row["text"]), report

    marker_rows = [r for r in ordered if likely_marker(r)]

    def following_marker_for_heading(heading):
        for marker in marker_rows:
            if marker["page"] != heading["page"]:
                continue
            if (marker["x0"] < COL_SPLIT_X) != (heading["x0"] < COL_SPLIT_X):
                continue
            if 18 <= marker["y0"] - heading["y1"] <= 120:
                blocked = False
                for other in ordered:
                    if other is heading or other is marker:
                        continue
                    if other["page"] != heading["page"]:
                        continue
                    if (other["x0"] < COL_SPLIT_X) != (heading["x0"] < COL_SPLIT_X):
                        continue
                    if other["y0"] > heading["y1"] and other["y0"] < marker["y0"] and len(norm_text(other["text"])) >= 4:
                        blocked = True
                        break
                if not blocked:
                    return marker
        return None

    for heading in [r for r in ordered if likely_heading(r)]:
        following_marker = following_marker_for_heading(heading)
        if not following_marker:
            continue
        label = re.sub(r"\s+", " ", heading["text"]).strip()
        if label in existing_headings:
            continue
        anchor = next_body_anchor(ordered, following_marker)
        off, score = best_offset(anchor, text, 0)
        if off is None or score < 0.52:
            continue
        items.append({"type": "heading", "label": label, "offset": off})
        report["headings"].append({"label": label, "offset": off, "anchor": anchor[:80], "score": round(score, 3)})

    if not items:
        return row["text"], report
    new_text = insert_items(text, items)
    return new_text, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--books", nargs="*", help="Limit to specific Korean book names")
    parser.add_argument("--max-chapters", type=int, default=0)
    parser.add_argument("--start-page-only", action="store_true")
    parser.add_argument("--allow-headings", action="store_true")
    args = parser.parse_args()

    books = json.loads(BOOKS_PATH.read_text(encoding="utf-8"))
    book_chapters = {b["book"]: b["standardChapters"] for b in books}
    rows = read_jsonl(CHAPTERS_PATH)
    raw, _by_page = load_raw_segments()
    inv = build_segment_index(raw)

    row_by_key = {(r["book"], int(r["chapter"])): r for r in rows}
    targets = [
        r for r in rows
        if r.get("source_quality") == "fallback"
        and (not args.books or r["book"] in args.books)
    ]
    if args.max_chapters:
        targets = targets[: args.max_chapters]
    target_keys = {(r["book"], int(r["chapter"])) for r in targets}

    all_cands = {}
    chosen = {}
    for book in sorted({r["book"] for r in targets}, key=lambda b: next(x["order"] for x in books if x["book"] == b)):
        chapters = list(range(1, book_chapters[book] + 1))
        cands_by_chapter = {}
        for ch in chapters:
            row = row_by_key.get((book, ch))
            if not row:
                continue
            cands = chapter_candidates(row, inv, raw)
            cands_by_chapter[ch] = cands
            all_cands[f"{book} {ch}"] = cands[:5]
        chosen.update({(book, ch): cand for ch, cand in choose_monotonic(cands_by_chapter, chapters).items()})

    reader = load_easyocr()
    page_cache = {}
    updates = {}
    report = {"targets": len(targets), "changed": 0, "skipped": [], "chapters": {}}

    for book, ch in sorted(target_keys, key=lambda k: (next(x["order"] for x in books if x["book"] == k[0]), k[1])):
        cand = chosen.get((book, ch))
        next_cand = chosen.get((book, ch + 1))
        if not cand or cand["score"] < 0.18:
            report["skipped"].append({"book": book, "chapter": ch, "reason": "low-start-confidence", "candidate": cand})
            continue
        pages = {(cand["pdf"], cand["page"])}
        if args.start_page_only:
            pass
        elif next_cand and next_cand["pdf"] == cand["pdf"]:
            for page in range(cand["page"], min(next_cand["page"], cand["page"] + 4) + 1):
                pages.add((cand["pdf"], page))
        else:
            pages.add((cand["pdf"], cand["page"] + 1))
        ocr_rows = []
        for pdf, page in sorted(pages):
            key = (pdf, page)
            if key not in page_cache:
                try:
                    print(f"OCR {pdf}:{page} for {book} {ch}", flush=True)
                    page_cache[key] = ocr_page(reader, pdf, page)
                except Exception as exc:
                    page_cache[key] = []
                    report["skipped"].append({"book": book, "chapter": ch, "reason": f"ocr-page-failed:{exc}", "page": f"{pdf}:{page}"})
            ocr_rows.extend(page_cache[key])
        if cand.get("raw_y0"):
            # raw segment coordinates came from a higher-resolution OCR pass. At 220dpi
            # the y scale is about 0.86 on the scanned pages; leave room for a heading
            # and verse marker immediately above the first body line.
            start_cutoff = max(0, int(cand["raw_y0"] * 0.86) - 90)
            ocr_rows = [
                r for r in ocr_rows
                if r["page"] != cand["page"] or r["y0"] >= start_cutoff
            ]
        old = row_by_key[(book, ch)]["text"]
        new, detail = enrich_chapter(row_by_key[(book, ch)], ocr_rows, allow_headings=args.allow_headings)
        marker_count = len(detail["markers"])
        heading_count = len(detail["headings"])
        first_marker_starts_at_one = bool(detail["markers"]) and detail["markers"][0]["label"].split("-", 1)[0] == "1"
        changed = new != old
        # Avoid replacing with only noisy one-off marker insertions.
        if changed and (heading_count > 0 or (marker_count >= 2 and first_marker_starts_at_one) or re.match(r"\s*\d+\s*장\s+", old)):
            updates[(book, ch)] = new
            report["changed"] += 1
        else:
            changed = False
        report["chapters"][f"{book} {ch}"] = {
            "candidate": cand,
            "pages": [f"{p}:{pg}" for p, pg in sorted(pages)],
            "changed": changed,
            **detail,
        }

    OUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.apply and updates:
        for row in rows:
            key = (row["book"], int(row["chapter"]))
            if key in updates:
                row["text"] = updates[key]
        write_jsonl(CHAPTERS_PATH, rows)

    print(json.dumps({"targets": len(targets), "updates": len(updates), "applied": bool(args.apply), "report": str(OUT_REPORT)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
