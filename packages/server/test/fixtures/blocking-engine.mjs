// A text-to-speech engine that behaves like Kokoro on the main thread: stretches of work that hold the whole
// process (here a busy loop) with short gaps between them. Used to test that a slow engine cannot stall the hub.
const busy = (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function create({ blocks = 3, blockMs = 400, rate = 16000 } = {}) {
  return {
    name: "blocking",
    voices: [],
    async *synthesize({ signal }) {
      for (let i = 0; i < blocks; i++) {
        await sleep(5);
        if (signal?.aborted) return;
        busy(blockMs);
      }
      const samples = new Float32Array(rate / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate);
      yield { samples, sampleRate: rate };
    },
  };
}
