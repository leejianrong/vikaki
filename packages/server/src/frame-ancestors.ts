// Who may frame the avatar page (`--frame-ancestors`, VIK-65, ADR-0021). The browser enforces it: the page is served with
// `Content-Security-Policy: frame-ancestors ...`, and a page on any other origin that tries to embed it gets an error instead.

/** What is allowed when nothing is configured: pages on localhost, on any port (a game on one port, the hub on another). */
export const DEFAULT_FRAME_ANCESTORS = ["http://127.0.0.1:*", "http://localhost:*"];

/** A bare http(s) origin (scheme, host, optional port: no path, no wildcard), as `new URL(x).origin` prints it, else undefined. */
export function bareOrigin(value: string): string | undefined {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.origin === value ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The list a `--frame-ancestors` value names: comma-separated bare origins, or `none` (nobody but the page's own origin). Throws with a
 * message that says what is wrong, so the CLI can print it. No `*`: an allow-list is a list.
 */
export function parseFrameAncestors(value: string): string[] {
  const parts = value.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) throw new Error("--frame-ancestors needs origins such as http://127.0.0.1:8765, or none");
  if (parts.includes("none")) {
    if (parts.length > 1) throw new Error("--frame-ancestors none cannot be combined with origins");
    return [];
  }
  return parts.map((p) => {
    if (p === "*" || p.includes("*")) throw new Error(`--frame-ancestors does not take wildcards ("${p}"): list each origin`);
    const o = bareOrigin(p);
    if (!o) throw new Error(`--frame-ancestors: "${p}" is not an origin such as http://127.0.0.1:8765 or https://game.example (scheme, host, optional port, nothing else)`);
    return o;
  });
}

/** The `Content-Security-Policy` value for a list: `undefined` means the default (localhost on any port); an empty list means only the page itself. */
export function frameAncestorsPolicy(allowed: string[] | undefined): string {
  return `frame-ancestors 'self' ${(allowed ?? DEFAULT_FRAME_ANCESTORS).join(" ")}`.trimEnd();
}

/** Whether `origin` (what a page names as its parent) is one the list allows, by the same rule the browser applies to the header. */
export function frameAncestorAllowed(origin: string, allowed: string[] | undefined): boolean {
  if (!bareOrigin(origin)) return false;
  if (allowed) return allowed.includes(origin);
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}
