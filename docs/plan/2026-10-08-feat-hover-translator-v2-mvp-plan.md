---
title: "feat: hover translator v2 MVP (offline dictionary, hover lookup)"
type: feat
date: 2026-10-08
---

## feat: hover translator v2 MVP — Standard

## Overview

Этап 1 из брейнсторма
[`docs/brainstorm/2026-10-08-hover-translator-v2-brainstorm-doc.md`](../brainstorm/2026-10-08-hover-translator-v2-brainstorm-doc.md).
Tampermonkey-юзерскрипт переводит английское слово или устойчивую фразу под курсором на русский.
Он не изменяет DOM страницы. Перевод берётся из офлайн-словаря, который собирается из kaikki.org
(Wiktionary) и доставляется через `@resource`.

Этапы 2 (API Yandex Dictionary + кэш) и 3 (омонимы) пойдут отдельными планами.

## Problem Statement / Motivation

Проблемы `old_script.js`:
- Словарь из ~600 слов захардкожен, часть ключей повторяется, поэтому значения тихо
  перезаписываются (`old_script.js:15`).
- Синхронный рекурсивный обход и обёртка слов в `<span>` (`old_script.js:~560`) вызывают фризы и
  ломают чужую вёрстку.
- Скрипт один раз запускается по `setTimeout(500)`, поэтому SPA и подгружаемый контент не
  переводятся.
- Нет словоформ (`went`) и фраз (`in order to`).
- Нет выключателя по сайтам, стиль жёсткий (`#000`/`#00ffff`, `right: 0`).

## Proposed Solution

Ищем слово по наведению, а не обёрткой. На `pointermove` (троттлинг через rAF) caret API находит
текстовый узел и offset под курсором. Затем мы выделяем токен, делаем hit-test по
`getClientRects()` и ищем перевод: сначала фраза, потом слово, потом лемма. Через ~200 мс
неподвижности показываем один оверлей. Он живёт в закрытом shadow root, примонтированном к
`document.documentElement`.

### Структура репозитория

```
build/
  build_dict.py           # kaikki JSONL + частотный список → dist/dict.json (потоково)
  tests/__init__.py, tests/test_build_dict.py
  tests/fixtures/kaikki-sample.jsonl, freq-sample.txt
  data/                   # .gitignore: kaikki 3 ГБ, en_50k.txt
src/
  core.js                 # чистая логика без DOM/GM: токенизация, lookup, hit-test, clamp, lang, blacklist, validateDict
  main.js                 # рантайм: события, caret API, оверлей, меню, GM_*
  header.txt              # метаблок ==UserScript== с плейсхолдером {{DICT_URL}}
scripts/
  bundle.mjs              # header + core.js + main.js → dist/hover-translator.user.js (~20 строк, без зависимостей);
                          # DICT_URL из env, по умолчанию raw GitHub URL — локальный адрес не попадает в коммит
  bench-dict.mjs          # замер JSON.parse(dist/dict.json); exit 1 при превышении бюджета
test/
  core.test.mjs           # node --test
  fixture.html            # ручные сценарии A1–A20
dist/
  dict.json               # коммитится; на него указывает @resource
  hover-translator.user.js
old_script.js             # удаляется в последней фазе
```

`core.js` написан как IIFE, которое кладёт результат в `const Core`, и в конце содержит
`if (typeof module !== 'undefined') module.exports = Core;`. Так один и тот же файл работает и в
бандле, и в `node --test`, без бандлера. `package.json` не нужен: тесты запускаются командой
`node --test test/core.test.mjs`. Если он всё же появится, в нём нельзя ставить
`"type": "module"`, иначе сломается `module.exports`.

### Формат `dist/dict.json`

```json
{ "v": 1,
  "w": { "run": "бежать, запускать", "go": "идти" },
  "f": { "went": "go", "runs": "run", "leaves": "leaf" },
  "p": { "in order to": "для того чтобы", "as well as": "а также" } }
```

