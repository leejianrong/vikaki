import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPersonas, parsePersonas, PersonaError } from "../src/personas.ts";

const base = "/srv/vikaki";
const ok = `
personas:
  ada:
    avatar: avatars/cookieman.vrm
    voice: af_heart
    emotion: happy
    style: warm and quick-witted
  ben:
    avatar: /abs/ben.vrm
`;

const problem = (text: string) => {
  try {
    parsePersonas(text, base);
  } catch (err) {
    expect(err).toBeInstanceOf(PersonaError);
    return (err as Error).message;
  }
  throw new Error("expected the file to be rejected");
};

describe("parsePersonas", () => {
  it("reads name, avatar, voice, default emotion and style, resolving avatars against the file's folder", () => {
    const book = parsePersonas(ok, base);
    expect(book.names).toEqual(["ada", "ben"]);
    expect(book.get("ada")).toEqual({ name: "ada", avatar: "/srv/vikaki/avatars/cookieman.vrm", voice: "af_heart", emotion: "happy", style: "warm and quick-witted" });
    expect(book.get("ben")).toEqual({ name: "ben", avatar: "/abs/ben.vrm" });
    expect(book.get("nobody")).toBeUndefined();
  });

  it("reads a seated pose: arm angles and hip drop, or arms: hang (ADR-0019)", () => {
    const book = parsePersonas("personas:\n  ada:\n    avatar: a.vrm\n    pose: { arms: { forward: 0.8, down: 1.1, elbow: 0.5 }, hip_drop: 0.4 }\n  snow:\n    avatar: s.vrm\n    pose: { arms: hang }\n", base);
    expect(book.get("ada")!.pose).toEqual({ arms: { forward: 0.8, down: 1.1, elbow: 0.5 }, hipDrop: 0.4 });
    expect(book.get("snow")!.pose).toEqual({ arms: "hang" });
  });

  it("rejects a pose with a number out of range or a word it does not know, naming the persona", () => {
    expect(problem("personas:\n  ada:\n    avatar: a.vrm\n    pose: { hip_drop: 2 }\n")).toMatch(/ada.*hip_drop/i);
    expect(problem("personas:\n  ada:\n    avatar: a.vrm\n    pose: { arms: flap }\n")).toMatch(/ada.*arms/i);
    expect(problem("personas:\n  ada:\n    avatar: a.vrm\n    pose: { legs: 1 }\n")).toMatch(/ada.*legs/i);
  });

  it("rejects a persona with no VRM path, naming the persona", () => {
    expect(problem("personas:\n  ada:\n    voice: af_heart\n")).toMatch(/ada.*avatar/i);
    expect(problem("personas:\n  ada:\n    avatar: ''\n")).toMatch(/ada.*avatar/i);
  });

  it("rejects an emotion that is not one of the seven, listing them", () => {
    const m = problem("personas:\n  ada:\n    avatar: a.vrm\n    emotion: ecstatic\n");
    expect(m).toMatch(/ada.*emotion/i);
    expect(m).toMatch(/smug/);
  });

  it("rejects a file with no personas, a non-object persona, or a name the protocol cannot carry", () => {
    expect(problem("")).toMatch(/personas/);
    expect(problem("personas: {}")).toMatch(/at least one/i);
    expect(problem("personas:\n  ada: just-a-string\n")).toMatch(/ada/);
    expect(problem(`personas:\n  ${"x".repeat(65)}:\n    avatar: a.vrm\n`)).toMatch(/name/i);
  });

  it("rejects unknown fields, so a typo like `voise` is not silently ignored", () => {
    expect(problem("personas:\n  ada:\n    avatar: a.vrm\n    voise: af_heart\n")).toMatch(/voise/);
  });

  it("rejects YAML that does not parse", () => {
    expect(problem("personas: [unclosed")).toMatch(/yaml/i);
  });
});

describe("loadPersonas", () => {
  it("reads a file and checks that each avatar exists, naming the persona and the path that is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vikaki-personas-"));
    await mkdir(join(dir, "avatars"));
    await writeFile(join(dir, "avatars", "a.vrm"), "x");
    await writeFile(join(dir, "personas.yaml"), "personas:\n  ada:\n    avatar: avatars/a.vrm\n  ben:\n    avatar: avatars/missing.vrm\n");
    await expect(loadPersonas(join(dir, "personas.yaml"))).rejects.toThrow(/ben.*missing\.vrm/s);
    await writeFile(join(dir, "personas.yaml"), "personas:\n  ada:\n    avatar: avatars/a.vrm\n");
    const book = await loadPersonas(join(dir, "personas.yaml"));
    expect(book.get("ada")?.avatar).toBe(join(dir, "avatars", "a.vrm"));
  });

  it("says plainly when the file is not there", async () => {
    await expect(loadPersonas("/nonexistent/personas.yaml")).rejects.toThrow(/personas\.yaml/);
  });
});

describe("the example file", () => {
  it("loads, so the documentation cannot drift from the parser", async () => {
    const book = await loadPersonas(new URL("../../../personas.example.yaml", import.meta.url).pathname);
    expect(book.names).toContain("ada");
    expect(book.get("ada")?.emotion).toBe("happy");
  });
});

describe("the file's version (VIK-131)", () => {
  it("version 1 is the format; a file without one is version 1", () => {
    expect(parsePersonas(`version: 1\n${ok}`, base).names).toEqual(["ada", "ben"]);
    expect(parsePersonas(ok, base).names).toEqual(["ada", "ben"]);
  });
  it("a newer or malformed version is refused by saying what this hub reads", () => {
    for (const v of ["2", "0", '"1"', "1.5"]) {
      expect(problem(`version: ${v}\n${ok}`), v).toMatch(/personas file `version` is .*; this vikaki reads version 1/);
    }
  });
});
