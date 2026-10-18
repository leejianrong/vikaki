"""The example table's own config: who sits where, which model plays each seat, and the blinds.

Kept apart from the hub's personas file, which rejects fields it does not know. A persona's `style` is read from that file so a character is
described in one place.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

import yaml

from .brain import Traits
from .llm import Llm
from .reactions import LlmReactor, MirrorReactor, Reactor
from .seat import SeatAgent


class TableError(ValueError):
    pass


@dataclass
class TableSeat:
    seat_id: str
    persona: str
    model: str
    style: str = ""
    traits: Traits = field(default_factory=Traits)


@dataclass
class Table:
    seats: list[TableSeat]
    stack: int = 200
    small_blind: int = 1
    big_blind: int = 2
    max_tokens: int = 200
    reaction_model: str | None = None  # a cheap model for listeners' silent reactions; without one they follow a fixed table (MirrorReactor)
    problems: list[str] = field(default_factory=list)

    def personas(self) -> dict[str, str]:
        """seat id to persona name, which is what a hub connection binds."""
        return {s.seat_id: s.persona for s in self.seats}


def _load(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except OSError as err:
        raise TableError(f"cannot read {path}: {err.strerror}") from None
    except yaml.YAMLError as err:
        raise TableError(f"{path} is not valid YAML: {err}") from None
    if not isinstance(data, dict):
        raise TableError(f"{path} must hold a mapping")
    return data


def load_table(path: str, *, default_model: str | None = None) -> Table:
    """Read a table file (see `table.example.yaml`). Paths in it are relative to the file."""
    data = _load(path)
    base = os.path.dirname(os.path.abspath(path))
    seats_raw = data.get("seats")
    if not isinstance(seats_raw, dict) or len(seats_raw) < 2:
        raise TableError("`seats` must list at least two seats")
    styles: dict[str, str] = {}
    if data.get("personas_file"):
        personas = _load(os.path.join(base, str(data["personas_file"]))).get("personas") or {}
        styles = {name: str(p.get("style", "")) for name, p in personas.items() if isinstance(p, dict)}
    seats = []
    for seat_id, spec in seats_raw.items():
        spec = spec or {}
        persona = spec.get("persona")
        model = spec.get("model") or default_model
        if not persona:
            raise TableError(f"seat {seat_id}: `persona` is required")
        if not model:
            raise TableError(f"seat {seat_id}: `model` is required (or pass a default model)")
        try:
            traits = Traits.from_dict(spec["traits"]) if isinstance(spec.get("traits"), dict) else Traits()
        except (ValueError, TypeError) as err:
            raise TableError(f"seat {seat_id}: traits: {err}") from None
        if "traits" in spec and not isinstance(spec["traits"], dict):
            raise TableError(f"seat {seat_id}: `traits` must be a mapping such as {{talkative: 0.8, loose: 0.6}}")
        seats.append(TableSeat(str(seat_id), str(persona), str(model), styles.get(str(persona), ""), traits))
    table = Table(seats)
    for key in ("stack", "small_blind", "big_blind", "max_tokens"):
        if key in data:
            if not isinstance(data[key], int) or isinstance(data[key], bool) or data[key] <= 0:
                raise TableError(f"`{key}` must be a positive whole number")
            setattr(table, key, data[key])
    if data.get("reaction_model") is not None:
        if not isinstance(data["reaction_model"], str) or not data["reaction_model"].strip():
            raise TableError("`reaction_model` must be a model id")
        table.reaction_model = data["reaction_model"].strip()
    if table.small_blind > table.big_blind:
        raise TableError("small_blind cannot be larger than big_blind")
    return table


def build_reactor(table: Table, llm: Llm | None) -> Reactor:
    """Listeners ask `reaction_model` when the table names one and there is an LLM; otherwise they follow the fixed `MirrorReactor` table."""
    if table.reaction_model and llm is not None:
        return LlmReactor(llm, table.reaction_model, {s.seat_id: (s.persona, s.style) for s in table.seats})
    return MirrorReactor()


def build_agents(table: Table, llm: Llm) -> dict[str, SeatAgent]:
    return {s.seat_id: SeatAgent(s.seat_id, s.persona, llm, s.model, s.style, table.max_tokens, s.traits) for s in table.seats}
