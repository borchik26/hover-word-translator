// header + core + main → dist/*.user.js
// DICT_URL=http://localhost:8000/dist/dict.json node scripts/bundle.mjs  (local testing only; never commit that build)
import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_DICT_URL = 'https://raw.githubusercontent.com/borchik26/hover-word-translator/main/dist/dict.json';
const DEFAULT_DICT_ZH_BKRS_URL = 'https://raw.githubusercontent.com/borchik26/hover-word-translator/main/dist/dict-zh-bkrs.json';
const DEFAULT_DICT_ZH_CEDICT_URL = 'https://raw.githubusercontent.com/borchik26/hover-word-translator/main/dist/dict-zh-cedict.json';
const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const stripNodeExport = (src) => src.replace(/^if \(typeof module !== 'undefined'\).*\n/m, '');

function bundle({ headerFile, outFile, coreFile, dictPlaceholders }) {
  let header = read(headerFile);
  for (const [placeholder, envKey, defaultUrl] of dictPlaceholders) {
    header = header.replace(placeholder, process.env[envKey] || defaultUrl);
  }
  const core = stripNodeExport(read(coreFile));
  const main = read('src/main.js');
  const out = `${header}\n(() => {\n'use strict';\n${[core, main].join('\n')}\n})();\n`;
  writeFileSync(new URL(outFile, root), out);
  console.log(`${outFile} ${(out.length / 1024).toFixed(1)} KB`);
}

// The Node export line is for `node --test` only; in the userscript it could touch a page global `module`.
bundle({
  headerFile: 'src/header.txt',
  outFile: 'dist/hover-translator.user.js',
  coreFile: 'src/core.js',
  dictPlaceholders: [['{{DICT_URL}}', 'DICT_URL', DEFAULT_DICT_URL]],
});

bundle({
  headerFile: 'src/header-zh.txt',
  outFile: 'dist/hover-translator-zh.user.js',
  coreFile: 'src/core-zh.js',
  dictPlaceholders: [
    ['{{DICT_ZH_BKRS_URL}}', 'DICT_ZH_BKRS_URL', DEFAULT_DICT_ZH_BKRS_URL],
    ['{{DICT_ZH_CEDICT_URL}}', 'DICT_ZH_CEDICT_URL', DEFAULT_DICT_ZH_CEDICT_URL],
  ],
});
