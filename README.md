# Hover Word Translator

Tampermonkey userscript: hover an English word or set phrase and its Russian translation appears over
it. The page DOM is never modified (one overlay host in a closed shadow root), the dictionary is
offline and ships via `@resource`.

## Install

Install `dist/hover-translator.user.js` in Tampermonkey. The dictionary (`dist/dict.json`, ~3.3 MB) is
downloaded by Tampermonkey from GitHub raw and refreshed when `@version` changes.

Menu (top frame):

- **Выключить на {host} / Включить на {host}** — per-site switch, synced across tabs.
- **Режим: cover / blur / tooltip** — opaque plate over the word, blurred word + bubble, or bubble only.
- **Догадки: вкл / выкл** — for words missing from the dictionary, show a `≈` guess from the stem
  (analyzer → analyze, deployable → deploy) or from two dictionary words (codebase → code + base).
- **⚠ Словарь не загружен** — shown when the `@resource` is missing or broken.

## Build the dictionary

Python 3.9+, stdlib only. Sources go to `build/data/` (git-ignored):

```bash
curl -L -o build/data/en_50k.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
```

```bash
curl -L -o build/data/kaikki.jsonl https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl
```

```bash
python3 build/build_dict.py build/data/kaikki.jsonl --freq build/data/en_50k.txt --out dist/dict.json
```

The 3 GB dump can also be streamed without saving it: pass `-` as the dump path and pipe `curl` into
the script. The frequency list only filters phrases and picks the most frequent lemma
of an ambiguous form; `--top N` limits it. Bump `@version` in `src/header.txt` after every
dictionary change.

## Develop

```bash
python3 -m unittest discover -s build/tests -t build
```

```bash
node --test test/core.test.mjs
```

```bash
node scripts/bench-dict.mjs
```

```bash
node scripts/bundle.mjs
```

`src/core.js` holds the pure logic (tokenizer, lookup, hit-test, positioning, menu helpers) and is
shared by the bundle and the tests; `src/main.js` is the browser runtime.

### Manual check

```bash
DICT_URL=http://localhost:8000/dist/dict.json node scripts/bundle.mjs
```

```bash
python3 -m http.server 8000
```

Install the local build, open `http://localhost:8000/test/fixture.html` and go through scenarios
A1–A20 (A12 lives in `test/fixture-csp.html`). Rebuild without `DICT_URL` before committing — a
local URL must never land in `dist/`.

## Known limitations

- Only elements without `lang` or with an English `lang` are translated (a page with `<html lang="ru">` is skipped).
- Words split by markup (`<b>un</b>believable`), canvas editors and SVG `<text>` are not supported.
- Top-layer elements (`<dialog>`, fullscreen) are drawn above the overlay.
- A phrase wrapped over two lines covers only its first line.
- The script runs in every frame; each frame the mouse visits parses its own copy of the dictionary
  (~15 ms, ~1.5 MB of JSON), and a dictionary failure inside an iframe shows up only in that frame's
  console — the menu warning reflects the top frame.

## Attribution

`dist/dict.json` is derived from Wiktionary (via kaikki.org / wiktextract) and FrequencyWords, both
CC BY-SA 4.0 — see [dist/ATTRIBUTION.md](dist/ATTRIBUTION.md).
