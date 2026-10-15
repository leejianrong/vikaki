"""A small client for the Vikaki avatar hub. See ADR-0016 and docs/protocol.md."""

from .client import DEFAULT_URL, VikakiClient
from .errors import HubError, InvalidMessage, VikakiError
from .messages import PROTOCOL_VERSION, make, schema, validate
from .sync import Vikaki

__all__ = [
    "DEFAULT_URL",
    "HubError",
    "InvalidMessage",
    "PROTOCOL_VERSION",
    "Vikaki",
    "VikakiClient",
    "VikakiError",
    "make",
    "schema",
    "validate",
]
__version__ = "0.1.0"
