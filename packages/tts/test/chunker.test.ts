import { describe, expect, it } from "vitest";
import { SentenceChunker } from "../src/index.ts";

/** Feed `parts` one at a time, then flush, and return every piece in order. */
function run(parts: string[], options?: ConstructorParameters<typeof SentenceChunker>[0]): string[] {
  const c = new SentenceChunker(options);
  return [...parts.flatMap((p) => c.push(p)), ...c.flush()];
}

describe("SentenceChunker", () => {
  it("splits whole text into sentences", () => {
    expect(run(["Hello there. How are you? I am fine!"])).toEqual(["Hello there.", "How are you?", "I am fine!"]);
  });

  it("gives the same pieces however the text is cut into deltas", () => {
    const text = "I think you are bluffing. Call! Maybe not, though.";
    const whole = run([text]);
    expect(run(text.split(""))).toEqual(whole);
    expect(run(text.split(" ").map((w, i) => (i ? " " + w : w)))).toEqual(whole);
  });

  it("holds a sentence back until its end is certain, then releases it", () => {
    const c = new SentenceChunker();
    expect(c.push("Hello there.")).toEqual([]); // could still be "3.5" or an abbreviation
    expect(c.push(" How")).toEqual(["Hello there."]);
    expect(c.flush()).toEqual(["How"]);
  });

  it("does not split on abbreviations, initials or decimals", () => {
    expect(run(["Dr. Smith met Mr. Jones at 3.5 percent."])).toEqual(["Dr. Smith met Mr. Jones at 3.5 percent."]);
    expect(run(["Ask J. Smith about it. Then go."])).toEqual(["Ask J. Smith about it.", "Then go."]);
    expect(run(["Bring apples, pears, etc. Then leave."])).toEqual(["Bring apples, pears, etc. Then leave."]);
  });

  it("keeps closing quotes and brackets with their sentence", () => {
    expect(run(['He said "go." Then he left. (Really.) Done.'])).toEqual(['He said "go."', "Then he left.", "(Really.)", "Done."]);
  });

  it("treats an ellipsis and repeated marks as one stop", () => {
    expect(run(["Well... I suppose so. What?! Yes."])).toEqual(["Well...", "I suppose so.", "What?!", "Yes."]);
  });

  it("splits CJK sentences without needing a space", () => {
    expect(run(["你好。今天怎么样？很好！"])).toEqual(["你好。", "今天怎么样？", "很好！"]);
  });

  it("cuts a long unpunctuated sentence at a comma so audio can start sooner", () => {
    const long = "Well I was thinking about the whole situation for a while, and then I decided that we should leave early";
    const c = new SentenceChunker();
    const first = c.push(long);
    expect(first).toEqual(["Well I was thinking about the whole situation for a while,"]);
    expect(c.flush()).toEqual(["and then I decided that we should leave early"]);
  });

  it("does not cut short text, or cut too close to the start", () => {
    expect(run(["Yes, I will, thanks"])).toEqual(["Yes, I will, thanks"]);
    const early = "Ok, " + "x".repeat(100);
    expect(run([early])).toEqual([early]);
  });

  it("never loses or invents text", () => {
    const text = "One. Two, three; four: five — six. Seven? Eight!";
    const joined = run([text]).join(" ");
    expect(joined.replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("returns nothing for empty or whitespace input", () => {
    expect(run([""])).toEqual([]);
    expect(run(["   ", "\n"])).toEqual([]);
  });
});
