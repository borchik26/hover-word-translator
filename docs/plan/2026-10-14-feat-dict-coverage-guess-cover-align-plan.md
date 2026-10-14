---
title: "feat: dictionary coverage, morphological guesses, right-aligned cover"
type: feat
date: 2026-10-14
---

## feat: dictionary coverage, morphological guesses, right-aligned cover - Standard

## Overview

Три изменения по итогам чтения технических текстов
(брейнсторм: `docs/brainstorm/2026-10-14-dict-coverage-cover-align-brainstorm-doc.md`):

1. **Словарь без частотного фильтра для слов и форм.** Так в него попадут endpoint,
   functionality, shortcoming, а также формы interfaces, reused, blocs, endpoints, shortcomings.
2. **Морфологические догадки в рантайме.** Если точный поиск промахнулся, отрезаем суффикс или
   делим составное слово и показываем «≈ перевод основы». Это для слов, у которых в Wiktionary
   нет русского перевода: analyzer, deployable, deterministic, codebase. Догадки выключаются
   пунктом меню Tampermonkey.
3. **Cover прижимается к правому краю слова,** длинный перевод растёт влево.

## Problem Statement / Motivation

- `build/build_dict.py:107` отбрасывает однословные статьи, если слова нет в `en_50k.txt`.
  Это частотный список по субтитрам, технической лексики в нём нет.
- Там же, `build/build_dict.py:127`: форма попадает в `f`, только если сама форма частотная.
  Поэтому `interfaces` → `interface` не работает, хотя лемма есть в `w`.
- У analyzer, codebase, deployable, deterministic, monorepo в kaikki нет `ru`-переводов,
  сборкой их не достать.
- `src/main.js:103-107`: cover ставит плашку от `rect.left` с `min-width = rect.width`. Длинный
  перевод уходит вправо и закрывает следующее слово.

## Proposed Solution

### 1. Сборка словаря (`build/build_dict.py`)

- Частотная проверка `word_rank` остаётся только для фраз (`len(tokens) > 1`). Однословные
  статьи с ru-переводом берутся все.
- Форма из `forms[]` попадает в кандидаты без проверки частотности. В `f` она пишется, как и
  раньше, только если лемма есть в `w`.
- Если у формы несколько лемм, выбирается самая частотная. Для лемм вне списка ранг
  `float("inf")`: `min(known, key=…)` не должен падать на `None`, первая увиденная выигрывает
  при равенстве.
- `--freq` остаётся обязательным (нужен для фраз и порядка лемм). `--top` теперь ограничивает
  только фразы, обновить help и README.
- Пересобрать `dist/dict.json`. Замер прототипа: 1.55 → ~3.3 MB, w 20.6K → 42.5K,
  f 10.9K → 52.6K, `JSON.parse` 48 ms (бюджет 150 ms).

### 2. Догадки (`src/core.js`)

Новая функция `guessWord(dict, word)`. Её вызывает `findWord` **последним шагом**, после
промаха по ключам и после веток `'s` и дефиса. Поэтому `analyzer's` и `cloud-deployable`
работают через существующую рекурсию, и `start/end` указывают на часть слова. Догадки
включаются флагом: `lookup(dict, text, offset, { guess })` → `findWord(…, guess)`. `core.js`
остаётся чистым: состояние не читает.

Когда догадки **не** запускаются:

- слово с заглавной в середине предложения (Parker, Turner, Fischer — скорее имена);
- CAPS-токены короче 4 букв (акронимы, как в `findWord`).

Алгоритм для `w = word.toLowerCase()`:

1. **Словоизменение (не больше одного шага).** Кандидаты: `w` и основы после снятия
   окончаний `-s`, `-es`, `-ies→y`, `-ed`, `-ied→y`, `-ing` с вариантами `+e` и снятия
   удвоенной согласной. Для каждого кандидата `c ≠ w` пробуем `resolve(dict, c)`.
2. **Словообразовательный суффикс (не больше одного).** Для каждого кандидата из шага 1:

   | Суффикс | Варианты основы | Пример |
   |---|---|---|
   | `-er`, `-or` | `''`, `+e`, снять удвоение | analyzer → analyze |
   | `-able`, `-ible` | `''`, `+e`, снять удвоение | deployable → deploy |
   | `-ity` | `''`, `+e` | functionality → functional |
   | `-ness`, `-ment` | `''` | |
   | `-istic` | `-ism`, `-ist` | deterministic → determinism |
   | `-ic` | `''` | |

   Основа короче 3 букв отбрасывается. Первое попадание через `resolve` побеждает. Порядок
   строк таблицы и вариантов фиксируется тестами.
