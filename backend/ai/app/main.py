import hmac
import logging
from typing import Annotated

from fastapi import Body, Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from app.completion import CompletionResult, CompletionService
from app.config import Settings, load_settings
from app.contract import first_error, request_validator, response_validator
from app.errors import LlmUnavailableError
from app.providers.base import LlmProvider
from app.providers.openrouter import OpenRouterProvider

logger = logging.getLogger("relay.ai")

HTTP_OK = 200
HTTP_FAILED_DEPENDENCY = 424
HTTP_SCHEMA_FAILED = 422
HTTP_UNAVAILABLE = 503


def _response(result: CompletionResult | None = None, **fields: object) -> dict:
    result = result or CompletionResult()
    return {
        "attempts": result.attempts,
        "flags": result.flags,
        "tokens": {"prompt": result.prompt_tokens, "completion": result.completion_tokens},
        **fields,
    }


def _error(code: str, message: str, status: int, result: CompletionResult | None = None):
    body = _response(result, error={"code": code, "message": message})
    return JSONResponse(body, status_code=status)


def _completion_response(result: CompletionResult) -> JSONResponse:
    if result.provider_error is not None:
        if isinstance(result.provider_error, LlmUnavailableError):
            return _error("llm_unavailable", str(result.provider_error), HTTP_UNAVAILABLE, result)
        return _error("llm_rejected", str(result.provider_error), HTTP_FAILED_DEPENDENCY, result)
    if result.output is None:
        return _error("ai_schema_violation", result.error_message, HTTP_SCHEMA_FAILED, result)

    body = _response(result, output=result.output, model=result.model)
    violation = first_error(response_validator, body)
    if violation:
        raise RuntimeError(f"Response broke the contract: {violation}")
    return JSONResponse(body, status_code=HTTP_OK)


def create_app(settings: Settings, provider: LlmProvider) -> FastAPI:
    app = FastAPI(title="Relay AI service", docs_url=None, redoc_url=None)
    service = CompletionService(provider)

    def require_internal_token(x_internal_token: str = Header(default="")) -> None:
        expected = settings.internal_token.encode()
        if not hmac.compare_digest(x_internal_token.encode(), expected):
            raise HTTPException(status_code=401, detail="Invalid internal token")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "model": settings.llm_model}

    # A plain def runs in a thread pool, so a slow LLM call doesn't block /health.
    @app.post("/v1/complete", dependencies=[Depends(require_internal_token)])
    def complete(
        payload: Annotated[dict, Body()],
        x_run_id: str = Header(default="-"),
        x_node_id: str = Header(default="-"),
    ) -> JSONResponse:
        violation = first_error(request_validator, payload)
        if violation:
            return _error("invalid_request", violation, HTTP_FAILED_DEPENDENCY)

        logger.info("completion run_id=%s node_id=%s", x_run_id, x_node_id)
        options = payload.get("guardrails", {})
        result = service.complete(
            payload["prompt"],
            payload["output_schema"],
            payload["untrusted_values"],
            flag_injection=options.get("flag_injection", True),
            strip_links=options.get("strip_links", True),
        )
        return _completion_response(result)

    return app


def create_production_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO)
    settings = load_settings()
    return create_app(settings, OpenRouterProvider(settings))
