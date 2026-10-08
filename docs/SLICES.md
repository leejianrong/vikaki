# Vikaki: Slices

Vertical increments. Each ends in something you can demonstrate. Slice 1 confronts the riskiest unknown: whether a mic-driven avatar can reach a real call on the locked-down Windows machine.

## V1: Mic to avatar to a real call

**Delivers:** R0, R2 (blink and sway), R6, R7 (CLI on Ubuntu and Windows)

**Build plan**

1. Scaffold the TypeScript monorepo on Ubuntu with Apache-2.0 licence, Vite page and `vikaki serve` serving it on localhost.
2. Load a VRM in Three.js with three-vrm. Pick and record a redistributable default avatar and its licence.
3. Spike wawa-lipsync against wLipSync on recorded speech clips. Pick one, record licence and the choice.
4. Feed the mic stream (`getUserMedia`) to the lip-sync node and map visemes to VRM expressions.
5. Add the blink timer and idle sway, and `?hud=0` for a clean capture.
6. Build the MV3 extension: a main-world content script on meet.google.com that wraps `getUserMedia`, `enumerateDevices` and `permissions.query`, advertises a fake `videoinput`, and returns the avatar canvas stream. The real mic is kept for the call and tapped for lip sync.
7. On the Windows call machine, load the extension (first check whether extensions and developer-mode loading are allowed) and join a real Meet call with the physical camera blocked.
8. Repeat for Teams web and Zoom web, and record which sites accept the substituted camera.
9. If the extension is blocked or a site rejects it, try the fallbacks in order: the `/avatar` page through OBS (check mic access in Browser Source, or relay weights from a normal tab, or use Window Capture), then window share. Record which worked.

**Demo:** Join a Meet call in the browser with the physical webcam blocked. The other person sees your avatar mouth move as you speak and blink while you are silent.

**Rests on assumptions:** Q8 (pure-JS lip sync is good enough; if wrong, build a small formant mapper or adopt wLipSync with a calibrated profile), Q15 (an extension is allowed on the call machine; if wrong, the fallbacks apply).

### Test plan

#### End-to-end

