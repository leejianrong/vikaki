// Text to phonemes, with a pronunciation dictionary and nothing else (ADR-0049). Used to tell the page which sounds a line made (`--phonemes`):
// the mouth needs the sound of each word, not exact IPA, and this is Apache-2.0 code over a BSD-style dictionary, with no eSpeak in it.
// A word is looked up in the CMU Pronouncing Dictionary (126,000 words, stress marked); one it lacks is built from a known word plus an ending,
// from two known words, or by letter-to-sound rules, in that order. Output is IPA in the shape `alignPhonemes` takes: words separated by
// spaces, a stress mark before the stressed vowel, a pause mark after the word that ends a phrase.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

// ---- the dictionary ----

/** The dictionary, kept as one string and searched in place: a few megabytes, not a map of 126,000 strings. */
export class Pronunciations {
  /** `text` is lines of `word PHONES`, sorted by code point, as `scripts/make-cmudict.mjs` makes. */
  constructor(text) {
    this.text = text;
    const starts = [];
    for (let at = 0; at < text.length;) {
      starts.push(at);
      const nl = text.indexOf("\n", at);
      at = nl < 0 ? text.length : nl + 1;
    }
    this.starts = Uint32Array.from(starts);
  }

  get size() {
    return this.starts.length;
  }

  /** The phones of `word` (lower case) with their stress digits, such as `["HH","AH0","L","OW1"]`, or undefined if the dictionary lacks it. */
  lookup(word) {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = this.starts[mid];
      const sp = this.text.indexOf(" ", start);
      const key = this.text.slice(start, sp);
      if (key === word) {
        const nl = this.text.indexOf("\n", sp);
        return this.text.slice(sp + 1, nl < 0 ? undefined : nl).split(" ");
      }
      if (key < word) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }
}

let shared;

/** The dictionary that ships with the package, read once. Takes about 20 ms and 4 MB. */
export function loadPronunciations() {
  shared ??= new Pronunciations(gunzipSync(readFileSync(new URL("../data/cmudict.txt.gz", import.meta.url))).toString("latin1"));
  return shared;
}

// ---- phones to IPA ----

