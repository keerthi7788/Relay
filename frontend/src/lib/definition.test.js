import { describe, expect, it } from "vitest";
import { actionsAfter, addStep, orderedSteps, removeStep, renameStep } from "./definition.js";

const triage = {
  entry: "classify",
  nodes: [
    { id: "classify", type: "ai", params: {}, next: "route" },
    { id: "route", type: "condition", params: {}, on_true: "gate", on_false: "chat" },
    { id: "gate", type: "approval", params: {}, next: "refund" },
    {
      id: "refund",
      type: "order_action",
      params: { action: "refund", order_id: "{{trigger.body.order_id}}" },
      next: "email",
    },
    {
      id: "email",
      type: "notify",
      params: { channel: "email", to: "{{trigger.body.email}}" },
      next: null,
    },
    { id: "chat", type: "notify", params: { channel: "chat", to: "#support" }, next: null },
  ],
};

describe("orderedSteps", () => {
  it("follows branches, marking each one", () => {
    const rows = orderedSteps(triage);
    expect(rows.map((row) => row.node.id)).toEqual([
      "classify",
      "route",
      "gate",
      "refund",
      "email",
      "chat",
    ]);
    expect(rows.find((row) => row.node.id === "chat").branch).toBe("If no");
    expect(rows.find((row) => row.node.id === "gate").depth).toBe(1);
  });

  it("stops at a loop instead of walking forever", () => {
    const loop = {
      entry: "a",
      nodes: [
        { id: "a", type: "delay", params: {}, next: "b" },
        { id: "b", type: "delay", params: {}, next: "a" },
      ],
    };
    expect(orderedSteps(loop).at(-1)).toMatchObject({ kind: "loop", id: "a" });
  });

  it("lists steps nothing leads to", () => {
    const definition = {
      entry: "a",
      nodes: [...triage.nodes, { id: "lost", type: "delay", params: {}, next: null }],
    };
    definition.entry = "classify";
    expect(orderedSteps(definition).at(-1)).toMatchObject({ disconnected: true });
  });
});

describe("editing steps", () => {
  const spec = {
    type: "notify",
    params: {
      channel: { required: true, enum: ["email", "chat"] },
      message: { required: true, type: "string" },
    },
  };

  it("adds a step after the selected one, keeping the chain", () => {
    const { definition, id } = addStep(triage, spec, "refund");
    expect(definition.nodes.find((node) => node.id === "refund").next).toBe(id);
    expect(definition.nodes.find((node) => node.id === id).next).toBe("email");
  });

  it("makes the first step the entry", () => {
    const { definition, id } = addStep({ entry: "", nodes: [] }, spec);
    expect(definition.entry).toBe(id);
  });

  it("reconnects around a removed step", () => {
    const result = removeStep(triage, "gate");
    expect(result.nodes.find((node) => node.id === "route").on_true).toBe("refund");
  });

  it("moves the entry when the first step is removed", () => {
    expect(removeStep(triage, "classify").entry).toBe("route");
  });

  it("updates every reference on rename", () => {
    const result = renameStep(triage, "gate", "manager");
    expect(result.nodes.find((node) => node.id === "route").on_true).toBe("manager");
    expect(result.nodes.some((node) => node.id === "gate")).toBe(false);
  });
});

describe("actionsAfter", () => {
  it("describes what approval will do, using the real input", () => {
    const actions = actionsAfter(triage, "gate", {
      order_id: "ord_2002",
      email: "attacker@example.com",
    });
    expect(actions).toEqual([
      "Order ord_2002 is refunded in full",
      "An email goes to attacker@example.com",
    ]);
  });

  it("covers the node itself when the engine paused before it", () => {
    expect(actionsAfter(triage, "chat", {})).toEqual(["A message is posted to #support"]);
  });

  it("keeps the placeholder when a value is missing", () => {
    expect(actionsAfter(triage, "email", {})[0]).toContain("{{trigger.body.email}}");
  });
});
