"""Play hands with LLM seats and let the avatars say what the LLMs say (ADR-0018).

For each move: the seat's avatar takes its thinking pose, its LLM decides, the line is spoken (the call waits until it is heard, so the table
talks one at a time), and then the engine applies the action. `Voice` is where the avatars come in: `HubVoice` drives a real hub with one
`vikaki-client` connection per seat (ADR-0017), `PrintVoice` just prints, and tests use a recording one.
"""

from __future__ import annotations

import inspect
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from .beats import action_event, new_hand_event, showdown_event, street_event, win_event
from .display import table_state
from .governor import Governor
from .hand import Hand, IllegalAction
from .pace import Pace
from .reactions import Reaction, Reactor
from .monologue import AFTER, Monologue, clip, critical_moment
from .seat import SeatAgent


class Voice(Protocol):
    def turn_started(self, seat_id: str) -> None: ...
    def say(self, seat_id: str, text: str, emotion: str | None, to: str | None = None) -> None:
        """Speak one line (to the seat `to`, or the whole table) and return when it has been heard (or could not be)."""
        ...
    def turn_ended(self, seat_id: str) -> None: ...
    # A voice may also have `react(seat_id, reaction)`, a silent reaction, `table_state(state)`, the table for the overlay, and `think(seat_id, text)`,
    # a private thought for the audience (VIK-93); one that lacks any just shows none (see `_react`, `_show` and `_think`).


class PrintVoice:
    """No avatars: print the lines. For a dry run without a hub."""

    def __init__(self, out: Callable[[str], None] = print) -> None:
        self._out = out

    def turn_started(self, seat_id: str) -> None:
        pass

    def say(self, seat_id: str, text: str, emotion: str | None, to: str | None = None) -> None:
        self._out(f"  {seat_id}{f' to {to}' if to else ''} ({emotion or 'neutral'}): {text}")

    def turn_ended(self, seat_id: str) -> None:
        pass

    def table_state(self, state: dict) -> None:
        pass

    def think(self, seat_id: str, text: str, aloud: bool = False) -> None:
        self._out(f"    {seat_id} thinks{' aloud' if aloud else ''}: {text}")

    def react(self, seat_id: str, reaction: Reaction) -> None:
        self._out(f"    {seat_id} reacts: {reaction.emotion or '-'}" + (f", {reaction.gesture}" if reaction.gesture else ""))


class HubVoice:
    """One `vikaki-client` driver per seat, each bound to its seat and persona. Needs `pip install vikaki-client` (see the README)."""

    def __init__(self, url: str, seats: dict[str, str], *, token: str | None = None, line_timeout: float = 90.0, on_problem: Callable[[str], None] = print) -> None:
        from vikaki_client import Vikaki  # imported here so the engine and the tests do not need the client

        self._persona = seats
        self._timeout = line_timeout
        self._on_problem = on_problem
        self._clients: dict[str, Any] = {}
        self.lines_heard = 0  # lines the hub reported finished (not interrupted, not failed)
        try:
            for seat_id, persona in seats.items():
                self._clients[seat_id] = Vikaki(url, token=token, seats=[{"seat_id": seat_id, "persona": persona}], client="vikaki-poker")
        except BaseException:
            self.close()
            raise

    def turn_started(self, seat_id: str) -> None:
        self._clients[seat_id].turn_started(seat_id)

    def say(self, seat_id: str, text: str, emotion: str | None, to: str | None = None) -> None:
        from vikaki_client import HubError

        client = self._clients[seat_id]
        try:
            uid = client.say(text, seat_id=seat_id, emotion=emotion, to=to)
            client.wait_finished(uid, timeout=self._timeout)
            self.lines_heard += 1
        except HubError as err:  # the table carries on without that line
            self._on_problem(f"  (could not speak for {seat_id}: {err.code})")

    def turn_ended(self, seat_id: str) -> None:
        self._clients[seat_id].turn_ended(seat_id)

    def table_state(self, state: dict) -> None:
        from vikaki_client import HubError

        rest = dict(state)
        seats = rest.pop("seats")
        try:
            next(iter(self._clients.values())).table_state(seats, **rest)  # the table is one thing: any driver may send it
        except HubError as err:
            self._on_problem(f"  (could not show the table: {err.code})")

    def think(self, seat_id: str, text: str, aloud: bool = False) -> None:
        from vikaki_client import HubError

        try:
            if aloud:  # an inner monologue (VIK-121): the hub speaks it softly and the page shows it as a thought, so no separate `thought` message
                client = self._clients[seat_id]
                client.wait_finished(client.say(text, seat_id=seat_id, thought=True), timeout=self._timeout)
                self.lines_heard += 1
            else:
                self._clients[seat_id].thought(seat_id, text)
        except HubError as err:  # the audience misses a thought; the game does not
            self._on_problem(f"  (could not show a thought for {seat_id}: {err.code})")

    def react(self, seat_id: str, reaction: Reaction) -> None:
        from vikaki_client import HubError

        try:
            self._clients[seat_id].react(seat_id, emotion=reaction.emotion, gesture=reaction.gesture, seconds=reaction.seconds)
        except HubError as err:  # a reaction is a garnish: say so and carry on
            self._on_problem(f"  (could not react for {seat_id}: {err.code})")

    def close(self) -> None:
        for client in self._clients.values():
            client.close()
        self._clients.clear()