3. **Составное слово.** Для каждого кандидата из шага 1 перебираем разрез от самой длинной
   левой части к короткой. Обе части длиной ≥ 3 и обе лежат в `dict.w` (не `f`). Первый
   подходящий разрез побеждает → `≈ код + база`.
4. Результат: `{ start, end, source: <основа или 'a+b'>, translation: '≈ ' + <первый вариант> }`.
   Первый вариант — часть до первой `, `. Основа в тексте не показывается (решение
   пользователя): `≈ развёртывать`.

Известные ограничения (тестами не закрываются): monorepo остаётся без перевода (repo нет в
словаре). Ложные основы вроде number → numb возможны, только если самого слова нет в словаре.
Для частых слов это исключено, догадка срабатывает только при промахе.

### 3. Меню (`src/core.js`, `src/main.js`)

- `Core.parseGuess(value)` → `value !== false` (по умолчанию включено, мусор → вкл).
- `Core.menuLabels({ …, guess })` возвращает `guess: 'Догадки: вкл' | 'Догадки: выкл'`. Подпись
  показывает состояние, как `Режим: …`.
- `main.js`: `state.guess = Core.parseGuess(GM_getValue('guessEnabled'))`, новый пункт меню
  пишет `GM_setValue('guessEnabled', !state.guess)`, `GM_addValueChangeListener('guessEnabled', …)`.
- **Исправить `onSettingChanged`:** сейчас ветка `else` пишет `state.mode` для любого ключа,
  кроме `disabledHosts`. Нужны явные ветки по `name`, иначе переключение догадок сбросит режим
  в cover.
- `hitAt` передаёт `{ guess: state.guess }` в `Core.lookup`.

### 4. Cover справа (`src/core.js`, `src/main.js`)

- `Core.clampRect`: при `above = false` (cover) `left = anchor.right - size.width`, дальше
  прежний `clamp` к viewport. Если плашка у левого края, она сдвигается вправо и может снова
  закрыть следующее слово. Это принято в брейнсторме.
- `main.js` уже передаёт `rect` (DOMRect, у него есть `right`). `min-width = rect.width`
  оставляем: короткий перевод по-прежнему закрывает всё слово.
- Режимы tooltip и blur не меняются (`above = true`, якорь слева).
- Если перевод длиннее 320px (`max-width`), он переносится на вторую строку и закрывает строку
  ниже. Это как сейчас, вне scope.

### 5. Прочее

- `src/header.txt`: `@version` 2.0.0 → 2.1.0. Tampermonkey перекачивает `@resource` при смене
  версии.
- `README.md`: размер словаря (~3.3 MB), пункт меню «Догадки», смысл `--top`.
- `test/fixture.html`: секция A21 с техническими словами и догадками. A8 дополнить
  ожиданием «cover: правый край плашки = правый край слова».

## Technical Considerations

- **Производительность.** `loadDict` парсит словарь лениво, в каждом фрейме отдельно. Двойной
  размер — это ~2× память и ~48 ms на фрейм при первом наведении. Терпимо, бюджет бенча
  150 ms. Догадка — десятки `has()` по объекту на промах, раз в кадр под курсором.
- **Регрессии частых слов.** Без фильтра в `w` попадут редкие статьи с заглавной. `findWord` в
  середине предложения пробует исходный регистр первым. Новые ключи с заглавной не задевают
  строчные слова, но разрешение частых слов нужно сверить с текущим словарём (см. Success
  Criteria).
- **Безопасность.** Новых DOM-API нет, перевод по-прежнему ставится через `textContent`.

## Implementation Phases

### Phase 1: Dictionary without frequency filter

- **Status:** Done
- **Scope:** `build_dict.py` по разделу 1, обновить Python-тесты, пересобрать `dist/dict.json`,
  README (размер, `--top`).
- **Files touched:** `build/build_dict.py`, `build/tests/test_build_dict.py`,
  `build/tests/fixtures/*` (если нужны новые статьи), `dist/dict.json`, `README.md`
- **Acceptance criteria:** тесты на «редкое слово сохраняется», «форма редкой леммы
  сохраняется», «редкая фраза отбрасывается», «`--top` режет только фразы», «лемма вне
  частотного списка не роняет выбор». В новом словаре есть endpoint, functionality,
  shortcoming, а interfaces, reused, blocs, endpoints, shortcomings разрешаются через `f`.
