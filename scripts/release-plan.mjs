#!/usr/bin/env node
// What a version tag publishes (VIK-124, ADR-0046): the image tags and the version the Python client must carry. Pure, so a unit test
// pins it and the release workflow only runs what this prints.
//   node scripts/release-plan.mjs v0.1.0 [--owner leejianrong]     prints the plan as JSON
//   node scripts/release-plan.mjs v0.1.0 --check                   also checks clients/python/pyproject.toml says the same version
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;
const PEP440 = { alpha: "a", beta: "b", rc: "rc" };

/** The plan for a git tag such as `v0.1.0` or `v0.2.0-rc.1`. Throws, saying what is wrong, for any other tag. */
export function planRelease(tag, owner = "leejianrong") {
  const m = TAG.exec(tag);
  if (!m) throw new Error(`"${tag}" is not a release tag: use vMAJOR.MINOR.PATCH, or vMAJOR.MINOR.PATCH-rc.N (also -alpha.N, -beta.N)`);
  const [, major, minor, patch, label, n] = m;
  const core = `${major}.${minor}.${patch}`;
  const version = label ? `${core}-${label}.${n}` : core;
  const prerelease = label !== undefined;
  const image = `ghcr.io/${owner.toLowerCase()}/vikaki`;
  // A release candidate gets its own tag and moves nothing else: `latest` and `X.Y` only ever point at a final release.
  const names = prerelease ? [version] : [version, `${major}.${minor}`, "latest"];
  return {
    tag,
    version,
    prerelease,
    pythonVersion: prerelease ? `${core}${PEP440[label]}${n}` : core,
    image,
    imageTags: names.map((t) => `${image}:${t}`),
  };
}

/** The version in a pyproject.toml's [project] table. */
export function pyprojectVersion(text) {
  const project = /^\[project\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? "";
  return /^version\s*=\s*"([^"]+)"/m.exec(project)?.[1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const tag = args.find((a) => !a.startsWith("--"));
  const flag = (name) => args.includes(name) || args.some((a) => a.startsWith(`${name}=`));
  const owner = args[args.indexOf("--owner") + 1] && args.includes("--owner") ? args[args.indexOf("--owner") + 1] : undefined;
  try {
    if (!tag) throw new Error("usage: release-plan.mjs vX.Y.Z [--owner <github owner>] [--check] [--github-output]");
    const plan = planRelease(tag, owner);
    if (flag("--check")) {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
      const have = pyprojectVersion(readFileSync(join(root, "clients/python/pyproject.toml"), "utf8"));
      if (have !== plan.pythonVersion) throw new Error(`the tag ${tag} needs clients/python/pyproject.toml to say version = "${plan.pythonVersion}", but it says "${have}". Change it in a PR, merge it, then tag.`);
    }
    console.log(JSON.stringify(plan, null, 2));
    if (flag("--github-output") && process.env.GITHUB_OUTPUT) {
      const lines = Object.entries({ image: plan.image, version: plan.version, prerelease: plan.prerelease, python_version: plan.pythonVersion });
      appendFileSync(process.env.GITHUB_OUTPUT, lines.map(([k, v]) => `${k}=${v}\n`).join("") + `image_tags<<EOF\n${plan.imageTags.join("\n")}\nEOF\n`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
