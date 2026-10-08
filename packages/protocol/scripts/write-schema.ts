// Writes docs/protocol.schema.json. A test fails if the committed copy is out of date.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonSchema } from "../src/index.ts";

const out = fileURLToPath(new URL("../../../docs/protocol.schema.json", import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(jsonSchema(), null, 2) + "\n");
console.log("wrote", out);
