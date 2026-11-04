export const notifyNode = (id, next = null, to = "#ops") => ({
  id,
  type: "notify",
  params: { channel: "chat", to, message: `from ${id}` },
  next,
});

export const define = (id, nodes, overrides = {}) => ({
  id,
  name: id,
  trigger: { type: "manual" },
  entry: nodes[0].id,
  limits: { max_steps: 20 },
  nodes,
  ...overrides,
});

export const refundNode = (id = "refund", next = null) => ({
  id,
  type: "order_action",
  params: { action: "refund", order_id: "{{trigger.body.order_id}}" },
  next,
});

export const approvalNode = (id = "gate", next = "refund") => ({
  id,
  type: "approval",
  params: { message: "Refund {{trigger.body.order_id}}?" },
  next,
});

export const CLASSIFY_SCHEMA = {
  type: "object",
  properties: { category: { type: "string", enum: ["refund_request", "complaint"] } },
  required: ["category"],
  additionalProperties: false,
};

export const classifyNode = (next = "route") => ({
  id: "classify",
  type: "ai",
  params: { prompt: "Classify: {{trigger.body.message}}", output_schema: CLASSIFY_SCHEMA },
  next,
});
