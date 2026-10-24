import { describe, expect, it } from "vitest";
import { hostAllowed, parseAllowedHosts } from "../src/allowed-hosts.ts";

describe("hostAllowed", () => {
  it("always answers the local names, with or without a port, and nothing else by default", () => {
    for (const h of ["127.0.0.1:8787", "localhost", "LOCALHOST:1", "[::1]:8787"]) expect(hostAllowed(h), h).toBe(true);
    for (const h of ["evil.example", "vikaki:8787", "", undefined, "127.0.0.1.evil.example"]) expect(hostAllowed(h), String(h)).toBe(false);
  });
  it("a listed name with a port matches that port only; without a port it matches any", () => {
    expect(hostAllowed("vikaki:8787", ["vikaki:8787"])).toBe(true);
    expect(hostAllowed("vikaki:8788", ["vikaki:8787"])).toBe(false);
    expect(hostAllowed("vikaki", ["vikaki:8787"])).toBe(false);
    expect(hostAllowed("Hub.Internal:1", ["hub.internal"])).toBe(true);
    expect(hostAllowed("[fd00::2]:8787", ["[fd00::2]"])).toBe(true);
    expect(hostAllowed("sub.hub.internal", ["hub.internal"])).toBe(false);
  });
});

describe("parseAllowedHosts", () => {
  it("takes a comma-separated list, lower-cased and trimmed", () => {
    expect(parseAllowedHosts("Vikaki:8787, hub.internal")).toEqual(["vikaki:8787", "hub.internal"]);
  });
  it("refuses wildcards, schemes, paths and an empty list, saying what is wrong and naming the source", () => {
    expect(() => parseAllowedHosts("*")).toThrow(/wildcards/);
    expect(() => parseAllowedHosts("*.internal", "VIKAKI_ALLOWED_HOSTS")).toThrow(/VIKAKI_ALLOWED_HOSTS does not take wildcards/);
    expect(() => parseAllowedHosts("http://vikaki:8787")).toThrow(/not a host name/);
    expect(() => parseAllowedHosts("vikaki/x")).toThrow(/not a host name/);
    expect(() => parseAllowedHosts(" , ")).toThrow(/needs host names/);
  });
});
