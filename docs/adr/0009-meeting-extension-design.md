# ADR-0009: Meeting extension runs in the page, with an isolated-world bridge and a fallback mouth

- Status: Accepted
- Date: 2026-10-08
- Deciders: Jian, Claude (design from slice V1.6)

## Context

ADR-0003 chose a browser extension that replaces the camera in web meetings. Building it showed three constraints:

1. To replace `getUserMedia` the code must run in the page's own world, which makes it subject to the page's content-security-policy (CSP). A strict CSP can block the page fetching extension files and can block the `data:` URLs wLipSync uses for its WASM and audio worklet.
2. Content scripts are classic scripts. They cannot contain `import.meta` or top-level `await`, and wLipSync's bundle has both.
3. A video stream cannot carry transparency, and a hidden tab stops `requestAnimationFrame`.

## Decision

- A main-world content script replaces `getUserMedia`, `enumerateDevices` and the camera permission answer, renders the avatar to an off-screen canvas, and returns `canvas.captureStream()` as the video track. The physical camera is never requested.
- An isolated-world bridge fetches the avatar and lip-sync profile and passes the bytes to the main world with `postMessage`, so the page's CSP cannot block them.
- Lip sync is `createMouthDriver`: wLipSync if it starts, otherwise an amplitude-only mouth that needs no worklet or WASM. The mode is reported in `__vikakiExt.mouthKind`.
- wLipSync is loaded with a dynamic `import()`, so installing the camera patch is synchronous and never waits for WASM compilation.
- The build produces an ES bundle, replaces `import.meta.url`, wraps it in an async function, and fails if `import.meta` or `import`/`export` remain.
- The extension's stream has an opaque background (soft sky blue). A watchdog timer keeps the avatar moving when the tab is hidden.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Fetch assets from the main world | A strict CSP `connect-src` can block it |
| Isolated-world script only | Cannot replace the page's own `navigator.mediaDevices` |
| Require wLipSync, no fallback | A strict page policy would then leave the avatar frozen or the camera failing |
| Transparent background | Becomes black or white depending on the viewer, shown by testing |
| Bundle wLipSync eagerly | Top-level await would delay the camera patch and break the classic script format |

## Consequences

Buys robustness against strict page policies and a patch that is in place before page scripts run. Costs a larger bundle (about 920 KB, mostly Three.js and three-vrm), a vowel-less mouth in the fallback case, and a fragile dependence on how meeting sites probe cameras, which can change without notice. All of this is tested against a stand-in meeting page, not a real call. Slice V1.7 is the first real test.
