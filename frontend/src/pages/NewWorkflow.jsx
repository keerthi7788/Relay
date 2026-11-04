import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { relay } from "../api/relay.js";
import { Banner, Button, Card, Field, PageHeading } from "../components/ui.jsx";

const DEFAULT_MAX_STEPS = 50;

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export function NewWorkflow() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const id = `wf_${slugify(name)}`;

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await relay.createWorkflow({
        id,
        name: name.trim(),
        trigger: { type: "manual" },
        entry: "",
        limits: { max_steps: DEFAULT_MAX_STEPS },
        nodes: [],
      });
      navigate(`/workflows/${id}`);
    } catch (failure) {
      setError(
        failure.code === "workflow_exists"
          ? "A workflow with this name already exists."
          : failure.message,
      );
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Link to="/workflows" className="text-[13px] text-accent">
          Workflows
        </Link>
        <PageHeading title="New workflow" />
      </div>
      <div className="max-w-xl">
        <Card>
          <form onSubmit={create} className="flex flex-col gap-4">
            {error && <Banner tone="error">{error}</Banner>}
            <Field
              label="Name"
              id="workflow-name"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              hint={name.trim() ? `ID: ${id}` : "You'll add steps next."}
            />
            <div>
              <Button kind="primary" type="submit" disabled={busy || !slugify(name)}>
                Create workflow
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
