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
| `say` | `text`, optional `emotion`, `intensity`, `persona`, `seat`, `wait` | Speaks a line. Waits until it is over (or interrupted) and returns `{ utterance_id, outcome: completed \| interrupted \| failed, reason?, first_audio_ms, first_frame_ms? }`. With `wait: false` it returns `{ utterance_id, outcome: "queued" }` at once. Lines are spoken one at a time, in order. |
| `set_emotion` | `emotion`, optional `seat` | Default emotion for later lines (for one seat's lines with `seat`): `neutral`, `happy`, `smug`, `worried`, `surprised`, `sad`, `angry`. Anything else becomes `neutral`; it is never an error. Returns the one used. The avatar shows it while the line is spoken. |
| `set_persona` | `persona`, optional `seat` | Default persona for later lines (for one seat's lines with `seat`). Checked against the hub's personas file ([personas.md](personas.md)): an unknown name is refused with the list of known ones and the previous persona stays. Returns the persona's `style` note and default `emotion`. Does not take the driver slot. |
| `cancel` | optional `utterance_id` | Stops that line, or everything speaking or queued. The avatar returns to idle. |

`emotion` and `persona` on `say` override the defaults for that line.

## A table of several seats

At a card table each LLM is a seat with its own avatar ([ADR-0017](adr/0017-one-driver-per-seat.md)). Run one `vikaki mcp` per LLM and bind it to its seat:

```bash
claude mcp add vikaki-ada -- pnpm --silent --dir /path/to/vikaki vikaki mcp --seat seat-1:ada
claude mcp add vikaki-ben -- pnpm --silent --dir /path/to/vikaki vikaki mcp --seat seat-2:ben
```

- `--seat <id>[:<persona>]` makes the server a driver for that seat only. It speaks as that seat without being told, the hub fills in the seat's persona, and it hears back (and can `cancel`) only its own lines. A second server for the same seat gets `driver_busy`, with the seat's name in the message. Repeat `--seat` to speak for several; `say` then needs `seat` to say which, and a seat that is not the server's own is refused before anything is sent.
- Without `--seat` the server drives the whole table, as before, and `say`, `set_emotion` and `set_persona` may still take a `seat` (emotion and persona are then kept per seat). It cannot run beside a seat server.
- Watch the table on one page: `/avatar?seats=3` ([personas.md](personas.md)). To see it without an LLM, `make demo-table`, then `make table-hand` in another terminal: a scripted hand of poker with one driver per seat.

## The driver slot

The hub allows one driver (or, at a table, one per seat: see below). `vikaki mcp` takes the slot on the first tool call that needs the hub (not when the client merely starts it, and not for `set_emotion` or `set_persona`) and keeps it until the client exits, which it notices by stdin closing. While it holds the slot, `vikaki say` and games get `driver_busy`, and the model is told in plain words if the reverse happens. `vikaki cancel` always works, because a controller is not a driver (ADR-0014): you can silence the model mid-sentence from another terminal.

If no hub is running, tool calls return an error saying to start `vikaki serve`; the server itself starts fine and tries again on the next call.
