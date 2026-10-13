import pytest

from vikaki_poker import best_score, describe, full_deck, shuffled_deck
from vikaki_poker.evaluate import score_five


def cards(text: str) -> list[str]:
    return text.split()


def test_categories_rank_in_order():
    hands = [
        "2h 5d 7c 9s Kd",  # high card
        "2h 2d 7c 9s Kd",  # pair
        "2h 2d 7c 7s Kd",  # two pair
        "2h 2d 2c 9s Kd",  # three of a kind
        "5h 6d 7c 8s 9d",  # straight
        "2h 5h 7h 9h Kh",  # flush
        "2h 2d 2c 9s 9d",  # full house
        "2h 2d 2c 2s Kd",  # four of a kind
        "5h 6h 7h 8h 9h",  # straight flush
    ]
    scores = [score_five(tuple(cards(h))) for h in hands]
    assert scores == sorted(scores)
    assert [describe(s) for s in scores] == ["high card", "pair", "two pair", "three of a kind", "straight", "flush", "full house", "four of a kind", "straight flush"]


def test_the_wheel_is_the_lowest_straight_and_the_ace_also_plays_high():
    wheel = score_five(tuple(cards("Ah 2d 3c 4s 5d")))
    six_high = score_five(tuple(cards("2h 3d 4c 5s 6d")))
    broadway = score_five(tuple(cards("Th Jd Qc Ks Ad")))
    assert describe(wheel) == "straight" and wheel < six_high < broadway


def test_kickers_decide_between_equal_pairs():
    assert score_five(tuple(cards("Ah Ad 9c 5s 2d"))) > score_five(tuple(cards("Ah Ad 8c 7s 6d")))
    assert score_five(tuple(cards("Ah Ad Kc 5s 2d"))) < score_five(tuple(cards("Ah Ad Kc 5s 3d")))


def test_full_house_compares_the_triple_first():
    assert score_five(tuple(cards("9h 9d 9c 4s 4d"))) > score_five(tuple(cards("8h 8d 8c Ks Kd")))


def test_best_of_seven_picks_the_best_five():
    # The board is a straight; the hole cards add a flush draw that does not complete, and a better straight needs a card that is not there.
    assert describe(best_score(cards("2h 3h 5c 6d 7s 8c 9d"))) == "straight"
    # A flush hiding among seven, with a pair elsewhere: the flush wins.
    assert describe(best_score(cards("2h 9h Kh 5h 7h 7d 7c"))) == "flush"


def test_the_board_can_play_and_equal_hands_score_equal():
    board = cards("Ah Kh Qh Jh Th")
    assert best_score(board + cards("2c 3d")) == best_score(board + cards("4c 5d"))


def test_wrong_number_of_cards_is_an_error():
    with pytest.raises(ValueError):
        best_score(cards("2h 3h 4h 5h"))


def test_decks():
    deck = full_deck()
    assert len(deck) == 52 and len(set(deck)) == 52
    assert shuffled_deck(7) == shuffled_deck(7)
    assert shuffled_deck(7) != shuffled_deck(8)
    assert sorted(shuffled_deck(7)) == sorted(deck)
