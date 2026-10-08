# Vikaki Avatar Camera (browser extension)

Replaces your camera in browser meetings with a cartoon avatar that lip-syncs to your microphone.
Currently works on `https://meet.google.com/*` (Teams web and Zoom web are slice V1.8).

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