- `w`: лемма → 1–2 русских перевода через запятую. Берутся первый ru-перевод первых значений в
  порядке kaikki, дубликаты убираются.
- `f`: форма → лемма, только если сама форма не лемма из `w`. Источник —
  `senses[].form_of[].word` у статьи-формы (`went` → `go`). Формы из `forms[]` у леммы
  отбрасываются, если у них есть теги `romanization`, `table-tags` или `inflection-template`.
  Форма тоже должна пройти частотный фильтр, иначе `f` раздует бюджет. При неоднозначности
  (`leaves`) выбирается лемма с большей частотой.
- `p`: многословные статьи kaikki (2–3 слова), в которых все слова есть в частотном списке.
  Ключ фразы — слова в нижнем регистре через один пробел.
- `v`: версия формата. `Core.validateDict` проверяет `v === 1`, а также что `w`, `f` и `p` —
  объекты. Иначе словарь считается недоступным.
- Ключи в нижнем регистре. Исключения: статьи, которые в kaikki есть только с заглавной (proper
  nouns и аббревиатуры), хранятся как есть. Если есть оба варианта (`Polish`/`polish`,
  `May`/`may`), под ключом в нижнем регистре хранится lowercase-статья, а заглавная — под
  своим ключом.

### Поиск перевода (`core.js`)

0. **Защита от ключей прототипа.** Все выборки идут через `Object.hasOwn(obj, key)` (или после
   `JSON.parse` у объектов `w`, `f`, `p` делается `Object.setPrototypeOf(obj, null)`). Иначе
   `constructor`, `toString` или `valueOf` вернут функцию. Это покрыто тестом.
1. `normalize(text)` возвращает `{ text, map }`: заменяет `’` на `'`, удаляет U+00AD и
   zero-width символы, схлопывает `\s+` и NBSP в один пробел. `map[i]` — индекс символа в
   исходной строке. `start`/`end` результата переводятся обратно через `map`, чтобы Range
   строился по исходному текстовому узлу. Тест: `beau­tiful`.
2. `tokenAt(text, offset)` работает в окне ±64 символа. Края окна расширяются до границы слова.
   Токен — это `[A-Za-z]+(?:['-][A-Za-z]+)*`. Проверяются символы и на `offset`, и на
   `offset-1`, потому что над правой половиной последней буквы caret отдаёт `offset === end`.
   Токены с цифрами, а также URL и email (по соседним `@`, `/`, `.` без пробела) отбрасываются.
3. `lookup(dict, text, offset)`, порядок:
   1. фразы из 3, затем из 2 слов. Окно обязано содержать токен под курсором. Между токенами
      допускается только пробел: пунктуация `.,;:!?()"`, дефис и апостроф рвут фразу. При
      равной длине побеждает левое окно;
   2. токен целиком: точно, затем в нижнем регистре, затем `f` → `w`;
   3. для `x's`: основа без `'s`;
   4. для `a-b-c`: часть под курсором.
   CAPS-токен (≥2 букв) без точного совпадения пропускается.
4. Результат: `{ start, end, source, translation }`. `start`/`end` — это offset в текстовом
   узле, по ним строится Range для rect.

### Рантайм (`main.js`)

- **Фильтры перед caret API.** Сайт не в blacklist. `e.pointerType === 'mouse'`, `e.buttons === 0`.
  Выделение пустое. Цель не `input`/`textarea`/`select`/`isContentEditable`. У ближайшего
  `[lang]` значение либо отсутствует, либо `en*`.
- **caret API.** Если есть `document.caretPositionFromPoint`, используем его, иначе
  `caretRangeFromPoint`. Узел обязан быть `TEXT_NODE`. Hit-test `Core.pointInRects(x, y, rects)`:
  точка курсора лежит внутри одного из `range.getClientRects()` токена, иначе показа нет
  (паддинги, пустое место справа от строки). Фильтр `lang` — это `Core.langAllowed(value)`:
  `en`, `en-GB`, `EN` и пустое значение разрешены.
