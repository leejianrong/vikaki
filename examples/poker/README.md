# vikaki-poker

The poker half of the live table in [ADR-0018](../../docs/adr/0018-a-live-poker-table-with-llm-seats.md): a small Texas Hold'em engine, and LLMs that sit at the seats, play, and talk. The avatars speak what the LLMs say.

The engine owns the truth about the game. An LLM only picks an action from what is legal and says something; anything it gets wrong becomes a safe move (check if that is free, else fold) and is noted in the log, so a bad answer never stalls the table. Each seat is shown only its own cards and the recent table talk.

## Watch three LLMs play

You need Node and the repo set up (`pnpm install --frozen-lockfile && pnpm build`), and [uv](https://docs.astral.sh/uv/).

```bash
# 1. The hub, with the table's three characters
pnpm serve --port 8787 --personas personas.table.example.yaml
# 2. Open http://127.0.0.1:8787/avatar?seats=3 in a browser
# 3. Seat the players (a scripted stand-in LLM: no key, no cost)
cd examples/poker
uv run --with ../../clients/python python -m vikaki_poker play --table table.example.yaml --fake-llm --hands 3
```

Add `--no-hub` to print the lines instead of speaking them (no hub needed).

The seats that are listening react silently to each line: a feeling and a nod, shake or tilt, sent as `react` events as soon as the line is heard. Without a model they follow a fixed table of how listeners tend to answer an emotion (free, and the same every time). Name a cheap model as `reaction_model` in the table file and each listener asks it instead, one short call per listener (counted in the summary). `--no-reactions` keeps the listeners still.

The page also shows the table (pot, board, stacks, bets, dealer button, whose turn it is) as a `table_state` the runner sends at the start of each hand and after every move. Hole cards are face down until a showdown; `--show-cards` turns every live hand face up all the time, which is fun for watching an LLM bluff. A folded hand is never shown.

### With real models (OpenRouter)

Put your key in a git-ignored `.env` in the folder you run from (or export it). `.env.example` is the template:

```bash
cd examples/poker
cp .env.example .env     # then put the key after OPENROUTER_API_KEY=
uv run --with ../../clients/python python -m vikaki_poker play --table table.example.yaml --hands 3
```

Each seat's model is set in `table.example.yaml` (OpenRouter model ids; the example uses `deepseek/deepseek-v4.1-flash`, about a tenth of a cent a hand). Thinking models run with reasoning off, which keeps the reply inside `max_tokens` and avoids dead air at the table; `--reasoning` leaves it to the model. An error from the provider (for example an OpenRouter guardrail blocking the model) is shown with its reason, or `--model` plays every seat with one. The key is read from the environment only, goes only into the request's `Authorization` header, and is never logged. At the end the command prints calls and tokens per seat (and cost, when the provider reports it); `max_tokens` in the table file caps each reply. `--base-url` points at another OpenAI-compatible endpoint.

## The engine on its own

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

No-limit rules: blinds, four betting rounds, side pots, an uncalled bet goes back, a short all-in does not let players who already acted raise again, and an odd chip goes to the first winner left of the button. Cards are strings such as `"As"`. A seeded shuffle makes a hand repeatable, and `deck=[...]` rigs one for a test (the dealing order is in `src/vikaki_poker/hand.py`).

## How it fits

| File | What |
| --- | --- |
| `hand.py`, `evaluate.py`, `cards.py` | The rules: a pure engine, no network, no LLM |
| `llm.py` | The `Llm` interface, a scripted `FakeLlm`, and `OpenRouterLlm` (standard library HTTPS, no SDK) |
| `seat.py` | The prompt a seat is given, how its JSON answer is read, and the fallbacks |
| `runner.py` | Plays hands: think pose, ask the LLM, speak, act. `HubVoice` is one `vikaki-client` driver per seat |
| `table.py` | The example's table file: seats, personas, models, blinds |

## Tests

```bash
make check-poker      # from the repo root (needs uv): engine, LLM seats and the runner; no hub, no key, no network
```

`tests/test_hub_integration.py` plays a hand on a real hub with the fake voice and runs in CI; locally set `VIKAKI_HUB_URL` (the hub must be started with `--personas personas.table.example.yaml`) and install `vikaki-client`, as above.