- Playwright loads `/avatar?hud=0` with a fake mic fed a speech WAV, and the jaw-open expression exceeds 0.3 during speech and stays under 0.05 during a silent segment.
- With silence for 10 seconds, at least two blink events occur.
- On the Windows call machine, in a real Meet call with the physical camera blocked, a person on the other end confirms the avatar appears as your camera and the mouth tracks speech.
- With the extension active, the wrapped `enumerateDevices` lists a video input, and the physical camera is never opened (checked by the browser's camera-in-use indicator staying off).

#### Integration

- `vikaki serve` starts, serves the page with HTTP 200 on the configured port, and shuts down cleanly on SIGINT.
- The page makes no network request to any non-localhost origin in mic mode.

#### Unit

- Viseme weights are zero for zero-amplitude input and bounded to [0, 1].
- Blink scheduler yields intervals within 3 to 5 seconds, seeded for determinism.

## V2: LLM text driver with streaming speech

**Delivers:** R1, R3, R8, R9

**Build plan**

1. Define the event schema in `packages/engine` as TypeScript types plus a JSON Schema, with `protocol_version`, matching ADR-0001.
2. Add the WebSocket hub: one driver, many viewers, `driver_busy` on a second driver.
3. Implement the `Tts` interface with `FakeTts` (canned PCM, known timing) and one local engine after checking its licence.
4. Stream sentence chunks from `utterance` deltas into TTS, and send audio frames to the page, which plays them through a WebAudio node tapped by the same lip-sync node as V1.
5. Emit `speech_started`, `speech_finished`, `speech_interrupted` and `error`, and implement `cancel`.
6. Add `vikaki say` and `vikaki cancel`, and a JSONL event log with replay.
7. Measure and print time to first audio and time to first video frame.
8. Add `vikaki mcp`, an MCP server exposing `say`, `set_emotion`, `cancel` and `set_persona`, implemented as a driver over the hub.

**Demo:** `vikaki say "Good morning everyone, shall we begin?"` makes the avatar speak with synced mouth. Running `vikaki cancel` mid-sentence stops audio and returns the avatar to idle. Then connect an LLM client (Claude Code, for example) to `vikaki mcp` and ask it to introduce itself in character, and watch the avatar speak.

**Rests on assumptions:** Q22 (one local TTS engine is acceptable in quality and licence).

### Test plan

#### End-to-end

- With `FakeTts`, a driver sends three `utterance` deltas, and the page's jaw expression is non-zero only between `speech_started` and `speech_finished`.
- A `cancel` sent 200 ms into an utterance results in `speech_interrupted` within 300 ms and a neutral idle state.
- Time to first audio is printed, and with the local engine is under 1500 ms on the dev laptop (reported, not gated).

#### Integration

- A second driver connection receives `error` with `driver_busy` and is closed.
- Replaying a recorded JSONL log through the hub reproduces the same outbound event sequence.
- A TTS failure yields `error`, followed by idle, with the hub still accepting new utterances.
- An MCP `say` call results in the same event sequence as `vikaki say`, and a `cancel` call interrupts it.
- The MCP server holds the single driver slot, and a concurrent `vikaki say` gets `driver_busy`.

#### Unit

- Sentence chunker splits streaming deltas on sentence boundaries and flushes the tail at end of input.
- Unknown `protocol_version` is rejected with a clear error.

## V3: Emotions, personas and thinking

**Delivers:** R2 (thinking), R4, R5

**Build plan**

1. Add the seven emotion presets as VRM expression blends, with `intensity` scaling and neutral fallback.
2. Add `turn_started` and `turn_ended` handling that switches to a thinking pose and back.
3. Add `personas.yaml` mapping name to VRM, voice and default emotion, and resolve `persona` on utterances.
4. In mic mode, add prosody-driven head nods and brow raises from pitch and pause cues.
5. Run a second avatar page with a different persona to confirm two seats look and sound distinct.

**Demo:** `vikaki say "Oh, you really think so?" --emotion smug --persona ada` shows a smug expression with ada's voice and look, and a `turn_started` event shows a thinking pose.

**Rests on assumptions:** Q19 (seven emotions are enough) and Q20 (personas live in this project, referenced by name).

### Test plan

#### End-to-end

- For each of the seven emotions, a screenshot test checks the expression weights at 1 second after the event match the preset within 0.05.
- Two pages with personas `ada` and `ben` load different VRM files and request different voice ids.

#### Integration

- An unknown `emotion` value falls back to `neutral` with a logged warning, not an error.
- An unknown persona name returns an `error` event and keeps the previous persona.

#### Unit

- Emotion intensity scaling is linear and clamped to [0, 1].
- `personas.yaml` parser rejects a persona with a missing VRM path.

## V4: Headless and container

**Delivers:** R7 (container), R8 (CI), per-seat optional rendering

**Build plan**

1. Write a Dockerfile that runs `vikaki serve` and exposes the page and WebSocket.
2. Add a headless renderer mode using Playwright and Chromium with software WebGL, used for CI and no-human runs.
3. Add audio-only mode (no renderer) so an unwatched seat costs almost nothing.
4. Wire the Playwright end-to-end tests from V1 to V3 into CI with fakes only.
5. Add `vikaki stream`: render the avatar headless and publish it as an MJPEG HTTP stream, with the frame size and fps configurable, so VLC, ffplay or OBS can open it. Optional: a v4l2loopback output on Ubuntu, documented as experimental.
6. Write the README, quick start for Windows+OBS and for Docker, and the protocol reference.

**Demo:** `docker run` the image, run `vikaki say` against it from the host, and watch the avatar speak in a browser at localhost, with CI green on a machine with no GPU.

**Rests on assumptions:** Q21 (one rendered seat per page), and that software WebGL is fast enough in a container (if not, document a GPU option and keep audio-only mode).

### Test plan

#### End-to-end

- In CI, the container starts, a fake driver sends an utterance, and the headless page reports expression changes with no GPU, API key or network access.
- Audio-only mode emits the full `speech_*` event sequence with the renderer disabled.
- `vikaki stream` serves an MJPEG feed, and `ffprobe` on the URL reports a video stream at the configured size, with frames changing while an utterance plays.

#### Integration

- The container's health check succeeds within 10 seconds of start.
- The image runs as a non-root user and exposes only the documented ports.

#### Unit

- Config loader applies defaults and rejects unknown keys, with environment overrides.
