"""The LLM behind a seat, behind a small interface so tests never call a paid service (ADR-0018).

`FakeLlm` is scripted. `OpenRouterLlm` talks to any OpenAI-compatible `chat/completions` endpoint (OpenRouter by default) over plain HTTPS with
the standard library. The API key is read from the environment and goes only into the `Authorization` header: it is never logged, never put in
an error message and never part of `repr`.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Protocol, Sequence

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
KEY_ENV = "OPENROUTER_API_KEY"

Message = dict[str, str]


class LlmError(RuntimeError):
    """The model could not be reached or answered with something unusable. The message never contains the API key."""


@dataclass
class Usage:
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost: float = 0.0  # in credits, when the provider reports it

    def add(self, other: "Usage") -> None:
        self.calls += other.calls
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens
        self.cost += other.cost


@dataclass
class LlmReply:
    text: str
    usage: Usage


class Llm(Protocol):
    def complete(self, messages: Sequence[Message], *, model: str, max_tokens: int) -> LlmReply: ...


class FakeLlm:
    """Replies from a list (used in turn, then repeated from the start) or from a function of the messages. Records every request."""

    def __init__(self, replies: "Sequence[str] | Callable[[Sequence[Message]], str]") -> None:
        self._replies = replies
        self._next = 0
        self.requests: list[dict[str, Any]] = []

    def complete(self, messages: Sequence[Message], *, model: str, max_tokens: int) -> LlmReply:
        self.requests.append({"messages": [dict(m) for m in messages], "model": model, "max_tokens": max_tokens})
        if callable(self._replies):
            text = self._replies(messages)
        else:
            text = self._replies[self._next % len(self._replies)]
            self._next += 1
        return LlmReply(text, Usage(calls=1, prompt_tokens=sum(len(m["content"]) for m in messages) // 4, completion_tokens=len(text) // 4))


Post = Callable[[str, dict[str, str], dict[str, Any], float], dict[str, Any]]


def _urllib_post(url: str, headers: dict[str, str], body: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (https to the configured endpoint)
            return json.loads(response.read())
    except urllib.error.HTTPError as err:
        raise LlmError(f"the model service answered HTTP {err.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise LlmError(f"could not reach the model service ({type(err).__name__})") from None
    except json.JSONDecodeError:
        raise LlmError("the model service did not answer with JSON") from None


class OpenRouterLlm:
    """An OpenAI-compatible chat endpoint. `post` is the transport, replaceable in tests."""

    def __init__(self, api_key: str, *, base_url: str = DEFAULT_BASE_URL, timeout: float = 60.0, temperature: float = 0.8, post: Post = _urllib_post) -> None:
        if not api_key:
            raise LlmError(f"no API key: set {KEY_ENV}")
        self._api_key = api_key
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._timeout = timeout
        self._temperature = temperature
        self._post = post

    @classmethod
    def from_env(cls, **kw: Any) -> "OpenRouterLlm":
        return cls(os.environ.get(KEY_ENV, ""), **kw)

    def __repr__(self) -> str:  # the default repr would show the key
        return f"OpenRouterLlm(url={self._url!r})"

    def complete(self, messages: Sequence[Message], *, model: str, max_tokens: int) -> LlmReply:
        body = {"model": model, "messages": list(messages), "max_tokens": max_tokens, "temperature": self._temperature, "usage": {"include": True}}
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        data = self._post(self._url, headers, body, self._timeout)
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise LlmError("the model service answered in an unexpected shape") from None
        raw = data.get("usage") or {}
        usage = Usage(calls=1, prompt_tokens=int(raw.get("prompt_tokens") or 0), completion_tokens=int(raw.get("completion_tokens") or 0), cost=float(raw.get("cost") or 0.0))
        return LlmReply(text, usage)


def load_dotenv(path: str = ".env") -> None:
    """Read `KEY=VALUE` lines into the environment without overriding what is already set. A missing file is fine. Values are never printed."""
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        value = value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value
