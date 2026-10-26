# Kokoro baseline (VIK-142)

The ten-line listening set ([voice-rubric.md](../voice-rubric.md)) through Kokoro-82M, full precision, voice ids `af_heart`, `am_adam`, `bf_emma` as set per line, on this development machine (16 logical cores, CPU only, WSL2), 2026-10-27, after one untimed warm-up line. Raw numbers: [voice-baseline-kokoro.json](voice-baseline-kokoro.json).

| Line | Chars | First audio | Total | Audio | Speed | Chunks |
| --- | --- | --- | --- | --- | --- | --- |
| short ack | 5 | 417 ms | 417 ms | 1.4 s | 3.4x | 1 |
| taunt | 53 | 729 ms | 1456 ms | 3.9 s | 2.7x | 2 |
| numbers | 72 | 1947 ms | 2856 ms | 8.3 s | 2.9x | 2 |
| names | 73 | 910 ms | 1664 ms | 5.3 s | 3.2x | 2 |
| worried thought | 44 | 810 ms | 1094 ms | 3.2 s | 3.0x | 2 |
| excited rush | 23 | 611 ms | 611 ms | 2.2 s | 3.6x | 1 |
| sad bust-out | 58 | 1009 ms | 1335 ms | 4.3 s | 3.2x | 2 |
| angry fold | 52 | 729 ms | 1245 ms | 3.7 s | 3.0x | 2 |
| question | 65 | 702 ms | 1263 ms | 4.2 s | 3.4x | 2 |
| long story | 224 | 684 ms | 4187 ms | 13.4 s | 3.2x | 4 |
| **mean** | | 855 ms | 1613 ms | 5.0 s | 3.1x | |

- Speed is well above real time, and the pieces (about 70 characters, ADR-0013) mean the long line starts in 684 ms. Latency is not Kokoro's problem on this machine; quality is.
- "Numbers" took 8.3 s of audio for 72 characters and the slowest start (1.9 s): worth listening to for how "1,250", "3.5" and "$4,800" were read.
- Kokoro takes no free-text direction (`style` is ignored), so the four emotion lines can only differ by the words.
- **Not scored yet.** The rubric scores are a person listening. I cannot listen, so the four rubric rows for Kokoro are left for Jian to fill from `pnpm exec tsx scripts/tts-bench.ts --engines kokoro --blind`; the numbers above are the part that is measured.
