const TEMPLATE = /\{\{\s*trigger\.body\.([\w.]+)\s*\}\}/g;

export const KIND_LABELS = {
  ai: "AI",
  condition: "Condition",
  approval: "Approval",
  order_action: "Order action",
  notify: "Notify",
  delay: "Delay",
  http_request: "HTTP request",
};

export function stepTitle(nodeId) {
  const words = nodeId.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const findNode = (definition, id) => definition.nodes.find((node) => node.id === id);

// Flattens the graph into display order. Steps nothing points to come last, marked as disconnected.
export function orderedSteps(definition) {
  const rows = [];
  const seen = new Set();

  const walk = (id, depth, branch) => {
    const node = id && findNode(definition, id);
    if (!node) return;
    if (seen.has(id)) {
      rows.push({ kind: "loop", id, depth, branch });
      return;
    }
    seen.add(id);
    rows.push({ kind: "step", node, depth, branch });
    if (node.type === "condition") {
      walk(node.on_true, depth + 1, "If yes");
      walk(node.on_false, depth + 1, "If no");
    } else {
      walk(node.next, depth);
    }
  };

  walk(definition.entry, 0);
  for (const node of definition.nodes) {
    if (!seen.has(node.id)) rows.push({ kind: "step", node, depth: 0, disconnected: true });
  }
  return rows;
}

function uniqueId(definition, type) {
  const taken = new Set(definition.nodes.map((node) => node.id));
  let number = 1;
  while (taken.has(`${type}_${number}`)) number += 1;
  return `${type}_${number}`;
}

function blankParams(spec) {
  const params = {};
  for (const [name, param] of Object.entries(spec.params)) {
    if (!param.required) continue;
    if (param.enum) params[name] = param.enum[0];
    else if (param.type === "number") params[name] = 0;
    else if (param.type === "object") params[name] = { type: "object", properties: {} };
    else params[name] = "";
  }
  return params;
}

export function addStep(definition, spec, afterId) {
  const id = uniqueId(definition, spec.type);
  const after = findNode(definition, afterId);
  const continues = after && after.type !== "condition" ? (after.next ?? null) : null;
  const created = { id, type: spec.type, params: blankParams(spec) };
  if (spec.type === "condition") {
    created.on_true = continues;
    created.on_false = null;
  } else {
    created.next = continues;
  }

  const nodes = definition.nodes.map((node) =>
    after && node.id === after.id && node.type !== "condition" ? { ...node, next: id } : node,
  );
  return {
    definition: { ...definition, entry: definition.entry || id, nodes: [...nodes, created] },
    id,
  };
}

const EDGES = ["next", "on_true", "on_false"];

function replaceEdges(node, from, to) {
  const updated = { ...node };
  for (const edge of EDGES) {
    if (updated[edge] === from) updated[edge] = to;
  }
  return updated;
}

export function removeStep(definition, id) {
  const removed = findNode(definition, id);
  const continues = removed.type === "condition" ? null : (removed.next ?? null);
  return {
    ...definition,
    entry: definition.entry === id ? (continues ?? "") : definition.entry,
    nodes: definition.nodes
      .filter((node) => node.id !== id)
      .map((node) => replaceEdges(node, id, continues)),
  };
}

export function renameStep(definition, from, to) {
  return {
    ...definition,
    entry: definition.entry === from ? to : definition.entry,
    nodes: definition.nodes.map((node) =>
      replaceEdges(node.id === from ? { ...node, id: to } : node, from, to),
    ),
  };
}

function fillFromInput(text, input) {
  return String(text ?? "").replace(TEMPLATE, (match, path) => {
    const value = path.split(".").reduce((current, key) => current?.[key], input);
    return value === undefined ? match : String(value);
  });
}

function describeAction(node, input) {
  const { params } = node;
  if (node.type === "order_action") {
    const order = fillFromInput(params.order_id, input);
    return params.action === "refund"
      ? `Order ${order} is refunded${params.amount_usd ? ` by $${params.amount_usd}` : " in full"}`
      : `A replacement is created for order ${order}`;
  }
  if (node.type === "notify") {
    const target = fillFromInput(params.to, input);
    return params.channel === "email"
      ? `An email goes to ${target}`
      : `A message is posted to ${target}`;
  }
  if (node.type === "http_request")
    return `${params.method} request to ${fillFromInput(params.url, input)}`;
  return null;
}

// Lists the side effects that follow a decision, taken from the run's frozen copy of the workflow.
// It stops at a condition, because which way that goes isn't known yet.
export function actionsAfter(definition, nodeId, input) {
  const actions = [];
  const seen = new Set();
  const start = findNode(definition, nodeId);
  let current = start?.type === "approval" ? findNode(definition, start.next) : start;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === "condition") {
      actions.push("Then it depends on a condition");
      break;
    }
    const action = describeAction(current, input);
    if (action) actions.push(action);
    current = findNode(definition, current.next);
  }
  return actions;
}

export function notReachedSteps(definition, run) {
  if (!["queued", "running", "waiting_approval"].includes(run.status)) return [];
  const executed = new Set(run.steps.map((step) => step.node_id));
  const remaining = [];
  const seen = new Set();
  let current = findNode(definition, run.current_node_id);
  const last = run.steps.at(-1);
  if (last?.status === "waiting")
    current = findNode(definition, findNode(definition, last.node_id)?.next);

  while (current && !seen.has(current.id) && current.type !== "condition") {
    seen.add(current.id);
    if (!executed.has(current.id)) remaining.push(current.id);
    current = findNode(definition, current.next);
  }
  return remaining;
}
