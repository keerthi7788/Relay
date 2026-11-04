const JITTER_RATIO = 0.1;

export class RetryPolicy {
  #maxAttempts;
  #baseDelayMs;
  #random;

  constructor({ maxAttempts, baseDelayMs }, random = Math.random) {
    this.#maxAttempts = maxAttempts;
    this.#baseDelayMs = baseDelayMs;
    this.#random = random;
  }

  nextDelayMs(attempt, { max_attempts: maxAttempts, backoff_seconds: backoffSeconds } = {}) {
    if (attempt >= (maxAttempts ?? this.#maxAttempts)) return null;
    const base = backoffSeconds === undefined ? this.#baseDelayMs : backoffSeconds * 1000;
    return Math.round(base * 2 ** (attempt - 1) * (1 + this.#random() * JITTER_RATIO));
  }
}
