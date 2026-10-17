import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CoreZh = require('../src/core-zh.js');

const DICT = {
  v: 1,
  lang: 'zh-ru',
  w: {
    中国: { p: 'Zhong1 guo2', t: ['Китай', 'китайский'], trad: '中國', pos: 'сущ.' },
    好: { p: 'hao3', t: ['хороший', 'добрый'], trad: '好', pos: 'прил.' },
    研究: { p: 'yan2 jiu1', t: ['исследование'], trad: '研究', pos: 'сущ.' },
    研究生: { p: 'yan2 jiu1 sheng1', t: ['аспирант'], trad: '研究生', pos: 'сущ.' },
    生命: { p: 'sheng1 ming4', t: ['жизнь'], trad: '生命', pos: 'сущ.' },
    科学: { p: 'ke1 xue2', t: ['наука'], trad: '科學', pos: 'сущ.' },
    你好: { p: 'ni3 hao3', t: ['привет'], trad: '你好', pos: 'межд.' },
    你: { p: 'ni3', t: ['ты'], trad: '你', pos: 'мест.' },
  },
};

// --- pinyin ---

test('pinyinDiacritic: basic tone placement (a/e priority, ou, last vowel)', () => {
  assert.equal(CoreZh.pinyinDiacritic('hao3'), 'hǎo');
  assert.equal(CoreZh.pinyinDiacritic('Zhong1'), 'Zhōng');
  assert.equal(CoreZh.pinyinDiacritic('guo2'), 'guó');
  assert.equal(CoreZh.pinyinDiacritic('ke1'), 'kē');
  assert.equal(CoreZh.pinyinDiacritic('yan2'), 'yán');
  assert.equal(CoreZh.pinyinDiacritic('niu3'), 'niǔ'); // no a/e, no ou → last vowel
  assert.equal(CoreZh.pinyinDiacritic('xue2'), 'xué');
});

test('pinyinDiacritic: ü (v) and erhua edge cases', () => {
  assert.equal(CoreZh.pinyinDiacritic('nv3'), 'nǚ');
  assert.equal(CoreZh.pinyinDiacritic('lv4'), 'lǜ');
  assert.equal(CoreZh.pinyinDiacritic('er2'), 'ér');
  assert.equal(CoreZh.pinyinDiacritic('zhui1'), 'zhuī');
});

test('pinyinDiacritic: vowel-less syllables like n2 and m2 return bare base without crashing', () => {
  assert.equal(CoreZh.pinyinDiacritic('n2'), 'n');
  assert.equal(CoreZh.pinyinDiacritic('m2'), 'm');
  assert.equal(CoreZh.pinyinDiacritic('ng4'), 'ng');
});

test('pinyinDiacritic: neutral tone (0/5/no digit) leaves vowels bare', () => {
  assert.equal(CoreZh.pinyinDiacritic('de5'), 'de');
  assert.equal(CoreZh.pinyinDiacritic('ma'), 'ma');
  assert.equal(CoreZh.pinyinDiacritic('shi2'), 'shí');
});

test('pinyinToDiacritic: multi-syllable string joins with spaces', () => {
  assert.equal(CoreZh.pinyinToDiacritic('Zhong1 guo2'), 'Zhōng guó');
  assert.equal(CoreZh.pinyinToDiacritic('ni3hao3'), 'nǐ hǎo');
  assert.equal(CoreZh.pinyinToDiacritic(''), '');
});

// --- cjk spans / index ---

test('cjkSpans returns raw-index spans over mixed text', () => {
  const spans = CoreZh.cjkSpans('abc你好def世界');
  assert.deepEqual(spans, [
    { start: 3, end: 5 },
    { start: 8, end: 10 },
  ]);
});

test('cjkIndexAt resolves caret inside, at boundaries, and off-CJK', () => {
  assert.equal(CoreZh.cjkIndexAt('你好', 1), 1);
  assert.equal(CoreZh.cjkIndexAt('你好', 0), 0);
  assert.equal(CoreZh.cjkIndexAt('你好', 2), 1);
  assert.equal(CoreZh.cjkIndexAt('abc你好', 3), 3);
  assert.equal(CoreZh.cjkIndexAt('abc你好', 5), 4); // end of CJK run snaps to last char
  assert.equal(CoreZh.cjkIndexAt('abc', 1), null);
  assert.equal(CoreZh.cjkIndexAt('', 0), null);
});

// --- bidirectional matching / lookup ---

test('bidirectionalMatch prefers longest word containing the caret', () => {
  const m = CoreZh.bidirectionalMatch('研究生', 1, DICT);
  assert.equal(m.candidate, '研究生');
  assert.equal(m.start, 0);
  assert.equal(m.end, 3);
});

test('lookup: 研究生命科学 → 研究生 when caret is on first char', () => {
  const res = CoreZh.lookup(DICT, '研究生命科学', 1, {});
  assert.equal(res.start, 0);
  assert.equal(res.end, 3);
  assert.match(res.translation, /аспирант/);
});

test('lookup: same string → 生命 (start 2, end 4) when caret is on 命', () => {
  const res = CoreZh.lookup(DICT, '研究生命科学', 3, {});
  assert.equal(res.start, 2);
  assert.equal(res.end, 4);
  assert.match(res.translation, /жизнь/);
});

test('lookup: same string → 科学 (start 4, end 6) when caret is on 科', () => {
  const res = CoreZh.lookup(DICT, '研究生命科学', 4, {});
  assert.equal(res.start, 4);
  assert.equal(res.end, 6);
  assert.match(res.translation, /наука/);
});

test('lookup: caret at word end resolves to that word', () => {
  const res = CoreZh.lookup(DICT, '你好', 2, {});
  assert.equal(res.word, '你好');
  assert.match(res.translation, /привет/);
});

