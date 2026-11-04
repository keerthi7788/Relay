export class MockWorldClient {
  #http;
  #baseUrl;

  constructor(http, baseUrl) {
    this.#http = http;
    this.#baseUrl = baseUrl;
  }

  notify({ channel, to, subject, message }, idempotencyKey) {
    const isEmail = channel === "email";
    return this.#post(
      isEmail ? "/email/send" : "/chat/message",
      isEmail ? { to, subject, message } : { channel: to, message },
      idempotencyKey,
    );
  }

  orderAction({ action, order_id: orderId, amount_usd: amountUsd }, idempotencyKey) {
    return this.#post(
      `/orders/${encodeURIComponent(orderId)}/${action}`,
      amountUsd === undefined ? {} : { amount_usd: amountUsd },
      idempotencyKey,
    );
  }

  #post(path, body, idempotencyKey) {
    return this.#http.request({
      method: "POST",
      url: `${this.#baseUrl}${path}`,
      headers: { "Idempotency-Key": idempotencyKey },
      body,
    });
  }
}
