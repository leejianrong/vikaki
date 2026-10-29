import { describe, expect, it } from "vitest";
import { ipaFor, letterToSound, loadPronunciations, numberToWords, phonesToIpa, pronounce, Pronunciations } from "../src/g2p.mjs";

/** A small sorted dictionary, so the rules for endings and compounds are tested on words whose phones are known. */
const small = new Pronunciations(
  ["bluff B L AH1 F", "box B AA1 K S", "card K AA1 R D", "cat K AE1 T", "dog D AO1 G", "length L EH1 NG K TH", "play P L EY1", "room R UW1 M", "walk W AO1 K", "want W AA1 N T", "wave W EY1 V"].join("\n") + "\n",
);

describe("Pronunciations", () => {
  it("finds a word, the first and the last of the list, and says undefined for a word it lacks", () => {
    expect(small.lookup("cat")).toEqual(["K", "AE1", "T"]);
    expect(small.lookup("bluff")).toEqual(["B", "L", "AH1", "F"]);
    expect(small.lookup("želený")).toBeUndefined();
    expect(small.lookup("wave")).toEqual(["W", "EY1", "V"]);
    expect(small.lookup("zzz")).toBeUndefined();
    expect(small.lookup("")).toBeUndefined();
    expect(small.size).toBe(11);
  });

  it("the dictionary that ships has the words a game says, with stress", () => {
    const d = loadPronunciations();
    expect(d.size).toBeGreaterThan(120_000);
    expect(d.lookup("poker")).toEqual(["P", "OW1", "K", "ER0"]);
    expect(d.lookup("don't")).toEqual(["D", "OW1", "N", "T"]);
    expect(d.lookup("wavelength")).toEqual(["W", "EY1", "V", "L", "EH2", "NG", "TH"]);
    expect(d.lookup("the")).toBeDefined();
  });
});

describe("phonesToIpa", () => {
  it("turns phones into IPA with the stress mark before the stressed vowel, and a weak AH into a schwa", () => {
    expect(phonesToIpa(["HH", "AH0", "L", "OW1"])).toBe("həlˈoʊ");
    expect(phonesToIpa(["W", "EH2", "NG", "TH"])).toBe("wˌɛŋθ");
    expect(phonesToIpa(["P", "AH1", "T"])).toBe("pˈʌt");
    expect(phonesToIpa(["B", "AY1", "ZH", "CH"])).toBe("bˈaɪʒtʃ");
  });
  it("ignores what is not a phone", () => {
    expect(phonesToIpa(["?", "K", "AE1", "T", ""])).toBe("kˈæt");
  });
});

describe("pronounce", () => {
  it("builds an ending onto a known word by how the word ends", () => {
    expect(pronounce("cats", small)).toEqual(["K", "AE1", "T", "S"]); // after a voiceless sound: /s/
    expect(pronounce("dogs", small)).toEqual(["D", "AO1", "G", "Z"]); // after a voiced one: /z/
    expect(pronounce("boxes", small)).toEqual(["B", "AA1", "K", "S", "IH0", "Z"]); // after a sibilant: /iz/ ("box" ends in S here)
    expect(pronounce("walked", small)).toEqual(["W", "AO1", "K", "T"]);
    expect(pronounce("played", small)).toEqual(["P", "L", "EY1", "D"]);
    expect(pronounce("wanted", small)).toEqual(["W", "AA1", "N", "T", "IH0", "D"]);
    expect(pronounce("bluffed", small)).toEqual(["B", "L", "AH1", "F", "T"]);
    expect(pronounce("playing", small)).toEqual(["P", "L", "EY1", "IH0", "NG"]);
    expect(pronounce("waving", small)).toEqual(["W", "EY1", "V", "IH0", "NG"]); // wave + ing, the e dropped
    expect(pronounce("dog's", small)).toEqual(["D", "AO1", "G", "Z"]);
  });

  it("joins two known words, the second weaker, and prefers the split with the longer shorter half", () => {
    expect(pronounce("cardroom", small)).toEqual(["K", "AA1", "R", "D", "R", "UW2", "M"]);
    expect(pronounce("wavelength", small)).toEqual(["W", "EY1", "V", "L", "EH2", "NG", "K", "TH"]);
  });

  it("falls back to the spelling for a word nothing explains, and a known word wins over every rule", () => {
    expect(pronounce("blorp", small).length).toBeGreaterThan(2);
    expect(pronounce("cat", small)).toEqual(["K", "AE1", "T"]);
  });
});

