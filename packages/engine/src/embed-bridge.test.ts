import { describe, expect, it } from "vitest";
import { EmbedBridge, parseParentOrigin } from "./embed-bridge.ts";

describe("parseParentOrigin", () => {
  it("takes a bare http(s) origin and nothing else", () => {
    expect(parseParentOrigin("http://127.0.0.1:8765")).toBe("http://127.0.0.1:8765");
    expect(parseParentOrigin("https://game.example")).toBe("https://game.example");
    for (const bad of [null, undefined, "", "*", "game.example", "https://game.example/", "https://game.example/play", "https://game.example?x=1", "https://game.example#x", "ftp://game.example", "javascript:alert(1)", "null", "http://", "https://a.example https://b.example"]) {
      expect(parseParentOrigin(bad), String(bad)).toBeUndefined();
    }
  });
});

function setup(o: { parentOrigin?: string; ancestorOrigin?: string; locked?: boolean | undefined; noParent?: boolean } = {}) {
  const posted: { message: unknown; to: string }[] = [];
  const parent = { postMessage: (message: unknown, to: string) => posted.push({ message, to }) };
  const state = { locked: "locked" in o ? o.locked : true, unlocks: 0 };
  const bridge = new EmbedBridge({
    parentOrigin: "parentOrigin" in o ? o.parentOrigin : "https://game.example",
    parent: o.noParent ? null : parent,
    ancestorOrigin: o.ancestorOrigin,
    onUnlock: () => state.unlocks++,
    isLocked: () => state.locked,
  });
  return { bridge, parent, posted, state };
}

describe("EmbedBridge", () => {
  it("posts audio_locked to the named origin only, once, and audio_unlocked when it changes", () => {
    const { bridge, posted, state } = setup();
    bridge.report();
    bridge.report();
    expect(posted).toEqual([{ message: { type: "audio_locked" }, to: "https://game.example" }]);
    state.locked = false;
    bridge.report();
    expect(posted.map((p) => (p.message as { type: string }).type)).toEqual(["audio_locked", "audio_unlocked"]);
    expect(posted.every((p) => p.to === "https://game.example")).toBe(true); // never "*"
  });

  it("says nothing while it does not know (no audio context yet)", () => {
    const { bridge, posted } = setup({ locked: undefined });
    bridge.report();
    expect(posted).toEqual([]);
  });

  it("is silent and deaf without a named origin, without a parent window, or when the browser names a different ancestor", () => {
    for (const o of [{ parentOrigin: undefined }, { noParent: true }, { ancestorOrigin: "https://evil.example" }]) {
      const { bridge, parent, posted, state } = setup(o);
      expect(bridge.active).toBe(false);
      bridge.report();
      bridge.report(true);
      expect(bridge.handle({ origin: "https://game.example", source: parent, data: { type: "unlock" } })).toBe(false);
      expect(posted, JSON.stringify(o)).toEqual([]);
      expect(state.unlocks).toBe(0);
    }
  });

  it("is active when the browser's ancestor agrees with ?parent=", () => {
    expect(setup({ ancestorOrigin: "https://game.example" }).bridge.active).toBe(true);
  });

  it("obeys `unlock` only from the parent window and from the named origin", () => {
    const { bridge, parent, state } = setup();
    const stranger = {};
    expect(bridge.handle({ origin: "https://game.example", source: stranger, data: { type: "unlock" } })).toBe(false); // right origin, wrong window
    expect(bridge.handle({ origin: "https://evil.example", source: parent, data: { type: "unlock" } })).toBe(false); // right window, wrong origin
    expect(bridge.handle({ origin: "null", source: parent, data: { type: "unlock" } })).toBe(false); // sandboxed
    expect(state.unlocks).toBe(0);
    expect(bridge.handle({ origin: "https://game.example", source: parent, data: { type: "unlock" } })).toBe(true);
    expect(state.unlocks).toBe(1);
  });

  it("ignores anything else a host sends, whatever its shape", () => {
    const { bridge, parent, state } = setup();
    for (const data of [undefined, null, 5, "unlock", {}, { type: 1 }, { type: "unlocked" }, { type: "UNLOCK" }, [], { kind: "unlock" }]) {
      expect(bridge.handle({ origin: "https://game.example", source: parent, data })).toBe(false);
    }
    expect(state.unlocks).toBe(0);
  });

  it("`audio_status` makes it say where it stands again, to the named origin", () => {
    const { bridge, parent, posted } = setup();
    bridge.report();
    expect(bridge.handle({ origin: "https://game.example", source: parent, data: { type: "audio_status" } })).toBe(true);
    expect(posted.map((p) => (p.message as { type: string }).type)).toEqual(["audio_locked", "audio_locked"]);
  });
});
