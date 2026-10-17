import { describe, expect, it } from "vitest";
import { avatarSpan, DUET_BAND, DUET_MIN_COLUMN, duetFrame, type DuetFrame, type DuetInput } from "./duet.ts";

const fov = 28;
/** A bust 0.6 m wide that widens to 1.4 m below 1.1 m (arms and a base): what is in view decides the width. */
const widens = (lo: number) => (lo < 1.1 ? 1.4 : 0.6);
const at = (width: number, height: number, widthIn: DuetInput["widthIn"] = () => 0.6): DuetInput => ({ fov, top: 1.65, bottom: 0.95, floor: 0, width, height, widthIn });
const pp = (f: DuetFrame, o: DuetInput) => (2 * Math.tan((fov * Math.PI) / 360) * f.distance) / o.height;
/** World height at a canvas row: the camera looks straight ahead at `f.y`. */
const worldAt = (f: DuetFrame, o: DuetInput, row: number) => f.y + (o.height / 2 - row) * pp(f, o);
/** The width an avatar has over what is in view above `to` (the band's top edge when stacked). */
const seen = (f: DuetFrame, o: DuetInput, to: number) => o.widthIn(worldAt(f, o, to), Math.max(worldAt(f, o, 0), o.top));

describe("duetFrame", () => {
  for (const [name, widthIn] of [["a plain bust", () => 0.6], ["a bust that widens below", widens]] as const) {
    it(`beside the band on a wide canvas: ${name} stays out of the band and inside the canvas`, () => {
      for (const [w, h] of [[960, 540], [1280, 720], [1920, 1080], [800, 900], [1600, 500]] as const) {
        const o = at(w, h, widthIn);
        const f = duetFrame(o);
        expect(f.stacked, `${w}x${h}`).toBe(false);
        const width = seen(f, o, h);
        const [lo, li] = avatarSpan(f, -1, o, width);
        const [ri, ro] = avatarSpan(f, 1, o, width);
        expect(li, `${w}x${h} left avatar's inner edge`).toBeLessThanOrEqual(f.band.left);
        expect(ri, `${w}x${h} right avatar's inner edge`).toBeGreaterThanOrEqual(f.band.left + f.band.width);
        expect(lo, `${w}x${h} left outer edge`).toBeGreaterThanOrEqual(-1);
        expect(ro, `${w}x${h} right outer edge`).toBeLessThanOrEqual(w + 1);
        expect(f.band.width).toBe(DUET_BAND);
        expect(f.band.left + f.band.width / 2).toBeCloseTo(w / 2, 5); // centred
        expect(f.band.height).toBe(h);
      }
    });
  }

  it("on a wide canvas the whole slice is on screen, whatever the shape", () => {
    for (const [w, h] of [[960, 540], [1280, 720], [1600, 500], [900, 1200]] as const) {
      const o = at(w, h);
      const f = duetFrame(o);
      expect(worldAt(f, o, 0), `${w}x${h} top`).toBeGreaterThanOrEqual(o.top);
      expect(worldAt(f, o, h), `${w}x${h} bottom`).toBeLessThanOrEqual(o.bottom);
    }
  });

  it("when the whole body fits, the feet stand on the bottom edge of the avatars' area (the band's top edge when stacked)", () => {
    const stacked = { ...at(390, 844), floor: 0.8 }; // the body ends 15 cm below the slice
    const fs = duetFrame(stacked);
    expect(worldAt(fs, stacked, fs.band.top)).toBeCloseTo(stacked.floor, 5);
    const wide = { ...at(1920, 1400), floor: 0.8 };
    const fw = duetFrame(wide);
    expect(worldAt(fw, wide, wide.height)).toBeCloseTo(wide.floor, 5);
  });

  it("stacks the avatars above a full-width band when the columns beside the band would be too narrow", () => {
    const narrowest = DUET_BAND + 32 + 2 * DUET_MIN_COLUMN; // 772
    expect(duetFrame(at(narrowest, 600)).stacked).toBe(false);
    expect(duetFrame(at(narrowest - 2, 600)).stacked).toBe(true);
    for (const [w, h] of [[390, 844], [360, 640], [768, 1000], [500, 800]] as const) {
      for (const widthIn of [() => 0.6, widens]) {
        const o = at(w, h, widthIn);
        const f = duetFrame(o);
        expect(f.stacked, `${w}x${h}`).toBe(true);
        expect(f.band.left).toBe(0);
        expect(f.band.width).toBe(w); // full width
        expect(f.band.top + f.band.height).toBeCloseTo(h, 5); // the band is the bottom of the canvas
        expect(f.band.height).toBeGreaterThanOrEqual(Math.min(w / 2, 0.6 * h)); // room for a half-circle dial
        // the avatars fit above the band, side by side, and the heads are in view
        const width = seen(f, o, f.band.top);
        const [l0, l1] = avatarSpan(f, -1, o, width);
        const [r0, r1] = avatarSpan(f, 1, o, width);
        expect(l0, `${w}x${h}`).toBeGreaterThanOrEqual(-1);
        expect(r1, `${w}x${h}`).toBeLessThanOrEqual(w + 1);
        expect(l1, `${w}x${h}`).toBeLessThanOrEqual(r0);
        expect(worldAt(f, o, 0), `${w}x${h} top in view`).toBeGreaterThanOrEqual(o.top);
        expect(worldAt(f, o, f.band.top), `${w}x${h} the bust ends above the band`).toBeLessThanOrEqual(o.bottom + 1e-9);
      }
    }
  });
});
