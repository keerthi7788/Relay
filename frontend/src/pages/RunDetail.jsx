import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { relay } from "../api/relay.js";
import {
  Banner,
  Button,
  Card,
  CodeBlock,
  ConfirmDialog,
  LoadError,
  Mono,
  Skeleton,
  StatusPill,
  Tag,
} from "../components/ui.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { KIND_LABELS, notReachedSteps, stepTitle } from "../lib/definition.js";
import { duration, failureText, timeAgo } from "../lib/format.js";

const REFRESH_MS = 2000;
const FINISHED = ["succeeded", "failed", "cancelled"];

const DOT = {
  succeeded: "border-good bg-good-soft",
  running: "border-info bg-info-soft",
  waiting: "border-warn bg-warn-soft",
  failed: "border-danger bg-danger-soft",
  cancelled: "border-muted bg-[#d5dad8]",
  pending: "border-control bg-[#eef1ef]",
};

function stepMeta(step) {
  const parts = [];
  if (step.attempt > 1) parts.push(`${step.attempt} tries`);
  const time = duration(step.duration_ms);
  if (time) parts.push(time);
  if (step.tokens) parts.push(`${step.tokens.prompt + step.tokens.completion} tokens`);
  if (step.status === "waiting") parts.push("Waiting");
  return parts.join(" · ");
}

function BranchResult({ step, node }) {
  const taken = step.output?.result ? node?.on_true : node?.on_false;
  return (
    <p className="text-[13px] text-muted">
      {step.input?.left} {step.input?.op?.replace("_", " ")} {step.input?.right}:{" "}
      <strong className="font-semibold">{step.output?.result ? "Yes" : "No"}</strong>
      {taken ? `, went to ${stepTitle(taken)}` : ", the run ended"}
    </p>
  );
}

function StepDetail({ step }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid gap-3.5 lg:grid-cols-2">
        {step.input && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold">Input</span>
            <CodeBlock>{step.type === "ai" ? step.input.prompt : step.input}</CodeBlock>
          </div>
        )}
        {step.output && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold">Output</span>
              {step.type === "ai" && <Tag tone="info">AI-generated</Tag>}
            </div>
            <CodeBlock>{step.output}</CodeBlock>
          </div>
        )}
      </div>
      {step.guardrail_flags?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold">Guardrails</span>
          {step.guardrail_flags.map(({ type, detail }) => (
            <Tag key={`${type}${detail}`} tone="warn">
              {type === "redacted" ? `Redacted: ${detail}` : `Suspicious: ${detail}`}
            </Tag>
          ))}
        </div>
      )}
      {step.attempts?.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold">Tries</span>
          <ol className="flex flex-col gap-1 text-xs text-muted">
            {step.attempts.map((attempt, index) => (
              <li key={`${attempt.at}${index}`} className="break-words">
                {index + 1}. {attempt.outcome === "succeeded" ? "Succeeded" : "Failed"}
                {attempt.replayed && " (already done, so the outside service replayed its answer)"}
                {attempt.error && `: ${attempt.error}`}
              </li>
            ))}
          </ol>
        </div>
      )}
      {step.idempotency_key && (
        <div className="text-xs text-muted">
          Idempotency key: <Mono>{step.idempotency_key}</Mono>
        </div>
      )}
    </div>
  );
}

function TimelineItem({ dot, title, meta, last, children, onToggle, open }) {
  return (
    <li className="flex gap-3.5">
      <div className="flex flex-col items-center gap-1">
        <span
          aria-hidden="true"
          className={`mt-1 size-3.5 flex-none rounded-full border-2 ${DOT[dot]}`}
        />
        {!last && <span className="min-h-3 w-0.5 flex-1 bg-line" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {onToggle ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={onToggle}
              className="flex min-h-7 items-center gap-1.5 text-left text-sm font-semibold hover:underline"
            >
              <span aria-hidden="true" className="text-muted">
                {open ? "▾" : "▸"}
              </span>
              {title}
            </button>
          ) : (
            <span className="min-h-7 text-sm font-semibold text-muted">{title}</span>
          )}
          <span className="text-xs text-muted">{meta}</span>
        </div>
        {children}
      </div>
    </li>
  );
}

