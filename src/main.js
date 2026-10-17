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
.mask, .bubble, .highlight { position: fixed; display: none; box-sizing: border-box; pointer-events: none; user-select: none; }
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
.hl-box { border: 2px solid #2563eb; border-radius: 3px; background: transparent; }
.hl-underline { border-bottom: 2px solid #2563eb; background: transparent; }
.hl-bg { background: rgba(37, 99, 235, 0.18); border-radius: 2px; }
.hl-box-bg { border: 1.5px solid #2563eb; background: rgba(37, 99, 235, 0.15); border-radius: 3px; }
@media (prefers-color-scheme: dark) {
  .hl-box { border-color: #60a5fa; }
  .hl-underline { border-bottom-color: #60a5fa; }
  .hl-bg { background: rgba(96, 165, 250, 0.25); }
  .hl-box-bg { border-color: #60a5fa; background: rgba(96, 165, 250, 0.22); }
}
`;

let overlayHost = null;
let overlayRoot = null;
let mask = null;
let bubble = null;
let highlight = null;

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
  highlight = document.createElement('div');
  highlight.className = 'highlight';
  bubble = document.createElement('div');
  bubble.className = 'bubble';
  root.append(mask, highlight, bubble);
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

  // Highlight word boundaries (box, underline, bg)
  const hlStyle = state.zhSettings ? state.zhSettings.highlightStyle : 'none';
  if (highlight && hlStyle && hlStyle !== 'none' && !cover) {
    setBox(highlight, { left: rect.left - 1, top: rect.top - 1, width: rect.width + 2, height: rect.height + 2 });
    highlight.className = `highlight hl-${hlStyle}`;
    highlight.style.setProperty('display', 'block');
  } else if (highlight) {
    highlight.style.setProperty('display', 'none');
  }

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
  if (highlight) highlight.style.setProperty('display', 'none');
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