test('lookup: single character fallback when no multi-char word matches', () => {
  const res = CoreZh.lookup(DICT, '你', 0, {});
  assert.equal(res.word, '你');
  assert.match(res.translation, /ты/);
});

test('lookup: unknown character returns null', () => {
  assert.equal(CoreZh.lookup(DICT, '喵', 0, {}), null);
});

test('lookup: caret off-CJK (latin text) returns null', () => {
  assert.equal(CoreZh.lookup(DICT, 'hello world', 1, {}), null);
});

test('lookup: caret on non-CJK punctuation returns null', () => {
  assert.equal(CoreZh.lookup(DICT, '你。', 1, {}), null);
});

// --- article formatting ---

test('articleText formats pinyin + senses + pos', () => {
  const text = CoreZh.articleText(DICT.w.中国, '中国');
  assert.match(text, /Zhōng guó/);
  assert.match(text, /Китай/);
  assert.match(text, /сущ\./);
  assert.match(text, /\[中國\]/); // traditional differs from simplified
});

test('articleText suppresses traditional bracket when trad equals simp', () => {
  const text = CoreZh.articleText(DICT.w.好, '好');
  assert.doesNotMatch(text, /\[好\]/); // trad === word, bracket must not appear
  assert.match(text, /hǎo/);
  assert.match(text, /хороший/);
});

test('articleText respects settings toggles (hide pinyin, pos, trad)', () => {
  const withoutPinyin = CoreZh.articleText(DICT.w.中国, '中国', {
    showPinyin: false,
    showTraditional: true,
    showPos: true,
    showMultipleSenses: true,
  });
  assert.doesNotMatch(withoutPinyin, /Zhōng/);
  assert.match(withoutPinyin, /Китай/);

  const withoutPos = CoreZh.articleText(DICT.w.中国, '中国', {
    showPinyin: true,
    showTraditional: true,
    showPos: false,
    showMultipleSenses: true,
  });
  assert.doesNotMatch(withoutPos, /сущ/);

  const singleSense = CoreZh.articleText(DICT.w.中国, '中国', {
    showPinyin: true,
    showTraditional: true,
    showPos: true,
    showMultipleSenses: false,
  });
  assert.doesNotMatch(singleSense, /китайский/);
});

// --- dictionary validation ---

test('validateDict accepts well-formed dict', () => {
  assert.equal(CoreZh.validateDict(DICT), true);
});

test('validateDict rejects malformed dicts', () => {
  assert.equal(CoreZh.validateDict({}), false);
  assert.equal(CoreZh.validateDict({ v: 1, lang: 'zh-ru' }), false);
  assert.equal(CoreZh.validateDict({ v: 2, lang: 'zh-ru', w: {} }), false);
  assert.equal(CoreZh.validateDict({ v: 1, lang: 'en-ru', w: {} }), false);
});

// --- language filter ---

test('langAllowed: zh and en allowed, others denied', () => {
  assert.equal(CoreZh.langAllowed(null), true);
  assert.equal(CoreZh.langAllowed(''), true);
  assert.equal(CoreZh.langAllowed('zh'), true);
  assert.equal(CoreZh.langAllowed('zh-Hans'), true);
  assert.equal(CoreZh.langAllowed('en'), true);
  assert.equal(CoreZh.langAllowed('en-US'), true);
  assert.equal(CoreZh.langAllowed('de'), false);
  assert.equal(CoreZh.langAllowed('ja'), false);
});

// --- settings parsing ---

test('parseSettings tolerates missing/corrupted values', () => {
  const d = CoreZh.parseSettings(null);
  assert.equal(d.dictSource, 'bkrs');
  assert.equal(d.showPinyin, true);

  const c = CoreZh.parseSettings({ dictSource: 'bad', showPinyin: false });
  assert.equal(c.dictSource, 'bkrs');
  assert.equal(c.showPinyin, false);

  const cedict = CoreZh.parseSettings({ dictSource: 'cedict' });
  assert.equal(cedict.dictSource, 'cedict');
});

test('menuLabels returns expected structure without guess option', () => {
  const labels = CoreZh.menuLabels({ host: 'example.com', disabled: false, mode: 'cover', dictFailed: false });
  assert.equal(labels.toggle, 'Выключить на example.com');
  assert.equal(labels.mode, 'Режим: cover');
  assert.equal(labels.guess, null);
  assert.equal(labels.warning, null);

  const failedLabels = CoreZh.menuLabels({ host: 'example.com', disabled: true, mode: 'blur', dictFailed: true });
  assert.equal(failedLabels.toggle, 'Включить на example.com');
  assert.match(failedLabels.warning, /Словарь не загружен/);
});

// --- helpers ---

test('pointInRects', () => {
  const rects = [{ left: 0, right: 10, top: 0, bottom: 10 }];
  assert.equal(CoreZh.pointInRects(5, 5, rects), true);
  assert.equal(CoreZh.pointInRects(11, 5, rects), false);
});

test('hostKey, toggleHost (non-mutating), parseHosts, parseMode/nextMode', () => {
  assert.equal(CoreZh.hostKey({ protocol: 'https:', hostname: 'a.com' }), 'a.com');
  assert.equal(CoreZh.hostKey({ protocol: 'file:', hostname: '' }), 'file:');
  const list = ['a'];
  assert.deepEqual(CoreZh.toggleHost(list, 'a'), []);
  assert.deepEqual(list, ['a']);
  assert.deepEqual(CoreZh.parseHosts(['a', 1, 'b']), ['a', 'b']);
  assert.equal(CoreZh.parseMode('bad'), 'cover');
  assert.equal(CoreZh.nextMode('cover'), 'blur');
  assert.equal(CoreZh.nextMode('tooltip'), 'cover');
});
