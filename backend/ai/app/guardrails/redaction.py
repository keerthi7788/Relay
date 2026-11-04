import re

REDACTED = "[redacted]"
_CONTACT = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.-]+|\b(?:https?://|www\.)\S+",
    re.IGNORECASE,
)


def _is_free_text(schema: dict) -> bool:
    return "enum" not in schema and "const" not in schema and "pattern" not in schema


def _redact(value: object, schema: dict, path: str, flags: list[dict[str, str]]) -> object:
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        return {
            key: _redact(item, properties.get(key, {}), f"{path}.{key}".lstrip("."), flags)
            for key, item in value.items()
        }
    if isinstance(value, list):
        item_schema = schema.get("items", {})
        return [
            _redact(item, item_schema, f"{path}[{index}]", flags)
            for index, item in enumerate(value)
        ]
    if isinstance(value, str) and _is_free_text(schema):
        redacted, count = _CONTACT.subn(REDACTED, value)
        if count:
            flags.append({"type": "redacted", "detail": path})
        return redacted
    return value


def redact_output(output: dict, schema: dict) -> tuple[dict, list[dict[str, str]]]:
    flags: list[dict[str, str]] = []
    return _redact(output, schema, "", flags), flags
