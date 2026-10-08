import { describe, expect, it } from "vitest";
import { SentenceAssembler } from "./sentences.ts";

const slice = (over: Partial<Parameters<SentenceAssembler["push"]>[0]> & { n?: number }) => ({
  utteranceId: "u",
  samples: new Float32Array(over.n ?? 10).fill(0.5),
  sampleRate: 1000,
  final: false,
  ...over,
});

describe("SentenceAssembler", () => {
  it("holds a sentence until the next one starts, then hands over all of its audio and text", () => {
    const a = new SentenceAssembler();
    expect(a.push(slice({ sentenceIndex: 0, sentenceText: "Hello.", n: 10 }))).toEqual([]);
    expect(a.push(slice({ sentenceIndex: 0, n: 5 }))).toEqual([]);
    const done = a.push(slice({ sentenceIndex: 1, sentenceText: "Bye.", n: 7 }));
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ utteranceId: "u", index: 0, text: "Hello.", sampleRate: 1000 });
    expect(done[0]!.samples).toHaveLength(15);
  });

  it("completes the last sentence when the utterance ends, and an empty final marker adds nothing", () => {
    const a = new SentenceAssembler();
    a.push(slice({ sentenceIndex: 0, sentenceText: "One.", n: 4 }));
    a.push(slice({ sentenceIndex: 1, sentenceText: "Two.", n: 6 }));
    const done = a.push({ utteranceId: "u", samples: new Float32Array(0), sampleRate: 1000, final: true });
    expect(done.map((d) => [d.index, d.text, d.samples.length])).toEqual([[1, "Two.", 6]]);
    expect(a.push({ utteranceId: "u", samples: new Float32Array(0), sampleRate: 1000, final: true })).toEqual([]); // nothing left
  });

  it("completes a sentence the moment its end marker arrives, without waiting for the next sentence", () => {
    const a = new SentenceAssembler();
    a.push(slice({ sentenceIndex: 0, sentenceText: "Hello.", n: 10 }));
    a.push(slice({ sentenceIndex: 0, n: 5 }));
    const done = a.push({ utteranceId: "u", sentenceIndex: 0, sentenceEnd: true, samples: new Float32Array(0), sampleRate: 1000, final: false });
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ index: 0, text: "Hello." });
    expect(done[0]!.samples).toHaveLength(15);
    // and it is not handed over a second time when the next sentence or the end arrives
    expect(a.push(slice({ sentenceIndex: 1, sentenceText: "Bye.", n: 3 }))).toEqual([]);
    expect(a.push({ utteranceId: "u", sentenceIndex: 1, sentenceEnd: true, samples: new Float32Array(0), sampleRate: 1000, final: false }).map((d) => d.text)).toEqual(["Bye."]);
    expect(a.push({ utteranceId: "u", samples: new Float32Array(0), sampleRate: 1000, final: true })).toEqual([]);
  });

  it("keeps utterances apart", () => {
    const a = new SentenceAssembler();
    a.push(slice({ utteranceId: "a", sentenceIndex: 0, sentenceText: "A.", n: 3 }));
    a.push(slice({ utteranceId: "b", sentenceIndex: 0, sentenceText: "B.", n: 4 }));
    const done = a.push({ utteranceId: "a", samples: new Float32Array(0), sampleRate: 1000, final: true });
    expect(done.map((d) => [d.utteranceId, d.samples.length])).toEqual([["a", 3]]);
  });

  it("forgets a cancelled utterance", () => {
    const a = new SentenceAssembler();
    a.push(slice({ sentenceIndex: 0, sentenceText: "Never finished", n: 3 }));
    a.cancel("u");
    expect(a.push({ utteranceId: "u", samples: new Float32Array(0), sampleRate: 1000, final: true })).toEqual([]);
  });

  it("treats a hub that sends no sentence numbers as one sentence with no text", () => {
    const a = new SentenceAssembler();
    a.push(slice({ n: 3 }));
    a.push(slice({ n: 3 }));
    const done = a.push({ utteranceId: "u", samples: new Float32Array(0), sampleRate: 1000, final: true });
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ index: 0, text: "" });
    expect(done[0]!.samples).toHaveLength(6);
  });
});