@dataclass
class HandResult:
    hand: Hand
    log: list[str] = field(default_factory=list)
    thoughts: list[tuple[str, str]] = field(default_factory=list)  # (seat, private thought) in order: never shown to another seat
    said: list[tuple[str, str]] = field(default_factory=list)  # (seat, what it said) in order, for the style summary


def _decide_reactions(reactor: Reactor, pool: ThreadPoolExecutor, speaker: str, listeners: list[str], text: str, emotion: str | None, to: str | None = None) -> list:
    """Start each listener's reaction at once, so cheap model calls run while the line is being spoken."""

    def one(listener: str) -> Reaction | None:
        try:
            return reactor.react(listener, speaker, text, emotion, addressed=(listener == to))
        except Exception:  # a reactor that breaks must not stall the table
            return None

    return [(listener, pool.submit(one, listener)) for listener in listeners]


def _show(voice: Voice, hand: Hand, show_cards: bool, **beat: Any) -> None:
    """Tell the overlay how the table stands (and the beat just played: `event`, `hand_no`, `winners`). A voice with no `table_state` shows none."""
    send = getattr(voice, "table_state", None)
    if send is not None:
        send(table_state(hand, show_cards=show_cards, **beat))


def _think(voice: Voice, seat: str, text: str, aloud: bool = False) -> None:
    """Show the audience a seat's private thought, spoken when `aloud` (VIK-121). A voice with no `think` shows none."""
    send = getattr(voice, "think", None)
    if send is None:
        return
    if aloud and "aloud" in inspect.signature(send).parameters:  # a voice written before VIK-121 shows the thought as text
        send(seat, text, aloud=True)
    else:
        send(seat, text)


def _react(voice: Voice, pending: list) -> None:
    """Send what the listeners decided, in seat order. A voice with no `react` shows none."""
    send = getattr(voice, "react", None)
    for listener, future in pending:
        reaction = future.result()
        if reaction is not None and send is not None:
            send(listener, reaction)


def play_hand(hand: Hand, agents: dict[str, SeatAgent], voice: Voice, talk: list[tuple[str, ...]], out: Callable[[str], None] = print, reactor: Reactor | None = None, show_cards: bool = False, governor: Governor | None = None, hand_no: int = 0, pace: Pace | None = None, monologue: Monologue | None = None) -> HandResult:
    """Play `hand` to the end. `talk` is the table's recent chat, shared by all seats; lines spoken here are added to it.

    With a `reactor`, every other seat reacts silently to each line: the reactions are decided while the line is spoken and sent as soon
    as it has been heard (VIK-58). The overlay is told how the table stands at the start and after every action (VIK-61); its hole cards are face
    down until a showdown, or always face up with `show_cards`. The `governor` (one per session; a fresh one by default) holds the talk to each seat's
    budget (VIK-92): a line over it is dropped and noted. With a staged `hand` (VIK-113) every beat is shown in turn, each followed by the `pace`'s pause:
    the new hand, each action, each street, the showdown and the win. `hand_no` counts from 0; people are shown it from 1.
    """
    pool = ThreadPoolExecutor(max_workers=max(1, len(agents)))
    try:
        result = _play_hand(hand, agents, voice, talk, out, reactor, pool, show_cards, governor or Governor(), hand_no, pace or Pace(), monologue or Monologue())
    except BaseException:  # Ctrl-C: do not wait for the model calls still out, and do not start the queued ones
        pool.shutdown(wait=False, cancel_futures=True)
        raise
    pool.shutdown(wait=True)
    return result


