// header + core.js + main.js → dist/hover-translator.user.js
// DICT_URL=http://localhost:8000/dist/dict.json node scripts/bundle.mjs  (local testing only; never commit that build)
import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_DICT_URL = 'https://raw.githubusercontent.com/borchik26/hover-word-translator/main/dist/dict.json';
const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const header = read('src/header.txt').replace('{{DICT_URL}}', process.env.DICT_URL || DEFAULT_DICT_URL);
// The Node export line is for `node --test` only; in the userscript it could touch a page global `module`.
const core = read('src/core.js').replace(/^if \(typeof module !== 'undefined'\).*\n/m, '');
const sources = [core, read('src/main.js')];
const out = `${header}\n(() => {\n'use strict';\n${sources.join('\n')}\n})();\n`;
writeFileSync(new URL('dist/hover-translator.user.js', root), out);
console.log(`dist/hover-translator.user.js ${(out.length / 1024).toFixed(1)} KB`);
