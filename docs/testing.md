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

## Timings

The nightly run records every test's duration (`nightly-timings` artefact) and `scripts/compare-timings.mjs` writes a summary of tests that got more than 2x and 1.5 s slower than the night before. It only reports; shared runners are too noisy to gate on. Real-voice latency (time to first audio, about 1.6 s on a laptop CPU) depends on the machine and needs the large Kokoro install, so it is checked by hand with `make demo-speech` and read from `timings.json` in a debug recording.

There is no dedicated performance machine. If that is ever needed, the options are a self-hosted runner on a developer machine (free, real numbers, only when it is on) or a rented dedicated-CPU server.

## Not done yet

- **Mutation testing at scale.** StrykerJS was tried (core and the Vitest runner, version 10). With Vitest 5 and TypeScript 7 it ran but activated almost none of its mutants (3.6% score on code whose hand-made mutations are all caught), so it was not adopted. Retry when its Vitest runner supports these versions. Until then, mutation checks are done by hand and recorded in the PR.
- A longer property-test run nightly (more iterations) and property tests for the playback scheduler.
- Axe on the extension's popup, once it has one.
- Dependency licence: `@axe-core/playwright` and `axe-core` are MPL-2.0. They are dev dependencies only and are not shipped or bundled.
