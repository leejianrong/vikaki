import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { Box3, Vector3, type Mesh, type Object3D, type SkinnedMesh } from "three";
import { VISEMES, type AvatarFraming, type HeadPose, type SceneAvatar, type SeatPose, type VisemeWeights } from "./renderer.ts";
import type { ArmOffsets } from "./arm-act.ts";
import { applySeat, DEFAULT_SEAT_POSE, handHeight, kneeReach, poseArm, type BoneOf } from "./seat-pose.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class VrmAvatar implements SceneAvatar {
  private constructor(readonly vrm: VRM) {}

  /** `source` is a URL to fetch or the VRM file's bytes (when a page cannot fetch). */
  static async load(source: string | ArrayBuffer): Promise<VrmAvatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = typeof source === "string" ? await loader.loadAsync(source) : await loader.parseAsync(source, "");
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error(`${typeof source === "string" ? source : "the given data"} is not a VRM file`);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // VRM 0.x faces -Z; turn it to face the camera
    return new VrmAvatar(vrm);
  }

  get scene(): Object3D {
    return this.vrm.scene;
  }

  framing(): AvatarFraming {
    const head = this.headPosition();
    return { head, top: new Box3().setFromObject(this.vrm.scene).max.y, eyeLevel: this.eyeLevel(), eyeBones: this.hasEyeBones(), width: this.bodyWidth() };
  }

  /** Shoulder to shoulder (a little more, for the body), or the whole model's width if it has no arm bones. */
  bodyWidth(): number {
    this.vrm.scene.updateMatrixWorld(true);
    const [l, r] = (["leftUpperArm", "rightUpperArm"] as const).map((n) => this.vrm.humanoid.getNormalizedBoneNode(n));
    if (l && r) return Math.max(0.3, l.getWorldPosition(new Vector3()).distanceTo(r.getWorldPosition(new Vector3())) * 1.5);
    const box = new Box3().setFromObject(this.vrm.scene);
    return box.max.x - box.min.x;
  }

  /**
   * How wide the avatar is between two heights, as posed now (skinning applied, so lowered arms and a turned body count). The shoulder
   * estimate in `bodyWidth` misses arms, sticks and hats, and a layout that promises a clear band needs the real thing. The vertices are
   * read once, into 2 cm bands of world height; the returned function answers for any range from those.
   */
  widthProfile(): (lo: number, hi: number) => number {
    this.vrm.update(0); // the normalized bones reach the skeleton on update
    this.vrm.scene.updateMatrixWorld(true);
    const STEP = 0.02;
    const min = new Map<number, number>();
    const max = new Map<number, number>();
    const v = new Vector3();
    this.vrm.scene.traverse((o) => {
      const mesh = o as SkinnedMesh;
      const pos = mesh.isMesh ? mesh.geometry.getAttribute("position") : undefined;
      if (!pos) return;
      mesh.skeleton?.update();
      for (let i = 0; i < pos.count; i++) {
        if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, v);
        else v.fromBufferAttribute(pos, i);
        v.applyMatrix4(mesh.matrixWorld);
        const band = Math.floor(v.y / STEP);
        if (v.x < (min.get(band) ?? Infinity)) min.set(band, v.x);
        if (v.x > (max.get(band) ?? -Infinity)) max.set(band, v.x);
      }
    });
    const fallback = this.bodyWidth();
    return (lo, hi) => {
      let l = Infinity;
      let r = -Infinity;
      for (let band = Math.floor(lo / STEP); band <= Math.floor(hi / STEP); band++) {
        l = Math.min(l, min.get(band) ?? Infinity);
        r = Math.max(r, max.get(band) ?? -Infinity);
      }
      return r > l ? r - l : fallback;
    };
  }

  /**
   * Let the arms hang at the sides, `radians` down from the T-pose. Avatars standing shoulder to shoulder read as stiff cut-outs with
   * their arms out, and the arms of neighbours would cross.
   */
  lowerArms(radians = 1.2): void {
    const h = this.vrm.humanoid;
    h.getNormalizedBoneNode("leftUpperArm")?.rotation.set(0, 0, radians);
    h.getNormalizedBoneNode("rightUpperArm")?.rotation.set(0, 0, -radians);
  }

  private readonly bone: BoneOf = (name) => this.vrm.humanoid.getNormalizedBoneNode(name);

  /** True when the model has the hips bone `seat` needs. */
  get canSeat(): boolean {
    return this.bone("hips") != null;
  }

  /** The arms' seated numbers, kept so an act can move them and bring them back (VIK-137); undefined until seated, or when the arms just hang. */
  private armBase: { forward: number; down: number; elbow: number } | undefined;
  private armsMoved = false;

  canAct(): boolean {
    return this.armBase !== undefined && (["leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm"] as const).every((n) => this.bone(n) != null);
  }

  /** Shrink the raw head bone (the normalized rig carries no scale), so the camera at the eyes sees the room and not the inside of the head. */
  setHeadHidden(hidden: boolean): void {
    this.vrm.humanoid.getRawBoneNode("head")?.scale.setScalar(hidden ? 0.001 : 1);
  }

  setArmOffsets(o: ArmOffsets): void {
    const base = this.armBase;
    if (!base) return;
    const moved = [o.left, o.right].some((a) => a.forward !== 0 || a.down !== 0 || a.elbow !== 0);
    if (!moved && !this.armsMoved) return;
    this.armsMoved = moved;
    for (const side of ["left", "right"] as const) {
      const d = o[side];
      poseArm(this.bone, side, { forward: base.forward + d.forward, down: base.down + d.down, elbow: base.elbow + d.elbow });
    }
  }

  seat(pose?: SeatPose): boolean {
    if (!this.canSeat) return false;
    applySeat(this.bone, pose);
    const arms = pose?.arms ?? DEFAULT_SEAT_POSE.arms;
    this.armBase = arms === "hang" ? undefined : { ...arms };
    this.vrm.update(0); // the normalized bones reach the skeleton on update
    return true;
  }

  /** How far the knees are ahead of the hips toward (`dirX`, `dirZ`), a unit direction on the floor (see `kneeReach`). */
  kneeReach(dirX: number, dirZ: number): number | undefined {
    this.vrm.scene.updateMatrixWorld(true);
    return kneeReach(this.bone, dirX, dirZ);
  }

  handHeight(): number | undefined {
    this.vrm.scene.updateMatrixWorld(true);
    return handHeight(this.bone);
  }

  /** World position of the head bone, for camera framing. */
  headPosition(): Vector3 {
    this.vrm.scene.updateMatrixWorld(true);
    const head = this.vrm.humanoid.getNormalizedBoneNode("head");
    return head ? head.getWorldPosition(new Vector3()) : new Vector3(0, 1.4, 0);
  }

  /**
   * World height of the eyes: the eye bones if the model has them, otherwise where its blink shape moves the eyelids,
   * otherwise 55% of the way from the head bone to the top of the model. (The last is a poor guess for a character in a tall
   * hat: Snowy's face was cropped.)
   */
  eyeLevel(): number {
    this.vrm.scene.updateMatrixWorld(true);
    const eyes = (["leftEye", "rightEye"] as const)
      .map((n) => this.vrm.humanoid.getNormalizedBoneNode(n))
      .filter((n): n is NonNullable<typeof n> => n != null)
      .map((n) => n.getWorldPosition(new Vector3()).y);
    if (eyes.length > 0) return eyes.reduce((a, b) => a + b, 0) / eyes.length;
    const fromBlink = this.blinkEyeLevel();
    if (fromBlink !== undefined) return fromBlink;
    const headY = this.headPosition().y;
    const top = new Box3().setFromObject(this.vrm.scene).max.y;
    return headY + 0.55 * (top - headY);
  }

  /**
   * World height of the eyes, read from the model: the blink expression moves the eyelid vertices and nothing else, so their
   * average height is where the eyes are, whatever hat or hair sits above. Undefined if the model has no usable blink shape.
   */
  blinkEyeLevel(): number | undefined {
    const blink = this.vrm.expressionManager?.getExpression("blink");
    if (!blink) return undefined;
    this.vrm.scene.updateMatrixWorld(true);
    const v = new Vector3();
    let sum = 0;
    let count = 0;
    for (const b of blink.binds) {
      const bind = b as unknown as { primitives?: Mesh[]; index?: number };
      if (!bind.primitives || bind.index === undefined) continue;
      for (const mesh of bind.primitives) {
        const base = mesh.geometry.getAttribute("position");
        const morph = mesh.geometry.morphAttributes.position?.[bind.index];
        if (!base || !morph) continue;
        for (let i = 0; i < base.count; i++) {
          // relative morph targets store the offset; absolute ones store the moved position
          const dx = mesh.geometry.morphTargetsRelative ? morph.getX(i) : morph.getX(i) - base.getX(i);
          const dy = mesh.geometry.morphTargetsRelative ? morph.getY(i) : morph.getY(i) - base.getY(i);
          const dz = mesh.geometry.morphTargetsRelative ? morph.getZ(i) : morph.getZ(i) - base.getZ(i);
          if (Math.hypot(dx, dy, dz) < 1e-4) continue;
          v.fromBufferAttribute(base, i).applyMatrix4(mesh.matrixWorld);
          sum += v.y;
          count++;
        }
      }
    }
    return count > 0 ? sum / count : undefined;
  }

  /** Where the eye bones were found, for diagnostics. */
  hasEyeBones(): boolean {
    return (["leftEye", "rightEye"] as const).some((n) => this.vrm.humanoid.getNormalizedBoneNode(n) != null);
  }

  setVisemes(weights: VisemeWeights): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    for (const v of VISEMES) em.setValue(v, clamp01(weights[v] ?? 0));
  }

  setBlink(amount: number): void {
    this.vrm.expressionManager?.setValue("blink", clamp01(amount));
  }

  setHeadPose(pose: HeadPose): void {
    this.vrm.humanoid.getNormalizedBoneNode("head")?.rotation.set(pose.pitch, pose.yaw, pose.roll);
  }

  update(dt: number): void {
    this.vrm.update(dt);
  }

  /**
   * The mouth as displayed, read from the morph targets behind each shape's expression after `update`, which is
   * where overrides (a smile that blocks the mouth) and binary snapping have already been applied. A shape that
   * moves no morph target (colour or texture binds) falls back to the expression's own weight.
   */
  appliedVisemes(): VisemeWeights {
    const em = this.vrm.expressionManager;
    const out: VisemeWeights = {};
    if (!em) return out;
    for (const v of VISEMES) {
      const e = em.getExpression(v);
      if (!e) continue;
      const shown: number[] = [];
      for (const b of e.binds) {
        const bind = b as unknown as { primitives?: { morphTargetInfluences?: number[] }[]; index?: number; weight?: number };
        if (!bind.primitives || bind.index === undefined || !bind.weight) continue;
        for (const mesh of bind.primitives) {
          const influence = mesh.morphTargetInfluences?.[bind.index];
          if (influence !== undefined) shown.push(clamp01(influence / bind.weight));
        }
      }
      out[v] = shown.length > 0 ? shown.reduce((a, b) => a + b, 0) / shown.length : clamp01(e.weight);
    }
    return out;
  }
}
