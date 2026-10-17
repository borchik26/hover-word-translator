---
title: "feat: userscript v2 for Chinese-Russian hover translation"
type: feat
date: 2026-10-17
---

# feat: userscript v2 for Chinese-Russian hover translation - Extensive

## Overview

Добавление второго независимого userscript для перевода китайского текста на русский при наведении (`dist/hover-translator-zh.user.js`). Скрипт решает ключевую проблему китайского языка — отсутствие пробелов между словами — за счёт гибридного сегментатора (bidirectional maximum matching по словарю + опциональная Jieba) и двух офлайн-словарных слоёв (БКРС напрямую zh→ru и CC-CEDICT zh→en + открытый en→ru, сведённые на этапе сборки) с мгновенным переключением в настройках.

Скрипт переиспользует проверенный рантайм v1 (hover через Caret API, закрытый shadow root на `<html>`, режимы cover/blur/tooltip) и получает собственное ядро `src/core-zh.js`, панель настроек в shadow root и отдельный пайплайн сборки словарей на Python.

## Problem Statement

Текущий скрипт `dist/hover-translator.user.js` (v2.1.0) рассчитан исключительно на английский язык:
1. **Токенизация:** `Core.scan` опирается на регулярное выражение `TOKEN_RE` с пробельными разделителями и жёстко отсекает любые не-ASCII токены через `ASCII_TOKEN_RE = /^[A-Za-z'-]+$/` (`src/core.js:8`). При наведении на китайские иероглифы (CJK Unified Ideographs `一-鿿`) токенайзер склеивает весь абзац в один токен и бракует его.
2. **Отсутствие сегментации:** В китайском языке нет пробелов между словами. Строка вроде `研究生命科学` может читаться как `研究生 / 命 / 科学` или `研究 / 生命 / 科学` в зависимости от контекста. Нужен механизм вычисления границ слова под курсором на лету.
3. **Языковой фильтр:** `Core.langAllowed` (`src/core.js:252-254`) разрешает только атрибуты `lang="en*"` или их отсутствие. Страницы с `lang="zh*"` молча игнорируются.
4. **Словарь:** Текущий `dist/dict.json` (3.3 MB) содержит пары en→ru из Wiktionary/kaikki.org. Перевод китайского требует специализированных словарных баз с поддержкой пиньиня, традиционных вариантов и частей речи.
5. **Настройки:** В v1 настройки состоят из 3 пунктов меню Tampermonkey (`GM_registerMenuCommand`). Для китайского нужно переключать словарный слой, режим сегментации и 4 элемента попапа — меню скриптов для этого не приспособлено.

## Proposed Solution

Разработка параллельного решения в рамках единого репозитория:

1. **Рефакторинг `src/main.js` в языко-нейтральный рантайм:**
   - Вынесение привязки к конкретному объекту `Core` через интерфейс конфигурации (впрыск ядра при бандлинге или унифицированный контракт `Core.lookup`, `Core.langAllowed`, `Core.validateDict`).
   - Поддержка переключения активного словаря на лету через `GM_getResourceText`.
   - Встраивание панели настроек в shadow root (открытие по горячей клавише или пункту меню).

2. **Создание `src/core-zh.js`:**
   - CJK-нормализатор и токенизатор диапазонов иероглифов (`一-鿿`, `㐀-䶿`, редкие иероглифы).
   - Алгоритм **Bidirectional Maximum Matching (BiMM)** по словарю для окна символов вокруг курсора (до 8 символов влево и вправо) — находит самое длинное и качественное словарное слово.
   - Опциональный мост к сегментатору **Jieba** (`jieba-js`), если включён в настройках.
   - Чистый JS-конвертер цифрового пиньиня в диакритический (`hao3` → `hǎo`, `Zhong1guo2` → `Zhōngguó`, включая эйхуа `er` и `v`/`u:`).
   - Поддержка поиска по упрощённым и традиционным иероглифам.

3. **Пайплайн сборки словарей (`build/build_dict_zh.py`):**
   - **Слой A (БКРС):** парсинг дампа `dabkrs` (отсечение примеров и разметки, компактная структура `{ "w": { "你好": { "p": "ni3 hao3", "t": "привет", "pos": "межд." } } }`).
   - **Слой B (CC-CEDICT + en→ru):** парсинг `cedict_ts.u8` + сведение с открытой базой перевода en→ru (kaikki/Wiktionary), упаковка в аналогичный формат.
   - Сжатие и оптимизация ключей для удержания размера в допустимых пределах браузера.

