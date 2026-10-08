import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { Box3, Vector3, type Object3D } from "three";
import { VISEMES, type AvatarRenderer, type HeadPose, type VisemeWeights } from "./renderer.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class VrmAvatar implements AvatarRenderer {
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

  /** World position of the head bone, for camera framing. */
  headPosition(): Vector3 {
    this.vrm.scene.updateMatrixWorld(true);
    const head = this.vrm.humanoid.getNormalizedBoneNode("head");
    return head ? head.getWorldPosition(new Vector3()) : new Vector3(0, 1.4, 0);
  }

  /**
   * World height of the eyes: the eye bones if the model has them, otherwise 55% of the way
   * from the head bone to the top of the model, which is where eyes sit on most characters.
   */
  eyeLevel(): number {
    this.vrm.scene.updateMatrixWorld(true);
    const eyes = (["leftEye", "rightEye"] as const)
      .map((n) => this.vrm.humanoid.getNormalizedBoneNode(n))
      .filter((n): n is NonNullable<typeof n> => n != null)
      .map((n) => n.getWorldPosition(new Vector3()).y);
    if (eyes.length > 0) return eyes.reduce((a, b) => a + b, 0) / eyes.length;
    const headY = this.headPosition().y;
    const top = new Box3().setFromObject(this.vrm.scene).max.y;
    return headY + 0.55 * (top - headY);
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
}
