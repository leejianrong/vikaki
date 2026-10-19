# ADR-0027: A spoken thought is an utterance with a flag

- Status: Accepted (VIK-121, covers VIK-98)
- Date: 2026-10-19
- Deciders: Jian, Claude

## Context

Private thoughts (ADR-0023) are text: a panel and a mark over the thinker. At the moments that matter (an all-in, a big call, a strong hand folded, a showdown, a bust-out) the audience should hear the thought too, in a way that is plainly not table talk. The hub speaks utterances only, one at a time, so a spoken thought needs a path through the speech queue.

## Decision

- **`utterance` gets an additive `thought` flag.** The hub speaks it on the same queue as every line (so one seat at a time, never over table talk), and passes its audio through a soft filter (`thought-filter.ts`: about 5 dB quieter, rolled off above 2.2 kHz, a short echo) so it sounds inside a head. `protocol_version` stays 1.
- **The page treats it as a thought, not chat.** The bubble turns dashed and italic with a "Thinking" label, the text goes to the Thoughts panel, and the Chat stays table talk only. A spoken thought is not also sent as a `thought` message.
- **The game decides when, the model writes the words.** `monologue.py` marks the moments (`all-in`, `a big bet`, `a big call`, `a strong hand folded`, then after the hand a showdown win or loss, a big pot, going broke). The words are the `think` the model wrote for the move; after a hand, where the engine decides nothing, the seat is asked once what goes through its head. No scripted phrases for real models.
- **`--monologue critical|all|off`**, default `critical`. A seat speaks at most once a hand, a thought is clipped to about 30 words, and a longer pause (1.2 s at normal pace) follows it.

## Consequences

- The mouth moves with the soft audio like any speech; a thought is quieter, so the movement is smaller. A closed-mouth "thinking" look is left for the cameras cards (VIK-95 to VIK-100, listen-in).
- Any game can use the flag: it says nothing about cards.
- After-hand thoughts cost a model call each for the few seats they apply to.
