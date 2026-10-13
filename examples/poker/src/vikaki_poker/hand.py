"""One hand of no-limit Texas Hold'em: blinds, four betting rounds, showdown, side pots.

The engine owns the truth about the game. Whoever plays a seat (a person, a script, an LLM) only chooses an action from `Hand.legal()`
and sends it with `Hand.act()`; a choice that is not legal raises `IllegalAction` and changes nothing.

Dealing order, so a test can rig the deck: the deck is dealt from the front. Two passes of one hole card each, starting with the seat left of
the button. Then one burn card and the flop (three cards), one burn and the turn, one burn and the river.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .cards import shuffled_deck, validate
from .evaluate import best_score, describe


class IllegalAction(ValueError):
    """The action is not allowed right now. The hand is unchanged."""


@dataclass
class Player:
    seat_id: str
    stack: int
    hole: tuple[str, ...] = ()
    bet: int = 0  # chips put in on this street
    committed: int = 0  # chips put in this hand
    folded: bool = False
    all_in: bool = False

    @property
    def active(self) -> bool:
        """Still in the hand and able to act (not folded, not all in)."""
        return not self.folded and not self.all_in


@dataclass(frozen=True)
class Legal:
    """What the player to act may do. Folding is always allowed."""

    seat_id: str
    can_check: bool
    call_amount: int  # chips to put in to call (0 when checking is allowed); capped at the stack
    can_raise: bool
    min_raise_to: int = 0  # the smallest legal "raise to" total for this street; the stack's worth if a full raise is out of reach
    max_raise_to: int = 0  # all in

    def kinds(self) -> list[str]:
        out = ["fold"]
        out.append("check" if self.can_check else "call")
        if self.can_raise:
            out.append("raise")
        return out


@dataclass
class Hand:
    """Deal a hand. `players` is `(seat_id, stack)` in seat order; `button` indexes it. Pass `seed` for a repeatable shuffle, or `deck` to rig one."""

    players: list[tuple[str, int]]
    button: int
    small_blind: int
    big_blind: int
    seed: int | None = None
    deck: list[str] | None = None

    seats: list[Player] = field(init=False)
    board: list[str] = field(init=False, default_factory=list)
    street: str = field(init=False, default="preflop")  # preflop, flop, turn, river, complete
    events: list[dict] = field(init=False, default_factory=list)
    winnings: dict[str, int] = field(init=False, default_factory=dict)
    pots: list[dict] = field(init=False, default_factory=list)  # filled at the end: amount, who was eligible, who won
    showdown: bool = field(init=False, default=False)

    def __post_init__(self) -> None:
        ids = [s for s, _ in self.players]
        if len(ids) < 2 or len(set(ids)) != len(ids):
            raise ValueError("a hand needs two or more players with different seat ids")
        if any(n <= 0 for _, n in self.players):
            raise ValueError("every player needs chips")
        if not 0 <= self.button < len(ids):
            raise ValueError("button is not a seat")
        if not 0 < self.small_blind <= self.big_blind:
            raise ValueError("blinds must satisfy 0 < small <= big")
        self.seats = [Player(s, n) for s, n in self.players]
        self.start_stacks = dict(self.players)
        self._deck = [validate(c) for c in self.deck] if self.deck is not None else shuffled_deck(self.seed)
        self._current_bet = 0
        self._min_raise = self.big_blind
        self._pending: list[int] = []
        self._locked: set[int] = set()  # already acted and facing only a short all-in: may call or fold, not raise again
        self._deal_hole_cards()
        self._post_blinds()
        self._settle()

    # --- reading the hand

    @property
    def pot(self) -> int:
        return sum(p.committed for p in self.seats)

    @property
    def to_act(self) -> str | None:
        return self.seats[self._pending[0]].seat_id if self._pending and self.street != "complete" else None

    @property
    def complete(self) -> bool:
        return self.street == "complete"

    def player(self, seat_id: str) -> Player:
        for p in self.seats:
            if p.seat_id == seat_id:
                return p
        raise KeyError(seat_id)

    def final_stacks(self) -> dict[str, int]:
        """Stacks once the hand is complete (before that, what each player has behind)."""
        return {p.seat_id: p.stack for p in self.seats}

    def legal(self) -> Legal | None:
        if not self._pending or self.street == "complete":
            return None
        i = self._pending[0]
        p = self.seats[i]
        to_call = self._current_bet - p.bet
        top = p.bet + p.stack
        can_raise = i not in self._locked and top > self._current_bet
        low = min(self._current_bet + self._min_raise, top)
        return Legal(p.seat_id, to_call == 0, min(to_call, p.stack), can_raise, low if can_raise else 0, top if can_raise else 0)

    def view(self, seat_id: str | None = None) -> dict:
        """What one seat may know: the board, every stack and bet, and its own hole cards but nobody else's. `None` is a spectator who sees no hole cards."""
        legal = self.legal()
        return {
            "street": self.street,
            "board": list(self.board),
            "pot": self.pot,
            "button": self.seats[self.button].seat_id,
            "to_act": self.to_act,
            "hole": list(self.player(seat_id).hole) if seat_id is not None else [],
            "players": [{"seat_id": p.seat_id, "stack": p.stack, "bet": p.bet, "folded": p.folded, "all_in": p.all_in} for p in self.seats],
            "current_bet": self._current_bet,
            "legal": None if legal is None or legal.seat_id != seat_id else {"kinds": legal.kinds(), "call_amount": legal.call_amount, "min_raise_to": legal.min_raise_to, "max_raise_to": legal.max_raise_to},
        }

    # --- acting

    def act(self, seat_id: str, kind: str, amount: int | None = None) -> None:
        """`kind` is `fold`, `check`, `call` or `raise`. A raise needs `amount`, the total this seat will have bet on the street ("raise to"); a bet into an
        empty street is also a `raise`. Raises `IllegalAction`, leaving the hand as it was, if the action is not allowed."""
        legal = self.legal()
        if legal is None:
            raise IllegalAction("the hand is over")
        if legal.seat_id != seat_id:
            raise IllegalAction(f"it is {legal.seat_id}'s turn, not {seat_id}'s")
        i = self._pending[0]
        p = self.seats[i]
        if kind == "fold":
            p.folded = True
            self._pending.pop(0)
            self._log("fold", p)
        elif kind == "check":
            if not legal.can_check:
                raise IllegalAction("cannot check: there is a bet to call")
            self._pending.pop(0)
            self._log("check", p)
        elif kind == "call":
            if legal.can_check:
                raise IllegalAction("nothing to call: check instead")
            self._pay(p, legal.call_amount)
            self._pending.pop(0)
            self._log("call", p, amount=legal.call_amount)
        elif kind == "raise":
            self._raise(i, p, legal, amount)
        else:
            raise IllegalAction(f"unknown action {kind!r}")
        self._settle()

    # --- internals

    def _order_after(self, i: int) -> list[int]:
        n = len(self.seats)
        return [(i + k) % n for k in range(1, n + 1)]

    def _log(self, kind: str, p: Player, **extra: object) -> None:
        self.events.append({"type": kind, "seat_id": p.seat_id, "street": self.street, **extra})

    def _pay(self, p: Player, n: int) -> None:
        p.stack -= n
        p.bet += n
        p.committed += n
        if p.stack == 0:
            p.all_in = True

    def _burn_and_deal(self, n: int) -> None:
        self._deck.pop(0)
        self.board += [self._deck.pop(0) for _ in range(n)]

    def _deal_hole_cards(self) -> None:
        order = self._order_after(self.button)
        got: dict[int, list[str]] = {i: [] for i in order}
        for _ in range(2):
            for i in order:
                got[i].append(self._deck.pop(0))
        for i, cards in got.items():
            self.seats[i].hole = tuple(cards)

    def _post_blinds(self) -> None:
        n = len(self.seats)
        if n == 2:  # heads up: the button is the small blind and acts first before the flop
            small, big = self.button, (self.button + 1) % n
        else:
            small, big = (self.button + 1) % n, (self.button + 2) % n
        for i, blind in ((small, self.small_blind), (big, self.big_blind)):
            p = self.seats[i]
            paid = min(blind, p.stack)
            self._pay(p, paid)
            self._log("blind", p, amount=paid)
        self._current_bet = max(p.bet for p in self.seats)
        first = self._order_after(big)[0]
        order = [first] + [j for j in self._order_after(first) if j != first]
        self._pending = [j for j in order if self.seats[j].active]

    def _raise(self, i: int, p: Player, legal: Legal, amount: int | None) -> None:
        if not legal.can_raise:
            raise IllegalAction("cannot raise here")
        if not isinstance(amount, int) or isinstance(amount, bool):
            raise IllegalAction("a raise needs a whole-number amount (the total to raise to)")
        if not legal.min_raise_to <= amount <= legal.max_raise_to:
            raise IllegalAction(f"raise to between {legal.min_raise_to} and {legal.max_raise_to}, not {amount}")
        was_pending = set(self._pending[1:])
        size = amount - self._current_bet
        self._pay(p, amount - p.bet)
        self._current_bet = amount
        self._pending.pop(0)
        if size >= self._min_raise:  # a full raise: everyone still in gets to act again, and may re-raise
            self._min_raise = size
            self._locked.clear()
            self._pending = [j for j in self._order_after(i) if j != i and self.seats[j].active]
        else:  # a short all-in: players who already acted may only call or fold
            self._pending = [j for j in self._order_after(i) if j != i and self.seats[j].active and (j in was_pending or self.seats[j].bet < self._current_bet)]
            self._locked |= {j for j in self._pending if j not in was_pending}
        self._log("raise", p, amount=amount, all_in=p.all_in)

    def _settle(self) -> None:
        """After every change: end the hand if one player is left, close the street when the betting is done, and keep going until someone must act."""
        while self.street != "complete":
            live = [p for p in self.seats if not p.folded]
            if len(live) == 1:
                self._award_uncontested(live[0])
                return
            active = [p for p in self.seats if p.active]
            if len(active) <= 1 and all(p.bet >= self._current_bet for p in active):
                self._pending = []  # nobody left to bet against: just run the board out
            if self._pending:
                return
            self._next_street()

    def _next_street(self) -> None:
        for p in self.seats:
            p.bet = 0
        self._current_bet = 0
        self._min_raise = self.big_blind
        self._locked.clear()
        if self.street == "river":
            self._showdown()
            return
        self.street = {"preflop": "flop", "flop": "turn", "turn": "river"}[self.street]
        self._burn_and_deal(3 if self.street == "flop" else 1)
        self.events.append({"type": "deal", "street": self.street, "board": list(self.board)})
        active = [j for j in self._order_after(self.button) if self.seats[j].active]
        self._pending = active if len(active) >= 2 else []

    def _award_uncontested(self, winner: Player) -> None:
        total = self.pot
        winner.stack += total
        self.winnings = {winner.seat_id: total}
        self.pots = [{"amount": total, "eligible": [winner.seat_id], "winners": [winner.seat_id]}]
        self.events.append({"type": "win", "seat_id": winner.seat_id, "amount": total, "showdown": False})
        self._finish()

    def _showdown(self) -> None:
        self.showdown = True
        scores = {p.seat_id: best_score(list(p.hole) + self.board) for p in self.seats if not p.folded}
        self.events.append({"type": "showdown", "hands": {s: {"hole": list(self.player(s).hole), "rank": describe(sc)} for s, sc in scores.items()}})
        levels = sorted({p.committed for p in self.seats if p.committed > 0})
        previous = 0
        for level in levels:
            amount = sum(min(p.committed, level) - min(p.committed, previous) for p in self.seats)
            eligible = [p.seat_id for p in self.seats if not p.folded and p.committed >= level]
            previous = level
            if not eligible:  # only folded players paid this slice (cannot normally happen): add it to the pot below
                self.pots[-1]["amount"] += amount
                continue
            self.pots.append({"amount": amount, "eligible": eligible, "winners": []})
        for pot in self.pots:
            best = max(scores[s] for s in pot["eligible"])
            pot["winners"] = [s for s in pot["eligible"] if scores[s] == best]
        # An odd chip goes to the first winner left of the button.
        left_of_button = [self.seats[j].seat_id for j in self._order_after(self.button)]
        for pot in self.pots:
            winners = sorted(pot["winners"], key=left_of_button.index)
            share, odd = divmod(pot["amount"], len(winners))
            for k, s in enumerate(winners):
                got = share + (1 if k < odd else 0)
                self.winnings[s] = self.winnings.get(s, 0) + got
                self.player(s).stack += got
        for s, amount in self.winnings.items():
            self.events.append({"type": "win", "seat_id": s, "amount": amount, "showdown": True})
        self._finish()

    def _finish(self) -> None:
        for p in self.seats:
            p.bet = 0
        self.street = "complete"
        self._pending = []
