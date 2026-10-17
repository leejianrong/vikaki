import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { EMOTIONS } from "@vikaki/protocol";
import { parse } from "yaml";
import { z } from "zod";

/** A named character: which avatar it looks like, which voice it speaks with, how it usually feels, and a note on its manner. */
export interface Persona {
  name: string;
  /** Absolute path of the VRM file. */
  avatar: string;
  /** A voice id for the speech engine; engines ignore ids they do not know. */
  voice?: string;
  /** Used for lines that name no emotion of their own. */
  emotion?: (typeof EMOTIONS)[number];
  /** Free text for whoever writes the lines (an LLM prompt, a script author). Never spoken. */
  style?: string;
  /** How it sits at a table (ADR-0019): arm angles in radians, or `"hang"`, and how far the hips drop. Defaults live in the page. */
  pose?: { arms?: { forward: number; down: number; elbow: number } | "hang"; hipDrop?: number };
}

/** The problem with a personas file, in words a person can act on. */
export class PersonaError extends Error {}

const NAME = z.string().min(1).max(64); // the protocol's limit for `persona`

const PersonaFile = z.object({
  personas: z.record(NAME, z.unknown()),
});

const PersonaEntry = z
  .object({
    avatar: z.string({ error: "needs an `avatar` (the path of a .vrm file)" }).min(1, "needs an `avatar` (the path of a .vrm file)"),
    voice: z.string().min(1).max(64).optional(),
    emotion: z.enum(EMOTIONS, { error: `\`emotion\` must be one of ${EMOTIONS.join(", ")}` }).optional(),
    style: z.string().max(2000).optional(),
    pose: z
      .object({
        arms: z.union([z.literal("hang"), z.object({ forward: z.number().min(-3.2).max(3.2), down: z.number().min(-3.2).max(3.2), elbow: z.number().min(-3.2).max(3.2) }).strict()], { error: "`pose.arms` must be `hang` or a map of forward, down and elbow (radians)" }).optional(),
        hip_drop: z.number({ error: "`pose.hip_drop` must be a number from 0 to 1" }).min(0, "`pose.hip_drop` must be from 0 to 1").max(1, "`pose.hip_drop` must be from 0 to 1").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** The personas of one file, by name. */
export class PersonaBook {
  private readonly byName: Map<string, Persona>;

  constructor(personas: Persona[]) {
    this.byName = new Map(personas.map((p) => [p.name, p]));
  }

  get names(): string[] {
    return [...this.byName.keys()];
  }

  get(name: string): Persona | undefined {
    return this.byName.get(name);
  }

  list(): Persona[] {
    return [...this.byName.values()];
  }
}

/** Parse the text of a personas file. Avatar paths are resolved against `baseDir`. Checks the shape, not the disk. */
export function parsePersonas(text: string, baseDir: string): PersonaBook {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new PersonaError(`the personas file is not valid YAML: ${(err as Error).message.split("\n")[0]}`);
  }
  const file = PersonaFile.safeParse(raw);
  if (!file.success) {
    const nameProblem = file.error.issues.find((i) => i.path[0] === "personas" && i.path.length > 1);
    throw new PersonaError(nameProblem ? `a persona name must be 1 to 64 characters` : "the personas file needs a top-level `personas:` map of name to persona");
  }
  const entries = Object.entries(file.data.personas);
  if (entries.length === 0) throw new PersonaError("the personas file needs at least one persona under `personas:`");
  const personas = entries.map(([name, value]): Persona => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PersonaError(`persona "${name}": expected a map with an \`avatar\`, not ${Array.isArray(value) ? "a list" : typeof value}`);
    const entry = PersonaEntry.safeParse(value);
    if (!entry.success) {
      const issue = entry.error.issues[0]!;
      const unknownKey = issue.code === "unrecognized_keys" ? (issue as { keys: string[] }).keys.join(", ") : undefined;
      const where = issue.path.length > 1 ? `${issue.path.join(".")}: ` : "";
      throw new PersonaError(unknownKey ? `persona "${name}": unknown field ${where}${unknownKey} (known: ${issue.path.length > 0 ? "arms, hip_drop" : "avatar, voice, emotion, style, pose"})` : `persona "${name}": ${where}${issue.message}`);
    }
    const e = entry.data;
    return {
      name,
      avatar: isAbsolute(e.avatar) ? e.avatar : resolve(baseDir, e.avatar),
      ...(e.voice ? { voice: e.voice } : {}),
      ...(e.emotion ? { emotion: e.emotion } : {}),
      ...(e.style ? { style: e.style } : {}),
      ...(e.pose ? { pose: { ...(e.pose.arms ? { arms: e.pose.arms } : {}), ...(e.pose.hip_drop !== undefined ? { hipDrop: e.pose.hip_drop } : {}) } } : {}),
    };
  });
  return new PersonaBook(personas);
}

/** Read a personas file and check that every avatar it names exists. */
export async function loadPersonas(path: string): Promise<PersonaBook> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new PersonaError(`cannot read the personas file ${path}`);
  }
  const book = parsePersonas(text, dirname(resolve(path)));
  for (const p of book.list()) {
    try {
      await access(p.avatar);
    } catch {
      throw new PersonaError(`persona "${p.name}": the avatar file ${p.avatar} does not exist`);
    }
  }
  return book;
}
