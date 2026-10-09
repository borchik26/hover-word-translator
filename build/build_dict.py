#!/usr/bin/env python3
"""Build dist/dict.json from a kaikki.org (wiktextract) English JSONL dump.

Usage:
    python3 build/build_dict.py DUMP --freq build/data/en_50k.txt --out dist/dict.json [--top N]

DUMP may be a path, a .gz path, or "-" for stdin, so the 3 GB dump can be
streamed: curl -sS <kaikki url> | python3 build/build_dict.py - --freq ...

Python 3.9, stdlib only. The dump is read line by line; only entries whose
words pass the frequency filter are kept in memory.
"""

import argparse
import gzip
import io
import json
import re
import sys
from typing import Dict, Iterable, List, Optional, Tuple

FORMAT_VERSION = 1
MAX_TRANSLATIONS = 2
MAX_PHRASE_WORDS = 3
SKIP_FORM_TAGS = {"romanization", "table-tags", "inflection-template"}
# Rare spellings would hijack frequent words (`the` is an obsolete form of `they`).
NONSTANDARD_TAGS = {"alternative", "obsolete", "archaic", "dialectal", "nonstandard", "misspelling"}
# Same token shape the userscript uses; keys that can never be hovered are dropped.
TOKEN_RE = re.compile(r"[A-Za-z]+(?:['-][A-Za-z]+)*\Z")
STRESS_RE = re.compile("[\u0300\u0301]")  # stress marks in ru translations
LATIN_RE = re.compile("[A-Za-z]")  # editor notes leaking into ru translations ("but see США")


def load_freq(lines: Iterable[str], top: Optional[int] = None) -> Dict[str, int]:
    """`word count` lines → {word: rank}, rank 0 is the most frequent."""
    ranks = {}  # type: Dict[str, int]
    for line in lines:
        if top is not None and len(ranks) >= top:
            break
        parts = line.split()
        if parts and parts[0] not in ranks:
            ranks[parts[0]] = len(ranks)
    return ranks


def word_rank(word: str, ranks: Dict[str, int]) -> Optional[int]:
    """Rank of a single word, or None if it is not frequent enough.

    FrequencyWords splits contractions (`don't` → `don`, `t`), so a word with
    apostrophes passes when every part does.
    """
    lower = word.lower()
    if lower in ranks:
        return ranks[lower]
    if "'" in lower:
        parts = lower.split("'")
        if all(p in ranks for p in parts):
            return max(ranks[p] for p in parts)
    return None


def ru_translations(entry: dict) -> List[Tuple[str, str]]:
    """(sense group, word) pairs for Russian translations, sense level first.

    Sense-level translations follow sense order (main sense first); word-level
    ones are the tables wiktextract could not attach to a sense, so they rank last.
    """
    out = []  # type: List[Tuple[str, str]]
    for i, sense in enumerate(entry.get("senses") or []):
        for t in sense.get("translations") or []:
            if (t.get("lang_code") or t.get("code")) == "ru" and t.get("word"):
                out.append(("s%d" % i, t["word"]))
    for t in entry.get("translations") or []:
        if (t.get("lang_code") or t.get("code")) == "ru" and t.get("word"):
            out.append(("w:" + (t.get("sense") or ""), t["word"]))
    return out


def pick_translation(pairs: List[Tuple[str, str]]) -> str:
    """First Russian word of each sense group, deduplicated, at most two."""
    seen_groups = set()
    picked = []  # type: List[str]
    for group, word in pairs:
        word = STRESS_RE.sub("", word).strip()
        if group in seen_groups or not word or LATIN_RE.search(word):
            continue
        seen_groups.add(group)
        if word not in picked:
            picked.append(word)
            if len(picked) == MAX_TRANSLATIONS:
                break
    return ", ".join(picked)


def build(lines: Iterable[str], ranks: Dict[str, int]) -> dict:
    words = {}  # type: Dict[str, List[Tuple[str, str]]]
    phrases = {}  # type: Dict[str, List[Tuple[str, str]]]
    form_candidates = {}  # type: Dict[str, List[str]]

    for n, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        entry = json.loads(line)
        if entry.get("lang_code") != "en":
            continue
        word = entry.get("word") or ""
        tokens = word.split()
        if not tokens or len(tokens) > MAX_PHRASE_WORDS:
            continue
        if not all(TOKEN_RE.match(t) and word_rank(t, ranks) is not None for t in tokens):
            continue
        # Entry index keeps sense groups of different entries apart.
        pairs = [("%d:%s" % (n, g), w) for g, w in ru_translations(entry)]

        if len(tokens) > 1:
            if pairs:
                phrases.setdefault(" ".join(tokens).lower(), []).extend(pairs)
            continue

        if pairs:
            words.setdefault(word, []).extend(pairs)
        for sense in entry.get("senses") or []:
            if NONSTANDARD_TAGS.intersection(sense.get("tags") or []):
                continue
            for f in sense.get("form_of") or []:
                if f.get("word"):
                    form_candidates.setdefault(word, []).append(f["word"])
        for f in entry.get("forms") or []:
            form = f.get("form") or ""
            if (SKIP_FORM_TAGS | NONSTANDARD_TAGS).intersection(f.get("tags") or []):
                continue
            if TOKEN_RE.match(form) and word_rank(form, ranks) is not None:
                form_candidates.setdefault(form, []).append(word)

    w = {k: pick_translation(v) for k, v in words.items()}
    w = {k: v for k, v in w.items() if v}
    p = {k: pick_translation(v) for k, v in phrases.items()}
    p = {k: v for k, v in p.items() if v}

    f = {}  # type: Dict[str, str]
    for form, lemmas in form_candidates.items():
        if form in w:
            continue
        known = [lemma for lemma in lemmas if lemma in w and lemma != form]
        if known:
            # min() keeps the first-seen lemma on equal rank.
            f[form] = min(known, key=lambda lemma: word_rank(lemma, ranks))

    return {"v": FORMAT_VERSION, "w": w, "f": f, "p": p}


def open_dump(path: str):
    if path == "-":
        return io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    if path.endswith(".gz"):
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dump", help="kaikki JSONL (.jsonl, .jsonl.gz or - for stdin)")
    parser.add_argument("--freq", required=True, help="FrequencyWords list (word count)")
    parser.add_argument("--out", required=True, help="output dict.json")
    parser.add_argument("--top", type=int, default=None, help="use only the top N frequency words")
    args = parser.parse_args(argv)

    with open(args.freq, encoding="utf-8") as fh:
        ranks = load_freq(fh, args.top)
    with open_dump(args.dump) as fh:
        result = build(fh, ranks)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(
        "w=%d f=%d p=%d → %s" % (len(result["w"]), len(result["f"]), len(result["p"]), args.out),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
