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

## The file is checked at start

`vikaki serve` refuses to start, naming the persona and the problem, if: the file is not valid YAML; there is no `personas:` map or it is empty; a persona is not a map; a persona has no `avatar`, or its `.vrm` file does not exist; `emotion` is not one of the seven; a name is longer than 64 characters; or a field is misspelled (`voise:`), so a typo is never silently ignored.
