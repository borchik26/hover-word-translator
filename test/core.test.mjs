import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Core = createRequire(import.meta.url)('../src/core.js');

const dict = {
  v: 1,
  w: {
    run: 'бежать', go: 'идти', cat: 'кошка', leave: 'оставлять', good: 'хороший',
    "don't": 'не', john: 'Джон', well: 'хорошо', known: 'известный', state: 'состояние',
    art: 'искусство', beautiful: 'красивый', will: 'воля', Will: 'Уилл', polish: 'полировать',
    Polish: 'польский', it: 'это', world: 'мир', order: 'порядок', as: 'как',
    dog: 'собака', sum: 'сумма', Mark: 'Марк', mark: 'знак', and: 'и', or: 'или',
    analyze: 'анализировать', deploy: 'развёртывать, раскрываться', determinism: 'детерминизм',
    functional: 'функциональный', code: 'код, кодекс', base: 'база', park: 'парк', ham: 'ветчина',
    cloud: 'облако', interface: 'интерфейс', use: 'использовать', ab: 'аб',
  },
  f: { runs: 'run', went: 'go', leaves: 'leave', better: 'good', orphan: 'missing', interfaces: 'interface' },
  p: { 'in order to': 'чтобы', 'as well as': 'а также', 'as well': 'тоже', 'order to': 'приказ' },
};

/** Looks up the word containing the first occurrence of `needle` (+ `shift` chars). */
function at(text, needle, shift = 0) {
  return Core.lookup(dict, text, text.indexOf(needle) + shift);
}
function src(text, needle, shift) {
  const r = at(text, needle, shift);
  return r && text.slice(r.start, r.end) + ' → ' + r.translation;
}

test('plain word, form → lemma; caret right after a word resolves to that word', () => {
  assert.equal(src('The cat runs', 'cat'), 'cat → кошка');
  assert.deepEqual(at('The cat runs', 'runs'), { start: 8, end: 12, source: 'run', translation: 'бежать' });
  // A caret on the space right after a word reports offset === end; the runtime hit-test
  // (pointInRects) rejects it, so only a space not touching a word yields null here.
  assert.equal(at('The cat runs', ' runs').source, 'cat');
});

test('caret boundaries: offset === start, offset === end, offset on a space', () => {
  const t = 'a cat sat';
  assert.equal(Core.lookup(dict, t, 2).translation, 'кошка'); // start
  assert.equal(Core.lookup(dict, t, 5).translation, 'кошка'); // end: right half of the last letter
  assert.equal(Core.lookup(dict, 'cat  dog', 4), null); // second space collapsed by normalize
  assert.equal(Core.lookup(dict, 'cat\u00A0\u00A0dog', 4), null);
  assert.equal(Core.lookup(dict, 'cat  dog', 5).translation, 'собака');
});

test('apostrophes: straight, curly, possessive', () => {
  assert.equal(src("I don't know", 'don'), "don't → не");
  assert.equal(src('I don’t know', 'don'), 'don’t → не');
  assert.equal(src("John's cat", 'John', 1), 'John → Джон');
  assert.equal(src('John’s cat', 'John', 1), 'John → Джон');
});

test('hyphens: part under the caret; em dash splits words', () => {
  assert.equal(src('a well-known fact', 'known'), 'known → известный');
  assert.equal(src('a well-known fact', 'well'), 'well → хорошо');
  assert.equal(src('state-of-the-art', 'art'), 'art → искусство');
  assert.equal(src('cat—world', 'world'), 'world → мир');
});

test('numbers, emails and URLs are not prose', () => {
  for (const [text, needle] of [['COVID-19 world', 'COVID'], ['an x86 cpu', 'x86'], ['user@mail.com', 'mail'],
    ['see example.com/run now', 'run'], ['run2 fast', 'run'], ['see https://run now', 'run'],
    ['go to www.run', 'run']]) {
    assert.equal(at(text, needle), null, text);
  }
});

test('slash between words is prose', () => {
  assert.equal(src('cats and/or dogs', 'or'), 'or → или');
  assert.equal(src('cats and/or dogs', 'and'), 'and → и');
});

