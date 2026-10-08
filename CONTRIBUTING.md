# Contributing

## Set up

Node 24 and pnpm 11 (`corepack enable`), then:

```bash
pnpm install --frozen-lockfile
make hooks         # a pre-push hook that runs `make check`
make doctor        # checks Node, the build, the port, the voice and the model
```

## Before you push

```bash
make check                  # typecheck + unit and integration tests; no network or GPU needed
pnpm test:e2e:smoke         # the quick browser tests CI runs on every PR (once: pnpm exec playwright install chromium)
pnpm test:e2e               # the full browser suite; runs on main and nightly
```

How the tests are layered, and what runs when: [docs/testing.md](docs/testing.md).

## How we work

- One branch per slice off fresh `main`, a pull request, CI green before merge. Do not push to `main`.
- Every bug gets a failing test first. Prove a new guard by breaking the code and seeing the right test fail.
- Tests never call a paid or non-deterministic service; use the fakes (`FakeTts`, a fake mic WAV).
- The avatar is cartoon-first, cute and friendly. Do not add realistic or human-mimicking avatars ([ADR-0005](docs/adr/0005-cartoon-first-avatars-no-human-mimicry.md)). Look at screenshots of any visual change before calling it done (`make demo`).
- Third-party assets (avatars, voices, libraries) need their licence recorded before they are committed.
- Decisions go in [docs/adr](docs/adr), one per file. If a doc and the code disagree, trust the code and fix the doc.

Agents working in this repo read [CLAUDE.md](CLAUDE.md), which has the finer conventions (Material 3 colours, protocol changes, the context budget).
