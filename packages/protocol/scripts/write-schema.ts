// Writes docs/protocol.schema.json, the reference page generated from it, and the copy the Python client ships (clients/python).
// Tests fail if the committed copies are out of date.
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
const pythonCopy = fileURLToPath(new URL("../../../clients/python/src/vikaki_client/protocol.schema.json", import.meta.url));
writeFileSync(pythonCopy, JSON.stringify(jsonSchema(), null, 2) + "\n");
console.log("wrote", out, ",", reference, "and", pythonCopy);