4. **Панель настроек в Shadow Root:**
   - Модальное окно или выезжающая шторка, изолированная от стилей страницы.
   - Настройки: выбор словаря (БКРС / CC-CEDICT), режим сегментации (BiMM / Jieba / Гибрид), тумблеры элементов (пиньинь, традиционная форма, POS, синонимы), выбор режима оверлея.
   - Реактивное сохранение через `GM_setValue` и слушатель `GM_addValueChangeListener`.

## Technical Approach

### Architecture

```
hover-word-translator/
├── src/
│   ├── header.txt              # Tampermonkey заголовок en (v2.1.0)
│   ├── header-zh.txt           # Tampermonkey заголовок zh (v2.0.0, 2-3 @resource)
│   ├── core.js                 # Ядро en (существующее)
│   ├── core-zh.js              # Ядро zh (BiMM, пиньинь, словарный слой)
│   ├── main.js                 # Общий рантайм (hover, caret, shadow root, overlay, settings UI)
│   └── settings-ui.js          # Разметка и логика панели настроек (встраивается в shadow root)
├── build/
│   ├── build_dict.py           # Существующий сборщик en→ru
│   ├── build_dict_zh.py        # Сборщик китайских словарей (БКРС + CC-CEDICT fusion)
│   └── pinyin_consts.py        # Таблицы и правила расстановки тонов пиньиня
├── dist/
│   ├── dict.json               # en→ru словарь (3.3 MB)
│   ├── dict-zh-bkrs.json       # zh→ru слой БКРС
│   ├── dict-zh-cedict.json     # zh→ru слой CC-CEDICT + en→ru
│   ├── hover-translator.user.js    # Бандл en (как сейчас)
│   └── hover-translator-zh.user.js # Бандл zh (новый)
├── scripts/
│   └── bundle.mjs              # Сборщик обоих пользователейских скриптов
└── test/
    ├── core.test.mjs           # Тесты en
    ├── core-zh.test.mjs        # Тесты zh (сегментация, пиньинь, lookup)
    └── runtime.test.mjs        # Тесты общего main.js и настроек
```

### Data Formats & Schemas

#### Формат китайского словаря (`dist/dict-zh-*.json`)
```json
{
  "v": 1,
  "lang": "zh-ru",
  "w": {
    "中国": {
      "p": "Zhong1 guo2",
      "t": ["Китай", "китайский"],
      "trad": "中國",
      "pos": "сущ."
    },
    "好": {
      "p": "hao3",
      "t": ["хороший", "добрый", "ладно"],
      "trad": "好",
      "pos": "прил."
    }
  }
}
```

#### Схема состояния настроек (`GM_getValue('zh_settings')`)
```json
{
  "dictSource": "bkrs",         // "bkrs" | "cedict"
  "segmentation": "hybrid",     // "matching" | "jieba" | "hybrid"
  "overlayMode": "cover",       // "cover" | "blur" | "tooltip"
  "showPinyin": true,
  "showTraditional": true,
  "showPos": true,
  "showMultipleSenses": true,
  "disabledHosts": []
}
```

### Algorithms & Key Logic

#### 1. Bidirectional Maximum Matching (BiMM) в `core-zh.js`
В отличие от латиницы, поиск ведётся в окне ±8 CJK-символов от позиции каретки:
- **Forward Maximum Matching (FMM):** от символа под кареткой вправо берем подстроку длины `L = min(8, остаток)`. Если есть в `dict.w`, пробуем меньшие длины, выбираем максимальную.
- **Reverse Maximum Matching (RMM):** влево от символа под кареткой берем кандидатов, захватывающих позицию каретки.
- **Арбитраж:**
  1. Предпочтение отдаётся слову, содержащему позицию курсора, с максимальной длиной.
  2. При равной длине предпочтение слову с большей частотностью / словарным приоритетом.
  3. Фолбэк: если многосимвольного слова нет — берём одиночный иероглиф под курсором (в китайских словарях каждый иероглиф имеет самостоятельную статью).

