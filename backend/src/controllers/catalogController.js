export class CatalogController {
  #workflows;

  constructor(workflows) {
    this.#workflows = workflows;
  }

  get = (_req, res) => {
    res.json(this.#workflows.catalog());
  };

  samplePayloads = (req, res) => {
    res.json(this.#workflows.samplePayloads(req.validatedQuery.workflowId));
  };
}
