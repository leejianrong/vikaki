// Text to the symbols Kokoro-82M's tokenizer takes, without eSpeak NG (ADR-0051, VIK-149). `kokoro-js` gets them from the `phonemizer` package, which
// bundles eSpeak NG (GPL-3.0). This uses the CMU Pronouncing Dictionary and our own fallbacks (g2p.mjs, ADR-0049) and writes American English in
// the symbols the model was trained on: one letter for each diphthong (A for "ay" as in "say", I, O, W, Y), ʤ and ʧ, and ɾ for the flapped t of "water".
// Plain JavaScript: it runs in the TTS worker thread with the engine (ADR-0013).
import { loadPronunciations, numberToWords, pronounce } from "./g2p.mjs";

const CONSONANTS = { B: "b", CH: "ʧ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "ʤ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ" };

/** A vowel's symbols at stress 0, 1 or 2. */
function vowel(phone, stress) {
  switch (phone) {
    case "AA": return "ɑ";
    case "AE": return "æ";
    case "AH": return stress === 0 ? "ə" : "ʌ";
    case "AO": return "ɔ";
    case "AW": return "W";
    case "AY": return "I";
    case "EH": return "ɛ";
    case "ER": return stress === 0 ? "ɚ" : "ɜɹ";
    case "EY": return "A";
    case "IH": return "ɪ";
    case "IY": return "i";
    case "OW": return "O";
    case "OY": return "Y";
    case "UH": return "ʊ";
    case "UW": return "u";
    default: return "";
  }
}

const parse = (p) => /^([A-Z]+)([012])?$/.exec(p);

/** Kokoro's symbols for one word's phones: a stress mark before the vowel it falls on, and /t/ or /d/ flapped between a stressed vowel and an unstressed one. */
export function kokoroPhonesFor(phones) {
  const parsed = phones.map(parse);
  let out = "";
  for (let i = 0; i < parsed.length; i++) {
    const m = parsed[i];
    if (!m) continue;
    const base = m[1];
    if (m[2] === undefined) {
      const before = parsed[i - 1];
      const after = parsed[i + 1];
      const flap = (base === "T" || base === "D") && before?.[2] !== undefined && Number(before[2]) > 0 && after?.[2] === "0";
      out += flap ? "ɾ" : (CONSONANTS[base] ?? "");
    } else {
      const stress = Number(m[2]);
      out += (stress === 1 ? "ˈ" : stress === 2 ? "ˌ" : "") + vowel(base, stress);
    }
  }
  return out;
}

const PAUSES = /^[;:,.!?…—–]+$/;

/** The input Kokoro-82M's tokenizer takes for `text`: its own symbols, words apart, `; : , . ! ? — …` kept where they are said. Never throws. */
export function kokoroPhonemes(text, dict = loadPronunciations()) {
  const words = [];
  const tokens = String(text).replace(/[‘’]/g, "'").replace(/\.{3}/g, "…").match(/[A-Za-z]+(?:'[A-Za-z]+)*|\d[\d,]*(?:\.\d+)?|[;:,.!?…—–]/g) ?? [];
  const say = (word) => words.push(kokoroPhonesFor(pronounce(word, dict)));
  for (const token of tokens) {
    if (PAUSES.test(token)) {
      if (words.length > 0 && !/[;:,.!?…—]$/.test(words[words.length - 1])) words[words.length - 1] += token === "–" ? "—" : token;
    } else if (/^\d/.test(token)) {
      const [whole, fraction] = token.replace(/,/g, "").split(".");
      const said = whole.length > 12 ? [...whole].map((d) => numberToWords(Number(d))[0]) : numberToWords(Number(whole));
      said.forEach(say);
      if (fraction !== undefined) {
        say("point");
        for (const d of fraction) say(numberToWords(Number(d))[0]);
      }
    } else say(token.toLowerCase());
  }
  return words.filter((w) => w.replace(/[;:,.!?…—]/g, "") !== "").join(" ");
}
