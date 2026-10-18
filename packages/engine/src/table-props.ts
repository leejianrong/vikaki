// What `table_state` looks like on the 3D table (VIK-62): cards, chips and the dealer button as plain meshes. Like the overlay, it draws
// what the game sent and holds no game logic. The layout and the chip counting are pure (and tested); `TableProps` is the three.js part.
import type { MessageOf } from "@vikaki/protocol";
import { CanvasTexture, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Sprite, SpriteMaterial, type Texture } from "three";
import { cardFace } from "./table.ts";
import type { SeatSpot } from "./table3d.ts";

type State = MessageOf<"table_state">;

/** Chip colours, richest first, with what each is worth. */
export const CHIPS = [
  { colour: 0x24262b, value: 100 },
  { colour: 0x2d5fbf, value: 25 },
  { colour: 0xc8352f, value: 5 },
  { colour: 0xe8e4d8, value: 1 },
] as const;

/** Most chips drawn in one column: a stack of 10 000 is a tall tower, not a bigger number. This is for the eye, not for counting. */
export const MAX_COLUMN = 10;

/** How many chips of each colour make up `amount`, richest first, each capped at `MAX_COLUMN`. */
export function chipCounts(amount: number): number[] {
  let left = Math.max(0, Math.floor(amount));
  return CHIPS.map((c) => {
    const n = Math.floor(left / c.value);
    left -= n * c.value;
    return Math.min(n, MAX_COLUMN);
  });
}

export interface ChipSpot {
  /** Index into `CHIPS`. */
  kind: number;
  x: number;
  y: number;
  z: number;
}

const CHIP_H = 0.016;
const CHIP_R = 0.036;
const COLUMN_GAP = 0.078;
/** Sizes in metres: the board is big enough to read from the camera, a hand a little smaller. A real card is about 0.064 by 0.089: these are cartoon-sized. */
export const BOARD_CARD = { w: 0.12, h: 0.168, gap: 0.146 } as const;
export const HOLE_CARD = { w: 0.1, h: 0.14 } as const;
/** How far the board's cards lean back toward the camera, in radians, so they are not seen edge-on from a low angle. */
const LEAN = 0.6;

/** Where the chips of `amount` go: one column per colour, side by side along `across` (a unit vector), centred on (`cx`, `cz`), standing on `baseY`. */
export function chipPile(amount: number, cx: number, cz: number, across: { x: number; z: number }, baseY: number): ChipSpot[] {
  const counts = chipCounts(amount);
  const columns = counts.flatMap((n, kind) => (n > 0 ? [{ kind, n }] : []));
  const spots: ChipSpot[] = [];
  columns.forEach((col, i) => {
    const off = (i - (columns.length - 1) / 2) * COLUMN_GAP;
    for (let k = 0; k < col.n; k++) spots.push({ kind: col.kind, x: cx + across.x * off, z: cz + across.z * off, y: baseY + CHIP_H / 2 + k * CHIP_H });
  });
  return spots;
}

/** Where a seat's things sit on the table, measured from the seat straight in toward the table (not from the middle: the table is an oval). */
export interface SeatSlots {
  cards: { x: number; z: number }[];
  stack: { x: number; z: number };
  bet: { x: number; z: number };
  button: { x: number; z: number };
  /** Unit vector across that line (to the seat's right as the camera sees it). */
  across: { x: number; z: number };
}

/** The five places the board's cards go, left to right, on the felt (x and z). */
export function boardSlots(): { x: number; z: number }[] {
  return Array.from({ length: 5 }, (_, i) => ({ x: (i - 2) * BOARD_CARD.gap, z: BOARD_Z }));
}

export function seatSlots(spot: SeatSpot): SeatSlots {
  const fx = Math.sin(spot.facing); // forward: from the seat straight in, toward the table
  const fz = Math.cos(spot.facing);
  const across = { x: fz, z: -fx }; // to the seat's right as the camera sees it
  const at = (ahead: number, side = 0) => ({ x: spot.x + fx * ahead + across.x * side, z: spot.z + fz * ahead + across.z * side });
  return { cards: [at(0.5, -0.07), at(0.5, 0.07)], stack: at(0.42, 0.24), bet: at(0.72, 0.13), button: at(0.42, -0.22), across };
}

