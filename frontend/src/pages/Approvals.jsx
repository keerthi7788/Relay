import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { relay } from "../api/relay.js";
import {
  Banner,
  Button,
  Card,
  CodeBlock,
  ConfirmDialog,
  EmptyState,
  LoadError,
  PageHeading,
  Skeleton,
  Table,
  Tag,
} from "../components/ui.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { actionsAfter } from "../lib/definition.js";
import { timeAgo } from "../lib/format.js";

const REFRESH_MS = 5000;
const loadPending = () => relay.listApprovals({ status: "pending", limit: 200 });

async function loadDecided() {
  const [approved, rejected] = await Promise.all([
    relay.listApprovals({ status: "approved", limit: 50 }),
    relay.listApprovals({ status: "rejected", limit: 50 }),
  ]);
  return [...approved, ...rejected].sort((a, b) => new Date(b.decided_at) - new Date(a.decided_at));
}

function QueueItem({ approval, selected, onSelect }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-11 w-full flex-col items-start gap-1 rounded-lg border px-3.5 py-3 text-left ${
        selected ? "border-accent bg-accent-soft" : "border-line bg-white hover:border-control"
      }`}
    >
      <span className="line-clamp-2 text-sm font-semibold">{approval.message}</span>
      <span className="text-xs text-muted">
        {approval.workflow_id}, {timeAgo(approval.created_at)}
      </span>
      {approval.injection_flagged && <Tag tone="warn">Possible attack</Tag>}
    </button>
  );
}

function Decision({ approval, onDecided }) {
  const load = useCallback(() => relay.getRun(approval.run_id), [approval.run_id]);
  const { data: run } = usePolling(load);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  const actions = run
    ? actionsAfter(run.definition_snapshot, approval.node_id, approval.input)
    : [];

  const decide = async (decision) => {
    setError(null);
    try {
      await relay[decision](approval.id);
      onDecided(
        decision === "approve"
          ? "Approved. The run is continuing."
          : "Rejected. The run has ended.",
      );
    } catch (failure) {
      if (failure.status === 409) onDecided("This was already decided. The list has been updated.");
      else setError(failure.message);
    }
    setConfirming(false);
  };

  return (
    <Card>
      {approval.injection_flagged && (
        <Banner>This message looks like an attack. Read it carefully before you decide.</Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Decision needed</h2>
        <span className="text-[13px] text-muted">
          {approval.workflow_id} · requested {timeAgo(approval.created_at).toLowerCase()} ·{" "}
          <Link to={`/runs/${approval.run_id}`} className="text-accent">
            View run
          </Link>
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Request</span>
          <Tag tone="info">May include AI-generated text</Tag>
        </div>
        <p className="text-sm">{approval.message}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold">Original input (untrusted)</span>
        <CodeBlock>{approval.input}</CodeBlock>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold">If you approve</span>
        {actions.length > 0 ? (
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-sm">
            {actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            {run ? "The run continues with no further actions." : "Loading..."}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line pt-3.5">
        <Button kind="danger" onClick={() => decide("reject")}>
          Reject
        </Button>
        <Button kind="primary" onClick={() => setConfirming(true)}>
          Approve
        </Button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Approve this request?"
          text={
            actions.length > 0
              ? `${actions.join(". ")}. This can't be undone.`
              : "The run will continue."
          }
          confirmLabel="Approve"
          cancelLabel="Keep waiting"
          onCancel={() => setConfirming(false)}
          onConfirm={() => decide("approve")}
        />
      )}
    </Card>
  );
}

function Pending({ notice, setNotice }) {
  const { data: approvals, error, loading, refresh } = usePolling(loadPending, REFRESH_MS);
  const [params, setParams] = useSearchParams();
  const requested = params.get("approval");
  const selected = approvals?.find(({ id }) => id === requested) ?? approvals?.[0];

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  return (
    <>
      <LoadError error={error} />
      {notice && <Banner tone="good">{notice}</Banner>}
      {loading && <Skeleton />}
      {approvals?.length === 0 && (
        <EmptyState title="You're all caught up" text="Nothing needs a decision right now." />
      )}
      {approvals?.length > 0 && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)]">
          <div className="flex flex-col gap-2">
            {approvals.map((approval) => (
              <QueueItem
                key={approval.id}
                approval={approval}
                selected={approval.id === selected?.id}
                onSelect={() => setParams({ approval: approval.id })}
              />
            ))}
          </div>
          {selected && (
            <Decision
              key={selected.id}
              approval={selected}
              onDecided={(message) => {
                setNotice(message);
                setParams({});
                refresh();
              }}
            />
          )}
        </div>
      )}
    </>
  );
}

function Decided() {
  const { data: approvals, error, loading } = usePolling(loadDecided, REFRESH_MS);
  return (
    <>
      <LoadError error={error} />
      {loading && <Skeleton />}
      {approvals?.length === 0 && (
        <EmptyState title="No decisions yet" text="Decisions will be listed here." />
      )}
      {approvals?.length > 0 && (
        <Table headers={["Request", "Decision", "By", "When"]}>
          {approvals.map((approval) => (
            <tr key={approval.id}>
              <td className="max-w-md">
                <Link
                  to={`/runs/${approval.run_id}`}
                  className="text-accent no-underline hover:underline"
                >
                  {approval.message}
                </Link>
              </td>
              <td>{approval.status === "approved" ? "Approved" : "Rejected"}</td>
              <td>{approval.decided_by}</td>
              <td className="whitespace-nowrap">{timeAgo(approval.decided_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

const tabClass = (on) =>
  `min-h-10 border-b-2 px-0.5 py-2.5 text-sm ${on ? "border-accent font-semibold text-accent" : "border-transparent text-muted"}`;

export function Approvals() {
  const [tab, setTab] = useState("pending");
  const [notice, setNotice] = useState(null);

  return (
    <>
      <PageHeading
        title="Approvals"
        subtitle="Sensitive actions wait here until a person decides."
      />
      <div className="flex gap-6 border-b border-line">
        <button
          type="button"
          aria-pressed={tab === "pending"}
          className={tabClass(tab === "pending")}
          onClick={() => setTab("pending")}
        >
          Waiting
        </button>
        <button
          type="button"
          aria-pressed={tab === "decided"}
          className={tabClass(tab === "decided")}
          onClick={() => setTab("decided")}
        >
          Decided
        </button>
      </div>
      {tab === "pending" ? <Pending notice={notice} setNotice={setNotice} /> : <Decided />}
    </>
  );
}