- **Жизненный цикл.**
  - Показ через 200 мс неподвижности. Warm mode: если оверлей был виден не позже 500 мс назад,
    следующее слово показывается сразу.
  - Курсор на том же ключе `(node, start, end)`: no-op.
  - Скрываем по `scroll` (capture, passive), `mouseout` с `relatedTarget === null`, `blur`,
    `visibilitychange`, `resize`, `pointerdown`, `touchstart`, Esc, а также если
    `!node.isConnected`.
  - После скролла повторно ищем слово по последним координатам курсора.
- **Оверлей.** Закрытый shadow root на `documentElement`, стили через `adoptedStyleSheets`
  (фоллбэк: `<style>` внутри shadow). Сам host-элемент защищён от CSS страницы (`* {…}`,
  `html > *`) через CSSOM: `host.style.setProperty('all', 'initial', 'important')`, затем
  `position: fixed`, `inset: 0`, `pointer-events: none`, `z-index: 2147483647` тоже с
  `important`. CSSOM под CSP разрешён. Свойства: `pointer-events: none`, `aria-hidden`,
  `user-select: none`, текст только через `textContent`, `max-width: 320px` с переносом,
  `font-size` унаследован от слова и ограничен диапазоном 12–20px. Контраст ≥ 4.5:1 в обеих
  `prefers-color-scheme`. Три режима, переключаются в меню, текущий хранится в
  `GM_setValue('overlayMode')`:
  - `cover` (по умолчанию): непрозрачная плашка ложится на rect слова и растягивается вправо.
    Если вправо не помещается, сдвигается влево.
  - `blur`: блюр-маска по rect (`backdrop-filter: blur(3px)`, без поддержки — полупрозрачная
    заливка) и бабл с переводом над словом.
  - `tooltip`: только бабл над словом.

  Бабл ставится сверху, при нехватке места — снизу. Позицию ограничивает
  `Core.clampRect(box, vp)`, где `vp = { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width,
  height: vv.height }`. Rect из `getClientRects()` приходит в координатах layout viewport,
  поэтому при pinch-zoom надо учитывать смещение.
- **Словарь.** Разбирается лениво при первом прошедшем фильтры hover:
  `JSON.parse(GM_getResourceText('dict'))`. При `null`, исключении или `v !== 1`: один
  `console.warn`, флаг `dictFailed`, пункт меню «⚠ Словарь не загружен». Больше попыток нет.
- **Фреймы.** Работаем во всех фреймах, `@noframes` нет. Ленивый парс означает, что фрейм, над
  которым мышь не была, словарь не разбирает. Blacklist проверяется по `location.hostname`
  самого фрейма.
- **Меню.**
  - «Выключить на {host}» / «Включить на {host}». Ключ — `location.hostname`, для `file:` —
    `'file:'`. Blacklist хранится в `GM_setValue('disabledHosts')` как массив.
  - «Режим: cover/blur/tooltip» циклически переключает режим.
  - Меню регистрируется **только в top-фрейме** (`window.top === window`), иначе каждый
    рекламный iframe добавит свои пункты. Фреймы только слушают `GM_addValueChangeListener`.
  - Подписи обновляются одной функцией `renderMenu()`: `GM_unregisterMenuCommand` и повторная
    регистрация. Её вызывает только listener: он срабатывает и в той вкладке, где значение
    изменили (`remote=false`), так что двойной перерегистрации не будет. Чистые части
    (`Core.toggleHost(list, host)`, `Core.hostKey(location)`, `Core.nextMode(mode)`,
    `Core.menuLabels(state)`) вынесены в `core.js`.
- **Метаблок.**
  - `@match *://*/*`, `@run-at document-idle`.
  - `@resource dict {{DICT_URL}}`. `bundle.mjs` берёт адрес из env `DICT_URL`, по умолчанию
    `https://raw.githubusercontent.com/<owner>/hover-word-translator/main/dist/dict.json`.
    Локальный адрес не должен попасть в коммит.
  - `@grant` GM_getResourceText, GM_getValue, GM_setValue, GM_registerMenuCommand,
    GM_unregisterMenuCommand, GM_addValueChangeListener.
  - `@version` повышается при каждом изменении словаря.

