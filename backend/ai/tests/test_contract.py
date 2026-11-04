from fastapi.testclient import TestClient

from app.contract import first_error, response_validator
from app.errors import LlmUnavailableError
from app.main import create_app
from tests.conftest import VALID, ScriptedProvider, make_settings


def test_success_matches_the_shared_contract(call):
    assert first_error(response_validator, call(VALID)[0].json()) is None


def test_schema_failure_matches_the_shared_contract(call):
    assert first_error(response_validator, call("bad", "bad")[0].json()) is None


def test_unavailable_matches_the_shared_contract(call):
    response, _ = call(LlmUnavailableError("down"))
    assert first_error(response_validator, response.json()) is None


def test_missing_internal_token_is_rejected():
    client = TestClient(create_app(make_settings(), ScriptedProvider()))
    assert client.post("/v1/complete", json={}).status_code == 401


def test_invalid_request_is_rejected():
    client = TestClient(create_app(make_settings(), ScriptedProvider()))
    response = client.post(
        "/v1/complete", headers={"X-Internal-Token": "test-token"}, json={"prompt": "x"}
    )
    assert response.status_code == 424
    assert response.json()["error"]["code"] == "invalid_request"
