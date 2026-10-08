# Testing

How Vikaki is tested, what runs where, and why. The goal is a quick development cycle: a pull request gets fast, trustworthy feedback, and the slow or noisy checks run elsewhere.

## Layers

| Layer | What | Where | Speed |
| --- | --- | --- | --- |
| Unit and integration | Vitest in each package: protocol, chunker, hub, speech engine, recorder, behaviour. Real sockets, fake voice, no network or GPU | `pnpm test` | seconds |
| Property | fast-check: for any input, the rule holds (no text lost by the chunker, PCM round-trips, metrics never NaN, loudness-scale invariance). Found where examples cannot | same files as above, `*.property.test.ts` | seconds |
| Browser (e2e) | Playwright against the built page with software WebGL: real audio path, real lip sync, layout, extension, CLI shutdown | `pnpm test:e2e` | 30 s on a laptop, longer on CI |
| Accessibility | axe-core (WCAG 2 A and AA) on the demo and speech demo, light and dark | `a11y.e2e.test.ts`, part of the full e2e | seconds |
| Real voice | The speech-or-buzz gate on live Kokoro output | `VIKAKI_KOKORO_PATH=… pnpm --filter @vikaki/server test` | needs a 410 MB install; local only |
| Real call | Meet, Teams, Zoom with a person on the other end | by hand (V1.7, V1.8) | n/a |

Mocks and fakes belong at the edges: `FakeTts`, a fake mic WAV, fake clocks. Not in the browser audio path, because six real bugs were found only by real-browser tests.

## What runs where

| When | What | Required to merge |
| --- | --- | --- |
| Before push (`make check`, the pre-push hook) | typecheck and unit tests | n/a |
| Every pull request | typecheck, unit, build (required); smoke e2e, audit (reported) | typecheck, unit, build |
| Push to `main` | the same, but with the full e2e | n/a |
| Nightly (03:17 UTC) and on demand | full e2e, audit, a timing comparison with the previous night | none; a failing night is looked at next morning |
| By hand | real voice, real call, `make demo-speech` | n/a |

The smoke e2e is deliberately **not required**: software WebGL on two shared cores is the likeliest check to flake, and a red mark that is not the PR's fault should not block a merge. Read it, and rerun it once if it looks unrelated (the failure artefacts below usually tell you).

### The smoke subset

`pnpm test:e2e:smoke` (or `make e2e-smoke`) runs the tests tagged `smoke`: roughly one or two per surface (avatar loads and moves its mouth, demo controls and layout, speech round trip and failure, cancel, the extension offering the avatar camera, the mic failing safely, CLI shutdown). It takes about 7 s on a laptop against 31 s for everything.

To put a test in it, tag it: `it("…", { tags: ["smoke"] }, async () => { … })`. A test that already had a trailing timeout number moves it into the options: `{ tags: ["smoke"], timeout: 60_000 }`. Keep a test out of smoke if it takes more than about 3 s or waits for real time (blink timers, long audio). The tag is declared in `packages/e2e/vitest.config.ts`.

## Rules

- **Every bug gets a failing test first.** New guards are proven by mutation: break the code on purpose, watch the right test fail, restore.
- **No fixed sleeps** to encode a timing assumption. Wait for an event with a generous ceiling.
- **Millisecond budgets only off CI**: `STRICT_TIMING = !process.env.CI`. CI is two shared cores with software WebGL.
- Check CI-like locally with `CI=1 taskset -c 0,1 pnpm --filter @vikaki/e2e exec vitest run`.
- Tests never call a paid or non-deterministic service.
- Look at screenshots of any visual change yourself; for audio use the spectrograms and metrics (`docs/observability.md`).

## When an e2e test fails on CI

The job uploads `e2e-failures` (14 days): for each failing test, a screenshot and the console log of every page that was open. `packages/e2e/test/setup.ts` does this for every test with no change to the tests. Download it from the run's Artifacts section, or locally find it under `packages/e2e/artifacts/` (git-ignored). A failing axe scan prints its violations, with the selectors, in the assertion message.

## Keeping main green

- A pull request runs `pnpm test:e2e:smoke` (about 20 quick tests). It is reported, not required.
- `main` runs the **full** suite after every merge, and nightly runs it again with timings. On CI the files run **one at a time** (`fileParallelism` is off when `CI` is set): every file starts its own Chromium with software WebGL, and two at once on the runner's two shared cores starve each other. Locally they run side by side.
- So a green pull request does not mean a green `main`. After merging, check the `main` run (`gh run list --branch main --workflow ci.yml`) and fix a red one before more feature work.
- Image tests (`make docker-test`) run in their own workflow, `docker.yml`, when the image or the code it runs changes, and nightly.

## Timings

The nightly run records every test's duration (`nightly-timings` artefact) and `scripts/compare-timings.mjs` writes a summary of tests that got more than 2x and 1.5 s slower than the night before. It only reports; shared runners are too noisy to gate on. Real-voice latency (time to first audio, about 1.6 s on a laptop CPU) depends on the machine and needs the large Kokoro install, so it is checked by hand with `make demo-speech` and read from `timings.json` in a debug recording.

