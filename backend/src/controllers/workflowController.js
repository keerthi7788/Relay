import { serializeWorkflow, serializeWorkflowSummary } from "../serializers/serializers.js";

const withSecret = ({ workflow, generatedSecret }) => ({
  ...serializeWorkflow(workflow),
  ...(generatedSecret ? { webhook_secret: generatedSecret } : {}),
});

export class WorkflowController {
  #workflows;
  #runs;

  constructor(workflows, runs) {
    this.#workflows = workflows;
    this.#runs = runs;
  }

  list = async (req, res) => {
    const workflows = await this.#workflows.list(req.validatedQuery);
    res.json(workflows.map(serializeWorkflowSummary));
  };

  create = async (req, res) => {
    res.status(201).json(withSecret(await this.#workflows.create(req.body)));
  };

  get = async (req, res) => {
    const workflow = await this.#workflows.get(req.params.id);
    res.json(serializeWorkflow(workflow));
  };

  update = async (req, res) => {
    res.json(withSecret(await this.#workflows.update(req.params.id, req.body)));
  };

  publish = async (req, res) => {
    const { workflow, warnings } = await this.#workflows.publish(req.params.id);
    res.json({ ...serializeWorkflow(workflow), warnings });
  };

  trigger = async (req, res) => {
    const runId = await this.#runs.triggerManually(req.params.id, req.body.input);
    res.status(202).json({ run_id: runId, status: "queued" });
  };

  updateTrigger = async (req, res) => {
    res.json(withSecret(await this.#workflows.updateTrigger(req.params.id, req.body)));
  };

  rotateSecret = async (req, res) => {
    const secret = await this.#workflows.rotateSecret(req.params.id);
    res.json({ webhook_secret: secret });
  };

  updateGuardrails = async (req, res) => {
    res.json(withSecret(await this.#workflows.updateGuardrails(req.params.id, req.body)));
  };
}
