#!/usr/bin/env python3
"""Build dist/dict-zh-bkrs.json and dist/dict-zh-cedict.json.

Python 3.9+, stdlib only.
Supports:
1. BKRS dump format (tab-separated: simplified/traditional pinyin [pos] translations).
2. CC-CEDICT format (traditional simplified [pinyin] /trans1/trans2/...) + en->ru translation map.
"""

import argparse
import gzip
import json
import os
import re
import sys
from typing import Dict, Iterable, List, Optional, Tuple

FORMAT_VERSION = 1
MAX_SENSES = 3
CJK_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")


def is_cjk(text: str) -> bool:
    return bool(text and CJK_RE.search(text))


def clean_sense(text: str) -> str:
    """Strips markup, cross-references and internal brackets from a sense string."""
    text = re.sub(r"\[/?(b|i|c|m\d?|p)\]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.strip("; ,.")
    return text


def parse_bkrs_line(line: str) -> Optional[Tuple[str, Dict]]:
    """Parses a single BKRS dump line.

    Typical dabkrs/bkrs format:
    `simplified [traditional] pinyin\ttranslation_body`
    or `word\tpinyin\ttranslation`
    or `word\ttranslation`
    """
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    parts = line.split("\t")
    if len(parts) < 2:
        return None

    head = parts[0].strip()
    if len(parts) >= 3 and not re.search(r"[Ѐ-ӿ]", parts[1]):
        # Format: word \t pinyin \t translation
        pinyin = parts[1].strip()
        body = "\t".join(parts[2:]).strip()
        head_match = re.match(r"^(\S+?)(?:\s+\[(\S+?)\])?$", head)
        if head_match:
            simp = head_match.group(1)
            trad = head_match.group(2) or simp
        else:
            simp = head
            trad = head
    else:
        body = "\t".join(parts[1:]).strip()
        head_match = re.match(r"^(\S+?)(?:\s+\[(\S+?)\])?(?:\s+([a-zA-Z0-9üÜ\s:]+))?$", head)
        if head_match:
            simp = head_match.group(1)
            trad = head_match.group(2) or simp
            pinyin = (head_match.group(3) or "").strip()
        else:
            tokens = head.split()
            simp = tokens[0]
            trad = simp
            pinyin = " ".join(tokens[1:]) if len(tokens) > 1 else ""

    if not is_cjk(simp):
        return None

    # Parse pos and senses from body
    pos = None
    pos_m = re.search(r"\[p\](.*?)\[/p\]|\b(сущ\.|прил\.|гл\.|межд\.|нареч\.|мест\.|союз|предл\.|сч\.\s*сл\.)", body)
    if pos_m:
        pos = (pos_m.group(1) or pos_m.group(2)).strip()

    # Senses: BKRS uses 1), 2) or [m1], [m2] or semicolons
    cleaned_body = re.sub(r"\[/?(b|i|c|p)\]", "", body)
    senses: List[str] = []
    # Split on numbered list markers
    num_parts = re.split(r"(?:^|\s)(?:\d+\)|\[m\d\]|\d+\.)\s*", cleaned_body)
    if len(num_parts) > 1:
        for p in num_parts:
            cs = clean_sense(p)
            if cs and not cs.startswith("[") and cs not in senses:
                senses.append(cs)
                if len(senses) >= MAX_SENSES:
                    break
    if not senses:
        for p in cleaned_body.split(";"):
            cs = clean_sense(p)
            if cs and cs not in senses:
                senses.append(cs)
                if len(senses) >= MAX_SENSES:
                    break

    if not senses:
        return None

    entry = {
        "p": pinyin,
        "t": senses[:MAX_SENSES],
        "trad": trad,
    }
    if pos:
        entry["pos"] = pos
    return simp, entry


def parse_cedict_line(line: str) -> Optional[Tuple[str, Dict]]:
    """Parses one CC-CEDICT line: `trad simp [pin1 yin1] /sense 1/sense 2/.../`"""
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    m = re.match(r"^(\S+)\s+(\S+)\s+\[(.*?)\]\s+/(.+)/\s*$", line)
    if not m:
        return None
    trad, simp, pinyin, raw_senses = m.groups()
    if not is_cjk(simp):
        return None

    senses = [clean_sense(s) for s in raw_senses.split("/") if clean_sense(s)]
    if not senses:
        return None

    return simp, {
        "p": pinyin.strip(),
        "t": senses[:MAX_SENSES],
        "trad": trad.strip(),
    }


def fuse_cedict_with_en_ru(
    cedict_entries: Dict[str, Dict],
    en_ru_map: Dict[str, List[str]],
) -> Dict[str, Dict]:
    """Translates CC-CEDICT's English senses into Russian using an en->ru dictionary."""
    fused = {}
    for word, entry in cedict_entries.items():
        ru_senses: List[str] = []
        for en_sense in entry["t"]:
            # Try exact match, then single lower-case words
            lower = en_sense.lower().strip()
            if lower in en_ru_map:
                ru_senses.extend(en_ru_map[lower])
            else:
                tokens = re.findall(r"[a-z]+", lower)
                for tok in tokens:
                    if tok in en_ru_map:
                        ru_senses.extend(en_ru_map[tok][:1])
                        break
        # If no Russian matches found, fallback to keeping English senses
        final_senses = ru_senses[:MAX_SENSES] if ru_senses else entry["t"]
        new_entry = dict(entry)
        new_entry["t"] = final_senses
        fused[word] = new_entry
    return fused


def build_bkrs(lines: Iterable[str]) -> Dict:
    words: Dict[str, Dict] = {}
    for line in lines:
        parsed = parse_bkrs_line(line)
        if not parsed:
            continue
        word, entry = parsed
        if word not in words:
            words[word] = entry
    return {"v": FORMAT_VERSION, "lang": "zh-ru", "w": words}


def build_cedict(lines: Iterable[str], en_ru_map: Optional[Dict[str, List[str]]] = None) -> Dict:
    words: Dict[str, Dict] = {}
    for line in lines:
        parsed = parse_cedict_line(line)
        if not parsed:
            continue
        word, entry = parsed
        if word not in words:
            words[word] = entry
    if en_ru_map:
        words = fuse_cedict_with_en_ru(words, en_ru_map)
    return {"v": FORMAT_VERSION, "lang": "zh-ru", "w": words}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Source dump path or - for stdin")
    parser.add_argument("--format", choices=["bkrs", "cedict"], required=True)
    parser.add_argument("--en-ru", help="Optional en->ru dict JSON path for CEDICT fusion")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    lines = sys.stdin if args.input == "-" else open(args.input, "r", encoding="utf-8", errors="replace")

    if args.format == "bkrs":
        result = build_bkrs(lines)
    else:
        en_ru = None
        if args.en_ru:
            with open(args.en_ru, "r", encoding="utf-8") as f:
                raw = json.load(f)
                en_ru = raw.get("w", {})
        result = build_cedict(lines, en_ru)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {args.out} with {len(result['w'])} entries")


if __name__ == "__main__":
    main()
