import { describe, expect, it } from "vitest";
import { Director, TIMES, type Cue } from "./director.ts";

/** Play a script of [time, cue] pairs and ticks every 100 ms between them; the list of [time, shot] cuts the director made. */
function run(script: [number, Cue][], until: number, d = new Director()): [number, string][] {
  const cuts: [number, string][] = [];
  const queue = [...script].sort((a, b) => a[0] - b[0]);
  for (let t = 0; t <= until + 1e-9; t = Math.round((t + 0.1) * 10) / 10) {
    while (queue.length && queue[0]![0] <= t + 1e-9) {
      const [, cue] = queue.shift()!;
      const shot = d.cue(cue, t);
      if (shot) cuts.push([t, shot]);
    }
    const shot = d.tick(t);
    if (shot) cuts.push([t, shot]);
  }
  return cuts;
}

describe("Director", () => {
  it("cuts a scripted hand into the expected shots: new hand, speaker, back to wide, board on the flop, the winner", () => {
    const cuts = run(
      [
        [0, { kind: "new_hand" }],
        [2, { kind: "speak", seat: 0 }],
        [5, { kind: "line_end", seat: 0 }],
        [9, { kind: "street" }],
        [14, { kind: "showdown" }],
        [18, { kind: "win", seat: 1 }],
      ],
      30,
    );
    expect(cuts).toEqual([
      [2, "seat:0"], // a line begins: its speaker
      [6.5, "wide"], // 1.5 s after it ends, back to the table
      [9, "board"],
      [12, "wide"], // the board shot is held 3 s, then back to the table (so the showdown at 14 finds it already wide)
      [18, "seat:1"], // the winner
      [22, "wide"], // held 4 s, then, with nothing said, back to wide
    ]);
  });

  it("holds a shot for its minimum length: a second speaker half a second later waits until the first has had 2.5 seconds", () => {
    const cuts = run([[1, { kind: "speak", seat: 0 }], [1.5, { kind: "line_end", seat: 0 }], [1.6, { kind: "speak", seat: 2 }]], 8);
    expect(cuts[0]).toEqual([1, "seat:0"]);
    expect(cuts[1]).toEqual([3.5, "seat:2"]); // 2.5 s after the first cut, not at 1.6
  });

  it("lets a more important moment cut sooner than a lesser one, after the short minimum", () => {
    const cuts = run([[1, { kind: "speak", seat: 0 }], [1.5, { kind: "street" }]], 6);
    expect(cuts).toContainEqual([2.2, "board"]); // 1.2 s after the first cut, though the speaker's hold is 2.5
  });

  it("drops a cut that could not be made in time", () => {
    const d = new Director();
    d.cue({ kind: "win", seat: 1 }, 0); // held 4 s
    d.cue({ kind: "speak", seat: 2 }, 0.5); // lesser: waits
    expect(d.tick(2)).toBeUndefined();
    expect(d.tick(3.6)).toBeUndefined(); // stale after 3 s (0.5 + 3), gone before the hold ends at 4
    d.cue({ kind: "line_end", seat: 2 }, 3.7);
    expect(d.shot).toBe("seat:1");
  });

  it("stays out of the way when switched off or after a manual choice, and comes back after the quiet time", () => {
    const d = new Director();
    d.enabled = false;
    expect(d.cue({ kind: "street" }, 0)).toBeUndefined();
    d.enabled = true;
    d.override("overhead", 10);
    expect(d.cue({ kind: "speak", seat: 0 }, 11)).toBeUndefined();
    expect(d.shot).toBe("overhead");
    expect(d.cue({ kind: "street" }, 10 + TIMES.override + 1)).toBe("board");
  });

  it("can cut to the POV grid at the showdown", () => {
    const d = new Director(undefined, "grid");
    expect(d.cue({ kind: "showdown" }, 0)).toBe("grid");
  });

  it("ignores a small move but follows a big one", () => {
    const d = new Director();
    expect(d.cue({ kind: "action", seat: 1, big: false }, 0)).toBeUndefined();
    expect(d.cue({ kind: "action", seat: 1, big: true }, 1)).toBe("seat:1");
  });
});