const CONSONANTS = { B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ" };

/** The IPA of the vowel `phone` (no digit) at `stress` 0, 1 or 2. */
function vowelIpa(phone, stress) {
  switch (phone) {
    case "AA": return "ɑː";
    case "AE": return "æ";
    case "AH": return stress === 0 ? "ə" : "ʌ";
    case "AO": return "ɔː";
    case "AW": return "aʊ";
    case "AY": return "aɪ";
    case "EH": return "ɛ";
    case "ER": return stress === 0 ? "ɚ" : "ɝ";
    case "EY": return "eɪ";
    case "IH": return "ɪ";
    case "IY": return stress === 0 ? "i" : "iː";
    case "OW": return "oʊ";
    case "OY": return "ɔɪ";
    case "UH": return "ʊ";
    case "UW": return stress === 0 ? "u" : "uː";
    default: return "";
  }
}

/** Phones with stress digits to IPA, a stress mark before the stressed vowel. */
export function phonesToIpa(phones) {
  let out = "";
  for (const p of phones) {
    const m = /^([A-Z]+)([012])?$/.exec(p);
    if (!m) continue;
    const base = m[1];
    if (m[2] === undefined) out += CONSONANTS[base] ?? "";
    else {
      const stress = Number(m[2]);
      out += (stress === 1 ? "ˈ" : stress === 2 ? "ˌ" : "") + vowelIpa(base, stress);
    }
  }
  return out;
}

// ---- words the dictionary lacks ----

const isVowelPhone = (p) => /\d$/.test(p);
const VOICELESS = new Set(["P", "T", "K", "F", "TH", "S", "SH", "CH", "HH"]);
const SIBILANT = new Set(["S", "Z", "SH", "ZH", "CH", "JH"]);
const last = (phones) => phones[phones.length - 1];

/** The phones an ending adds to a word, by how the word ends: "cats" /s/, "dogs" /z/, "boxes" /iz/; "walked" /t/, "played" /d/, "wanted" /id/. */
function ending(kind, base) {
  const end = last(base);
  if (kind === "ing") return ["IH0", "NG"];
  if (kind === "ly") return ["L", "IY0"];
  if (kind === "er") return ["ER0"];
  if (kind === "s") return SIBILANT.has(end) ? ["IH0", "Z"] : VOICELESS.has(end) ? ["S"] : ["Z"];
  return end === "T" || end === "D" ? ["IH0", "D"] : VOICELESS.has(end) ? ["T"] : ["D"];
}

/**
 * Letter-to-sound rules: the commonest English spellings, tried in order at each place in the word. Not right for every word, close enough to
 * show the mouth the right vowels. A final silent "e" and doubled consonants are handled in `letterToSound`.
 */
const RULES = [
  // clusters and silent letters
  [/^kn/y, ["N"]], [/^wr/y, ["R"]], [/^gn/y, ["N"]], [/^ps/y, ["S"]], [/^wh/y, ["W"]], [/^x/y, ["Z"]],
  [/tch/y, ["CH"]], [/ch/y, ["CH"]], [/sh/y, ["SH"]], [/th/y, ["TH"]], [/ph/y, ["F"]], [/ck/y, ["K"]], [/dge/y, ["JH"]],
  [/ng(?![aeiouy])/y, ["NG"]], [/nk/y, ["NG", "K"]], [/qu/y, ["K", "W"]], [/gh(?=t)/y, []], [/gh$/y, []], [/gh/y, ["G"]], [/mb$/y, ["M"]],
  [/g(?=[eiy])/y, ["JH"]], [/sc(?=[eiy])/y, ["S"]], [/c(?=[eiy])/y, ["S"]], [/c/y, ["K"]], [/x/y, ["K", "S"]], [/q/y, ["K"]], [/j/y, ["JH"]],
  [/y(?=[aeiou])/y, ["Y"]],
  // a vowel, a consonant and a final e: the vowel is long ("make", "bite", "hope")
  [/a(?=[^aeiouy]e$)/y, ["EY1"]], [/e(?=[^aeiouy]e$)/y, ["IY1"]], [/i(?=[^aeiouy]e$)/y, ["AY1"]], [/o(?=[^aeiouy]e$)/y, ["OW1"]], [/u(?=[^aeiouy]e$)/y, ["UW1"]],
  // vowel spellings of two or more letters
  [/eigh/y, ["EY1"]], [/igh/y, ["AY1"]], [/augh|ough/y, ["AO1"]], [/ea|ee/y, ["IY1"]], [/ai|ay/y, ["EY1"]], [/oa/y, ["OW1"]], [/oo/y, ["UW1"]],
  [/ou/y, ["AW1"]], [/ow$/y, ["OW1"]], [/ow/y, ["AW1"]], [/oi|oy/y, ["OY1"]], [/au|aw/y, ["AO1"]], [/ie/y, ["IY1"]], [/ei/y, ["EY1"]],
  [/ew|ue|ui|eu/y, ["UW1"]], [/ey$/y, ["IY0"]], [/ar/y, ["AA1", "R"]], [/or/y, ["AO1", "R"]], [/er|ir|ur|yr/y, ["ER1"]], [/y$/y, ["IY0"]],
];
/** The plain letters, when no rule applies. */
const LETTERS = { a: ["AE1"], b: ["B"], c: ["K"], d: ["D"], e: ["EH1"], f: ["F"], g: ["G"], h: ["HH"], i: ["IH1"], j: ["JH"], k: ["K"], l: ["L"], m: ["M"], n: ["N"], o: ["AA1"], p: ["P"], q: ["K"], r: ["R"], s: ["S"], t: ["T"], u: ["AH1"], v: ["V"], w: ["W"], x: ["K", "S"], y: ["IH1"], z: ["Z"] };

/** Phones for a lower-case word of letters that no dictionary knows, by its spelling. Never throws; a word of no letters gives none. */
export function letterToSound(word) {
  const out = [];
  let i = 0;
  while (i < word.length) {
    const c = word[i];
    const prev = word[i - 1];
    // a final e after a consonant is silent, once the word has another vowel ("table")
    if (c === "e" && i === word.length - 1 && i >= 2 && prev !== undefined && !"aeiouy".includes(prev)) {
      i++;
      continue;
    }
    let matched = false;
    for (const [re, phones] of RULES) {
      re.lastIndex = i;
      const m = re.exec(word);
      if (m && m.index === i) {
        out.push(...phones);
        i += Math.max(1, m[0].length);
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (prev === c && !"aeiou".includes(c)) {
      i++; // a doubled consonant is one sound
      continue;
    }
    // an "s" between vowels is voiced: "rose", "easy"
    if (c === "s" && prev !== undefined && "aeiouy".includes(prev) && "aeiouy".includes(word[i + 1] ?? "")) out.push("Z");
    else out.push(...(LETTERS[c] ?? []));
    i++;
  }
  // stress: the first vowel carries it and the rest are weak (the dictionary is right where it matters most)
  let stressed = false;
  return out.map((p) => {
    if (!isVowelPhone(p)) return p;
    const base = p.slice(0, -1);
    if (stressed) return `${base}0`;
    stressed = true;
    return `${base}1`;
  });
}

const dropEnds = {
  ing: { kind: "ing", bases: (w) => [w, w + "e", w.length > 1 && w.at(-1) === w.at(-2) ? w.slice(0, -1) : w] },
  ed: { kind: "ed", bases: (w) => [w, w + "e", w.length > 1 && w.at(-1) === w.at(-2) ? w.slice(0, -1) : w] },
  ies: { kind: "s", bases: (w) => [w + "y"] },
  es: { kind: "s", bases: (w) => [w, w + "e"] },
  s: { kind: "s", bases: (w) => [w] },
  ly: { kind: "ly", bases: (w) => [w, w + "le"] },
  er: { kind: "er", bases: (w) => [w, w + "e"] },
};

/** The phones of a word (lower case, letters and apostrophes): the dictionary's, or built from known parts, or from the spelling. */
export function pronounce(word, dict) {
  const known = dict.lookup(word);
  if (known) return known;
  const possessive = /^(.+)'s$/.exec(word);
  if (possessive) {
    const base = pronounce(possessive[1], dict);
    return [...base, ...ending("s", base)];
  }
  const bare = word.replace(/'/g, "");
  if (bare !== word) return pronounce(bare, dict);
  // a known word and an ending: "bluffed", "plays", "calmly"
  for (const [suffix, { kind, bases }] of Object.entries(dropEnds)) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 2) continue;
    for (const candidate of bases(word.slice(0, -suffix.length))) {
      const base = dict.lookup(candidate);
      if (base) return [...base, ...ending(kind, base)];
    }
  }
  // two known words: "cardroom", "wavelength"
  let best;
  let bestShort = 0;
  for (let i = 3; i <= word.length - 3; i++) {
    const a = dict.lookup(word.slice(0, i));
    const b = dict.lookup(word.slice(i));
    if (a && b && Math.min(i, word.length - i) > bestShort) {
      bestShort = Math.min(i, word.length - i);
      best = [...a, ...b.map((p) => (p.endsWith("1") ? `${p.slice(0, -1)}2` : p))];
    }
  }
  return best ?? letterToSound(word);
}

// ---- numbers ----

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
/** Digits read one at a time: "507" is "five zero seven". */
function digitsToWords(digits) {
  return [...digits].filter((d) => d >= "0" && d <= "9").map((d) => ONES[Number(d)]);
}

const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** A whole number as words: 105 is "one hundred five". Numbers past a trillion are read digit by digit. */
export function numberToWords(n) {
  if (!Number.isFinite(n)) return [];
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return digitsToWords(String(BigInt(Math.trunc(Math.abs(n)))));
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], "hundred", ...(n % 100 ? numberToWords(n % 100) : [])];
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= size) return [...numberToWords(Math.floor(n / size)), name, ...(n % size ? numberToWords(n % size) : [])];
  }
  return [];
}