- **Validation:** `python3 -m unittest discover -s build/tests -t build && node scripts/bench-dict.mjs`

### Phase 2: Guesses, menu toggle, right-aligned cover

- **Status:** Not started
- **Scope:** разделы 2–5: `guessWord`, флаг в `lookup`/`findWord`, `parseGuess`, `menuLabels`,
  `clampRect`, ветки `onSettingChanged`, пункт меню, версия, фикстура, сборка бандла.
- **Files touched:** `src/core.js`, `src/main.js`, `src/header.txt`, `test/core.test.mjs`,
  `test/fixture.html`, `README.md`, `dist/hover-translator.user.js`
- **Acceptance criteria:** тесты из списка ниже зелёные, бандл собирается, ручные сценарии
  пройдены.
- **Validation:** `node --test test/core.test.mjs && node scripts/bundle.mjs && node --check dist/hover-translator.user.js` + manual

Новые/изменённые тесты в `test/core.test.mjs` (мини-словарь дополнить analyze, deploy,
determinism, functional, code, base, interface и формой `interfaces`):

- суффиксы: analyzer, deployable, deterministic, functionality → `≈ …` первым вариантом;
- словоизменение + суффикс: analyzers → `≈ анализировать`;
- составное: codebase → `≈ код + база`; части короче 3 букв не режутся;
- `'s` и дефис: `analyzer's`, `cloud-deployable` (start/end на части);
- слово из словаря никогда не идёт в догадку (точный перевод без `≈`);
- `{ guess: false }` и аргумент по умолчанию → analyzer = null;
- заглавная в середине предложения (`met Parker`) → null; в начале предложения → догадка;
- основа короче 3 букв отбрасывается;
- `clampRect` cover: правый край совпадает со словом, рост влево, упор в левый край;
  тестовый `word()` дополнить полем `right`;
- `parseGuess` (undefined/true/false/мусор), `menuLabels` с `guess`.

## Success Criteria

