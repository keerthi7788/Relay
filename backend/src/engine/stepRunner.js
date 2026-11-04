import { findNode, nextNodeId } from "../domain/definition.js";
import { settingsFor } from "../domain/guardrailSettings.js";
import { buildScope, resolveParams } from "../domain/templates.js";
import { PermanentError, TransientError } from "../shared/errors.js";
import { newId } from "../shared/ids.js";
import { logger } from "../shared/logger.js";

export const CONTINUE = { type: "continue" };
export const STOP = { type: "stop" };
export const LEASE_LOST = { type: "lease_lost" };
const waitUntil = (until) => ({ type: "wait", until });

// Postgres connection, shutdown and resource classes: the database is the problem, not the step.
const INFRASTRUCTURE_SQLSTATE = /^(08|53|57)/;
const INFRASTRUCTURE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE"]);

const tokenTotal = (tokens) => (tokens ? tokens.prompt + tokens.completion : 0);

function isInfrastructureFailure({ code, message }) {
  return (
    INFRASTRUCTURE_SQLSTATE.test(code ?? "") ||
    INFRASTRUCTURE_CODES.has(code) ||
    /connection terminated/i.test(message ?? "")
  );
}

export class StepRunner {
  #uow;
  #catalog;
  #executors;
  #guards;
  #retryPolicy;
  #afterExecute;

  constructor({ uow, catalog, executors, guards, retryPolicy, afterExecute = () => {} }) {
    this.#uow = uow;
    this.#catalog = catalog;
    this.#executors = executors;
    this.#guards = guards;
    this.#retryPolicy = retryPolicy;
    this.#afterExecute = afterExecute;
  }