/** Where the middle of the board's row lies, a little toward the far side so the pot's chips are in front of it. */
const BOARD_Z = -0.14;
const POT_AT = { x: 0, z: 0.3 };

const cardTextures = new Map<string, Texture>();

function cardTexture(card: string): Texture {
  const hit = cardTextures.get(card);
  if (hit) return hit;
  const f = cardFace(card);
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 180;
  const g = c.getContext("2d")!;
  g.fillStyle = f.down ? "#b4442f" : "#fdf8ee";
  g.fillRect(0, 0, 128, 180);
  g.strokeStyle = f.down ? "#f2d9c2" : "#8a7d6a";
  g.lineWidth = f.down ? 10 : 4;
  g.strokeRect(f.down ? 10 : 2, f.down ? 10 : 2, f.down ? 108 : 124, f.down ? 160 : 176);
  if (!f.down) {
    g.fillStyle = f.red ? "#c8352f" : "#1f2430";
    g.font = "bold 56px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(f.text, 64, 92);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  cardTextures.set(card, t);
  return t;
}

/** A sprite with `text` on a rounded plate: the pot's label over its chips. Redrawn when the text changes. */
function labelTexture(text: string): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(20,24,30,0.78)";
  g.beginPath();
  g.roundRect(4, 4, 248, 88, 44);
  g.fill();
  g.fillStyle = "#fdf8ee";
  g.font = "bold 52px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 50);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function buttonTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fdf8ee";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#6b4e16";
  g.font = "bold 84px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("D", 64, 70);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Most chips one colour can draw at once, over every column on the table. */
const CHIP_CAPACITY = 400;

export class TableProps {
  readonly group = new Group();
  private readonly cards = new Group();
  private readonly chips: InstancedMesh[];
  private readonly button: Mesh;
  private readonly boardGeometry = new PlaneGeometry(BOARD_CARD.w, BOARD_CARD.h);
  private readonly holeGeometry = new PlaneGeometry(HOLE_CARD.w, HOLE_CARD.h);
  private readonly potLabel = new Sprite(new SpriteMaterial({ transparent: true, depthTest: false }));
  private potText = "";
  /** The button's top, textured with a "D" the first time it is shown (drawing needs a document, which a plain construction does not). */
  private readonly buttonFace = new MeshBasicMaterial({ color: 0xfdf8ee });
  private last = "";
  /** What is drawn now, for tests. */
  readonly drawn = { boardCards: 0, seatCards: [] as number[], chips: 0, dealer: undefined as string | undefined, /** The words on the pot's label, or undefined with no pot. */ pot: undefined as string | undefined, /** True when the hands on the table are shown face up (a showdown), false while they are face down. */ handsFaceUp: false };

  constructor(
    private readonly tableY: number,
    private readonly spots: SeatSpot[],
    private readonly seatIds: string[],
  ) {
    const geometry = new CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 24);
    this.chips = CHIPS.map((c) => {
      const m = new InstancedMesh(geometry, new MeshStandardMaterial({ color: c.colour, roughness: 0.5 }), CHIP_CAPACITY);
      m.count = 0;
      m.frustumCulled = false; // its bounding sphere is taken while empty, so it would be culled for good
      return m;
    });
    const face = this.buttonFace;
    this.button = new Mesh(new CylinderGeometry(0.048, 0.048, 0.014, 32), [new MeshStandardMaterial({ color: 0xfdf8ee, roughness: 0.4 }), face, face]);
    this.button.visible = false;
    this.potLabel.visible = false;
    this.potLabel.scale.set(0.3, 0.1125, 1);
    this.potLabel.renderOrder = 10;
    // five outlines where the board's cards will land, so an empty flop, turn and river are visible as places on the felt
    const slotMat = new MeshBasicMaterial({ color: 0x1f5a38 });
    for (let i = 0; i < 5; i++) {
      const slot = new Mesh(new PlaneGeometry(BOARD_CARD.w + 0.012, BOARD_CARD.h + 0.012), slotMat);
      slot.rotation.x = -Math.PI / 2;
      slot.position.set(boardSlots()[i]!.x, tableY + 0.0015, BOARD_Z);
      this.group.add(slot);
    }
    this.group.add(this.cards, this.button, this.potLabel, ...this.chips);
  }

  setState(state: State): void {
    const key = JSON.stringify(state);
    if (key === this.last) return;
    this.last = key;
    const y = this.tableY;
    this.cards.clear();
    /** `lean` raises the card's far edge toward the camera (negative x rotation from flat); `yaw` turns it about its own middle. */
    const card = (name: string, x: number, z: number, lift: number, lean: number, size: { h: number }, yaw = 0, geometry = this.holeGeometry) => {
      const m = new Mesh(geometry, new MeshBasicMaterial({ map: cardTexture(name) }));
      m.rotation.order = "YXZ";
      m.rotation.set(-Math.PI / 2 + lean, yaw, 0);
      m.position.set(x, y + 0.004 + lift + Math.sin(lean) * (size.h / 2), z);
      this.cards.add(m);
    };
    const board = state.board ?? [];
    board.forEach((c, i) => card(c, boardSlots()[i]!.x, BOARD_Z, 0, LEAN, BOARD_CARD, 0, this.boardGeometry));
    // The hands on the table stay face down, like a real table, until the showdown turns them over; the panel beside the table shows them meanwhile.
    this.drawn.handsFaceUp = state.street === "showdown";
    this.drawn.boardCards = board.length;
    this.drawn.seatCards = this.seatIds.map(() => 0);

    const piles: ChipSpot[][] = [[], [], [], []];
    const put = (amount: number, cx: number, cz: number, across: { x: number; z: number }) => {
      for (const s of chipPile(amount, cx, cz, across, y)) piles[s.kind]!.push(s);
    };
    this.drawn.dealer = undefined;
    this.button.visible = false;
    for (const row of state.seats) {
      const i = this.seatIds.indexOf(row.seat_id);
      if (i < 0) continue;
      const slots = seatSlots(this.spots[i]!);
      if (!row.folded) {
        (row.cards ?? []).forEach((c, k, all) => {
          const p = slots.cards[all.length === 1 ? 0 : Math.min(k, 1)]!;
          const shown = this.drawn.handsFaceUp ? c : "back";
          card(shown, p.x, p.z, 0.001 * k, 0.12, HOLE_CARD, k === 0 ? 0.08 : -0.08);
        });
        this.drawn.seatCards[i] = row.cards?.length ?? 0;
      }
      put(row.stack, slots.stack.x, slots.stack.z, slots.across);
      if (row.bet) put(row.bet, slots.bet.x, slots.bet.z, slots.across);
      if (state.dealer === row.seat_id) {
        this.button.position.set(slots.button.x, y + 0.005, slots.button.z);
        this.buttonFace.map ??= buttonTexture();
        this.buttonFace.needsUpdate = true;
        this.button.visible = true;
        this.drawn.dealer = row.seat_id;
      }
    }
    if (state.pot) put(state.pot, POT_AT.x, POT_AT.z, { x: 1, z: 0 });
    this.drawn.pot = state.pot ? `Pot ${state.pot.toLocaleString("en-US")}` : undefined;
    if (this.drawn.pot !== this.potText) {
      this.potText = this.drawn.pot ?? "";
      const old = this.potLabel.material.map;
      this.potLabel.material.map = this.drawn.pot ? labelTexture(this.drawn.pot) : null;
      this.potLabel.material.needsUpdate = true;
      old?.dispose();
    }
    this.potLabel.visible = Boolean(state.pot);
    this.potLabel.position.set(POT_AT.x, y + 0.07, POT_AT.z + 0.17); // in front of the chips, below the board
    const m = new Matrix4();
    let total = 0;
    this.chips.forEach((mesh, kind) => {
      const list = piles[kind]!.slice(0, CHIP_CAPACITY);
      list.forEach((s, n) => mesh.setMatrixAt(n, m.makeTranslation(s.x, s.y, s.z)));
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      total += list.length;
    });
    this.drawn.chips = total;
  }
}
