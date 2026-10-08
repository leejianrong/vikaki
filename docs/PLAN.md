# Vikaki: Plan

Status: agreed · Milestone: M1 (human mic-only avatar, then LLM text driver)

Companion files: [SLICES.md](SLICES.md) (build handoff), [QUESTIONS.md](QUESTIONS.md) (decision register), `adr/` (0001 protocol, 0002 VRM and Three.js, 0003 delivery, 0004 licence). Board: Pandan board 35, "Vikaki", one epic per slice.

Sources: [initial-chat.md](initial-chat.md), and the consumer brief at `/home/jian/projects/games/agent-game-framework/docs/AVATAR-PROJECT-BRIEF.md` (the "games brief").

## Problem

Jian joins Zoom and Google Meet calls with the mic on but the webcam forbidden by security policy. A blank tile or static photo feels cold to the people on the call, and the existing voice-driven virtual cameras (xpression camera, Animaze) are closed, desktop-only and not built to be driven by anything other than a human voice.

Separately, Jian is building LLM-driven games and agent teams whose AI seats need a voice and a face. Today they have text only. The same avatar engine should serve both: a human talking into a mic, and an LLM producing text.

## Solution

`vikaki` is a small open-source engine. You run `vikaki serve`, open a local page, and a stylised 3D avatar appears. It lip-syncs to whatever audio you feed it, blinks, sways and reacts. In human mode the audio is your mic, and a browser extension hands the avatar to Meet, Teams web or Zoom web as your camera, so no OBS or driver is needed. For desktop apps, the same page works through OBS. In driver mode a program (a script, or an LLM over MCP) sends text, vikaki speaks it with TTS, and the avatar talks. The renderer cannot tell the two apart. The same page can also just be watched in a browser, with no meeting involved, which is how you will eventually watch LLMs play poker.

## Users and actors

1. **Jian, on a call** (primary, M1): human speaker, mic-only.
2. **A driver program** (M1 slice 2): an LLM or script sending `utterance` events. When a human and a driver conflict, the avatar has one active driver at a time and rejects the second (Q12).
3. **Games and agent apps** (deferred): consumers such as `agent-game-framework`, which sends events and never knows about rendering (see §Deferred).

## Scope

**In M1**

- Stylised VRM avatar rendered in a browser page with Three.js and three-vrm (ADR-0002). 2D renderers are allowed alongside it (ADR-0008).
- Mic-driven lip sync plus idle behaviour, delivered into browser meetings by an extension, with OBS and window share as fallbacks (ADR-0003).
- An MCP server so an LLM can make the avatar speak, emote and cancel (slice V2).
- A versioned WebSocket event protocol shaped to match the games brief (ADR-0001).
- A text-driven mode: streaming text → TTS → audio → same lip sync, with start/finish/cancel events.
- Seven emotion hints, named personas, a thinking/idle state.
- `vikaki` CLI on Ubuntu first, runnable in a container, also working on Windows.
- Fake TTS and fake driver so tests need no GPU, no keys, no network.
- Apache-2.0 (ADR-0004).

**Out of M1 (recorded in §Deferred)**

- Hosted SaaS, SFU, billing, accounts.
- Use case 2 (agent software-demo presenter) and use case 3 (game table avatars).
- Speech-to-text and `human_utterance`.
- Photoreal or human-mimicking avatars: a non-goal, not a deferral (ADR-0005). The project is cartoon-first.
- A custom virtual-camera driver or Electron app.
- A multi-avatar spectator table (the poker view). This is the first follow-up after M1, since it is the stated end goal for the LLM use case.
- Hand and full-body gestures beyond a few baked clips.

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | A human speaking into a mic with the webcam off shows up as a lip-synced avatar in a Zoom or Meet call | Core goal |
| R1 | One renderer, any driver: mic audio, TTS audio and MCP tool calls take the same path to the face | Must-have |
| R2 | Avatar looks alive without input: blinking, sway, idle loop, thinking state | Must-have |
| R3 | Streaming text in produces audio within about a second; cancel stops audio and returns to idle quickly | Must-have |
| R4 | Seven emotion hints, falling back to neutral when missing or unknown | Must-have |
| R5 | Named personas (voice + avatar + style) selected by name | Must-have |
| R6 | Human mode works fully offline with no network calls | Must-have |
| R7 | Runs from the CLI on Ubuntu and Windows, and in a container | Must-have |
| R8 | Full test suite runs with no GPU, API keys or network | Must-have |
| R9 | Lifecycle events back to the driver: `speech_started`, `speech_finished`, `speech_interrupted`, `error` | Must-have |
| R10 | The avatar can be watched locally as a live video feed, with no meeting involved: a browser page from V1, and a real video stream other local software can open from V4 | Must-have |

## Shape

