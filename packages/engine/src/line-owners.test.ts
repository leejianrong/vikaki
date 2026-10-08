import { describe, expect, it } from "vitest";
import { LineOwners } from "./line-owners.ts";

describe("LineOwners for a page that shows everyone", () => {
  const owners = new LineOwners();
  it("plays every line, whoever it is for, and shows every turn", () => {
    owners.see("u1", "ben");
    owners.see("u2", undefined);
    expect(owners.mine("u1")).toBe(true);
    expect(owners.mine("u2")).toBe(true);
    expect(owners.mine("never-seen")).toBe(true);
    expect(owners.turnIsMine("ben")).toBe(true);
    expect(owners.turnIsMine(undefined)).toBe(true);
  });
});

describe("LineOwners for a page that shows one persona", () => {
  it("plays only that persona's lines", () => {
    const owners = new LineOwners("ada");
    owners.see("u1", "ada");
    owners.see("u2", "ben");
    owners.see("u3", undefined);
    expect(owners.mine("u1")).toBe(true);
    expect(owners.mine("u2")).toBe(false);
    expect(owners.mine("u3")).toBe(false); // a line for nobody in particular is not ada's
  });

  it("cannot play audio for a line it never saw announced", () => {
    expect(new LineOwners("ada").mine("never-seen")).toBe(false);
  });

  it("goes by the first message of a line, as a streamed line may name its persona only once", () => {
    const owners = new LineOwners("ada");
    owners.see("u1", "ada");
    owners.see("u1", undefined); // a later chunk names no one
    expect(owners.mine("u1")).toBe(true);
    owners.see("u2", "ben");
    owners.see("u2", "ada");
    expect(owners.mine("u2")).toBe(false);
  });

  it("shows only its own persona's turns, and not a turn that names nobody", () => {
    const owners = new LineOwners("ada");
    expect(owners.turnIsMine("ada")).toBe(true);
    expect(owners.turnIsMine("ben")).toBe(false);
    expect(owners.turnIsMine(undefined)).toBe(false);
  });

  it("forgets a finished line, and never grows without bound", () => {
    const owners = new LineOwners("ada");
    owners.see("u1", "ada");
    owners.forget("u1");
    expect(owners.mine("u1")).toBe(false);
    for (let i = 0; i < 3000; i++) owners.see(`l${i}`, "ada");
    expect(owners.size).toBeLessThanOrEqual(1000);
    expect(owners.mine("l2999")).toBe(true);
  });
});
