import { nextFireAfter } from "../domain/cron.js";
import { settingsFor } from "../domain/guardrailSettings.js";
import { isTerminal } from "../domain/runStateMachine.js";
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
} from "../shared/errors.js";
import { newId } from "../shared/ids.js";
import { secretMatchesHash } from "../shared/secrets.js";

const CANCELLED = { code: "cancelled", message: "Cancelled by an operator" };

export class RunService {
  #uow;

  constructor(uow) {
    this.#uow = uow;
  }

  async triggerManually(workflowId, input) {
    const workflow = await this.#findPublishedWorkflow(workflowId);
    return this.#startRun(workflow, "manual", input);
  }

  async triggerFromWebhook(workflowId, secret, input) {
    const workflow = await this.#findPublishedWorkflow(workflowId);
    const { trigger } = workflow.publishedDefinition;
    if (trigger.type !== "webhook") {
      throw new ConflictError(
        "not_a_webhook_workflow",
        `Workflow '${workflowId}' has no webhook trigger`,
      );
    }
    if (!secretMatchesHash(secret, workflow.webhookSecretHash)) {
      throw new UnauthorizedError("invalid_webhook_secret", "Missing or wrong webhook secret");
    }
    if (trigger.enabled === false) {
      throw new ConflictError("webhook_disabled", `Workflow '${workflowId}' has its webhook off`);
    }
    return this.#startRun(workflow, "webhook", input);
  }

  async fireDueSchedules() {
    let fired = 0;
    while (await this.#fireNextDueSchedule()) fired += 1;
    return fired;
  }

  list(filter) {
    return this.#uow.repos.runs.list(filter);
  }

  async get(runId) {
    const run = await this.#uow.repos.runs.find(runId);
    if (!run) throw new NotFoundError("Run", runId);
    const [steps, approvals] = await Promise.all([
      this.#uow.repos.steps.listForRun(runId),
      this.#uow.repos.approvals.listForRun(runId),
    ]);
    return { run, steps, approvals };
  }

  async cancel(runId) {
    await this.#uow.transaction(async (repos) => {
      const run = await repos.runs.lock(runId);
      if (!run) throw new NotFoundError("Run", runId);
      if (isTerminal(run.status)) {
        throw new ConflictError("run_finished", `Run '${runId}' has already finished`);
      }
      if (run.status === "running") {
        // The worker owns a running run; it stops at the next step boundary.
        await repos.runs.requestCancel(runId);
        await repos.queue.wake(runId);
        return;
      }
      await repos.runs.transition(runId, run.status, "cancelled", CANCELLED);
      await repos.approvals.closePending(runId);
      await repos.steps.cancelOpen(runId);
      await repos.queue.removeForRun(runId);
    });
    return this.get(runId);
  }

  async #findPublishedWorkflow(id) {
    const workflow = await this.#uow.repos.workflows.find(id);
    if (!workflow) throw new NotFoundError("Workflow", id);
    if (!workflow.publishedDefinition) {
      throw new ConflictError("workflow_not_published", `Workflow '${id}' is not published`);
    }
    return workflow;
  }

  async #startRun(workflow, triggerType, input) {
    this.#assertInputSize(workflow.publishedDefinition, input);
    return this.#uow.transaction((repos) => this.#insertRun(repos, workflow, triggerType, input));
  }

  async #insertRun(repos, workflow, triggerType, input) {
    const runId = newId("run");
    await repos.runs.insert({
      runId,
      workflowId: workflow.id,
      definitionSnapshot: workflow.publishedDefinition,
      triggerType,
      input,
    });
    await repos.queue.enqueue(runId);
    return runId;
  }

  #assertInputSize(definition, input) {
    const { maxInputKb } = settingsFor(definition);
    if (Buffer.byteLength(JSON.stringify(input)) > maxInputKb * 1024) {
      throw new PayloadTooLargeError(`Input is over this workflow's ${maxInputKb} KB limit`);
    }
  }

  #fireNextDueSchedule() {
    return this.#uow.transaction(async (repos) => {
      const schedule = await repos.schedules.lockNextDue();
      if (!schedule) return false;
      await repos.schedules.setNextFire(schedule.workflowId, nextFireAfter(schedule.cron));
      const workflow = await repos.workflows.find(schedule.workflowId);
      await this.#insertRun(repos, workflow, "schedule", schedule.input);
      return true;
    });
  }
}
