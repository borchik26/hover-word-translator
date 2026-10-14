// ==UserScript==
// @name         Hover Word Translator
// @namespace    https://github.com/borchik26/hover-word-translator
// @version      2.1.0
// @description  Shows the Russian translation of the English word or phrase under the cursor. Dictionary: Wiktionary via kaikki.org (CC BY-SA 4.0), FrequencyWords (CC BY-SA 4.0).
// @match        *://*/*
// @run-at       document-idle
// @resource     dict https://raw.githubusercontent.com/borchik26/hover-word-translator/main/dist/dict.json
// @grant        GM_getResourceText
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addValueChangeListener
// ==/UserScript==

(() => {
'use strict';
// Pure logic shared by the userscript and `node --test`: no DOM, no GM_* APIs.
const Core = (() => {
  const WINDOW = 64; // chars on each side of the caret fed to the tokenizer
  const EXTEND = 64; // extra chars allowed to finish a word cut by the window
  // Any letters form a token so "résumé" is never split into ASCII fragments ("sum");
  // only all-ASCII tokens are looked up.
  const TOKEN_RE = /\p{L}+(?:['-]\p{L}+)*/gu;
  const ASCII_TOKEN_RE = /^[A-Za-z'-]+$/;
  const DROP_RE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/; // soft hyphen, zero-width
  const SPACE_RE = /\s/; // includes NBSP
  const EDGE_PUNCT_RE = /^[^A-Za-z0-9@/]+|[^A-Za-z0-9@/]+$/g;
  const NOT_PROSE_RE = /[0-9@]|:\/\/|www\.|[A-Za-z]\.[A-Za-z]/; // numbers, emails, URLs, domains
  const SENTENCE_END_RE = /[.!?]/;
  const OPENERS_RE = /[\s"'“‘«(\[]/;
  const MODES = ['cover', 'blur', 'tooltip'];
  const MIN_STEM = 3; // shorter stems and compound parts are noise ("city" → "c")
  // [ending, replacements]: one inflection, then one derivational suffix.
  const INFLECTIONS = [['ies', ['y']], ['ied', ['y']], ['es', ['']], ['s', ['']], ['ed', ['', 'e']], ['ing', ['', 'e']]];
  const SUFFIXES = [
    ['istic', ['ism', 'ist']], ['able', ['', 'e']], ['ible', ['', 'e']], ['ity', ['', 'e']],
    ['ness', ['']], ['ment', ['']], ['er', ['', 'e']], ['or', ['', 'e']], ['ic', ['']],
  ];
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
    if (k < 0 || !ASCII_TOKEN_RE.test(toks[k].text) || notProse(text, toks[k])) return null;
    return { toks, k };
  }

  /** Token under `offset` in already normalized text, or null (plan-listed test seam for the tokenizer). */
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

  /**
   * Sentence start: after .!? or at the start of a text node that goes on with more words.
   * A lone word in its own node (`<a>Mark</a>`) is more likely a name than a sentence.
   */
  function atSentenceStart(text, toks, k, windowAtTextStart) {
    let i = toks[k].start;
    while (i > 0 && OPENERS_RE.test(text[i - 1])) i--;
    if (i > 0) return SENTENCE_END_RE.test(text[i - 1]);
    return windowAtTextStart && k + 1 < toks.length;
  }

  /** Stems of `word` without `ending`: each replacement, plus an undoubled final consonant. */
  function stemsOf(word, ending, replacements) {
    if (!word.endsWith(ending)) return [];
    const base = word.slice(0, -ending.length);
    const out = replacements.map((r) => base + r);
    if (/([^aeiou])\1$/.test(base)) out.push(base.slice(0, -1)); // running → run
    return out.filter((stem) => stem.length >= MIN_STEM);
  }

  function firstVariant(translation) {
    return translation.split(', ')[0];
  }

  /** Word split into two dictionary words, longest left part first: codebase → code + base. */
  function compound(dict, w) {
    for (let i = w.length - MIN_STEM; i >= MIN_STEM; i--) {
      const a = w.slice(0, i);
      const b = w.slice(i);
      if (has(dict.w, a) && has(dict.w, b)) {
        return { source: `${a}+${b}`, translation: `≈ ${firstVariant(dict.w[a])} + ${firstVariant(dict.w[b])}` };
      }
    }
    return null;
  }

  /** Approximate translation of a word missing from the dictionary, marked with "≈". */
  function guessWord(dict, word) {
    const w = word.toLowerCase();
    const forms = [w, ...INFLECTIONS.flatMap(([end, reps]) => stemsOf(w, end, reps))];
    const stems = [
      ...forms.slice(1),
      ...forms.flatMap((form) => SUFFIXES.flatMap(([end, reps]) => stemsOf(form, end, reps))),
    ];
    for (const stem of stems) {
      const hit = resolve(dict, stem);
      if (hit) return { source: hit.source, translation: `≈ ${firstVariant(hit.translation)}` };
    }
    for (const form of forms) {
      const hit = compound(dict, form);
      if (hit) return hit;
    }
    return null;
  }

  function findWord(dict, tok, offset, sentenceStart, guess) {
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
      return findWord(dict, base, Math.min(offset, base.end), sentenceStart, guess);
    }
    if (t.includes('-')) {
      let start = tok.start;
      for (const part of t.split('-')) {
        const end = start + part.length;
        if (start <= offset && offset <= end) {
          return findWord(dict, { start, end, text: part }, offset, sentenceStart && start === tok.start, guess);
        }
        start = end + 1;
      }
    }
    // Capitalized mid-sentence words are likely names (Parker ≠ park), short CAPS are acronyms.
    const guessable = /^[A-Za-z]+$/.test(t) && (caps ? t.length >= 4 : t === lower || sentenceStart);
    if (guess && guessable) {
      const hit = guessWord(dict, t);
      if (hit) return { start: tok.start, end: tok.end, ...hit };
    }
    return null;
  }

  /**
   * Translation for the word or phrase at `offset` of a raw text node, with raw offsets.
   * `guess`: fall back to a "≈" guess from a stem or compound when the dictionary misses.
   */
  function lookup(dict, text, offset, { guess = false } = {}) {
    const [ws, we] = windowAround(text, offset);
    const n = normalize(text.slice(ws, we));
    let off = n.map.findIndex((i) => i >= offset - ws);
    if (off < 0) off = n.map.length;
    // Caret on whitespace collapsed away by normalize: not on any word.
    if (n.map[off] !== offset - ws && SPACE_RE.test(text[offset])) return null;
    const found = scan(n.text, off);
    if (!found) return null;
    const { toks, k } = found;
    const hit =
      findPhrase(dict, n.text, toks, k) ||
      findWord(dict, toks[k], off, atSentenceStart(n.text, toks, k, ws === 0), guess);
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
   * above=false: over the anchor, right edges aligned so a wider box grows left (cover mode);
   * above=true: above it, below when there is no room.
   */
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

  /** Blacklist key: hostname, or the protocol for file: and host-less frames (about:srcdoc). */
  function hostKey(loc) {
    return loc.protocol === 'file:' || !loc.hostname ? loc.protocol : loc.hostname;
  }

  function toggleHost(list, host) {
    return list.includes(host) ? list.filter((h) => h !== host) : [...list, host];
  }

  /** Stored blacklist, tolerant to missing or corrupted values. */
  function parseHosts(value) {
    return Array.isArray(value) ? value.filter((h) => typeof h === 'string') : [];
  }

  function parseMode(value) {
    return MODES.includes(value) ? value : MODES[0];
  }

  /** Guesses are on unless explicitly switched off. */
  function parseGuess(value) {
    return value !== false;
  }

  function nextMode(mode) {
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  }

  function menuLabels({ host, disabled, mode, guess, dictFailed }) {
    return {
      toggle: `${disabled ? 'Включить' : 'Выключить'} на ${host}`,
      mode: `Режим: ${mode}`,
      guess: `Догадки: ${guess ? 'вкл' : 'выкл'}`,
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
    parseHosts,
    parseMode,
    parseGuess,
    nextMode,
    menuLabels,
  };
})();


// Runtime: pointer tracking, caret lookup, overlay in a closed shadow root, menu.
// Never mutates the page DOM apart from one host element on <html>.
const SHOW_DELAY_MS = 200;
const WARM_MS = 500; // next word shows at once if the overlay was visible this recently
const MOVE_EPS_PX = 2;
const HOST = Core.hostKey(location);
const IS_TOP = window.top === window;

const state = {
  dict: null,
  dictFailed: false,
  disabledHosts: Core.parseHosts(GM_getValue('disabledHosts')),
  mode: Core.parseMode(GM_getValue('overlayMode')),
  guess: Core.parseGuess(GM_getValue('guessEnabled')),
};

function loadDict() {
  if (state.dict || state.dictFailed) return state.dict;
  try {
    const dict = JSON.parse(GM_getResourceText('dict'));
    if (!Core.validateDict(dict)) throw new Error('unexpected dictionary format');
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
  const pos = Core.clampRect(anchor, size, vp, !cover);
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
  if (langEl && !Core.langAllowed(langEl.getAttribute('lang'))) return null;

  const dict = loadDict();
  if (!dict) return null;
  const res = Core.lookup(dict, node.data, offset, { guess: state.guess });
  if (!res) return null;
  const range = document.createRange();
  range.setStart(node, res.start);
  range.setEnd(node, res.end);
  const rects = Array.from(range.getClientRects());
  if (!Core.pointInRects(x, y, rects)) return null; // padding, empty space right of a line
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
document.addEventListener('keydown', (e) => e.key === 'Escape' && hide(), true);
window.addEventListener('blur', hide);
window.addEventListener('resize', hide);

// ---------- menu (top frame only; every frame follows value changes) ----------

let menuIds = [];

function renderMenu() {
  for (const id of menuIds) GM_unregisterMenuCommand(id);
  const labels = Core.menuLabels({
    host: HOST,
    disabled: state.disabledHosts.includes(HOST),
    mode: state.mode,
    guess: state.guess,
    dictFailed: state.dictFailed,
  });
  menuIds = [
    GM_registerMenuCommand(labels.toggle, () => {
      GM_setValue('disabledHosts', Core.toggleHost(state.disabledHosts, HOST));
    }),
    GM_registerMenuCommand(labels.mode, () => GM_setValue('overlayMode', Core.nextMode(state.mode))),
    GM_registerMenuCommand(labels.guess, () => GM_setValue('guessEnabled', !state.guess)),
  ];
  if (labels.warning) menuIds.push(GM_registerMenuCommand(labels.warning, () => {}));
}

// The listener also fires in the tab that changed the value, so it is the only re-render path.
function onSettingChanged(name, _old, value) {
  if (name === 'disabledHosts') state.disabledHosts = Core.parseHosts(value);
  else if (name === 'overlayMode') state.mode = Core.parseMode(value);
  else if (name === 'guessEnabled') state.guess = Core.parseGuess(value);
  hide();
  if (IS_TOP) renderMenu();
}
GM_addValueChangeListener('disabledHosts', onSettingChanged);
GM_addValueChangeListener('overlayMode', onSettingChanged);
GM_addValueChangeListener('guessEnabled', onSettingChanged);

if (IS_TOP) renderMenu();

})();
