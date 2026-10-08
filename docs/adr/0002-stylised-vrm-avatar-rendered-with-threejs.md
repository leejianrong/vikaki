# ADR-0002: Stylised VRM avatars rendered in the browser with Three.js and three-vrm

- Status: Accepted
- Date: 2026-10-07
- Deciders: Jian

## Context

The initial discussion proposed Ready Player Me glTF avatars with ARKit blendshapes and uLipSync/OVR LipSync "compiled to WASM". Checking dependencies showed both are poor bases. Ready Player Me shut down its public services on 2026-01-31 after Netflix acquired it, and its APIs no longer work. uLipSync and OVR LipSync are Unity/Unreal libraries, and the browser port wLipSync needs a profile calibrated in Unity. The games brief independently recommends VRM with three-vrm as the cheapest, lowest-latency start, and argues a stylised character suits game opponents and avoids the uncanny valley.

## Decision

Render avatars as VRM 1.0 models in a browser page using Three.js and three-vrm. Drive the face from audio-derived viseme weights and emotion presets via VRM expressions. Choose a lip-sync library in slice 1 by spike (wawa-lipsync first, wLipSync as fallback). Do not depend on Ready Player Me.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Ready Player Me glTF + ARKit | Service is gone |
| Realistic glTF with 52 ARKit targets | Asset sourcing and licensing burden, uncanny valley |
| Live2D (2D) | Licensing and tooling friction; less body/hand headroom later |
| Neural talking heads (LivePortrait, SadTalker) | Per-stream GPU cost, and photoreal output is a non-goal (ADR-0005) |
| Hosted avatar APIs | Per-minute cost, vendor latency and control limits, and photoreal output is a non-goal (ADR-0005) |

## Consequences

Buys free, open tooling, near-zero render cost, a distinct look per seat, and a path to run in any browser. Costs expressiveness: VRM's built-in mouth shapes are five vowels, so lip sync will be coarser than ARKit's. Forecloses photoreal output, by design (ADR-0005). A redistributable default VRM avatar must be found or made (verified in V1).
