"""Build and check the messages a driver sends. The wire format is docs/protocol.md."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator

from .errors import InvalidMessage

PROTOCOL_VERSION = 1


@lru_cache(maxsize=1)
def schema() -> dict[str, Any]:
    """The JSON Schema shipped with this package (a copy of docs/protocol.schema.json, kept equal by a test)."""
    return json.loads(resources.files("vikaki_client").joinpath("protocol.schema.json").read_text("utf-8"))


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    return Draft202012Validator(schema())


def validate(message: dict[str, Any]) -> None:
    """Raise `InvalidMessage` unless `message` is allowed by the schema and by the rules the schema cannot say.

    The rules: an `utterance` has exactly one of `text` or `delta`, and `final` only goes with `delta`; a `react` has an `emotion`, a `gesture`
    or both; a `table_state` lists each seat once.
    """
    errors = sorted(_validator().iter_errors(message), key=lambda e: list(e.path))
    if errors:
        # The schema is a `oneOf` over every message type, so its own message for a bad field is unhelpful; say which type we meant.
        kind = message.get("type", "message")
        detail = _best_detail(message)
        raise InvalidMessage(f"invalid {kind}: {detail}")
    if message.get("type") == "utterance":
        if ("text" in message) == ("delta" in message):
            raise InvalidMessage("invalid utterance: send exactly one of `text` or `delta`")
        if "final" in message and "delta" not in message:
            raise InvalidMessage("invalid utterance: `final` only goes with `delta`")
    if message.get("type") == "react" and "emotion" not in message and "gesture" not in message:
        raise InvalidMessage("invalid react: send an `emotion`, a `gesture`, or both")
    if message.get("type") == "table_state":
        ids = [s.get("seat_id") for s in message.get("seats", [])]
        if len(set(ids)) != len(ids):
            raise InvalidMessage("invalid table_state: a seat is listed twice")


def _best_detail(message: dict[str, Any]) -> str:
    """The error from the one branch of the `oneOf` whose `type` matches, so the user sees the real field at fault."""
    for branch in schema()["oneOf"]:
        const = branch.get("properties", {}).get("type", {}).get("const")
        if const is not None and const == message.get("type"):
            errs = sorted(Draft202012Validator(branch).iter_errors(message), key=lambda e: list(e.path))
            if errs:
                e = errs[0]
                where = ".".join(str(p) for p in e.path)
                return f"{where + ': ' if where else ''}{e.message}"
    return f"unknown message type {message.get('type')!r}"


def make(type_: str, **fields: Any) -> dict[str, Any]:
    """A message with the protocol version filled in and unset (`None`) fields left out. It is checked before it is returned."""
    message: dict[str, Any] = {"protocol_version": PROTOCOL_VERSION, "type": type_}
    message.update({k: v for k, v in fields.items() if v is not None})
    validate(message)
    return message
