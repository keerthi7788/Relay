import json

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.providers.base import LlmRequest, LlmResponse

TOKEN = "test-token"
SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": ["refund_request", "complaint"]},
        "summary": {"type": "string", "maxLength": 300},
    },
    "required": ["category", "summary"],
    "additionalProperties": False,
}
VALID = json.dumps({"category": "complaint", "summary": "Cracked case"})


class ScriptedProvider:
    """Returns canned replies or raises canned errors, in order."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests: list[LlmRequest] = []

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return LlmResponse(reply, prompt_tokens=10, completion_tokens=5, model="scripted")


def make_settings() -> Settings:
    return Settings(
        internal_token=TOKEN,
        llm_base_url="http://llm.test/v1",
        llm_model="test-model",
        llm_api_key="test-key",
        llm_structured_output=True,
    )


@pytest.fixture
def call():
    def _call(*replies, untrusted=("hello",), prompt="Classify this", guardrails=None):
        provider = ScriptedProvider(*replies)
        client = TestClient(create_app(make_settings(), provider))
        response = client.post(
            "/v1/complete",
            headers={"X-Internal-Token": TOKEN},
            json={
                "prompt": prompt,
                "output_schema": SCHEMA,
                "untrusted_values": list(untrusted),
                **({"guardrails": guardrails} if guardrails else {}),
            },
        )
        return response, provider

    return _call
