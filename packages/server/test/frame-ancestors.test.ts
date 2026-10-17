import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FRAME_ANCESTORS, bareOrigin, frameAncestorAllowed, frameAncestorsPolicy, parseFrameAncestors } from "../src/frame-ancestors.ts";
import { startServer, type RunningServer } from "../src/server.ts";

describe("parseFrameAncestors", () => {
  it("takes bare origins, comma-separated, with spaces allowed", () => {
    expect(parseFrameAncestors("http://127.0.0.1:8765")).toEqual(["http://127.0.0.1:8765"]);
    expect(parseFrameAncestors("http://127.0.0.1:8765, https://game.example,http://localhost:3000")).toEqual(["http://127.0.0.1:8765", "https://game.example", "http://localhost:3000"]);
  });

  it("`none` means nobody, and cannot be mixed with origins", () => {
    expect(parseFrameAncestors("none")).toEqual([]);
    expect(() => parseFrameAncestors("none,http://127.0.0.1:1")).toThrow(/cannot be combined/);
  });

  it("refuses wildcards, paths, other schemes, bare hosts and nothing at all, saying what is wrong", () => {
    expect(() => parseFrameAncestors("*")).toThrow(/wildcards/);
    expect(() => parseFrameAncestors("http://127.0.0.1:*")).toThrow(/wildcards/);
    expect(() => parseFrameAncestors("https://*.example")).toThrow(/wildcards/);
    for (const bad of ["game.example", "https://game.example/", "https://game.example/play", "ftp://game.example", "javascript:alert(1)", "'self'", "https://a.example https://b.example"]) {
      expect(() => parseFrameAncestors(bad), bad).toThrow(/is not an origin/);
    }
    expect(() => parseFrameAncestors("")).toThrow(/needs origins/);
    expect(() => parseFrameAncestors(" , ")).toThrow(/needs origins/);
  });
});

describe("frameAncestorsPolicy", () => {
  it("is localhost on any port by default, the page itself, and nothing else", () => {
    expect(DEFAULT_FRAME_ANCESTORS).toEqual(["http://127.0.0.1:*", "http://localhost:*"]);
    expect(frameAncestorsPolicy(undefined)).toBe("frame-ancestors 'self' http://127.0.0.1:* http://localhost:*");
  });
  it("is exactly the list when one is given (the default does not stay), and only 'self' for an empty one", () => {
    expect(frameAncestorsPolicy(["https://game.example"])).toBe("frame-ancestors 'self' https://game.example");
    expect(frameAncestorsPolicy([])).toBe("frame-ancestors 'self'");
  });
});

describe("frameAncestorAllowed (what ?parent= may name)", () => {
  it("by default: localhost and 127.0.0.1 on any port over http, nothing else", () => {
    for (const ok of ["http://127.0.0.1:8765", "http://localhost:3000", "http://localhost", "http://127.0.0.1"]) expect(frameAncestorAllowed(ok, undefined), ok).toBe(true);
    for (const bad of ["https://127.0.0.1:8765", "http://127.0.0.2:8765", "http://localhost.evil.example:3000", "http://evil.example", "http://[::1]:3000", "*", "http://127.0.0.1:8765/", "null", ""]) expect(frameAncestorAllowed(bad, undefined), bad).toBe(false);
  });
  it("with a list: only those exact origins, and the default is gone", () => {
    const list = ["https://game.example", "http://127.0.0.1:8765"];
    expect(frameAncestorAllowed("https://game.example", list)).toBe(true);
    expect(frameAncestorAllowed("http://127.0.0.1:8765", list)).toBe(true);
    expect(frameAncestorAllowed("http://127.0.0.1:8766", list)).toBe(false);
    expect(frameAncestorAllowed("https://game.example:444", list)).toBe(false);
    expect(frameAncestorAllowed("http://localhost:3000", list)).toBe(false);
    expect(frameAncestorAllowed("http://localhost:3000", [])).toBe(false);
  });
  it("bareOrigin agrees with new URL().origin and nothing looser", () => {
    expect(bareOrigin("https://game.example:8443")).toBe("https://game.example:8443");
    expect(bareOrigin("HTTPS://GAME.example")).toBeUndefined(); // not in the form a browser reports
  });
});

describe("the server's headers", () => {
  let server: RunningServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });
  async function serve(frameAncestors?: string[]) {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-frame-"));
    await writeFile(join(dir, "index.html"), "hi");
    await writeFile(join(dir, "app.js"), "1");
    server = await startServer({ staticDir: dir, frameAncestors });
    return server.url;
  }
  const csp = (r: Response) => r.headers.get("content-security-policy");

  it("sends frame-ancestors with the page, the default being localhost", async () => {
    const url = await serve();
    const r = await fetch(url);
    expect(r.status).toBe(200);
    expect(csp(r)).toBe("frame-ancestors 'self' http://127.0.0.1:* http://localhost:*");
    expect(csp(await fetch(`${url}/app.js`))).toBe(csp(r));
  });

  it("sends the configured list instead, and 'self' alone for none", async () => {
    expect(csp(await fetch(await serve(["https://game.example"])))).toBe("frame-ancestors 'self' https://game.example");
    await server?.close();
    expect(csp(await fetch(await serve([])))).toBe("frame-ancestors 'self'");
  });

  it("serves the page for a ?parent= the list allows, and refuses one it does not, saying how to fix it", async () => {
    const url = await serve(["http://127.0.0.1:8765"]);
    expect((await fetch(`${url}?parent=${encodeURIComponent("http://127.0.0.1:8765")}`)).status).toBe(200);
    const bad = await fetch(`${url}?seats=2&parent=${encodeURIComponent("https://evil.example")}`);
    expect(bad.status).toBe(403);
    expect(await bad.text()).toContain("--frame-ancestors https://evil.example");
    expect(csp(bad)).toBe("frame-ancestors 'self' http://127.0.0.1:8765"); // the error page is not frameable by others either
    expect((await fetch(`${url}?parent=*`)).status).toBe(403);
    expect((await fetch(`${url}?parent=`)).status).toBe(403);
    expect((await fetch(url)).status).toBe(200); // no ?parent= at all: nothing to check
  });

  it("by default allows a ?parent= on localhost, any port", async () => {
    const url = await serve();
    expect((await fetch(`${url}?parent=${encodeURIComponent("http://localhost:3000")}`)).status).toBe(200);
    expect((await fetch(`${url}?parent=${encodeURIComponent("https://game.example")}`)).status).toBe(403);
  });
});
