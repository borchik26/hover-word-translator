// ==UserScript==
// @name         Hover Word Translator (Chinese to Russian)
// @namespace    https://github.com/borchik26/hover-word-translator
// @version      2.0.0
// @description  Shows Russian translation and pinyin for Chinese words under the cursor with bidirectional matching segmentation. Dictionaries: BKRS, CC-CEDICT.
// @match        *://*/*
// @run-at       document-idle
// @resource     dict_bkrs https://raw.githubusercontent.com/borchik26/hover-word-translator/main/dist/dict-zh-bkrs.json
// @resource     dict_cedict https://raw.githubusercontent.com/borchik26/hover-word-translator/main/dist/dict-zh-cedict.json
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// ==/UserScript==

(() => {
'use strict';
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
   * Favors the longest entry containing the caret; ties break on length.
   */
  function bidirectionalMatch(text, pos, dict) {
    const words = dict.w;
    let best = null;
    for (let left = 0; left < MAX_WIN && pos - left >= 0 && isCjk(text[pos - left]); left++) {
      // `right` counts from `pos` itself, so it is bounded by the chars left in `text`
      // (slicing beyond the end would silently shorten the candidate while `end` grew).
      const maxRight = Math.min(MAX_WIN, text.length - pos);
      for (let right = 1; right <= maxRight; right++) {
        const start = pos - left;
        const end = start + left + right;
        const candidate = text.slice(start, end);
        if (!Object.prototype.hasOwnProperty.call(words, candidate)) continue;
        const containsCaret = pos >= start && pos < end;
        const length = end - start;
        const better = !best
          || (containsCaret && !best.containsCaret)
          || (containsCaret === best.containsCaret && length > best.length);
        if (better) best = { candidate, start, end, length, containsCaret };
      }
    }
    if (!best) {
      const single = text[pos];
      if (!isCjk(single) || !Object.prototype.hasOwnProperty.call(words, single)) return null;
      return { candidate: single, start: pos, end: pos + 1, length: 1, containsCaret: true };
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
    const entry = dict.w[match.candidate];
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

  const DEFAULT_SETTINGS = {
    dictSource: 'bkrs',
    overlayMode: 'cover',
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


// Settings panel UI mounted inside the userscript's closed shadow root.
// Pure vanilla DOM, no dependencies, isolated styles.
const SettingsUI = (() => {
  const CSS = `
  .hwt-settings-backdrop {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto; z-index: 2147483647;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .hwt-settings-panel {
    background: #fff; color: #111; width: 340px; border-radius: 8px;
    padding: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    font-size: 13px; line-height: 1.4;
  }
  @media (prefers-color-scheme: dark) {
    .hwt-settings-panel { background: #222; color: #eee; border: 1px solid #444; }
  }
  .hwt-title { font-size: 15px; font-weight: 600; margin: 0 0 12px; display: flex; justify-content: space-between; }
  .hwt-close { cursor: pointer; border: none; background: none; font-size: 18px; color: inherit; padding: 0 4px; }
  .hwt-row { margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
  .hwt-row label { font-weight: 500; }
  .hwt-row select, .hwt-row input[type="checkbox"] { cursor: pointer; }
  .hwt-row select { padding: 3px 6px; border-radius: 4px; border: 1px solid #ccc; background: inherit; color: inherit; }
  .hwt-hint { font-size: 11px; opacity: 0.7; margin-top: 8px; border-top: 1px solid rgba(128,128,128,0.2); padding-top: 6px; }
  `;

  let backdrop = null;
  let installedSheet = null;

  function mount(root, settings, onChange) {
    if (backdrop && backdrop.isConnected) return close();

    if (!installedSheet) {
      try {
        installedSheet = new CSSStyleSheet();
        installedSheet.replaceSync(CSS);
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, installedSheet];
      } catch {
        const style = document.createElement('style');
        style.textContent = CSS;
        root.append(style);
        installedSheet = style;
      }
    }

    backdrop = document.createElement('div');
    backdrop.className = 'hwt-settings-backdrop';
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };

    const panel = document.createElement('div');
    panel.className = 'hwt-settings-panel';
    panel.innerHTML = `
      <div class="hwt-title">
        <span>Настройки перевода (ZH)</span>
        <button class="hwt-close" aria-label="Закрыть">&times;</button>
      </div>
      <div class="hwt-row">
        <label>Словарь</label>
        <select id="hwt-dict">
          <option value="bkrs" ${settings.dictSource === 'bkrs' ? 'selected' : ''}>БКРС (zh→ru)</option>
          <option value="cedict" ${settings.dictSource === 'cedict' ? 'selected' : ''}>CC-CEDICT (+ru)</option>
        </select>
      </div>
      <div class="hwt-row">
        <label>Режим оверлея</label>
        <select id="hwt-mode">
          <option value="cover" ${settings.overlayMode === 'cover' ? 'selected' : ''}>Cover (замена)</option>
          <option value="blur" ${settings.overlayMode === 'blur' ? 'selected' : ''}>Blur (размытие)</option>
          <option value="tooltip" ${settings.overlayMode === 'tooltip' ? 'selected' : ''}>Tooltip (всплывашка)</option>
        </select>
      </div>
      <div class="hwt-row">
        <label for="hwt-pinyin">Пиньинь с тонами</label>
        <input type="checkbox" id="hwt-pinyin" ${settings.showPinyin ? 'checked' : ''}>
      </div>
      <div class="hwt-row">
        <label for="hwt-trad">Традиционная форма</label>
        <input type="checkbox" id="hwt-trad" ${settings.showTraditional ? 'checked' : ''}>
      </div>
      <div class="hwt-row">
        <label for="hwt-senses">Все значения (синонимы)</label>
        <input type="checkbox" id="hwt-senses" ${settings.showMultipleSenses ? 'checked' : ''}>
      </div>
      <div class="hwt-row">
        <label for="hwt-pos">Части речи (POS)</label>
        <input type="checkbox" id="hwt-pos" ${settings.showPos ? 'checked' : ''}>
      </div>
      <div class="hwt-hint">Горячая клавиша: Alt+S (или меню расширения)</div>
    `;

    panel.querySelector('.hwt-close').onclick = close;

    const update = () => {
      const newSettings = {
        dictSource: panel.querySelector('#hwt-dict').value,
        overlayMode: panel.querySelector('#hwt-mode').value,
        showPinyin: panel.querySelector('#hwt-pinyin').checked,
        showTraditional: panel.querySelector('#hwt-trad').checked,
        showMultipleSenses: panel.querySelector('#hwt-senses').checked,
        showPos: panel.querySelector('#hwt-pos').checked,
      };
      onChange(newSettings);
    };

    panel.querySelectorAll('select, input').forEach((el) => {
      el.onchange = update;
    });

    backdrop.append(panel);
    root.append(backdrop);
  }

  function close() {
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

  function isOpen() {
    return backdrop !== null && backdrop.isConnected;
  }

  return { mount, close, isOpen };
})();


// Runtime: pointer tracking, caret lookup, overlay in a closed shadow root, menu.
// Never mutates the page DOM apart from one host element on <html>.
const SHOW_DELAY_MS = 200;
const WARM_MS = 500; // next word shows at once if the overlay was visible this recently
const MOVE_EPS_PX = 2;
const Engine = typeof CoreZh !== 'undefined' ? CoreZh : Core;
const HOST = Engine.hostKey(location);
const IS_TOP = window.top === window;

const state = {
  dict: null,
  dictFailed: false,
  disabledHosts: Engine.parseHosts(GM_getValue('disabledHosts')),
  mode: Engine.parseMode(GM_getValue('overlayMode')),
  guess: Engine.parseGuess ? Engine.parseGuess(GM_getValue('guessEnabled')) : false,
  zhSettings: Engine.parseSettings ? Engine.parseSettings(GM_getValue('zh_settings')) : null,
};

function loadDict() {
  if (state.dict || state.dictFailed) return state.dict;
  try {
    const resourceName = typeof CoreZh !== 'undefined'
      ? (state.zhSettings && state.zhSettings.dictSource === 'cedict' ? 'dict_cedict' : 'dict_bkrs')
      : 'dict';
    const raw = GM_getResourceText(resourceName);
    if (!raw) throw new Error(`resource ${resourceName} not found`);
    const dict = JSON.parse(raw);
    if (!Engine.validateDict(dict)) throw new Error('unexpected dictionary format');
    state.dict = dict;
  } catch (err) {
    state.dictFailed = true;
    console.warn('[hover-translator] dictionary not loaded:', err);
    if (IS_TOP) renderMenu();
  }
  return state.dict;
}

// ---------- overlay ----------

const CSS = `
.mask, .bubble { position: fixed; display: none; box-sizing: border-box; pointer-events: none; user-select: none; }
.bubble {
  max-width: 320px; padding: 1px 6px; border-radius: 4px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.3;
  white-space: normal; overflow-wrap: anywhere;
  background: #fff; color: #111; border: 1px solid rgba(0, 0, 0, .3); box-shadow: 0 1px 4px rgba(0, 0, 0, .35);
}
.mask { border-radius: 3px; background: rgba(128, 128, 128, .6); }
@supports (backdrop-filter: blur(3px)) or (-webkit-backdrop-filter: blur(3px)) {
  .mask { background: rgba(128, 128, 128, .15); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
}
@media (prefers-color-scheme: dark) {
  .bubble { background: #1f1f1f; color: #f2f2f2; border-color: rgba(255, 255, 255, .35); }
}
`;

let overlayHost = null;
let overlayRoot = null;
let mask = null;
let bubble = null;

function ensureOverlay() {
  if (overlayHost && overlayHost.isConnected) return;
  // A custom tag dodges page rules like `div { display: none }`; inline !important beats `* {…}`.
  overlayHost = document.createElement('hover-translator');
  const hostStyle = [['all', 'initial'], ['position', 'fixed'], ['inset', '0'], ['pointer-events', 'none'],
    ['z-index', '2147483647'], ['display', 'block'], ['visibility', 'visible'], ['opacity', '1']];
  for (const [prop, value] of hostStyle) overlayHost.style.setProperty(prop, value, 'important');
  overlayHost.setAttribute('aria-hidden', 'true');
  const root = overlayHost.attachShadow({ mode: 'closed' });
  overlayRoot = root;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);
  }
  mask = document.createElement('div');
  mask.className = 'mask';
  bubble = document.createElement('div');
  bubble.className = 'bubble';
  root.append(mask, bubble);
  document.documentElement.append(overlayHost);
}

function openSettings() {
  if (typeof SettingsUI === 'undefined' || !state.zhSettings) return;
  ensureOverlay();
  SettingsUI.mount(overlayRoot, state.zhSettings, (newSettings) => {
    GM_setValue('zh_settings', newSettings);
  });
}

function setBox(el, box) {
  for (const prop of ['left', 'top', 'width', 'height', 'min-width', 'min-height']) {
    if (prop in box) el.style.setProperty(prop, `${box[prop]}px`);
    else el.style.removeProperty(prop);
  }
}

function render(hit) {
  ensureOverlay();
  const rect = hit.rects[0]; // phrase wrapped over two lines: cover the first part
  const fontPx = parseFloat(getComputedStyle(hit.node.parentElement).fontSize) || 16;
  bubble.style.setProperty('font-size', `${Math.min(20, Math.max(12, fontPx))}px`);
  bubble.textContent = hit.translation;
  const vv = window.visualViewport;
  const vp = { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };

  const cover = state.mode === 'cover';
  setBox(bubble, cover ? { 'min-width': rect.width, 'min-height': rect.height } : {});
  setBox(mask, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  mask.style.setProperty('display', state.mode === 'blur' ? 'block' : 'none');
  bubble.style.setProperty('display', 'block');
  const size = bubble.getBoundingClientRect();
  const anchor = cover ? rect : { left: rect.left, top: rect.top - 2, bottom: rect.bottom + 2 };
  const pos = Engine.clampRect(anchor, size, vp, !cover);
  bubble.style.setProperty('left', `${pos.left}px`);
  bubble.style.setProperty('top', `${pos.top}px`);
}

// ---------- lifecycle ----------

let current = null; // { node, start, end, ... } shown or about to be shown
let visible = false;
let lastVisibleAt = -Infinity;
let showTimer = 0;
let scrollTimer = 0;
let lastX = null;
let lastY = null;
let lastTarget = null;
let probeQueued = false;

function hide() {
  clearTimeout(showTimer);
  current = null;
  if (!visible) return;
  visible = false;
  lastVisibleAt = performance.now();
  bubble.style.setProperty('display', 'none');
  mask.style.setProperty('display', 'none');
}

function show(hit) {
  if (!hit.node.isConnected) return hide();
  render(hit);
  visible = true;
}

function editable(el) {
  return el.isContentEditable || el.closest('input, textarea, select') !== null;
}

function hitAt(x, y, target) {
  if (state.dictFailed || state.disabledHosts.includes(HOST)) return null;
  const el = target instanceof Element ? target : null;
  if (!el || editable(el)) return null;
  const sel = document.getSelection();
  if (sel && !sel.isCollapsed) return null;

  let node;
  let offset;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement) return null;
  // Checked on the text itself: a nested <span lang="de"> may differ from the event target.
  const parent = node.parentElement;
  if (editable(parent)) return null;
  const langEl = parent.closest('[lang]');
  if (langEl && !Engine.langAllowed(langEl.getAttribute('lang'))) return null;

  const dict = loadDict();
  if (!dict) return null;
  const res = Engine.lookup(dict, node.data, offset, {
    guess: state.guess,
    settings: state.zhSettings,
  });
  if (!res) return null;
  const range = document.createRange();
  range.setStart(node, res.start);
  range.setEnd(node, res.end);
  const rects = Array.from(range.getClientRects());
  if (!Engine.pointInRects(x, y, rects)) return null; // padding, empty space right of a line
  return { node, start: res.start, end: res.end, translation: res.translation, rects };
}

function probe() {
  probeQueued = false;
  if (lastX === null) return;
  const hit = hitAt(lastX, lastY, lastTarget);
  if (!hit) return hide();
  if (current && current.node === hit.node && current.start === hit.start && current.end === hit.end) return;
  clearTimeout(showTimer);
  current = hit;
  if (visible || performance.now() - lastVisibleAt <= WARM_MS) {
    show(hit);
  } else {
    showTimer = setTimeout(() => current === hit && show(hit), SHOW_DELAY_MS);
  }
}

function queueProbe() {
  if (probeQueued) return;
  probeQueued = true;
  requestAnimationFrame(probe);
}

function onPointerMove(e) {
  if (e.pointerType !== 'mouse' || e.buttons !== 0) return hide();
  if (lastX !== null && Math.abs(e.clientX - lastX) <= MOVE_EPS_PX && Math.abs(e.clientY - lastY) <= MOVE_EPS_PX) {
    return;
  }
  lastX = e.clientX;
  lastY = e.clientY;
  lastTarget = e.target;
  queueProbe();
}

function onScroll() {
  hide();
  clearTimeout(scrollTimer);
  // Re-anchor at the last cursor position once scrolling settles.
  scrollTimer = setTimeout(() => {
    if (lastX !== null) lastTarget = document.elementFromPoint(lastX, lastY);
    queueProbe();
  }, 150);
}

const passiveCapture = { capture: true, passive: true };
document.addEventListener('pointermove', onPointerMove, passiveCapture);
document.addEventListener('scroll', onScroll, passiveCapture);
document.addEventListener('pointerdown', hide, passiveCapture);
document.addEventListener('touchstart', hide, passiveCapture);
document.addEventListener('mouseout', (e) => e.relatedTarget === null && hide(), passiveCapture);
document.addEventListener('visibilitychange', hide);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hide();
  if (e.altKey && e.code === 'KeyS' && typeof SettingsUI !== 'undefined' && state.zhSettings) {
    e.preventDefault();
    openSettings();
  }
}, true);
window.addEventListener('blur', hide);
window.addEventListener('resize', hide);

