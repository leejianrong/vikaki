# ADR-0023: Private thoughts are a separate message, not an utterance

- Status: Accepted (Jian asked for a view into what the players think, 2026-10-18; VIK-93)
- Date: 2026-10-19
- Deciders: Jian, Claude

## Context

A player's model can say what it is thinking before it acts, and an audience would like to read it (and, later, hear it: VIK-98). The first idea is to send it as an `utterance` with a `kind`. But the hub speaks every utterance, aloud, through the seat's avatar, and every viewer plays it. A thought spoken as a line would be heard by the whole table and sit in the chat.

## Decision

- The model's reply gains a `think` field, listed first so it reasons before it picks a move (with reasoning off this is the only room it has to). It is short, in character, at most 25 words, and the prompt says nobody at the table hears it. The runner keeps it on the `Decision`, never in the table's `talk` or in the story of the hand, so it cannot reach another seat's prompt (a test checks it).
- A new additive protocol message, `thought` (`seat_id`, `text`, optional `persona`). A driver may send it for its own seat (a seat driver for another seat's thought gets `not_allowed`). The hub relays it to viewers only, as it does every driver message, and fills in the persona. It is never spoken and never becomes an utterance. `protocol_version` stays 1.
- The page shows each thought as text in a Thoughts section of the side panel, apart from the Chat, and a small mark beside the thinker's head until that seat's next turn begins. The existing thinking dots (`turn_started`) stay: they say a move is being worked out; the mark says a thought is there to read.
- The Python client has `thought()`. The poker voices have an optional `think`, like `react`: a voice without one shows nothing.

## Consequences

- A reply is about 40 tokens longer, so `max_tokens` is 300 by default.
- Listening to a thought (a softer voice, one spotlit seat, switching seat) is VIK-98 and builds on this message.
- A model can put a lie in its thought as easily as in its speech; the prompt asks it to be honest there, and nothing enforces it.
