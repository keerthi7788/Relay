import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { loadConfig } from "../../src/shared/config.js";

const config = loadConfig();
const API = `http://localhost:${config.port}`;
const WORLD = config.mockWorldUrl;
const TRIAGE_SECRET = "whsec_triage_501";
const EXPENSE_SECRET = "whsec_expense_774";
const SETTLED = ["succeeded", "failed", "cancelled", "waiting_approval"];

const payloads = Object.fromEntries(
  readFileSync(`${config.dataDir}/sample_payloads.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .map(({ id, body }) => [id, body]),
);

async function send(method, url, { body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const api = (method, path, body) =>
  send(method, `${API}${path}`, {
    body,
    headers: { Authorization: `Bearer ${config.demoToken}` },
  });

const webhook = (id, secret, body) =>
  send("POST", `${API}/hooks/${id}`, { body, headers: { "X-Relay-Secret": secret } });

async function waitForRun(runId, statuses = SETTLED, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api("GET", `/runs/${runId}`);
    if (statuses.includes(body.status)) return body;
    await sleep(200);
  }
  throw new Error(`Run ${runId} did not reach ${statuses}`);
}

async function pendingApproval(runId) {
  const { body } = await api("GET", "/approvals?status=pending");
  return body.find((approval) => approval.run_id === runId);
}

const ledger = async () => (await send("GET", `${WORLD}/admin/ledger`)).body.entries;
const resetWorld = () => send("POST", `${WORLD}/admin/reset`, { body: {} });

const uniqueId = (name) => `wf_e2e_${name}_${Date.now()}`;
const notifyDefinition = (id) => ({
  id,
  name: id,
  trigger: { type: "manual" },
  entry: "hello",
  limits: { max_steps: 5 },
  nodes: [
    {
      id: "hello",
      type: "notify",
      params: { channel: "chat", to: "#e2e", message: `hello ${id}` },
      next: null,
    },
  ],
});

describe("Relay APIs, live", () => {
  before(resetWorld);

  describe("GET /health", () => {
    it("responds without a token", async () => {
      assert.equal((await send("GET", `${API}/health`)).status, 200);
    });
  });

  describe("authentication", () => {
    it("rejects a missing token", async () => {
      assert.equal((await send("GET", `${API}/workflows`)).status, 401);
    });
  });

  describe("workflows", () => {
    const id = uniqueId("crud");

    it("GET /workflows lists the seeds as published", async () => {
      const { status, body } = await api("GET", "/workflows");
      assert.equal(status, 200);
      for (const seed of [
        "wf_support_triage",
        "wf_expense_approval",
        "wf_slow_fulfillment",
        "wf_runaway",
      ]) {
        assert.equal(body.find((workflow) => workflow.id === seed)?.status, "published");
      }
    });

    it("POST /workflows creates a draft", async () => {
      const { status, body } = await api("POST", "/workflows", notifyDefinition(id));
      assert.equal(status, 201);
      assert.equal(body.status, "draft");
    });

    it("POST /workflows refuses a duplicate id", async () => {
      assert.equal((await api("POST", "/workflows", notifyDefinition(id))).status, 409);
    });

    it("GET /workflows/:id returns it, and 404s when unknown", async () => {
      assert.equal((await api("GET", `/workflows/${id}`)).body.id, id);
      assert.equal((await api("GET", "/workflows/nope")).status, 404);
    });

    it("GET /workflows/:id never returns the webhook secret", async () => {
      const { body } = await api("GET", "/workflows/wf_expense_approval");
      assert.ok(!JSON.stringify(body).includes(EXPENSE_SECRET));
    });

    it("POST /workflows/:id/trigger refuses an unpublished workflow", async () => {
      assert.equal((await api("POST", `/workflows/${id}/trigger`, {})).status, 409);
    });

    it("PUT /workflows/:id updates the draft", async () => {
      const { status, body } = await api("PUT", `/workflows/${id}`, {
        ...notifyDefinition(id),
        name: "Renamed",
      });
      assert.equal(status, 200);
      assert.equal(body.name, "Renamed");
    });

    it("POST /workflows/:id/publish freezes it", async () => {
      const { status, body } = await api("POST", `/workflows/${id}/publish`);
      assert.equal(status, 200);
      assert.equal(body.status, "published");
    });

    it("POST /workflows/:id/publish rejects each invalid case with its own code", async () => {
      const cases = [
        ["invalid_node_type", [{ id: "n", type: "teleport", params: {}, next: null }]],
        [
          "missing_required_param",
          [{ id: "n", type: "notify", params: { channel: "chat" }, next: null }],
        ],
        [
          "invalid_node_reference",
          [{ id: "n", type: "delay", params: { seconds: 1 }, next: "ghost" }],
        ],
      ];
      for (const [code, nodes] of cases) {
        const badId = uniqueId(code);
        await api("POST", "/workflows", { ...notifyDefinition(badId), entry: "n", nodes });
        const { status, body } = await api("POST", `/workflows/${badId}/publish`);
        assert.equal(status, 422);
        assert.equal(body.error.code, code);
      }
    });

    it("POST /workflows/:id/trigger runs it to success", async () => {
      const { status, body } = await api("POST", `/workflows/${id}/trigger`, { input: {} });
      assert.equal(status, 202);
      const run = await waitForRun(body.run_id);
      assert.equal(run.status, "succeeded");
      assert.ok((await ledger()).some((entry) => entry.idempotency_key?.startsWith(body.run_id)));
    });
  });

  describe("POST /hooks/:id", () => {
    it("rejects a wrong or missing secret", async () => {
      const body = payloads.pay_102;
      assert.equal((await webhook("wf_expense_approval", "wrong", body)).status, 401);
      assert.equal((await send("POST", `${API}/hooks/wf_expense_approval`, { body })).status, 401);
    });

    it("accepts the right secret and runs the auto-approve branch", async () => {
      const { status, body } = await webhook(
        "wf_expense_approval",
        EXPENSE_SECRET,
        payloads.pay_102,
      );
      assert.equal(status, 202);
      const run = await waitForRun(body.run_id);
      assert.equal(run.status, "succeeded");
      assert.equal(run.steps.at(-1).node_id, "auto_ok");
    });

    it("refuses a workflow with no webhook trigger", async () => {
      assert.equal((await webhook("wf_runaway", "anything", {})).status, 409);
    });
  });

  describe("runs", () => {
    let runId;

    before(async () => {
      const { body } = await webhook("wf_expense_approval", EXPENSE_SECRET, payloads.pay_102);
      runId = body.run_id;
      await waitForRun(runId);
    });

    it("GET /runs filters by workflow", async () => {
      const { body } = await api("GET", "/runs?workflowId=wf_expense_approval");
      assert.ok(body.some((run) => run.run_id === runId));
      assert.ok(body.every((run) => run.workflow_id === "wf_expense_approval"));
    });

    it("GET /runs/:id returns the full trace", async () => {
      const { body } = await api("GET", `/runs/${runId}`);
      const notify = body.steps.at(-1);
      assert.equal(notify.input.channel, "email");
      assert.equal(notify.attempt, 1);
      assert.ok(notify.output.delivered);
      assert.ok(notify.started_at);
      assert.ok(notify.duration_ms >= 0);
      assert.ok(notify.idempotency_key);
      assert.ok(!JSON.stringify(body).includes(EXPENSE_SECRET));
    });

    it("GET /runs/:id 404s when unknown", async () => {
      assert.equal((await api("GET", "/runs/nope")).status, 404);
    });

    it("POST /runs/:id/cancel stops a run during its delay, then refuses a repeat", async () => {
      const { body } = await api("POST", "/workflows/wf_slow_fulfillment/trigger", {
        input: payloads.pay_201,
      });
      await sleep(1500);
      assert.equal((await api("POST", `/runs/${body.run_id}/cancel`)).status, 200);
      const run = await waitForRun(body.run_id, ["cancelled"], 10_000);
      assert.equal(run.error.code, "cancelled");
      assert.equal((await api("POST", `/runs/${body.run_id}/cancel`)).status, 409);
    });

    it("stops the runaway workflow at its step cap", async () => {
      const { body } = await api("POST", "/workflows/wf_runaway/trigger", { input: {} });
      const run = await waitForRun(body.run_id);
      assert.equal(run.status, "failed");
      assert.equal(run.error.code, "max_steps_exceeded");
      assert.equal(run.steps.length, 12);
    });
  });

  describe("approvals", () => {
    const startLargeExpense = async () => {
      const { body } = await webhook("wf_expense_approval", EXPENSE_SECRET, payloads.pay_101);
      const run = await waitForRun(body.run_id);
      assert.equal(run.status, "waiting_approval");
      return body.run_id;
    };

    it("GET /approvals lists a paused run with its context", async () => {
      const approval = await pendingApproval(await startLargeExpense());
      assert.match(approval.message, /\$250/);
      assert.equal(approval.input.amount_usd, 250);
      assert.equal((await api("POST", `/approvals/${approval.id}/reject`)).status, 200);
    });

    it("GET /approvals rejects an unknown status", async () => {
      assert.equal((await api("GET", "/approvals?status=nope")).status, 400);
    });

    it("POST /approvals/:id/approve resumes the run, then refuses a second decision", async () => {
      const runId = await startLargeExpense();
      const { id } = await pendingApproval(runId);
      const { status, body } = await api("POST", `/approvals/${id}/approve`);
      assert.equal(status, 200);
      assert.equal(body.decided_by, "demo-operator");
      assert.equal((await waitForRun(runId, ["succeeded", "failed"])).status, "succeeded");
      assert.equal((await api("POST", `/approvals/${id}/approve`)).status, 409);
    });

    it("POST /approvals/:id/reject ends the run cancelled", async () => {
      const runId = await startLargeExpense();
      const { id } = await pendingApproval(runId);
      assert.equal((await api("POST", `/approvals/${id}/reject`)).status, 200);
      const run = await waitForRun(runId, ["cancelled"]);
      assert.equal(run.error.code, "approval_rejected");
    });

    it("POST /approvals/:id/approve 404s when unknown", async () => {
      assert.equal((await api("POST", "/approvals/nope/approve")).status, 404);
    });

    it("refuses a sensitive node with no approval, whatever was published", async () => {
      const id = uniqueId("bypass");
      await api("POST", "/workflows", {
        ...notifyDefinition(id),
        entry: "refund",
        nodes: [
          {
            id: "refund",
            type: "order_action",
            params: { action: "refund", order_id: "ord_2001" },
            next: null,
          },
        ],
      });
      const published = await api("POST", `/workflows/${id}/publish`);
      assert.equal(published.body.warnings[0].code, "sensitive_node_without_approval");

      await resetWorld();
      const { body } = await api("POST", `/workflows/${id}/trigger`, { input: {} });
      const run = await waitForRun(body.run_id);
      assert.equal(run.error.code, "approval_required");
      assert.equal((await ledger()).length, 0);
    });
  });

  describe("settings", () => {
    it("GET /catalog returns the node types", async () => {
      assert.equal((await api("GET", "/catalog")).body.nodes.length, 7);
    });

    it("PUT /workflows/:id/guardrails applies at publish", async () => {
      const id = uniqueId("guard");
      await api("POST", "/workflows", notifyDefinition(id));
      const saved = await api("PUT", `/workflows/${id}/guardrails`, {
        guardrails: { allowed_notify_targets: ["#only-this"] },
      });
      assert.equal(saved.status, 200);
      await api("POST", `/workflows/${id}/publish`);
      const { body } = await api("POST", `/workflows/${id}/trigger`, { input: {} });
      const run = await waitForRun(body.run_id);
      assert.equal(run.error.code, "notify_target_blocked");
    });

    it("rejects guardrail values outside the safe range", async () => {
      const id = uniqueId("unsafe");
      await api("POST", "/workflows", notifyDefinition(id));
      const { status } = await api("PUT", `/workflows/${id}/guardrails`, {
        limits: { max_steps: 100000 },
      });
      assert.equal(status, 422);
    });

    it("PUT and rotate-secret manage the webhook trigger", async () => {
      const id = uniqueId("hook");
      const created = await api("POST", "/workflows", notifyDefinition(id));
      assert.equal(created.body.webhook_secret, undefined);

      const updated = await api("PUT", `/workflows/${id}/trigger`, { type: "webhook" });
      assert.match(updated.body.webhook_secret, /^whsec_/);
      await api("POST", `/workflows/${id}/publish`);

      const rotated = await api("POST", `/workflows/${id}/trigger/rotate-secret`);
      assert.equal((await webhook(id, updated.body.webhook_secret, {})).status, 401);
      assert.equal((await webhook(id, rotated.body.webhook_secret, {})).status, 202);
    });

    it("a published schedule creates a schedule row, and a bad cron is refused", async () => {
      const id = uniqueId("cron");
      await api("POST", "/workflows", notifyDefinition(id));
      await api("PUT", `/workflows/${id}/trigger`, { type: "schedule", cron: "nope" });
      assert.equal((await api("POST", `/workflows/${id}/publish`)).status, 422);
      await api("PUT", `/workflows/${id}/trigger`, { type: "schedule", cron: "0 9 * * 1-5" });
      assert.equal((await api("POST", `/workflows/${id}/publish`)).status, 200);
    });
  });

  describe("AI nodes, with the real model", () => {
    const triage = async (payload) => {
      const { body } = await webhook("wf_support_triage", TRIAGE_SECRET, payload);
      return waitForRun(body.run_id);
    };

    it("branches a complaint to the support channel and records tokens", async () => {
      await resetWorld();
      const run = await triage(payloads.pay_001);
      assert.equal(run.status, "succeeded");
      assert.equal(run.steps[0].output.category, "complaint");
      assert.equal(run.steps.at(-1).node_id, "notify_support");
      assert.ok(run.steps[0].tokens.prompt > 0);
      assert.ok(run.ai_tokens_used > 0);
    });

    it("pauses a refund request, and refunds once when approved", async () => {
      await resetWorld();
      const run = await triage(payloads.pay_002);
      assert.equal(run.status, "waiting_approval");
      const { id } = await pendingApproval(run.run_id);
      await api("POST", `/approvals/${id}/approve`);
      const finished = await waitForRun(run.run_id, ["succeeded", "failed"]);
      assert.equal(finished.status, "succeeded");
      const refunds = (await ledger()).filter((entry) => entry.action === "order.refund");
      assert.equal(refunds.length, 1);
    });

    it("doesn't let pay_inject_001 skip approval", async () => {
      await resetWorld();
      const run = await triage(payloads.pay_inject_001);
      assert.equal(run.status, "waiting_approval");
      assert.equal(run.injection_flagged, true);
      assert.equal((await ledger()).length, 0);

      const { id } = await pendingApproval(run.run_id);
      await api("POST", `/approvals/${id}/reject`);
      assert.equal((await send("GET", `${WORLD}/orders/ord_2002`)).body.status, "delivered");
    });

    it("sends pay_inject_002 only to the configured target", async () => {
      await resetWorld();
      const run = await triage(payloads.pay_inject_002);
      assert.ok(SETTLED.includes(run.status));
      const entries = await ledger();
      assert.ok(entries.every((entry) => entry.payload.channel === "#support"));
      assert.ok(!JSON.stringify(entries).includes("evil-example"));
    });

    it("fails cleanly when the output can't satisfy the schema", async () => {
      const id = uniqueId("strict");
      await api("POST", "/workflows", {
        ...notifyDefinition(id),
        entry: "ask",
        nodes: [
          {
            id: "ask",
            type: "ai",
            params: {
              prompt: "Say hello in one word.",
              output_schema: {
                type: "object",
                properties: { code: { type: "string", minLength: 5, maxLength: 2 } },
                required: ["code"],
                additionalProperties: false,
              },
            },
            next: null,
          },
        ],
      });
      await api("POST", `/workflows/${id}/publish`);
      const { body } = await api("POST", `/workflows/${id}/trigger`, { input: {} });
      const run = await waitForRun(body.run_id);
      assert.equal(run.status, "failed");
      assert.equal(run.error.code, "ai_schema_violation");
      assert.equal(run.steps[0].attempts.length, 2);
    });
  });
});
