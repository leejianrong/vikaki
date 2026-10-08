import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { Vector3, type Object3D } from "three";
import { VISEMES, type AvatarRenderer, type VisemeWeights } from "./renderer.ts";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class VrmAvatar implements AvatarRenderer {
  private constructor(readonly vrm: VRM) {}

  static async load(url: string): Promise<VrmAvatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error(`${url} is not a VRM file`);
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

  setVisemes(weights: VisemeWeights): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    for (const v of VISEMES) em.setValue(v, clamp01(weights[v] ?? 0));
  }

  setBlink(amount: number): void {
    this.vrm.expressionManager?.setValue("blink", clamp01(amount));
  }

  update(dt: number): void {
    this.vrm.update(dt);
  }
}
