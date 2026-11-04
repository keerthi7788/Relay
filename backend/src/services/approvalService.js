import { ConflictError, NotFoundError } from "../shared/errors.js";

export class ApprovalService {
  #uow;

  constructor(uow) {
    this.#uow = uow;
  }

  async list(filter) {
    const approvals = await this.#uow.repos.approvals.listByStatus(filter);
    return Promise.all(
      approvals.map(async (approval) => {
        const [run, steps] = await Promise.all([
          this.#uow.repos.runs.find(approval.runId),
          this.#uow.repos.steps.listForRun(approval.runId),
        ]);
        return { approval, run, steps };
      }),
    );
  }

  approve(id, decidedBy) {
    return this.#decide(id, "approved", decidedBy, async (repos, { runId }) => {
      await this.#leaveWaiting(repos, runId, "queued");
      await repos.queue.enqueue(runId);
    });
  }

  reject(id, decidedBy) {
    return this.#decide(id, "rejected", decidedBy, async (repos, { runId }) => {
      await repos.steps.cancelOpen(runId, { decision: "rejected", decided_by: decidedBy });
      await this.#leaveWaiting(repos, runId, "cancelled", {
        code: "approval_rejected",
        message: `Approval rejected by ${decidedBy}`,
      });
    });
  }

  async #leaveWaiting(repos, runId, status, error) {
    const moved = await repos.runs.transition(runId, "waiting_approval", status, error);
    if (!moved) throw new ConflictError("run_changed", `Run '${runId}' is no longer waiting`);
  }

  async #decide(id, status, decidedBy, applyToRun) {
    const decided = await this.#uow.transaction(async (repos) => {
      const approval = await repos.approvals.decide(id, status, decidedBy);
      if (approval) await applyToRun(repos, approval);
      return approval;
    });
    if (decided) return decided;

    const existing = await this.#uow.repos.approvals.find(id);
    if (!existing) throw new NotFoundError("Approval", id);
    throw new ConflictError(
      "approval_already_decided",
      `Approval '${id}' is already ${existing.status}`,
    );
  }
}
