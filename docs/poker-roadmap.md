# The poker table: what comes next

Jian's feedback of 2026-10-18, turned into epics on Pandan board 35. Where the board and this page disagree, trust the board; where either disagrees with the code, trust the code.

## Decisions so far

- **A quiet table.** Public chat is for gaining information or banter, not narration; an engine-side governor enforces it whatever the model does. Private thoughts are a separate channel (a `think` field and a `thought` message, never an `utterance`, because the hub speaks every utterance).
- **Listen in.** The audience clicks a player to hear and read that player's thoughts: a softer, filtered voice-over, the avatar's mouth still, one spotlit seat for the whole table, thoughts of the other seats silent (with a show-all toggle). Other players cannot interrupt a thought: it happens inside its owner's turn and the table is turn-based. The audience switching seat cancels it.
- **POV.** Listening in cuts to the player's own eyes (head hidden from that camera). A grid of every player's POV is a shot the director can cut to.
- **Cameras.** Study of real broadcasts (hole cams in the rail or under glass since 1999, wide and overhead shots, reaction close-ups): presets plus an auto-director; no crane moves. The hole-cam is the panel's cards with win percentages.
- **Run-out and showdown.** When everyone is all in the streets are revealed one at a time and the pot visibly goes to the winner (the engine used to deal the rest of the board inside the last bet).
- **Life.** A cozy den (a living room in someone's house), procedural cartoon props, and fidgets in this order of value: looking round the room, peeking at the cards, restacking chips. Arms differ between avatars, so reaching fidgets get per-avatar fallbacks.
- **Built so far:** the den (VIK-101, ADR-0033), look-around (VIK-102, ADR-0034), the fidget scheduler (VIK-103, ADR-0035), peeking at the cards (VIK-104, ADR-0036), restacking chips (VIK-105, ADR-0037), the idle extras (VIK-106, ADR-0038), buy-back (VIK-108, ADR-0039), commentary hooks (VIK-109, ADR-0040), a table of six or more (VIK-88, ADR-0041), our own CFR for push/fold and the river (VIK-123, ADR-0042), an AI commentator (VIK-110, ADR-0043).
- **Buy-back** by audience request, with a policy (ask, auto, never). **Commentary:** Jian commentates himself for now (a volume or mute control and a reserved `commentary` kind); an AI commentator is a stretch goal. **A table of 6 or more** is wanted eventually (VIK-88).

## The phases

| Phase | Epic | Cards |
| --- | --- | --- |
| 1. Clarity | VIK-E7 | VIK-91 chat panel and bubbles, VIK-92 talk governor, VIK-93 private thoughts, VIK-94 all-in run-out and showdown |
| 2. Cameras | VIK-E8 | VIK-95 presets, VIK-96 auto-director, VIK-97 hole-cam graphic, VIK-98 listen in, VIK-99 seat POV, VIK-100 POV grid |
| 3. Life | VIK-E9 | VIK-101 the den, VIK-102 look targets, VIK-103 fidget scheduler, VIK-104 peek, VIK-105 restack chips, VIK-106 idle extras, VIK-107 frame-time guard |
| Alongside | VIK-E10 | VIK-108 buy-back, VIK-109 commentary hooks, VIK-110 AI commentator (stretch), VIK-88 six or more players |

Dependencies are recorded on the cards (for example listen in needs private thoughts; the director needs the cameras and the run-out; the fidgets need the room).
