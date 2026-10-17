// Pure logic for Chinese-Russian hover translation: no DOM, no GM_* APIs.
// Implements CJK tokenization, bidirectional maximum matching, pinyin diacritics,
// dictionary-entry formatting and dictionary validation.
const CoreZh = (() => {
  const MODES = ['cover', 'blur', 'tooltip'];
  const DICT_SOURCES = ['bkrs', 'cedict'];
  const MAX_WIN = 8; // symbols on each side of caret for BiMM window
  const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ]/;

  // Numeric pinyin tone table.
  const TONE_MAP = {
    a: ['ā', 'á', 'ǎ', 'à'],
    e: ['ē', 'é', 'ě', 'è'],
    i: ['ī', 'í', 'ǐ', 'ì'],
    o: ['ō', 'ó', 'ǒ', 'ò'],
    u: ['ū', 'ú', 'ǔ', 'ù'],
    v: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
  };

  function isCjk(ch) {
    return CJK_RE.test(ch);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Converts one numeric pinyin syllable (e.g. "hao3", "Zhong1", "nv3", "er2") to
   * diacritic form ("hǎo", "Zhōng", "nǚ", "ér"). Neutral tone (0/5/absent) leaves vowels bare.
   * Rules: 'a' or 'e' carry the mark; 'ou' puts it on 'o'; otherwise the last vowel.
   */
  function pinyinDiacritic(syllable) {
    const m = /^([A-Za-züÜ]+)([1-5])$/.exec(syllable.trim());
    const base = m ? m[1] : syllable.trim();
    const tone = m ? +m[2] : 0;
    if (tone < 1 || tone > 4) return base.replace(/v/g, 'ü').replace(/V/g, 'Ü');
    const lower = base.toLowerCase();
    let idx = -1;
    if (lower.includes('a')) idx = lower.indexOf('a');
    else if (lower.includes('e')) idx = lower.indexOf('e');
    else {
      const ou = lower.indexOf('ou');
      if (ou !== -1) idx = ou;
      else {
        for (let i = lower.length - 1; i >= 0; i--) {
          if ('iouuv'.includes(lower[i])) { idx = i; break; }
        }
      }
    }
    if (idx === -1) return base.replace(/v/g, 'ü').replace(/V/g, 'Ü');
    const ch = lower[idx];
    const accented = ch === 'v' ? TONE_MAP.v[tone - 1] : TONE_MAP[ch][tone - 1];
    const diacritic = base.slice(0, idx) + accented + base.slice(idx + 1);
    return diacritic.replace(/v/g, 'ü').replace(/V/g, 'Ü');
  }

  /** Splits a pinyin string ("Zhong1 guo2" / "ni3hao3") into diacritic syllables. */
  function pinyinToDiacritic(pinyin) {
    // Split glued syllables on tone digits, then honour whitespace as the primary separator.
    return String(pinyin || '')
      .trim()
      .split(/\s+/)
      .flatMap((chunk) => chunk.match(/[A-Za-züÜ]+[1-5]?/g) || [])
      .map(pinyinDiacritic)
      .join(' ');
  }

  /** CJK spans in `text` as [{start, end}] over raw indices; runs of adjacent CJK merge. */
  function cjkSpans(text) {
    const spans = [];
    const re = new RegExp(CJK_RE.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      const last = spans[spans.length - 1];
      if (last && last.end === start) last.end = end;
      else spans.push({ start, end });
    }
    return spans;
  }

  /** Position of the char under the caret inside a CJK span, or null when the caret is off-CJK. */
  function cjkIndexAt(text, offset) {
    const idx = Math.max(0, Math.min(offset, text.length));
    if (idx < text.length && isCjk(text[idx])) return idx; // caret directly on a CJK char
    if (idx === text.length && idx > 0 && isCjk(text[idx - 1])) return idx - 1; // caret at end of CJK run
    return null;
  }

  /**
   * Forward / reverse maximum matching over dict.w within a window around the caret.
   * Supports lookup by simplified headwords as well as traditional variants (via dict.tradMap or entry.trad).
   * Favors the longest entry containing the caret; ties break on length.
   */
  function findWord(candidate, dict) {
    if (Object.prototype.hasOwnProperty.call(dict.w, candidate)) {
      return { entry: dict.w[candidate], key: candidate };
    }
    if (dict.tradMap && Object.prototype.hasOwnProperty.call(dict.tradMap, candidate)) {
      const key = dict.tradMap[candidate];
      return { entry: dict.w[key], key };
    }
    return null;
  }

  function ensureTradMap(dict) {
    if (dict.tradMap) return;
    dict.tradMap = {};
    for (const [key, entry] of Object.entries(dict.w)) {
      if (entry && entry.trad && entry.trad !== key) {
        dict.tradMap[entry.trad] = key;
      }
    }
  }

  function bidirectionalMatch(text, pos, dict) {
    ensureTradMap(dict);
    let best = null;
    for (let left = 0; left < MAX_WIN && pos - left >= 0 && isCjk(text[pos - left]); left++) {
      // `right` counts from `pos` itself, so it is bounded by the chars left in `text`
      // (slicing beyond the end would silently shorten the candidate while `end` grew).
      const maxRight = Math.min(MAX_WIN, text.length - pos);
      for (let right = 1; right <= maxRight; right++) {
        const start = pos - left;
        const end = start + left + right;
        const candidate = text.slice(start, end);
        const found = findWord(candidate, dict);
        if (!found) continue;
        const containsCaret = pos >= start && pos < end;
        const length = end - start;
        const better = !best
          || (containsCaret && !best.containsCaret)
          || (containsCaret === best.containsCaret && length > best.length);
        if (better) best = { candidate, start, end, length, containsCaret, entry: found.entry, headword: found.key };
      }
    }
    if (!best) {
      const single = text[pos];
      if (!isCjk(single)) return null;
      const found = findWord(single, dict);
      if (!found) return null;
      return { candidate: single, start: pos, end: pos + 1, length: 1, containsCaret: true, entry: found.entry, headword: found.key };
    }
    return best;
  }

  function articleText(entry, word, settings) {
    if (!isPlainObject(entry)) return '';
    const s = settings || DEFAULT_SETTINGS;
    const parts = [];
    if (s.showPinyin && entry.p) parts.push(pinyinToDiacritic(entry.p));
    if (s.showTraditional && entry.trad && entry.trad !== word) parts.push(`[${entry.trad}]`);
    const rawSenses = Array.isArray(entry.t) ? entry.t : entry.t ? [entry.t] : [];
    const senses = s.showMultipleSenses ? rawSenses : rawSenses.slice(0, 1);
    if (senses.length) parts.push(senses.join('; '));
    if (s.showPos && entry.pos) parts.push(`(${entry.pos})`);
    return parts.filter(Boolean).join(' — ');
  }

  function lookup(dict, text, offset, opts) {
    if (!validateDict(dict)) return null;
    const pos = cjkIndexAt(text, offset);
    if (pos === null) return null;
    const match = bidirectionalMatch(text, pos, dict);
    if (!match) return null;
    const entry = match.entry || dict.w[match.candidate];
    const settings = opts && opts.settings ? opts.settings : DEFAULT_SETTINGS;
    const translation = articleText(entry, match.candidate, settings);
    if (!translation) return null;
    return { start: match.start, end: match.end, translation, word: match.candidate, entry };
  }

  function validateDict(dict) {
    return isPlainObject(dict) && dict.v === 1 && dict.lang === 'zh-ru' && isPlainObject(dict.w);
  }

  function pointInRects(x, y, rects) {
    for (const r of rects) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  /** Explicit `lang` value of the closest element: empty/missing, Chinese or English is allowed. */
  function langAllowed(value) {
    return !value || /^(zh|en)(-|$)/i.test(value);
  }

  function clamp(value, min, size, limit) {
    return Math.max(min, Math.min(value, min + limit - size));
  }

  function clampRect(anchor, size, vp, above) {
    let top = anchor.top;
    if (above) {
      top = anchor.top - size.height;
      if (top < vp.top) top = anchor.bottom;
    }
    return {
      left: clamp(above ? anchor.left : anchor.right - size.width, vp.left, size.width, vp.width),
      top: clamp(top, vp.top, size.height, vp.height),
    };
  }

  function hostKey(loc) {
    return loc.protocol === 'file:' || !loc.hostname ? loc.protocol : loc.hostname;
  }

  function toggleHost(list, host) {
    return list.includes(host) ? list.filter((h) => h !== host) : [...list, host];
  }

  function parseHosts(value) {
    return Array.isArray(value) ? value.filter((h) => typeof h === 'string') : [];
  }

  function parseMode(value) {
    return MODES.includes(value) ? value : MODES[0];
  }

  function nextMode(mode) {
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  }

  const HIGHLIGHT_STYLES = ['box', 'underline', 'bg', 'box-bg', 'none'];

  const DEFAULT_SETTINGS = {
    dictSource: 'bkrs',
    overlayMode: 'cover',
    highlightStyle: 'box',
    showPinyin: true,
    showTraditional: true,
    showPos: true,
    showMultipleSenses: true,
  };

  function parseSettings(value) {
    const s = isPlainObject(value) ? value : {};
    return {
      dictSource: DICT_SOURCES.includes(s.dictSource) ? s.dictSource : DEFAULT_SETTINGS.dictSource,
      overlayMode: MODES.includes(s.overlayMode) ? s.overlayMode : DEFAULT_SETTINGS.overlayMode,
      highlightStyle: HIGHLIGHT_STYLES.includes(s.highlightStyle) ? s.highlightStyle : DEFAULT_SETTINGS.highlightStyle,
      showPinyin: s.showPinyin !== false,
      showTraditional: s.showTraditional !== false,
      showPos: s.showPos !== false,
      showMultipleSenses: s.showMultipleSenses !== false,
    };
  }

  function menuLabels({ host, disabled, mode, dictFailed }) {
    return {
      toggle: `${disabled ? 'Включить' : 'Выключить'} на ${host}`,
      mode: `Режим: ${mode}`,
      guess: null,
      warning: dictFailed ? '⚠ Словарь не загружен' : null,
    };
  }

  return {
    MODES,
    HIGHLIGHT_STYLES,
    DICT_SOURCES,
    MAX_WIN,
    DEFAULT_SETTINGS,
    isCjk,
    cjkSpans,
    cjkIndexAt,
    pinyinDiacritic,
    pinyinToDiacritic,
    bidirectionalMatch,
    articleText,
    lookup,
    validateDict,
    pointInRects,
    langAllowed,
    clampRect,
    hostKey,
    toggleHost,
    parseHosts,
    parseMode,
    parseSettings,
    nextMode,
    menuLabels,
  };
})();

if (typeof module !== 'undefined') module.exports = CoreZh;
