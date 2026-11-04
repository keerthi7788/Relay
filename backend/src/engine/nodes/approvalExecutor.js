import { awaitingApproval, completed } from "./nodeResult.js";

export class ApprovalExecutor {
  waitsInPlace = true;
  #approvals;

  constructor(approvals) {
    this.#approvals = approvals;
  }

  hasSideEffect() {
    return false;
  }

  async execute({ run, step, params }) {
    const approval = await this.#approvals.findForStep(run.runId, step.nodeId, step.sequence);
    if (approval?.status === "approved") {
      return completed({ decision: "approved", decided_by: approval.decidedBy });
    }
    return awaitingApproval(params.message);
  }
}
