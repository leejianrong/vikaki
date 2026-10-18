"""How each seat actually played, counted from the hands (VIK-86): whether the personalities show. The usual poker numbers, small and honest.

- hands: dealt in.
- vpip: the share of hands in which the seat put chips in by choice before the flop (a call or a raise; the blinds do not count).
- pfr: the share in which it raised before the flop.
- agg: raises for every call over the whole hand (more than 1 is aggressive, under 1 passive); "-" with no calls.
- folds: the share of hands it folded.
- talk: lines said per move, and the average words in a line.
"""

from __future__ import annotations

from dataclasses import dataclass

from .runner import HandResult


@dataclass
class SeatStyle:
    seat_id: str
    hands: int = 0
    vpip: float = 0.0
    pfr: float = 0.0
    agg: float | None = None
    folds: float = 0.0
    lines_per_move: float = 0.0
    words_per_line: float = 0.0


def style_stats(results: list[HandResult], seat_ids: list[str]) -> list[SeatStyle]:
    out: list[SeatStyle] = []
    for seat in seat_ids:
        hands = vpip = pfr = folded = raises = calls = moves = lines = words = 0
        for r in results:
            if not any(p.seat_id == seat for p in r.hand.seats):
                continue
            hands += 1
            mine = [e for e in r.hand.events if e.get("seat_id") == seat and e["type"] in ("fold", "check", "call", "raise")]
            pre = [e for e in mine if e["street"] == "preflop"]
            vpip += any(e["type"] in ("call", "raise") for e in pre)
            pfr += any(e["type"] == "raise" for e in pre)
            folded += any(e["type"] == "fold" for e in mine)
            raises += sum(e["type"] == "raise" for e in mine)
            calls += sum(e["type"] == "call" for e in mine)
            moves += len(mine)
            said = [text for who, text in r.said if who == seat]
            lines += len(said)
            words += sum(len(t.split()) for t in said)
        out.append(
            SeatStyle(
                seat,
                hands,
                vpip / hands if hands else 0.0,
                pfr / hands if hands else 0.0,
                raises / calls if calls else None,
                folded / hands if hands else 0.0,
                lines / moves if moves else 0.0,
                words / lines if lines else 0.0,
            )
        )
    return out


def style_lines(styles: list[SeatStyle], names: dict[str, str] | None = None) -> list[str]:
    """A small table for the end of a session."""
    names = names or {}
    rows = ["  style:     hands  vpip  pfr   agg  folds   talk"]
    for s in styles:
        agg = "  - " if s.agg is None else f"{s.agg:4.1f}"
        rows.append(f"  {names.get(s.seat_id, s.seat_id):<9}{s.hands:5d}  {s.vpip:4.0%}  {s.pfr:3.0%}  {agg}  {s.folds:4.0%}   {s.lines_per_move:.1f} lines/move, {s.words_per_line:.0f} words")
    return rows
