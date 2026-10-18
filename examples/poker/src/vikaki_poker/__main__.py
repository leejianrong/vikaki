"""`python -m vikaki_poker play`: LLMs play hands at the Vikaki table. See the README."""

from __future__ import annotations

import argparse
import os
import random
import sys
from typing import Sequence

from .stats import style_lines, style_stats
from .pace import PACES, Pace
from .llm import KEY_ENV, FakeLlm, Llm, LlmError, OpenRouterLlm, Usage, load_dotenv
from .runner import HubVoice, PrintVoice, Voice, play_session
from .table import TableError, build_agents, build_reactor, load_table

# What `--fake-llm` says: no key, no cost. The words and thoughts are scripted; the moves are the engine's, as with a real model.
DEMO_REPLIES = [
    '{"think": "A strong start. Push them out early.", "say": "Let us make this interesting.", "emotion": "smug"}',
    '{"think": "Not sure about this one, but the price is fair.", "say": "Hmm, I will stay in.", "emotion": "worried"}',
    '{"think": "That bet is too big for what I hold.", "say": "Too rich for me.", "emotion": "sad"}',
    '{"think": "Free card, and I am happy to see it.", "say": "Check. Take your time.", "emotion": "happy"}',
    '{"think": "They keep showing up. Fine by me.", "say": "Oh, you again!", "emotion": "surprised"}',
]


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vikaki_poker", description="LLMs play poker at the Vikaki table.")
    sub = p.add_subparsers(dest="command", required=True)
    play = sub.add_parser("play", help="play hands")
    play.add_argument("--table", required=True, help="a table file (see table.example.yaml)")
    play.add_argument("--hands", type=int, default=3)
    play.add_argument("--seed", type=int, help="the same seed deals the same cards (default: a fresh one each game, printed so a game can be repeated)")
    play.add_argument("--url", default="ws://127.0.0.1:8787/ws", help="the hub")
    play.add_argument("--token", default=os.environ.get("VIKAKI_TOKEN"), help="the hub's driver token, if it has one")
    play.add_argument("--no-hub", action="store_true", help="print the lines instead of speaking them")
    play.add_argument("--fake-llm", action="store_true", help=f"no model calls: a scripted stand-in (no {KEY_ENV} needed)")
    play.add_argument("--no-reactions", action="store_true", help="the seats that are listening stay still (no silent reactions)")
    play.add_argument("--show-cards", action="store_true", help="show every live hand face up on the page (the default: the table page is a spectator's view, with each seat's hand and chance to win)")
    play.add_argument("--pace", choices=sorted(PACES, key=PACES.get), help="how long each beat of a hand stays on screen: slow, normal (about 1.75 s an action, 2.5 s a street), fast, or off (default: normal; off with --no-hub)")
    play.add_argument("--stack", type=int, help="chips each seat starts with (default: the table file's)")
    play.add_argument("--blinds", help="the blinds as SMALL/BIG, such as 5/10 (default: the table file's); with a short --stack they end a --no-rebuy game sooner")
    play.add_argument("--no-rebuy", action="store_true", help="a player who goes broke is out, and the session ends when one player has every chip (default: they buy back in)")
    play.add_argument("--hide-cards", action="store_true", help="keep the hands face down until a showdown, with no hand names or odds on the page")
    play.add_argument("--model", help="play every seat with this model instead of the table file's")
    play.add_argument("--reasoning", action="store_true", help="let a thinking model think before it answers (default: off; slower, and it needs a larger max_tokens in the table file)")
    play.add_argument("--base-url", help="another OpenAI-compatible endpoint (default: OpenRouter)")
    return p


def _summary(agents: dict, out, reactor=None) -> None:
    total = Usage()
    for seat, agent in agents.items():
        total.add(agent.usage)
        out(f"  {seat}: {agent.usage.calls} calls, {agent.usage.prompt_tokens}+{agent.usage.completion_tokens} tokens")
    if isinstance(getattr(reactor, "usage", None), Usage):  # reactions asked a model: count them too
        total.add(reactor.usage)
        out(f"  reactions: {reactor.usage.calls} calls, {reactor.usage.prompt_tokens}+{reactor.usage.completion_tokens} tokens")
    cost = f", cost {total.cost:.4f} credits" if total.cost else ""
    out(f"model use: {total.calls} calls, {total.prompt_tokens}+{total.completion_tokens} tokens{cost}")


def main(argv: Sequence[str] | None = None, *, llm: Llm | None = None, voice: Voice | None = None) -> int:
    args = _parser().parse_args(argv)
    load_dotenv()
    try:
        table = load_table(args.table, default_model=args.model)
        if args.model:
            for seat in table.seats:
                seat.model = args.model
        if llm is None:
            llm = FakeLlm(DEMO_REPLIES) if args.fake_llm else OpenRouterLlm.from_env(reasoning=args.reasoning, **({"base_url": args.base_url} if args.base_url else {}))
        if args.stack is not None:
            if args.stack <= 0:
                raise TableError("--stack must be a positive whole number")
            table.stack = args.stack
        if args.blinds is not None:
            try:
                small, big = (int(x) for x in args.blinds.split("/"))
            except ValueError:
                raise TableError("--blinds must look like 5/10") from None
            if not 0 < small <= big:
                raise TableError("--blinds must look like 5/10, with the small blind no bigger than the big one")
            table.small_blind, table.big_blind = small, big
        if table.stack < 2 * table.big_blind:
            raise TableError(f"a stack of {table.stack} is under two big blinds ({table.big_blind})")
    except (TableError, LlmError) as err:
        print(f"vikaki_poker: {err}", file=sys.stderr)
        return 2
    agents = build_agents(table, llm)
    reactor = None if args.no_reactions else build_reactor(table, None if args.fake_llm else llm)
    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(1, 1_000_000)
    print(f"seed {seed} (repeat this deal with --seed {seed})")
    for i, agent in enumerate(agents.values()):
        agent.reseed(seed * 101 + i)  # the engine's dice follow the seed too
    own_voice = voice is None
    if voice is None:
        if args.no_hub:
            voice = PrintVoice()
        else:
            try:
                voice = HubVoice(args.url, table.personas(), token=args.token)
            except Exception as err:  # connect_failed, driver_busy, unknown_persona: say so plainly
                code = getattr(err, "code", type(err).__name__)
                print(f"vikaki_poker: could not join the table at {args.url} ({code}). Is `pnpm serve --personas personas.table.example.yaml` running?", file=sys.stderr)
                return 1
    try:
        session = play_session(agents, voice, hands=args.hands, stack=table.stack, small_blind=table.small_blind, big_blind=table.big_blind, seed=seed, reactor=reactor, show_cards=not args.hide_cards, rebuy=not args.no_rebuy, pace=Pace(PACES[args.pace or ("off" if args.no_hub else "normal")]))
    finally:
        if own_voice and hasattr(voice, "close"):
            try:
                voice.close()  # type: ignore[union-attr]
            except KeyboardInterrupt:  # a second Ctrl-C while leaving: the connections close with the process
                pass
    if session.interrupted:
        print(f"interrupted after {session.hands_played} hands")
    print("chips: " + ", ".join(f"{s} {n}" for s, n in session.stacks.items()) + (f" (rebuys: {', '.join(f'{s} {n}' for s, n in session.rebuys.items())})" if session.rebuys else ""))
    for row in style_lines(style_stats(session.results, list(agents)), {s: a.persona for s, a in agents.items()}):
        print(row)
    _summary(agents, print, reactor)
    return 130 if session.interrupted else 0


if __name__ == "__main__":
    raise SystemExit(main())
