import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { relay } from "../../api/relay.js";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Field,
  Select,
  TextArea,
} from "../../components/ui.jsx";

const API_URL = import.meta.env.VITE_PUBLIC_API_URL ?? "http://localhost:8080";
const CHOICES = [
  { type: "webhook", label: "Webhook" },
  { type: "schedule", label: "Schedule" },
  { type: "manual", label: "Manual only" },
];

function WebhookSettings({ workflowId, trigger, onChange, onReplaceSecret, busy }) {
  const url = `${API_URL}/hooks/${workflowId}`;
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <Card title="Webhook">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            label="Webhook URL"
            id="hook-url"
            readOnly
            value={url}
            className="w-full rounded-md border border-control bg-ground px-3 py-2 font-mono text-[13px] min-h-[38px]"
          />
        </div>
        <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
      </div>
      <Checkbox
        label="Accept webhook calls"
        checked={trigger.enabled !== false}
        onChange={(event) => onChange({ ...trigger, enabled: event.target.checked })}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5">
        <div className="flex flex-col gap-0.5">
          <strong className="text-sm font-semibold">Secret</strong>
          <span className="text-[13px] text-muted">
            Callers send it as X-Relay-Secret. We only keep a hash, so it can&#39;t be shown again.
          </span>
        </div>
        <Button kind="danger" disabled={busy} onClick={() => setConfirming(true)}>
          Replace secret
        </Button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Replace this secret?"
          text="The current secret stops working straight away, so callers will need the new one."
          confirmLabel="Replace secret"
          cancelLabel="Keep current secret"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await onReplaceSecret();
            setConfirming(false);
          }}
        />
      )}
    </Card>
  );
}

function ScheduleSettings({ trigger, onChange }) {
  const [inputText, setInputText] = useState(() => JSON.stringify(trigger.input ?? {}, null, 2));
  const [inputError, setInputError] = useState(null);

  const updateInput = (text) => {
    setInputText(text);
    try {
      onChange({ ...trigger, input: JSON.parse(text) });
      setInputError(null);
    } catch {
      setInputError("This isn't valid JSON yet.");
    }
  };

  return (
    <Card title="Schedule">
      <Field
        label="Cron expression"
        id="cron"
        value={trigger.cron ?? ""}
        placeholder="0 9 * * 1-5"
        hint="5 fields, in UTC. For example, 0 9 * * 1-5 is 09:00 on weekdays."
        onChange={(event) => onChange({ ...trigger, cron: event.target.value })}
      />
      <TextArea
        label="Input"
        id="cron-input"
        value={inputText}
        error={inputError}
        onChange={(event) => updateInput(event.target.value)}
      />
      <Checkbox
        label="Schedule is on"
        checked={trigger.enabled !== false}
        onChange={(event) => onChange({ ...trigger, enabled: event.target.checked })}
      />
    </Card>
  );
}

function TryIt({ workflow, dirty }) {
  const navigate = useNavigate();
  const [samples, setSamples] = useState([]);
  const [input, setInput] = useState("{}");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    relay.samplePayloads(workflow.id).then((loaded) => {
      if (!active) return;
      setSamples(loaded);
      if (loaded[0]) setInput(JSON.stringify(loaded[0].body, null, 2));
    });
    return () => {
      active = false;
    };
  }, [workflow.id]);

  const run = async () => {
    setError(null);
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      setError("The input isn't valid JSON.");
      return;
    }
    setBusy(true);
    try {
      const { run_id: runId } = await relay.triggerRun(workflow.id, parsed);
      navigate(`/runs/${runId}`);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  };

  const published = Boolean(workflow.published_definition);

  return (
    <Card
      title="Try it"
      action={<span className="text-xs text-muted">Runs the published version</span>}
    >
      {samples.length > 0 && (
        <Select
          label="Example"
          id="sample"
          options={samples.map(({ id, note }) => ({
            value: id,
            label: `${id}: ${note.split(" - ")[0]}`,
          }))}
          onChange={(event) => {
            const sample = samples.find(({ id }) => id === event.target.value);
            setInput(JSON.stringify(sample.body, null, 2));
          }}
        />
      )}
      <TextArea
        label="Input"
        id="run-input"
        rows={8}
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {!published && <Banner>Publish this workflow before running it.</Banner>}
      {published && dirty && (
        <Banner>You have unsaved changes. This run uses the published version.</Banner>
      )}
      <div>
        <Button kind="primary" onClick={run} disabled={busy || !published}>
          Run now
        </Button>
      </div>
    </Card>
  );
}

export function TriggerTab() {
  const { workflow, draft, setDraft, dirty, replaceSecret, busy } = useOutletContext();
  const trigger = draft.trigger ?? { type: "manual" };
  const setTrigger = (next) => setDraft({ ...draft, trigger: next });

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span id="trigger-label" className="text-[13px] font-semibold">
          How does this workflow start?
        </span>
        <div
          role="group"
          aria-labelledby="trigger-label"
          className="flex max-w-[480px] flex-wrap overflow-hidden rounded-md border border-control"
        >
          {CHOICES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              aria-pressed={trigger.type === type}
              onClick={() => setTrigger({ type })}
              className={`min-h-10 flex-[1_1_120px] border-r border-line px-3.5 py-2 text-sm font-semibold last:border-r-0 ${
                trigger.type === type ? "bg-accent text-white" : "bg-white text-ink hover:bg-ground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {trigger.type === "webhook" && (
          <WebhookSettings
            workflowId={workflow.id}
            trigger={trigger}
            onChange={setTrigger}
            onReplaceSecret={replaceSecret}
            busy={busy}
          />
        )}
        {trigger.type === "schedule" && (
          <ScheduleSettings trigger={trigger} onChange={setTrigger} />
        )}
        {trigger.type === "manual" && (
          <Card title="Manual">
            <p className="text-sm text-muted">
              This workflow only runs when someone starts it from here or through the API.
            </p>
          </Card>
        )}
        <TryIt workflow={workflow} dirty={dirty} />
      </div>
    </>
  );
}