// ---- text ----

/**
 * The phonemes of `text` as IPA, words separated by spaces and a pause mark (`,` `.` `?` and the like) left on the word that ends a phrase.
 * Numbers are said as words; anything that is not a letter, digit or pause mark is skipped. Never throws.
 */
export function ipaFor(text, dict = loadPronunciations()) {
  const words = [];
  const tokens = text.replace(/[‘’]/g, "'").match(/[A-Za-z]+(?:'[A-Za-z]+)*|\d[\d,]*(?:\.\d+)?|[,.;:!?…—–]/g) ?? [];
  for (const token of tokens) {
    if (/^[,.;:!?…—–]$/.test(token)) {
      if (words.length > 0 && !/[,.;:!?…—–]$/.test(words[words.length - 1])) words[words.length - 1] += token;
    } else if (/^\d/.test(token)) {
      const [whole, fraction] = token.replace(/,/g, "").split(".");
      const said = whole .length > 12 ? digitsToWords(whole) : numberToWords(Number(whole));
      for (const w of said) words.push(phonesToIpa(pronounce(w, dict)));
      if (fraction !== undefined) {
        words.push(phonesToIpa(pronounce("point", dict)));
        for (const d of fraction) words.push(phonesToIpa(pronounce(ONES[Number(d)], dict)));
      }
    } else words.push(phonesToIpa(pronounce(token.toLowerCase(), dict)));
  }
  return words.filter((w) => w.replace(/[,.;:!?…—–]/g, "") !== "").join(" ");
}
