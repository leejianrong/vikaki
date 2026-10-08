/** Words that end in a dot without ending a sentence. */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "mt", "inc", "ltd"]);

export interface ChunkerOptions {
  /** A sentence with no full stop is cut at a comma or similar once it is this long. Lowers time to first audio. */
  clauseSplitAt?: number;
  /** ...but never leaves less than this before the cut. */
  minClause?: number;
}

/**
 * Splits streamed text into pieces worth speaking, so audio can start before the whole reply exists.
 * Feed text deltas to `push`; each returns the pieces completed so far. Call `flush` at the end.
 */
export class SentenceChunker {
  private buf = "";
  private readonly clauseSplitAt: number;
  private readonly minClause: number;

  constructor(options: ChunkerOptions = {}) {
    this.clauseSplitAt = options.clauseSplitAt ?? 80;
    this.minClause = options.minClause ?? 30;
  }

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    for (;;) {
      const end = this.sentenceEnd() ?? this.clauseEnd();
      if (end === undefined) break;
      const piece = this.buf.slice(0, end).trim();
      this.buf = this.buf.slice(end).replace(/^\s+/, "");
      if (piece) out.push(piece);
    }
    return out;
  }

  /** The rest of the text, as one piece (or none if there is nothing left). */
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = "";
    return rest ? [rest] : [];
  }

  /** Index just past the first real sentence end, or undefined if none yet. */
  private sentenceEnd(): number | undefined {
    const re = /([.!?…]+)(["'”’)\]]*)(\s+)|([。！？]+["'”’)\]」』]*)/g;
    for (let m = re.exec(this.buf); m; m = re.exec(this.buf)) {
      if (m[4] !== undefined) return m.index + m[0].length; // CJK stops need no space after
      if (m[1] === "." && this.isAbbreviation(this.buf.slice(0, m.index))) continue;
      return m.index + m[0].length;
    }
    return undefined;
  }

  private isAbbreviation(before: string): boolean {
    const word = /([A-Za-z][A-Za-z.]*)$/.exec(before)?.[1];
    if (!word) return false;
    if (word.length === 1 && /[A-Z]/.test(word)) return true; // an initial, as in "J. Smith"
    return ABBREVIATIONS.has(word.toLowerCase());
  }

  /** A cut point inside a long sentence that has no full stop yet. */
  private clauseEnd(): number | undefined {
    if (this.buf.length < this.clauseSplitAt) return undefined;
    const re = /[,;:]\s+|\s[—–-]\s+/g;
    let cut: number | undefined;
    for (let m = re.exec(this.buf); m; m = re.exec(this.buf)) {
      const end = m.index + m[0].length;
      if (end - m[0].length >= this.minClause) cut = end; // keep the latest cut that leaves a real clause
      if (cut !== undefined) break; // the first good cut keeps the first audio as early as possible
    }
    return cut;
  }
}
