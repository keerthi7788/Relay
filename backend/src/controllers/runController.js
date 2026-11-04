import { serializeRun, serializeRunSummary } from "../serializers/serializers.js";

export class RunController {
  #runs;

  constructor(runs) {
    this.#runs = runs;
  }

  list = async (req, res) => {
    const runs = await this.#runs.list(req.validatedQuery);
    res.json(runs.map(serializeRunSummary));
  };

  get = async (req, res) => {
    const run = await this.#runs.get(req.params.id);
    res.json(serializeRun(run));
  };

  cancel = async (req, res) => {
    const run = await this.#runs.cancel(req.params.id);
    res.json(serializeRun(run));
  };
}
