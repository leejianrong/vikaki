# Vikaki

Open-source (Apache-2.0) engine that animates a stylised VRM avatar from a mic or from text/TTS, and delivers it into browser meetings, a local browser page, or an MJPEG feed. Plan: `PLAN.md`. Build order: `SLICES.md`. Decisions: `docs/adr/`. Open questions and defaults: `QUESTIONS.md`. Work board: Pandan board 35 ("Vikaki").

## Build status

Trust the code over the docs where they disagree, then fix the docs.

| Slice | State |
|-------|-------|
| V1 Mic to avatar to a real call | In progress. Done: V1.1 scaffold, V1.2 VRM avatar, V1.3 lip-sync spike (wLipSync, ADR-0007), V1.4 mic to lip sync, V1.5 blink and sway, a demo page, and V1.6 meeting extension for Meet (tested against a stand-in page only). Next: V1.7 test it on the real call machine |
| V2 LLM text driver and MCP | In progress. Done: V2.1 protocol, V2.2 hub, V2.3 TTS, V2.4 speech pipeline and page player, V2.5 lifecycle and cancel. Next: V2.6 CLI say/cancel/replay, V2.7 timing, V2.8 MCP |
| V3 Emotions and personas | Not started |
| V4 Headless, container, MJPEG feed | Not started |

## Commands

Node 24, pnpm 11 (via corepack). Run from the repo root.

```bash
pnpm install --frozen-lockfile   # reproducible install
pnpm build                       # builds the avatar page into packages/engine/dist
pnpm serve --port 8787           # serves http://127.0.0.1:8787/avatar (needs a build first); --tts none|fake|kokoro|auto
pnpm typecheck                   # tsc --noEmit in every package
pnpm test                        # vitest unit and integration, no network or GPU needed
pnpm test:e2e                    # builds, then runs Playwright against the page (needs: pnpm exec playwright install chromium)
make demo                        # build, serve on a free port and open the demo page to judge the avatar by eye
make extension                   # build the browser extension into packages/extension/dist (see its README to load it)
make check                       # typecheck + test: the fast gate, same as the pre-push hook
```

`make` with no target prints help.

## Layout

- `packages/engine` Vite page: Three.js scene, lip sync, behaviour (browser code).
- `packages/protocol` message types, validation and the JSON Schema (`docs/protocol.md`). After changing it run `pnpm --filter @vikaki/protocol schema`.
- `packages/tts` the `Tts` interface, `FakeTts`, `SentenceChunker` and the optional `KokoroTts` (docs/tts.md).
- `packages/server` Node HTTP server and the WebSocket hub (`/ws`).
- `packages/cli` the `vikaki` command.
- `packages/extension` the Meet extension (main-world script, isolated-world bridge, build script).
- `packages/e2e` Playwright tests against the built page (software WebGL, no GPU).
- `spikes/` throwaway comparisons with their own README or script. `docs/spikes/` holds the write-ups.
- `docs/adr` one decision per file.

## Conventions

- Branch per slice off fresh `main`, PR-only, CI green before merge. Do not push to `main`.
- Run `make check` before every push. Install the hook once: `make hooks`.
- Direction is cartoon-first, cute, friendly and approachable. Do not add realistic or human-mimicking avatar options (ADR-0005). Look at screenshots of any avatar or visual change yourself before calling it done (`node scripts/screenshot.mjs`, see also `make demo`).
- Never add `kokoro-js` to the workspace (410 MB); it is an optional runtime install (ADR-0010).
- Tests never call a paid or non-deterministic service. Use fakes (`FakeTts`, fake mic WAV).
- Every bug gets a failing test first.
- Extension code runs as a classic script: no `import.meta`, no top-level `await` (the build checks). Anything that may be blocked by a page's CSP needs a fallback.
- Never commit secrets. TTS keys, if any, come from environment variables and are never logged.
- Third-party assets (avatars, voices, libraries) must have their licence recorded before they are committed. Avatars go in `packages/engine/ASSETS.md`.
- Move the Pandan card to `in_progress` when you start and to `done` only after the PR is merged.
- pnpm 11 blocks dependency build scripts. Approved: `esbuild` only (`pnpm-workspace.yaml`).
