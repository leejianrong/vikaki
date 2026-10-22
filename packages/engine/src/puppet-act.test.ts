import { describe, expect, it } from "vitest";
import { NO_OFFSETS, type ArmOffsets } from "./arm-act.ts";
import type { AvatarRenderer } from "./renderer.ts";
import { Puppet } from "./stage.ts";

function fake(canAct: boolean | undefined) {
  const seen: ArmOffsets[] = [];
  const pitches: number[] = [];
  const avatar: AvatarRenderer = {
    setVisemes() {},
    setBlink() {},
    setHeadPose: (p) => void pitches.push(p.pitch),
    update() {},
    ...(canAct === undefined ? {} : { canAct: () => canAct, setArmOffsets: (o: ArmOffsets) => void seen.push(o) }),
  };
  return { avatar, seen, pitches };
}

describe("Puppet.act (VIK-137)", () => {
  it("moves the arms when the avatar can, and leaves the head to its idle", () => {
    const { avatar, seen } = fake(true);
    const p = new Puppet(avatar, 1, false);
    expect(p.act("push")).toBe("arms");
    for (let i = 0; i < 10; i++) p.update(0.05, {});
    expect(seen.some((o) => o.right.forward > 0.1)).toBe(true);
    expect(seen.at(-1)).not.toEqual(NO_OFFSETS); // still mid-act at 0.5 s of 0.9
  });

  it("nods instead when the avatar's arms cannot act, or it has none", () => {
    for (const canAct of [false, undefined]) {
      const { avatar, seen, pitches } = fake(canAct);
      const p = new Puppet(avatar, 1, false);
      expect(p.act("knock")).toBe("nod");
      for (let i = 0; i < 8; i++) p.update(0.05, {});
      expect(seen.every((o) => o === NO_OFFSETS || o.right.elbow === 0)).toBe(true);
      expect(Math.max(...pitches)).toBeGreaterThan(0.05); // the head dipped
    }
  });
});