def _play_hand(hand: Hand, agents: dict[str, SeatAgent], voice: Voice, talk: list[tuple[str, ...]], out: Callable[[str], None], reactor: Reactor | None, pool: ThreadPoolExecutor, show_cards: bool, governor: Governor, hand_no: int, pace: Pace, monologue: Monologue) -> HandResult:
    result = HandResult(hand)
    names = {seat_id: a.persona for seat_id, a in agents.items()}  # the characters' names, so a seat reads "ben raised" and not "seat-2 raised"

    def note(line: str) -> None:
        result.log.append(line)
        out(line)

    _show(voice, hand, show_cards, event=new_hand_event(hand_no + 1), hand_no=hand_no + 1)
    pace.wait("new_hand")
    while not hand.complete:
        if hand.awaiting:  # a staged hand: the street, the showdown or the payout is a beat of its own
            stage = hand.awaiting
            hand.advance()
            if stage == "street":
                event, winners = street_event(hand.street), None
            elif stage == "showdown":
                event, winners = showdown_event(), None
            else:
                event, winners = win_event(hand, names)
            _show(voice, hand, show_cards, event=event, winners=winners)
            pace.wait(event["kind"])
            continue
        legal = hand.legal()
        assert legal is not None
        seat = legal.seat_id
        agent = agents[seat]
        voice.turn_started(seat)
        decision = agent.decide(hand.view(seat), talk, hand.events, names)
        if decision.think:
            result.thoughts.append((seat, decision.think))
            reason = critical_moment(hand.view(seat), seat, decision.action, decision.amount, decision.equity, hand.big_blind)
            aloud = monologue.speaks(hand_no, seat, reason)
            _think(voice, seat, clip(decision.think) if aloud else decision.think, aloud)
            if aloud:
                note(f"    ({seat} thinks aloud: {reason or 'every thought'})")
                pace.wait("monologue")
        decision.say, dropped = governor.vet(seat, hand_no, hand.street, decision.say, agent.traits)
        if dropped:
            decision.note = f"{decision.note}; {dropped}".strip("; ")
        if decision.say:
            talk.append((seat, decision.say, decision.to) if decision.to else (seat, decision.say))
            result.said.append((seat, decision.say))
            pending = _decide_reactions(reactor, pool, seat, [s for s in agents if s != seat], decision.say, decision.emotion, decision.to) if reactor else []
            voice.say(seat, decision.say, decision.emotion, decision.to) if decision.to else voice.say(seat, decision.say, decision.emotion)
            _react(voice, pending)
        voice.turn_ended(seat)
        street = hand.street  # the street the move was made on (acting can end it)
        seen = len(hand.events)
        try:
            hand.act(seat, decision.action, decision.amount)
            moved = f"{seat} {decision.action}" + (f" to {decision.amount}" if decision.amount is not None else "")
        except IllegalAction as err:  # the engine only picks legal moves, so this is a bug guard: never stall the table
            fallback = "check" if legal.can_check else "fold"
            seen = len(hand.events)
            hand.act(seat, fallback)
            decision.note = f"{decision.note}; engine refused ({err}), played {fallback}".strip("; ")
            moved = f"{seat} {fallback}"
        beat = action_event(hand.events[seen], names)
        _show(voice, hand, show_cards, event=beat)
        note(f"[{street}] {moved}" + (f"  ({decision.note})" if decision.note else ""))
        pace.wait(beat["kind"])
    for event in hand.events:
        if event["type"] == "win":
            note(f"{event['seat_id']} wins {event['amount']}" + (" at showdown" if event["showdown"] else ""))
    _after_hand(hand, agents, voice, monologue, pace, names, hand_no, result, note)
    return result


