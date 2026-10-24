// Which `Host` names the hub answers (VIK-127, ADR-0044). A browser page on another site can point a DNS name at 127.0.0.1 and
// then reach the hub as that name (DNS rebinding), so the hub answers only local names. Behind a container network a game reaches it
// as `vikaki:8787`; an explicit allow-list (`--allow-host`, `VIKAKI_ALLOWED_HOSTS`) adds those names, and nothing else.

const LOCAL = ["127.0.0.1", "localhost", "[::1]"];

/** Split a Host header into the lower-case name and the port (if any). */
function split(host: string): { name: string; port?: string } {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return { name: h.slice(0, end + 1), port: h.slice(end + 2) || undefined };
  }
  const i = h.indexOf(":");
  return i < 0 ? { name: h } : { name: h.slice(0, i), port: h.slice(i + 1) || undefined };
}

/**
 * The list a `--allow-host` value names: comma-separated names such as `vikaki` (any port) or `vikaki:8787` (that port only). Throws
 * with a message that says what is wrong, so the CLI can print it. No wildcards, schemes or paths: it is a list of exact names.
 */
export function parseAllowedHosts(value: string, source = "--allow-host"): string[] {
  const parts = value.split(",").map((p) => p.trim().toLowerCase()).filter((p) => p !== "");
  if (parts.length === 0) throw new Error(`${source} needs host names such as vikaki:8787`);
  for (const p of parts) {
    if (p.includes("*")) throw new Error(`${source} does not take wildcards ("${p}"): list each name`);
    if (!/^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9._-]*[a-z0-9])?)(:\d{1,5})?$/.test(p)) throw new Error(`${source}: "${p}" is not a host name (write vikaki or vikaki:8787, with no scheme or path)`);
  }
  return parts;
}

/** Is this `Host` header a local name, or one the operator listed? A listed name with a port must match the port too. */
export function hostAllowed(hostHeader: string | undefined, extra: readonly string[] = []): boolean {
  const { name, port } = split(hostHeader ?? "");
  if (LOCAL.includes(name)) return true;
  return extra.some((e) => {
    const x = split(e);
    return x.name === name && (x.port === undefined || x.port === port);
  });
}
