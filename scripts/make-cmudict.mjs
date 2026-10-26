#!/usr/bin/env node
// Makes packages/tts/data/cmudict.txt.gz, the pronunciation dictionary the grapheme-to-phoneme code reads (VIK-G2P, ADR-0049).
// Source: the CMU Pronouncing Dictionary, at a pinned commit of github.com/cmusphinx/cmudict (a BSD-style licence, kept beside it as CMUDICT-LICENSE).
// Reduced to what is used: one pronunciation a word (the first), comments and "word(2)" alternates dropped, sorted by code point so it can be searched in place.
//   node scripts/make-cmudict.mjs
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const COMMIT = "74790861f652b15e4ac49015a90074ad62a27690";
const base = `https://raw.githubusercontent.com/cmusphinx/cmudict/${COMMIT}`;
const out = fileURLToPath(new URL("../packages/tts/data/", import.meta.url));

const get = async (file) => {
  const res = await fetch(`${base}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
};

const raw = await get("cmudict.dict");
const entries = new Map();
for (const line of raw.split("\n")) {
  const body = line.split("#")[0].trim();
  const sp = body.indexOf(" ");
  if (sp < 0) continue;
  const word = body.slice(0, sp).toLowerCase();
  if (/\(\d+\)$/.test(word) || entries.has(word)) continue;
  entries.set(word, body.slice(sp + 1).trim().toUpperCase());
}
const text = [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([w, p]) => `${w} ${p}`).join("\n") + "\n";
writeFileSync(`${out}cmudict.txt.gz`, gzipSync(text, { level: 9 }));
writeFileSync(`${out}CMUDICT-LICENSE`, `The CMU Pronouncing Dictionary (cmudict.dict at ${COMMIT} of github.com/cmusphinx/cmudict), reduced by scripts/make-cmudict.mjs. Its licence:\n\n${await get("LICENSE")}`);
console.log(`${entries.size} words, ${(text.length / 1e6).toFixed(1)} MB, ${(gzipSync(text, { level: 9 }).length / 1e6).toFixed(2)} MB gzipped`);
