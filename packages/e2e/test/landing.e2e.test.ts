import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPersonas, startServer, type RunningServer } from "@vikaki/server";
import { FakeTts } from "@vikaki/tts";

// The landing page at / (VIK-117): every demo as a link, built from who the hub has.
const staticDir = fileURLToPath(new URL("../../engine/dist", import.meta.url));
const avatars = fileURLToPath(new URL("../../engine/public/avatars/", import.meta.url));

let browser: Browser;
let server: RunningServer | undefined;

beforeAll(async () => {
  browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const root = (s: RunningServer) => `http://127.0.0.1:${new URL(s.url).port}/`;

describe("the landing page", () => {
  it("lists the demos and the hub's characters as links, and the poker link opens the table", { timeout: 90_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-landing-e2e-"));
    await writeFile(join(dir, "personas.yaml"), `personas:\n  ada:\n    avatar: ${join(avatars, "cookieman.vrm")}\n  ben:\n    avatar: ${join(avatars, "snowy.vrm")}\n`);
    server = await startServer({ staticDir, personas: await loadPersonas(join(dir, "personas.yaml")), speech: { tts: new FakeTts() } });
    const page = await browser.newPage();
    await page.goto(root(server));
    await page.getByRole("heading", { name: "Vikaki", level: 1 }).waitFor({ timeout: 30_000 });
    const demos = page.getByRole("region", { name: "Demos" });
    expect(await demos.getByRole("link").count()).toBe(4);
    expect(await demos.getByRole("link", { name: /Poker table/ }).getAttribute("href")).toBe("/avatar?seats=2&view=table"); // two characters, two seats
    expect(await demos.getByRole("link", { name: /Say something/ }).getAttribute("href")).toBe("/avatar?demo=speech&live=1");
    const people = page.getByRole("region", { name: "Characters" });
    await people.getByRole("link", { name: "ada" }).waitFor();
    expect(await people.getByRole("link", { name: "ben" }).getAttribute("href")).toBe("/avatar?persona=ben&live=1");
    expect(await page.getByRole("region", { name: "Play poker" }).innerText()).toContain("make poker");
    await demos.getByRole("link", { name: /Poker table/ }).click();
    await page.waitForFunction(() => window.__vikaki?.ready === true, null, { timeout: 60_000 });
    expect(page.url()).toContain("/avatar?seats=2&view=table");
    await page.close();
  });

  it("works with no characters: three seats, and no characters section", { timeout: 60_000 }, async () => {
    server = await startServer({ staticDir, speech: { tts: new FakeTts() } });
    const page = await browser.newPage();
    await page.goto(root(server));
    await page.getByRole("heading", { name: "Vikaki", level: 1 }).waitFor({ timeout: 30_000 });
    expect(await page.getByRole("link", { name: /Poker table/ }).getAttribute("href")).toBe("/avatar?seats=3&view=table");
    expect(await page.getByRole("region", { name: "Characters" }).count()).toBe(0);
    await page.close();
  });
});
