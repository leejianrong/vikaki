import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "@vikaki/server";
import { laneInk } from "./lane-ink.ts";
import { makeFixture } from "./phrase-fixture.ts";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

let server: RunningServer;
let browser: Browser;
beforeAll(async () => {
  server = await startServer({ staticDir });
  browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${await makeFixture()}`, "--autoplay-policy=no-user-gesture-required"],
  });
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("the timeline in mic mode", () => {
  it("records a phrase of the microphone with its audio and no words, and the dock draws and exports it", { timeout: 120_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.goto(`${server.url}?mode=mic&timeline=1&dock=1&hud=0&seed=3`);
    await page.waitForFunction(() => window.__vikaki?.mic === "listening" && window.__vikaki.timelineUi !== undefined, null, { timeout: 30_000 });
    // The fixture loops: a phrase of voice, then quiet. The page may start listening part-way through a phrase, so wait for two
    // phrases to end and judge the longer (a whole one).
    await page.waitForFunction(() => (window.__vikaki!.timeline as { events(): { kind: string }[] }).events().filter((e) => e.kind === "mic:finished").length >= 2, null, { timeout: 90_000 });

    const phrase = await page.evaluate(() => {
      const t = window.__vikaki!.timeline as { utterances(): { id: string; source?: string; startMs: number; endMs: number; pieces: unknown[]; audio: { samples: { length: number }; sampleRate: number }[] }[] };
      const u = t.utterances().filter((x) => x.id.startsWith("mic-")).sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))[0]!;
      return { id: u.id, source: u.source, pieces: u.pieces.length, extent: (u.endMs - u.startMs) / 1000, seconds: u.audio.reduce((s, a) => s + a.samples.length / a.sampleRate, 0), rate: u.audio[0]!.sampleRate };
    });
    expect(phrase.source).toBe("mic");
    expect(phrase.pieces).toBe(0); // the microphone has no text, so no words, sentences or karaoke
    expect(phrase.extent).toBeGreaterThan(1.5); // the fixture's phrase is 2 s of voice, with a little quiet around it
    expect(phrase.extent).toBeLessThan(4);
    // The audio is read from the analyser, whose window is 43 ms: a page that reads less often than that (software WebGL on CI's two
    // shared cores) leaves gaps rather than invented sound. So it is complete only where the page keeps up.
    expect(phrase.seconds).toBeGreaterThan(process.env.CI ? 0.4 : 1.5);
    expect(phrase.seconds).toBeLessThan(4);
    expect(phrase.rate).toBeLessThanOrEqual(16000);

    // the dock lists it and, reviewed, says so in words
    await page.evaluate((id) => window.__vikaki!.timelineUi!.select(id), phrase.id);
    await page.waitForFunction(() => document.querySelector(".dock-summary")?.textContent?.includes("from the microphone"), null, { timeout: 10_000 });
    expect(await page.locator(".dock-summary").innerText()).toMatch(/no words/);

    // the exported picture has the sound drawn in it (waveform and spectrum), the mouth, and the mic events, and no words
    const png = await page.evaluate(() => window.__vikaki!.timelineUi!.exportPng());
    expect((await laneInk(page, png, "wave")).ink, "the waveform lane has the voice in it").toBeGreaterThan(0.02);
    expect((await laneInk(page, png, "spec")).ink, "the spectrum lane has the voice in it").toBeGreaterThan(0.3);
    expect((await laneInk(page, png, "mouth")).ink, "the mouth lane shows the mouth moving").toBeGreaterThan(0.004);
    expect((await laneInk(page, png, "events")).ink, "the events lane has the phrase's start and end").toBeGreaterThan(0.001);
    expect((await laneInk(page, png, "words")).ink, "there are no words").toBeLessThan(0.002);

    // and the JSON carries the audio, so a scorecard could reuse it
    const json = JSON.parse(await page.evaluate(() => window.__vikaki!.timelineUi!.exportJson()));
    const u = json.utterances.find((x: { id: string }) => x.id === phrase.id);
    expect(u.source).toBe("mic");
    expect(u.pieces).toEqual([]);
    expect(u.audio[0].pcm.length).toBeGreaterThan(100);
    expect(json.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["mic:started", "mic:finished"]));
    await page.close();
  });

  it("without ?timeline=1 nothing is recorded, and without ?dock=1 there is no dock", { timeout: 60_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await page.goto(`${server.url}?mode=mic&hud=0&seed=3`);
    await page.waitForFunction(() => window.__vikaki?.mic === "listening", null, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__vikaki!.timeline)).toBeUndefined();
    expect(await page.locator("#timeline").count()).toBe(0);
    await page.close();
  });
});
