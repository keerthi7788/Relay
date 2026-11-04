import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { relay } from "../../api/relay.js";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Select,
  Tag,
  TextArea,
} from "../../components/ui.jsx";
import {
  addStep,
  KIND_LABELS,
  orderedSteps,
  removeStep,
  renameStep,
  stepTitle,
} from "../../lib/definition.js";

const LONG_TEXT_PARAMS = new Set(["prompt", "message"]);
const END = "__end__";
const PARAM_LABELS = {
  order_id: "Order ID",
  amount_usd: "Amount (USD)",
  url: "URL",
  output_schema: "Answer format (JSON Schema)",
};

function JsonParam({ label, id, value, onChange }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState(null);

  const update = (next) => {
    setText(next);
    try {
      onChange(next.trim() ? JSON.parse(next) : undefined);
      setError(null);
    } catch {
      setError("This isn't valid JSON yet.");
    }
  };

  return (
    <TextArea
      label={label}
      id={id}
      rows={8}
      value={text}
      error={error}
      onChange={(event) => update(event.target.value)}
    />
  );
}

function ParamField({ name, spec, value, onChange, stepId }) {
  const id = `param-${stepId}-${name}`;
  const label = PARAM_LABELS[name] ?? stepTitle(name);
  const setText = (event) => onChange(event.target.value || (spec.required ? "" : undefined));

  if (spec.enum) {
    return (
      <Select
        label={label}
        id={id}
        value={value ?? ""}
        options={[
          ...(spec.required ? [] : [{ value: "", label: "None" }]),
          ...spec.enum.map((option) => ({ value: option, label: option })),
        ]}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    );
  }
  if (spec.type === "object") {
    return <JsonParam key={id} label={label} id={id} value={value} onChange={onChange} />;
  }
  if (spec.type === "number") {
    return (
      <Field
        label={label}
        id={id}
        type="number"
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : Number(event.target.value))
        }
      />
    );
  }
  const hint = spec.templatable
    ? "You can use {{trigger.body.x}} and {{nodes.id.output.y}}."
    : undefined;
  if (LONG_TEXT_PARAMS.has(name)) {
    return (
      <TextArea label={label} id={id} rows={6} hint={hint} value={value ?? ""} onChange={setText} />
    );
  }
  return <Field label={label} id={id} hint={hint} value={value ?? ""} onChange={setText} />;
}

