import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { make } from "@vikaki/protocol";
import { startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));

/** See speech.e2e.test.ts: millisecond budgets are enforced on a normal machine, not on CI's 2 shared cores. */
const STRICT_TIMING = !process.env.CI;

let browser: Browser;
let server: RunningServer | undefined;
const pages: Page[] = [];
const sockets: WebSocket[] = [];

beforeAll(async () => {
  browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.terminate());
  await Promise.all(pages.splice(0).map((p) => p.close().catch(() => {})));
  await server?.close();
  server = undefined;
});

async function open(opts: { speech?: boolean; msPerChar?: number } = {}): Promise<Page> {
  server = await startServer({
    staticDir,
    speech: opts.speech === false ? undefined : { tts: new FakeTts({ sampleRate: 16000, msPerChar: opts.msPerChar ?? 50, chunkMs: 100 }) },
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
  pages.push(page);
  await page.goto(`${server.url}?demo=speech&live=1&seed=3`);
  await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
  return page;
}

/** Wait until the Speak button can be pressed: the driver is connected and a voice is available. */
const speakReady = (page: Page) => expect.poll(() => page.getByRole("button", { name: "Speak", exact: true }).isEnabled(), { timeout: 20_000 }).toBe(true);
const sayBox = (page: Page) => page.getByRole("textbox", { name: "What the avatar should say" });
const log = (page: Page) => page.locator("#log").innerText();
const logHas = (page: Page, text: string, ms = 15_000) =>
  page.waitForFunction((t) => document.getElementById("log")!.innerText.includes(t), text, { timeout: ms });
const stat = (page: Page, label: string) => page.locator(".tile", { hasText: label }).locator("b").innerText();
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

describe("speech demo", () => {
  it("shows that the driver is connected, says plainly that the voice is a test tone, and that sound is on", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const page = await open();
    await page.waitForFunction(() => document.querySelector(".chip.ok")?.textContent === "driver: connected", null, { timeout: 15_000 });
    // The fake voice must be called out loudly, in plain words, with the fix.
    const banner = page.locator(".voice-banner");
    await expect.poll(() => banner.innerText(), { timeout: 15_000 }).toContain("test tone, not speech");
    expect(await banner.innerText()).toContain("make install-voice");
    expect(await banner.getAttribute("class")).toContain("warn");
    await page.waitForFunction(() => [...document.querySelectorAll(".chip")].some((c) => c.textContent === "sound: on"), null, { timeout: 15_000 });
  });

  it("speaks the typed text, logs what the hub reports, and measures it", async () => {
    const page = await open();
    await speakReady(page);
    await sayBox(page).fill("x".repeat(40)); // 2 s
    await button(page, "Speak").click();
    await logHas(page, "speech started");
    await logHas(page, "speech finished");
    const text = await log(page);
    expect(text).toContain("sent");
    expect(text.indexOf("speech started")).toBeLessThan(text.indexOf("speech finished"));
    expect(await stat(page, "to first sound")).toMatch(/ms$|s$/);
    const length = await stat(page, "speech length");
    expect(parseFloat(length)).toBeGreaterThan(1.5);
    if (STRICT_TIMING) expect(parseFloat(length)).toBeLessThan(3.5);
  }, 60_000);

  it("moves the avatar's mouth while it speaks", async () => {
    const page = await open();
    await speakReady(page);
    await sayBox(page).fill("x".repeat(40));
    const peak = page.evaluate(async () => {
      let max = 0;
      const end = performance.now() + 4000;
      while (performance.now() < end) {
        max = Math.max(max, ...Object.values(window.__vikaki!.visemes), 0);
        await new Promise((r) => setTimeout(r, 30));
      }
      return max;
    });
    await button(page, "Speak").click();
    expect(await peak).toBeGreaterThan(0.3);
  }, 60_000);

  it("cancels mid-speech, shows the interruption, and measures how fast it stopped", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const page = await open();
    await speakReady(page);
    await button(page, "Long story").click();
    await button(page, "Speak").click();
    await logHas(page, "speech started");
    await page.waitForTimeout(500);
    expect(await button(page, "Cancel").isEnabled()).toBe(true);
    await button(page, "Cancel").click();
    await logHas(page, "speech interrupted", 3000);
    const text = await log(page);
    expect(text).not.toContain("speech finished");
    const stopped = await stat(page, "cancel to stop");
    if (STRICT_TIMING) {
      expect(parseFloat(stopped)).toBeLessThan(400);
      expect(stopped).toMatch(/ms$/);
    }
    expect(stopped).not.toBe("-"); // it was measured at all
    expect(await button(page, "Cancel").isDisabled()).toBe(true);
  });

  it("sends a streamed line word by word, and starts speaking before the end of it is sent", async () => {
    const page = await open({ msPerChar: 10 }); // speaks fast, so the time is dominated by the 5 words a second sent
    await speakReady(page);
    await sayBox(page).fill("This is the first sentence of a streamed line. And here are a good many more words coming afterwards, one at a time, like a model.");
    const clicked = Date.now();
    await button(page, "Speak word by word").click();
    await logHas(page, "speech started");
    const startedAfter = Date.now() - clicked;
    if (STRICT_TIMING) expect(startedAfter).toBeLessThan(3200); // the 24 words take about 4.8 s to send at 5 a second
    await logHas(page, "speech finished", 25_000);
    const finishedAfter = Date.now() - clicked;
    expect(finishedAfter).toBeGreaterThan(4400); // it cannot end before the last word has been sent
    expect(await log(page)).toContain("(word by word)");
  }, 90_000);

  it("fills the text box from a preset", async () => {
    const page = await open();
    await button(page, "Poker").click();
    expect(await page.evaluate(() => (document.getElementById("say-text") as unknown as { value: string }).value)).toContain("bluffing");
  }, 60_000);

  it("says plainly when another program is already driving (after trying a few times, in case it is just a reload), and does not let you speak", async () => {
    server = await startServer({ staticDir, speech: { tts: new FakeTts() } });
    const other = new WebSocket(server.wsUrl);
    sockets.push(other);
    await new Promise((ok) => other.once("open", ok));
    other.send(JSON.stringify(make("hello", { role: "driver" })));
    await new Promise((r) => setTimeout(r, 150));
    const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
    pages.push(page);
    await page.goto(`${server.url}?demo=speech&live=1`);
    await page.waitForFunction(() => document.querySelector(".chip.bad")?.textContent?.includes("already driving"), null, { timeout: 30_000 });
    expect(await page.locator(".voice-banner").innerText()).toContain("Another program is driving");
    expect(await button(page, "Speak").isDisabled()).toBe(true);
    expect(await log(page)).toContain("Another program is already the driver");
  }, 60_000);

  it("connects once the other driver goes away, as after a quick reload, instead of giving up at once", async () => {
    server = await startServer({ staticDir, speech: { tts: new FakeTts() } });
    const old = new WebSocket(server.wsUrl);
    sockets.push(old);
    await new Promise((ok) => old.once("open", ok));
    old.send(JSON.stringify(make("hello", { role: "driver" })));
    await new Promise((r) => setTimeout(r, 150));
    const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
    pages.push(page);
    await page.goto(`${server.url}?demo=speech&live=1`);
    await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 30_000 });
    await page.waitForTimeout(1200); // the page has been refused at least once by now
    old.terminate(); // the stale connection finally goes
    await page.waitForFunction(() => document.querySelector(".chip.ok")?.textContent === "driver: connected", null, { timeout: 15_000 });
    expect(await page.locator(".voice-banner").innerText()).toContain("test tone");
    expect(await button(page, "Speak").isEnabled()).toBe(true);
  }, 90_000);

  it("says so when the hub has no speech engine", async () => {
    const page = await open({ speech: false });
    await expect.poll(() => page.locator(".voice-banner").innerText(), { timeout: 15_000 }).toContain("Speech is off");
    expect(await page.locator(".voice-banner").getAttribute("class")).toContain("bad");
    expect(await button(page, "Speak").isDisabled()).toBe(true); // nothing to speak with
  }, 60_000);
});

