"""Errors the client raises."""

from __future__ import annotations


class VikakiError(Exception):
    """Base class for everything this package raises."""


class InvalidMessage(VikakiError, ValueError):
    """A message the client refused to send because it breaks the protocol. Nothing was sent."""


class HubError(VikakiError):
    """The hub answered with an `error` message, or the connection could not be used.

    `code` is one of the protocol's error codes (`driver_busy`, `unauthorized`, `unsupported_protocol_version`, ...),
    or `connect_failed`, `timeout` or `connection_closed` for problems on this side.
    """

    def __init__(self, code: str, message: str, utterance_id: str | None = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.utterance_id = utterance_id
