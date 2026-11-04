import { useOutletContext } from "react-router-dom";
import { Card, Checkbox, Field, Select } from "../../components/ui.jsx";

const ATTACK_OPTIONS = [
  { value: "off", label: "Do nothing" },
  { value: "flag", label: "Flag it for the approver" },
  { value: "require_approval", label: "Always ask for approval" },
];

const ALWAYS_ON = [
  "Refunds need an approval",
  "Every run has a step limit",
  "Actions never run twice",
  "Outside calls time out",
  "Webhook secret is checked",
  "AI answers are checked",
];

const toNumber = (value) => (value === "" ? undefined : Number(value));

function NumberField({ label, id, value, placeholder, min, max, hint, onChange }) {
  const outOfRange = value !== undefined && (value < min || value > max);
  return (
    <Field
      label={label}
      id={id}
      type="number"
      min={min}
      max={max}
      value={value ?? ""}
      placeholder={placeholder}
      hint={hint}
      error={outOfRange ? `Must be from ${min} to ${max}.` : undefined}
      onChange={(event) => onChange(toNumber(event.target.value))}
    />
  );
}

function clean(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export function GuardrailsTab() {
  const { draft, setDraft } = useOutletContext();
  const limits = draft.limits ?? {};
  const guardrails = draft.guardrails ?? {};
  const retry = guardrails.retry ?? {};

  const setLimit = (name, value) =>
    setDraft({ ...draft, limits: clean({ ...limits, [name]: value }) });
  const setGuardrail = (name, value) =>
    setDraft({ ...draft, guardrails: clean({ ...guardrails, [name]: value }) });
  const setRetry = (name, value) => setGuardrail("retry", clean({ ...retry, [name]: value }));

  const targets = (guardrails.allowed_notify_targets ?? []).join(", ");

  return (
    <>
      <Card title="Limits">
        <div className="grid gap-4 md:grid-cols-3">
          <NumberField
            label="Most steps per run"
            id="max-steps"
            min={1}
            max={500}
            value={limits.max_steps}
            hint="1 to 500"
            onChange={(value) => setLimit("max_steps", value)}
          />
          <NumberField
            label="Time limit (seconds)"
            id="timeout"
            min={10}
            max={3600}
            value={limits.timeout_seconds}
            placeholder="300"
            hint="10 to 3600. Delays and approvals don't count."
            onChange={(value) => setLimit("timeout_seconds", value)}
          />
          <NumberField
            label="AI tokens per run"
            id="tokens"
            min={0}
            max={100000}
            value={limits.max_ai_tokens}
            placeholder="10000"
            hint="0 turns AI off"
            onChange={(value) => setLimit("max_ai_tokens", value)}
          />
        </div>
      </Card>

      <Card title="AI safety">
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="If a message looks like an attack"
            id="injection"
            value={guardrails.injection_detection ?? "flag"}
            options={ATTACK_OPTIONS}
            onChange={(event) => setGuardrail("injection_detection", event.target.value)}
          />
          <Field
            label="Only notify these targets"
            id="targets"
            defaultValue={targets}
            placeholder="*@example.com, #support"
            hint="Separate with commas. Leave empty for no limit."
            onChange={(event) =>
              setGuardrail(
                "allowed_notify_targets",
                event.target.value
                  .split(",")
                  .map((target) => target.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
      </Card>

      <details className="rounded-lg border border-line bg-white px-5 py-3.5">
        <summary className="min-h-7 cursor-pointer text-[15px] font-semibold">Advanced</summary>
        <div className="flex flex-col gap-4 pt-3.5">
          <div className="grid gap-4 md:grid-cols-3">
            <NumberField
              label="Tries per step"
              id="attempts"
              min={1}
              max={5}
              value={retry.max_attempts}
              placeholder="5"
              hint="1 to 5"
              onChange={(value) => setRetry("max_attempts", value)}
            />
            <NumberField
              label="First retry wait (seconds)"
              id="backoff"
              min={1}
              max={30}
              value={retry.backoff_seconds}
              placeholder="2"
              hint="1 to 30. Doubles after each try."
              onChange={(value) => setRetry("backoff_seconds", value)}
            />
            <NumberField
              label="Largest input (KB)"
              id="input-kb"
              min={1}
              max={1024}
              value={guardrails.max_input_kb}
              placeholder="256"
              hint="1 to 1024"
              onChange={(value) => setGuardrail("max_input_kb", value)}
            />
          </div>
          <Checkbox
            label="Remove links and email addresses from AI text"
            checked={guardrails.strip_links_from_ai_text !== false}
            onChange={(event) => setGuardrail("strip_links_from_ai_text", event.target.checked)}
          />
        </div>
      </details>

      <Card title="Always on">
        <ul className="flex flex-wrap gap-2">
          {ALWAYS_ON.map((rule) => (
            <li
              key={rule}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#eaeeec] px-2.5 py-1 text-xs font-medium"
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              {rule}
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-[13px] text-muted">Changes apply the next time you publish.</p>
    </>
  );
}
