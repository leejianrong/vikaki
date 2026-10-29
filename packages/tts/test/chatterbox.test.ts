import { describe, expect, it } from "vitest";
import { ChatterboxTts, chatterboxParams, styleFor, TtsError, type AudioChunk } from "../src/index.ts";

const pcm = (n: number, value = 1000) => {
  const b = new Uint8Array(n * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, value, true);
  return b;
};

/** A fake Chatterbox server as a `fetch`: answers each request with audio whose length follows its text, and remembers the requests. */
function fakeServer(opts: { delayMs?: (text: string) => number; fail?: RegExp } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, req: { headers: Record<string, string>; body: string; signal?: AbortSignal }) => {
    const body = JSON.parse(req.body) as Record<string, unknown>;
    calls.push({ url, headers: req.headers, body });
    const text = String(body.input);
    if (opts.fail?.test(text)) return new Response(`boom for key ${req.headers.authorization ?? ""}`, { status: 500 });
    await new Promise((r) => setTimeout(r, opts.delayMs?.(text) ?? 0));
    return new Response(new ReadableStream({ start(c) { c.enqueue(pcm(text.length * 10)); c.enqueue(pcm(text.length * 10)); c.close(); } }));
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function collect(it: AsyncIterable<AudioChunk>): Promise<AudioChunk[]> {
  const out: AudioChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

const SECRET = "cb-test-secret-456";
const make = (f: typeof fetch, o = {}) => new ChatterboxTts({ apiKey: SECRET, baseUrl: "http://pod.test/v1", fetch: f, ...o });

describe("ChatterboxTts", () => {
  it("yields a piece as one chunk with its words, so --phonemes can time it (ADR-0049)", async () => {
    const { f, calls } = fakeServer();
    const chunks = await collect(make(f).synthesize({ text: "Nice try, Ben.", emotion: "smug", style: styleFor("smug") }));
    expect(chunks).toHaveLength(1); // the server sent two reads; the piece is one chunk
    expect(chunks[0]!.text).toBe("Nice try, Ben.");
    expect(chunks[0]!.samples.length).toBe(14 * 10 * 2);
    expect(calls[0]!.url).toBe("http://pod.test/v1/audio/speech");
    expect(calls[0]!.body).toMatchObject({ input: "Nice try, Ben.", response_format: "pcm", ...chatterboxParams("smug") });
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.stringify(calls[0]!.body)).not.toContain(SECRET);
  });

  it("cuts a long sentence into pieces, in order, each with its own words, and asks for the next while the last plays", async () => {
    const long = "I once folded a full house because I thought the dealer had misdealt, and I'm still not sure whether I was right, anyway it taught me to count the cards twice and never trust a man who smiles that much.";
    const { f, calls } = fakeServer({ delayMs: () => 5 });
    const chunks = await collect(make(f, { maxPieceChars: 80 }).synthesize({ text: long }));
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.text).join(" ").replace(/\s+/g, " ")).toBe(long);
    expect(calls.map((c) => c.body.input)).toEqual(chunks.map((c) => c.text));
    expect(chunks.every((c) => c.text!.length <= 105)).toBe(true);
  });

  it("makes a thought quieter and flatter than the same line said aloud", () => {
    const aloud = chatterboxParams("worried");
    const thought = chatterboxParams("worried", true);
    expect(thought.exaggeration).toBeLessThan(aloud.exaggeration);
    expect(chatterboxParams("excited").exaggeration).toBeGreaterThan(chatterboxParams("neutral").exaggeration);
    expect(chatterboxParams("no-such-emotion")).toEqual(chatterboxParams("neutral"));
  });

  it("stops between pieces when aborted, and asks for no more", async () => {
    const { f, calls } = fakeServer();
    const ac = new AbortController();
    const got: AudioChunk[] = [];
    for await (const c of make(f, { maxPieceChars: 40 }).synthesize({ text: "One two three four five six seven eight. Nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen.", signal: ac.signal })) {
      got.push(c);
      ac.abort();
    }
    expect(got).toHaveLength(1);
    expect(calls.length).toBeLessThanOrEqual(2); // the one prefetched while the first played, never a third
  });

  it("reports a server failure as tts_failed without the key in it", async () => {
    const { f } = fakeServer({ fail: /boom/ });
    const err = await collect(make(f).synthesize({ text: "boom" })).catch((e) => e);
    expect(err).toBeInstanceOf(TtsError);
    expect(err.message).toContain("HTTP 500");
    expect(err.message).not.toContain(SECRET);
  });

  it("does not require a key for a server that has none", async () => {
    const { f, calls } = fakeServer();
    const chunks = await collect(new ChatterboxTts({ baseUrl: "http://pod.test/v1", fetch: f }).synthesize({ text: "Hello." }));
    expect(chunks).toHaveLength(1);
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });
});

describe("Chatterbox pace (VIK-150)", () => {
  it("lowers exaggeration by a delta and caps cfg_weight, for every emotion, and never goes below the floor", () => {
    for (const emotion of [undefined, "neutral", "excited", "smug", "sad"]) {
      const base = chatterboxParams(emotion);
      const slow = chatterboxParams(emotion, false, { exaggerationDelta: -0.15, cfgWeightCap: 0.3 });
      expect(slow.exaggeration).toBeCloseTo(Math.max(0.25, base.exaggeration - 0.15));
      expect(slow.cfg_weight).toBe(Math.min(base.cfg_weight, 0.3));
    }
    expect(chatterboxParams("sad", false, { exaggerationDelta: -5, cfgWeightCap: 0.3 }).exaggeration).toBe(0.25);
  });

  it("sends the slowed numbers to the server, and the plain ones when no pace is set", async () => {
    const { f, calls } = fakeServer();
    await collect(make(f, { pace: { exaggerationDelta: -0.25, cfgWeightCap: 0.2 } }).synthesize({ text: "Fold.", emotion: "excited" }));
    await collect(make(f).synthesize({ text: "Fold.", emotion: "excited" }));
    expect(calls[0]!.body).toMatchObject({ exaggeration: 0.65, cfg_weight: 0.2 });
    expect(calls[1]!.body).toMatchObject({ exaggeration: 0.9, cfg_weight: 0.35 });
  });
});
