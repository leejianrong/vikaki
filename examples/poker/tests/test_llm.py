import json
import urllib.error

import pytest

from vikaki_poker.llm import FakeLlm, LlmError, OpenRouterLlm, Usage, load_dotenv

KEY = "sk-or-test-SECRET-1234"
MESSAGES = [{"role": "system", "content": "be brief"}, {"role": "user", "content": "your move"}]


def ok_post(captured: dict):
    def post(url, headers, body, timeout):
        captured.update(url=url, headers=headers, body=body, timeout=timeout)
        return {"choices": [{"message": {"content": '{"action": "check"}'}}], "usage": {"prompt_tokens": 40, "completion_tokens": 7, "cost": 0.0002}}

    return post


def test_a_request_goes_to_chat_completions_with_the_key_only_in_the_header():
    seen: dict = {}
    llm = OpenRouterLlm(KEY, post=ok_post(seen))
    reply = llm.complete(MESSAGES, model="deepseek/deepseek-chat", max_tokens=120)
    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert seen["headers"]["Authorization"] == f"Bearer {KEY}"
    assert KEY not in json.dumps(seen["body"])
    assert seen["body"]["model"] == "deepseek/deepseek-chat" and seen["body"]["max_tokens"] == 120 and seen["body"]["messages"] == MESSAGES
    assert reply.text == '{"action": "check"}'
    assert (reply.usage.calls, reply.usage.prompt_tokens, reply.usage.completion_tokens, reply.usage.cost) == (1, 40, 7, 0.0002)


def test_another_endpoint_can_be_used():
    seen: dict = {}
    OpenRouterLlm(KEY, base_url="http://localhost:11434/v1/", post=ok_post(seen)).complete(MESSAGES, model="m", max_tokens=5)
    assert seen["url"] == "http://localhost:11434/v1/chat/completions"


def test_the_key_never_shows_in_repr_or_errors(monkeypatch):
    llm = OpenRouterLlm(KEY, post=ok_post({}))
    assert KEY not in repr(llm) and KEY not in str(llm)

    def refuse(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr("urllib.request.urlopen", refuse)
    with pytest.raises(LlmError) as err:
        OpenRouterLlm(KEY).complete(MESSAGES, model="m", max_tokens=5)
    assert "401" in str(err.value) and KEY not in str(err.value)

    def unreachable(request, timeout):
        raise urllib.error.URLError("name resolution failed")

    monkeypatch.setattr("urllib.request.urlopen", unreachable)
    with pytest.raises(LlmError) as err:
        OpenRouterLlm(KEY).complete(MESSAGES, model="m", max_tokens=5)
    assert KEY not in str(err.value) and "reach" in str(err.value)


def test_an_unexpected_answer_is_an_llm_error():
    llm = OpenRouterLlm(KEY, post=lambda *a: {"error": {"message": "rate limited"}})
    with pytest.raises(LlmError):
        llm.complete(MESSAGES, model="m", max_tokens=5)


def test_a_missing_key_is_an_llm_error_that_names_the_variable(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(LlmError, match="OPENROUTER_API_KEY"):
        OpenRouterLlm.from_env()
    monkeypatch.setenv("OPENROUTER_API_KEY", KEY)
    assert isinstance(OpenRouterLlm.from_env(post=ok_post({})), OpenRouterLlm)


def test_fake_llm_cycles_through_replies_and_records_requests():
    llm = FakeLlm(["one", "two"])
    got = [llm.complete(MESSAGES, model="m", max_tokens=9).text for _ in range(3)]
    assert got == ["one", "two", "one"]
    assert llm.requests[0] == {"messages": MESSAGES, "model": "m", "max_tokens": 9}


def test_fake_llm_can_answer_from_the_messages():
    llm = FakeLlm(lambda messages: messages[-1]["content"].upper())
    assert llm.complete(MESSAGES, model="m", max_tokens=9).text == "YOUR MOVE"


def test_usage_adds_up():
    total = Usage()
    total.add(Usage(1, 10, 2, 0.5))
    total.add(Usage(2, 5, 1, 0.25))
    assert (total.calls, total.prompt_tokens, total.completion_tokens, total.cost) == (3, 15, 3, 0.75)


def test_dotenv_fills_missing_variables_only(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text("# a comment\nOPENROUTER_API_KEY='from-file'\nexport OTHER=\"two words\"\n\nbroken line\nKEEP=file\n")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("OTHER", raising=False)
    monkeypatch.setenv("KEEP", "already set")
    load_dotenv(str(env))
    import os

    assert os.environ["OPENROUTER_API_KEY"] == "from-file" and os.environ["OTHER"] == "two words" and os.environ["KEEP"] == "already set"
    load_dotenv(str(tmp_path / "missing.env"))  # no file is fine


def test_reasoning_is_off_by_default_so_a_thinking_model_spends_its_tokens_on_the_answer():
    seen: dict = {}
    OpenRouterLlm(KEY, post=ok_post(seen)).complete(MESSAGES, model="deepseek/deepseek-v4.1-flash", max_tokens=200)
    assert seen["body"]["reasoning"] == {"enabled": False}


def test_reasoning_can_be_left_to_the_model():
    seen: dict = {}
    OpenRouterLlm(KEY, reasoning=True, post=ok_post(seen)).complete(MESSAGES, model="m", max_tokens=200)
    assert "reasoning" not in seen["body"]


def test_an_http_error_carries_the_providers_reason_but_never_the_key(monkeypatch):
    import io
    import urllib.error

    from vikaki_poker import llm as llm_module

    body = json.dumps({"error": {"message": f"0 endpoints available matching your guardrail restrictions. Authorization: Bearer {KEY}"}}).encode()

    def boom(*a, **kw):
        raise urllib.error.HTTPError("https://openrouter.ai", 404, "Not Found", {}, io.BytesIO(body))

    monkeypatch.setattr(llm_module.urllib.request, "urlopen", boom)
    with pytest.raises(LlmError) as err:
        OpenRouterLlm(KEY).complete(MESSAGES, model="m", max_tokens=5)
    text = str(err.value)
    assert "HTTP 404" in text and "guardrail" in text
    assert KEY not in text
