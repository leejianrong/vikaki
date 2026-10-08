// Splitting a long sentence into pieces small enough to cancel between. Plain JavaScript: a worker thread runs it (see kokoro-core.mjs).

const CONJUNCTION = /\s(?:and|but|or|so|because|which|that|while|when|although|though|then)\s/gi;

/** The last index in `[from, to]` where `re` matches; the index is where the match starts. */
function lastMatch(text, re, from, to) {
  let found = -1;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index >= from && m.index <= to) found = m.index;
    if (m.index > to) break;
  }
  return found;
}

/**
 * Where to cut `text` so the left piece has `min` to `max` characters, at the most natural place there is. A cut after punctuation may run
 * a quarter past `max`: a piece of 72 characters ending at a comma is better than "discuss the | budget," cut at a space at 70.
 */
function bestCut(text, max, min) {
  const soft = Math.floor(max * 1.25);
  const strong = lastMatch(text, /[;:—–]/g, min - 1, soft - 1);
  if (strong >= 0) return strong + 1; // after the mark, which stays with the left piece
  const comma = lastMatch(text, /,/g, min - 1, soft - 1);
  if (comma >= 0) return comma + 1;
  const conjunction = lastMatch(text, CONJUNCTION, min, max); // cut at the space before the word, so the word starts the next piece
  if (conjunction >= 0) return conjunction;
  const space = text.lastIndexOf(" ", max);
  if (space >= min) return space;
  return max; // one huge word: cut it
}

/**
 * Split `text` into pieces of at most `max` characters (and, except the last, at least `min`), cutting at semicolons, colons and
 * dashes first, then commas, then before a conjunction, then at a space. A text already short enough comes back whole.
 *
 * Why: the speech engine makes a whole sentence in one call that cannot be interrupted, so cancelling one leaves the next line
 * waiting for the rest of it (measured: a 200 character sentence delayed the next line by 6 seconds). In pieces, a cancel lands
 * between them and costs one piece.
 */
export function splitLong(text, max = 70, min = 20) {
  const pieces = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = bestCut(rest, max, Math.min(min, max));
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Seconds of quiet to put after a piece, by how it ends: a natural pause at punctuation, a breath where the cut fell mid-sentence. */
export function gapAfter(piece) {
  const end = piece.trimEnd().slice(-1);
  if (";:—–".includes(end)) return 0.3;
  if (end === ",") return 0.25;
  if (".!?".includes(end)) return 0.4;
  return 0.05;
}

const SILENT = 0.005; // below this a sample is quiet (about -46 dB)

/**
 * Cut the quiet off the ends of a piece of speech, keeping `margin` seconds of it. Each call to the engine pads its audio with
 * quiet at both ends (about half a second together), which is fine at the ends of a line but sounds like a stumble when pieces of one
 * sentence are joined; the caller puts back the gap that suits the join. `leading` and `trailing` choose which ends to trim.
 */
export function trimSilence(samples, rate, margin = 0.03, { leading = true, trailing = true } = {}) {
  let first = 0;
  let last = samples.length - 1;
  while (first < samples.length && Math.abs(samples[first]) < SILENT) first++;
  if (first === samples.length) return samples.subarray(0, Math.min(samples.length, Math.round(rate * margin * 1.5))); // all quiet: keep a little
  while (last > first && Math.abs(samples[last]) < SILENT) last--;
  const m = Math.round(rate * margin);
  const from = leading ? Math.max(0, first - m) : 0;
  const to = trailing ? Math.min(samples.length, last + 1 + m) : samples.length;
  return samples.subarray(from, to);
}