There is no dedicated performance machine. If that is ever needed, the options are a self-hosted runner on a developer machine (free, real numbers, only when it is on) or a rented dedicated-CPU server.

## V2 test plan: where each item is covered

The plan in `docs/SLICES.md` (V2) maps onto these tests. Tests marked smoke run on every PR.

| Plan item | Test |
| --- | --- |
| Jaw non-zero only between `speech_started` and `speech_finished`, for a line sent as three deltas | e2e `speech.e2e`: "opens the mouth only between ..."; the plain-text version is the smoke test "speaks a line" |
| Cancel gives `speech_interrupted` within 300 ms and a neutral, idle mouth | e2e `speech.e2e`: "stops quickly when cancelled mid-speech" (the 400 ms budget is enforced off CI only, see STRICT_TIMING) |
| Time to first audio is printed, not gated | e2e (smoke) "reports its own time to first audio and first mouth frame"; `vikaki say` and `vikaki serve` print it; `timings.json` has it for debug recordings |
| A second driver gets `driver_busy` and is closed | `hub.test`: "refuses a second driver with driver_busy ..." |
| Replaying a JSONL log reproduces the event sequence | `cli/commands.test`: "reproduces the same event sequence through a fresh hub" |
| A TTS failure gives `error`, then idle, and the hub keeps working | `speech.test` (hub) and e2e (smoke) "reports a speech failure to the driver and carries on" |
| An MCP `say` has the same event sequence as `vikaki say`; `cancel` interrupts it | `cli/mcp.test`: "produces the same event sequence ...", "cancel interrupts ..." |
| The MCP server holds the single driver slot; a concurrent `vikaki say` gets `driver_busy` | `cli/mcp.test`: "holds the single driver slot ...", and the stdio test that it lets go when the client closes stdin |
| Sentence chunker splits deltas and flushes the tail | `packages/tts` chunker tests, including property tests |
| Unknown `protocol_version` is rejected clearly | `protocol.test` and `hub.test` |

## V3 test plan: where each item is covered

| Plan item | Test |
| --- | --- |
| For each of the seven emotions, the pose one second after the event matches the preset within 0.05 | e2e `speech.e2e`: "shows each of the seven emotions a line asks for, scaled by its intensity, and relaxes after it" (alternating full and 0.6 intensity; the page's own model is the reference). Unit: `emotion.test` ("within 0.05 of it one second later" for every emotion) |
| ...and it is visible on screen | e2e `emotions-visual`: every emotion changes the picture against neutral, more at full strength than at a third; a made-up emotion draws what neutral draws. Uses `?still=1` (holds the head at rest) so pictures from different moments can be compared |
| Two pages with personas `ada` and `ben` load different VRMs and request different voice ids | e2e `personas.e2e`: each page loads its own avatar and the two look different; each line plays only on its persona's page with that persona's voice |
| An unknown `emotion` falls back to neutral with a logged warning, not an error | `hub.test` ("passes an unknown emotion through with a logged warning, not an error") and e2e "treats an unknown emotion as neutral, without an error" |
| An unknown persona returns an `error` event and keeps the previous persona | `personas-hub.test` (`unknown_persona`, hub carries on) and `cli/mcp.test` (`set_persona` refuses, says "still ada", does not take the driver slot) |
| Intensity scaling is linear and clamped to [0, 1] | `emotion.test` ("scales linearly", "clamps intensity") |
| The personas parser rejects a persona with a missing VRM path | `personas.test` ("rejects a persona with no VRM path, naming the persona", and a missing file) |
| Thinking pose on `turn_started` / `turn_ended` (V3.2) | `emotion.test` (six thinking tests), e2e "looks thoughtful between turn_started and turn_ended", per-persona thinking in `personas.e2e` |
| Mic prosody gestures (V3.4) | `audio/prosody.test` (pitch and each cue), `engine/gestures.test`, e2e `mic-prosody` (a synthesised phrase through Chromium's fake mic) |

The look of the emotions is judged by eye as well (`scripts/probe-emotions.ts`, `scripts/screenshot-personas.ts`); the tests above only prove that something is drawn, and that it scales.

## Not done yet

- **Mutation testing at scale.** StrykerJS was tried (core and the Vitest runner, version 10). With Vitest 5 and TypeScript 7 it ran but activated almost none of its mutants (3.6% score on code whose hand-made mutations are all caught), so it was not adopted. Retry when its Vitest runner supports these versions. Until then, mutation checks are done by hand and recorded in the PR.
- A longer property-test run nightly (more iterations) and property tests for the playback scheduler.
- Axe on the extension's popup, once it has one.
- Dependency licence: `@axe-core/playwright` and `axe-core` are MPL-2.0. They are dev dependencies only and are not shipped or bundled.
