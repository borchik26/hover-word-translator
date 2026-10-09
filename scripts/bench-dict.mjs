// Measures JSON.parse(dist/dict.json); exits 1 when the median exceeds the budget.
import { readFileSync } from 'node:fs';

const BUDGET_MS = 150;
const RUNS = 5;
const text = readFileSync(new URL('../dist/dict.json', import.meta.url), 'utf8');

const times = [];
for (let i = 0; i < RUNS; i++) {
  const t0 = performance.now();
  JSON.parse(text);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(RUNS / 2)];
const mb = (Buffer.byteLength(text) / 1e6).toFixed(2);
console.log(`dict.json ${mb} MB, JSON.parse median ${median.toFixed(1)} ms (budget ${BUDGET_MS} ms)`);
if (median > BUDGET_MS) process.exit(1);
