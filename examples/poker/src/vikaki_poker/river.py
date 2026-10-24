"""A heads-up river solver (VIK-123): the equilibrium of the last betting round between two ranges, by CFR+ in vector form.

Two players, out of position (OOP, who acts first) and in position (IP), each with a range of weighted holdings. They play one betting round on a known
five-card board: the first to act may check or bet a size from a short list (fractions of the pot); the other may fold, call, or, when chips are left,
raise all-in; and so on. There is no raise but all-in, which keeps the tree to a few dozen nodes and is what a river solver for a table like this needs.

Vector form means one walk of the tree handles every holding at once: each node holds, for each action, a regret and a strategy for every holding, and a
walk carries the two players' reach probabilities as vectors. A showdown is priced by sorting the holdings by strength and taking prefix sums, with the
holdings that share a card with the one being priced taken out (card removal), which makes it cost a few n log n, not n squared.

Chips are counted from the start of the river with the pot already in the middle split evenly, so the winner of a showdown nets half the pot plus what the
loser put in this street, and a player who folds loses what they put in this street and the half of the pot they had in it.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field

from .evaluate import best_score
from .ranges import Combo

WeightedRange = list[tuple[Combo, float]]


@dataclass
class Node:
    """A point in the betting. An action node has `player` (0 OOP, 1 IP), its `actions` and `children`; a terminal says how it ends."""

    player: int = -1
    actions: list[str] = field(default_factory=list)
    children: list["Node"] = field(default_factory=list)
    # terminal
    ends: str = ""  # "" for an action node, "fold" or "showdown"
    folder: int = -1
    put: tuple[int, int] = (0, 0)  # what each player has put in this street
    # solving state, per action then per holding of `player`
    regret: list[list[float]] = field(default_factory=list)
    strategy_sum: list[list[float]] = field(default_factory=list)


def build_tree(pot: int, stack: int, sizes: tuple[float, ...] = (0.5, 1.0), *, bets_after_check: bool = True, allow_raise: bool = True) -> Node:
    """The betting tree: `stack` is what each player still has behind, `sizes` the bets as fractions of the pot, always including the chance to shove when a size reaches the stack.
    `bets_after_check` lets IP bet after OOP checks; `allow_raise` lets the player facing a bet shove over it."""

    def bet_totals(base_pot: int, to_call: int, behind: int) -> list[int]:
        """The sizes (chips put in on top of calling) a player may bet or raise by, each at most `behind`, the biggest an all-in if it reaches it."""
        out = []
        for f in sizes:
            chips = max(1, int(round(f * (base_pot + to_call))))
            out.append(min(chips, behind))
        return sorted({c for c in out if c > 0})

    def act(player: int, put: tuple[int, int], opened: bool, raised: bool, checked_to: bool) -> Node:  # noqa: ARG001 (`opened` is kept for readability of the calls)
        me, opp = put[player], put[1 - player]
        to_call = opp - me
        behind = stack - me
        node = Node(player=player)
        total_pot = pot + put[0] + put[1]
        if to_call == 0:
            # may check or bet: a check by OOP gives IP the choice, a check by IP ends the round
            node.actions.append("check")
            node.children.append(act(1, put, False, False, True) if player == 0 else Node(ends="showdown", put=put))
            if player == 0 or bets_after_check:
                for chips in bet_totals(total_pot, 0, behind):
                    new = list(put)
                    new[player] += chips
                    node.actions.append("all-in" if chips >= behind else f"bet {chips}")
                    node.children.append(act(1 - player, (new[0], new[1]), True, False, False))
            return node
        # facing a bet
        node.actions.append("fold")
        node.children.append(Node(ends="fold", folder=player, put=put))
        call = list(put)
        call[player] += min(to_call, behind)
        node.actions.append("call")
        node.children.append(Node(ends="showdown", put=(call[0], call[1])))
        if allow_raise and not raised and behind > to_call and (stack - opp) > 0:
            shove = list(put)
            shove[player] = stack
            node.actions.append("all-in")
            node.children.append(act(1 - player, (shove[0], shove[1]), True, True, False))
        return node

    return act(0, (0, 0), False, False, False)


class _Showdown:
    """Prices showdowns between two ranges on a board: strengths, and which holdings share a card."""

    def __init__(self, board: list[str], ranges: tuple[WeightedRange, WeightedRange]) -> None:
        self.ranges = ranges
        self.strength: list[list[int]] = []
        table: dict[tuple, int] = {}
        scores = [[best_score(list(c) + board) for c, _ in r] for r in ranges]
        for i, kind in enumerate(sorted({s for r in scores for s in r})):
            table[kind] = i
        for r in scores:
            self.strength.append([table[s] for s in r])
        self.order = [sorted(range(len(r)), key=lambda k, st=self.strength[p]: st[k]) for p, r in enumerate(ranges)]
        self.sorted_strength = [[self.strength[p][k] for k in self.order[p]] for p in (0, 1)]
        self.same: list[dict[int, int]] = []  # for each side, holding -> the index of the identical holding on the other side
        index = [{c: k for k, (c, _) in enumerate(r)} for r in ranges]
        self.same = [{k: index[1 - p][c] for k, (c, _) in enumerate(ranges[p]) if c in index[1 - p]} for p in (0, 1)]

    def values(self, p: int, reach: list[float]) -> tuple[list[float], list[float], list[float]]:
        """For each holding of player `p`: the weight of the other side's compatible holdings it beats, ties with, and loses to, given `reach` (the other side's reach per holding)."""
        o = 1 - p
        mine, theirs = self.ranges[p], self.ranges[o]
        order = self.order[o]
        n = len(order)
        sorted_reach = [reach[k] for k in order]
        prefix = [0.0] * (n + 1)
        for k, r in enumerate(sorted_reach):
            prefix[k + 1] = prefix[k] + r
        # per card: positions in sorted order of the other side's holdings that contain it, and the running sum of their reach
        by_card: dict[str, tuple[list[int], list[float]]] = {}
        for pos, k in enumerate(order):
            for card in theirs[k][0]:
                positions, sums = by_card.setdefault(card, ([], [0.0]))
                positions.append(pos)
                sums.append(sums[-1] + sorted_reach[pos])
        sorted_strength = self.sorted_strength[o]
        win, tie, lose = [], [], []
        for i, (combo, _) in enumerate(mine):
            s = self.strength[p][i]
            lo, hi = bisect_left(sorted_strength, s), bisect_right(sorted_strength, s)
            weaker, equal, stronger = prefix[lo], prefix[hi] - prefix[lo], prefix[n] - prefix[hi]
            for card in combo:
                entry = by_card.get(card)
                if entry is None:
                    continue
                positions, sums = entry
                a, b = bisect_left(positions, lo), bisect_left(positions, hi)
                weaker -= sums[a]
                equal -= sums[b] - sums[a]
                stronger -= sums[len(positions)] - sums[b]
            j = self.same[p].get(i)
            if j is not None:  # the other side's identical holding has both cards, so it was taken out twice: put one back
                equal += reach[j]
            win.append(weaker)
            tie.append(equal)
            lose.append(stronger)
        return win, tie, lose

    def blocked_total(self, p: int, reach: list[float]) -> list[float]:
        """For each holding of `p`: the total reach of the other side's holdings that share no card with it."""
        w, t, l = self.values(p, reach)
        return [a + b + c for a, b, c in zip(w, t, l)]


