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
  const res = Core.lookup(dict, node.data, offset);
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
    dictFailed: state.dictFailed,
  });
  menuIds = [
    GM_registerMenuCommand(labels.toggle, () => {
      GM_setValue('disabledHosts', Core.toggleHost(state.disabledHosts, HOST));
    }),
    GM_registerMenuCommand(labels.mode, () => GM_setValue('overlayMode', Core.nextMode(state.mode))),
  ];
  if (labels.warning) menuIds.push(GM_registerMenuCommand(labels.warning, () => {}));
}

// The listener also fires in the tab that changed the value, so it is the only re-render path.
function onSettingChanged(name, _old, value) {
  if (name === 'disabledHosts') state.disabledHosts = Core.parseHosts(value);
  else state.mode = Core.parseMode(value);
  hide();
  if (IS_TOP) renderMenu();
}
GM_addValueChangeListener('disabledHosts', onSettingChanged);
GM_addValueChangeListener('overlayMode', onSettingChanged);

if (IS_TOP) renderMenu();
