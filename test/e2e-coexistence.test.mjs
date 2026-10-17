import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CoreEn = require('../src/core.js');
const CoreZh = require('../src/core-zh.js');

const EN_DICT = {
  v: 1,
  w: { learning: 'обучение' },
  f: {},
  p: {},
};

const ZH_DICT = {
  v: 1,
  lang: 'zh-ru',
  w: {
    中文: { p: 'Zhong1 wen2', t: ['китайский язык'], trad: '中文', pos: 'сущ.' },
  },
};

test('Coexistence: CoreEn translates English words and ignores Chinese', () => {
  const text = 'I love learning 中文';
  // Hover on "learning" (offset 8)
  const enMatch = CoreEn.lookup(EN_DICT, text, 8, {});
  assert.ok(enMatch);
  assert.equal(enMatch.translation, 'обучение');

  // Hover on "中文" (offset 17) -> CoreEn should reject/return null
  const enReject = CoreEn.lookup(EN_DICT, text, 17, {});
  assert.equal(enReject, null);
});

test('Coexistence: CoreZh translates Chinese words and ignores English', () => {
  const text = 'I love learning 中文';
  // Hover on "中文" (offset 17)
  const zhMatch = CoreZh.lookup(ZH_DICT, text, 17, {});
  assert.ok(zhMatch);
  assert.match(zhMatch.translation, /китайский язык/);

  // Hover on "learning" (offset 8) -> CoreZh should reject/return null
  const zhReject = CoreZh.lookup(ZH_DICT, text, 8, {});
  assert.equal(zhReject, null);
});

test('Coexistence: CoreEn and CoreZh langAllowed contracts do not collide', () => {
  // en page: both allow or en allows
  assert.equal(CoreEn.langAllowed('en'), true);
  assert.equal(CoreZh.langAllowed('en'), true);

  // zh page: zh allows, en rejects
  assert.equal(CoreEn.langAllowed('zh-CN'), false);
  assert.equal(CoreZh.langAllowed('zh-CN'), true);

  // neutral page (no lang): both allow
  assert.equal(CoreEn.langAllowed(null), true);
  assert.equal(CoreZh.langAllowed(null), true);
});
