import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
// @ts-expect-error a plain .mjs script with no types
const { planRelease, pyprojectVersion } = (await import(join(root, "scripts/release-plan.mjs"))) as {
  planRelease: (tag: string, owner?: string) => { version: string; prerelease: boolean; pythonVersion: string; imageTags: string[]; kokoroTags: string[] };
  pyprojectVersion: (text: string) => string | undefined;
};

describe("what a version tag publishes (VIK-124)", () => {
  it("a final release gets its version, major.minor and latest, on the owner's lower-cased ghcr path, plus the same for the voice variant", () => {
    const p = planRelease("v0.1.0", "LeeJianRong");
    expect(p.imageTags).toEqual(["ghcr.io/leejianrong/vikaki:0.1.0", "ghcr.io/leejianrong/vikaki:0.1", "ghcr.io/leejianrong/vikaki:latest"]);
    expect(p.kokoroTags).toEqual(["ghcr.io/leejianrong/vikaki:0.1.0-kokoro", "ghcr.io/leejianrong/vikaki:0.1-kokoro", "ghcr.io/leejianrong/vikaki:latest-kokoro"]);
    expect(p.pythonVersion).toBe("0.1.0");
    expect(p.prerelease).toBe(false);
  });

  it("a release candidate gets only its own tag, so latest and X.Y never point at it, and its Python version is the PEP 440 spelling", () => {
    const p = planRelease("v1.2.3-rc.2");
    expect(p.imageTags).toEqual(["ghcr.io/leejianrong/vikaki:1.2.3-rc.2"]);
    expect(p.kokoroTags).toEqual(["ghcr.io/leejianrong/vikaki:1.2.3-rc.2-kokoro"]);
    expect(p.pythonVersion).toBe("1.2.3rc2");
    expect(p.prerelease).toBe(true);
    expect(planRelease("v1.0.0-beta.1").pythonVersion).toBe("1.0.0b1");
  });

  it("refuses anything that is not a version tag, saying what to write", () => {
    for (const bad of ["0.1.0", "v0.1", "v0.1.0.1", "v0.1.0-rc1", "v0.1.0-dev.1", "release-1", "latest", "v01.1.0x"]) {
      expect(() => planRelease(bad), bad).toThrow(/is not a release tag/);
    }
  });

  it("reads the version from the [project] table only", () => {
    expect(pyprojectVersion('[build-system]\nrequires = ["x"]\n\n[project]\nname = "a"\nversion = "0.1.0"\n\n[tool.x]\nversion = "9"\n')).toBe("0.1.0");
    expect(pyprojectVersion('[project]\nname = "a"\nversion = "0.2.0"\n')).toBe("0.2.0"); // [project] last in the file
    expect(pyprojectVersion('[tool.x]\nversion = "9"\n')).toBeUndefined();
  });

  it("the Python client in the tree carries a version a tag can name, so a release is one tag away", () => {
    const have = pyprojectVersion(readFileSync(join(root, "clients/python/pyproject.toml"), "utf8"));
    expect(have, "clients/python/pyproject.toml has no version").toMatch(/^\d+\.\d+\.\d+((a|b|rc)\d+)?$/);
    const tag = `v${have!.replace(/(a|b|rc)(\d+)$/, (_m, l: string, n: string) => `-${{ a: "alpha", b: "beta", rc: "rc" }[l]}.${n}`)}`;
    expect(() => execFileSync(process.execPath, [join(root, "scripts/release-plan.mjs"), tag, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("--check fails when the tag and the client disagree", () => {
    expect(() => execFileSync(process.execPath, [join(root, "scripts/release-plan.mjs"), "v9.9.9", "--check"], { stdio: "pipe" })).toThrow();
  });
});
