const INJECTION_FLAG = "injection_suspected";
const MS_PER_SECOND = 1000;

const fail = (code, message) => ({ status: "failed", code, message });

export class CancelGuard {
  async check({ run }) {
    if (!run.cancelRequested) return null;
    return { status: "cancelled", code: "cancelled", message: "Cancelled by an operator" };
  }
}

export class StepCapGuard {
  async check({ run, isNewStep, settings: { maxSteps } }) {
    if (!isNewStep || run.stepsExecuted < maxSteps) return null;
    return fail(
      "max_steps_exceeded",
      `Stopped by the step cap: reached limits.max_steps (${maxSteps})`,
    );
  }
}

export class TimeLimitGuard {
  #approvals;

  constructor(approvals) {
    this.#approvals = approvals;
  }

  async check({ run, steps, settings: { timeoutSeconds } }) {
    if (!run.startedAt) return null;
    const approvals = await this.#approvals.listForRun(run.runId);
    const waitedMs = approvals
      .filter(({ decidedAt }) => decidedAt)
      .reduce((total, { createdAt, decidedAt }) => total + (decidedAt - createdAt), 0);
    const delayedMs = steps
      .filter(({ nodeType }) => nodeType === "delay")
      .reduce(
        (total, { durationMs, startedAt }) =>
          total + (durationMs ?? Date.now() - startedAt.getTime()),
        0,
      );
    const elapsedMs = Date.now() - run.startedAt.getTime() - waitedMs - delayedMs;
    if (elapsedMs <= timeoutSeconds * MS_PER_SECOND) return null;
    return fail(
      "timeout_exceeded",
      `Stopped by the time limit: reached limits.timeout_seconds (${timeoutSeconds})`,
    );
  }
}

export class TokenBudgetGuard {
  async check({ run, node, settings: { maxAiTokens } }) {
    const withinBudget = maxAiTokens > 0 && run.aiTokensUsed < maxAiTokens;
    if (node.type !== "ai" || withinBudget) return null;
    return fail(
      "token_budget_exceeded",
      `Stopped by the token budget: reached limits.max_ai_tokens (${maxAiTokens})`,
    );
  }
}

// The gate is a database check, so nothing a model outputs can satisfy it.
export class ApprovalGuard {
  #catalog;
  #approvals;

  constructor(catalog, approvals) {
    this.#catalog = catalog;
    this.#approvals = approvals;
  }

  async check({ run, node, settings: { requireApprovalFor } }) {
    const required =
      this.#catalog.requiresApproval(node.type) || requireApprovalFor.includes(node.type);
    if (!required || (await this.#approvals.hasApproved(run.runId))) return null;
    return fail(
      "approval_required",
      `Blocked: '${node.id}' needs an approval and this run has none`,
    );
  }
}

export class InjectionApprovalGuard {
  #executors;
  #approvals;

  constructor(executors, approvals) {
    this.#executors = executors;
    this.#approvals = approvals;
  }

  async check({ run, node, steps, settings: { injectionDetection } }) {
    if (injectionDetection !== "require_approval") return null;
    if (!this.#executors.forType(node.type).hasSideEffect(node.params)) return null;
    const flagged = steps.some((step) =>
      step.guardrailFlags.some(({ type }) => type === INJECTION_FLAG),
    );
    if (!flagged || (await this.#approvals.hasApproved(run.runId))) return null;
    return {
      status: "waiting_approval",
      message: `Possible prompt injection in this run. Approve '${node.id}' to continue.`,
    };
  }
}

export class GuardChain {
  #guards;

  constructor(guards) {
    this.#guards = guards;
  }

  async firstDenial(context) {
    for (const guard of this.#guards) {
      const denial = await guard.check(context);
      if (denial) return denial;
    }
    return null;
  }
}