test('accented and non-Latin words are never split into ASCII fragments', () => {
  assert.equal(at('the résumé', 'sum'), null);
  assert.equal(at('a naïve cat', 've'), null);
  assert.equal(src('Привет world', 'world'), 'world → мир');
  assert.equal(at('Привет world', 'ив'), null);
});

test('lookup order: phrase > word > lemma, longest phrase first', () => {
  assert.equal(src('You go in order to run', 'in'), 'in order to → чтобы');
  assert.equal(src('You go in order to run', 'to'), 'in order to → чтобы');
  assert.equal(src('as well as that', 'well'), 'as well as → а также');
  assert.equal(src('He went home', 'went'), 'went → идти');
});

test('equal-length phrases: the left window wins', () => {
  // Both 2-word windows contain the caret on "order".
  const d = { ...dict, p: { 'x order': 'левое', 'order to': 'правое' } };
  const r = Core.lookup(d, 'x order to', 3);
  assert.equal(r.translation, 'левое');
});

test('punctuation and hyphens break phrases', () => {
  assert.equal(src('as well. As', 'well'), 'as well → тоже'); // "as well as" is broken by the period
  assert.equal(src('in-order to', 'order'), 'order → порядок');
  assert.equal(src('in order, to', 'order'), 'order → порядок');
});

test('case: Went, WENT, short CAPS without exact match', () => {
  assert.equal(src('Went home', 'Went'), 'Went → идти');
  assert.equal(src('WENT HOME', 'WENT'), 'WENT → идти');
  assert.equal(at('IT works', 'IT'), null);
  assert.equal(at('ZZZZ', 'ZZZZ'), null);
});

test('capitalized word: lowercase first at sentence start, exact first mid-sentence', () => {
  assert.equal(at('Will you go?', 'Will').translation, 'воля');
  assert.equal(at('Done. Will you?', 'Will').translation, 'воля');
  assert.equal(at('"Will you?"', 'Will').translation, 'воля');
  assert.equal(at('I met Will today', 'Will').translation, 'Уилл');
  assert.equal(at('the Polish army', 'Polish').translation, 'польский');
  // A lone word in its own text node (e.g. <a>Mark</a>) is not a sentence start.
  assert.equal(Core.lookup(dict, 'Mark', 1).translation, 'Марк');
  assert.equal(Core.lookup(dict, 'Mark it', 1).translation, 'знак');
});

/** Like `src`, with guesses switched on. */
function guess(text, needle, shift = 0) {
  const r = Core.lookup(dict, text, text.indexOf(needle) + shift, { guess: true });
  return r && text.slice(r.start, r.end) + ' → ' + r.translation;
}

test('guesses: derivational suffix → first variant of the stem', () => {
  assert.equal(guess('the analyzer runs', 'analyzer'), 'analyzer → ≈ анализировать');
  assert.equal(guess('a deployable app', 'deployable'), 'deployable → ≈ развёртывать');
  assert.equal(guess('is deterministic here', 'deterministic'), 'deterministic → ≈ детерминизм');
  assert.equal(guess('more functionality', 'functionality'), 'functionality → ≈ функциональный');
});

test('guesses: one inflection, then one suffix', () => {
  assert.equal(guess('two analyzers', 'analyzers'), 'analyzers → ≈ анализировать');
  assert.equal(guess('now deploying', 'deploying'), 'deploying → ≈ развёртывать');
  assert.equal(guess('reused code', 'reused'), null); // prefixes are not stripped
  assert.equal(guess('the hammer', 'hammer'), 'hammer → ≈ ветчина'); // undoubled stem, a known false friend
});

test('guesses: compound of two dictionary words, parts of 3+ letters', () => {
  assert.equal(guess('the codebase is', 'codebase'), 'codebase → ≈ код + база');
  assert.equal(guess('the abcode is', 'abcode'), null); // "ab" is too short to be a part
});

test('guesses: exact words never guess; possessive and hyphen parts do', () => {
  assert.equal(guess('the cat', 'cat'), 'cat → кошка');
  assert.equal(guess('new interfaces', 'interfaces'), 'interfaces → интерфейс');
  assert.equal(guess("the analyzer's output", 'analyzer'), 'analyzer → ≈ анализировать');
  assert.equal(guess('a cloud-deployable app', 'deployable'), 'deployable → ≈ развёртывать');
});

