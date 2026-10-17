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

  function mount(root, settings, onChange) {
    if (backdrop && backdrop.isConnected) return close();

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.append(style);
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
        <label>Сегментация</label>
        <select id="hwt-seg">
          <option value="matching" ${settings.segmentation === 'matching' ? 'selected' : ''}>BiMM (по словарю)</option>
          <option value="hybrid" ${settings.segmentation === 'hybrid' ? 'selected' : ''}>Гибрид</option>
          <option value="jieba" ${settings.segmentation === 'jieba' ? 'selected' : ''}>Jieba-js</option>
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
        <label for="hwt-pos">Части речи (POS)</label>
        <input type="checkbox" id="hwt-pos" ${settings.showPos ? 'checked' : ''}>
      </div>
      <div class="hwt-hint">Горячая клавиша: Alt+S (или меню расширения)</div>
    `;

    panel.querySelector('.hwt-close').onclick = close;

    const update = () => {
      const newSettings = {
        dictSource: panel.querySelector('#hwt-dict').value,
        segmentation: panel.querySelector('#hwt-seg').value,
        overlayMode: panel.querySelector('#hwt-mode').value,
        showPinyin: panel.querySelector('#hwt-pinyin').checked,
        showTraditional: panel.querySelector('#hwt-trad').checked,
        showPos: panel.querySelector('#hwt-pos').checked,
        showMultipleSenses: settings.showMultipleSenses,
        disabledHosts: settings.disabledHosts,
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

if (typeof module !== 'undefined') module.exports = SettingsUI;
