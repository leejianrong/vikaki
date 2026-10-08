import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const makefile = readFileSync(fileURLToPath(new URL("../../../Makefile", import.meta.url)), "utf8");

/** The recipe lines of a target: the tab-indented lines after `name:` until the next target. */
function recipe(target: string): string[] {
  const lines = makefile.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^${target}:`).test(l));
  if (start < 0) throw new Error(`no target ${target} in the Makefile`);
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (!l.startsWith("\t") && l.trim() !== "") break;
    if (l.startsWith("\t")) out.push(l.trim());
  }
  return out;
}

describe("long-running Makefile targets", () => {
  // pnpm reports a clean Ctrl+C stop as "Command failed with signal SIGINT" with a long error block,
  // and make adds its own "Interrupt" line. Running the CLI directly avoids the first.
  it.each(["serve", "demo", "demo-speech"])("`make %s` runs the CLI directly, not through pnpm", (target) => {
    const lines = recipe(target).filter((l) => /serve/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(/pnpm/);
  });

  it("builds before serving, and installs the voice before the speech demo", () => {
    expect(makefile).toMatch(/^serve: build/m);
    expect(makefile).toMatch(/^demo: build/m);
    expect(makefile).toMatch(/^demo-speech: install-voice build/m);
  });
});
