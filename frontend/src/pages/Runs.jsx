import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { relay } from "../api/relay.js";
import {
  Button,
  EmptyState,
  LoadError,
  PageHeading,
  Select,
  Skeleton,
  StatusPill,
  Table,
} from "../components/ui.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { failureText, timeAgo } from "../lib/format.js";

const PAGE_SIZE = 20;
const REFRESH_MS = 5000;
const STATUSES = [
  { value: "", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "waiting_approval", label: "Waiting approval" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

const loadWorkflows = () => relay.listWorkflows({ limit: 200 });

export function Runs() {
  const [workflowId, setWorkflowId] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    () => relay.listRuns({ workflowId, status, limit: PAGE_SIZE, offset }),
    [workflowId, status, offset],
  );
  const { data: runs, error, loading } = usePolling(load, REFRESH_MS);
  const { data: workflows } = usePolling(loadWorkflows);

  const filtering = Boolean(workflowId || status);
  const clearFilters = () => {
    setWorkflowId("");
    setStatus("");
    setOffset(0);
  };

  return (
    <>
      <PageHeading title="Runs" subtitle="Every time a workflow has started." />
      <div className="flex flex-wrap gap-3">
        <div className="w-60">
          <Select
            label="Workflow"
            id="filter-workflow"
            value={workflowId}
            options={[
              { value: "", label: "All workflows" },
              ...(workflows ?? []).map(({ id, name }) => ({ value: id, label: name })),
            ]}
            onChange={(event) => {
              setWorkflowId(event.target.value);
              setOffset(0);
            }}
          />
        </div>
        <div className="w-52">
          <Select
            label="Status"
            id="filter-status"
            value={status}
            options={STATUSES}
            onChange={(event) => {
              setStatus(event.target.value);
              setOffset(0);
            }}
          />
        </div>
      </div>
      <LoadError error={error} />
      {loading && <Skeleton />}
      {runs?.length === 0 && (
        <EmptyState
          title={filtering ? "No runs found" : "No runs yet"}
          text={filtering ? "Try another workflow or status." : "Start a workflow to see it here."}
          action={filtering && <Button onClick={clearFilters}>Clear filters</Button>}
        />
      )}
      {runs?.length > 0 && (
        <Table headers={["Run", "Workflow", "Status", "Steps", "Started"]}>
          {runs.map((run) => (
            <tr key={run.run_id}>
              <td>
                <Link to={`/runs/${run.run_id}`} className="font-mono text-xs text-accent">
                  {run.run_id}
                </Link>
              </td>
              <td>{run.workflow_name}</td>
              <td>
                <div className="flex flex-col items-start gap-1">
                  <StatusPill status={run.status} />
                  {run.error && (
                    <span className="text-xs text-muted">{failureText(run.error)}</span>
                  )}
                </div>
              </td>
              <td className="whitespace-nowrap">
                {run.steps_executed} of {run.max_steps}
              </td>
              <td className="whitespace-nowrap">{timeAgo(run.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
      <div className="flex justify-end gap-2">
        <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </Button>
        <Button
          disabled={(runs?.length ?? 0) < PAGE_SIZE}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