#### 2. Преобразование пиньиня (Pinyin Diacritics Converter)
Алгоритм расстановки диакритических знаков по числовому тону (1–4, 5/0 — нейтральный):
- Гласные: `a`, `e`, `o`, `u`, `i`, `v` (ü).
- Правило приоритета:
  1. Если есть `a` или `e` — знак ставится над ними.
  2. Если есть сочетание `ou` — знак ставится над `o`.
  3. Во всех остальных случаях — знак ставится над последней гласной в слоге.
- Таблица тонов:
  - a: ā á ǎ à
  - e: ē é ě è
  - o: ō ó ǒ ò
  - i: ī í ǐ ì
  - u: ū ú ǔ ù
  - ü (v): ǖ ǘ ǚ ǜ

## Implementation Phases

### Phase 1: Рефакторинг архитектуры и абстракция рантайма

- **Status:** Done
- **Scope:** Разделение `src/main.js` на языко-независимую часть и адаптер ядра. Обновление `scripts/bundle.mjs` для поддержки сборки нескольких скриптов без регрессий в v1.
- **Files touched:** `src/main.js`, `scripts/bundle.mjs`, `src/header-zh.txt`
- **Acceptance criteria:** `dist/hover-translator.user.js` собирается, размер и функционал v1 полностью сохранены, существующие тесты `test/core.test.mjs` проходят.
- **Validation:** `node scripts/bundle.mjs && node --test test/core.test.mjs`

### Phase 2: Ядро китайского языка (`core-zh.js`) и тесты

- **Status:** Done
- **Scope:** Реализация CJK-токенизации, алгоритма BiMM по словарю, конвертера пиньиня, форматирования словарной статьи и модульных тестов.
- **Files touched:** `src/core-zh.js`, `test/core-zh.test.mjs`
- **Acceptance criteria:** Модульные тесты покрывают токенизацию, BiMM сегментацию, конвертацию пиньиня (включая крайние случаи ü, erhua) и валидацию структуры словаря.
- **Validation:** `node --test test/core-zh.test.mjs`

### Phase 3: Пайплайн сборки китайских словарей

- **Status:** Not started
- **Scope:** Разработка `build/build_dict_zh.py` для конвертации дампов БКРС и CC-CEDICT (+ en→ru fusion) в компактный JSON `dist/dict-zh-*.json`.
- **Files touched:** `build/build_dict_zh.py`, `build/tests/test_build_dict_zh.py`
- **Acceptance criteria:** Скрипт принимает тестовую фикстуру дампа БКРС и строки CC-CEDICT, генерирует валидный JSON словаря, проходящий валидацию `CoreZh.validateDict`.
- **Validation:** `python3 -m unittest discover -s build/tests -p "test_*.py"`

### Phase 4: Панель настроек в Shadow Root и интеграция Jieba

- **Status:** Not started
- **Scope:** Разработка легковесного UI панели настроек в shadow root с сохранением в `GM_setValue`, добавление моста к Jieba (с возможностью отключения).
- **Files touched:** `src/settings-ui.js`, `src/main.js`, `src/core-zh.js`
- **Acceptance criteria:** Настройки открываются по хоткею/меню, изменения реактивно переключают словарь и отображение элементов в попапе без перезагрузки страницы.
- **Validation:** `node scripts/bundle.mjs && node --test test/core-zh.test.mjs`

### Phase 5: Сквозное E2E тестирование и фикстуры

- **Status:** Not started
- **Scope:** Создание HTML-фикстуры с китайским текстом (`test/fixture-zh.html`) для проверки на реальных DOM-деревьях, проверка сосуществования обоих скриптов на одной странице.
- **Files touched:** `test/fixture-zh.html`, `test/e2e-coexistence.test.mjs`, `README.md`
- **Acceptance criteria:** На тестовой странице китайские слова подсвечиваются и переводятся, английский скрипт игнорирует китайский текст, китайский скрипт игнорирует английский.
- **Validation:** `node --test test/*.test.mjs`

## Alternative Approaches Considered

1. **Единый универсальный скрипт для en и zh:**
   - *Отклонено:* Потребовало бы загрузки двух словарей одновременно (3.3 MB + десятки МБ китайского), что вызовет сильный оверхед по памяти на страницах, где китайский не нужен. Раздельные скрипты позволяют пользователю держать включённым только нужный.
2. **Только онлайн-API на каждый hover:**
   - *Отклонено:* Сетевые задержки (200-500мс) разрушают ощущение мгновенности hover-перевода, уязвимо к блокировкам и падению сторонних сервисов.
