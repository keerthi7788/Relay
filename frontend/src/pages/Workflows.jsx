import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { relay } from "../api/relay.js";
import {
  Button,
  EmptyState,
  LoadError,
  Mono,
  PageHeading,
  Skeleton,
  StatusPill,
  Table,
  Tag,
} from "../components/ui.jsx";
import { usePolling } from "../hooks/usePolling.js";
import { timeAgo } from "../lib/format.js";

const REFRESH_MS = 5000;
const TRIGGERS = { webhook: "Webhook", schedule: "Schedule", manual: "Manual" };
const PAGE_SIZE = 20;

export function Workflows() {
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => relay.listWorkflows({ limit: PAGE_SIZE, offset }), [offset]);
  const { data: workflows, error, loading } = usePolling(load, REFRESH_MS);

  return (
    <>
      <PageHeading
        title="Workflows"
        subtitle="Automated processes your team runs."
        action={
          <Button kind="primary" to="/workflows/new">
            New workflow
          </Button>
        }
      />
      <LoadError error={error} />
      {loading && <Skeleton />}
      {workflows?.length === 0 && (
        <EmptyState
          title="Create your first workflow"
          text="Build one from steps, then publish it."
          action={
            <Button kind="primary" to="/workflows/new">
              New workflow
            </Button>
          }
        />
      )}
      {workflows?.length > 0 && (
        <Table headers={["Name", "Status", "Starts by", "Latest run", "When"]}>
          {workflows.map((workflow) => (
            <tr key={workflow.id}>
              <td>
                <div className="flex flex-col gap-0.5">
                  <Link
                    to={`/workflows/${workflow.id}`}
                    className="text-sm font-semibold text-accent no-underline hover:underline"
                  >
                    {workflow.name}
                  </Link>
                  <Mono>{workflow.id}</Mono>
                </div>
              </td>
              <td>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusPill status={workflow.status} />
                  {workflow.has_unpublished_changes && <Tag tone="warn">Unpublished changes</Tag>}
                </div>
              </td>
              <td>{TRIGGERS[workflow.trigger_type] ?? "-"}</td>
              <td>
                {workflow.latest_run ? (
                  <Link to={`/runs/${workflow.latest_run.run_id}`} className="no-underline">
                    <StatusPill status={workflow.latest_run.status} />
                  </Link>
                ) : (
                  <span className="text-muted">Not run yet</span>
                )}
              </td>
              <td className="whitespace-nowrap">{timeAgo(workflow.latest_run?.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
      <div className="flex justify-end gap-2">
        <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </Button>
        <Button
          disabled={(workflows?.length ?? 0) < PAGE_SIZE}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
