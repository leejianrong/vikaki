import { describe, expect, it } from "vitest";
import { costOf, PRICES, PROVIDERS, speechStats, SpeechApiTts, styleFor, TtsError, type AudioChunk } from "../src/index.ts";

const pcm = (samples: number[]) => {
  const b = new Uint8Array(samples.length * 2);
  const v = new DataView(b.buffer);
  samples.forEach((s, i) => v.setInt16(i * 2, s, true));
  return b;
};

/** A `fetch` that answers with these byte pieces, and remembers what it was asked. */
function fakeFetch(pieces: Uint8Array[], init: { status?: number; text?: string } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, req: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: req.headers, body: JSON.parse(req.body) });
    if (init.status && init.status >= 400) return new Response(init.text ?? "", { status: init.status });
    return new Response(new ReadableStream({ start(c) { pieces.forEach((p) => c.enqueue(p)); c.close(); } }));
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function collect(it: AsyncIterable<AudioChunk>): Promise<AudioChunk[]> {
  const out: AudioChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

const SECRET = "sk-test-secret-123";
const make = (f: typeof fetch, o = {}) => new SpeechApiTts({ ...PROVIDERS.openai(), apiKey: SECRET, fetch: f, ...o });

describe("SpeechApiTts", () => {
  it("asks for raw PCM with the tone as instructions, the key only in the header, and the persona's voice mapped", async () => {
    const { f, calls } = fakeFetch([pcm([0, 16384, -16384])]);
    const chunks = await collect(make(f).synthesize({ text: "Nice try.", voice: "am_adam", style: "Smug and slow." }));
    const c = calls[0]!;
    expect(c.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(c.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(c.body).toMatchObject({ model: "gpt-4o-mini-tts", input: "Nice try.", voice: "onyx", instructions: "Smug and slow.", response_format: "pcm" });
    expect(JSON.stringify(c.body)).not.toContain(SECRET);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.sampleRate).toBe(24000);
    expect([...chunks[0]!.samples]).toEqual([0, 0.5, -0.5]);
  });

  it("joins a sample split across two reads, and strips a WAV header if the server sends one anyway", async () => {
    const all = pcm([1000, -1000, 2000]);
    const { f } = fakeFetch([all.subarray(0, 3), all.subarray(3)]);
    const got = (await collect(make(f).synthesize({ text: "x" }))).flatMap((c) => [...c.samples].map((s) => Math.round(s * 32768)));
    expect(got).toEqual([1000, -1000, 2000]);
    const wav = new Uint8Array(44 + 4);
    wav.set([...("RIFF" as string)].map((c) => c.charCodeAt(0)), 0);
    wav.set([...("WAVEfmt " as string)].map((c) => c.charCodeAt(0)), 8);
    new DataView(wav.buffer).setUint32(16, 16, true);
    wav.set([...("data" as string)].map((c) => c.charCodeAt(0)), 36);
    new DataView(wav.buffer).setUint32(40, 4, true);
    new DataView(wav.buffer).setInt16(44, 8192, true);
    new DataView(wav.buffer).setInt16(46, -8192, true);
    const { f: g } = fakeFetch([wav]);
    expect((await collect(make(g).synthesize({ text: "x" }))).flatMap((c) => [...c.samples])).toEqual([0.25, -0.25]);
  });

  it("uses the default voice for an unknown one, and cuts the style to the provider's limit", async () => {
    const { f, calls } = fakeFetch([pcm([1, 2])]);
    await collect(make(f, { maxStyleChars: 5 }).synthesize({ text: "x", voice: "zz_unknown", style: "abcdefghij" }));
    expect(calls[0]!.body).toMatchObject({ voice: "coral", instructions: "abcde" });
  });

  it("says which environment variable is missing without printing any key, and scrubs a key echoed in an error body", async () => {
    delete process.env.OPENAI_API_KEY;
    const none = new SpeechApiTts({ ...PROVIDERS.openai(), fetch: fakeFetch([]).f });
    await expect(collect(none.synthesize({ text: "x" }))).rejects.toThrow(/OPENAI_API_KEY is not set/);
    const { f } = fakeFetch([], { status: 401, text: `bad key ${SECRET} sent` });
    const err = await collect(make(f).synthesize({ text: "x" })).catch((e) => e as Error);
    expect(err).toBeInstanceOf(TtsError);
    expect((err as Error).message).toMatch(/HTTP 401/);
    expect((err as Error).message).not.toContain(SECRET);
  });

  it("reaches a self-hosted server without a key, and ends quietly when aborted", async () => {
    delete process.env.CHATTERBOX_API_KEY;
    const { f, calls } = fakeFetch([pcm([5, 6])]);
    const cb = new SpeechApiTts({ ...PROVIDERS.chatterbox({ baseUrl: "http://pod.example:8004/v1/" }), fetch: f });
    expect(await collect(cb.synthesize({ text: "x" }))).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://pod.example:8004/v1/audio/speech");
    expect(calls[0]!.headers.authorization).toBeUndefined();
    const ac = new AbortController();
    ac.abort();
    const refuse = (async () => { throw new DOMException("aborted", "AbortError"); }) as unknown as typeof fetch;
    expect(await collect(make(refuse).synthesize({ text: "x", signal: ac.signal }))).toEqual([]);
  });
});

describe("styleFor", () => {
  it("gives words for an emotion, a default for an unknown one, and a quiet murmur for a thought", () => {
    expect(styleFor("worried")).toMatch(/Hesitant/);
    expect(styleFor("no-such-emotion")).toBe(styleFor("neutral"));
    expect(styleFor("happy", { thought: true })).toMatch(/^Muttering to yourself/);
  });
});

describe("speechStats and costOf", () => {
  const log = [
    { at: 0, message: { type: "utterance", utterance_id: "a", text: "Hello there." } },
    { at: 30000, message: { type: "utterance", utterance_id: "b", delta: "Nice " } },
    { at: 60000, message: { type: "utterance", utterance_id: "b", delta: "try.", final: true } },
    { message: { type: "audio", utterance_id: "a" } },
  ];
  it("counts each line once, deltas joined", () => {
    const s = speechStats(log);
    expect(s).toMatchObject({ lines: 2, characters: 12 + 9 });
    expect(s.minutes).toBeCloseTo(21 / 15 / 60);
    expect(s.wallMinutes).toBe(1);
  });
  it("prices a hosted API per minute of audio and a GPU per minute it works", () => {
    const stats = { lines: 1, characters: 20_000, minutes: 20_000 / 15 / 60 };
    const by = Object.fromEntries(PRICES.map((p) => [p.name, costOf(stats, p)]));
    const longGame = costOf({ ...stats, wallMinutes: 18 }, PRICES[2]!); // the pod is up for the whole game
    expect(longGame).toBeCloseTo((18 / 60) * 0.4, 3);
    expect(longGame).toBeGreaterThan(by["Chatterbox on RunPod"]!);
    expect(by["Kokoro (local)"]).toBe(0);
    expect(by["OpenAI gpt-4o-mini-tts"]).toBeCloseTo(22.2 * 0.015, 1);
    expect(by["Chatterbox on RunPod"]).toBeLessThan(by["OpenAI gpt-4o-mini-tts"]!);
  });
});
