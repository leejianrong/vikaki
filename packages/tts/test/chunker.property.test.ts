import fc from "fast-check";
import { describe, it } from "vitest";
import { SentenceChunker } from "../src/index.ts";

const word = fc.constantFrom("Hello", "Dr.", "3.5", "world,", "end.", "really?", "wow!", "…", "你好。", "e.g.", "J.", "—", "a", "x".repeat(40));
const gap = fc.constantFrom(" ", "  ", "\n", " \t");
const text = fc.array(fc.tuple(word, gap), { maxLength: 40 }).map((p) => p.map(([w, g]) => w + g).join(""));
/** The same text cut into deltas anywhere, even inside a word. */
const deltas = text.chain((t) => fc.uniqueArray(fc.nat(t.length), { maxLength: 10 }).map((cuts) => {
  const at = [0, ...cuts.sort((a, b) => a - b), t.length];
  return { t, parts: at.slice(1).map((c, i) => t.slice(at[i], c)) };
}));

function run(parts: string[]): string[] {
  const c = new SentenceChunker();
  return [...parts.flatMap((p) => c.push(p)), ...c.flush()];
}
const squash = (s: string) => s.replace(/\s+/g, "");

describe("SentenceChunker properties", () => {
  it("never loses or invents text, however the deltas are cut", () => {
    fc.assert(fc.property(deltas, ({ t, parts }) => squash(run(parts).join("")) === squash(t)));
  });

  it("only emits non-empty, trimmed pieces", () => {
    fc.assert(fc.property(deltas, ({ parts }) => run(parts).every((p) => p.length > 0 && p === p.trim())));
  });

  it("emits nothing more after a flush", () => {
    fc.assert(
      fc.property(deltas, ({ parts }) => {
        const c = new SentenceChunker();
        parts.forEach((p) => c.push(p));
        c.flush();
        return c.flush().length === 0;
      }),
    );
  });
});
