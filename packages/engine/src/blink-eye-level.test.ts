import { BufferAttribute, BufferGeometry, Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { VrmAvatar } from "./vrm-avatar.ts";

/** A mesh of 12 vertices up a line; the blink shape moves only the two at the "eyes" (y = 1.2 and 1.4) by 0.01. */
function fakeAvatar(opts: { relative: boolean; lift?: number; withBlink?: boolean }) {
  const geometry = new BufferGeometry();
  const ys = Array.from({ length: 12 }, (_, i) => i * 0.2); // 0, 0.2 ... 2.2
  const positions = new Float32Array(ys.flatMap((y) => [0, y, 0]));
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const delta = new Float32Array(ys.flatMap((y) => (Math.abs(y - 1.2) < 1e-6 || Math.abs(y - 1.4) < 1e-6 ? [0, -0.01, 0] : [0, 0, 0])));
  const morph = opts.relative ? delta : new Float32Array(positions.map((v, i) => v + delta[i]!));
  geometry.morphAttributes.position = [new BufferAttribute(morph, 3)];
  geometry.morphTargetsRelative = opts.relative;
  const mesh = new Mesh(geometry);
  const scene = new Group();
  scene.add(mesh);
  scene.position.y = opts.lift ?? 0; // the avatar stands somewhere in the world
  const vrm = {
    scene,
    expressionManager: { getExpression: (name: string) => (name === "blink" && opts.withBlink !== false ? { binds: [{ primitives: [mesh], index: 0 }] } : null) },
  };
  return new (VrmAvatar as unknown as new (v: unknown) => VrmAvatar)(vrm);
}

describe("VrmAvatar.blinkEyeLevel", () => {
  it("is the average height of the vertices the blink shape moves", () => {
    expect(fakeAvatar({ relative: true }).blinkEyeLevel()).toBeCloseTo(1.3, 5);
  });

  it("gives the same answer for absolute morph targets", () => {
    expect(fakeAvatar({ relative: false }).blinkEyeLevel()).toBeCloseTo(1.3, 5);
  });

  it("is in world height, wherever the avatar stands", () => {
    expect(fakeAvatar({ relative: true, lift: 0.5 }).blinkEyeLevel()).toBeCloseTo(1.8, 5);
  });

  it("is undefined when the model has no blink shape, so framing falls back to its estimate", () => {
    expect(fakeAvatar({ relative: true, withBlink: false }).blinkEyeLevel()).toBeUndefined();
  });
});