describe("letterToSound", () => {
  const phone = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)[012]$|^(B|CH|D|DH|F|G|HH|JH|K|L|M|N|NG|P|R|S|SH|T|TH|V|W|Y|Z|ZH)$/;

  it("gets the common spellings right", () => {
    expect(letterToSound("make")).toEqual(["M", "EY1", "K"]); // a vowel, a consonant and a final e
    expect(letterToSound("ship")).toEqual(["SH", "IH1", "P"]);
    expect(letterToSound("night")).toEqual(["N", "AY1", "T"]);
    expect(letterToSound("rain")).toEqual(["R", "EY1", "N"]);
    expect(letterToSound("knot")).toEqual(["N", "AA1", "T"]);
    expect(letterToSound("cell")).toEqual(["S", "EH1", "L"]);
    expect(letterToSound("rose")).toEqual(["R", "OW1", "Z"]);
  });

  it("stresses the first vowel and weakens the rest", () => {
    const p = letterToSound("zorbakan");
    const vowels = p.filter((x) => /\d$/.test(x));
    expect(vowels[0]!.endsWith("1")).toBe(true);
    expect(vowels.slice(1).every((x) => x.endsWith("0"))).toBe(true);
  });

  it("gives only real phones, and never throws, for any string of letters", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 2000; n++) {
      const w = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(rnd() * 26)]).join("");
      for (const p of letterToSound(w)) expect(p, w).toMatch(phone);
    }
    expect(letterToSound("")).toEqual([]);
  });
});

describe("numberToWords", () => {
  it("says whole numbers", () => {
    expect(numberToWords(0)).toEqual(["zero"]);
    expect(numberToWords(13)).toEqual(["thirteen"]);
    expect(numberToWords(21)).toEqual(["twenty", "one"]);
    expect(numberToWords(105)).toEqual(["one", "hundred", "five"]);
    expect(numberToWords(1000)).toEqual(["one", "thousand"]);
    expect(numberToWords(2_500_000)).toEqual(["two", "million", "five", "hundred", "thousand"]);
    expect(numberToWords(1e15)).toHaveLength(16); // too big: digit by digit
    expect(numberToWords(Number.NaN)).toEqual([]);
  });
});

describe("ipaFor", () => {
  it("writes words with spaces, the stress before the vowel, and a pause mark left on the word that ends a phrase", () => {
    expect(ipaFor("Hello world, this is it.")).toBe("həlˈoʊ wˈɝld, ðˈɪs ˈɪz ˈɪt.");
  });

  it("says numbers as words, and a decimal with its point", () => {
    expect(ipaFor("I raise 105.")).toBe(ipaFor("I raise one hundred five."));
    expect(ipaFor("2,500")).toBe(ipaFor("two thousand five hundred"));
    expect(ipaFor("3.5")).toBe(ipaFor("three point five"));
  });

  it("handles contractions and curly apostrophes, joins hyphenated words, and skips what it cannot say", () => {
    expect(ipaFor("don’t")).toBe(ipaFor("don't"));
    expect(ipaFor("three-of-a-kind")).toBe(ipaFor("three of a kind"));
    expect(ipaFor("$ % ## ~ 😀")).toBe("");
    expect(ipaFor("")).toBe("");
    expect(ipaFor("   ")).toBe("");
    expect(ipaFor("!!! ... ???")).toBe("");
  });

  it("does not put two pause marks on a word, and a pause with no word before it is dropped", () => {
    expect(ipaFor("Well... okay?!")).toBe(ipaFor("Well. okay?"));
    expect(ipaFor(", hello")).toBe(ipaFor("hello"));
  });

  it("never throws, on strange text", () => {
    for (const text of ["\u0000\u0001", "a".repeat(5000), "x'y'z''", "'''", "9".repeat(40), "ß ü é 漢字", "a-".repeat(200), "1,2,3,,4..5"]) expect(() => ipaFor(text), text).not.toThrow();
  });

  it("finds nearly every word of an ordinary line in the dictionary, so rules are the exception", () => {
    const d = loadPronunciations();
    const words = "Good morning everyone shall we begin hmm I will call that bet that is too rich for me I fold is she bluffing I really cannot tell two sevens and an ace lovely oh no well played let me think about it for a moment boom three of a kind thank you for the chips".toLowerCase().split(" ");
    const missing = words.filter((w) => !d.lookup(w));
    expect(missing, `not in the dictionary: ${missing.join(", ")}`).toEqual(["hmm"].filter((w) => missing.includes(w)));
    expect(missing.length / words.length).toBeLessThan(0.03);
  });
});