  async advance(runId, workerId) {
    const { repos } = this.#uow;
    const run = await repos.runs.find(runId);
    if (!run || !(await this.#markRunning(run))) return STOP;

    const steps = await repos.steps.listForRun(runId);
    const openStep = steps.at(-1)?.status === "succeeded" ? undefined : steps.at(-1);
    const node = findNode(run.definitionSnapshot, openStep?.nodeId ?? run.currentNodeId);
    const settings = settingsFor(run.definitionSnapshot);
    const context = { run, node, workerId };

    const denial = await this.#guards.firstDenial({
      run,
      node,
      steps,
      settings,
      isNewStep: !openStep,
    });
    if (denial) return this.#applyDenial(context, denial);

    context.step = openStep ?? (await this.#beginStep(run, node));
    try {
      const scope = buildScope(run.input, steps);
      context.step = await this.#prepareAttempt(context, scope);
      const result = await this.#executors.forType(node.type).execute({
        run,
        node,
        scope,
        settings,
        step: context.step,
        params: context.step.resolvedInput,
      });
      this.#afterExecute(node);
      return await this.#applyResult(context, result);
    } catch (error) {
      return this.#handleFailure(context, settings, error);
    }
  }

  async #markRunning(run) {
    if (run.status === "running") return true;
    return (
      run.status === "queued" && this.#uow.repos.runs.transition(run.runId, "queued", "running")
    );
  }

  #commit({ run, workerId }, work) {
    return this.#uow.transaction(async (repos) => {
      if (workerId && !(await repos.queue.holdsLease(run.runId, workerId))) return LEASE_LOST;
      return work(repos);
    });
  }

  // Transaction A: the step and its idempotency key exist before anything external happens.
  #beginStep(run, node) {
    const sequence = run.stepsExecuted + 1;
    const hasSideEffect = this.#executors.forType(node.type).hasSideEffect(node.params);
    return this.#uow.transaction(async (repos) => {
      await repos.runs.countStepStarted(run.runId);
      return repos.steps.insert({
        runId: run.runId,
        sequence,
        nodeId: node.id,
        nodeType: node.type,
        idempotencyKey: hasSideEffect ? `${run.runId}:${node.id}:${sequence}` : null,
      });
    });
  }

  async #prepareAttempt({ run, node, step }, scope) {
    const { steps } = this.#uow.repos;
    let prepared = step;
    if (prepared.resolvedInput === null) {
      const resolved = resolveParams(node, this.#catalog.spec(node.type), scope);
      prepared = await steps.saveResolvedInput(run.runId, step.sequence, resolved);
    }
    const waitsInPlace = this.#executors.forType(node.type).waitsInPlace && prepared.attempt > 0;
    return waitsInPlace ? prepared : steps.startAttempt(run.runId, step.sequence);
  }

  #applyResult(context, result) {
    switch (result.kind) {
      case "completed":
        return this.#completeStep(context, result);
      case "suspended":
        return this.#suspendStep(context, result.until);
      case "awaiting_approval":
        return this.#pauseForApproval(context, context.step.sequence, result.message);
      default:
        throw new Error(`Unknown node result '${result.kind}'`);
    }
  }

  // Transaction B: until this commits, a crash re-sends the same idempotency key.
  #completeStep(context, { output, attempts, tokens, flags }) {
    const { run, node, step } = context;
    const next = nextNodeId(node, output);
    return this.#commit(context, async (repos) => {
      await repos.steps.finish(run.runId, step.sequence, {
        status: "succeeded",
        output,
        attempts,
        tokens,
        flags,
      });
      await repos.runs.addTokens(run.runId, tokenTotal(tokens));
      await repos.runs.setCurrentNode(run.runId, next);
      if (next) return CONTINUE;

      await repos.runs.transition(run.runId, "running", "succeeded");
      await repos.queue.removeForRun(run.runId);
      return STOP;
    });
  }

  #suspendStep(context, until) {
    const { run, step } = context;
    return this.#commit(context, async (repos) => {
      await repos.steps.suspend(run.runId, step.sequence, until);
      return waitUntil(until);
    });
  }

  // Locks the run so a cancel can't slip in between the check and the pause.
  #pauseForApproval(context, sequence, message) {
    const { run, node } = context;
    return this.#commit(context, async (repos) => {
      const { cancelRequested } = await repos.runs.lock(run.runId);
      if (cancelRequested) {
        return this.#endRun(repos, context, {
          status: "cancelled",
          code: "cancelled",
          message: "Cancelled by an operator",
        });
      }
      await repos.approvals.insert({
        id: newId("apr"),
        runId: run.runId,
        nodeId: node.id,
        sequence,
        message,
      });
      if (context.step) await repos.steps.markWaiting(run.runId, sequence);
      await repos.runs.transition(run.runId, "running", "waiting_approval");
      await repos.queue.removeForRun(run.runId);
      return STOP;
    });
  }

  #applyDenial(context, denial) {
    if (denial.status === "waiting_approval") {
      return this.#pauseForApproval(context, context.run.stepsExecuted + 1, denial.message);
    }
    return this.#commit(context, (repos) => this.#endRun(repos, context, denial));
  }

  async #handleFailure(context, settings, error) {
    if (error instanceof TransientError) return this.#retryOrFail(context, settings, error);
    if (error instanceof PermanentError) {
      return this.#failStep(context, error.code, error.message, error.trace);
    }
    if (isInfrastructureFailure(error)) throw error;

    // Anything else would fail the same way forever, so the run ends with the reason recorded.
    logger.error({ err: error, runId: context.run.runId }, "Step failed unexpectedly");
    return this.#failStep(context, "internal_error", error.message);
  }

  async #retryOrFail(context, settings, error) {
    const { run, node, step } = context;
    const { attempts = [], tokens } = error.trace;
    const failure = { at: new Date().toISOString(), outcome: "failed", error: error.message };
    const log = [...attempts, failure];
    const delayMs = this.#retryPolicy.nextDelayMs(step.attempt, settings.retry);
    if (delayMs === null) {
      const message = `'${node.id}' failed after ${step.attempt} attempts: ${error.message}`;
      return this.#failStep(context, "retries_exhausted", message, { attempts: log, tokens });
    }
    const until = new Date(Date.now() + delayMs);
    return this.#commit(context, async (repos) => {
      await repos.steps.suspend(run.runId, step.sequence, until, log);
      await repos.runs.addTokens(run.runId, tokenTotal(tokens));
      return waitUntil(until);
    });
  }

  #failStep(context, code, message, { attempts = [], tokens, flags } = {}) {
    const { run, node, step } = context;
    logger.warn({ runId: run.runId, nodeId: node.id, code }, "Run failed");
    const failure = { at: new Date().toISOString(), outcome: "failed", error: message };
    return this.#commit(context, async (repos) => {
      await repos.steps.finish(run.runId, step.sequence, {
        status: "failed",
        attempts: attempts.length > 0 ? attempts : [failure],
        tokens,
        flags,
      });
      await repos.runs.addTokens(run.runId, tokenTotal(tokens));
      await repos.runs.transition(run.runId, "running", "failed", {
        code,
        message,
        nodeId: node.id,
      });
      await repos.queue.removeForRun(run.runId);
      return STOP;
    });
  }

  async #endRun(repos, { run, node }, { status, code, message }) {
    await repos.steps.cancelOpen(run.runId);
    await repos.runs.transition(run.runId, "running", status, { code, message, nodeId: node.id });
    await repos.queue.removeForRun(run.runId);
    return STOP;
  }
}
