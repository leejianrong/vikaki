// Compare per-test durations from two vitest JSON reports and print a Markdown summary. Never fails the build:
// timings from shared runners are noisy, so this only points at tests that got much slower.
//   node scripts/compare-timings.mjs previous.json current.json
import { existsSync, readFileSync } from "node:fs";

const [prevPath, curPath] = process.argv.slice(2);
const SLOWER_BY = 2; // times
const AT_LEAST_MS = 1500; // and by at least this much, so a 40 ms test going to 90 ms is not news

function durations(path) {
  const out = new Map();
  for (const file of JSON.parse(readFileSync(path, "utf8")).testResults ?? []) {
    for (const t of file.assertionResults ?? []) out.set(`${file.name.split("/").pop()} > ${t.fullName ?? t.title}`, t.duration ?? 0);
  }
  return out;
}

if (!curPath || !existsSync(curPath)) {
  console.log("### Timings\n\nNo timings were recorded this run.");
  process.exit(0);
}
const cur = durations(curPath);
const total = [...cur.values()].reduce((a, b) => a + b, 0);
console.log(`### Timings\n\n${cur.size} tests, ${(total / 1000).toFixed(1)} s of test time in total.\n`);
if (!prevPath || !existsSync(prevPath)) {
  console.log("No earlier nightly to compare with, so this run becomes the baseline.");
  process.exit(0);
}
const prev = durations(prevPath);
const slower = [...cur]
  .filter(([name, ms]) => prev.has(name) && ms > prev.get(name) * SLOWER_BY && ms - prev.get(name) >= AT_LEAST_MS)
  .sort((a, b) => b[1] - a[1]);
if (slower.length === 0) console.log(`No test got more than ${SLOWER_BY}x slower (and ${AT_LEAST_MS} ms) than last night.`);
else {
  console.log(`Tests more than ${SLOWER_BY}x slower than last night:\n\n| Test | Before | Now |\n| --- | --- | --- |`);
  for (const [name, ms] of slower) console.log(`| ${name} | ${(prev.get(name) / 1000).toFixed(1)} s | ${(ms / 1000).toFixed(1)} s |`);
}
const gone = [...prev.keys()].filter((n) => !cur.has(n)).length;
if (gone) console.log(`\n${gone} test(s) from last night did not run this time.`);
