// The phonemes of the eight scorecard lines (VIK-51), as `line-N.ipa.txt` beside each recording: what Kokoro's phonemizer says for the text, piece by piece,
// pieces joined by ", " as the engine does. The audio is not remade, so the baseline taken on it still holds. Needs the real voice: `make install-voice`.
//   pnpm exec tsx scripts/make-scorecard-phonemes.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findVoice } from "../packages/cli/src/voice.ts";
import { KokoroTts } from "../packages/tts/src/index.ts";

const LINES: [number, string, string][] = [
  [1, "af_heart", "Good morning, everyone. Shall we begin?"],
  [2, "am_adam", "Hmm, I will call that bet."],
  [3, "bf_emma", "That is too rich for me. I fold!"],
  [4, "af_heart", "Is she bluffing? I really cannot tell."],
  [5, "am_adam", "Two sevens and an ace. Lovely."],
  [6, "bf_emma", "Oh no. Well played, Ada."],
  [7, "af_heart", "Let me think about it for a moment."],
  [8, "am_adam", "Boom! Three of a kind. Thank you for the chips."],
];
const found = findVoice();
if (!found) throw new Error("the real voice is not installed; run `make install-voice`");
const tts = await KokoroTts.create({ importFrom: found.entry, phonemes: true, inProcess: true });
const dir = fileURLToPath(new URL("../packages/audio/test/fixtures/scorecard/", import.meta.url));
for (const [n, voice, text] of LINES) {
  const pieces: string[] = [];
  for await (const c of tts.synthesize({ text, voice })) if (c.phonemes) pieces.push(c.phonemes);
  writeFileSync(`${dir}line-${n}.ipa.txt`, pieces.join(", ") + "\n");
  console.log(`line-${n}: ${pieces.join(", ")}`);
}
await tts.close();
process.exit(0);
