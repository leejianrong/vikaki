import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/server.ts";

let dir: string;
let server: RunningServer | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vikaki-landing-"));
  await writeFile(join(dir, "index.html"), "the avatar");
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("the landing page at / (VIK-117)", () => {
  it("serves the built home page at the root, so no URL has to be remembered", async () => {
    await writeFile(join(dir, "home.html"), "<title>home</title>");
    server = await startServer({ staticDir: dir });
    const res = await fetch(`http://127.0.0.1:${new URL(server.url).port}/`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<title>home</title>");
    expect(await (await fetch(server.url)).text()).toBe("the avatar"); // /avatar is as it was
  });

  it("sends the root to the avatar page when there is no home page in the build", async () => {
    server = await startServer({ staticDir: dir });
    const res = await fetch(`http://127.0.0.1:${new URL(server.url).port}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/avatar");
  });

  it("does not serve the home page at other paths", async () => {
    await writeFile(join(dir, "home.html"), "home");
    server = await startServer({ staticDir: dir });
    expect((await fetch(`http://127.0.0.1:${new URL(server.url).port}/nope`)).status).toBe(404);
  });
});