<details>
<summary>Сценарии <code>test/fixture.html</code> (A1–A20)</summary>

- A1 `<p>The cat runs</p>`: `runs` → через ~200 мс перевод `run`. На пробеле ничего.
- A2 Курсор справа от конца короткой строки в широком `<p>` и в паддинге блока → ничего.
- A3 `in order to`, `as well as` → перевод фразы с любого её слова. `as well. As` → фразы нет.
  `in <a>order</a> to` → только слово.
- A4 `went`, `leaves`, `better`, `Went`, `WENT` → перевод через лемму.
- A5 `don't`, `don’t`, `John's`, `well-known`, `state-of-the-art`, `COVID-19`, `x86`,
  `user@mail.com`.
- A6 `<p lang="de">die Katze</p>` → пропуск. `<p>Привет world</p>` → переводится `world`.
- A7 `<input value="hello">`, `<textarea>`, `<div contenteditable>` → никогда.
- A8 Слово у правого, верхнего и левого края, плюс очень длинный перевод → в пределах
  вьюпорта, вниз при нехватке места сверху.
- A9 Оверлей показан → колесо и скролл в `overflow:auto` контейнере → скрыт или
  переякорен, не висит.
- A10 Уход курсора за окно, drag-выделение, Esc → скрыт. Выделение и копирование работают.
- A11 `<a href>` под оверлеем → клик проходит.
- A12 `<meta http-equiv="Content-Security-Policy" content="style-src 'none'; require-trusted-types-for 'script'">`
  (отдельная `fixture-csp.html`) → стили на месте, TT-ошибок нет.
- A13 Агрессивный CSS (`* {color:red!important}`, `div {display:none!important}` в отдельной
  секции) → оверлей цел.
- A14 `<iframe srcdoc>` с английским текстом → работает внутри фрейма.
- A15 Тёмная и светлая схема (DevTools emulate) на белой и чёрной странице → контраст ≥ 4.5:1.
- A16 `@resource` на 404 или битый JSON → один warn, меню «⚠ Словарь не загружен», ошибок
  на mousemove нет.
- A17 Выключить хост во вкладке 1 → вкладка 2 перестаёт показывать оверлей без
  перезагрузки, подпись меню обновлена.
- A18 `<pre>` на 1 МБ и 10k узлов → обработчик ≤ 2 мс, нет long tasks на холостом движении.
- A19 Тач-эмуляция → тап не оставляет оверлей.
- A20 `<dialog open>` или fullscreen → зафиксированное ограничение.

</details>

## Technical Considerations

- **Производительность.** Обработчик `pointermove` не вызывает caret API чаще одного раза за
  кадр (rAF) и сразу выходит, если курсор не сдвинулся больше чем на 2px. Регэксп работает
  только на окне ±64 символа. Бюджеты:
  - `JSON.parse` словаря ≤ 150 мс в Node (замер `bench-dict.mjs`);
  - `dict.json` ≤ 8 МБ;
  - ориентир размера: топ-50K FrequencyWords. Если не влезаем в бюджет, уменьшаем N.
- **Безопасность.** Никакого `innerHTML` и `setAttribute('style')`, то есть Trusted Types и
  строгий CSP нам не мешают. Сеть не нужна: `@resource` скачивает сам Tampermonkey.
- **Сборка словаря.**
  - Python 3.9, только stdlib (`json`, `gzip`), `unittest`. Дамп читается построчно.
  - Пиковая память ограничена индексами отобранных слов: частотный список грузится первым, и
    статьи вне него отбрасываются сразу.
  - Скачать дамп (3.0 ГБ, `https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl`)
    и `en_50k.txt` (hermitdave/FrequencyWords) в `build/data/`. **Это делается только после
    подтверждения пользователя.** Файлы считаются недоверенными данными, мы их только читаем.
