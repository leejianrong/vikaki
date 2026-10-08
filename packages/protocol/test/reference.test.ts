import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { jsonSchema } from "../src/index.ts";
import { protocolReference } from "../src/reference.ts";

const reference = protocolReference(jsonSchema());
const messageTypes = (jsonSchema() as { oneOf: { properties: { type: { const: string } } }[] }).oneOf.map((m) => m.properties.type.const);

describe("protocolReference", () => {
  it("has a section for every message type in the schema, and nothing else", () => {
    const sections = [...reference.matchAll(/^## `([a-z_]+)`$/gm)].map((m) => m[1]);
    expect(sections.sort()).toEqual([...messageTypes].sort());
    expect(messageTypes.length).toBeGreaterThan(10);
  });

  it("says whether each field is required, and how it is bounded", () => {
    const section = (type: string) => reference.split(/^## /m).find((s) => s.startsWith(`\`${type}\``))!;
    expect(section("cancel")).toMatch(/\| `utterance_id` \| string \| no \| 1 to 128 characters \|/); // optional: no id means everything
    expect(section("utterance")).toMatch(/\| `seat_id` \| string \| yes \|/);
    expect(section("utterance")).toMatch(/\| `intensity` \| number \| no \| 0 to 1 \|/);
    expect(section("hello")).toMatch(/\| `role` \| one of `driver`, `viewer`, `controller` \| yes \|/);
    expect(section("welcome")).toMatch(/\| `personas` \| list of string \| no \| at most 256 items, each 1 to 64 characters \|/);
  });

  it("leaves out the two fields every message has, and says so once at the top", () => {
    expect(reference).toMatch(/Every message carries `protocol_version` \(1\) and `type`/);
    expect(reference).not.toMatch(/\| `protocol_version` \|/);
    expect(reference).not.toMatch(/\| `type` \|/);
  });

  it("matches docs/protocol-reference.md (run `pnpm --filter @vikaki/protocol schema` after changing the protocol)", () => {
    const committed = readFileSync(fileURLToPath(new URL("../../../docs/protocol-reference.md", import.meta.url)), "utf8");
    expect(committed).toBe(reference);
  });
});
