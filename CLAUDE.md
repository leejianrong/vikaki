# Vikaki

Open-source (Apache-2.0) engine that animates a stylised VRM avatar from a mic or from text/TTS, and delivers it into browser meetings, a local browser page, or an MJPEG feed. Plan: `PLAN.md`. Build order: `SLICES.md`. Decisions: `docs/adr/`. Open questions and defaults: `QUESTIONS.md`. Work board: Pandan board 35 ("Vikaki").

## Build status

Trust the code over the docs where they disagree, then fix the docs.

| Slice | State |
|-------|-------|
| V1 Mic to avatar to a real call | In progress. V1.1 scaffold done (server serves a placeholder page) |
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
pnpm test                        # vitest, no network or GPU needed
make check                       # typecheck + test: the fast gate, same as the pre-push hook
```

`make` with no target prints help.

## Layout

- `packages/engine` Vite page: Three.js scene, lip sync, behaviour (browser code).
- `packages/server` Node HTTP and (later) WebSocket hub.
- `packages/cli` the `vikaki` command.
- `docs/adr` one decision per file.

## Conventions

- Branch per slice off fresh `main`, PR-only, CI green before merge. Do not push to `main`.
- Run `make check` before every push. Install the hook once: `make hooks`.
- Tests never call a paid or non-deterministic service. Use fakes (`FakeTts`, fake mic WAV).
- Every bug gets a failing test first.
- Never commit secrets. TTS keys, if any, come from environment variables and are never logged.
- Third-party assets (avatars, voices, libraries) must have their licence recorded before they are committed.
- Move the Pandan card to `in_progress` when you start and to `done` only after the PR is merged.
- pnpm 11 blocks dependency build scripts. Approved: `esbuild` only (`pnpm-workspace.yaml`).
