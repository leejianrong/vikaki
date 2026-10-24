import pytest

from vikaki_poker.cfr import InfoSet, Kuhn, Solver, regret_matching


def test_regret_matching_plays_in_proportion_to_positive_regret_and_evenly_with_none():
    assert regret_matching([3.0, 1.0, -5.0]) == [0.75, 0.25, 0.0]
    assert regret_matching([-1.0, -2.0]) == [0.5, 0.5]
    assert regret_matching([0.0, 0.0, 0.0]) == pytest.approx([1 / 3] * 3)


def test_an_info_set_averages_its_strategies_weighted_and_starts_even():
    s = InfoSet(2)
    assert s.average() == [0.5, 0.5]
    s.strategy_sum = [1.0, 3.0]
    assert s.average() == [0.25, 0.75]


def test_cfr_plus_finds_kuhn_pokers_value_and_an_equilibrium():
    solver = Solver(Kuhn())
    solver.solve(4000)
    avg = lambda who, card, hist: solver.average(who, (card, hist))  # noqa: E731
    value = sum(
        (1 / 6) * _play(solver, a, b)
        for a in "JQK"
        for b in "JQK"
        if a != b
    )
    assert value == pytest.approx(-1 / 18, abs=0.01)
    assert solver.exploitability() < 0.02
    # The equilibria of Kuhn poker are a known family: with alpha the first player's chance to bet a J, he bets a K 3 alpha of the time, calls a Q with 1/3 + alpha
    # after pass-bet, never calls a J; the second player bluffs a J a third of the time after a pass, calls a Q a third of the time, and always calls a K.
    alpha = avg(0, "J", "")[1]
    assert 0 <= alpha <= 1 / 3 + 0.02
    assert avg(0, "K", "")[1] == pytest.approx(3 * alpha, abs=0.06)
    assert avg(0, "Q", "pb")[1] == pytest.approx(1 / 3 + alpha, abs=0.06)
    assert avg(0, "J", "pb")[1] < 0.02 and avg(0, "K", "pb")[1] > 0.98
    assert avg(1, "J", "p")[1] == pytest.approx(1 / 3, abs=0.05)
    assert avg(1, "Q", "b")[1] == pytest.approx(1 / 3, abs=0.05)
    assert avg(1, "K", "b")[1] > 0.98 and avg(1, "J", "b")[1] < 0.02


def _play(solver: Solver, a: str, b: str) -> float:
    """The first player's expected payoff with the average strategies for the deal (a, b)."""
    g = solver.game

    def walk(state) -> float:
        t = g.terminal(state)
        if t is not None:
            return t
        acts = g.actions(state)
        sigma = solver.average(g.player(state), g.info(state))
        return sum(s * walk(g.play(state, x)) for s, x in zip(sigma, acts))

    return walk((a, b, ""))


def test_the_average_strategy_improves_with_iterations():
    few, many = Solver(Kuhn()), Solver(Kuhn())
    few.solve(20)
    many.solve(2000)
    assert many.exploitability() < few.exploitability()
