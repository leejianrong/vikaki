import { describe, expect, it } from "vitest";
import { FakeTts, report, runBench, TtsError, toWav, type SynthesisRequest, type Tts } from "../src/index.ts";

describe("runBench", () => {
  it("times each line, keeps its audio, passes the tone for its emotion, and reports a failure without stopping", async () => {
    const styles: (string | undefined)[] = [];
    const inner = new FakeTts({ sampleRate: 16000, msPerChar: 50, chunkMs: 100, failOn: "boom" });
    const spy: Tts = { name: "spy", synthesize: (r: SynthesisRequest) => (styles.push(r.style), inner.synthesize(r)) };
    let t = 0;
    const results = await runBench(spy, [
      { label: "taunt", text: "Nice try, Ben.", emotion: "smug" },
      { label: "broken", text: "boom" },
      { label: "thought", text: "Please hold.", thought: true },
    ], () => (t += 10));
    expect(results.map((r) => !!r.error)).toEqual([false, true, false]);
    expect(results[0]!.audioSeconds).toBeCloseTo(0.7, 1); // 14 characters at 50 ms
    expect(results[0]!.firstAudioMs).toBeGreaterThan(0);
    expect(styles[0]).toMatch(/Slow and pleased/);
    expect(styles[2]).toMatch(/^Muttering/);
    const md = report("fake", results);
    expect(md).toContain("### fake");
    expect(md).toContain("| broken | 4 | failed:");
    expect(md).toContain("**mean**");
  });

  it("makes a valid WAV", () => {
    const wav = toWav(new Float32Array([0, 1, -1]), 8000);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    const v = new DataView(wav.buffer);
    expect(v.getUint32(24, true)).toBe(8000);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32767);
    expect(wav.length).toBe(44 + 6);
  });

  it("is a TtsError that a provider gives, in the report", async () => {
    const bad: Tts = { name: "bad", synthesize: async function* () { throw new TtsError("HTTP 401"); } };
    const [r] = await runBench(bad, [{ label: "x", text: "hello" }]);
    expect(r!.error).toBe("HTTP 401");
  });
});
