// Writes docs/protocol.schema.json and the reference page generated from it. Tests fail if the committed copies are out of date.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchema } from "../src/index.ts";
import { protocolReference } from "../src/reference.ts";

const out = fileURLToPath(new URL("../../../docs/protocol.schema.json", import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(jsonSchema(), null, 2) + "\n");
const reference = fileURLToPath(new URL("../../../docs/protocol-reference.md", import.meta.url));
writeFileSync(reference, protocolReference(jsonSchema()));
console.log("wrote", out, "and", reference);
