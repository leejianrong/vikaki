# Vikaki

Open-source (Apache-2.0) engine that animates a stylised VRM avatar from a mic or from text/TTS, and delivers it into browser meetings, a local browser page, or an MJPEG feed. Plan: `PLAN.md`. Build order: `SLICES.md`. Decisions: `docs/adr/`. Open questions and defaults: `QUESTIONS.md`. Work board: Pandan board 35 ("Vikaki").

## Build status

Trust the code over the docs where they disagree, then fix the docs.

| Slice | State |
|-------|-------|
| V1 Mic to avatar to a real call | In progress. Done: V1.1 scaffold, V1.2 VRM avatar, V1.3 lip-sync spike (wLipSync, ADR-0007), V1.4 mic to lip sync, V1.5 blink and sway, plus a demo page. Next: V1.6 meeting extension |
| V2 LLM text driver and MCP | Not started |
| V3 Emotions and personas | Not started |
| V4 Headless, container, MJPEG feed | Not started |

## Commands

Node 24, pnpm 11 (via corepack). Run from the repo root.

```bash
pnpm install --frozen-lockfile   # reproducible install
pnpm build                       # builds the avatar page into packages/engine/dist
pnpm serve --port 8787           # serves http://127.0.0.1:8787/avatar (needs a build first)
pnpm typecheck                   # tsc --noEmit in every package
pnpm test                        # vitest unit and integration, no network or GPU needed
pnpm test:e2e                    # builds, then runs Playwright against the page (needs: pnpm exec playwright install chromium)
make demo                        # build, serve on a free port and open the demo page to judge the avatar by eye
make check                       # typecheck + test: the fast gate, same as the pre-push hook
```

`make` with no target prints help.

## Layout

- `packages/engine` Vite page: Three.js scene, lip sync, behaviour (browser code).
- `packages/server` Node HTTP and (later) WebSocket hub.
- `packages/cli` the `vikaki` command.
- `packages/e2e` Playwright tests against the built page (software WebGL, no GPU).
- `spikes/` throwaway comparisons with their own README or script. `docs/spikes/` holds the write-ups.
- `docs/adr` one decision per file.

## Conventions

- Branch per slice off fresh `main`, PR-only, CI green before merge. Do not push to `main`.
- Run `make check` before every push. Install the hook once: `make hooks`.
- Direction is cartoon-first and cute. Do not add realistic or human-mimicking avatar options (ADR-0005).
- Tests never call a paid or non-deterministic service. Use fakes (`FakeTts`, fake mic WAV).
- Every bug gets a failing test first.
- Never commit secrets. TTS keys, if any, come from environment variables and are never logged.
- Third-party assets (avatars, voices, libraries) must have their licence recorded before they are committed. Avatars go in `packages/engine/ASSETS.md`.
- Move the Pandan card to `in_progress` when you start and to `done` only after the PR is merged.
- pnpm 11 blocks dependency build scripts. Approved: `esbuild` only (`pnpm-workspace.yaml`).
