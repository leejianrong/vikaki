import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");

describe("repo hygiene", () => {
  it("tracks no test-run output, which changes on every run", () => {
    expect(tracked.filter((f) => /(^|\/)\.vitest\//.test(f))).toEqual([]);
  });

  it("tracks no built copy of the Python client or the poker example: a stale build/ shadows the sources (VIK-83: an old schema was installed)", () => {
    expect(tracked.filter((f) => /^(clients\/python|examples\/poker)\/(build|dist)\//.test(f))).toEqual([]);
  });

  it("records the licence of every bundled avatar in ASSETS.md before it is committed (CLAUDE.md)", () => {
    const assets = readFileSync(join(root, "packages/engine/ASSETS.md"), "utf8");
    const avatars = tracked.filter((f) => /^packages\/engine\/public\/avatars\/.+\.vrm$/.test(f));
    expect(avatars.length).toBeGreaterThan(0);
    for (const f of avatars) {
      const row = assets.split("\n").find((l) => l.includes(`\`${f.replace("packages/engine/", "")}\``));
      expect(row, `${f} has no row in ASSETS.md`).toBeDefined();
      expect(row, `${f}: the row must say its licence`).toMatch(/CC0|CC-BY|MIT|Apache/);
    }
  });
});
