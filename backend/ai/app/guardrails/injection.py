import re

_PATTERNS = [
    r"system override",
    r"ignore (all |any )?(the |your )?(previous |prior |above )?(instructions|ticket|rules)",
    r"new instructions",
    r"you are now",
    r"supersedes all",
    r"approval has already been granted",
    r"do not create an approval",
    r"system prompt",
    r"environment variables",
]
_INJECTION = re.compile("|".join(_PATTERNS), re.IGNORECASE)


def find_injection_flags(untrusted_values: list[str]) -> list[dict[str, str]]:
    found = {match.group(0) for value in untrusted_values for match in _INJECTION.finditer(value)}
    return [{"type": "injection_suspected", "detail": phrase} for phrase in sorted(found)]