- **Лицензии.** Данные Wiktionary распространяются под CC BY-SA, FrequencyWords — под
  CC BY-SA 4.0 (сверить при сборке). Атрибуцию кладём в `dist/ATTRIBUTION.md` и в `@description`.
- **Принятые ограничения MVP.**
  - Слова, разорванные разметкой (`<b>un</b>believable`), не поддерживаются.
  - top-layer (`<dialog>`, fullscreen) рисуется поверх оверлея.
  - canvas-редакторы и SVG `<text>` не поддерживаются.
  - Фраза, разбитая переносом строки: закрываем первый rect.
  - Проверка `lang` смотрит только на явный атрибут.

## Implementation Phases

### Phase 1: Dictionary build pipeline

- **Status:** Done
- **Scope:** `build_dict.py` потоково собирает `dist/dict.json` (`v`, `w`, `f`, `p`) из kaikki и
  частотного списка. Есть unit-тесты на фикстуре и `.gitignore` для `build/data/`.
- **Files touched:** `build/build_dict.py`, `build/tests/__init__.py`,
  `build/tests/test_build_dict.py`, `build/tests/fixtures/kaikki-sample.jsonl`,
  `build/tests/fixtures/freq-sample.txt`, `scripts/bench-dict.mjs`, `.gitignore`,
  `dist/dict.json`, `dist/ATTRIBUTION.md`
- **Acceptance criteria:**
  - Тесты проходят. Фикстура проверяет:
    - ru-переводы word- и sense-уровня, игнор других языков;
    - `f` для `went → go`, приоритет по частоте для `leaves`, отсев форм с тегами
      `romanization`/`table-tags`;
    - коллизию регистра `Polish`/`polish`;
    - фразы из 2–3 слов;
    - отсев слов вне частотного списка;
    - `v == 1`.
  - Реальная сборка (после скачивания с подтверждения) даёт `dict.json` ≤ 8 МБ, и
    `bench-dict.mjs` укладывается в бюджет. Ручная проверка 50 частых слов приемлема.
- **Validation:** `python3 -m unittest discover -s build/tests -t build -v && node scripts/bench-dict.mjs`

### Phase 2: Core logic + bundler

- **Status:** Done
- **Scope:** Чистые функции в `core.js`: normalize (с картой индексов), tokenAt, lookup,
  validateDict, pointInRects, langAllowed, clampRect, hostKey, toggleHost, nextMode, menuLabels.
  Тесты на `node --test` (синтетический мини-словарь в тесте, реальный `dist/dict.json` не
  нужен) и `bundle.mjs`.
- **Files touched:** `src/core.js`, `src/header.txt`, `scripts/bundle.mjs`, `test/core.test.mjs`
- **Acceptance criteria:** Тесты покрывают:
  - апострофы (`don't`, `don’t`, `John's`);
  - дефисы (`well-known`, тире `—` не склеивает);
  - отбрасывание `COVID-19`, `x86`, `user@mail.com`;
  - порядок поиска: фраза > слово > лемма;
  - фраза рвётся на пунктуации (`as well. As`) и на дефисе; при равной длине побеждает
    левое окно;
  - регистр (`Went`, `WENT`, CAPS без совпадения → null);
  - ключи прототипа (`constructor`, `toString`) → null;
  - `normalize` с soft hyphen возвращает исходные offset;
  - граница caret: `offset === end`, `offset === start`, offset на пробеле;
  - окно ±64: на строке 1 МБ в регэксп уходит ≤ 128+ символов. Проверяется инвариантом
    (длина входа), а не временем. Токен на краю окна не обрезается;
  - `clampRect` у четырёх краёв, переход вниз, ненулевой `offsetLeft`/`offsetTop`;
  - `hostKey` для `file:`, `toggleHost`, `langAllowed` (`en-GB`, `EN`, `de`, `''`),
    `validateDict` на битых объектах.
