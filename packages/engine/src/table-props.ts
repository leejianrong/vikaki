// What `table_state` looks like on the 3D table (VIK-62): cards, chips and the dealer button as plain meshes. Like the overlay, it draws
// what the game sent and holds no game logic. The layout and the chip counting are pure (and tested); `TableProps` is the three.js part.
import type { MessageOf } from "@vikaki/protocol";
import { CanvasTexture, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Texture } from "three";
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

const CHIP_H = 0.012;
const COLUMN_GAP = 0.055;

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

/** Where a seat's things sit on the table, on the line from the middle of the table to the seat. */
export interface SeatSlots {
  cards: { x: number; z: number }[];
  stack: { x: number; z: number };
  bet: { x: number; z: number };
  button: { x: number; z: number };
  /** Unit vector across that line (to the seat's right as the camera sees it). */
  across: { x: number; z: number };
}

export function seatSlots(spot: SeatSpot): SeatSlots {
  const len = Math.hypot(spot.x, spot.z) || 1;
  const ux = spot.x / len; // outward, from the middle toward the seat
  const uz = spot.z / len;
  const across = { x: -uz, z: ux }; // a quarter turn
  const at = (r: number, side = 0) => ({ x: ux * r + across.x * side, z: uz * r + across.z * side });
  return { cards: [at(0.52, -0.06), at(0.52, 0.06)], stack: at(0.6, 0.2), bet: at(0.36, 0.1), button: at(0.62, -0.19), across };
}

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

/** Most chips one colour can draw at once, over every column on the table. */
const CHIP_CAPACITY = 400;

export class TableProps {
  readonly group = new Group();
  private readonly cards = new Group();
  private readonly chips: InstancedMesh[];
  private readonly button: Mesh;
  private readonly cardGeometry = new PlaneGeometry(0.084, 0.118);
  private last = "";
  /** What is drawn now, for tests. */
  readonly drawn = { boardCards: 0, seatCards: [] as number[], chips: 0, dealer: undefined as string | undefined };

  constructor(
    private readonly tableY: number,
    private readonly spots: SeatSpot[],
    private readonly seatIds: string[],
  ) {
    const geometry = new CylinderGeometry(0.026, 0.026, CHIP_H, 20);
    this.chips = CHIPS.map((c) => {
      const m = new InstancedMesh(geometry, new MeshStandardMaterial({ color: c.colour, roughness: 0.5 }), CHIP_CAPACITY);
      m.count = 0;
      m.frustumCulled = false; // its bounding sphere is taken while empty, so it would be culled for good
      return m;
    });
    this.button = new Mesh(new CylinderGeometry(0.03, 0.03, 0.01, 24), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    this.button.visible = false;
    this.group.add(this.cards, this.button, ...this.chips);
  }

  setState(state: State): void {
    const key = JSON.stringify(state);
    if (key === this.last) return;
    this.last = key;
    const y = this.tableY;
    this.cards.clear();
    const card = (name: string, x: number, z: number, lift: number) => {
      const m = new Mesh(this.cardGeometry, new MeshBasicMaterial({ map: cardTexture(name) }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y + 0.002 + lift, z);
      this.cards.add(m);
    };
    const board = state.board ?? [];
    board.forEach((c, i) => card(c, (i - (board.length - 1) / 2) * 0.1, -0.02, 0));
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
          card(c, p.x, p.z, 0.001 * k);
        });
        this.drawn.seatCards[i] = row.cards?.length ?? 0;
      }
      put(row.stack, slots.stack.x, slots.stack.z, slots.across);
      if (row.bet) put(row.bet, slots.bet.x, slots.bet.z, slots.across);
      if (state.dealer === row.seat_id) {
        this.button.position.set(slots.button.x, y + 0.005, slots.button.z);
        this.button.visible = true;
        this.drawn.dealer = row.seat_id;
      }
    }
    if (state.pot) put(state.pot, 0, 0.12, { x: 1, z: 0 });
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
