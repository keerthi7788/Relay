class LlmUnavailableError(Exception):
    """The provider timed out, failed or rate-limited us. The caller should retry."""


class LlmRejectedError(Exception):
    """The provider refused the request, for example a bad key. Retrying won't help."""