/** Fraction of pixels in a lane of the exported picture that differ from the lane's own background. */
const laneInk = (page: Page, png: string, lane: string) =>
  page.evaluate(
    async ([url, id]) => {
      const layout = window.__vikaki!.timelineUi!.exportLayout();
      const img = new Image();
      img.src = url as string;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const l = layout.lanes.find((x) => x.id === id)!;
      const w = layout.width - layout.gutter;
      const px = g.getImageData(layout.gutter, l.top, w, l.height).data;
      const role = (name: string) => {
        const hex = getComputedStyle(document.documentElement).getPropertyValue(`--md-sys-color-${name}`).trim();
        return [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      };
      const empty = [role("surface-container"), role("outline-variant")]; // a lane's background and the time gridlines
      let ink = 0;
      for (let i = 0; i < px.length; i += 4) {
        const near = empty.some((c) => Math.abs(px[i]! - c[0]!) + Math.abs(px[i + 1]! - c[1]!) + Math.abs(px[i + 2]! - c[2]!) <= 40);
        if (!near) ink++;
      }
      return { ink: ink / (px.length / 4), size: [img.width, img.height] };
    },
    [png, lane] as const,
  );

/** How many pixels of a lane in the exported picture are close to a Material colour role (for example the sentence text). */
const laneRolePixels = (page: Page, png: string, lane: string, roleName: string) =>
  page.evaluate(
    async ([url, id, name]) => {
      const layout = window.__vikaki!.timelineUi!.exportLayout();
      const img = new Image();
      img.src = url as string;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const l = layout.lanes.find((x) => x.id === id)!;
      const px = g.getImageData(layout.gutter, l.top, layout.width - layout.gutter, l.height).data;
      const hex = getComputedStyle(document.documentElement).getPropertyValue(`--md-sys-color-${name}`).trim();
      const want = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i]! - want[0]!) + Math.abs(px[i + 1]! - want[1]!) + Math.abs(px[i + 2]! - want[2]!) <= 60) n++;
      return n;
    },
    [png, lane, roleName] as const,
  );

