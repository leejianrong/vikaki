# Vikaki

Open-source (Apache-2.0) engine that animates a stylised VRM avatar from a mic or from text/TTS, and delivers it into browser meetings, a local browser page, or an MJPEG feed. Plan: `PLAN.md`. Build order: `SLICES.md`. Decisions: `docs/adr/`. Open questions and defaults: `QUESTIONS.md`. Work board: Pandan board 35 ("Vikaki").

## Build status

Trust the code over the docs where they disagree, then fix the docs.

| Slice | State |
|-------|-------|
| V1 Mic to avatar to a real call | In progress. Done: V1.1 scaffold, V1.2 VRM avatar, V1.3 lip-sync spike (wLipSync, ADR-0007), V1.4 mic to lip sync, V1.5 blink and sway, a demo page, and V1.6 meeting extension for Meet (tested against a stand-in page only). Next: V1.7 and V1.8 need a human on the real call machine (flagged on the board) |
| V2 LLM text driver and MCP | In progress. Done: V2.1 protocol, V2.2 hub, V2.3 TTS, V2.4 speech pipeline and page player, V2.5 lifecycle and cancel, V2.6 CLI say/cancel/replay and the event log (PR open). Next: V2.7 timing, V2.8 MCP |
| V3 Emotions and personas | Not started (the avatar's default brows are fine now: Cookieman is the default avatar) |
| V4 Headless, container, MJPEG feed | Not started |
| Observability, phases 0 to 3 (see below) | Phase 0 done (honest speech demo, install-voice, doctor, Material 3 UI). Phase 1 done. Phase 2 in progress: recorder and shared audio package merged (PR #14), timeline dock merged (PR #15), karaoke in PR C (docs/observability.md). Phase 3 next |

**Observability plan** (agreed with Jian): Phase 1 debug recorder (`--debug-dir`: per-utterance wav, spectrogram PNG, metrics JSON, text, timings) and a speech-versus-buzz gate as a test; Phase 2 live and per-utterance spectrograms, karaoke highlight on the current word (estimated word timings; Kokoro's ONNX model outputs only a waveform), a timeline view; Phase 3 phoneme-driven lip sync scored by a lip-sync scorecard. The testing strategy is in `docs/testing.md` (layers, what runs on a PR vs main vs nightly, smoke e2e, failure artefacts).

## Commands

Node 24, pnpm 11 (via corepack). Run from the repo root.

```bash
pnpm install --frozen-lockfile   # reproducible install
pnpm build                       # builds the avatar page into packages/engine/dist
pnpm serve --port 8787           # serves http://127.0.0.1:8787/avatar (needs a build first); --tts none|fake|kokoro|auto
pnpm typecheck                   # tsc --noEmit in every package
pnpm test                        # vitest unit and integration, no network or GPU needed
pnpm test:e2e                    # builds, then runs all Playwright tests (needs: pnpm exec playwright install chromium)
pnpm test:e2e:smoke              # the quick tagged subset CI runs on every PR (also `make e2e-smoke`)
make demo                        # build, serve on a free port and open the demo page to judge the avatar by eye
make install-voice               # install the real voice (Kokoro, ~410 MB) into .vikaki/voice; safe to repeat
vikaki say "Hello" | cancel | replay f.jsonl   # drive a running `pnpm serve` (add --port N); `serve --event-log f.jsonl` records
make doctor                      # check Node, build, port, voice, model; prints the exact fix for each problem
make demo-speech                 # installs the voice if needed, then the speech demo: type text, hear the avatar say it
make extension                   # build the browser extension into packages/extension/dist (see its README to load it)
make check                       # typecheck + test: the fast gate, same as the pre-push hook
```

`make` with no target prints help.

## Layout

- `packages/engine` Vite page: Three.js scene, lip sync, behaviour, the page-side `TimelineRecorder` and the timeline dock (browser code).
- `packages/protocol` message types, validation and the JSON Schema (`docs/protocol.md`). After changing it run `pnpm --filter @vikaki/protocol schema`.
- `packages/tts` the `Tts` interface, `FakeTts`, `SentenceChunker`, `WorkerTts` (runs an engine in a worker thread) and the optional `KokoroTts` (docs/tts.md, ADR-0013).
- `packages/audio` pure audio code with no Node-only APIs: FFT and spectrogram maths, the speech-or-buzz metrics, WAV. Shared by the server recorder and the page.
- `packages/server` Node HTTP server, the WebSocket hub (`/ws`), the speech engine and the debug recorder (`src/debug`).
- `packages/cli` the `vikaki` command.
- `packages/extension` the Meet extension (main-world script, isolated-world bridge, build script).
- `packages/e2e` Playwright tests against the built page (software WebGL, no GPU).
- `scripts/` dev helpers: `screenshot.mjs`, `probe-*.mjs`, `real-site-check.mjs` (manual, needs internet), `make-vowel-fixture.py`.
- `spikes/` throwaway comparisons with their own README or script. `docs/spikes/` holds the write-ups.
- `docs/adr` one decision per file.

## Conventions

- Branch per slice off fresh `main`, PR-only, CI green before merge. Do not push to `main`.
- Run `make check` before every push. Install the hook once: `make hooks`.
- Direction is cartoon-first, cute, friendly and approachable. Do not add realistic or human-mimicking avatar options (ADR-0005). Look at screenshots of any avatar or visual change yourself before calling it done (`node scripts/screenshot.mjs`, see also `make demo`).
- Demo UI follows Material 3 (ADR-0012): colours come from `src/ui/theme.css` (generated by `pnpm exec tsx scripts/make-theme.mjs`, never edit by hand), type and shape tokens from `src/ui/base.css`. Use `--md-sys-color-*` roles, not hex values. Tests find controls by role and name, not class.
- Never write an inline CSS size on the canvas (`renderer.setSize(w, h, true)`): it beats the stylesheet and the avatar draws under the side panels. A layout test guards this.
- Never add `kokoro-js` to the workspace (410 MB); it is an optional runtime install (ADR-0010).
- Tests never call a paid or non-deterministic service. Use fakes (`FakeTts`, fake mic WAV).
- Every bug gets a failing test first.
- Extension code runs as a classic script: no `import.meta`, no top-level `await` (the build checks). Anything that may be blocked by a page's CSP needs a fallback.
- Never commit secrets. TTS keys, if any, come from environment variables and are never logged.
- Third-party assets (avatars, voices, libraries) must have their licence recorded before they are committed. Avatars go in `packages/engine/ASSETS.md`.
- Move the Pandan card to `in_progress` when you start and to `done` only after the PR is merged.
- pnpm 11 blocks dependency build scripts. Approved: `esbuild` only (`pnpm-workspace.yaml`).

## Context budget

Long sessions here hit the limit because of big tool results, not long chats.

- Pipe noisy commands (`pnpm test`, `pnpm build`, `make doctor`, `git log`) through `tail -n 40`, `head` or `grep`. Never `cat` a large file.
- Read big files with `offset` and `limit`, and don't re-read a file you already have. Use `rg` or an Explore agent to find things first.
- Send wide searches or file sweeps to a subagent so only the conclusion comes back.
- Suggest `/compact` around 70% full, before autocompact picks what to drop.
