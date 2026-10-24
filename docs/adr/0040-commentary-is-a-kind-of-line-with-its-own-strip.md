# ADR-0040: Commentary is a kind of line with its own strip, and the voices have a level

- Status: Accepted (VIK-109)
- Date: 2026-10-24
- Deciders: Claude (default chosen; Jian may redirect)

## Context

Jian commentates himself for now, over a microphone, and an AI commentator is a stretch goal (VIK-110). Either needs the table's voices out of the way, and an AI one needs a kind of line that is not any seat's talk.

## Decision

- **A level for the table voices.** The page's speech goes through one gain node (`AudioSession.setVoice`): a mute switch ("Mute table voices") and a volume slider ("Table voices volume") in the panel, remembered in the browser. It changes while a line or a thought is playing. The lip sync listens before the gain, so **the mouths keep moving when the voices are muted**: a commentator can talk over them and the table still looks alive. The sound effects keep their own control (ADR-0028).
- **`kind: "commentary"`** joins the utterance kinds (additive, protocol version 1). The page shows such a line in its own strip ("Commentary", the last two lines, under the top bar), **never in the chat or a seat's bubble, and no avatar speaks it**: the last speaker's mouth is released when it starts. The hub treats it as any line (a persona's voice if it names one), so nothing in the hub is special.
- Nothing speaks commentary yet: this is the hook. VIK-110 would send the lines.

## Not done

A separate commentator avatar or lower-third, and the commentator's own voice: VIK-110.
