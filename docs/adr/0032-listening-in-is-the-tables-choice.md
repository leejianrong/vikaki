# ADR-0032: Listening in is the table's choice, kept by the hub

- Status: Accepted (VIK-98; the voice-over of thoughts already existed from VIK-121)
- Date: 2026-10-22
- Deciders: Claude (defaults chosen; Jian may redirect)

## Context

Since VIK-121 a seat's critical-moment thoughts are spoken, softly, for everyone. VIK-98 wants the audience to choose whose thoughts they hear, with a spotlight on the thinker, and no synthesis spent on thoughts nobody hears.

## Decision

- **One choice for the table.** A viewer sends `listen` (`seat` with a seat id, `all`, or `off`); the hub keeps it and sends `listen_state` to every viewer. It is not per viewer, because the hub synthesises once for everyone (ADR-0001) and "one spotlit seat for the whole table" was the intent. The default is `all`, which is how the table behaved before, so nothing changes until someone clicks; a viewer that joins is told only when the choice is not the default, so existing clients and tests see no new message.
- **Muted thoughts cost nothing.** A thought utterance of a seat that is not heard is marked muted when it arrives: its text still reaches the pages (the Thinking bubble and the Thoughts tab), nothing is synthesised, and the driver is told it was said at once, so the game does not wait.
- **Switching.** Choosing another seat stops the thought in progress: one still being made is cancelled, and one whose audio is all sent but still playing gets a `cancel` to the pages, so it stops where it plays. The new seat then speaks its latest thought if it is not already thinking aloud: the engine keeps each seat's last thought (from `thought` messages and thought utterances) and replays it as an utterance of its own (`listen-N`) that goes to the pages only. The driver is not told of it (it never sent it), and the hub drops what pages report about it.
- **The page.** A thought never moves the avatar's mouth (the seat still takes the feeling). The listened-to or thinking seat's plate is spotlit and the others dim. Each player's card has a **Listen in** button (pressed while listened to; a second press stops, which is `off`), a click on a plate does the same, and the switch **Hear every thought** returns to `all`.

## Not done

Listening in to a seat's eyes (POV, VIK-99) and a camera cut to the spotlit seat are for the camera cards. The 3D avatars are not dimmed, only the plates and cards.
