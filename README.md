# vikaki

*video + kaki (Malay for "friend")*

An open-source engine that gives you a live avatar from a microphone or from text. A stylised 3D (VRM) avatar lip-syncs to speech, blinks and emotes, and can appear as your camera in browser meetings, in a local browser page, or as a video feed other programs can open. An LLM can drive the same avatar over MCP.

**Status:** early development. Nothing is usable yet. See [PLAN.md](PLAN.md) for scope and [SLICES.md](SLICES.md) for the build order.

## Run what exists

```bash
pnpm install
pnpm build
pnpm serve   # http://127.0.0.1:8787/avatar (placeholder page for now)
```

## Docs

- [PLAN.md](PLAN.md): problem, scope, requirements, shape
- [SLICES.md](SLICES.md): demo-able increments with test plans
- [QUESTIONS.md](QUESTIONS.md): decision register
- [docs/adr](docs/adr): architecture decisions

## Licence

Apache-2.0. See [LICENSE](LICENSE).
