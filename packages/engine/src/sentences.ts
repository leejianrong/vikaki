/** One spoken piece of an utterance, with all of its audio, once the whole of it has arrived. */
export interface CompleteSentence {
  utteranceId: string;
  index: number;
  text: string;
  samples: Float32Array;
  sampleRate: number;
}

export interface SentenceSlice {
  utteranceId: string;
  sentenceIndex?: number;
  sentenceText?: string;
  samples: Float32Array;
  sampleRate: number;
  final: boolean;
  /** An empty slice saying the sentence's audio is complete. */
  sentenceEnd?: boolean;
}

interface Open {
  index: number;
  text: string;
  parts: Float32Array[];
  rate: number;
}

/**
 * Gathers the slices of each sentence as they arrive. A sentence is complete when the next one starts or the utterance
 * ends, which is when its words can be timed. A hub that sends no sentence numbers makes the whole utterance one sentence.
 */
export class SentenceAssembler {
  private readonly open = new Map<string, Open>();

  push(s: SentenceSlice): CompleteSentence[] {
    const done: CompleteSentence[] = [];
    const index = s.sentenceIndex ?? 0;
    let cur = this.open.get(s.utteranceId);
    if (cur && cur.index !== index && s.samples.length > 0) {
      done.push(this.finish(s.utteranceId, cur));
      cur = undefined;
    }
    if (!cur && s.samples.length > 0) {
      cur = { index, text: "", parts: [], rate: s.sampleRate };
      this.open.set(s.utteranceId, cur);
    }
    if (cur && s.samples.length > 0) {
      cur.parts.push(s.samples);
      if (s.sentenceText !== undefined) cur.text = s.sentenceText;
    }
    if ((s.final || (s.sentenceEnd && cur?.index === index)) && cur) {
      done.push(this.finish(s.utteranceId, cur)); // finish() forgets it, so the next sentence or the end does not hand it over twice
    }
    return done;
  }

  /** The utterance was cancelled: what has arrived of its last sentence is not worth timing. */
  cancel(utteranceId: string): void {
    this.open.delete(utteranceId);
  }

  private finish(utteranceId: string, o: Open): CompleteSentence {
    const samples = new Float32Array(o.parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of o.parts) {
      samples.set(p, at);
      at += p.length;
    }
    this.open.delete(utteranceId);
    return { utteranceId, index: o.index, text: o.text, samples, sampleRate: o.rate };
  }
}
