/**
 * A reference page for the protocol, written from the JSON Schema so it can never be out of date: every message and its fields,
 * whether each is required, and how each is bounded. What the messages mean is in docs/protocol.md.
 */

interface Property {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  items?: Property;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  anyOf?: Property[];
}

interface MessageSchema {
  properties: Record<string, Property>;
  required?: string[];
}

function typeOf(p: Property): string {
  if (p.enum) return `one of ${p.enum.map((v) => `\`${String(v)}\``).join(", ")}`;
  if (p.type === "array") return `list of ${p.items ? typeOf(p.items) : "any"}`;
  if (p.anyOf) return p.anyOf.map(typeOf).join(" or ");
  return p.type ?? "any";
}

function boundsOf(p: Property): string {
  const parts: string[] = [];
  if (p.minLength !== undefined && p.maxLength !== undefined) parts.push(`${p.minLength} to ${p.maxLength} characters`);
  else if (p.maxLength !== undefined) parts.push(`at most ${p.maxLength} characters`);
  else if (p.minLength !== undefined) parts.push(`at least ${p.minLength} characters`);
  if (p.minimum !== undefined && p.maximum !== undefined) parts.push(`${p.minimum} to ${p.maximum}`);
  else if (p.maximum !== undefined) parts.push(`at most ${p.maximum}`);
  else if (p.minimum !== undefined) parts.push(`at least ${p.minimum}`);
  if (p.maxItems !== undefined) parts.push(`at most ${p.maxItems} items`);
  if (p.items) {
    const inner = boundsOf(p.items);
    if (inner) parts.push(`each ${inner}`);
  }
  return parts.join(", ");
}

export function protocolReference(schema: unknown): string {
  const messages = (schema as { oneOf: MessageSchema[] }).oneOf;
  const out = [
    "# Protocol reference",
    "",
    "Generated from [protocol.schema.json](protocol.schema.json) by `pnpm --filter @vikaki/protocol schema`. Do not edit by hand. This lists every message and its fields; what the messages mean, who may send them and when is in [protocol.md](protocol.md).",
    "",
    "Every message carries `protocol_version` (1) and `type`. A field marked `no` may be left out.",
    "",
  ];
  const named = messages.map((m) => ({ name: String(m.properties.type?.const), m }));
  for (const { name, m } of named) {
    out.push(`## \`${name}\``, "");
    const fields = Object.entries(m.properties).filter(([key]) => key !== "protocol_version" && key !== "type");
    if (fields.length === 0) {
      out.push("No fields.", "");
      continue;
    }
    out.push("| field | type | required | bounds |", "| --- | --- | --- | --- |");
    for (const [key, p] of fields) out.push(`| \`${key}\` | ${typeOf(p)} | ${m.required?.includes(key) ? "yes" : "no"} | ${boundsOf(p)} |`);
    out.push("");
  }
  return out.join("\n");
}
