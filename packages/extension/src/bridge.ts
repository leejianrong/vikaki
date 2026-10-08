// Runs in the extension's isolated world. The page's content-security-policy can block the
// page's own world from fetching extension files, so this side fetches the avatar and lip-sync
// profile and hands over the bytes. Nothing here talks to the network beyond the extension itself.
import { REQUEST, RESPONSE, type Assets } from "./protocol.ts";

let cached: Promise<Assets> | undefined;

function load(): Promise<Assets> {
  cached ??= (async () => {
    const get = async (path: string) => (await fetch(chrome.runtime.getURL(path))).arrayBuffer();
    const [vrm, profile] = await Promise.all([get("assets/avatar.vrm"), get("assets/profile.bin")]);
    return { vrm, profile };
  })();
  return cached;
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.type !== REQUEST) return;
  load().then(
    (assets) => window.postMessage({ type: RESPONSE, ...assets }, window.location.origin),
    (err) => window.postMessage({ type: RESPONSE, error: String(err?.message ?? err) }, window.location.origin),
  );
});
