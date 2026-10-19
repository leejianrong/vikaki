// What `table_state` looks like on the 3D table (VIK-62): cards, chips and the dealer button as plain meshes. Like the overlay, it draws
// what the game sent and holds no game logic. The layout and the chip counting are pure (and tested); `TableProps` is the three.js part.
import type { MessageOf } from "@vikaki/protocol";
import { CanvasTexture, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Sprite, SpriteMaterial, type Texture, Vector3 } from "three";
import { cardFace, SUIT_PATHS } from "./table.ts";
import { type Hold, middlePot, type Place, type Plan, planMotion } from "./table-motion.ts";
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
/** Where a folded hand is pushed to: just in front of the board, off the pot. */
const MUCK_AT = { x: 0, z: 0.02 };
/** Seconds a chip takes to fly, how far apart a flight's chips start, and the most chips shown in one flight. */
const FLIGHT_S = 0.6;
const FLIGHT_GAP_S = 0.06;
const FLIGHT_CHIPS = 6;
/** Where the cards are dealt and flipped in from (the deck), and how long a deal and a flip take (VIK-114). */
const DECK_AT = { x: 0.32, z: -0.34 };
const DEAL_S = 0.4;
const DEAL_GAP_S = 0.12;
const FLIP_S = 0.55;

/** One thing in the air: it moves from `a` to `b` along an arc after `delay` seconds, over `dur`, and may shrink and fade (a pushed-away card). */
interface Live {
  mesh: Mesh;
  a: Vector3;
  b: Vector3;
  delay: number;
  dur: number;
  arc: number;
  fade: boolean;
  /** A card turning over on its way (VIK-114): squashed to a line and back, its picture swapped at the middle. */
  flip?: { back: Texture; face: Texture };
  /** Stays where it landed until the whole flight ends (a dealt or flipped card, which has no static twin to show meanwhile). */
  stay?: boolean;
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
    // The rank on top and a big suit shape under it (VIK-141): the spade and the club are drawn as shapes, not font glyphs, so they differ at a glance.
    g.fillStyle = f.red ? "#c8352f" : "#1f2430";
    g.font = "bold 62px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(f.rank, 64, 44);
    const path = SUIT_PATHS[f.suit];
    if (path) {
      g.save();
      g.translate(24, 76);
      g.scale(0.8, 0.8);
      g.fill(new Path2D(path));
      g.restore();
    } else g.fillText(f.text, 64, 110);
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
  g.textAlign = "left";
  const w = g.measureText(text).width;
  const x = Math.max(24, (256 - (w + 64)) / 2);
  g.fillText(text, x, 50);
  // a chip beside the amount
  g.fillStyle = "#c8352f";
  g.beginPath();
  g.arc(x + w + 36, 48, 24, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#fdf8ee";
  g.lineWidth = 5;
  g.setLineDash([9, 7]);
  g.beginPath();
  g.arc(x + w + 36, 48, 16, 0, Math.PI * 2);
  g.stroke();
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
  private readonly chipGeometry = new CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 24);
  /** Chips and cards in the air, drawn over the table; the piles they leave and join are held as they were until the last lands. */
  private readonly air = new Group();
  private live: Live[] = [];
  private clock = 0;
  private flightEnd = 0;
  private current: State | undefined;
  private shown: State | undefined;
  private reduced = false;
  /** In the air now, for tests. */
  readonly motion = { flights: 0 };
  /** What is drawn now, for tests. */
  readonly drawn = { boardCards: 0, seatCards: [] as number[], chips: 0, dealer: undefined as string | undefined, /** The words on the pot's label, or undefined with no pot. */ pot: undefined as string | undefined, /** True when the hands on the table are shown face up (a showdown), false while they are face down. */ handsFaceUp: false, /** Cards lit up as the five that make the winning hand. */ highlighted: 0 };

