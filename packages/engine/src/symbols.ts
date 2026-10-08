import { CanvasTexture, Group, Sprite, SpriteMaterial, SRGBColorSpace, Vector3 } from "three";
import type { EmotionPose, SymbolKind } from "./emotion.ts";

const SIZE = 128;
const INK = "#3a2a22";

/** Draw one mark on a transparent square canvas, in the same thick-outline cartoon style as the avatar. */
function draw(kind: SymbolKind): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const g = c.getContext("2d")!;
  g.lineJoin = g.lineCap = "round";
  g.lineWidth = 7;
  g.strokeStyle = INK;
  const star = (cx: number, cy: number, r: number, fill: string) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.32;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.stroke();
  };
  switch (kind) {
    case "sparkle":
      star(54, 70, 40, "#ffd23f");
      star(98, 28, 20, "#ffe58a");
      break;
    case "gleam":
      star(64, 64, 46, "#ffffff");
      break;
    case "sweat":
      g.beginPath();
      g.moveTo(64, 14);
      g.bezierCurveTo(100, 62, 98, 112, 64, 114);
      g.bezierCurveTo(30, 112, 28, 62, 64, 14);
      g.fillStyle = "#6ccff6";
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(48, 80);
      g.quadraticCurveTo(48, 96, 60, 100);
      g.lineWidth = 6;
      g.strokeStyle = "#ffffff";
      g.stroke();
      break;
    case "bang":
      g.beginPath();
      g.moveTo(44, 10);
      g.lineTo(84, 10);
      g.lineTo(74, 76);
      g.lineTo(54, 76);
      g.closePath();
      g.fillStyle = "#ff5a36";
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(64, 102, 13, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      break;
    case "gloom":
      g.lineWidth = 8;
      g.strokeStyle = "#6f7fb5";
      for (const x of [30, 64, 98]) {
        g.beginPath();
        g.moveTo(x, 14);
        g.lineTo(x, 100);
        g.stroke();
      }
      break;
    case "anger": {
      g.fillStyle = "#ee3b32";
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        g.beginPath();
        g.moveTo(64 + dx * 8, 64 + dy * 8);
        g.quadraticCurveTo(64 + dx * 8, 64 + dy * 40, 64 + dx * 46, 64 + dy * 46);
        g.quadraticCurveTo(64 + dx * 40, 64 + dy * 8, 64 + dx * 8, 64 + dy * 8);
        g.fill();
        g.stroke();
      }
      break;
    }
    case "dots":
      g.fillStyle = "#8d8d99";
      for (const x of [26, 64, 102]) {
        g.beginPath();
        g.arc(x, 64, 13, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      break;
  }
  return c;
}

/** Where each mark sits relative to the head anchor, in head heights, and how it moves. */
const LAYOUT: Record<SymbolKind, { x: number; y: number; scale: number; move: (t: number) => { dx: number; dy: number; s: number } }> = {
  sparkle: { x: 0.52, y: 0.3, scale: 0.4, move: (t) => ({ dx: 0, dy: 0.02 * Math.sin(t * 3), s: 1 + 0.12 * Math.sin(t * 5) }) },
  gleam: { x: -0.5, y: 0.3, scale: 0.3, move: (t) => ({ dx: 0, dy: 0, s: 0.85 + 0.2 * Math.sin(t * 4) }) },
  sweat: { x: 0.5, y: 0.2, scale: 0.3, move: (t) => ({ dx: 0, dy: -0.12 * ((t * 0.6) % 1), s: 1 }) },
  bang: { x: 0.5, y: 0.3, scale: 0.4, move: (t) => ({ dx: 0, dy: 0, s: 1 + 0.1 * Math.max(0, Math.sin(t * 8)) }) },
  gloom: { x: -0.5, y: 0.2, scale: 0.44, move: (t) => ({ dx: 0, dy: 0.015 * Math.sin(t * 2), s: 1 }) },
  anger: { x: 0.5, y: 0.3, scale: 0.36, move: (t) => ({ dx: 0, dy: 0, s: 1 + 0.15 * Math.max(0, Math.sin(t * 7)) }) },
  dots: { x: 0.5, y: 0.3, scale: 0.4, move: (t) => ({ dx: 0, dy: 0.015 * Math.sin(t * 3), s: 1 }) },
};

/** Manga-style marks beside the head: a sweat drop, sparkles, an anger mark. Drawn over the avatar, faded by the emotion's amount. */
export class EmotionSymbols {
  readonly group = new Group();
  private readonly sprites = new Map<SymbolKind, Sprite>();
  private t = 0;

  /** `anchor` is the middle of the head and `headHeight` its height, both in world units. */
  constructor(
    private readonly anchor: Vector3,
    private readonly headHeight: number,
  ) {
    for (const kind of Object.keys(LAYOUT) as SymbolKind[]) {
      const texture = new CanvasTexture(draw(kind));
      texture.colorSpace = SRGBColorSpace;
      const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
      sprite.renderOrder = 10;
      sprite.visible = false;
      this.sprites.set(kind, sprite);
      this.group.add(sprite);
    }
  }

  /** Marks shown right now, by kind, for tests. */
  get visible(): SymbolKind[] {
    return [...this.sprites].filter(([, s]) => s.visible).map(([k]) => k);
  }

  update(dt: number, pose: Pick<EmotionPose, "symbol" | "symbolAmount">): void {
    this.t += dt;
    for (const [kind, sprite] of this.sprites) {
      const on = pose.symbol === kind && pose.symbolAmount > 0.01;
      sprite.visible = on;
      if (!on) continue;
      const l = LAYOUT[kind];
      const m = l.move(this.t);
      const h = this.headHeight;
      sprite.position.set(this.anchor.x + (l.x + m.dx) * h, this.anchor.y + (l.y + m.dy) * h, this.anchor.z);
      const a = pose.symbolAmount;
      sprite.scale.setScalar(l.scale * h * m.s * (0.6 + 0.4 * a));
      sprite.material.opacity = Math.min(1, a * 1.4);
    }
  }
}
