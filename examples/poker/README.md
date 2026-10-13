# vikaki-poker

The poker half of the live table in [ADR-0018](../../docs/adr/0018-a-live-poker-table-with-llm-seats.md): a small Texas Hold'em engine. It is pure Python with no dependencies and knows nothing about avatars, the network or LLMs. The LLM seats that play it are the next card (VIK-57).

The engine owns the truth about the game. Whoever plays a seat only picks an action from `legal()`; anything else raises `IllegalAction` and changes nothing.

```python
from vikaki_poker import Hand

h = Hand([("ada", 200), ("ben", 200), ("cy", 200)], button=0, small_blind=1, big_blind=2, seed=7)
h.to_act                       # "ada": first to act after the big blind
h.view("ada")                  # what ada may know: the board, every stack and bet, her own cards, her legal moves
h.act("ada", "raise", 6)       # fold, check, call, or raise (the total to raise to; a bet is also a raise)
h.act("ben", "call")
h.act("cy", "fold")
# ... until h.complete; then h.winnings, h.final_stacks(), h.pots and h.events say what happened
```

No-limit rules: blinds, four betting rounds, side pots, an uncalled bet goes back, a short all-in does not let players who already acted raise again, and an odd chip goes to the first winner left of the button. Cards are strings such as `"As"`. A seeded shuffle makes a hand repeatable, and `deck=[...]` rigs one for a test (the dealing order is in `vikaki_poker/hand.py`).

## Tests

```bash
make check-poker      # from the repo root (needs uv)
```