def _after_hand(hand: Hand, agents: dict[str, SeatAgent], voice: Voice, monologue: Monologue, pace: Pace, names: dict[str, str], hand_no: int, result: HandResult, note: Callable[[str], None]) -> None:
    """The moments after a hand that deserve a spoken thought (VIK-121): the winner of a showdown or a big pot, a loser at the showdown, and a seat that is now broke.
    The engine decides nothing here, so the model is asked what the character thinks; one thought a hand per seat, and none when monologues are off."""
    if monologue.mode == "off":
        return
    bb = hand.big_blind
    stacks = hand.final_stacks()
    wins = {e["seat_id"]: e for e in hand.events if e["type"] == "win"}
    contenders = [p for p in hand.view(None)["players"] if not p["folded"]]
    for seat, agent in agents.items():
        if seat in wins and (wins[seat]["showdown"] or wins[seat]["amount"] >= 15 * bb):
            kind, what = "win", f"{agent.persona}, you won {wins[seat]['amount']} chips."
        elif seat not in wins and stacks.get(seat, 1) <= 0:
            kind, what = "bust", "You are out of chips."
        elif seat not in wins and any(p["seat_id"] == seat for p in contenders) and len(contenders) > 1 and any(e["showdown"] for e in wins.values()):
            kind, what = "showdown", "You lost at the showdown."
        else:
            continue
        reflect = getattr(agent, "reflect", None)
        if reflect is None or not monologue.speaks(hand_no, seat, kind):
            continue
        text = clip(reflect(f"The hand is over. {what} {AFTER[kind]}", names))
        if not text:
            continue
        result.thoughts.append((seat, text))
        _think(voice, seat, text, True)
        note(f"    ({seat} thinks aloud: {kind})")
        pace.wait("monologue")


@dataclass
class Session:
    stacks: dict[str, int]
    hands_played: int = 0
    rebuys: dict[str, int] = field(default_factory=dict)  # how many times each seat went broke and bought back in
    results: list[HandResult] = field(default_factory=list)
    interrupted: bool = False  # the user pressed Ctrl-C: the hand under way is not in `results`


def play_session(agents: dict[str, SeatAgent], voice: Voice, *, hands: int, stack: int = 200, small_blind: int = 1, big_blind: int = 2, seed: int = 0, out: Callable[[str], None] = print, reactor: Reactor | None = None, show_cards: bool = False, rebuy: bool = True, pace: Pace | None = None, monologue: Monologue | None = None) -> Session:
    """Deal up to `hands` hands, moving the button each time. A player who runs out of chips buys back in for `stack` (a cash game: the table keeps going,
    and `session.rebuys` counts them); with `rebuy=False` they are out, and the session ends when one player has all the chips. The same `seed` deals the same cards."""
    order = list(agents)
    session = Session({s: stack for s in order})
    talk: list[tuple[str, ...]] = []
    governor = Governor()
    monologue = monologue or Monologue()
    button = 0
    for n in range(hands):
        if rebuy:
            for s in order:
                if session.stacks[s] <= 0:
                    session.stacks[s] = stack
                    session.rebuys[s] = session.rebuys.get(s, 0) + 1
                    out(f"  ({agents[s].persona} buys back in for {stack})")
        alive = [s for s in order if session.stacks[s] > 0]
        if len(alive) < 2:
            break
        out(f"--- hand {n + 1}: " + ", ".join(f"{s} {session.stacks[s]}" for s in alive))
        hand = Hand([(s, session.stacks[s]) for s in alive], button % len(alive), small_blind, big_blind, seed=seed + n, staged=True)
        try:
            result = play_hand(hand, agents, voice, talk, out, reactor, show_cards, governor, n, pace, monologue)
        except KeyboardInterrupt:
            session.interrupted = True
            out("--- interrupted: stopping after the hand in progress is dropped")
            break
        session.results.append(result)
        session.stacks.update(hand.final_stacks())
        session.hands_played += 1
        button += 1
    return session