// ---------- menu (top frame only; every frame follows value changes) ----------

let menuIds = [];

function renderMenu() {
  for (const id of menuIds) GM_unregisterMenuCommand(id);
  const labels = Engine.menuLabels({
    host: HOST,
    disabled: state.disabledHosts.includes(HOST),
    mode: state.mode,
    guess: state.guess,
    dictFailed: state.dictFailed,
  });
  menuIds = [
    GM_registerMenuCommand(labels.toggle, () => {
      GM_setValue('disabledHosts', Engine.toggleHost(state.disabledHosts, HOST));
    }),
    GM_registerMenuCommand(labels.mode, () => GM_setValue('overlayMode', Engine.nextMode(state.mode))),
  ];
  if (labels.guess) menuIds.push(GM_registerMenuCommand(labels.guess, () => GM_setValue('guessEnabled', !state.guess)));
  if (labels.warning) menuIds.push(GM_registerMenuCommand(labels.warning, () => {}));
  if (typeof SettingsUI !== 'undefined' && state.zhSettings) {
    menuIds.push(GM_registerMenuCommand('⚙ Настройки (ZH)', openSettings));
  }
}

// The listener also fires in the tab that changed the value, so it is the only re-render path.
function onSettingChanged(name, _old, value) {
  if (name === 'disabledHosts') state.disabledHosts = Engine.parseHosts(value);
  else if (name === 'overlayMode') state.mode = Engine.parseMode(value);
  else if (name === 'guessEnabled' && Engine.parseGuess) state.guess = Engine.parseGuess(value);
  else if (name === 'zh_settings' && Engine.parseSettings) {
    state.zhSettings = Engine.parseSettings(value);
    if (state.zhSettings.overlayMode) state.mode = state.zhSettings.overlayMode;
    state.dict = null;
    state.dictFailed = false;
  }
  hide();
  if (IS_TOP) renderMenu();
}
GM_addValueChangeListener('disabledHosts', onSettingChanged);
GM_addValueChangeListener('overlayMode', onSettingChanged);
GM_addValueChangeListener('guessEnabled', onSettingChanged);
GM_addValueChangeListener('zh_settings', onSettingChanged);

if (IS_TOP) renderMenu();

})();
