import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]
CONTRACTS_DIR = BACKEND_DIR / "contracts"
OPENROUTER_URL = "https://openrouter.ai/api/v1"

load_dotenv(BACKEND_DIR.parent / ".env")


@dataclass(frozen=True)
class Settings:
    internal_token: str
    llm_base_url: str
    llm_model: str
    llm_api_key: str
    llm_structured_output: bool
    llm_timeout_seconds: float = 30.0
    llm_max_tokens: int = 1024


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set; add it to .env")
    return value


def load_settings() -> Settings:
    return Settings(
        internal_token=_required("AI_SERVICE_TOKEN"),
        llm_base_url=os.environ.get("LLM_BASE_URL", "").strip() or OPENROUTER_URL,
        llm_model=_required("LLM_MODEL"),
        llm_api_key=_required("OPENROUTER_API_KEY"),
        llm_structured_output=os.environ.get("LLM_STRUCTURED_OUTPUT", "true") == "true",
    )
