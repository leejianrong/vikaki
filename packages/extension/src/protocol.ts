/** Messages between the isolated-world bridge and the main-world script, over window.postMessage. */
export const REQUEST = "vikaki:request-assets";
export const RESPONSE = "vikaki:assets";

export interface Assets {
  vrm: ArrayBuffer;
  profile: ArrayBuffer;
}
