# vikaki-poker

The poker half of the live table in [ADR-0018](../../docs/adr/0018-a-live-poker-table-with-llm-seats.md): a small Texas Hold'em engine, and LLMs that sit at the seats, play, and talk. The avatars speak what the LLMs say.

The engine owns the truth about the game. An LLM only picks an action from what is legal and says something; anything it gets wrong becomes a safe move (check if that is free, else fold) and is noted in the log, so a bad answer never stalls the table. Each seat is shown only its own cards and the recent table talk.

## Watch three LLMs play

The short way: `make demo-table` in one terminal (the hub, with the three characters), `make poker` in another (real models; `make poker POKER_ARGS="--fake-llm --hands 3"` for the scripted stand-in). `POKER_ARGS` defaults to a short tournament (`--stack 100 --blinds 2/4 --no-rebuy --hands 20`). Then open http://127.0.0.1:8787/ and follow the Poker table link (or go straight to http://127.0.0.1:8787/avatar?seats=3&view=table). What it does, step by step:

You need Node and the repo set up (`pnpm install --frozen-lockfile && pnpm build`), and [uv](https://docs.astral.sh/uv/).

```bash
# 1. The hub, with the table's three characters
pnpm serve --port 8787 --personas personas.table.example.yaml
# 2. Open http://127.0.0.1:8787/avatar?seats=3 in a browser
# 3. Seat the players (a scripted stand-in LLM: no key, no cost)
cd examples/poker
uv run --with-editable ../../clients/python python -m vikaki_poker play --table table.example.yaml --fake-llm --hands 3
```

Add `--no-hub` to print the lines instead of speaking them (no hub needed). `--pace slow|normal|fast|off` sets how long each beat of a hand stays on screen (normal: about 1.75 s an action, 2.5 s a street, 3 s the showdown, 3.5 s the win; off with `--no-hub`), so a 20-hand game takes minutes, not seconds ([ADR-0025](../../docs/adr/0025-the-game-paces-the-table-and-the-page-animates-the-difference.md)). Ctrl-C stops after dropping the hand in progress, prints the chips, the style table and the model use for the hands already played, and exits with status 130.

Each model also answers with a `think` field, a private thought for the audience (ADR-0023). The runner sends it as a `thought` message: the table page shows it in a Thoughts panel, it is never spoken, and no other seat's prompt contains it.

The seats that are listening react silently to each line: a feeling and a nod, shake or tilt, sent as `react` events as soon as the line is heard. Without a model they follow a fixed table of how listeners tend to answer an emotion (free, and the same every time). Name a cheap model as `reaction_model` in the table file and each listener asks it instead, one short call per listener (counted in the summary). `--no-reactions` keeps the listeners still.

The page also shows the table (pot, board, stacks, bets, dealer button, whose turn it is) as a `table_state` the runner sends at the start of each hand and after every move. The table page is a spectator's view: every live hand is shown face up, with its name in words, its chance to win and what each seat did last (the numbers come from `vikaki_poker.facts`: exact when few boards are left, else sampled). In the 3D view they fill a side panel. `--hide-cards` keeps the hands face down until a showdown and sends no names or odds. A folded hand is never shown.

If the page shows no names or odds after you change the protocol, restart the hub: it keeps the old message shape in memory. Install the client with `--with-editable`, as above and as `make poker` does: a plain `--with ../../clients/python` is cached by `pyproject.toml`'s timestamp, and uv would go on serving an old protocol schema.

### With real models (OpenRouter)

Put your key in a git-ignored `.env` in the folder you run from (or export it). `.env.example` is the template:

```bash
cd examples/poker
cp .env.example .env     # then put the key after OPENROUTER_API_KEY=
uv run --with-editable ../../clients/python python -m vikaki_poker play --table table.example.yaml --hands 3
```

Each seat's model is set in `table.example.yaml` (OpenRouter model ids; the example uses `deepseek/deepseek-v4.1-flash`, about a tenth of a cent a hand). Thinking models run with reasoning off, which keeps the reply inside `max_tokens` and avoids dead air at the table; `--reasoning` leaves it to the model. An error from the provider (for example an OpenRouter guardrail blocking the model) is shown with its reason, or `--model` plays every seat with one. The key is read from the environment only, goes only into the request's `Authorization` header, and is never logged. At the end the command prints calls and tokens per seat (and cost, when the provider reports it); `max_tokens` in the table file caps each reply. `--base-url` points at another OpenAI-compatible endpoint.

## How the players think

Each turn has two stages ([ADR-0026](../../docs/adr/0026-the-engine-decides-the-move.md)):

- **The engine decides** (`strategy.py`): from the cards and the betting alone, with no model and no personality. It narrows each opponent's possible hands by what they did, plays out a few hundred random finishes, prices fold, call and each bet size, and takes the best (a little chance mixed in among near-equals). A turn takes 50 to 150 ms.
- **The model performs**: it is told the move ("raise to 12") and the engine's reasons, with the situation, the story of the hand and the table talk, and is asked only for what the character says aloud, thinks and feels (`{"think", "say", "emotion"}`). It is never asked for an action, so nothing in its reply or its personality can change the move; if it fails, the seat makes the engine's move and says nothing.
- **A personality, for talk only**: give a seat `traits` in the table file, each from 0 to 1: `talkative` (how much it says), `emotional` (how much it shows), and a free-text `quirk` set how it talks and thinks; `loose`, `aggressive` and `tricky` colour how it talks about the game. None of them can change what a seat does (a test plays two opposite personalities through the same hands and checks the moves are identical). Write a quirk about how a character talks, not how it plays. Talk is budgeted by `talkative` (`governor.py`): quiet 10 words every third turn or so, middling 14 every other turn, chatty 20.

  ```yaml
  seat-3:
    persona: cy
    model: deepseek/deepseek-v4.1-flash
    traits: {talkative: 0.6, emotional: 0.35, quirk: "grins, brags about gambles and big moves, and never explains a bluff"}
  ```

  `table.example.yaml` has three: ada the narrating showman, ben the polite worrier who apologises, cy the grinning braggart. They are archetypes of how real players are known to talk, not impersonations. Seats with no `traits` talk in a middling way.
- `--stack N` and `--blinds 5/10` override the table file, so a `--no-rebuy` game with short stacks and big blinds is a short tournament (`--stack 100 --blinds 2/4 --no-rebuy --hands 20` plays until one player has every chip).
- At the end of a session the command prints how each seat actually played (hands, VPIP, PFR, aggression, folds, lines and words per move), so you can see how the table plays (the talk numbers differ by character; the play numbers should not differ much). A player who goes broke buys back in (`--no-rebuy` for a tournament).
- `vikaki_poker.strategy` is the decision engine (ADR-0026): `EngineBot` plays it with no model, and `uv run python tools/strength.py --hands 900 --table engine,advisor,advisor` measures a player in big blinds per 100 hands over duplicate deals (every deal played in every seat). The live table uses it for every seat.
- `vikaki_poker.advisor` has the rule of thumb as a model-free player, a calling station and a random bot, and `simulate`: a free table for tests and for checking the advice (over 400 hands the advisor beats the other two by a wide margin; three advisors against each other finish level within the noise). Without `--seed` a game is dealt afresh and prints its seed, so it can be repeated with `--seed N`.

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
