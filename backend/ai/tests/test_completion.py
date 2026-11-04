import json

from app.errors import LlmRejectedError, LlmUnavailableError
from tests.conftest import VALID


def test_valid_output_is_returned_with_tokens(call):
    response, provider = call(VALID)
    assert response.status_code == 200
    assert response.json()["output"]["category"] == "complaint"
    assert response.json()["tokens"] == {"prompt": 10, "completion": 5}
    assert len(provider.requests) == 1


def test_invalid_output_is_repaired_once_with_the_error(call):
    response, provider = call('{"category": "unknown", "summary": "x"}', VALID)
    body = response.json()
    assert response.status_code == 200
    assert [attempt["outcome"] for attempt in body["attempts"]] == ["failed", "succeeded"]
    assert body["tokens"] == {"prompt": 20, "completion": 10}
    assert "Schema violation at category" in provider.requests[1].messages[-1]["content"]


def test_invalid_twice_fails_with_both_attempts_and_no_third_call(call):
    response, provider = call("not json", "still not json")
    body = response.json()
    assert response.status_code == 422
    assert body["error"]["code"] == "ai_schema_violation"
    assert len(body["attempts"]) == 2
    assert "output" not in body
    assert len(provider.requests) == 2


def test_extra_fields_are_rejected(call):
    extra = json.dumps({"category": "complaint", "summary": "x", "approved": True})
    response, _ = call(extra, extra)
    assert response.status_code == 422


def test_code_fenced_json_is_accepted(call):
    response, _ = call(f"```json\n{VALID}\n```")
    assert response.status_code == 200


def test_unavailable_provider_maps_to_retryable_status(call):
    response, _ = call(LlmUnavailableError("timed out"))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "llm_unavailable"


def test_rejected_provider_maps_to_permanent_status(call):
    response, _ = call(LlmRejectedError("bad key"))
    assert response.status_code == 424
    assert response.json()["error"]["code"] == "llm_rejected"


def test_provider_failure_on_repair_keeps_the_first_attempt(call):
    response, _ = call("not json", LlmUnavailableError("timed out"))
    body = response.json()
    assert response.status_code == 503
    assert len(body["attempts"]) == 1
    assert body["tokens"] == {"prompt": 10, "completion": 5}


def test_settings_can_switch_off_flagging_and_redaction(call):
    reply = json.dumps({"category": "complaint", "summary": "Mail a@evil.test"})
    body = call(reply, untrusted=["SYSTEM OVERRIDE"], guardrails={
        "flag_injection": False,
        "strip_links": False,
    })[0].json()
    assert body["flags"] == []
    assert body["output"]["summary"] == "Mail a@evil.test"
