# ADR-0025: The game paces the table, and the page animates the difference between two states

- Status: Accepted (Jian could not follow a hand, 2026-10-19; VIK-113, VIK-114, VIK-94)
- Date: 2026-10-19
- Deciders: Jian, Claude

## Context

The runner played at the speed of the models and sent a `table_state` after each move; the page redrew it. A raise, a fold, a new street and a win were all just numbers changing. Worse, the engine dealt the next street (and, when everyone was all in, the whole run-out and the payout) inside the move that closed the betting, so a viewer never saw a call before the flop, or a river before the showdown.

## Decision

- **The hand is staged** (`Hand(staged=True)`, used by the runner): when a street's betting closes the hand waits (`awaiting`: `street`, then at the end of the river `showdown`, then `payout`; everyone folding goes straight to `payout`) until the runner calls `advance()`. The runner shows each step as its own state, so a call, the sweep of the bets with the flop, the turn, the river, the hands turned over and the pot paid are separate beats. An unstaged hand behaves as before; the two play to the same result (a test over 12 deals).
- **The game owns the timing** (`pace.py`): after each beat the runner waits (a fold 2.2 s, a check 2.5, a call 2.8, a raise 3.4, a street 3.2 s, the showdown 3.5 s, the win 4 s, a new hand 3 s; a call or raise adds up to 2 s more by its size against the pot (VIK-134); `--pace slow|normal|fast|off` scales it, off with `--no-hub`). There is no acknowledgement from the page: the runner already blocks on speech, and the beats are slow enough for any machine. A page that is behind lands each flight at once when the next state arrives.
- **Additive fields on `table_state`**: `event` (`kind`, `text`, optional `seat_id`, `amount`: the beat just played, with banner words the game writes), `hand_no`, and `winners` (seat, amount, the hand's name when the cards were shown). The page knows no poker: it draws `text`.
- **The page finds the motion by comparing two states** (`table-motion.ts`, pure and tested): a seat's bet grew, so chips fly from its stack to its bet spot; bets that disappeared were swept into the pot; winners appeared, so the pot slides to them; a seat folded, so its cards are pushed away. The piles the chips leave and join are drawn as they were until the last chip lands. The middle pile is now the pot less the bets still in front of the players (the pot counted both, so chips were drawn twice). Reduced motion (`prefers-reduced-motion`) skips the flights.
- A banner (`role=status`, "Last move") shows `event.text`: a move for 1.9 s, a new hand or street for 2.3 s, the showdown and the win until the next beat; the acting seat's plate pulses.

## Consequences

- The all-in run-out is finally visible (VIK-94). A hand now takes about 15 to 25 s at normal pace, a 20-hand session about 6 to 8 minutes plus the models' own time.
- Cards flipping on a new street, the dealing of a hand and the best five highlighted at a showdown build on the same plan (VIK-114).
- A game other than poker can use the same fields: `event` and `winners` say nothing about cards.
- Added with VIK-114 and VIK-94: `event.detail` (a second line on the title card: blinds and dealer) and `winners[].best` (the five cards that make the hand, for the page to light). `planMotion` also plans `deals` (a new hand's title card arrives), `boardFlips` (board cards new since the last state) and `holeFlips` (hands turning face up); the page holds those cards back while a squash-flip in the air plays, so a card is never drawn twice.
- Added with VIK-134: after every move the others react silently while it sits on screen (`action_reactions.py`: an all-in startles the table, a big raise worries it, a small move draws nothing, the same every time for a seat and hand; off with `--no-reactions`), and the page turns every head toward the player who just acted for about 2 s until a line or the next turn takes the gaze.