  constructor(
    private readonly tableY: number,
    private readonly spots: SeatSpot[],
    private readonly seatIds: string[],
  ) {
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.chips = CHIPS.map((c) => {
      const m = new InstancedMesh(this.chipGeometry, new MeshStandardMaterial({ color: c.colour, roughness: 0.5 }), CHIP_CAPACITY);
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
    this.group.add(this.cards, this.button, this.potLabel, ...this.chips, this.air);
  }

  setState(state: State): void {
    const key = JSON.stringify(state);
    if (key === this.last) return;
    this.last = key;
    this.land(); // a new state while chips are in the air: they land at once
    const plan = this.reduced ? undefined : planMotion(this.shown, state, this.seatIds);
    this.shown = state;
    this.current = state;
    this.draw(state, plan?.hold);
    if (plan) this.launch(plan.flights, plan.mucks, plan);
  }

  /** Move what is in the air. Call it every frame with the seconds since the last. When the last lands, the real piles are drawn. */
  update(dt: number): void {
    if (this.live.length === 0) return;
    this.clock += dt;
    for (const f of this.live) {
      const p = Math.min(1, Math.max(0, (this.clock - f.delay) / f.dur));
      f.mesh.visible = p > 0 && (p < 1 || !!f.stay);
      if (f.flip) {
        f.mesh.scale.y = Math.max(0.02, Math.abs(Math.cos(Math.PI * p)));
        (f.mesh.material as MeshBasicMaterial).map = p < 0.5 ? f.flip.back : f.flip.face;
      }
      const e = p * p * (3 - 2 * p);
      f.mesh.position.lerpVectors(f.a, f.b, e).y += Math.sin(Math.PI * p) * f.arc;
      if (f.fade) {
        f.mesh.scale.setScalar(1 - 0.6 * e);
        (f.mesh.material as MeshBasicMaterial).opacity = 1 - e;
      }
    }
    if (this.clock >= this.flightEnd) this.land();
  }

  /** Finish whatever is in the air: take it away and draw the real piles. */
  private land(): void {
    if (this.live.length === 0) return;
    this.live = [];
    this.air.clear();
    this.motion.flights = 0;
    if (this.current) this.draw(this.current);
  }

  private where(p: Place): Vector3 {
    if (p.place === "pot") return new Vector3(POT_AT.x, this.tableY + 0.03, POT_AT.z);
    const slots = seatSlots(this.spots[p.seat]!);
    const at = p.place === "stack" ? slots.stack : slots.bet;
    return new Vector3(at.x, this.tableY + 0.03, at.z);
  }

  private launch(flights: { from: Place; to: Place; amount: number; after?: boolean }[], mucks: number[], plan?: Plan): void {
    this.clock = 0;
    let end = 0;
    let sweepEnd = 0;
    const jitter = (n: number) => new Vector3(Math.sin(n * 12.9898) * 0.025, 0, Math.cos(n * 78.233) * 0.025);
    for (const f of flights) {
      const kinds = chipCounts(f.amount).flatMap((n, kind) => Array<number>(n).fill(kind));
      const shown = kinds.length > FLIGHT_CHIPS ? Array.from({ length: FLIGHT_CHIPS }, (_, i) => kinds[Math.floor((i * kinds.length) / FLIGHT_CHIPS)]!) : kinds.length ? kinds : [CHIPS.length - 1];
      const base = f.after ? sweepEnd + 0.15 : 0;
      shown.forEach((kind, i) => {
        const mesh = new Mesh(this.chipGeometry, this.chips[kind]!.material);
        mesh.visible = false;
        this.air.add(mesh);
        const delay = base + i * FLIGHT_GAP_S;
        this.live.push({ mesh, a: this.where(f.from).add(jitter(i)), b: this.where(f.to).add(jitter(i + 7)), delay, dur: FLIGHT_S, arc: 0.16, fade: false });
        end = Math.max(end, delay + FLIGHT_S);
        if (!f.after) sweepEnd = Math.max(sweepEnd, delay + FLIGHT_S);
      });
    }
    for (const seat of mucks) {
      const slots = seatSlots(this.spots[seat]!);
      slots.cards.forEach((c, k) => {
        const mesh = new Mesh(this.holeGeometry, new MeshBasicMaterial({ map: cardTexture("back"), transparent: true }));
        mesh.rotation.order = "YXZ";
        mesh.rotation.set(-Math.PI / 2 + 0.12, k === 0 ? 0.08 : -0.08, 0);
        mesh.visible = false;
        this.air.add(mesh);
        this.live.push({ mesh, a: new Vector3(c.x, this.tableY + 0.02, c.z), b: new Vector3(MUCK_AT.x + (k - 0.5) * 0.04, this.tableY + 0.02, MUCK_AT.z), delay: k * FLIGHT_GAP_S, dur: FLIGHT_S + 0.1, arc: 0.1, fade: true });
        end = Math.max(end, k * FLIGHT_GAP_S + FLIGHT_S + 0.1);
      });
    }
    if (plan) end = Math.max(end, this.launchCards(plan));
    this.flightEnd = end;
    this.motion.flights = this.live.length;
  }

  /** Deal, and turn over the new board cards and the hands at a showdown (VIK-114, VIK-94). Returns when the last lands. */
  private launchCards(plan: Plan): number {
    let end = 0;
    const state = this.current;
    const y = this.tableY;
    const back = cardTexture("back");
    const add = (name: string, geometry: PlaneGeometry, a: Vector3, b: Vector3, lean: number, yaw: number, delay: number, dur: number, turns: boolean, arc: number) => {
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ map: turns ? back : cardTexture(name) }));
      mesh.rotation.order = "YXZ";
      mesh.rotation.set(-Math.PI / 2 + lean, yaw, 0);
      mesh.visible = false;
      this.air.add(mesh);
      this.live.push({ mesh, a, b, delay, dur, arc, fade: false, stay: true, ...(turns ? { flip: { back, face: cardTexture(name) } } : {}) });
      end = Math.max(end, delay + dur);
    };
    const hand = (i: number, k: number) => {
      const c = seatSlots(this.spots[i]!).cards;
      const p = c[Math.min(k, c.length - 1)]!;
      return { v: new Vector3(p.x, y + 0.006 + 0.001 * k, p.z), yaw: k === 0 ? 0.08 : -0.08 };
    };
    let n = 0;
    for (let k = 0; k < 2; k++) {
      for (const i of plan.deals) {
        const h = hand(i, k);
        add("back", this.holeGeometry, new Vector3(DECK_AT.x, y + 0.04, DECK_AT.z), h.v, 0.12, h.yaw, n++ * DEAL_GAP_S, DEAL_S, false, 0.1);
      }
    }
    const faces = state?.board ?? [];
    plan.boardFlips.forEach((k, j) => {
      const slot = boardSlots()[k]!;
      const at = new Vector3(slot.x, y + 0.004 + Math.sin(LEAN) * (BOARD_CARD.h / 2), BOARD_Z);
      add(faces[k]!, this.boardGeometry, new Vector3(DECK_AT.x, y + 0.04, DECK_AT.z), at, LEAN, 0, j * 0.2, FLIP_S, true, 0.12);
    });
    for (const i of plan.holeFlips) {
      state?.seats[i] && (state.seats.find((r) => r.seat_id === this.seatIds[i])?.cards ?? []).forEach((c, k) => {
        const h = hand(i, k);
        add(c, this.holeGeometry, h.v, h.v.clone().setY(h.v.y + 0.003), 0.12, h.yaw, k * 0.15, FLIP_S, true, 0.1);
      });
    }
    return end;
  }

  private draw(state: State, hold?: Hold): void {
    const y = this.tableY;
    this.cards.clear();
    /** `lean` raises the card's far edge toward the camera (negative x rotation from flat); `yaw` turns it about its own middle. */
    const card = (name: string, x: number, z: number, lift: number, lean: number, size: { h: number }, yaw = 0, geometry = this.holeGeometry, tone?: "lit" | "dim") => {
      const m = new Mesh(geometry, new MeshBasicMaterial({ map: cardTexture(name), color: tone === "dim" ? 0x8c8c8c : 0xffffff }));
      if (tone === "lit") {
        const glow = new Mesh(new PlaneGeometry((geometry.parameters.width as number) + 0.018, (geometry.parameters.height as number) + 0.018), new MeshBasicMaterial({ color: 0xffc83d }));
        glow.rotation.order = "YXZ";
        glow.rotation.set(-Math.PI / 2 + lean, yaw, 0);
        glow.position.set(x, y + 0.004 + lift + Math.sin(lean) * (size.h / 2) - 0.002, z);
        this.cards.add(glow);
      }
      m.rotation.order = "YXZ";
      m.rotation.set(-Math.PI / 2 + lean, yaw, 0);
      m.position.set(x, y + 0.004 + lift + Math.sin(lean) * (size.h / 2), z);
      this.cards.add(m);
    };
    const board = state.board ?? [];
    // At the win the five cards that make a winning hand are lit and lifted, the rest dimmed (VIK-94).
    const lit = new Set((state.winners ?? []).flatMap((w) => w.best ?? []));
    const winning = new Set((state.winners ?? []).filter((w) => w.best?.length).map((w) => w.seat_id));
    let highlighted = 0;
    this.drawn.boardCards = 0;
    board.forEach((c, i) => {
      if (hold?.board.has(i)) return; // still in the air being turned over
      this.drawn.boardCards++;
      const on = lit.has(c);
      if (on) highlighted++;
      card(c, boardSlots()[i]!.x, BOARD_Z, on ? 0.03 : 0, LEAN, BOARD_CARD, 0, this.boardGeometry, lit.size > 0 ? (on ? "lit" : "dim") : undefined);
    });
    // The hands on the table stay face down, like a real table, until the showdown turns them over; the panel beside the table shows them meanwhile.
    this.drawn.handsFaceUp = state.street === "showdown";

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
          if (hold?.hole.has(i)) return; // being dealt or turned over
          const p = slots.cards[all.length === 1 ? 0 : Math.min(k, 1)]!;
          const shown = this.drawn.handsFaceUp ? c : "back";
          const on = winning.has(row.seat_id) && lit.has(c);
          if (on) highlighted++;
          card(shown, p.x, p.z, 0.001 * k + (on ? 0.03 : 0), 0.12, HOLE_CARD, k === 0 ? 0.08 : -0.08, this.holeGeometry, lit.size > 0 && this.drawn.handsFaceUp ? (on ? "lit" : "dim") : undefined);
        });
        this.drawn.seatCards[i] = row.cards?.length ?? 0;
      }
      const stack = hold?.stack.get(i) ?? row.stack;
      const bet = hold?.bet.get(i) ?? row.bet ?? 0;
      put(stack, slots.stack.x, slots.stack.z, slots.across);
      if (bet) put(bet, slots.bet.x, slots.bet.z, slots.across);
      if (state.dealer === row.seat_id) {
        this.button.position.set(slots.button.x, y + 0.005, slots.button.z);
        this.buttonFace.map ??= buttonTexture();
        this.buttonFace.needsUpdate = true;
        this.button.visible = true;
        this.drawn.dealer = row.seat_id;
      }
    }
    this.drawn.highlighted = highlighted;
    const middle = hold?.middle ?? middlePot(state); // the pot counts the bets still in front of the players: draw only what is in the middle
    if (middle) put(middle, POT_AT.x, POT_AT.z, { x: 1, z: 0 });
    this.drawn.pot = state.pot ? `Pot: ${state.pot.toLocaleString("en-US")}` : undefined;
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
