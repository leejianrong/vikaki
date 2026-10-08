# Driving the avatar from an LLM (MCP)

`vikaki mcp` is an MCP server on stdio. An LLM client starts it, and its four tools make the avatar speak. It is an ordinary driver of the hub (see [architecture.md](architecture.md)), so a `say` call produces the same events as `vikaki say`.

## Set up

1. Start the hub and open the page: `pnpm serve --port 8787` (add `--tts fake` for a test voice), then open the printed address.
2. Tell your client to run `pnpm --silent vikaki mcp --port 8787` from the repo root. With Claude Code:

```bash
claude mcp add vikaki -- pnpm --silent --dir /path/to/vikaki vikaki mcp --port 8787
```

`--silent` matters: stdout belongs to the protocol, and pnpm's own banner would corrupt it. Add `--token <secret>` (or set `VIKAKI_TOKEN`) if the hub was started with one.

## Tools

| tool | arguments | what it does |
| --- | --- | --- |
| `say` | `text`, optional `emotion`, `intensity`, `persona`, `wait` | Speaks a line. Waits until it is over (or interrupted) and returns `{ utterance_id, outcome: completed \| interrupted \| failed, reason?, first_audio_ms, first_frame_ms? }`. With `wait: false` it returns `{ utterance_id, outcome: "queued" }` at once. Lines are spoken one at a time, in order. |
| `set_emotion` | `emotion` | Default emotion for later lines: `neutral`, `happy`, `smug`, `worried`, `surprised`, `sad`, `angry`. Anything else becomes `neutral`; it is never an error. Returns the one used. The avatar shows it while the line is spoken. |
| `set_persona` | `persona` | Default persona (the voice name today) for later lines. |
| `cancel` | optional `utterance_id` | Stops that line, or everything speaking or queued. The avatar returns to idle. |

`emotion` and `persona` on `say` override the defaults for that line.

## The driver slot

The hub allows one driver. `vikaki mcp` takes the slot on the first tool call that needs the hub (not when the client merely starts it, and not for `set_emotion` or `set_persona`) and keeps it until the client exits, which it notices by stdin closing. While it holds the slot, `vikaki say` and games get `driver_busy`, and the model is told in plain words if the reverse happens. `vikaki cancel` always works, because a controller is not a driver (ADR-0014): you can silence the model mid-sentence from another terminal.

If no hub is running, tool calls return an error saying to start `vikaki serve`; the server itself starts fine and tries again on the next call.