@dataclass
class RiverSolution:
    root: Node
    board: list[str]
    ranges: tuple[WeightedRange, WeightedRange]
    pot: int
    iterations: int
    _showdown: _Showdown

    def strategy(self, history: tuple[str, ...], combo: Combo, player: int | None = None) -> dict[str, float]:
        """The average strategy for `combo` at the node reached by `history` (the actions taken so far, by name): each action's probability."""
        node = self.root
        for a in history:
            node = node.children[node.actions.index(a)]
        if node.ends:
            raise ValueError("the hand is over at that point")
        p = node.player if player is None else player
        k = next(i for i, (c, _) in enumerate(self.ranges[p]) if c == combo)
        totals = [s[k] for s in node.strategy_sum]
        z = sum(totals)
        if z <= 0:
            return {a: 1 / len(node.actions) for a in node.actions}
        return {a: t / z for a, t in zip(node.actions, totals)}

    def actions_at(self, history: tuple[str, ...]) -> tuple[int, list[str]]:
        node = self.root
        for a in history:
            node = node.children[node.actions.index(a)]
        return node.player, list(node.actions)

    def exploitability(self) -> float:
        """How much, in chips per deal, the two players together could gain by each playing a best response to the other's average strategy: 0 is an equilibrium."""
        return _exploitability(self)


def _payoff_fold(node: Node, pot: int) -> tuple[float, float]:
    f = node.folder
    lost = pot / 2 + node.put[f]
    return (-lost, lost) if f == 0 else (lost, -lost)