test('guesses: off by default and when disabled', () => {
  assert.equal(src('the analyzer runs', 'analyzer'), null);
  const text = 'the analyzer runs';
  assert.equal(Core.lookup(dict, text, 5, { guess: false }), null);
});

test('guesses: capitalized names mid-sentence and short CAPS are skipped', () => {
  assert.equal(guess('we met Parker today', 'Parker'), null);
  assert.equal(guess('Parker went home.', 'Parker'), 'Parker → ≈ парк'); // sentence start
  assert.equal(guess('the ANALYZER runs', 'ANALYZER'), 'ANALYZER → ≈ анализировать');
  assert.equal(guess('the ABS runs', 'ABS'), null);
});

test('guesses: stems shorter than 3 letters are dropped', () => {
  assert.equal(guess('the aber runs', 'aber'), null); // "ab" + -er
});

test('prototype keys never match', () => {
  for (const w of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    assert.equal(at(`a ${w} b`, w), null, w);
  }
  assert.equal(at('an orphan', 'orphan'), null); // form whose lemma is missing
});

test('normalize maps soft hyphen / NBSP / zero-width back to raw offsets', () => {
  const raw = 'so beau\u00ADtiful\u00A0\u00A0cat';
  const n = Core.normalize(raw);
  assert.equal(n.text, 'so beautiful cat');
  assert.equal(n.map.length, n.text.length);
  assert.equal(raw[n.map[n.text.indexOf('t')]], 't');
  const r = Core.lookup(dict, raw, raw.indexOf('tiful'));
  assert.deepEqual([r.start, r.end, r.translation], [3, 13, 'красивый']);
  assert.equal(Core.lookup(dict, 'run\u200Bs', 1).translation, 'бежать');
});

test('window: bounded input on a 1 MB string, edge word is not cut', () => {
  const spaced = 'word '.repeat(200_000);
  const solid = 'x'.repeat(1_000_000);
  for (const text of [spaced, solid]) {
    const [s, e] = Core.windowAround(text, 500_000);
    assert.ok(e - s <= 2 * 64 + 2 * 64, `${e - s}`);
  }
  // Word straddling the ±64 edge is extended to its boundary.
  const text = 'a '.repeat(40) + 'beautiful' + ' b'.repeat(40);
  const offset = text.indexOf('beautiful') + 70;
  const [s, e] = Core.windowAround(text, offset);
  assert.ok(s <= text.indexOf('beautiful') && e >= text.indexOf('beautiful') + 9);
  assert.equal(Core.tokenAt(text, text.indexOf('beautiful') + 4).text, 'beautiful');
});

test('tokenAt returns raw offsets and null off-word', () => {
  assert.deepEqual(Core.tokenAt('hi there', 4), { start: 3, end: 8, text: 'there' });
  assert.equal(Core.tokenAt('   ', 1), null);
});

test('validateDict', () => {
  assert.ok(Core.validateDict({ v: 1, w: {}, f: {}, p: {} }));
  for (const d of [null, 1, 'x', [], { v: 2, w: {}, f: {}, p: {} }, { v: 1, w: {}, f: {} },
    { v: 1, w: [], f: {}, p: {} }, { v: 1, w: null, f: {}, p: {} }]) {
    assert.equal(Core.validateDict(d), false, JSON.stringify(d));
  }
});

test('pointInRects', () => {
  const rects = [{ left: 10, top: 10, right: 50, bottom: 30 }, { left: 0, top: 40, right: 20, bottom: 60 }];
  assert.ok(Core.pointInRects(10, 10, rects));
  assert.ok(Core.pointInRects(5, 50, rects));
  assert.equal(Core.pointInRects(60, 20, rects), false); // empty space right of the line
  assert.equal(Core.pointInRects(30, 35, rects), false);
  assert.equal(Core.pointInRects(1, 1, []), false);
});

test('langAllowed', () => {
  for (const v of ['en', 'en-GB', 'EN', '', null, undefined]) assert.ok(Core.langAllowed(v), String(v));
  for (const v of ['de', 'ru', 'eng-x']) assert.equal(Core.langAllowed(v), false, v);
});