- **Validation:** `node --test test/core.test.mjs && node scripts/bundle.mjs`

### Phase 3: Userscript runtime, overlay modes, menu

- **Status:** Done
- **Scope:** `main.js` по разделу «Рантайм»: события, caret API и hit-test, жизненный цикл, три
  режима оверлея в shadow root, ленивый словарь с обработкой ошибок, меню с синхронизацией
  вкладок. Плюс `test/fixture.html` со сценариями A1–A20. Удалить `old_script.js`.
- **Files touched:** `src/main.js`, `src/header.txt`, `test/fixture.html`,
  `dist/hover-translator.user.js`, `old_script.js` (удалить), `README.md`
- **Acceptance criteria:** Сборка проходит, запрещённых API нет, в Chrome и Firefox пройдены
  сценарии A1–A20 из `test/fixture.html`.
- **Validation:** `node --test test/core.test.mjs && node scripts/bundle.mjs && ! grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\(.style' src/*.js` + manual (см. Success Criteria)

## Success Criteria

```success-criteria
GOAL: Tampermonkey-скрипт без мутаций DOM показывает русский перевод английского слова/фразы под курсором из офлайн-словаря, собранного из kaikki и доставляемого через @resource, с выбором режима оверлея и выключателем по сайтам.

SUCCESS CRITERIA:
- Пайплайн сборки словаря покрыт тестами и проходит | verify: python3 -m unittest discover -s build/tests -t build
- dist/dict.json существует, формат v=1, размер ≤ 8 МБ | verify: node -e "const d=require('./dist/dict.json');if(d.v!==1||!d.w||!d.f||!d.p)process.exit(1)" && test $(wc -c < dist/dict.json) -le 8000000
- JSON.parse словаря укладывается в 150 мс (Node, ориентир) | verify: node scripts/bench-dict.mjs
- Логика токенизации/поиска/hit-test/позиционирования/меню покрыта тестами | verify: node --test test/core.test.mjs
- Бандл собирается, содержит @resource dict с https-URL и нужные @grant, без захардкоженного словаря (< 100 КБ) | verify: node scripts/bundle.mjs && node --check dist/hover-translator.user.js && grep -qE '@resource +dict +https://' dist/hover-translator.user.js && grep -qE '@grant +GM_addValueChangeListener' dist/hover-translator.user.js && test $(wc -c < dist/hover-translator.user.js) -lt 100000
- В исходниках нет HTML-инъекций и inline-style атрибутов (Trusted Types/CSP-safe) | verify: ! grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\(.style' src/*.js
- old_script.js удалён | verify: test ! -e old_script.js
- Ручные сценарии на фикстуре проходят в Chrome и Firefox | verify: manual 1) Установить dist/hover-translator.user.js в Tampermonkey (Chrome, затем Firefox), предварительно собрав `DICT_URL=http://localhost:8000/dict.json node scripts/bundle.mjs` и запустив `python3 -m http.server 8000 -d dist`; после проверки пересобрать без env. 2) Открыть test/fixture.html через http://localhost. 3) Пройти A1–A20 из фикстуры (слова/фразы/формы, hit-test пустоты, поля ввода, края вьюпорта, скролл, выделение, клик сквозь оверлей, CSP/TT-блок, агрессивный CSS, iframe srcdoc, тёмная/светлая схема, битый dict, синхронизация выключателя между вкладками, тач-эмуляция). 4) Переключить три режима оверлея в меню и проверить каждый на A1 и A8. 5) Performance panel: на холостом движении мыши нет long tasks.

NON-GOALS:
- Фоллбэк на Yandex Dictionary API и кэш переводов (этап 2)
- Показ нескольких значений с пометками POS / омонимы (этап 3)
- Слова, разорванные разметкой; top-layer (dialog/fullscreen); canvas-редакторы
- Публикация на Greasy Fork, настройки помимо меню

