// Pure logic shared by the userscript and `node --test`: no DOM, no GM_* APIs.
const Core = (() => {
  const WINDOW = 64; // chars on each side of the caret fed to the tokenizer
  const EXTEND = 64; // extra chars allowed to finish a word cut by the window
  const TOKEN_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;
  const DROP_RE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/; // soft hyphen, zero-width
  const SPACE_RE = /\s/; // includes NBSP
  const EDGE_PUNCT_RE = /^[^A-Za-z0-9@/]+|[^A-Za-z0-9@/]+$/g;
  const NOT_PROSE_RE = /[0-9@/]|[A-Za-z]\.[A-Za-z]/; // numbers, emails, URLs, domains
  const SENTENCE_END_RE = /[.!?]/;
  const OPENERS_RE = /[\s"'“‘«(\[]/;
  const MODES = ['cover', 'blur', 'tooltip'];
  const has = Object.hasOwn;

  /** Normalizes typography; map[i] is the index in `text` of normalized char i. */
  function normalize(text) {
    let out = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      let ch = text[i];
      if (DROP_RE.test(ch)) continue;
      if (SPACE_RE.test(ch)) {
        if (out.endsWith(' ')) continue;
        ch = ' ';
      } else if (ch === '’') {
        ch = "'";
      }
      out += ch;
      map.push(i);
    }
    return { text: out, map };
  }

  /** [start, end) slice around `offset` that the tokenizer may look at. */
  function windowAround(text, offset) {
    let start = Math.max(0, offset - WINDOW);
    let end = Math.min(text.length, offset + WINDOW);
    const minStart = Math.max(0, start - EXTEND);
    const maxEnd = Math.min(text.length, end + EXTEND);
    while (start > minStart && !SPACE_RE.test(text[start - 1])) start--;
    while (end < maxEnd && !SPACE_RE.test(text[end])) end++;
    return [start, end];
  }

  function tokensOf(text) {
    const toks = [];
    for (const m of text.matchAll(TOKEN_RE)) {
      toks.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
    return toks;
  }

  /** Index of the token under the caret; `offset === end` counts (right half of the last letter). */
  function cursorIndex(toks, offset) {
    let k = toks.findIndex((t) => t.start <= offset && offset < t.end);
    if (k < 0) k = toks.findIndex((t) => t.end === offset);
    return k;
  }

  /** True when the token is part of a number, email, URL or other non-prose chunk. */
  function notProse(text, tok) {
    let a = tok.start;
    let b = tok.end;
    while (a > 0 && text[a - 1] !== ' ') a--;
    while (b < text.length && text[b] !== ' ') b++;
    return NOT_PROSE_RE.test(text.slice(a, b).replace(EDGE_PUNCT_RE, ''));
  }

  function scan(text, offset) {
    const toks = tokensOf(text);
    const k = cursorIndex(toks, offset);
    if (k < 0 || notProse(text, toks[k])) return null;
    return { toks, k };
  }

  /** Token under `offset` in already normalized text, or null. */
  function tokenAt(text, offset) {
    const [ws, we] = windowAround(text, offset);
    const found = scan(text.slice(ws, we), offset - ws);
    if (!found) return null;
    const tok = found.toks[found.k];
    return { start: ws + tok.start, end: ws + tok.end, text: tok.text };
  }

  function resolve(dict, key) {
    if (has(dict.w, key)) return { source: key, translation: dict.w[key] };
    if (has(dict.f, key) && has(dict.w, dict.f[key])) {
      return { source: dict.f[key], translation: dict.w[dict.f[key]] };
    }
    return null;
  }

  function findPhrase(dict, text, toks, k) {
    for (const n of [3, 2]) {
      for (let i = k - n + 1; i <= k; i++) {
        if (i < 0 || i + n > toks.length) continue;
        const run = toks.slice(i, i + n);
        // Only a single space may separate phrase words: punctuation breaks the phrase.
        const joined = run.every((t, j) => j === 0 || text.slice(run[j - 1].end, t.start) === ' ');
        if (!joined) continue;
        const key = run.map((t) => t.text.toLowerCase()).join(' ');
        if (has(dict.p, key)) {
          return { start: run[0].start, end: run[n - 1].end, source: key, translation: dict.p[key] };
        }
      }
    }
    return null;
  }

  function atSentenceStart(text, pos, windowAtTextStart) {
    let i = pos;
    while (i > 0 && OPENERS_RE.test(text[i - 1])) i--;
    return i === 0 ? windowAtTextStart : SENTENCE_END_RE.test(text[i - 1]);
  }

  function findWord(dict, tok, offset, sentenceStart) {
    const t = tok.text;
    const lower = t.toLowerCase();
    const caps = t.length >= 2 && t === t.toUpperCase();
    let keys;
    if (caps) keys = t.length >= 4 ? [t, lower] : [t]; // short CAPS are acronyms: US ≠ us
    else if (t === lower) keys = [t];
    else keys = sentenceStart ? [lower, t] : [t, lower]; // "Will you" vs "the Polish army"
    for (const key of keys) {
      const hit = resolve(dict, key);
      if (hit) return { start: tok.start, end: tok.end, ...hit };
    }
    if (/'s$/i.test(t)) {
      const base = { start: tok.start, end: tok.end - 2, text: t.slice(0, -2) };
      return findWord(dict, base, Math.min(offset, base.end), sentenceStart);
    }
    if (t.includes('-')) {
      let start = tok.start;
      for (const part of t.split('-')) {
        const end = start + part.length;
        if (start <= offset && offset <= end) {
          return findWord(dict, { start, end, text: part }, offset, sentenceStart && start === tok.start);
        }
        start = end + 1;
      }
    }
    return null;
  }

  /** Translation for the word or phrase at `offset` of a raw text node, with raw offsets. */
  function lookup(dict, text, offset) {
    const [ws, we] = windowAround(text, offset);
    const n = normalize(text.slice(ws, we));
    let off = n.map.findIndex((i) => i >= offset - ws);
    if (off < 0) off = n.map.length;
    const found = scan(n.text, off);
    if (!found) return null;
    const { toks, k } = found;
    const hit =
      findPhrase(dict, n.text, toks, k) ||
      findWord(dict, toks[k], off, atSentenceStart(n.text, toks[k].start, ws === 0));
    if (!hit) return null;
    return {
      start: ws + n.map[hit.start],
      end: ws + n.map[hit.end - 1] + 1,
      source: hit.source,
      translation: hit.translation,
    };
  }

  function isPlainObject(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  function validateDict(d) {
    return isPlainObject(d) && d.v === 1 && isPlainObject(d.w) && isPlainObject(d.f) && isPlainObject(d.p);
  }

  function pointInRects(x, y, rects) {
    for (const r of rects) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  /** Explicit `lang` value of the closest element: empty/missing or English is allowed. */
  function langAllowed(value) {
    return !value || /^en(-|$)/i.test(value);
  }

  function clamp(value, min, size, limit) {
    return Math.max(min, Math.min(value, min + limit - size));
  }

  /**
   * Places a box of `size` relative to `anchor` inside the visual viewport `vp`
   * ({ left, top, width, height } in layout-viewport coordinates).
   * above=false: over the anchor (cover mode); above=true: above it, below when there is no room.
   */
  function clampRect(anchor, size, vp, above) {
    let top = anchor.top;
    let below = false;
    if (above) {
      top = anchor.top - size.height;
      if (top < vp.top) {
        top = anchor.bottom;
        below = true;
      }
    }
    return {
      left: clamp(anchor.left, vp.left, size.width, vp.width),
      top: clamp(top, vp.top, size.height, vp.height),
      below,
    };
  }

  /** Blacklist key: hostname, or the protocol for file: and host-less frames (about:srcdoc). */
  function hostKey(loc) {
    return loc.protocol === 'file:' || !loc.hostname ? loc.protocol : loc.hostname;
  }

  function toggleHost(list, host) {
    return list.includes(host) ? list.filter((h) => h !== host) : [...list, host];
  }

  function nextMode(mode) {
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  }

  function menuLabels({ host, disabled, mode, dictFailed }) {
    return {
      toggle: `${disabled ? 'Включить' : 'Выключить'} на ${host}`,
      mode: `Режим: ${mode}`,
      warning: dictFailed ? '⚠ Словарь не загружен' : null,
    };
  }

  return {
    MODES,
    normalize,
    windowAround,
    tokenAt,
    lookup,
    validateDict,
    pointInRects,
    langAllowed,
    clampRect,
    hostKey,
    toggleHost,
    nextMode,
    menuLabels,
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
