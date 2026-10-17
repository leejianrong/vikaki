// The speaker's light in the duet layout (VIK-68): the avatar whose line is heard is at full brightness with a warm halo behind the head;
// the other is dimmed a little. The dimming is done on the materials (a toon-shaded model ignores light layers), eased so it never pops.
import { CanvasTexture, Color, Group, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Material, type Object3D } from "three";

/** How bright the one who is not speaking is, against 1 for the speaker. */
export const DIMMED = 0.62;
/** Seconds to ease from one to the other. */
const EASE = 0.25;
const WARM = new Color("#ffd98a");

interface Tint {
  material: Material & { color?: Color; shadeColorFactor?: Color; emissive?: Color };
  color?: Color;
  shade?: Color;
  emissive?: Color;
}

function halo(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(255,226,150,0.95)");
  grad.addColorStop(0.55, "rgba(255,214,120,0.55)");
  grad.addColorStop(0.9, "rgba(255,206,100,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class SpeakerLight {
  /** Anchor for everything this adds to the scene; move it with the avatar. */
  readonly group = new Group();
  /** Brightness, `DIMMED` to 1 mapped onto 0 to 1. Starts at 1: with nobody speaking both look normal. */
  level = 1;
  /** The halo's strength, 0 to 1. */
  get halo(): number {
    return this.glowLevel;
  }
  private target = 1;
  private glowLevel = 0;
  private readonly tints: Tint[] = [];
  private readonly haloSprite: Sprite;

  constructor(avatar: Object3D, head: Vector3, size: number) {
    avatar.traverse((o) => {
      const mats = (o as { material?: Material | Material[] }).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        const t = m as Tint["material"];
        if (this.tints.some((x) => x.material === t) || !(t.color instanceof Color)) continue;
        this.tints.push({ material: t, color: t.color.clone(), shade: t.shadeColorFactor?.clone(), emissive: t.emissive?.clone() });
      }
    });
    const mat = new SpriteMaterial({ map: halo(), transparent: true, depthWrite: false, opacity: 0 });
    this.haloSprite = new Sprite(mat);
    this.haloSprite.position.set(head.x, head.y - size * 0.05, head.z - 0.35); // behind the head, in the avatar's own x
    this.haloSprite.scale.setScalar(size);
    this.haloSprite.renderOrder = -1;
    this.group.add(this.haloSprite);
  }

  /** Is this avatar the one in the light? `undefined` (nobody) leaves both normal. */
  set(speaking: boolean | undefined): void {
    this.target = speaking === undefined ? 1 : speaking ? 1 : 0;
    this.lit = speaking === true;
  }

  /** True while this avatar is the speaker (the halo's target, not its eased value). */
  lit = false;

  update(dt: number): void {
    this.level += Math.sign(this.target - this.level) * Math.min(Math.abs(this.target - this.level), dt / EASE);
    const k = DIMMED + (1 - DIMMED) * this.level;
    this.glowLevel += Math.sign((this.lit ? 1 : 0) - this.glowLevel) * Math.min(Math.abs((this.lit ? 1 : 0) - this.glowLevel), dt / EASE);
    const glow = this.glowLevel;
    for (const t of this.tints) {
      t.material.color?.copy(t.color!).multiplyScalar(k);
      if (t.shade) t.material.shadeColorFactor?.copy(t.shade).multiplyScalar(k);
      if (t.emissive) t.material.emissive?.copy(t.emissive).lerp(WARM, glow * 0.1);
    }
    (this.haloSprite.material as SpriteMaterial).opacity = glow;
  }
}
