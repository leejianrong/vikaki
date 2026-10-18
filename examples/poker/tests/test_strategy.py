import random

import pytest
from test_hand import rig

from vikaki_poker import Hand
from vikaki_poker.strategy import decide

IDS = ["a", "b", "c"]


def spot(actor_holds: str, board: str = "", stacks=(200, 200, 200), button=0) -> Hand:
    """A hand where whoever acts first holds `actor_holds` (and the others hold what is left over, which the engine never sees)."""
    probe = Hand(list(zip(IDS, stacks)), button, 1, 2, seed=1)
    actor = probe.to_act
    return Hand(list(zip(IDS, stacks)), button, 1, 2, deck=rig(IDS, button, {actor: actor_holds}, board or "2c 3d 4h 5s 6c"))


def move(h: Hand, seed=1, samples=300):
    return decide(h.view(h.to_act), h.events, big_blind=h.big_blind, rng=random.Random(seed), samples=samples)


def to_flop(h: Hand) -> None:
    """Everyone limps or checks to the flop (the hand must be staged)."""
    while h.awaiting != "street":
        h.act(h.to_act, "check" if h.legal().can_check else "call")
    h.advance()


def staged(actor_holds: str, board: str, stacks=(200, 200, 200)) -> Hand:
    probe = Hand(list(zip(IDS, stacks)), 0, 1, 2, seed=1)
    actor = probe.to_act
    return Hand(list(zip(IDS, stacks)), 0, 1, 2, deck=rig(IDS, 0, {actor: actor_holds}, board), staged=True)


def test_aces_raise_before_the_flop_to_a_sensible_size_and_seven_deuce_folds():
    m = move(spot("As Ah"))
    assert m.kind == "raise" and 4 <= m.amount <= 12
    assert move(spot("7c 2d")).kind == "fold"


def test_a_marginal_hand_folds_to_a_big_re_raise_but_aces_do_not():
    h = spot("Qc Jd")
    first = h.to_act
    # the actor opens; the next seat re-raises big; the actor must now decide (heads-up with the rest folded)
    h.act(first, "raise", 6)
    second = h.to_act
    h.act(second, "raise", 60)
    third = h.to_act
    h.act(third, "fold")
    assert h.to_act == first
    assert move(h).kind == "fold"
    h2 = spot("As Ah")
    h2.act(first, "raise", 6)
    h2.act(h2.to_act, "raise", 60)
    h2.act(h2.to_act, "fold")
    assert move(h2).kind in ("call", "raise")


def test_a_monster_bets_a_real_size_when_checked_to():
    flop = "Kc Kd 8s 2h 9d"
    sets = staged("Ks Kh", flop)
    to_flop(sets)
    plays = [move(sets, seed=s, samples=120) for s in range(20)]
    bets = [m for m in plays if m.kind == "raise"]
    assert len(bets) >= 14  # mostly it bets (a little slow-play is allowed)
    assert all(m.amount >= 0.45 * sets.pot for m in bets)  # never a token bet


def heads_up_river(hero_holds: str, villain_bet_pot: bool = True) -> Hand:
    """Two players on the river; the player acting second (the button, a) holds `hero_holds` and faces a pot-sized bet."""
    ids = ["a", "b"]
    h = Hand([("a", 200), ("b", 200)], 0, 1, 2, deck=rig(ids, 0, {"a": hero_holds}, "Ah Kd 8s 2h 9d"), staged=True)
    while h.street != "river":
        if h.awaiting == "street":
            h.advance()
        else:
            h.act(h.to_act, "check" if h.legal().can_check else "call")
    assert h.to_act == "b"
    h.act("b", "raise", h.pot)
    assert h.to_act == "a"
    return h


def test_air_folds_to_a_pot_sized_bet_on_the_river_and_the_nuts_play_on():
    air = [move(heads_up_river("7c 3h"), seed=s, samples=200).kind for s in range(10)]
    assert air.count("fold") >= 9
    nuts = [move(heads_up_river("Ac Ad"), seed=s, samples=200).kind for s in range(10)]  # three aces
    assert all(k in ("call", "raise") for k in nuts)


@pytest.mark.parametrize("seed", range(10))
def test_every_move_is_legal_and_a_raise_is_within_the_limits(seed):
    h = Hand([("a", 90), ("b", 40), ("c", 200)], seed % 3, 1, 2, seed=seed)
    while not h.complete:
        leg = h.legal()
        m = move(h, seed=seed, samples=40)
        assert m.kind in leg.kinds()
        if m.kind == "raise":
            assert leg.min_raise_to <= m.amount <= leg.max_raise_to
        h.act(h.to_act, m.kind, m.amount)


def test_the_same_spot_with_the_same_dice_gives_the_same_move_and_it_explains_itself():
    a, b = move(spot("As Kh"), seed=5), move(spot("As Kh"), seed=5)
    assert (a.kind, a.amount) == (b.kind, b.amount)
    assert "to win" in a.reason and a.ev and 0 < a.equity < 1
