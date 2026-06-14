#!/usr/bin/env python3
"""Reduce OCR review candidates to one spell-checked candidate.

The script keeps raw review reports intact and writes resolved reports under:
  reports/ocr-consensus-resolved/<pdf>-resolved.json
  reports/ocr-consensus-resolved/<pdf>-resolved-batch-NNN.md

It uses Kiwi for Korean spacing/morphology, OCR-noise penalties, agreement
between OCR engines, and a low-weight phrase match against the existing app
Bible JSON as a reference corpus. The app JSON is not treated as truth.
"""
from __future__ import annotations

import difflib
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from kiwipiepy import Kiwi  # type: ignore
    from rapidfuzz import fuzz, process  # type: ignore
except ModuleNotFoundError as exc:
    raise SystemExit(
        "Missing dependency. Run: "
        "/home/easy/bible/new/ocr-venv/bin/python -m pip install kiwipiepy rapidfuzz"
    ) from exc


INPUT_DIR = Path("reports/ocr-consensus")
OUTPUT_DIR = Path("reports/ocr-consensus-resolved")
PUBLIC_BIBLE = Path("public/bible")
SCRIPT_RE = re.compile(r"[^0-9A-Za-z가-힣]+")
NOISE_RE = re.compile(r"[ㄱ-ㅎㅏ-ㅣ√_^`|~•●■□◆◇※]")
HANGUL_RE = re.compile(r"[가-힣]")
VERSE_PREFIX_RE = re.compile(r"^\s*(\d+(?:-\d+)?)\s*")
MATCH_CACHE: dict[str, tuple[str, float]] = {}


@dataclass
class Corpus:
    originals: list[str]
    compacts: list[str]
    words: set[str]


