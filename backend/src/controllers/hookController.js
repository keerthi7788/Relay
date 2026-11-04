export class HookController {
  #runs;

  constructor(runs) {
    this.#runs = runs;
  }

  trigger = async (req, res) => {
    const secret = req.get("x-relay-secret");
    const runId = await this.#runs.triggerFromWebhook(req.params.id, secret, req.body);
    res.status(202).json({ run_id: runId, status: "queued" });
  };
}