| Part | Mechanism | ADR |
|------|-----------|-----|
| S1 | **Renderer page**: Three.js + three-vrm scene loading a VRM file, exposing blendshape/expression setters | ADR-0002 |
| S2 | **Lip-sync node**: WebAudio analyser → viseme weights, fed by either the mic stream or the TTS playback node | ADR-0002 |
| S3 | **Behaviour layer**: blink timer, idle sway, thinking pose, emotion presets, prosody-driven head nods (mic mode) | |
| S4 | **Hub server**: Node/TypeScript process that serves the page and a WebSocket; one driver connection, one or more viewer pages | ADR-0001 |
| S5 | **TTS adapter**: streaming interface with a fake and one local engine; sentence chunks out as audio frames | |
| S6 | **CLI**: `vikaki serve`, `vikaki say`, `vikaki cancel`, `vikaki check` | |
| S7 | **Persona config**: YAML file mapping name → VRM path, voice id, default emotion, style | |
| S8 | **Meeting extension**: MV3 content script on Meet/Teams/Zoom web that wraps `getUserMedia`, `enumerateDevices` and `permissions.query` and substitutes the avatar canvas track for video | ADR-0003 |
| S9 | **MCP adapter**: MCP server exposing `say`, `set_emotion`, `cancel`, `set_persona` as a thin driver over the hub | ADR-0001 |
| S11 | **Local video feed**: `/avatar` page for browser viewing (V1), then `vikaki stream`, which renders headless and publishes MJPEG over HTTP (and optionally a v4l2loopback device on Linux) for VLC, ffplay, OBS or any `<video>` consumer | ADR-0003 |
| S10 | **Fallback delivery**: `/avatar` page as OBS Browser Source or Window Capture, then window share | ADR-0003 |

## Affordances

**UI.**

| Affordance | Place | Wires to |
|------------|-------|----------|
| Avatar canvas (transparent or chroma background option) | `/avatar` page | S1, S2, S3 |
| Mic selector and "mic on/off" | `/avatar?mode=mic` | S2 |
| Status line (driver connected, last error) | `/avatar` corner, hidden when captured by OBS via `?hud=0` | S4 |

**Non-UI.**

| Affordance | Kind | Wires to |
|------------|------|----------|
| `utterance` / `cancel` / `turn_started` / `turn_ended` / `game_over` | WebSocket event in | S4 → S5 → S1 |
| `speech_started` / `speech_finished` / `speech_interrupted` / `error` | WebSocket event out | S4 |
| `vikaki say "text" --emotion smug --persona ada` | CLI command | S4 (acts as a driver) |
| MCP tools `say`, `set_emotion`, `cancel`, `set_persona` | MCP server (`vikaki mcp`) | S9 → S4 |
| Extension toggle (on/off per site, avatar choice) | Extension popup | S8 |
| `vikaki check` | CLI command | verifies Node, port, VRM load, audio device, and prints OBS setup hints |
| Persona file `personas.yaml` | config file | S7 |

## Implementation decisions

