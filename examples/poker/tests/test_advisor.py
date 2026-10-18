from vikaki_poker.advisor import AdvisorBot, CallingStation, RandomBot, simulate
from vikaki_poker.brain import turn_facts
from vikaki_poker import Hand


def test_the_bot_plays_the_rule_of_thumb_with_a_legal_move():
    h = Hand([("a", 200), ("b", 200), ("c", 200)], 0, 1, 2, seed=4)
    bot = AdvisorBot("a")
    for _ in range(20):
        if h.complete:
            break
        view = h.view(h.to_act)
        d = bot.decide(view)
        assert d.action == turn_facts(view, samples=300)["advice"] and d.action in view["legal"]["kinds"]
        h.act(h.to_act, d.action, d.amount)


def test_chips_are_conserved_by_a_simulation():
    net = simulate({"a": AdvisorBot("a"), "b": CallingStation("b"), "c": RandomBot("c", seed=3)}, hands=12, seed=1)
    assert sum(net.values()) == 0 and set(net) == {"a", "b", "c"}


def test_a_simulation_is_repeatable():
    def run():
        return simulate({"a": AdvisorBot("a"), "b": CallingStation("b")}, hands=10, seed=2)

    assert run() == run()


def test_the_weak_bots_do_what_they_say():
    h = Hand([("a", 200), ("b", 200)], 0, 1, 2, seed=1)
    view = h.view(h.to_act)
    assert CallingStation("x").decide(view).action in ("check", "call")
    r = RandomBot("r", seed=5)
    seen = {r.decide(view).action for _ in range(60)}
    assert seen <= set(view["legal"]["kinds"]) and len(seen) >= 2


def test_the_engine_bot_plays_whole_hands_legally_and_conserves_chips():
    from vikaki_poker.advisor import EngineBot

    net = simulate({"a": EngineBot("a", samples=40, seed=1), "b": AdvisorBot("b", samples=40), "c": CallingStation("c")}, hands=6, seed=3)
    assert sum(net.values()) == 0 and set(net) == {"a", "b", "c"}
