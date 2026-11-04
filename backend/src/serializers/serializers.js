import { isDeepStrictEqual } from "node:util";

const INJECTION_FLAG = "injection_suspected";
const SENSITIVE_HEADER = /authorization|cookie|token|secret|api-?key|password/i;
const MASK = "********";

const maskHeaders = (headers) =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER.test(name) ? MASK : value,
    ]),
  );

const maskParams = (params) =>
  params?.headers ? { ...params, headers: maskHeaders(params.headers) } : params;

const maskSnapshot = (definition) => ({
  ...definition,
  nodes: definition.nodes.map((node) => ({ ...node, params: maskParams(node.params) })),
});

const isInjectionFlagged = (steps) =>
  steps.some((step) => step.guardrailFlags.some((flag) => flag.type === INJECTION_FLAG));

const serializeError = (error) =>
  error && { code: error.code, message: error.message, node_id: error.nodeId };

export function serializeWorkflowSummary(workflow) {
  const live = workflow.publishedDefinition ?? workflow.draftDefinition;
  return {
    id: workflow.id,
    name: live.name ?? workflow.id,
    description: live.description ?? null,
    status: workflow.status,
    trigger_type: live.trigger?.type,
    has_unpublished_changes:
      workflow.status === "published" &&
      !isDeepStrictEqual(workflow.draftDefinition, workflow.publishedDefinition),
    updated_at: workflow.updatedAt,
    latest_run: workflow.latestRun
      ? {
          run_id: workflow.latestRun.runId,
          status: workflow.latestRun.status,
          created_at: workflow.latestRun.createdAt,
        }
      : null,
  };
}

export function serializeWorkflow(workflow) {
  return {
    ...serializeWorkflowSummary(workflow),
    definition: workflow.draftDefinition,
    published_definition: workflow.publishedDefinition,
  };
}

export function serializeRunSummary(run) {
  return {
    run_id: run.runId,
    id: run.runId,
    workflow_id: run.workflowId,
    workflow_name: run.definitionSnapshot.name,
    status: run.status,
    trigger_type: run.triggerType,
    steps_executed: run.stepsExecuted,
    max_steps: run.definitionSnapshot.limits.max_steps,
    ai_tokens_used: run.aiTokensUsed,
    error: serializeError(run.error),
    created_at: run.createdAt,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
  };
}

function serializeStep(step, approvals) {
  const approval = approvals.find(
    ({ nodeId, sequence }) => nodeId === step.nodeId && sequence === step.sequence,
  );
  return {
    sequence: step.sequence,
    node_id: step.nodeId,
    type: step.nodeType,
    status: step.status,
    attempt: step.attempt,
    input: maskParams(step.resolvedInput),
    output: step.output,
    attempts: step.attemptsLog,
    tokens:
      step.tokensPrompt === null
        ? null
        : { prompt: step.tokensPrompt, completion: step.tokensCompletion },
    guardrail_flags: step.guardrailFlags,
    idempotency_key: step.idempotencyKey,
    resume_at: step.resumeAt,
    started_at: step.startedAt,
    duration_ms: step.durationMs,
    approval_id: approval?.id,
  };
}

export function serializeRun({ run, steps, approvals }) {
  return {
    ...serializeRunSummary(run),
    input: run.input,
    definition_snapshot: maskSnapshot(run.definitionSnapshot),
    current_node_id: run.currentNodeId,
    injection_flagged: isInjectionFlagged(steps),
    approvals: approvals.map(serializeApproval),
    steps: steps.map((step) => serializeStep(step, approvals)),
  };
}

export function serializeApproval(approval) {
  return {
    id: approval.id,
    run_id: approval.runId,
    node_id: approval.nodeId,
    message: approval.message,
    status: approval.status,
    decided_by: approval.decidedBy,
    decided_at: approval.decidedAt,
    created_at: approval.createdAt,
  };
}

export function serializeApprovalWithContext({ approval, run, steps }) {
  return {
    ...serializeApproval(approval),
    workflow_id: run.workflowId,
    input: run.input,
    injection_flagged: isInjectionFlagged(steps),
  };
}