- **Protocol.** JSON text frames over WebSocket, one stream per match or session. Every message has `type` and `protocol_version`. Event names and fields follow the games brief so the later `Presenter` adapter is mechanical. Utterances carry `utterance_id`, `seat_id`, `text` or `delta`, optional `emotion`, optional `intensity`, optional `persona`, and `kind` (`banter`, `clue`, `table_talk`). See ADR-0001.
- **Audio path.** TTS audio is played in the page through a WebAudio node, and the lip-sync analyser taps that node. Mic mode taps the `getUserMedia` stream (with no playback to avoid echo). The server never receives mic audio in M1.
- **Emotion vocabulary (seven).** `neutral`, `happy`, `smug`, `worried`, `surprised`, `sad`, `angry`. Unknown values become `neutral`.
- **Personas.** Defined in this project's `personas.yaml` and referenced by name from a driver or a game config. Games never hold voice or avatar details.
- **Single driver rule.** A second driver connection receives an `error` with reason `driver_busy` and is closed. Viewer pages can be many.
- **Failure.** If TTS fails, the page returns to idle and emits `error` (never a frozen frame). If the mic is lost, the avatar plays the idle loop and shows a visible HUD error unless `hud=0`.
- **Storage.** Plain files only: VRM assets, `personas.yaml`, a JSONL event log for replay. No database.
- **Stack.** TypeScript monorepo (`packages/engine`, `packages/server`, `packages/cli`), Node LTS, Vite for the page. No Electron. See ADR-0006.
- **Renderer seam.** The avatar renderer sits behind an interface (set viseme weights, set expression, set pose), so VRM is the first implementation and sprite or doodle avatars can follow without touching lip sync or behaviour (ADR-0005).
- **External dependencies and licences.** Three.js (MIT), three-vrm (MIT), OBS Studio (GPL-2.0, user-installed, not bundled). Lip sync is wLipSync (MIT, ADR-0007). To verify in slices, not assumed: a local TTS engine (V2, check Kokoro and Piper licences, since Piper's current repo is GPL). The default avatar asset is Teddy, CC0, recorded in `packages/engine/ASSETS.md`. Ready Player Me was rejected (ADR-0002).

## Testing approach

Test at three seams, highest first: the browser page driven by Playwright with a fake audio source (end-to-end), the WebSocket protocol with a fake TTS (integration), and pure functions such as viseme mapping and emotion fallback (unit). Fakes: `FakeTts` returns canned PCM with known timing, a fake driver replays recorded JSONL. A good test asserts observable behaviour (events emitted, expression weights at a timestamp), not renderer internals. Nothing in CI may call a paid or non-deterministic service. See `/dev-playbook` for layering and gates.

## Assumed defaults

| ID | Assumed | Cost if wrong |
|----|---------|---------------|
| Q9 | Mic-only body language = prosody (amplitude, pitch, pauses), no STT | Low: STT-driven gestures are additive later |
| Q15 | No Electron and no custom driver: the extension does web meetings, OBS covers desktop apps | Medium: if extensions are blocked on the call machine, V1 falls back to OBS, then to window share, and a custom virtual camera becomes its own milestone |
| Q29 | Protocol carries optional `session_id` and a driver auth token from the start, hub is stateless and env-configured, assets are URLs, usage counters exist | Low now, expensive to retrofit if hosting is ever wanted |
| Q22 | One local TTS engine is acceptable quality and licence | Days: swap behind the adapter |
| Q21 | One rendered seat per page is enough in M1 | Low: pages are independent, multi-seat is more pages |

## Deferred and recorded

These are real goals. They are out of M1 only.

**Use case 2: agent software demo.** Multiple orchestrated agents present an app over a video call. Needs multi-stream rooms, floor control, screen share composition (headless browser for the demo plus an avatar overlay per agent), and state-driven animations such as `screencast`, `talking` and `idle`. Assessed as medium difficulty.

**Use case 3: interactive games.** LLMs play Codenames, Wavelength, Catan and poker with talking and body language. The end goal is to watch LLM avatars playing poker at a table, with the LLM sending text (and possibly controlling the avatar over MCP). That needs a spectator page with several avatars on one scene (one persona and one driver stream per seat), which is the first follow-up after M1. Also needs a gesture state machine fed by LLM-issued expression calls, and a game-agnostic interface. The consumer is `agent-game-framework`, whose brief defines the events (`utterance`, `cancel`, `turn_*`, `game_over`) and the lifecycle events back. Remaining integration work: a Python `Presenter` client, ADR-0010 on the framework side, multi-seat rendering, and human `human_utterance` via streaming STT. Open questions the brief asks that this project defers to the game side: whether the game waits for speech to finish (per-game setting), and whether humans see their own avatar.

**Commercial layer.** Cheapest hosted shape: host the hub, TTS, personas, auth and billing, while viewers' browsers render. Hosted video rendering (headless Chromium into a WebRTC SFU such as LiveKit) is the costlier second shape, needed for remote viewers and meeting bots. Open-core: free self-hosted engine, paid hosted platform (managed WebRTC SFU, multi-agent orchestration, voice cloning, compliance tiers). Pricing sketch from the market analysis: Pro $29-99/mo, enterprise custom. Starting audience: developers building agent teams and AI games. Positioning: "LiveKit for avatars". Market gaps worth targeting: near-zero-cost client-side rendering, plug-and-play meeting integration, a gesture/sentiment layer, and regulated-industry personas.

**Doodle avatars (idea, post-M1).** Let users draw their own avatar: one doodle for the face and one doodle of the mouth for each vowel (plus a closed mouth), then animate it. A 2D sprite renderer swaps mouth sprites by viseme, with blink and sway applied to the face layer. It fits the cartoon-first direction (ADR-0005), is cheap to render, and the 5 VRM vowel shapes (aa, ih, ou, ee, oh) map directly to the mouth set. It needs the renderer to sit behind an interface so VRM and sprite avatars share the same lip-sync and behaviour layers. Open questions: a drawing UI in the page versus importing image files, how eyes and brows are drawn, and the persona format for sprite sets.

**Other.** Native speech-to-speech models (protocol must still emit text alongside audio), hand and body gestures, a custom virtual-camera driver. Photoreal renderers and hosted photoreal avatar vendors are excluded by ADR-0005.

## Open risks

- The call machine may block extensions, or block developer-mode loading of one. Revealed by **V1**. Fallback is OBS, then window share.
- Meet or Teams may reject the substituted camera: they can probe devices, permissions and track settings, and may change that without notice. Revealed by **V1**, and will need ongoing maintenance.
- A browser camera policy may disable the camera button before our wrapper runs. Revealed by **V1**.
- OBS Browser Source may not expose the mic to the page (fallback path only). See ADR-0003.
- Lip-sync quality from a pure-JS library may look off for non-English speech. Revealed by **V1**.
- VRM's five vowel shapes may feel flat next to ARKit's 52 targets. Revealed by **V1** and **V3**.
- Time to first audio under a second needs a streaming TTS that starts fast. Revealed by **V2**.
- Headless WebGL in a container without a GPU may be slow. Revealed by **V4**.
