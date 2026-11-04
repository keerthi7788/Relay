export class HealthController {
  #health;

  constructor(health) {
    this.#health = health;
  }

  check = (_req, res) => {
    res.json({ status: "ok" });
  };

  ready = async (_req, res) => {
    const ready = await this.#health.isReady();
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable" });
  };
}
