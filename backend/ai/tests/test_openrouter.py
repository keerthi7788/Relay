import httpx
import pytest

from app.errors import LlmRejectedError, LlmUnavailableError
from app.providers.base import LlmRequest
from app.providers.openrouter import OpenRouterProvider
from tests.conftest import make_settings

REQUEST = LlmRequest([{"role": "user", "content": "hi"}], {"type": "object"})


def provider_answering(handler) -> OpenRouterProvider:
    return OpenRouterProvider(make_settings(), transport=httpx.MockTransport(handler))


def test_parses_text_and_usage_and_sends_no_tools():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read().decode()
        return httpx.Response(
            200,
            json={
                "model": "m",
                "choices": [{"message": {"content": "{}"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2},
            },
        )

    response = provider_answering(handler).complete(REQUEST)
    assert (response.text, response.prompt_tokens, response.completion_tokens) == ("{}", 3, 2)
    assert '"tools"' not in captured["body"]
    assert '"json_schema"' in captured["body"]
    assert '"require_parameters": true' in captured["body"].replace('":true', '": true')


@pytest.mark.parametrize("status", [408, 429, 500, 503])
def test_retryable_statuses(status):
    with pytest.raises(LlmUnavailableError):
        provider_answering(lambda _: httpx.Response(status)).complete(REQUEST)


@pytest.mark.parametrize("status", [400, 401, 404])
def test_permanent_statuses(status):
    with pytest.raises(LlmRejectedError):
        provider_answering(lambda _: httpx.Response(status)).complete(REQUEST)


def test_timeout_is_retryable():
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    with pytest.raises(LlmUnavailableError):
        provider_answering(handler).complete(REQUEST)


def test_non_json_response_is_retryable():
    response = httpx.Response(200, content=b"<html>bad gateway</html>")
    with pytest.raises(LlmUnavailableError):
        provider_answering(lambda _: response).complete(REQUEST)


def test_null_token_counts_become_zero():
    body = {
        "choices": [{"message": {"content": "{}"}}],
        "usage": {"prompt_tokens": None, "completion_tokens": None},
    }
    result = provider_answering(lambda _: httpx.Response(200, json=body)).complete(REQUEST)
    assert (result.prompt_tokens, result.completion_tokens) == (0, 0)
