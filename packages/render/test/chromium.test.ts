import { describe, expect, it } from "vitest";
import { INSTALL_RENDERER_COMMAND, locateChromium, type ChromiumEnv } from "../src/chromium.ts";

const env = (over: Partial<ChromiumEnv> = {}): ChromiumEnv => ({
  env: {},
  exists: () => false,
  playwrightPath: async () => undefined,
  ...over,
});

describe("locateChromium", () => {
  it("uses VIKAKI_CHROME when it points at a file that exists", async () => {
    const r = await locateChromium(env({ env: { VIKAKI_CHROME: "/opt/chrome/chrome" }, exists: (p) => p === "/opt/chrome/chrome", playwrightPath: async () => "/pw/chrome" }));
    expect(r).toEqual({ ok: true, path: "/opt/chrome/chrome", source: "VIKAKI_CHROME" });
  });

  it("says so, and does not quietly fall back, when VIKAKI_CHROME points at nothing", async () => {
    const r = await locateChromium(env({ env: { VIKAKI_CHROME: "/nope" }, playwrightPath: async () => "/pw/chrome", exists: (p) => p === "/pw/chrome" }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { problem: string }).problem).toMatch(/VIKAKI_CHROME.*\/nope/);
  });

  it("falls back to the browser Playwright installed", async () => {
    const r = await locateChromium(env({ playwrightPath: async () => "/pw/chrome", exists: (p) => p === "/pw/chrome" }));
    expect(r).toEqual({ ok: true, path: "/pw/chrome", source: "playwright" });
  });

  it("tells a person how to install it when Playwright knows a path but the browser is not there", async () => {
    const r = await locateChromium(env({ playwrightPath: async () => "/pw/chrome" }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { fix: string }).fix).toContain(INSTALL_RENDERER_COMMAND);
  });

  it("tells a person how to get Playwright when it is not installed at all", async () => {
    const r = await locateChromium(env());
    expect(r).toMatchObject({ ok: false });
    expect((r as { problem: string }).problem).toMatch(/playwright/i);
    expect((r as { fix: string }).fix).toContain(INSTALL_RENDERER_COMMAND);
  });
});

describe("HeadlessRenderer.launch without a browser", () => {
  it("refuses with the problem and the fix, before starting anything", async () => {
    const { HeadlessRenderer, RendererUnavailable } = await import("../src/renderer.ts");
    const attempt = HeadlessRenderer.launch({ pageUrl: "http://127.0.0.1:1/avatar", chromium: env() });
    await expect(attempt).rejects.toBeInstanceOf(RendererUnavailable);
    await expect(attempt).rejects.toThrow(/make install-renderer/);
  });
});