describe("karaoke: the words follow along with a red dot", () => {
  const LINE = "Good morning everyone. Shall we begin today?";
  const WORDS = ["Good", "morning", "everyone.", "Shall", "we", "begin", "today?"];

  async function speakWatching(page: Page) {
    await speakReady(page);
    await sayBox(page).fill(LINE);
    // note every time a word gets the dot (an observer, not frame sampling, so a slow renderer cannot make it miss one)
    await page.evaluate(() => {
      const w = window as unknown as { __k: [number, string | null, number][]; __obs?: MutationObserver };
      w.__k = [];
      w.__obs?.disconnect();
      w.__obs = new MutationObserver(() => {
        const now = document.querySelectorAll(".karaoke .w.now");
        w.__k.push([(window.__vikaki!.timeline as { now(): number }).now(), now[0]?.textContent ?? null, now.length]);
      });
      w.__obs.observe(document.querySelector(".karaoke")!, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
      // Every time the page went without running a timer for a while, on the timeline's clock: software WebGL can freeze it for
      // most of a second at the first speech, and a word that passes during a freeze cannot get the dot on time.
      const g = window as unknown as { __freezes: [number, number][]; __gapTimer?: number };
      g.__freezes = [];
      clearInterval(g.__gapTimer);
      let last = performance.now();
      g.__gapTimer = window.setInterval(() => {
        const n = performance.now();
        if (n - last > 60) g.__freezes.push([(window.__vikaki!.timeline as { now(): number }).now(), n - last]);
        last = n;
      }, 20);
    });
    await button(page, "Speak").click();
    await logHas(page, "speech finished", 30_000);
    await expect.poll(() => page.locator(".karaoke .w.done").count(), { timeout: 10_000 }).toBe(WORDS.length); // the last word has been seen finishing
    return page.evaluate(() => (window as unknown as { __k: [number, string | null, number][] }).__k);
  }

  it("puts the dot on each word in turn, in order, never on two at once, and on the word being heard", { tags: ["smoke"], timeout: 90_000 }, async () => {
    const page = await open();
    const samples = await speakWatching(page);
    const json = JSON.parse(await page.evaluate(() => (window.__vikaki!.timelineUi!.select("demo-1"), window.__vikaki!.timelineUi!.exportJson()))) as { utterances: { pieces: { words?: { word: string; startMs: number }[] }[] }[] };
    const timed = json.utterances[0]!.pieces.flatMap((p) => p.words ?? []);
    expect(timed.map((w) => w.word)).toEqual(WORDS); // every word was timed

    const shown = samples.map((x) => x[1]).filter((w): w is string => w !== null);
    const order = shown.filter((w, i) => w !== shown[i - 1]);
    // Each word got the dot once, in the order spoken. On a normal machine none is missed; on CI's two shared cores the
    // page can tick late enough for a 150 ms word to pass between two ticks, so there it may skip some but never go out of order.
    const positions = order.map((w) => WORDS.indexOf(w));
    expect(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]!)), `visited: ${order.join(" ")}`).toBe(true);
    // A word may only go without the dot if the page was frozen while it passed (software WebGL freezes it for most of a second
    // at the first speech); a miss with the page running is the karaoke's fault.
    const freezes = await page.evaluate(() => (window as unknown as { __freezes: [number, number][] }).__freezes);
    if (STRICT_TIMING) {
      timed.forEach((w, i) => {
        if (order.includes(w.word)) return;
        const from = w.startMs;
        const to = timed[i + 1]?.startMs ?? from + 150;
        expect(freezes.some(([endMs, lengthMs]) => endMs - lengthMs < to && endMs > from), `"${w.word}" never got the dot and the page was not frozen over it (freezes: ${JSON.stringify(freezes)})`).toBe(true);
      });
    } else expect(order.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...samples.map((x) => x[2]))).toBe(1); // and never two at once

    // the dot is on the word the recorder says is being heard (allowing for the 50 ms tick and a frame)
    const wordAt = (t: number) => [...timed].reverse().find((w) => w.startMs <= t)?.word;
    const slack = process.env.CI ? 300 : 150;
    for (const [t, word] of samples) if (word !== null) expect([wordAt(t), wordAt(t - slack)], `at ${Math.round(t)} ms`).toContain(word);
  });

  it("marks every word as done afterwards, with no dot left", async () => {
    const page = await open();
    await speakWatching(page);
    await expect.poll(() => page.locator(".karaoke .w.done").count()).toBe(WORDS.length);
    expect(await page.locator(".karaoke .w.now").count()).toBe(0);
    expect(await page.locator(".karaoke").innerText()).toBe(LINE);
  }, 90_000);

  it("shows the words in the timeline too, one pill each, in the exported picture", async () => {
    const page = await open();
    await speakWatching(page);
    await page.evaluate(() => window.__vikaki!.timelineUi!.select("demo-1"));
    const png = await page.evaluate(() => window.__vikaki!.timelineUi!.exportPng());
    const pills = await page.evaluate(
      async ([url]) => {
        const layout = window.__vikaki!.timelineUi!.exportLayout();
        const img = new Image();
        img.src = url as string;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const lane = layout.lanes.find((l) => l.id === "words")!;
        const row = g.getImageData(layout.gutter, lane.top + 4, layout.width - layout.gutter, 1).data; // near the top edge of the pills, above the text
        const hex = getComputedStyle(document.documentElement).getPropertyValue("--md-sys-color-secondary-container").trim();
        const want = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
        let runs = 0;
        let inside = false;
        for (let i = 0; i < row.length; i += 4) {
          const near = Math.abs(row[i]! - want[0]!) + Math.abs(row[i + 1]! - want[1]!) + Math.abs(row[i + 2]! - want[2]!) <= 12;
          if (near && !inside) runs++;
          inside = near;
        }
        return runs;
      },
      [png] as const,
    );
    expect(pills).toBeGreaterThanOrEqual(WORDS.length); // one pill per word (a sentence pill alone would give 2)
  }, 90_000);
});

