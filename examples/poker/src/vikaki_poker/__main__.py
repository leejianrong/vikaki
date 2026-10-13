"""`python -m vikaki_poker play`: LLMs play hands at the Vikaki table. See the README."""

from __future__ import annotations

import argparse
import os
import sys
from typing import Sequence

from .llm import KEY_ENV, FakeLlm, Llm, LlmError, OpenRouterLlm, Usage, load_dotenv
from .runner import HubVoice, PrintVoice, Voice, play_session
from .table import TableError, build_agents, load_table

# What `--fake-llm` says: no key, no cost, always legal moves ("call" is read as "check" when nothing is owed).
DEMO_REPLIES = [
    '{"action": "raise", "amount": 6, "say": "Let us make this interesting.", "emotion": "smug"}',
    '{"action": "call", "say": "Hmm, I will stay in.", "emotion": "worried"}',
    '{"action": "fold", "say": "Too rich for me.", "emotion": "sad"}',
    '{"action": "check", "say": "Check. Take your time.", "emotion": "happy"}',
    '{"action": "call", "say": "Oh, you again!", "emotion": "surprised"}',
]


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vikaki_poker", description="LLMs play poker at the Vikaki table.")
    sub = p.add_subparsers(dest="command", required=True)
    play = sub.add_parser("play", help="play hands")
    play.add_argument("--table", required=True, help="a table file (see table.example.yaml)")
    play.add_argument("--hands", type=int, default=3)
    play.add_argument("--seed", type=int, default=1, help="the same seed deals the same cards")
    play.add_argument("--url", default="ws://127.0.0.1:8787/ws", help="the hub")
    play.add_argument("--token", default=os.environ.get("VIKAKI_TOKEN"), help="the hub's driver token, if it has one")
    play.add_argument("--no-hub", action="store_true", help="print the lines instead of speaking them")
    play.add_argument("--fake-llm", action="store_true", help=f"no model calls: a scripted stand-in (no {KEY_ENV} needed)")
    play.add_argument("--model", help="play every seat with this model instead of the table file's")
    play.add_argument("--base-url", help="another OpenAI-compatible endpoint (default: OpenRouter)")
    return p


def _summary(agents: dict, out) -> None:
    total = Usage()
    for seat, agent in agents.items():
        total.add(agent.usage)
        out(f"  {seat}: {agent.usage.calls} calls, {agent.usage.prompt_tokens}+{agent.usage.completion_tokens} tokens")
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
            llm = FakeLlm(DEMO_REPLIES) if args.fake_llm else OpenRouterLlm.from_env(**({"base_url": args.base_url} if args.base_url else {}))
    except (TableError, LlmError) as err:
        print(f"vikaki_poker: {err}", file=sys.stderr)
        return 2
    agents = build_agents(table, llm)
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
        session = play_session(agents, voice, hands=args.hands, stack=table.stack, small_blind=table.small_blind, big_blind=table.big_blind, seed=args.seed)
    finally:
        if own_voice and hasattr(voice, "close"):
            voice.close()  # type: ignore[union-attr]
    print("chips: " + ", ".join(f"{s} {n}" for s, n in session.stacks.items()))
    _summary(agents, print)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
