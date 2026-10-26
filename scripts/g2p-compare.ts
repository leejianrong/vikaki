// How close the dictionary G2P (ADR-0049) is to eSpeak NG on ordinary English, in what the mouth uses: the shape each sound makes.
//   pnpm exec tsx scripts/g2p-compare.ts [file.md ...]            (needs the real voice installed: `make install-voice`, which brings eSpeak's phonemizer)
// Text is the prose of the given files (default: README.md and a few docs). For each sentence both make phonemes; the two sequences are lined up (edit
// distance) on mouth shapes, and the share of eSpeak's sounds the dictionary matches is reported, for vowels and for all sounds, with the dictionary's coverage.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { tokenizeIpa } from "../packages/audio/src/index.ts";
import { shapeOf } from "../packages/engine/src/phoneme-visemes.ts";
import { findVoice } from "../packages/cli/src/voice.ts";
import { ipaFor, loadPronunciations } from "../packages/tts/src/index.ts";

const found = findVoice();
if (!found) throw new Error("the real voice is not installed; run `make install-voice`");
const req = createRequire(pathToFileURL(found.entry));
const mod = await import(pathToFileURL(req.resolve("phonemizer")).href);
const espeak: (t: string, l: string) => Promise<string[]> = mod.phonemize ?? mod.default.phonemize;

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["README.md", ...["personas", "embed", "tts", "observability", "architecture", "mcp", "release", "testing", "protocol", "PLAN"].map((n) => `docs/${n}.md`)];
const prose = files
  .flatMap((f) => readFileSync(f, "utf8").split("\n"))
  .filter((l) => /^[A-Z][^|`#<>]{25,}/.test(l.trim()) && !l.trim().startsWith("-"))
  .flatMap((l) => l.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").split(/(?<=[.!?])\s+/))
  .filter((s) => /^[A-Za-z][A-Za-z ,'’;:-]{15,170}[.!?]$/.test(s));

const shapeClass = (p: string) => {
  const w = shapeOf(p).weights;
  const top = Object.entries(w).sort((a, b) => b[1]! - a[1]!)[0];
  return top ? top[0] : "closed";
};
const classes = (ipa: string) => ipa.split(/\s+/).flatMap((word) => tokenizeIpa(word).map((t) => ({ c: shapeClass(t.p), vowel: /[aeiouæɑɒɔəɚɛɜɝɪʊʌɐ]/.test(t.p[0]!) })));

/** Sounds of `a` matched in `b`, by edit distance on mouth classes: how many of a's sounds survive as the same class. */
function matched(a: { c: string }[], b: { c: string }[]): boolean[] {
  const n = a.length;
  const m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1]!.c === b[j - 1]!.c ? 0 : 1));
  const hit = new Array<boolean>(n).fill(false);
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (a[i - 1]!.c === b[j - 1]!.c && d[i]![j] === d[i - 1]![j - 1]!) { hit[i - 1] = true; i--; j--; }
    else if (d[i]![j] === d[i - 1]![j - 1]! + 1) { i--; j--; }
    else if (d[i]![j] === d[i - 1]![j]! + 1) i--;
    else j--;
  }
  return hit;
}

const dict = loadPronunciations();
let sounds = 0, hits = 0, vowels = 0, vowelHits = 0, words = 0, known = 0;
const unknown = new Map<string, number>();
for (const s of prose) {
  const ref = classes((await espeak(s, "en-us")).join(", "));
  const ours = classes(ipaFor(s, dict));
  const hit = matched(ref, ours);
  ref.forEach((r, i) => { sounds++; if (hit[i]) hits++; if (r.vowel) { vowels++; if (hit[i]) vowelHits++; } });
  for (const w of s.toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g) ?? []) { words++; if (dict.lookup(w)) known++; else unknown.set(w, (unknown.get(w) ?? 0) + 1); }
}
const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`${prose.length} sentences, ${words} words, ${sounds} eSpeak sounds`);
console.log(`dictionary coverage: ${pct(known, words)} of the words (${[...unknown.keys()].slice(0, 12).join(", ")}${unknown.size > 12 ? ", ..." : ""})`);
console.log(`mouth shape matches eSpeak's: ${pct(hits, sounds)} of all sounds, ${pct(vowelHits, vowels)} of vowels`);
process.exit(0);