export function RunDetail() {
  const { id } = useParams();
  const load = useCallback(() => relay.getRun(id), [id]);
  const [finished, setFinished] = useState(false);
  const {
    data: run,
    error,
    loading,
    refresh,
  } = usePolling(load, REFRESH_MS, { enabled: !finished });
  const [open, setOpen] = useState({ 1: true });
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (run && FINISHED.includes(run.status) && !finished) setFinished(true);

  if (loading) return <Skeleton />;
  if (!run) return <LoadError error={error} />;

  const definition = run.definition_snapshot;
  const nodeFor = (nodeId) => definition.nodes.find((node) => node.id === nodeId);
  const remaining = notReachedSteps(definition, run);
  const canCancel = !FINISHED.includes(run.status);
  const pendingApproval = run.approvals?.find(({ status }) => status === "pending");

  const cancel = async () => {
    try {
      await relay.cancelRun(run.run_id);
      await refresh();
    } catch (failure) {
      setActionError(failure.message);
    }
    setConfirmCancel(false);
  };

  return (
    <>
      <Link to="/runs" className="text-[13px] text-accent">
        Runs
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold">{run.workflow_name}</h1>
            <StatusPill status={run.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <Mono>{run.run_id}</Mono>
            <span>
              Started by {run.trigger_type}, {timeAgo(run.created_at)} · {run.steps_executed} of{" "}
              {run.max_steps} steps
              {run.ai_tokens_used > 0 && ` · ${run.ai_tokens_used} tokens`}
            </span>
          </div>
        </div>
        {canCancel && (
          <Button kind="danger" onClick={() => setConfirmCancel(true)}>
            Cancel run
          </Button>
        )}
      </div>

      <LoadError error={error} />
      {actionError && <Banner tone="error">{actionError}</Banner>}
      {pendingApproval && (
        <Banner
          action={
            <Button kind="primary" to={`/approvals?approval=${pendingApproval.id}`}>
              Review approval
            </Button>
          }
        >
          This run is waiting for a decision. No action after this point has happened.
        </Banner>
      )}
      {run.injection_flagged && (
        <Banner>This input looks like a prompt injection attack. Engine rules still apply.</Banner>
      )}
      {run.status === "failed" && <Banner tone="error">{failureText(run.error)}</Banner>}
      {run.status === "cancelled" && (
        <Banner>{run.error?.message ?? "This run was cancelled."}</Banner>
      )}
      {run.status === "succeeded" && <Banner tone="good">This run finished successfully.</Banner>}

      <Card title="Steps">
        {run.steps.length === 0 && remaining.length === 0 && (
          <p className="text-sm text-muted">Waiting for a worker to pick this up.</p>
        )}
        <ol>
          {run.steps.map((step, index) => {
            const isLast = index === run.steps.length - 1 && remaining.length === 0;
            const isOpen = Boolean(open[step.sequence]);
            return (
              <TimelineItem
                key={step.sequence}
                dot={step.status}
                title={`${stepTitle(step.node_id)} (${KIND_LABELS[step.type] ?? step.type})`}
                meta={stepMeta(step)}
                last={isLast}
                open={isOpen}
                onToggle={() => setOpen({ ...open, [step.sequence]: !isOpen })}
              >
                {step.type === "condition" && step.output && (
                  <BranchResult step={step} node={nodeFor(step.node_id)} />
                )}
                {isOpen && <StepDetail step={step} />}
              </TimelineItem>
            );
          })}
          {remaining.map((nodeId, index) => (
            <TimelineItem
              key={nodeId}
              dot="pending"
              title={stepTitle(nodeId)}
              meta="Not reached"
              last={index === remaining.length - 1}
            />
          ))}
        </ol>
      </Card>

      <details className="rounded-lg border border-line bg-white px-5 py-3.5">
        <summary className="min-h-7 cursor-pointer text-[15px] font-semibold">
          Original input
        </summary>
        <div className="pt-3.5">
          <CodeBlock>{run.input}</CodeBlock>
        </div>
      </details>

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel this run?"
          text="The current step will finish, and nothing after it will run."
          confirmLabel="Cancel run"
          cancelLabel="Keep running"
          danger
          onCancel={() => setConfirmCancel(false)}
          onConfirm={cancel}
        />
      )}
    </>
  );
}