describe("reloading the page", () => {
  it("still hears the avatar report back when the same demo ids come round again", async () => {
    const page = await open();
    await speakReady(page);
    await sayBox(page).fill("x".repeat(10));
    await button(page, "Speak").click();
    await logHas(page, "speech finished");
    await page.reload(); // a fresh page counts its utterances from demo-1 again
    await speakReady(page);
    await sayBox(page).fill("x".repeat(10));
    await button(page, "Speak").click();
    await logHas(page, "speech started");
    await logHas(page, "speech finished");
  }, 60_000);
});

describe("the timeline dock", () => {
  const speakAndWait = async (page: Page, text = "Hello there. How are you?") => {
    await speakReady(page);
    await sayBox(page).fill(text);
    await button(page, "Speak").click();
    await logHas(page, "speech finished", 30_000);
  };

  it("lists a spoken line, shows it in review, and draws every lane in the exported picture", { tags: ["smoke"], timeout: 90_000 }, async () => {
    const page = await open();
    await speakAndWait(page);
    await page.waitForFunction(() => window.__vikaki!.timelineUi !== undefined);
    expect(await page.evaluate(() => window.__vikaki!.timelineUi!.mode())).toBe("live");
    // the entry's length is its final length, not what had been scheduled when it first appeared
    const optionText = await page.evaluate(() => [...document.querySelectorAll("#timeline md-select-option")].map((o) => o.textContent ?? "").join("|"));
    const listed = Number(/demo-1 · .* · ([\d.]+) s/.exec(optionText)?.[1]);
    const exported = JSON.parse(await page.evaluate(() => (window.__vikaki!.timelineUi!.select("demo-1"), window.__vikaki!.timelineUi!.exportJson()))).utterances[0];
    expect(Math.abs(listed - (exported.endMs - exported.startMs) / 1000)).toBeLessThan(0.06);
    await page.evaluate(() => window.__vikaki!.timelineUi!.select("live"));
    // choose it from the selector, like a person would
    await page.getByRole("combobox", { name: "Show" }).click();
    await page.getByRole("option", { name: /demo-1/ }).click();
    await expect.poll(() => page.evaluate(() => window.__vikaki!.timelineUi!.mode())).toBe("demo-1");
    await expect.poll(() => page.locator(".dock-summary").innerText()).toMatch(/Utterance demo-1: 2 sentences, [\d.]+ seconds\. The mouth opened to at most 1\.00/);

    const png = await page.evaluate(() => window.__vikaki!.timelineUi!.exportPng());
    expect(png.startsWith("data:image/png;base64,")).toBe(true);
    for (const [lane, least] of [["words", 0.15], ["wave", 0.02], ["spec", 0.3], ["mouth", 0.008], ["events", 0.003]] as const) {
      const r = await laneInk(page, png, lane);
      expect(r.size).toEqual([1600, 420]);
      expect(r.ink, `the ${lane} lane has something drawn in it`).toBeGreaterThan(least);
    }
    expect(await laneRolePixels(page, png, "words", "on-secondary-container"), "the sentences' text is drawn").toBeGreaterThan(40);
  });

  it("an empty review has nothing in the speech lanes, so the picture really depends on the data", async () => {
    const page = await open();
    await page.waitForFunction(() => window.__vikaki!.timelineUi !== undefined);
    const png = await page.evaluate(() => window.__vikaki!.timelineUi!.exportPng());
    for (const lane of ["words", "wave", "spec", "mouth"]) expect((await laneInk(page, png, lane)).ink).toBeLessThan(0.002);
  });

  it("exports the same view as JSON, with the audio when reviewing an utterance", async () => {
    const page = await open();
    await speakAndWait(page);
    await page.evaluate(() => window.__vikaki!.timelineUi!.select("demo-1"));
    const json = JSON.parse(await page.evaluate(() => window.__vikaki!.timelineUi!.exportJson()));
    expect(json.utterances).toHaveLength(1);
    expect(json.utterances[0].pieces.map((p: { text: string }) => p.text)).toEqual(["Hello there.", "How are you?"]);
    expect(json.utterances[0].audio[0].pcm.length).toBeGreaterThan(100);
    expect(json.frames.length).toBeGreaterThan(10);
    expect(json.events.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(["sent", "started", "finished", "driver:started", "driver:finished"]));
    await page.evaluate(() => window.__vikaki!.timelineUi!.select("live"));
    expect(JSON.parse(await page.evaluate(() => window.__vikaki!.timelineUi!.exportJson())).utterances[0].audio[0].pcm).toBeUndefined();
  });

  it("sits under the avatar without covering it or the side sheet, and the canvas has no inline size", { tags: ["smoke"], timeout: 60_000 }, async () => {
    const page = await open();
    await page.waitForSelector("#timeline canvas");
    const box = (sel: string) => page.locator(sel).first().boundingBox();
    const [avatar, dock, side] = [await box("body > canvas"), await box("#timeline"), await box("#speech")];
    expect(dock!.y).toBeGreaterThanOrEqual(avatar!.y + avatar!.height - 1); // below the avatar
    expect(dock!.x + dock!.width).toBeLessThanOrEqual(side!.x + 1); // beside the side sheet, not under it
    expect(avatar!.height).toBeGreaterThan(250); // the avatar keeps a usable height
    expect(await page.locator("#timeline canvas").getAttribute("style")).toBeNull();
    expect(await page.locator("body > canvas").getAttribute("style")).toBeNull();
  });

  it("can be hidden and shown again", async () => {
    const page = await open();
    await page.waitForSelector("#timeline canvas");
    const before = (await page.locator("#timeline").boundingBox())!.height;
    await button(page, "Hide").click();
    await expect.poll(async () => (await page.locator("#timeline").boundingBox())!.height).toBeLessThan(before / 2);
    await button(page, "Show").click();
    await expect.poll(async () => (await page.locator("#timeline").boundingBox())!.height).toBeGreaterThan(before - 5);
  });
});
