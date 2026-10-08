# Vikaki Avatar Camera (browser extension)

Replaces your camera in browser meetings with a cartoon avatar that lip-syncs to your microphone.
Runs on Google Meet, Microsoft Teams web (`teams.microsoft.com`, `teams.live.com`, `teams.cloud.microsoft`) and Zoom web (`/wc/` client). Only Meet is the target of the browser tests so far; Teams and Zoom are enabled but untested on real calls (slice V1.8). The desktop Zoom and Teams apps are not covered; use OBS for those.

- The physical camera is never requested, so a camera blocked by policy makes no difference.
- Your microphone still goes to the call. Its audio is also analysed inside the page to move the mouth. Nothing is uploaded.
- Real cameras are hidden from the page's device list, so the page cannot pick one by accident.

## Install (unpacked, for testing)

```bash
make extension        # builds packages/extension/dist
```

Then in Chrome or Edge: open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked**, and select `packages/extension/dist`.

Building in WSL and running the browser on Windows: choose the folder through `\\wsl.localhost\<distro>\home\<you>\projects\abang-ai\vikaki\packages\extension\dist`.

Reload the meeting tab after installing. In the meeting's camera settings the camera is called **Vikaki Avatar**.

## Check it is working

In the meeting tab's DevTools console:

```js
__vikakiExt
// { avatarReady: true, mouthKind: "wlipsync", mouth: 0.4, physicalCameraRequests: 0, ... }
```

- `physicalCameraRequests` must stay `0`.
- `mouthKind: "wlipsync"` means vowel shapes. `"amplitude"` means the page's security policy blocked the vowel engine, so the mouth only opens and closes with loudness (`mouthReason` says why).
- `error` shows any problem; the avatar keeps working where it can.

## How it works

- `src/main-world.ts` runs in the page itself and replaces `getUserMedia`, `enumerateDevices` and the camera permission answer.
- `src/bridge.ts` runs in the extension's isolated world and fetches the avatar and lip-sync profile, because the page's content-security-policy can stop the page fetching extension files. It hands the bytes over with `postMessage`.
- `build.mjs` bundles both. Content scripts are classic scripts, so the build wraps the code, replaces `import.meta.url`, and fails if anything incompatible remains.

See `docs/adr/0009-meeting-extension-design.md`.

## Known limits

- Not yet tested on a real Meet call (slice V1.7). The browser tests use a stand-in meeting page.
- In a background tab the browser slows timers, so the avatar can move less smoothly.
- Meet, Teams and Zoom can change how they probe cameras at any time.

## Match patterns

`content_scripts[].matches` may include paths (Zoom's web client is `/wc/*`). `web_accessible_resources[].matches` may not: it only accepts origin-wide patterns ending in `/*`, and one bad entry makes the browser refuse the whole extension. The browser tests catch this, because every test fails when the extension does not load.

## Manual check on real sites

`scripts/real-site-check.mjs` loads the built extension and runs it on the official WebRTC sample pages (the device picker, and a call over a real `RTCPeerConnection`). It needs internet and is not part of CI, because a third-party site would make CI flaky.

```bash
node packages/extension/build.mjs --out /tmp/vikaki-ext --extra-match "https://webrtc.github.io/*"
node scripts/real-site-check.mjs /tmp/vikaki-ext /tmp/real-check.png
```
