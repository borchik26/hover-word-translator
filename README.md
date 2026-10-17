# Hover Word Translator

Tampermonkey userscripts for offline hover translation:
- **English → Russian:** `dist/hover-translator.user.js`
- **Chinese → Russian:** `dist/hover-translator-zh.user.js` (BiMM segmentation, pinyin with tone marks, BKRS and CC-CEDICT support)

The page DOM is never modified (one overlay host in a closed shadow root), dictionaries are
offline and ship via `@resource`.

## Install

### English version
Install `dist/hover-translator.user.js` in Tampermonkey. The dictionary (`dist/dict.json`, ~3.3 MB) is
downloaded by Tampermonkey from GitHub raw and refreshed when `@version` changes.

### Chinese version
Install `dist/hover-translator-zh.user.js` in Tampermonkey. Includes:
- **Bidirectional Maximum Matching (BiMM):** segmenting unspaced Chinese text directly against the active dictionary.
- **Pinyin with diacritics:** numeric tones converted to proper diacritic vowels.
- **Settings panel:** press **Alt+S** or use the extension menu to configure dictionary source (BKRS / CC-CEDICT), segmentation strategy, and visible article elements.

Menu (top frame):

- **Выключить на {host} / Включить на {host}** — per-site switch, synced across tabs.
- **Режим: cover / blur / tooltip** — opaque plate over the word, blurred word + bubble, or bubble only.
- **Догадки: вкл / выкл** — (English only) for words missing from the dictionary, show a `≈` guess from the stem.
- **⚙ Настройки (ZH)** — (Chinese only) opens the settings panel inside the isolated shadow root.
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

- **English:** `http://localhost:8000/test/fixture.html`
- **Chinese:** `http://localhost:8000/test/fixture-zh.html`

Rebuild without `DICT_URL` before committing — a local URL must never land in `dist/`.

## Known limitations

- Elements with an explicitly disallowed `lang` attribute (e.g. `lang="ru"`) are skipped; English script allows `lang="en*"` or empty, Chinese script allows `lang="zh*"` or `lang="en*"` or empty.
- Words split by markup (`<b>un</b>believable`), canvas editors and SVG `<text>` are not supported.
- Top-layer elements (`<dialog>`, fullscreen) are drawn above the overlay.
- A phrase wrapped over two lines covers only its first line.
- The script runs in every frame; each frame the mouse visits parses its own copy of the dictionary
  (~15 ms, ~1.5 MB of JSON), and a dictionary failure inside an iframe shows up only in that frame's
  console — the menu warning reflects the top frame.

## Attribution

- English: `dist/dict.json` is derived from Wiktionary (via kaikki.org / wiktextract) and FrequencyWords, both CC BY-SA 4.0 — see [dist/ATTRIBUTION.md](dist/ATTRIBUTION.md).
- Chinese: BKRS (Большой китайско-русский словарь, открытая база) и CC-CEDICT (Creative Commons Attribution-Share Alike 4.0).
