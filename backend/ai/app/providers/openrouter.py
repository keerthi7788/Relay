import httpx

from app.config import Settings
from app.errors import LlmRejectedError, LlmUnavailableError
from app.providers.base import LlmRequest, LlmResponse

HTTP_REQUEST_TIMEOUT = 408
HTTP_TOO_MANY_REQUESTS = 429
HTTP_SERVER_ERROR = 500


class OpenRouterProvider:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        self._settings = settings
        self._client = httpx.Client(
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout_seconds,
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            transport=transport,
        )

    def complete(self, request: LlmRequest) -> LlmResponse:
        try:
            response = self._client.post("/chat/completions", json=self._build_body(request))
        except httpx.HTTPError as error:
            raise LlmUnavailableError(f"LLM call failed: {type(error).__name__}") from error

        status = response.status_code
        if status in (HTTP_REQUEST_TIMEOUT, HTTP_TOO_MANY_REQUESTS) or status >= HTTP_SERVER_ERROR:
            raise LlmUnavailableError(f"LLM provider returned {status}")
        if not response.is_success:
            raise LlmRejectedError(f"LLM provider returned {status}")
        try:
            return self._parse(response.json())
        except ValueError as error:
            raise LlmUnavailableError("LLM response was not valid JSON") from error

    def _build_body(self, request: LlmRequest) -> dict:
        body = {
            "model": self._settings.llm_model,
            "messages": request.messages,
            "temperature": 0,
            "max_tokens": self._settings.llm_max_tokens,
        }
        if self._settings.llm_structured_output:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "output", "schema": request.output_schema},
            }
            # Otherwise OpenRouter may route to a host that silently ignores response_format.
            body["provider"] = {"require_parameters": True}
        return body

    def _parse(self, payload: dict) -> LlmResponse:
        try:
            text = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise LlmUnavailableError("LLM response had no message content") from error
        usage = payload.get("usage") or {}
        return LlmResponse(
            text=text or "",
            prompt_tokens=usage.get("prompt_tokens") or 0,
            completion_tokens=usage.get("completion_tokens") or 0,
            model=payload.get("model", self._settings.llm_model),
        )
