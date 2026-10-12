import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../manifest.json", import.meta.url)), "utf8"));

const SITES = [
  "https://meet.google.com/*",
  "https://teams.microsoft.com/*",
  "https://teams.live.com/*",
  "https://zoom.us/wc/*",
  "https://app.zoom.us/wc/*",
];

describe("manifest match patterns", () => {
  for (const [i, script] of manifest.content_scripts.entries()) {
    it(`content script ${i} (${script.js[0]}) matches every supported site`, () => {
      expect(script.matches).toEqual(expect.arrayContaining(SITES));
    });
  }

  it("web_accessible_resources use origin-wide patterns only (one bad entry stops the extension loading)", () => {
    for (const entry of manifest.web_accessible_resources) {
      for (const m of entry.matches) expect(m).toMatch(/^https:\/\/[^/]+\/\*$/);
    }
  });

  it("web_accessible_resources cover the same hosts as the content scripts", () => {
    const hosts = (patterns: string[]) => new Set(patterns.map((p) => new URL(p.replace("*", "x")).host));
    const scriptHosts = hosts(manifest.content_scripts[0].matches);
    for (const entry of manifest.web_accessible_resources) expect(hosts(entry.matches)).toEqual(scriptHosts);
  });
});
