# Personas

A persona is a named character: which avatar it looks like, which voice it speaks with, how it usually feels, and a note on its manner. They live in a YAML file you pass to the server, and drivers refer to them by name, so a game or an LLM never holds voice or avatar details (PLAN.md, S7).

```yaml
personas:
  ada:
    avatar: packages/engine/public/avatars/cookieman.vrm   # required: a .vrm file, relative to this file
    voice: af_heart       # a voice id for the speech engine (Kokoro voice names)
    emotion: happy        # used for lines that name no emotion of their own
    style: warm, quick-witted, a little teasing   # a note for whoever writes the lines; never spoken
```

```bash
pnpm serve --personas personas.example.yaml
pnpm --silent vikaki say --persona ada "Good morning everyone."
```

## What a persona does

- **Voice.** A line naming `ada` is spoken with ada's voice. A persona with no `voice` uses the engine's own default. (Without a personas file, the persona name itself is passed as the voice id, as before.)
- **Default emotion.** A line that names a persona but no `emotion` gets the persona's. An explicit `emotion` on the line wins.
- **Look.** `/avatar/personas.json` lists the personas (name, avatar URL, voice, emotion, style) and `/avatar/personas/<name>.vrm` serves each avatar by name, never by path, so only the avatars the file names can be fetched. A page that shows one persona uses these (V3.5).
- **Unknown names.** With a personas file, a line naming a persona that is not in it is refused with `error` `unknown_persona` (the message lists the known names), nothing is spoken or shown, and the rest of a streamed line is ignored without a second error. The hub stays usable. `welcome` carries `personas` (the names) so a driver can check first. The MCP `set_persona` tool does that over HTTP, keeps the previous persona on a mistake, and returns the persona's `style` on success.

## One page per persona

Open an avatar page with `?persona=ada` (for example `http://127.0.0.1:8787/avatar?persona=ada&live=1`) and it loads ada's avatar from the hub and shows only ada: it plays only the lines that name `ada`, shows only the turns that name `ada`, and tells the hub which persona it shows in `hello`. Open `?persona=ben` in another tab and the two avatars take turns as a driver sends lines for each, with their own look and voice. A page with no `?persona=` still shows every line (one avatar for everyone, as before).

- The hub keeps time for a line itself, and tells the driver `speech_started` and `speech_finished` on schedule, when no open page shows that line's persona, so a driver never waits on a page that is not there.
- `turn_started` and `turn_ended` take an optional `persona` so the right page thinks; `vikaki say --persona ben --think 2` sets it.
- A `?persona=` the hub does not have shows an error in the corner of the page listing the ones it does.
- The second avatar in `personas.example.yaml` terms is Snowy (`packages/engine/public/avatars/snowy.vrm`, CC0, see `ASSETS.md`).

## One page for a whole table: `?seats=`

`http://127.0.0.1:8787/avatar?seats=3` puts three avatars side by side in one scene, one per seat, for watching a table of LLM players on one screen ([ADR-0017](adr/0017-one-driver-per-seat.md)). The page shows every line, plays each on the avatar of the seat it names, and gives that avatar the lip sync, the line's emotion and its turns' thinking pose; the others blink and sway.

- `seats=3`: seats `seat-1` to `seat-3`, taking the hub's personas in order (reused in turn if there are fewer).
- `seats=ada,ben,cy`: bare names are personas for `seat-1`, `seat-2`, `seat-3`.
- `seats=north:ada,south:ben`: seat ids named, each with its persona.
- Up to 8 seats. A persona the hub lacks shows an error in the corner, listing the ones it has. With no personas file the seats alternate the two bundled looks.
- A line finds its avatar by its `seat_id`, else by its `persona`. A seat driver (`hello` with `seats`) gets its seat's persona filled in, so a line needs to name only its seat.
- The avatars let their arms hang so neighbours do not cross, and the camera backs off until the whole row fits, again when the window changes shape. The canvas size stays in CSS, as on every page.
- **The overlay** (VIK-59). The page draws the game's `table_state` ([protocol.md](protocol.md)) over the scene, and holds no game logic: what it shows is what the game sent. At the top, a region named *Table* with the pot, the street and the board. Under each avatar, a plate named for the seat's persona with its stack and bet, its cards (face down when the game sends `back`), a *D* badge for the dealer, and a coloured border and `aria-current` on the seat whose turn it is; a folded seat is dimmed. At the bottom, a log named *Transcript* with the last three lines said, as they arrive. Until a `table_state` arrives the plates show names only.
- `make demo-table` serves a table of three with `personas.table.example.yaml`, and `make table-hand` (`vikaki table-demo`) plays a scripted hand of poker on it with one driver per seat.
- The hub speaks one line at a time, so one seat's mouth moves at once. `window.__vikaki.table.seats` lists each seat's persona, avatar, position, mouth and symbol for tests.

## Heard but not seen: `?render=off`

`http://127.0.0.1:8787/avatar?render=off&persona=ada&live=1` is an **audio-only page**: it plays ada's lines through the speakers and reports `speech_started` / `speech_finished` to the driver exactly like an avatar page, but loads no Three.js scene, no VRM and no lip-sync code, creates no WebGL context and draws nothing (the page entry picks the audio-only chunk, about a kilobyte). A seat nobody is looking at costs almost nothing, yet can still be heard. Its timing report has `audio_ms` and no `frame_ms`. When no page at all shows a persona, the hub keeps time itself and nothing is heard.

## The file is checked at start

`vikaki serve` refuses to start, naming the persona and the problem, if: the file is not valid YAML; there is no `personas:` map or it is empty; a persona is not a map; a persona has no `avatar`, or its `.vrm` file does not exist; `emotion` is not one of the seven; a name is longer than 64 characters; or a field is misspelled (`voise:`), so a typo is never silently ignored.