def normalize(text: str) -> str:
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    text = text.replace("…", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def compact(text: str) -> str:
    return SCRIPT_RE.sub("", normalize(text))


def similarity(a: str, b: str) -> float:
    aa = compact(a)
    bb = compact(b)
    if not aa and not bb:
        return 1.0
    if not aa or not bb:
        return 0.0
    return difflib.SequenceMatcher(None, aa, bb).ratio()


def strip_ocr_noise(text: str) -> str:
    value = normalize(text)
    value = re.sub(r"^[^0-9A-Za-z가-힣\"']+", "", value)
    value = re.sub(r"^[\"']{2,}\s*", "", value)
    value = re.sub(r"\s*[고느은는서]\s*$", "", value) if len(compact(value)) > 18 else value
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def apply_common_repairs(text: str) -> str:
    value = strip_ocr_noise(text)
    replacements = [
        ("말쓴", "말씀"),
        ("하져다", "하셨다"),
        ("하섯다", "하셨다"),
        ("하없다", "하셨다"),
        ("말있다", "말했다"),
        ("종고", "좋고"),
        ("종앉다", "좋았다"),
        ("좋있다", "좋았다"),
        ("좋있대", "좋았다"),
        ("낭앉다", "낳았다"),
        ("낮았다", "낳았다"),
        ("낭고", "낳고"),
        ("낮고", "낳고"),
        ("낭았다", "낳았다"),
        ("숨없다", "숨었다"),
        ("수어다", "숨었다"),
        ("동사나무", "동산 나무"),
        ("하나남", "하나님"),
        ("하니을", "하나님을"),
        ("모두실라", "므두셀라"),
        ("오배상", "오백 살"),
        ("세과하가아베우난아다", "셈과 함과 야벳을 낳았다"),
        ("아라란", "아라랏 산"),
        ("아라탓", "아라랏"),
        ("포도받", "포도밭"),
        ("아르박ㅅ", "아르박삿"),
        ("야벤", "야벳"),
        ("야켓", "야벳"),
        ("고델", "고멜"),
        ("이완", "야완"),
        ("하월라", "하윌라"),
        ("유밥", "요밥"),
        ("말쓴하셨다", "말씀하셨다"),
        ("빌들아", "빛들아"),
        ("빚들아", "빛들아"),
        ("내살중의샐 그", "내 살 중의 살!"),
        ("내살 중의 실", "내 살 중의 살!"),
        ("내살중의살", "내 살 중의 살"),
        ("이랄 낳고", "이랏을 낳고"),
        ("이랏을 낳고", "이랏을 낳고"),
        ("히나님", "하나님"),
        ("비깥", "바깥"),
        ("성음", "성읍"),
        ("포도발", "포도밭"),
        ("므낮세", "므낫세"),
        ("므낭세", "므낫세"),
        ("믿아들", "맏아들"),
    ]
    for source, target in replacements:
        value = value.replace(source, target)
    value = re.sub(r"(?<!성)읍(?=의|은|이|을|에게|과|도|$)", "욥", value)
    value = re.sub(r"옵(?=이|은|을|의|에게|도|$)", "욥", value)
    value = re.sub(r"([가-힣])([0-9])", r"\1 \2", value)
    value = re.sub(r"(\d+(?:-\d+)?)([가-힣])", r"\1 \2", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def load_corpus() -> Corpus:
    originals: list[str] = []
    words: set[str] = set()
    for path in sorted(PUBLIC_BIBLE.glob("*.json")):
        if path.name == "index.json":
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for chapter in data.get("chapters", []):
            text = normalize(chapter.get("text", ""))
            if not text:
                continue
            words.update(re.findall(r"[가-힣]{2,}", text))
            parts = re.split(r"(?<=[.!?다])\s+|\n+", text)
            for part in parts:
                part = normalize(part)
                if 8 <= len(compact(part)) <= 120:
                    originals.append(part)
    seen: set[str] = set()
    unique: list[str] = []
    for item in originals:
        key = compact(item)
        if key and key not in seen:
            seen.add(key)
            unique.append(item)
    return Corpus(unique, [compact(item) for item in unique], words)


def corpus_match(text: str, corpus: Corpus) -> tuple[str, float]:
    key = compact(text)
    if key in MATCH_CACHE:
        return MATCH_CACHE[key]
    if len(key) < 6 or not corpus.compacts:
        return "", 0.0
    result = process.extractOne(key, corpus.compacts, scorer=fuzz.ratio, score_cutoff=78)
    if not result:
        MATCH_CACHE[key] = ("", 0.0)
        return MATCH_CACHE[key]
    _, score, index = result
    original = corpus.originals[index]
    if abs(len(compact(original)) - len(key)) > max(14, len(key) * 0.8):
        score *= 0.82
    MATCH_CACHE[key] = (original, float(score) / 100.0)
    return MATCH_CACHE[key]


def kiwi_score(kiwi: Kiwi, text: str) -> float:
    value = normalize(text)
    key = compact(value)
    if not key:
        return -10.0
    tokens = kiwi.tokenize(value)
    if not tokens:
        return -5.0
    token_count = len(tokens)
    unk_count = sum(1 for token in tokens if token.tag in {"UNK", "W_UNKNOWN"})
    hangul_count = len(HANGUL_RE.findall(value))
    hangul_ratio = hangul_count / max(1, len(re.sub(r"\s+", "", value)))
    avg_len = len(key) / max(1, token_count)
    score = 0.0
    score += hangul_ratio * 2.0
    score += min(avg_len, 5.0) * 0.12
    score -= unk_count * 0.7
    score -= len(NOISE_RE.findall(value)) * 0.9
    if len(key) >= 14 and " " not in value:
        score -= 1.7
    if re.search(r"[가-힣]{14,}", value):
        score -= 1.2
    if value.count('"') % 2 == 1:
        score -= 0.15
    return score


def ocr_badness(text: str, corpus: Corpus) -> float:
    value = normalize(text)
    penalty = 0.0
    bad_fragments = [
        "에뉴",
        "이컷",
        "게텔",
        "메센",
        "믿아들",
        "맡아들",
        "히나님",
        "있시",
        "실리",
        "설리",
        "야켓",
        "하니",
        "하나남",
        "하져",
        "종앉",
        "낭앉",
        "수어다",
        "보니나연",
        "샐",
        "이랄",
        "남지",
        "포도발",
        "비깥",
        "므낭",
        "므낮",
    ]
    penalty += sum(1.25 for fragment in bad_fragments if fragment in value)
    penalty += len(NOISE_RE.findall(value)) * 1.1
    for word in re.findall(r"[가-힣]{2,}", value):
        if len(word) >= 3 and word not in corpus.words:
            penalty += 0.18
        if len(word) >= 7 and word not in corpus.words:
            penalty += 0.55
    if re.search(r"[가-힣]{12,}", value):
        penalty += 1.0
    if re.search(r"[가-힣](올|울)(\s|$|[.,:;])", value):
        penalty += 0.35
    if re.search(r"(ㄷ|ㄹ|ㅁ|ㅅ|ㅇ|ㅋ|ㅣ|ㆍ)", value):
        penalty += 1.0
    if re.search(r"[\s_ㆍ<>\-?]+$", value):
        penalty += 0.8
    if re.search(r"\s(고|그|는|은|를|을)$", value) and len(compact(value)) > 16:
        penalty += 0.45
    return penalty


def final_cleanup(text: str) -> str:
    value = apply_common_repairs(text)
    value = re.sub(r"\s*[_ㆍ<>\-?、。％%《「」Ｌ]\s*$", "", value)
    value = re.sub(r"\s{2,}", " ", value)
    value = re.sub(r"([가-힣])([,.!?])", r"\1\2", value)
    value = re.sub(r"([,.!?])([가-힣])", r"\1 \2", value)
    return value.strip()


def candidate_variants(raw: str, kiwi: Kiwi) -> list[str]:
    variants = []
    for text in [raw, strip_ocr_noise(raw), apply_common_repairs(raw)]:
        text = normalize(text)
        if text and text not in variants:
            variants.append(text)
        try:
            spaced = normalize(kiwi.space(text))
            if spaced and spaced not in variants:
                variants.append(spaced)
        except Exception:
            pass
    return variants


def agreement_bonus(text: str, peers: list[str]) -> float:
    if not peers:
        return 0.0
    return max(similarity(text, peer) for peer in peers) * 1.2


def resolve_item(item: dict, kiwi: Kiwi, corpus: Corpus) -> dict:
    raw_candidates = [
        ("Paddle", item.get("text", ""), float(item.get("confidence", 0.0))),
        ("Tesseract", item.get("tesseract", {}).get("text", ""), item.get("tesseract", {}).get("similarity", 0.0)),
        ("EasyOCR", item.get("easyocr", {}).get("text", ""), item.get("easyocr", {}).get("similarity", 0.0)),
    ]
    raw_candidates = [(name, text, signal) for name, text, signal in raw_candidates if compact(text)]
    scored = []
    raw_texts = [text for _, text, _ in raw_candidates]
    for name, raw, signal in raw_candidates:
        for variant in candidate_variants(raw, kiwi):
            match_text, match_score = corpus_match(variant, corpus)
            natural = kiwi_score(kiwi, variant)
            score = natural + agreement_bonus(variant, [peer for peer in raw_texts if peer != raw])
            score += min(float(signal), 1.0) * (0.35 if name == "Paddle" else 0.22)
            score += {"Tesseract": 0.28, "Paddle": 0.06, "EasyOCR": -0.12}.get(name, 0.0)
            score += match_score * 0.65
            if match_score >= 0.93:
                score += 0.55
            score -= ocr_badness(variant, corpus)
            scored.append(
                {
                    "source": name,
                    "text": variant,
                    "score": round(score, 4),
                    "kiwiScore": round(natural, 4),
                    "corpusMatch": match_text,
                    "corpusScore": round(match_score, 4),
                }
            )

    dedup: dict[str, dict] = {}
    for candidate in scored:
        key = compact(candidate["text"])
        if key not in dedup or candidate["score"] > dedup[key]["score"]:
            dedup[key] = candidate
    ranked = sorted(dedup.values(), key=lambda candidate: candidate["score"], reverse=True)

    if not ranked:
        selected = ""
        selected_source = "none"
    else:
        selected = ranked[0]["text"]
        selected_source = ranked[0]["source"]
        best_match = ranked[0].get("corpusMatch", "")
        best_match_score = float(ranked[0].get("corpusScore", 0.0))
        if best_match and best_match_score >= 0.95:
            selected = best_match
            selected_source = f"{selected_source}+corpus"
    selected = final_cleanup(selected)

    eliminated = [
        {
            "source": candidate["source"],
            "text": candidate["text"],
            "score": candidate["score"],
        }
        for candidate in ranked[1:6]
    ]
    return {
        **item,
        "selected": selected,
        "selectedSource": selected_source,
        "selectedScore": ranked[0]["score"] if ranked else None,
        "eliminated": eliminated,
        "ranked": ranked[:8],
    }


def write_markdown(pdf: str, pages: list[dict], limit: int = 80) -> list[Path]:
    for old in OUTPUT_DIR.glob(f"{pdf}-resolved-batch-*.md"):
        old.unlink()
    paths: list[Path] = []
    rows: list[str] = []
    count = 0
    batch = 1
    for page in pages:
        for item in page["review"]:
            count += 1
            eliminated = "\n".join(
                f"  - {candidate['source']}({candidate['score']}): `{candidate['text']}`"
                for candidate in item.get("eliminated", [])[:3]
            )
            rows.append(
                "\n".join(
                    [
                        f"## {count}. {pdf} p{page['page']:04d} q{item['q']}",
                        f"- image: `{item['crop']}`",
                        f"- reasons: `{', '.join(item['reasons'])}`",
                        f"- confirm: `{item['selected']}`",
                        f"- selected: `{item['selectedSource']}` score `{item['selectedScore']}`",
                        "- eliminated:",
                        eliminated or "  - none",
                    ]
                )
            )
            if len(rows) == limit:
                path = OUTPUT_DIR / f"{pdf}-resolved-batch-{batch:03d}.md"
                path.write_text(f"# OCR Resolved Batch {batch:03d}\n\n" + "\n\n".join(rows) + "\n", encoding="utf-8")
                paths.append(path)
                rows = []
                batch += 1
    if rows or not paths:
        path = OUTPUT_DIR / f"{pdf}-resolved-batch-{batch:03d}.md"
        path.write_text(f"# OCR Resolved Batch {batch:03d}\n\n" + "\n\n".join(rows) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


def resolve_pdf(pdf: str, kiwi: Kiwi, corpus: Corpus) -> dict:
    input_path = INPUT_DIR / f"{pdf}-review.json"
    data = json.loads(input_path.read_text(encoding="utf-8"))
    pages = []
    resolved_count = 0
    for page in data["pages"]:
        review = [resolve_item(item, kiwi, corpus) for item in page["review"]]
        resolved_count += len(review)
        pages.append({**page, "review": review})
    report = {**data, "resolvedCount": resolved_count, "pages": pages}
    out_json = OUTPUT_DIR / f"{pdf}-resolved.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_paths = write_markdown(pdf, pages)
    return {
        "pdf": pdf,
        "resolvedCount": resolved_count,
        "batchCount": len(md_paths),
        "json": str(out_json),
    }


def main() -> int:
    pdfs = sys.argv[1:] or list("abcde")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    kiwi = Kiwi()
    corpus = load_corpus()
    summaries = [resolve_pdf(pdf, kiwi, corpus) for pdf in pdfs]
    print(json.dumps(summaries, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
