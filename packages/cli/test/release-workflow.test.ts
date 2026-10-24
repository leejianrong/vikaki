import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The release workflow only runs for real on a tag, so these hold its safety rules where a pull request can see them (VIK-124).
const root = fileURLToPath(new URL("../../..", import.meta.url));
const text = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
const lines = text.split("\n");

describe(".github/workflows/release.yml", () => {
  it("is started for real by a version tag only: push has tags and no branches", () => {
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\nconcurrency:"));
    const push = /\n  push:\n((?:    .*\n)+)/.exec(on)?.[1] ?? "";
    expect(push).toContain("tags:");
    expect(push).not.toMatch(/branches/);
  });

  it("publishes only when the plan says publish (a tag push): every push or login is guarded by it", () => {
    const pushes = lines.filter((l) => /^\s+push:\s/.test(l) && !/^\s+push:\s*$/.test(l));
    expect(pushes.length).toBeGreaterThan(0);
    for (const l of pushes) expect(l, l).toMatch(/needs\.plan\.outputs\.publish == 'true'/);
    const login = lines.findIndex((l) => l.includes("docker/login-action"));
    expect(login).toBeGreaterThan(0);
    expect(lines.slice(login - 3, login).join("\n")).toMatch(/if: needs\.plan\.outputs\.publish == 'true'/);
    expect(text).not.toMatch(/push:\s*true/);
  });

  it("decides 'publish' from a tag push, and only then", () => {
    expect(text).toMatch(/\$GITHUB_EVENT_NAME" = "push" \] && \[ "\$GITHUB_REF_TYPE" = "tag"/);
  });

  it("refuses a tag that is not a commit of main", () => {
    expect(text).toMatch(/merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  });

  it("pins every third-party action to a commit, and gives first-party ones a version or a commit", () => {
    const uses = lines.map((l) => /uses:\s*(\S+)/.exec(l)?.[1]).filter((u): u is string => !!u);
    expect(uses.length).toBeGreaterThan(3);
    for (const u of uses) {
      if (u.startsWith("actions/")) expect(u, u).toMatch(/@(v\d+|[0-9a-f]{40})$/);
      else expect(u, u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("gives a job the rights to write packages only where it pushes", () => {
    expect(text.match(/packages: write/g)?.length).toBeGreaterThan(0);
    expect(text).toMatch(/^permissions:\n  contents: read\n/m); // the default for the whole file is read-only
  });

  it("signs and releases only on a tag, and only the signing and PyPI jobs may ask for an identity token", () => {
    const job = (name: string) => {
      const start = text.indexOf(`\n  ${name}:\n`);
      expect(start, `job ${name}`).toBeGreaterThan(0);
      const rest = text.slice(start + 1);
      const next = rest.slice(1).search(/\n  [a-z-]+:\n/);
      return next < 0 ? rest : rest.slice(0, next + 1);
    };
    for (const name of ["sign", "github-release", "pypi"]) expect(job(name), name).toMatch(/if: needs\.plan\.outputs\.publish == 'true'/);
    expect(job("sign")).toContain("id-token: write");
    expect(text.match(/id-token: write/g)).toHaveLength(2); // sign, and pypi (trusted publishing)
    expect(job("pypi")).toContain("id-token: write");
    expect(job("github-release")).toContain("contents: write");
    expect(text.match(/contents: write/g)).toHaveLength(1);
    expect(job("github-release")).toMatch(/needs: \[plan, sign, python\]/); // never a release for images that are not signed or a client that did not build
  });

  it("publishes to PyPI only on a tag, only when the project opted in, and only after the GitHub release exists", () => {
    const start = text.indexOf("\n  pypi:\n");
    const pypi = text.slice(start);
    expect(pypi).toMatch(/vars\.PUBLISH_TO_PYPI == 'true'/);
    expect(pypi).toMatch(/needs: \[plan, python, github-release\]/);
    expect(text).not.toMatch(/PYPI_API_TOKEN|password: \$\{\{ secrets\.PYPI/); // trusted publishing: no stored token
  });

  it("signs both images by digest, never by a movable tag, and attaches an SBOM to each", () => {
    expect(text).toMatch(/cosign sign --yes "\$IMAGE@\$DIGEST"/);
    expect(text).toMatch(/cosign sign --yes "\$IMAGE@\$KOKORO_DIGEST"/);
    expect(text).toMatch(/cosign attest --yes --type spdxjson --predicate "vikaki-\$VERSION\.spdx\.json"/);
    expect(text).toMatch(/cosign attest --yes --type spdxjson --predicate "vikaki-\$VERSION-kokoro\.spdx\.json"/);
    expect(text).not.toMatch(/cosign sign[^\n]*:latest/);
  });

  it("needs the release notes to exist before it pushes anything", () => {
    expect(text).toMatch(/test -f "docs\/releases\/\$GITHUB_REF_NAME\.md"/);
  });
});