3. **Использование только Jieba без BiMM:**
   - *Отклонено:* Jieba требует полного частотного словаря (`dict.txt` ~5MB), который дублирует словарную базу. BiMM по самому словарю перевода работает автономно и покрывает 95% случаев.

## Success Criteria

```success-criteria
GOAL: Создать полнофункциональный отдельный userscript hover-перевода с китайского на русский с гибридной сегментацией, двумя словарными базами и панелью настроек в shadow root.

SUCCESS CRITERIA:
- Существующий en-скрипт собирается и проходит тесты без изменений в поведении | verify: node scripts/bundle.mjs && node --test test/core.test.mjs
- Новый zh-скрипт собирается в dist/hover-translator-zh.user.js | verify: test -f dist/hover-translator-zh.user.js
- Ядро core-zh.js успешно проходит все модульные тесты сегментации, пиньиня и словаря | verify: node --test test/core-zh.test.mjs
- Сборщик словаря build_dict_zh.py успешно парсит фикстуры и строит валидный JSON | verify: python3 -m unittest discover -s build/tests -p "test_build_dict_zh.py"
- Оба скрипта корректно сосуществуют на одной тестовой странице без взаимных коллизий | verify: manual 1. Открыть test/fixture-zh.html с обоими установленными скриптами. 2. Навести на английское слово — срабатывает en-скрипт. 3. Навести на китайское слово — срабатывает zh-скрипт.

NON-GOALS:
- Поддержка рукописного ввода или OCR иероглифов с картинок.
- Озвучка слов (TTS / audio pronunciation) в первой версии.
- Контекстный перевод целых абзацев нейросетью на лету.

VERIFICATION COMMAND: node scripts/bundle.mjs && node --test test/core.test.mjs && node --test test/core-zh.test.mjs && python3 -m unittest discover -s build/tests -t build
```

## Success Metrics

1. **Скорость отклика:** Время расчёта сегментации и поиска в словаре на событие `pointermove` не превышает 5 мс на стандартном CPU.
2. **Точность сегментации:** BiMM корректно определяет составные слова из 2–4 иероглифов в 90%+ тестовых предложений HSK 1–6.
3. **Потребление памяти:** Ленивый парсинг словаря не инициируется до первого наведения на китайский текст.

## Dependencies & Prerequisites

- Node.js >= 18 (для тестов `node --test` и сборщика `bundle.mjs`).
- Python >= 3.9 (для скрипта сборки словарей).
- Исходные дампы: дамп БКРС (или тестовая фикстура) и `cedict_ts.u8` в `build/data/`.

## Risk Analysis & Mitigation

1. **Риск: Размер дампа БКРС превышает лимит Tampermonkey на `@resource` (~50-70 MB).**
   - *Митигация:* Агрессивная фильтрация на этапе сборки — удаление длинных цитат и примеров использования, оставляя только заголовочное слово, пиньинь, POS и до 2-3 основных значений. Сжатие в compact JSON. При необходимости — разбиение на чанки или использование `DecompressionStream`.
2. **Риск: Неправильная сегментация омонимичных стыков иероглифов.**
   - *Митигация:* Использование двунаправленного сопоставления (BiMM) и fallback на посимвольный перевод при сомнительных границах. Предоставление тумблера подключения Jieba в настройках.

## Documentation Plan

- Обновление `README.md`: инструкция по установке китайской версии userscript, описание панели настроек и горячих клавиш.
- Добавление `dist/ATTRIBUTION-ZH.md`: фиксация лицензий БКРС и CC-CEDICT (CC BY-SA 3.0 / 4.0).

## References & Research

### Internal References
- Токенизация и Caret hit-test: `src/main.js:140-177`
- Контракт изоляции Shadow Root: `src/main.js:54-78`
- Формат и валидация словаря v1: `src/core.js:240-243`, `build/build_dict.py:164`
- Дизайн-док брейншторма: `docs/brainstorm/2026-10-16-chinese-v2-brainstorm-doc.md`

### External References
- MDBG CC-CEDICT: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- Ukoloff BKRS Converter: https://github.com/ukoloff/bkrs
- Jieba-js Segmentation: https://github.com/bluelovers/jieba-js
- Tampermonkey Resource Documentation: https://tampermonkey.net/documentation.php#_resource
