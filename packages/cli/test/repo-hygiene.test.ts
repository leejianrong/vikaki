import { execFileSync } from "node:child_process";
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
});