VERIFICATION COMMAND: python3 -m unittest discover -s build/tests -t build && node -e "const d=require('./dist/dict.json');if(d.v!==1||!d.w||!d.f||!d.p)process.exit(1)" && test $(wc -c < dist/dict.json) -le 8000000 && node scripts/bench-dict.mjs && node --test test/core.test.mjs && node scripts/bundle.mjs && node --check dist/hover-translator.user.js && grep -qE '@resource +dict +https://' dist/hover-translator.user.js && grep -qE '@grant +GM_addValueChangeListener' dist/hover-translator.user.js && test $(wc -c < dist/hover-translator.user.js) -lt 100000 && ! grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\(.style' src/*.js && test ! -e old_script.js
```

## Plan Review (2026-10-08)

- VGV-ревью: в план внесены 15 находок. Критичные: ключи прототипа, карта индексов
  `normalize`, `unittest -t build`. Также: меню только в top-фрейме, чистые функции рантайма
  перенесены в `core.js` и покрыты тестами, защита shadow host, смещение `visualViewport`,
  правила форм и фраз, перф-тест через инвариант вместо времени, `wc -c` вместо `stat`,
  `DICT_URL` через env.
- Простота и масштаб: агенты не запустились (шлюз вернул 404 `model_not_found` для их модели),
  проверка сделана вручную. Убран `package.json` (хватает `node --test`). Бенчмарк перенесён в
  фазу 1, где появляется реальный словарь. Делить на отдельные PR не нужно: три фазы
  последовательны, и каждая коммитится отдельно (личный проект).

## Success Metrics

- В ручной выборке из 50 частых слов и 10 фраз приемлемый перевод получают не меньше 45 слов
  и 8 фраз.
- На обычных страницах (статья в Википедии, README на GitHub) оверлей появляется на любом
  словарном слове. Ложных показов в пустоте и в полях ввода нет.

## Dependencies & Risks

- **Скачивание дампа на 3.0 ГБ.** Требует подтверждения пользователя, места на диске и времени.
  Чтобы не держать дамп, можно читать поток `curl … | python3 build/build_dict.py -`. Решается
  в фазе 1.
- **Качество переводов kaikki.** У частых слов много значений, «первый ru» может оказаться
  редким значением. Митигация: правило «первые значения по порядку kaikki» и ручная
  проверка. Если результат плохой, следующим планом подмешиваем FreeDict eng-rus (62 181 слово).
- **Публичный GitHub-репозиторий для raw-URL.** Нужно решение пользователя: owner, публичность,
  push. До этого тестируем через локальный `http.server`.
- **Tampermonkey может передавать текст `@resource` в каждую инъекцию** (каждый фрейм). Если
  замер в фазе 3 покажет заметную цену, переходим на `GM_getResourceURL` + `fetch` по
  первому ховеру.
- **Python 3.9 на машине.** Используем только stdlib-синтаксис 3.9, без `match` и `X | Y` в
  аннотациях.

## References & Research

- Брейнсторм: `docs/brainstorm/2026-10-08-hover-translator-v2-brainstorm-doc.md`. Там же
  таблица источников словарей.
- Текущий скрипт: `old_script.js:15` (словарь), `old_script.js:~500` (CSS), `old_script.js:~560`
  (`processNode`).
- Формат kaikki/wiktextract (`translations[]`: `code`, `word`, `sense`; `forms`, `senses[].form_of`):
  https://github.com/tatuylonen/wiktextract
- Дамп: https://kaikki.org/dictionary/English/ (`kaikki.org-dictionary-English.jsonl`, 3.0 ГБ)
- Частотный список: https://github.com/hermitdave/FrequencyWords (`content/2018/en/en_50k.txt`)
- Лимит `@resource` (~77 МБ ломает загрузку): Tampermonkey/tampermonkey#1776
- Анализ флоу (user-flow-analysis-agent, 2026-10-08): edge cases 1–40 и сценарии A1–A20 внесены
  в разделы «Рантайм» и Success Criteria.
