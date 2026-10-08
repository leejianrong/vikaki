import { describe, expect, it } from "vitest";
import { formatMs, wordPieces } from "./driver-console.ts";

describe("wordPieces", () => {
  it("keeps each word with the space after it, so the pieces rebuild the text", () => {
    const text = "Hello there,  my friend.";
    expect(wordPieces(text)).toEqual(["Hello ", "there,  ", "my ", "friend."]);
    expect(wordPieces(text).join("")).toBe(text);
  });

  it("handles one word, empty text and surrounding whitespace", () => {
    expect(wordPieces("Hi")).toEqual(["Hi"]);
    expect(wordPieces("")).toEqual([]);
    expect(wordPieces("   ")).toEqual([]);
    expect(wordPieces("  hi  there  ").join("").trim()).toBe("hi  there");
  });
});

describe("formatMs", () => {
  it("shows milliseconds under a second and seconds above", () => {
    expect(formatMs(412.4)).toBe("412 ms");
    expect(formatMs(0)).toBe("0 ms");
    expect(formatMs(999)).toBe("999 ms");
    expect(formatMs(1000)).toBe("1.0 s");
    expect(formatMs(2349)).toBe("2.3 s");
  });
});
