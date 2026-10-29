import { describe, expect, it } from "vitest";
import { kokoroPhonemes, kokoroPhonesFor, loadPronunciations } from "../src/index.ts";

/** Every symbol Kokoro-82M-v1.0's tokenizer knows (its tokenizer.json vocabulary); a symbol outside it is dropped or breaks the sentence. */
const VOCAB = new Set([..." !\"$(),.:;?AIOQSTWYabcdefhijklmnopqrstuvwxyzæçðøŋœɐɑɒɔɕɖəɚɛɜɟɡɣɤɥɨɪɯɰɲɳɴɸɹɻɽɾʁʂʃʈʊʋʌʎʒʔʝʣʤʥʦʧʨʰʲˈˌː̃βθχᵊᵝᵻ—“”…→↓↗↘ꭧ"]);

describe("kokoroPhonemes: Kokoro's own symbols from the CMU dictionary, no eSpeak (VIK-149)", () => {
  it("says known words with Kokoro's one-letter diphthongs and a stress mark before the stressed vowel", () => {
    expect(kokoroPhonemes("hello")).toBe("həlˈO");
    expect(kokoroPhonemes("nice try, Ben.")).toBe("nˈIs tɹˈI, bˈɛn.");
    expect(kokoroPhonemes("fold")).toBe("fˈOld");
    expect(kokoroPhonemes("how about boys")).toBe("hˈW əbˈWt bˈYz");
    expect(kokoroPhonemes("they say eight")).toBe("ðˈA sˈA ˈAt");
  });

  it("flaps a t or d between a stressed vowel and an unstressed one, and only there", () => {
    expect(kokoroPhonemes("water")).toBe("wˈɔɾɚ");
    expect(kokoroPhonemes("city")).toBe("sˈɪɾi");
    expect(kokoroPhonemes("ready")).toBe("ɹˈɛɾi");
    expect(kokoroPhonemes("attack")).toContain("tˈæk");
    expect(kokoroPhonemes("tea")).toBe("tˈi");
  });

  it("keeps pause marks on the word that ends a phrase, and drops quotes and brackets", () => {
    expect(kokoroPhonemes('He said, "fold"; (maybe) — or not?')).toBe(kokoroPhonemes("He said, fold; maybe — or not?"));
    expect(kokoroPhonemes("Wait... what!")).toMatch(/…|\.\.\./);
    expect(kokoroPhonemes("  ")).toBe("");
    expect(kokoroPhonemes("???")).toBe("");
  });

  it("reads numbers as words", () => {
    expect(kokoroPhonemes("1,250")).toBe(kokoroPhonemes("one thousand two hundred fifty"));
  });

  it("only ever uses symbols Kokoro's tokenizer has: every dictionary word, rare words, odd input", () => {
    const dict = loadPronunciations();
    const bad = new Set<string>();
    const check = (text: string) => { for (const c of kokoroPhonemes(text, dict)) if (!VOCAB.has(c)) bad.add(c); };
    const words = ["a", "the", "unbelievable", "zzyzx", "qwxzt", "blorptastic", "bluffed", "cardroom", "o'clock", "y'all", "ain't"];
    words.forEach(check);
    // every phone the dictionary uses, with every stress, alone and between vowels (where a flap may apply)
    const vowels = ["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"];
    const consonants = ["B", "CH", "D", "DH", "F", "G", "HH", "JH", "K", "L", "M", "N", "NG", "P", "R", "S", "SH", "T", "TH", "V", "W", "Y", "Z", "ZH"];
    for (const v of vowels) for (const st of [0, 1, 2]) for (const c of consonants) for (const w of [[`${v}${st}`, c], ["AH1", c, `${v}${st}`], [c, `${v}${st}`, c, "ER0"]]) for (const ch of kokoroPhonesFor(w)) if (!VOCAB.has(ch)) bad.add(ch);
    const text = ["Nice try, Ben. I fold.", "Pot is 1,250 and 3.5 more; call?", "He's all-in — maybe… no!", "ÄÖ ñ 日本 😀 $5 #1 @x"];
    text.forEach(check);
    expect([...bad]).toEqual([]);
  });

  it("never throws, whatever it is given", () => {
    for (const t of ["", " ", "\n", "💥", "'", "''", "a'b'c", "1e999", "9".repeat(40), "-", "...", "\u0000"]) expect(() => kokoroPhonemes(t)).not.toThrow();
  });
});
