import { serializeApproval, serializeApprovalWithContext } from "../serializers/serializers.js";

export class ApprovalController {
  #approvals;

  constructor(approvals) {
    this.#approvals = approvals;
  }

  list = async (req, res) => {
    const approvals = await this.#approvals.list(req.validatedQuery);
    res.json(approvals.map(serializeApprovalWithContext));
  };

  approve = async (req, res) => {
    const approval = await this.#approvals.approve(req.params.id, req.principal);
    res.json(serializeApproval(approval));
  };

  reject = async (req, res) => {
    const approval = await this.#approvals.reject(req.params.id, req.principal);
    res.json(serializeApproval(approval));
  };
}
