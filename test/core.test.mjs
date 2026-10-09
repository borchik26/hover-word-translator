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
  },
  f: { runs: 'run', went: 'go', leaves: 'leave', better: 'good', orphan: 'missing' },
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

test('plain word, form → lemma, nothing on a space', () => {
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
  assert.equal(Core.lookup(dict, 'cat  dog', 4), null); // second space, no token ends here
});

test('apostrophes: straight, curly, possessive', () => {
  assert.equal(src("I don't know", 'don'), "don't → не");
  assert.equal(src('I don’t know', 'don'), 'don’t → не');
  assert.equal(src("John's cat", 'John', 1), 'John → Джон');
});

test('hyphens: part under the caret; em dash splits words', () => {
  assert.equal(src('a well-known fact', 'known'), 'known → известный');
  assert.equal(src('a well-known fact', 'well'), 'well → хорошо');
  assert.equal(src('state-of-the-art', 'art'), 'art → искусство');
  assert.equal(src('cat—world', 'world'), 'world → мир');
});

test('numbers, emails and URLs are not prose', () => {
  for (const [text, needle] of [['COVID-19 world', 'COVID'], ['an x86 cpu', 'x86'], ['user@mail.com', 'mail'],
    ['see example.com/run now', 'run'], ['run2 fast', 'run']]) {
    assert.equal(at(text, needle), null, text);
  }
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
  const word = (left, top) => ({ left, top, bottom: top + 20 });
  assert.deepEqual(Core.clampRect(word(100, 300), size, vp, true), { left: 100, top: 260, below: false });
  assert.deepEqual(Core.clampRect(word(700, 300), size, vp, true), { left: 600, top: 260, below: false }); // right
  assert.deepEqual(Core.clampRect(word(-30, 300), size, vp, true), { left: 0, top: 260, below: false }); // left
  assert.deepEqual(Core.clampRect(word(100, 10), size, vp, true), { left: 100, top: 30, below: true }); // top → below
  assert.deepEqual(Core.clampRect(word(100, 590), size, vp, false), { left: 100, top: 560, below: false }); // bottom
  assert.deepEqual(Core.clampRect(word(700, 300), size, vp, false), { left: 600, top: 300, below: false }); // cover
  const zoomed = { left: 150, top: 80, width: 400, height: 300 };
  assert.deepEqual(Core.clampRect(word(100, 100), size, zoomed, true), { left: 150, top: 120, below: true });
  assert.deepEqual(Core.clampRect(word(600, 300), size, zoomed, true), { left: 350, top: 260, below: false });
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

test('nextMode cycles and recovers from unknown values', () => {
  assert.equal(Core.nextMode('cover'), 'blur');
  assert.equal(Core.nextMode('blur'), 'tooltip');
  assert.equal(Core.nextMode('tooltip'), 'cover');
  assert.equal(Core.nextMode(undefined), 'cover');
});

test('menuLabels', () => {
  assert.deepEqual(Core.menuLabels({ host: 'a.com', disabled: false, mode: 'blur', dictFailed: false }),
    { toggle: 'Выключить на a.com', mode: 'Режим: blur', warning: null });
  assert.deepEqual(Core.menuLabels({ host: 'a.com', disabled: true, mode: 'cover', dictFailed: true }),
    { toggle: 'Включить на a.com', mode: 'Режим: cover', warning: '⚠ Словарь не загружен' });
});
