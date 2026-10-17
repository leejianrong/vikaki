import { describe, expect, it } from "vitest";
import { parseEmbed } from "./embed.ts";

const q = (s: string) => parseEmbed(new URLSearchParams(s));

describe("parseEmbed", () => {
  it("is off without ?embed=1, and then changes nothing: names, captions and the HUD stay on", () => {
    expect(q("")).toEqual({ embed: false, names: true, captions: true, hud: true });
    expect(q("embed=0&seats=2")).toMatchObject({ embed: false, names: true, captions: true, hud: true });
    expect(q("hud=0")).toMatchObject({ embed: false, hud: false });
  });

  it("embed mode hides the HUD, plates and captions unless asked for", () => {
    expect(q("embed=1")).toEqual({ embed: true, names: false, captions: false, hud: false });
    expect(q("embed=1&names=1&captions=1&hud=1")).toEqual({ embed: true, names: true, captions: true, hud: true });
    expect(q("embed=1&names=1")).toMatchObject({ names: true, captions: false });
  });
});
