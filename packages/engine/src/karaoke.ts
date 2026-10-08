import { currentWord, pieceWords, type TimelineRecorder, type UtteranceTimeline } from "./timeline.ts";
import { el } from "./ui/dom.ts";

interface Slot {
  piece: number;
  word: number;
  node: HTMLElement;
  state: string;
}

const TICK_MS = 50;

/**
 * "Now speaking": the words of the latest spoken line, with a red dot on the one being said. Word times are estimated
 * from the audio (the voice model gives none), so the dot can be a little early or late. It follows the page's own
 * clock, the same one the timeline uses.
 */
export function mountKaraoke(rec: TimelineRecorder): HTMLElement {
  const line = el("p", { className: "karaoke body-large", role: "group", ariaLabel: "Words being spoken" });
  const empty = el("span", { className: "karaoke-empty", textContent: "Press Speak and the words will follow along here." });
  line.append(empty);
  const block = el(
    "section",
    { className: "karaoke-block" },
    el("h2", { className: "title-small", textContent: "Now speaking" }),
    line,
    el("p", { className: "body-small karaoke-note", textContent: "Word times are estimated from the audio." }),
  );

  let slots: Slot[] = [];
  let shown = "";

  const render = (u: UtteranceTimeline) => {
    slots = [];
    const nodes: (Node | string)[] = [];
    for (const p of u.pieces) {
      const timed = pieceWords(p);
      const words = timed.length > 0 ? timed.map((w) => w.word) : p.text.split(/\s+/).filter(Boolean);
      words.forEach((word, i) => {
        const node = el("span", { className: "w", textContent: word });
        slots.push({ piece: p.index, word: i, node, state: "" });
        nodes.push(node, " ");
      });
    }
    line.replaceChildren(...(nodes.length > 0 ? nodes : [empty]));
  };

  const tick = () => {
    const utterances = rec.utterances();
    const now = rec.now();
    const heard = currentWord(utterances, now);
    const u = (heard && rec.utterance(heard.utteranceId)) || utterances[utterances.length - 1];
    if (!u) return;
    const key = `${u.id}|${u.pieces.map((p) => `${p.index}:${p.text}:${p.words?.length ?? 0}`).join(",")}`;
    if (key !== shown) {
      shown = key;
      render(u);
    }
    const finished = now > u.endMs;
    for (const s of slots) {
      let state = "";
      if (finished) state = "done";
      else if (heard && heard.utteranceId === u.id) {
        if (s.piece < heard.pieceIndex || (s.piece === heard.pieceIndex && s.word < heard.wordIndex)) state = "done";
        else if (s.piece === heard.pieceIndex && s.word === heard.wordIndex) state = "now";
      }
      if (state !== s.state) {
        s.state = state;
        s.node.className = state ? `w ${state}` : "w";
      }
    }
  };
  setInterval(tick, TICK_MS);
  return block;
}
