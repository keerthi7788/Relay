import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { relay } from "../../api/relay.js";
import {
  Banner,
  Button,
  LoadError,
  SecretDialog,
  Skeleton,
  StatusPill,
  Tag,
} from "../../components/ui.jsx";
import { stepTitle } from "../../lib/definition.js";

const SETTINGS_KEYS = ["limits", "guardrails"];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function withoutKeys(definition, keys) {
  return Object.fromEntries(Object.entries(definition).filter(([key]) => !keys.includes(key)));
}

// A PUT replaces the whole definition, so it carries the saved settings. Changed settings then go
// through their own routes, where the server checks them straight away.
async function saveChanges(id, saved, draft) {
  const separate = [...SETTINGS_KEYS, "trigger"];
  const stepsChanged = !same(withoutKeys(saved, separate), withoutKeys(draft, separate));
  const settingsChanged = SETTINGS_KEYS.some((key) => !same(saved[key], draft[key]));
  let result = null;

  if (stepsChanged) {
    const { limits, guardrails, trigger } = saved;
    const definition = { ...withoutKeys(draft, separate), limits, trigger };
    result = await relay.updateWorkflow(
      id,
      guardrails ? { ...definition, guardrails } : definition,
    );
  }
  if (settingsChanged) {
    result = await relay.updateGuardrails(id, {
      limits: draft.limits,
      guardrails: draft.guardrails,
    });
  }
  if (!same(saved.trigger, draft.trigger)) result = await relay.updateTrigger(id, draft.trigger);
  return result;
}

const tabClass = ({ isActive }) =>
  `border-b-2 px-0.5 py-2.5 text-sm no-underline ${
    isActive ? "border-accent font-semibold text-accent" : "border-transparent text-muted"
  }`;

export function WorkflowLayout() {
  const { id } = useParams();
  const [workflow, setWorkflow] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [message, setMessage] = useState(null);
  const [problems, setProblems] = useState([]);
  const [secret, setSecret] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedStep, setSelectedStep] = useState(null);

  useEffect(() => {
    let active = true;
    relay
      .getWorkflow(id)
      .then((loaded) => {
        if (!active) return;
        setWorkflow(loaded);
        setDraft(loaded.definition);
      })
      .catch((error) => active && setLoadError(error));
    return () => {
      active = false;
    };
  }, [id]);

  const dirty = useMemo(
    () => draft && workflow && !same(draft, workflow.definition),
    [draft, workflow],
  );

  const save = useCallback(async () => {
    if (!dirty) return workflow;
    const result = await saveChanges(id, workflow.definition, draft);
    const saved = result ? { ...workflow, ...result } : workflow;
    if (result?.webhook_secret) setSecret(result.webhook_secret);
    setWorkflow(saved);
    setDraft(saved.definition);
    return saved;
  }, [dirty, draft, id, workflow]);

  const run = async (action) => {
    setBusy(true);
    setMessage(null);
    setProblems([]);
    try {
      await action();
    } catch (error) {
      if (error.details?.length) setProblems(error.details);
      else setMessage({ tone: "error", text: error.message });
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    run(async () => {
      await save();
      setMessage({ tone: "good", text: "Draft saved." });
    });

  const publish = () =>
    run(async () => {
      await save();
      const published = await relay.publishWorkflow(id);
      setWorkflow(published);
      setDraft(published.definition);
      const warning = published.warnings?.[0]?.message;
      setMessage(
        warning
          ? { tone: "warn", text: `Published, with a warning: ${warning}` }
          : { tone: "good", text: "Published. New runs use this version." },
      );
    });

  const replaceSecret = () =>
    run(async () => {
      const { webhook_secret: created } = await relay.rotateSecret(id);
      setSecret(created);
    });

  if (loadError) return <LoadError error={loadError} />;
  if (!workflow || !draft) return <Skeleton />;

  const context = {
    workflow,
    draft,
    setDraft,
    dirty,
    selectedStep,
    setSelectedStep,
    replaceSecret,
    busy,
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Link to="/workflows" className="text-[13px] text-accent">
            Workflows
          </Link>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold">{draft.name ?? workflow.name}</h1>
            <StatusPill status={workflow.status} />
            {(dirty || workflow.has_unpublished_changes) && (
              <Tag tone="warn">Unpublished changes</Tag>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveDraft} disabled={busy || !dirty}>
            Save draft
          </Button>
          <Button kind="primary" onClick={publish} disabled={busy}>
            Publish
          </Button>
        </div>
      </div>

      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      {problems.length > 0 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg bg-danger-soft p-3.5 text-[13px] text-[#7c1612]"
        >
          <strong className="font-semibold">
            Fix {problems.length} {problems.length === 1 ? "problem" : "problems"} before publishing
          </strong>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {problems.map((problem) => (
              <li key={`${problem.code}${problem.message}`}>
                {problem.node_id && (
                  <button
                    type="button"
                    className="mr-1 font-semibold underline"
                    onClick={() => setSelectedStep(problem.node_id)}
                  >
                    {stepTitle(problem.node_id)}:
                  </button>
                )}
                {problem.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-6 border-b border-line">
        <NavLink end to={`/workflows/${id}`} className={tabClass}>
          Steps
        </NavLink>
        <NavLink to={`/workflows/${id}/trigger`} className={tabClass}>
          Trigger
        </NavLink>
        <NavLink to={`/workflows/${id}/guardrails`} className={tabClass}>
          Guardrails
        </NavLink>
      </div>

      <Outlet context={context} />

      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </>
  );
}