test('clampRect: four edges, flip below, visual viewport offset', () => {
  const vp = { left: 0, top: 0, width: 800, height: 600 };
  const size = { width: 200, height: 40 };
  const word = (left, top) => ({ left, top, right: left + 50, bottom: top + 20 });
  assert.deepEqual(Core.clampRect(word(100, 300), size, vp, true), { left: 100, top: 260 });
  assert.deepEqual(Core.clampRect(word(700, 300), size, vp, true), { left: 600, top: 260 }); // right
  assert.deepEqual(Core.clampRect(word(-30, 300), size, vp, true), { left: 0, top: 260 }); // left
  assert.deepEqual(Core.clampRect(word(100, 10), size, vp, true), { left: 100, top: 30 }); // top → below
  // Cover: right edges aligned, a box wider than the word grows left.
  assert.deepEqual(Core.clampRect(word(300, 300), size, vp, false), { left: 150, top: 300 });
  assert.deepEqual(Core.clampRect(word(300, 300), { width: 50, height: 20 }, vp, false), { left: 300, top: 300 });
  assert.deepEqual(Core.clampRect(word(300, 590), size, vp, false), { left: 150, top: 560 }); // bottom
  assert.deepEqual(Core.clampRect(word(750, 300), size, vp, false), { left: 600, top: 300 }); // right
  assert.deepEqual(Core.clampRect(word(10, 300), size, vp, false), { left: 0, top: 300 }); // left: shifted right
  const zoomed = { left: 150, top: 80, width: 400, height: 300 };
  assert.deepEqual(Core.clampRect(word(100, 100), size, zoomed, true), { left: 150, top: 120 });
  assert.deepEqual(Core.clampRect(word(600, 300), size, zoomed, true), { left: 350, top: 260 });
  // Box larger than the viewport is pinned to its top-left corner.
  assert.deepEqual(Core.clampRect(word(100, 300), { width: 900, height: 700 }, vp, true), { left: 0, top: 0 });
});

test('hostKey', () => {
  assert.equal(Core.hostKey({ protocol: 'https:', hostname: 'example.com' }), 'example.com');
  assert.equal(Core.hostKey({ protocol: 'file:', hostname: '' }), 'file:');
  assert.equal(Core.hostKey({ protocol: 'about:', hostname: '' }), 'about:');
});

test('toggleHost does not mutate', () => {
  const list = ['a.com'];
  assert.deepEqual(Core.toggleHost(list, 'b.com'), ['a.com', 'b.com']);
  assert.deepEqual(Core.toggleHost(list, 'a.com'), []);
  assert.deepEqual(list, ['a.com']);
});

test('parseHosts / parseMode tolerate corrupted stored values', () => {
  assert.deepEqual(Core.parseHosts(['a.com', 'b.com']), ['a.com', 'b.com']);
  for (const v of [undefined, null, 'a.com', { 0: 'a.com' }, 42]) assert.deepEqual(Core.parseHosts(v), [], String(v));
  assert.deepEqual(Core.parseHosts(['a.com', 1, null]), ['a.com']);
  assert.equal(Core.parseMode('blur'), 'blur');
  for (const v of [undefined, 'bogus', 'constructor', 1]) assert.equal(Core.parseMode(v), 'cover', String(v));
  assert.equal(Core.parseGuess(false), false);
  for (const v of [undefined, true, null, 'false', 0]) assert.equal(Core.parseGuess(v), true, String(v));
});

test('nextMode cycles and recovers from unknown values', () => {
  assert.equal(Core.nextMode('cover'), 'blur');
  assert.equal(Core.nextMode('blur'), 'tooltip');
  assert.equal(Core.nextMode('tooltip'), 'cover');
  assert.equal(Core.nextMode(undefined), 'cover');
});

test('menuLabels', () => {
  assert.deepEqual(Core.menuLabels({ host: 'a.com', disabled: false, mode: 'blur', guess: true, dictFailed: false }),
    { toggle: 'Выключить на a.com', mode: 'Режим: blur', guess: 'Догадки: вкл', warning: null });
  assert.deepEqual(Core.menuLabels({ host: 'a.com', disabled: true, mode: 'cover', guess: false, dictFailed: true }),
    { toggle: 'Включить на a.com', mode: 'Режим: cover', guess: 'Догадки: выкл', warning: '⚠ Словарь не загружен' });
});