```success-criteria
GOAL: Технические слова (endpoint, interfaces, reused, analyzer, deployable, codebase…) получают перевод — точный из словаря или помеченную «≈» морфологическую догадку, выключаемую в меню, — а плашка cover не залезает на следующее слово.

SUCCESS CRITERIA:
- Сборка словаря покрыта тестами и проходит | verify: python3 -m unittest discover -s build/tests -t build
- В dist/dict.json есть точные переводы endpoint, functionality, shortcoming и формы interfaces, reused, blocs, endpoints, shortcomings | verify: node -e "const d=require('./dist/dict.json');const R=k=>d.w[k]??(d.f[k]&&d.w[d.f[k]]);const m=['endpoint','functionality','shortcoming','interfaces','reused','blocs','endpoints','shortcomings'].filter(k=>!R(k));if(m.length){console.error(m);process.exit(1)}"
- Словарь в формате v=1, ≤ 8 МБ, JSON.parse в бюджете | verify: node -e "const d=require('./dist/dict.json');if(d.v!==1||!d.w||!d.f||!d.p)process.exit(1)" && test $(wc -c < dist/dict.json) -le 8000000 && node scripts/bench-dict.mjs
- Догадки на реальном словаре: analyzer, deployable, deterministic, codebase получают «≈ …», с guess:false — null | verify: node -e "const C=require('./src/core.js'),d=require('./dist/dict.json');for(const w of ['analyzer','deployable','deterministic','codebase']){const t='the '+w+' here',o=4;const g=C.lookup(d,t,o,{guess:true}),n=C.lookup(d,t,o,{guess:false});if(!g||!g.translation.startsWith('≈ ')||n){console.error(w,g,n);process.exit(1)}}"
- Логика догадок, меню и позиционирования покрыта тестами | verify: node --test test/core.test.mjs
- Бандл собирается, версия поднята | verify: node scripts/bundle.mjs && node --check dist/hover-translator.user.js && grep -qE '@version +2\.1\.0' dist/hover-translator.user.js
- В исходниках нет HTML-инъекций | verify: ! grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\(.style' src/*.js
- Частые слова не сменили перевод | verify: manual 1) git show HEAD:dist/dict.json > /tmp/old-dict.json (до коммита фазы 1). 2) Сравнить разрешение (w, затем f→w) первых 5000 слов build/data/en_50k.txt в старом и новом словаре. 3) Каждое изменение просмотреть, ухудшения поправить в сборке или записать в Dependencies & Risks.
- Cover и меню в браузере | verify: manual 1) Собрать с DICT_URL=http://localhost:8000/dict.json, поднять python3 -m http.server 8000 -d dist, установить скрипт в Tampermonkey. 2) test/fixture.html: A8 — в cover правый край плашки совпадает с правым краем слова, длинный перевод растёт влево, у левого края экрана сдвиг вправо; tooltip и blur как раньше. 3) A21 — технические слова: точные без «≈», догадки с «≈». 4) Меню «Догадки: вкл» → выкл: analyzer перестаёт переводиться, режим оверлея не сбросился; состояние синхронно во второй вкладке. 5) Пересобрать бандл без DICT_URL.

NON-GOALS:
- Ручной доп. словарь (extra.tsv) и API-фоллбэк
- Перевод monorepo и других слов, у которых нет переводимой основы
- Показ основы в догадке («≈ deploy: …»), несколько вариантов перевода
- Изменение tooltip/blur, переносы длинных переводов >320px
- Префиксы (non-, re-, un-) в догадках

VERIFICATION COMMAND: python3 -m unittest discover -s build/tests -t build && node -e "const d=require('./dist/dict.json');const R=k=>d.w[k]??(d.f[k]&&d.w[d.f[k]]);const m=['endpoint','functionality','shortcoming','interfaces','reused','blocs','endpoints','shortcomings'].filter(k=>!R(k));if(m.length){console.error(m);process.exit(1)}" && node -e "const d=require('./dist/dict.json');if(d.v!==1||!d.w||!d.f||!d.p)process.exit(1)" && test $(wc -c < dist/dict.json) -le 8000000 && node scripts/bench-dict.mjs && node -e "const C=require('./src/core.js'),d=require('./dist/dict.json');for(const w of ['analyzer','deployable','deterministic','codebase']){const t='the '+w+' here',o=4;const g=C.lookup(d,t,o,{guess:true}),n=C.lookup(d,t,o,{guess:false});if(!g||!g.translation.startsWith('≈ ')||n){console.error(w,g,n);process.exit(1)}}" && node --test test/core.test.mjs && node scripts/bundle.mjs && node --check dist/hover-translator.user.js && grep -qE '@version +2\.1\.0' dist/hover-translator.user.js && ! grep -nE 'innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\(.style' src/*.js
```

> Plan review skipped by user request.

## Success Metrics

Все 11 слов из исходного запроса, кроме monorepo/monorepos, получают перевод (точный или «≈»),
частые слова переводятся как раньше.

## Dependencies & Risks

- Для пересборки нужен локальный дамп `build/data/kaikki.jsonl` (3 GB) и `en_50k.txt`, оба
  есть. Сборка занимает ~1.5 мин.
- **Тай-брейк лемм.** В прототипе (все ранги равны) 16 частых форм сменили лемму, например
  came → «с, семя». С рангами из `en_50k` и `inf` для остальных это должно уйти, проверяется
  ручным критерием «Частые слова не сменили перевод».
- `dist/hover-translator.user.js` сейчас изменён в рабочем дереве (не закоммичен). Перед фазой 2
  выяснить, чьи это правки, и не затереть их пересборкой бандла.
- Догадки могут ошибаться (corner → corn, если corner нет в словаре). Митигация: только при
  промахе, метка «≈», выключатель.

## References & Research

- Брейнсторм: `docs/brainstorm/2026-10-14-dict-coverage-cover-align-brainstorm-doc.md`
- Фильтр частотности: `build/build_dict.py:107`, формы: `build/build_dict.py:122-129`, выбор
  леммы: `build/build_dict.py:139`
- Поиск слова: `src/core.js` `findWord` / `lookup` / `resolve`
- Позиционирование: `src/core.js` `clampRect`, `src/main.js` `render`
- Меню и настройки: `src/main.js` `renderMenu`, `onSettingChanged`
- Прошлый план: `docs/plan/2026-10-08-feat-hover-translator-v2-mvp-plan.md`
- Замер прототипа (2026-10-14): без фильтра w=42485, f=52585, p=11834, 3.29 MB, parse 48 ms
- Анализ пользовательских сценариев (user-flow-analysis-agent): баг `onSettingChanged`, место
  вызова догадки в `findWord`, регистр, глубина разбора, `float('inf')`, `anchor.right` в
  тестах — всё учтено выше.
