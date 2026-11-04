import json
from pathlib import Path

from jsonschema import Draft7Validator

from app.config import CONTRACTS_DIR


def _load_validator(file_name: str, contracts_dir: Path = CONTRACTS_DIR) -> Draft7Validator:
    return Draft7Validator(json.loads((contracts_dir / file_name).read_text()))


request_validator = _load_validator("ai-complete.request.schema.json")
response_validator = _load_validator("ai-complete.response.schema.json")


def first_error(validator: Draft7Validator, value: object) -> str | None:
    error = next(iter(validator.iter_errors(value)), None)
    return error.message if error else None