def solve_river(board: list[str], oop: WeightedRange, ip: WeightedRange, pot: int, stack: int, *, sizes: tuple[float, ...] = (0.5, 1.0), iterations: int = 200, bets_after_check: bool = True, allow_raise: bool = True) -> RiverSolution:
    """Solve the river between `oop` and `ip` (lists of `(combo, weight)`; a combo that uses a card of the board is dropped). `pot` is the pot, `stack` what each has behind."""
    board = list(board)
    ranges = tuple([(c, w) for c, w in r if w > 0 and not set(c) & set(board)] for r in (oop, ip))
    if not ranges[0] or not ranges[1]:
        raise ValueError("both players need at least one holding")
    root = build_tree(pot, stack, sizes, bets_after_check=bets_after_check, allow_raise=allow_raise)
    sd = _Showdown(board, (ranges[0], ranges[1]))  # type: ignore[arg-type]
    n = (len(ranges[0]), len(ranges[1]))

    def init(node: Node) -> None:
        if node.ends:
            return
        p = node.player
        node.regret = [[0.0] * n[p] for _ in node.actions]
        node.strategy_sum = [[0.0] * n[p] for _ in node.actions]
        for c in node.children:
            init(c)

    init(root)
    prior = [[w for _, w in ranges[0]], [w for _, w in ranges[1]]]

    def strategy_of(node: Node) -> list[list[float]]:
        """Regret matching at every holding: one list per action."""
        k = len(node.actions)
        size = n[node.player]
        out = [[0.0] * size for _ in range(k)]
        for h in range(size):
            total = 0.0
            for a in range(k):
                r = node.regret[a][h]
                if r > 0:
                    total += r
            if total > 0:
                for a in range(k):
                    r = node.regret[a][h]
                    out[a][h] = r / total if r > 0 else 0.0
            else:
                for a in range(k):
                    out[a][h] = 1.0 / k
        return out

    def walk(node: Node, trav: int, reach: tuple[list[float], list[float]], t: int) -> list[float]:
        """Counterfactual values of the traverser's holdings at `node`, given both players' reach vectors."""
        if node.ends == "fold":
            v0, v1 = _payoff_fold(node, pot)
            gain = v0 if trav == 0 else v1
            total = sd.blocked_total(trav, reach[1 - trav])
            return [gain * x for x in total]
        if node.ends == "showdown":
            win_amount = pot / 2 + node.put[1 - trav]
            lose_amount = pot / 2 + node.put[trav]
            w, _, l = sd.values(trav, reach[1 - trav])
            return [win_amount * a - lose_amount * b for a, b in zip(w, l)]
        sigma = strategy_of(node)
        p = node.player
        if p == trav:
            values = []
            for a, child in enumerate(node.children):
                r = list(reach[trav])
                r = [x * s for x, s in zip(r, sigma[a])]
                nxt = (r, reach[1]) if trav == 0 else (reach[0], r)
                values.append(walk(child, trav, nxt, t))
            size = n[trav]
            ev = [sum(sigma[a][h] * values[a][h] for a in range(len(values))) for h in range(size)]
            for a in range(len(values)):
                reg, ss = node.regret[a], node.strategy_sum[a]
                for h in range(size):
                    reg[h] = max(0.0, reg[h] + values[a][h] - ev[h])  # CFR+
                    ss[h] += t * reach[trav][h] * sigma[a][h]  # linear averaging
            return ev
        total = [0.0] * n[trav]
        for a, child in enumerate(node.children):
            r = [x * s for x, s in zip(reach[p], sigma[a])]
            nxt = (r, reach[1]) if p == 0 else (reach[0], r)
            vals = walk(child, trav, nxt, t)
            total = [x + y for x, y in zip(total, vals)]
        return total

    for t in range(1, iterations + 1):
        for trav in (0, 1):
            walk(root, trav, (prior[0], prior[1]), t)
    return RiverSolution(root, board, (ranges[0], ranges[1]), pot, iterations, sd)


def _exploitability(sol: RiverSolution) -> float:
    sd = sol._showdown
    pot = sol.pot
    n = (len(sol.ranges[0]), len(sol.ranges[1]))
    prior = [[w for _, w in sol.ranges[0]], [w for _, w in sol.ranges[1]]]

    def avg(node: Node) -> list[list[float]]:
        size = n[node.player]
        out = [[0.0] * size for _ in node.actions]
        for h in range(size):
            z = sum(s[h] for s in node.strategy_sum)
            for a in range(len(node.actions)):
                out[a][h] = node.strategy_sum[a][h] / z if z > 0 else 1.0 / len(node.actions)
        return out

    def best(node: Node, br: int, opp_reach: list[float]) -> list[float]:
        """The best response's value per holding of `br`, against the other side's average strategy; `opp_reach` is the other side's reach per holding."""
        if node.ends == "fold":
            v0, v1 = _payoff_fold(node, pot)
            gain = v0 if br == 0 else v1
            return [gain * x for x in sd.blocked_total(br, opp_reach)]
        if node.ends == "showdown":
            w, _, l = sd.values(br, opp_reach)
            return [(pot / 2 + node.put[1 - br]) * a - (pot / 2 + node.put[br]) * b for a, b in zip(w, l)]
        if node.player == br:
            vals = [best(c, br, opp_reach) for c in node.children]
            return [max(v[h] for v in vals) for h in range(n[br])]
        sigma = avg(node)
        total = [0.0] * n[br]
        for a, c in enumerate(node.children):
            r = [x * s for x, s in zip(opp_reach, sigma[a])]
            total = [x + y for x, y in zip(total, best(c, br, r))]
        return total

    total = 0.0
    for br in (0, 1):
        vals = best(sol.root, br, prior[1 - br])
        total += sum(prior[br][h] * vals[h] for h in range(n[br]))
    z = sum(prior[0][h] * zz for h, zz in enumerate(sd.blocked_total(0, prior[1])))
    return total / z if z else 0.0