function AnswerPreview({ schema }) {
  const properties = Object.entries(schema?.properties ?? {});
  if (properties.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Answers it can give</span>
      <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 text-[13px]">
        {properties.map(([name, property]) => (
          <div key={name} className="contents">
            <span className="font-mono text-xs">{name}</span>
            <span className="flex flex-wrap gap-1.5">
              {property.enum ? (
                property.enum.map((option) => <Tag key={option}>{option}</Tag>)
              ) : (
                <span className="text-muted">
                  {property.type ?? "Any value"}
                  {property.maxLength ? `, up to ${property.maxLength} characters` : ""}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EdgeSelect({ label, id, value, nodes, ownId, onChange }) {
  const options = [
    ...nodes
      .filter((node) => node.id !== ownId)
      .map((node) => ({ value: node.id, label: stepTitle(node.id) })),
    { value: END, label: "End the run" },
  ];
  return (
    <Select
      label={label}
      id={id}
      value={value ?? END}
      options={options}
      onChange={(event) => onChange(event.target.value === END ? null : event.target.value)}
    />
  );
}

function StepEditor({ node, spec, definition, onChange, onRename, onDelete, onViewJson }) {
  const [idDraft, setIdDraft] = useState(node.id);

  useEffect(() => setIdDraft(node.id), [node.id]);

  const setParam = (name, value) => {
    const params = { ...node.params };
    if (value === undefined) delete params[name];
    else params[name] = value;
    onChange({ ...node, params });
  };

  const commitRename = () => {
    const next = idDraft.trim();
    const taken = definition.nodes.some((other) => other.id === next);
    if (next && next !== node.id && !taken) onRename(next);
    else setIdDraft(node.id);
  };

  return (
    <div className="flex flex-col gap-4">
      {spec?.requires_approval && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">
          This step always needs an approval first. That rule can&#39;t be turned off.
        </p>
      )}
      <Field
        label="Step ID"
        id="step-id"
        value={idDraft}
        onChange={(event) => setIdDraft(event.target.value.replace(/[^\w-]/g, "_"))}
        onBlur={commitRename}
      />
      {spec &&
        Object.entries(spec.params).map(([name, param]) => (
          <ParamField
            key={name}
            name={name}
            spec={param}
            stepId={node.id}
            value={node.params?.[name]}
            onChange={(value) => setParam(name, value)}
          />
        ))}
      {node.type === "ai" && <AnswerPreview schema={node.params?.output_schema} />}
      {node.type === "condition" ? (
        <div className="grid grid-cols-2 gap-4">
          <EdgeSelect
            label="If yes, go to"
            id="edge-true"
            value={node.on_true}
            nodes={definition.nodes}
            ownId={node.id}
            onChange={(on_true) => onChange({ ...node, on_true })}
          />
          <EdgeSelect
            label="If no, go to"
            id="edge-false"
            value={node.on_false}
            nodes={definition.nodes}
            ownId={node.id}
            onChange={(on_false) => onChange({ ...node, on_false })}
          />
        </div>
      ) : (
        <EdgeSelect
          label="Then go to"
          id="edge-next"
          value={node.next}
          nodes={definition.nodes}
          ownId={node.id}
          onChange={(next) => onChange({ ...node, next })}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5">
        <button
          type="button"
          className="min-h-9 text-[13px] text-accent underline"
          onClick={onViewJson}
        >
          View as JSON
        </button>
        <Button kind="danger" onClick={onDelete}>
          Delete step
        </Button>
      </div>
    </div>
  );
}

function StepList({ definition, selected, onSelect }) {
  const rows = useMemo(() => orderedSteps(definition), [definition]);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => {
        const indent = { marginLeft: `${row.depth * 16}px` };
        const branch = row.branch && (
          <div className="pt-1 text-xs font-semibold text-muted" style={indent}>
            {row.branch}
          </div>
        );
        if (row.kind === "loop") {
          return (
            <div key={`loop-${row.id}-${index}`} className="flex flex-col gap-2">
              {branch}
              <div className="text-xs text-muted" style={indent}>
                Goes back to {stepTitle(row.id)}
              </div>
            </div>
          );
        }
        const on = row.node.id === selected;
        return (
          <div key={row.node.id} className="flex flex-col gap-2">
            {branch}
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(row.node.id)}
              style={indent}
              className={`flex min-h-11 flex-col gap-0.5 rounded-lg bg-white px-3.5 py-3 text-left ${
                on ? "border-2 border-accent" : "border border-line hover:border-control"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold">{stepTitle(row.node.id)}</span>
                <span className="ml-auto text-xs text-muted">
                  {KIND_LABELS[row.node.type] ?? row.node.type}
                </span>
              </span>
              {row.disconnected && <span className="text-xs text-warn">No step leads here</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function StepsTab() {
  const { draft, setDraft, selectedStep, setSelectedStep } = useOutletContext();
  const [catalog, setCatalog] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("notify");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState(null);

  useEffect(() => {
    let active = true;
    relay.catalog().then((loaded) => active && setCatalog(loaded));
    return () => {
      active = false;
    };
  }, []);

  const nodes = draft.nodes ?? [];
  const selected = nodes.find((node) => node.id === selectedStep) ?? nodes[0];
  const specFor = (type) => catalog?.nodes.find((spec) => spec.type === type);

  const add = () => {
    const { definition, id } = addStep({ ...draft, nodes }, specFor(newType), selected?.id);
    setDraft(definition);
    setSelectedStep(id);
    setAdding(false);
  };

  const openJson = () => {
    setJsonText(JSON.stringify(draft, null, 2));
    setJsonError(null);
    setShowJson(true);
  };

  const applyJson = () => {
    try {
      setDraft(JSON.parse(jsonText));
      setShowJson(false);
    } catch {
      setJsonError("This isn't valid JSON.");
    }
  };

  if (showJson) {
    return (
      <Card title="Workflow as JSON">
        <TextArea
          label="Definition"
          id="definition-json"
          rows={22}
          value={jsonText}
          error={jsonError}
          onChange={(event) => setJsonText(event.target.value)}
        />
        <div className="flex gap-2">
          <Button kind="primary" onClick={applyJson}>
            Apply
          </Button>
          <Button onClick={() => setShowJson(false)}>Close</Button>
        </div>
      </Card>
    );
  }

  const addControls = adding ? (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-white p-3.5">
      <Select
        label="Step type"
        id="new-step-type"
        value={newType}
        options={(catalog?.nodes ?? []).map((spec) => ({
          value: spec.type,
          label: KIND_LABELS[spec.type] ?? spec.type,
        }))}
        onChange={(event) => setNewType(event.target.value)}
      />
      <div className="flex gap-2">
        <Button kind="primary" onClick={add} disabled={!catalog}>
          Add
        </Button>
        <Button onClick={() => setAdding(false)}>Cancel</Button>
      </div>
    </div>
  ) : (
    <div>
      <Button onClick={() => setAdding(true)}>Add step</Button>
    </div>
  );

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState title="No steps yet" text="Add the first step of this workflow." />
        {addControls}
      </div>
    );
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-3">
        <StepList
          definition={{ ...draft, nodes }}
          selected={selected?.id}
          onSelect={setSelectedStep}
        />
        {addControls}
      </div>
      {selected && (
        <Card
          title={stepTitle(selected.id)}
          action={<Tag tone="accent">{KIND_LABELS[selected.type] ?? selected.type}</Tag>}
        >
          <StepEditor
            key={selected.id}
            node={selected}
            spec={specFor(selected.type)}
            definition={draft}
            onViewJson={openJson}
            onChange={(updated) =>
              setDraft({
                ...draft,
                nodes: nodes.map((node) => (node.id === selected.id ? updated : node)),
              })
            }
            onRename={(to) => {
              setDraft(renameStep(draft, selected.id, to));
              setSelectedStep(to);
            }}
            onDelete={() => setConfirmDelete(true)}
          />
        </Card>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this step?"
          text={`${stepTitle(selected.id)} will be removed from the draft. Steps before it will connect to the step after it.`}
          confirmLabel="Delete step"
          cancelLabel="Keep step"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setDraft(removeStep(draft, selected.id));
            setSelectedStep(null);
            setConfirmDelete(false);
          }}
        />
      )}
    </div>
  );
}
