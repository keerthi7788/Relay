from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class LlmRequest:
    messages: list[dict[str, str]]
    output_schema: dict


@dataclass(frozen=True)
class LlmResponse:
    text: str
    prompt_tokens: int
    completion_tokens: int
    model: str


class LlmProvider(Protocol):
    def complete(self, request: LlmRequest) -> LlmResponse: ...
