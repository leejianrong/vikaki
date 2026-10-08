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
