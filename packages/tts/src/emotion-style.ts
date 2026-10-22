// What to tell a provider that takes free-text direction (gpt-4o-mini-tts `instructions`, Qwen3-TTS `instruct`) for a line with this emotion (VIK-140).
// Plain words, in the table's voice: warm and a little playful, never a realistic human impression (ADR-0005 keeps the look cartoon-first; the voice follows).

const BY_EMOTION: Record<string, string> = {
  neutral: "Calm and friendly, at an easy pace.",
  happy: "Bright and warm, smiling as you speak.",
  excited: "Quick and lively, with a lift in the voice.",
  sad: "Soft and a little slow, with a heavy sigh in the voice.",
  angry: "Clipped and firm, holding back a growl.",
  worried: "Hesitant and a bit high, speaking carefully.",
  surprised: "Startled, with a sudden rise in pitch.",
  smug: "Slow and pleased with yourself, teasing.",
  nervous: "Tight and hurried, swallowing a little.",
  confident: "Steady and sure, a cheeky half-smile.",
};

/** The direction for a line: its emotion, and `thought` for a spoken inner monologue, which is quiet and kept to oneself. */
export function styleFor(emotion: string | undefined, opts: { thought?: boolean } = {}): string {
  const base = BY_EMOTION[emotion ?? "neutral"] ?? BY_EMOTION.neutral!;
  return opts.thought ? `Muttering to yourself, quietly and close to the mic. ${base}` : base;
}
