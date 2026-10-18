import { describe, expect, it } from "vitest";
import { clampWidth, PANEL_MIN, panelMax, widthForKey } from "./panel-resize.ts";

describe("panel width", () => {
  it("stays between the minimum and most of the window, and never starves the table", () => {
    expect(clampWidth(100, 1600)).toBe(PANEL_MIN);
    expect(clampWidth(5000, 1600)).toBe(960);
    expect(clampWidth(5000, 1000)).toBe(700);
    expect(panelMax(300)).toBe(PANEL_MIN); // a tiny window still gets a usable panel
    expect(clampWidth(412.6, 1600)).toBe(413);
  });

  it("takes arrows (left widens: the handle is on the left edge), Shift for big steps, Home and End for the extremes", () => {
    expect(widthForKey("ArrowLeft", false, 340, 1600)).toBe(360);
    expect(widthForKey("ArrowRight", false, 340, 1600)).toBe(320);
    expect(widthForKey("ArrowLeft", true, 340, 1600)).toBe(420);
    expect(widthForKey("ArrowRight", false, PANEL_MIN, 1600)).toBe(PANEL_MIN);
    expect(widthForKey("Home", false, 500, 1600)).toBe(PANEL_MIN);
    expect(widthForKey("End", false, 500, 1600)).toBe(960);
    expect(widthForKey("a", false, 500, 1600)).toBeUndefined();
  });
});
