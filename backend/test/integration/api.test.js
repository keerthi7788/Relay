import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createApp } from "../../src/app.js";
import { ApprovalService } from "../../src/services/approvalService.js";
import { UnitOfWork } from "../../src/db/unitOfWork.js";
import jwt from "jsonwebtoken";
import { AuthService } from "../../src/services/authService.js";
import { HealthService } from "../../src/services/healthService.js";
import { RunService } from "../../src/services/runService.js";
import { NodeCatalog } from "../../src/domain/nodeCatalog.js";
import { PublishValidator } from "../../src/domain/publishValidator.js";
import { WorkflowService } from "../../src/services/workflowService.js";
import { define, notifyNode } from "../support/definitions.js";
import { dataDir, openTestDatabase, resetTables } from "../support/testEnv.js";

const TOKEN = "test-token";
const JWT_SECRET = "test-secret-test-secret-test-secret";

describe("REST API", () => {
  let database, server, baseUrl, workflows, services;

  before(async () => {
    database = await openTestDatabase();
    const uow = new UnitOfWork(database);
    const catalog = NodeCatalog.load(dataDir);
    workflows = new WorkflowService(uow, new PublishValidator(catalog), catalog, dataDir);
    services = {
      workflows,
      runs: new RunService(uow),
      approvals: new ApprovalService(uow),
      health: new HealthService(database),
      auth: new AuthService(uow, { secret: JWT_SECRET, expiresIn: "1h" }),
    };
    await new Promise((resolve) => {
      server = createApp({ services, demoToken: TOKEN }).listen(0, resolve);
    });
    baseUrl = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });

  beforeEach(async () => {
    await resetTables(database);
    await workflows.loadSeeds(dataDir);
  });

  const call = async (method, path, { body, headers = {}, token = TOKEN } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  it("requires a token on platform routes", async () => {
    const { status, body } = await call("GET", "/workflows", { token: null });
    assert.equal(status, 401);
    assert.equal(body.error.code, "invalid_token");
  });

  it("lists seeds as published without exposing secrets", async () => {
    const { body } = await call("GET", "/workflows");
    assert.equal(body.length, 4);
    assert.ok(body.every(({ status }) => status === "published"));
  });

  it("masks the webhook secret on read", async () => {
    const { body } = await call("GET", "/workflows/wf_expense_approval");
    assert.ok(!JSON.stringify(body).includes("whsec_expense_774"));
  });

  it("does not reload seeds over an edited workflow", async () => {
    const edited = define("wf_runaway", [notifyNode("n")]);
    await call("PUT", "/workflows/wf_runaway", { body: edited });
    await workflows.loadSeeds(dataDir);
    const { body } = await call("GET", "/workflows/wf_runaway");
    assert.equal(body.definition.entry, "n");
  });

  it("creates a draft, refuses triggers until published, then runs", async () => {
    const definition = define("wf_new", [notifyNode("n")]);
    assert.equal((await call("POST", "/workflows", { body: definition })).body.status, "draft");
    assert.equal((await call("POST", "/workflows/wf_new/trigger", { body: {} })).status, 409);
    assert.equal((await call("POST", "/workflows/wf_new/publish")).body.status, "published");

    const triggered = await call("POST", "/workflows/wf_new/trigger", {
      body: { input: { a: 1 } },
    });
    assert.equal(triggered.status, 202);
    const run = await call("GET", `/runs/${triggered.body.run_id}`);
    assert.equal(run.body.status, "queued");
    assert.deepEqual(run.body.input, { a: 1 });
  });

  it("refuses a duplicate id", async () => {
    const { status } = await call("POST", "/workflows", {
      body: define("wf_runaway", [notifyNode("n")]),
    });
    assert.equal(status, 409);
  });

  it("returns every publish error with the first as the code", async () => {
    const bad = define("wf_bad", [{ id: "n", type: "teleport", params: {}, next: null }]);
    await call("POST", "/workflows", { body: bad });
    const { status, body } = await call("POST", "/workflows/wf_bad/publish");
    assert.equal(status, 422);
    assert.equal(body.error.code, "invalid_node_type");
    assert.match(body.error.message, /teleport/);
  });

  it("edits to a published workflow don't change what triggers run", async () => {
    await call("PUT", "/workflows/wf_runaway", { body: define("wf_runaway", [notifyNode("n")]) });
    const { body: workflow } = await call("GET", "/workflows/wf_runaway");
    assert.equal(workflow.has_unpublished_changes, true);

    const { body } = await call("POST", "/workflows/wf_runaway/trigger", { body: {} });
    const run = await call("GET", `/runs/${body.run_id}`);
    assert.equal(run.body.definition_snapshot.entry, "check_order");
  });

  describe("webhooks", () => {
    const hook = (id, secret, body = { amount_usd: 40 }) =>
      call("POST", `/hooks/${id}`, {
        token: null,
        body,
        headers: secret ? { "X-Relay-Secret": secret } : {},
      });

    it("accepts the right secret, without a platform token", async () => {
      const { status, body } = await hook("wf_expense_approval", "whsec_expense_774");
      assert.equal(status, 202);
      assert.ok(body.run_id);
    });

    it("rejects a wrong or missing secret", async () => {
      assert.equal((await hook("wf_expense_approval", "wrong")).status, 401);
      assert.equal((await hook("wf_expense_approval")).status, 401);
    });

    it("refuses a workflow with no webhook trigger", async () => {
      assert.equal((await hook("wf_runaway", "anything")).status, 409);
    });

    it("creates two runs for the same webhook sent twice", async () => {
      const first = await hook("wf_expense_approval", "whsec_expense_774");
      const second = await hook("wf_expense_approval", "whsec_expense_774");
      assert.notEqual(first.body.run_id, second.body.run_id);
    });

    it("rejects a non-object payload", async () => {
      assert.equal((await hook("wf_expense_approval", "whsec_expense_774", [1])).status, 400);
    });

    it("rejects an oversized payload", async () => {
      const big = { text: "x".repeat(300 * 1024) };
      assert.equal((await hook("wf_expense_approval", "whsec_expense_774", big)).status, 413);
    });
  });

  describe("edge cases", () => {
    it("returns 422, not 500, for malformed definitions", async () => {
      for (const [name, overrides] of [
        ["limits", { limits: null }],
        ["nodes", { nodes: [null], entry: "n" }],
      ]) {
        const id = `wf_bad_${name}`;
        await call("POST", "/workflows", {
          body: { ...define(id, [notifyNode("n")]), ...overrides },
        });
        assert.equal((await call("POST", `/workflows/${id}/publish`)).status, 422, name);
      }
    });

    it("refuses a non-string secret or trigger when creating", async () => {
      const body = {
        ...define("wf_num", [notifyNode("n")]),
        trigger: { type: "webhook", secret: 123 },
      };
      assert.equal((await call("POST", "/workflows", { body })).status, 400);
      const noTrigger = { ...define("wf_null", [notifyNode("n")]), trigger: null };
      assert.equal((await call("POST", "/workflows", { body: noTrigger })).status, 400);
    });

    it("refuses null bytes in a body or URL", async () => {
      const body = { input: { x: "a\u0000b" } };
      assert.equal((await call("POST", "/workflows/wf_runaway/trigger", { body })).status, 400);
      assert.equal((await call("GET", "/runs/a%00b")).status, 400);
      assert.equal((await call("GET", "/workflows/a%00b")).status, 400);
    });

    it("filters runs by status", async () => {
      await call("POST", "/workflows/wf_runaway/trigger", { body: {} });
      assert.equal((await call("GET", "/runs?status=queued")).body.length, 1);
      assert.equal((await call("GET", "/runs?status=failed")).body.length, 0);
      assert.equal((await call("GET", "/runs?status=nope")).status, 400);
    });
  });

  describe("webhook content", () => {
    const raw = (headers, body) =>
      fetch(`${baseUrl}/hooks/wf_expense_approval`, {
        method: "POST",
        headers: { "X-Relay-Secret": "whsec_expense_774", ...headers },
        body,
      });

    it("refuses a body that isn't JSON, rather than starting an empty run", async () => {
      const response = await raw({ "Content-Type": "text/plain" }, '{"amount_usd": 500}');
      assert.equal(response.status, 415);
    });

    it("refuses a text body on a manual trigger too", async () => {
      const response = await fetch(`${baseUrl}/workflows/wf_runaway/trigger`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "text/plain" },
        body: '{"input": {"a": 1}}',
      });
      assert.equal(response.status, 415);
    });

    it("still allows publish with no body at all", async () => {
      const response = await fetch(`${baseUrl}/workflows/wf_runaway/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      assert.equal(response.status, 200);
    });

    it("refuses an empty body", async () => {
      assert.equal((await raw({ "Content-Type": "application/json" })).status, 400);
    });
  });

  describe("trigger settings", () => {
    const webhook = (id, secret, body = { a: 1 }) =>
      fetch(`${baseUrl}/hooks/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Relay-Secret": secret },
        body: JSON.stringify(body),
      });

    const webhookWorkflow = (id, trigger = { type: "webhook" }) => ({
      ...define(id, [notifyNode("n")]),
      trigger,
    });

    it("generates a secret once, and never returns or stores it", async () => {
      const created = await call("POST", "/workflows", { body: webhookWorkflow("wf_gen") });
      const secret = created.body.webhook_secret;
      assert.match(secret, /^whsec_/);

      const read = await call("GET", "/workflows/wf_gen");
      assert.equal(read.body.webhook_secret, undefined);
      assert.ok(!JSON.stringify(read.body).includes(secret));

      const { rows } = await database.query("SELECT * FROM workflows WHERE id = 'wf_gen'");
      assert.ok(!JSON.stringify(rows[0]).includes(secret));

      await call("POST", "/workflows/wf_gen/publish");
      assert.equal((await webhook("wf_gen", secret)).status, 202);
    });

    it("treats ******** as just a wrong secret", async () => {
      await call("POST", "/workflows", { body: webhookWorkflow("wf_star") });
      await call("POST", "/workflows/wf_star/publish");
      assert.equal((await webhook("wf_star", "********")).status, 401);
    });

    it("rotating stops the old secret at once", async () => {
      const { body } = await call("POST", "/workflows", { body: webhookWorkflow("wf_rot") });
      await call("POST", "/workflows/wf_rot/publish");
      const rotated = await call("POST", "/workflows/wf_rot/trigger/rotate-secret");
      assert.equal(rotated.status, 200);
      assert.equal((await webhook("wf_rot", body.webhook_secret)).status, 401);
      assert.equal((await webhook("wf_rot", rotated.body.webhook_secret)).status, 202);
    });

    it("refuses rotation without a webhook trigger", async () => {
      assert.equal((await call("POST", "/workflows/wf_runaway/trigger/rotate-secret")).status, 409);
    });

    it("turning a webhook off applies at publish, and manual still works", async () => {
      const { body } = await call("POST", "/workflows", { body: webhookWorkflow("wf_off") });
      await call("POST", "/workflows/wf_off/publish");
      const updated = await call("PUT", "/workflows/wf_off/trigger", {
        body: { type: "webhook", enabled: false },
      });
      assert.equal(updated.status, 200);
      assert.equal((await webhook("wf_off", body.webhook_secret)).status, 202);

      await call("POST", "/workflows/wf_off/publish");
      assert.equal((await webhook("wf_off", body.webhook_secret)).status, 409);
      assert.equal((await call("POST", "/workflows/wf_off/trigger", { body: {} })).status, 202);
    });

    it("rejects a bad cron at publish", async () => {
      await call("POST", "/workflows", { body: webhookWorkflow("wf_cronbad") });
      await call("PUT", "/workflows/wf_cronbad/trigger", {
        body: { type: "schedule", cron: "nope" },
      });
      const { status, body } = await call("POST", "/workflows/wf_cronbad/publish");
      assert.equal(status, 422);
      assert.equal(body.error.code, "invalid_trigger");
    });
  });

  describe("guardrail settings", () => {
    it("saves valid settings to the draft, leaving the published version alone", async () => {
      const { status, body } = await call("PUT", "/workflows/wf_runaway/guardrails", {
        body: { limits: { max_steps: 30 }, guardrails: { max_input_kb: 1 } },
      });
      assert.equal(status, 200);
      assert.equal(body.definition.limits.max_steps, 30);
      assert.equal(body.published_definition.limits.max_steps, 12);
      assert.equal(body.has_unpublished_changes, true);
    });

    it("rejects unsafe values and saves nothing", async () => {
      const { status, body } = await call("PUT", "/workflows/wf_runaway/guardrails", {
        body: { limits: { max_steps: 100000 } },
      });
      assert.equal(status, 422);
      assert.equal(body.error.code, "invalid_guardrails");
      const read = await call("GET", "/workflows/wf_runaway");
      assert.equal(read.body.definition.limits.max_steps, 12);
    });

    it("changing one setting keeps the others", async () => {
      await call("PUT", "/workflows/wf_expense_approval/guardrails", {
        body: { limits: { max_steps: 30 }, guardrails: { max_input_kb: 5 } },
      });
      const { body } = await call("PUT", "/workflows/wf_expense_approval/guardrails", {
        body: { guardrails: { strip_links_from_ai_text: false } },
      });
      assert.equal(body.definition.limits.max_steps, 30);
      assert.equal(body.definition.limits.max_ai_tokens, 0);
      assert.equal(body.definition.guardrails.max_input_kb, 5);
    });

    it("refuses an empty update", async () => {
      assert.equal(
        (await call("PUT", "/workflows/wf_runaway/guardrails", { body: {} })).status,
        400,
      );
    });

    it("enforces max_input_kb once published", async () => {
      await call("PUT", "/workflows/wf_runaway/guardrails", {
        body: { guardrails: { max_input_kb: 1 } },
      });
      await call("POST", "/workflows/wf_runaway/publish");
      const big = { input: { text: "x".repeat(2048) } };
      assert.equal(
        (await call("POST", "/workflows/wf_runaway/trigger", { body: big })).status,
        413,
      );
    });
  });

  it("GET /workflows includes the latest run", async () => {
    const { body: run } = await call("POST", "/workflows/wf_runaway/trigger", { body: {} });
    const { body } = await call("GET", "/workflows");
    const workflow = body.find(({ id }) => id === "wf_runaway");
    assert.equal(workflow.latest_run.run_id, run.run_id);
    assert.equal(workflow.latest_run.status, "queued");
    assert.equal(body.find(({ id }) => id === "wf_expense_approval").latest_run, null);
  });

  it("GET /sample-payloads lists a workflow's examples", async () => {
    const { status, body } = await call("GET", "/sample-payloads?workflowId=wf_expense_approval");
    assert.equal(status, 200);
    assert.deepEqual(
      body.map(({ id }) => id),
      ["pay_101", "pay_102"],
    );
    assert.equal(body[0].body.amount_usd, 250);
  });

  it("GET /catalog returns the node catalog", async () => {
    const { status, body } = await call("GET", "/catalog");
    assert.equal(status, 200);
    assert.equal(body.nodes.length, 7);
    assert.equal((await call("GET", "/catalog", { token: null })).status, 401);
  });

  describe("production behaviour", () => {
    const raw = (path, options = {}) => fetch(`${baseUrl}${path}`, options);
    const authed = { Authorization: `Bearer ${TOKEN}` };

    it("returns 4xx, not 500, for malformed requests", async () => {
      assert.equal((await raw("/runs/%E0", { headers: authed })).status, 400);
      const send = (headers) =>
        raw("/workflows", {
          method: "POST",
          headers: { ...authed, ...headers },
          body: '{"id":"x"}',
        });
      assert.equal((await send({ "Content-Type": "application/json; charset=foo" })).status, 415);
      const encoded = await send({ "Content-Type": "application/json", "Content-Encoding": "foo" });
      assert.equal(encoded.status, 415);
    });

    it("reports readiness, without a token", async () => {
      assert.equal((await raw("/ready")).status, 200);
    });

    it("reports not ready when the database is unreachable", async () => {
      const down = new HealthService({ query: () => Promise.reject(new Error("down")) });
      const broken = createApp({ services: { ...services, health: down }, demoToken: TOKEN });
      const listener = await new Promise((resolve) => {
        const instance = broken.listen(0, () => resolve(instance));
      });
      const response = await fetch(`http://localhost:${listener.address().port}/ready`);
      assert.equal(response.status, 503);
      await new Promise((resolve) => listener.close(resolve));
    });

    it("hides the framework and returns a request id", async () => {
      const response = await raw("/health");
      assert.equal(response.headers.get("x-powered-by"), null);
      assert.ok(response.headers.get("x-request-id"));
      const echoed = await raw("/health", { headers: { "X-Request-Id": "abc-123" } });
      assert.equal(echoed.headers.get("x-request-id"), "abc-123");
      const unsafe = await raw("/health", { headers: { "X-Request-Id": "a b" } });
      assert.notEqual(unsafe.headers.get("x-request-id"), "a b");
    });

    it("rate limits webhooks", async () => {
      const limited = createApp({ services, demoToken: TOKEN, webhooksPerMinute: 2 });
      const listener = await new Promise((resolve) => {
        const instance = limited.listen(0, () => resolve(instance));
      });
      const hook = () =>
        fetch(`http://localhost:${listener.address().port}/hooks/wf_expense_approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Relay-Secret": "wrong" },
          body: "{}",
        });
      assert.equal((await hook()).status, 401);
      assert.equal((await hook()).status, 401);
      const third = await hook();
      assert.equal(third.status, 429);
      assert.equal((await third.json()).error.code, "rate_limited");
      await new Promise((resolve) => listener.close(resolve));
    });

    it("pages through lists", async () => {
      const first = await call("GET", "/workflows?limit=2");
      const second = await call("GET", "/workflows?limit=2&offset=2");
      assert.equal(first.body.length, 2);
      assert.equal(second.body.length, 2);
      assert.notEqual(first.body[0].id, second.body[0].id);
      assert.equal((await call("GET", "/workflows?limit=9999")).status, 400);
      assert.equal((await call("GET", "/runs?offset=-1")).status, 400);
      assert.equal((await call("GET", "/approvals?limit=0")).status, 400);
    });

    it("keeps showing the live name until the next publish", async () => {
      await call("PUT", "/workflows/wf_runaway", {
        body: { ...define("wf_runaway", [notifyNode("n")]), name: "Not live yet" },
      });
      assert.equal(
        (await call("GET", "/workflows/wf_runaway")).body.name,
        "Poll until shipped (runaway)",
      );
      await call("POST", "/workflows/wf_runaway/publish");
      assert.equal((await call("GET", "/workflows/wf_runaway")).body.name, "Not live yet");
    });

    it("only changes secrets through rotation", async () => {
      const { status, body } = await call("PUT", "/workflows/wf_expense_approval", {
        body: {
          ...define("wf_expense_approval", [notifyNode("n")]),
          trigger: { type: "webhook", secret: "new" },
        },
      });
      assert.equal(status, 400);
      assert.equal(body.error.code, "secret_not_allowed");
    });

    it("saving limits doesn't add an empty guardrails block", async () => {
      const { body } = await call("PUT", "/workflows/wf_runaway/guardrails", {
        body: { limits: { max_steps: 12 } },
      });
      assert.equal(body.definition.guardrails, undefined);
      assert.equal(body.has_unpublished_changes, false);
    });

    it("masks sensitive headers in traces and snapshots", async () => {
      const id = "wf_headers";
      const node = {
        id: "h",
        type: "http_request",
        params: {
          method: "GET",
          url: "http://w/x",
          headers: { Authorization: "Bearer SUPERSECRET", Accept: "text/plain" },
        },
        next: null,
      };
      await call("POST", "/workflows", { body: define(id, [node]) });
      await call("POST", `/workflows/${id}/publish`);
      const { body } = await call("POST", `/workflows/${id}/trigger`, { body: {} });
      await database.query(
        `INSERT INTO steps (run_id, sequence, node_id, node_type, status, resolved_input)
         VALUES ($1, 1, 'h', 'http_request', 'running', $2)`,
        [body.run_id, node.params],
      );
      const run = await call("GET", `/runs/${body.run_id}`);
      assert.ok(!JSON.stringify(run.body).includes("SUPERSECRET"));
      assert.equal(run.body.steps[0].input.headers.Accept, "text/plain");
    });
  });

  describe("sign in", () => {
    const login = (email, password) =>
      call("POST", "/auth/login", { token: null, body: { email, password } });

    beforeEach(() => services.auth.ensureUser("Admin@Example.com", "correct-password"));

    it("returns a JWT for the right password, which then works", async () => {
      const { status, body } = await login("admin@example.com", "correct-password");
      assert.equal(status, 200);
      assert.equal(body.email, "admin@example.com");
      const me = await call("GET", "/auth/me", { token: body.token });
      assert.equal(me.body.email, "admin@example.com");
      assert.equal((await call("GET", "/workflows", { token: body.token })).status, 200);
    });

    it("gives the same answer for a wrong password and an unknown email", async () => {
      const wrong = await login("admin@example.com", "wrong-password");
      const unknown = await login("nobody@example.com", "correct-password");
      assert.equal(wrong.status, 401);
      assert.deepEqual(wrong.body, unknown.body);
    });

    it("never stores or returns the password", async () => {
      const { rows } = await database.query("SELECT password_hash FROM users");
      assert.ok(!rows[0].password_hash.includes("correct-password"));
      const { body } = await login("admin@example.com", "correct-password");
      assert.ok(!JSON.stringify(body).includes("correct-password"));
    });

    it("refuses expired, tampered and wrongly signed tokens", async () => {
      const claims = { sub: "admin@example.com" };
      const expired = jwt.sign(claims, JWT_SECRET, { expiresIn: -10 });
      const wrongKey = jwt.sign(claims, "another-secret-another-secret-another");
      const unsigned = jwt.sign(claims, "", { algorithm: "none" });
      const { body } = await login("admin@example.com", "correct-password");
      for (const token of [expired, wrongKey, unsigned, `${body.token}x`, "garbage"]) {
        assert.equal((await call("GET", "/workflows", { token })).status, 401, token);
      }
    });

    it("uses the new password after it changes in the config", async () => {
      await services.auth.ensureUser("admin@example.com", "changed-password");
      assert.equal((await login("admin@example.com", "correct-password")).status, 401);
      assert.equal((await login("admin@example.com", "changed-password")).status, 200);
    });

    it("rejects a malformed sign-in", async () => {
      assert.equal((await call("POST", "/auth/login", { token: null, body: {} })).status, 400);
    });

    it("limits repeated sign-in attempts", async () => {
      let status;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        ({ status } = await login("admin@example.com", "wrong-password"));
      }
      assert.equal(status, 429);
    });
  });

  it("records the signed-in person as the decider", async () => {
    await services.auth.ensureUser("approver@example.com", "correct-password");
    const { token } = await services.auth.login("approver@example.com", "correct-password");
    const definition = define("wf_decider", [
      { id: "gate", type: "approval", params: { message: "OK?" }, next: null },
    ]);
    await call("POST", "/workflows", { body: definition });
    await call("POST", "/workflows/wf_decider/publish");
    const { body: run } = await call("POST", "/workflows/wf_decider/trigger", { body: {} });
    await database.query("UPDATE runs SET status = 'waiting_approval' WHERE run_id = $1", [
      run.run_id,
    ]);
    await database.query(
      "INSERT INTO approvals (id, run_id, node_id, sequence, message, status) VALUES ('apr_d', $1, 'gate', 1, 'OK?', 'pending')",
      [run.run_id],
    );
    const decided = await call("POST", "/approvals/apr_d/approve", { token });
    assert.equal(decided.body.decided_by, "approver@example.com");
  });

  it("returns 404 for an unknown route, even without a token", async () => {
    assert.equal((await call("GET", "/nope", { token: null })).status, 404);
  });

  it("rejects an unknown approval status", async () => {
    assert.equal((await call("GET", "/approvals?status=nope")).status, 400);
    assert.equal((await call("GET", "/approvals?status=closed")).status, 200);
  });

  it("filters runs by workflow", async () => {
    await call("POST", "/workflows/wf_runaway/trigger", { body: {} });
    assert.equal((await call("GET", "/runs?workflowId=wf_runaway")).body.length, 1);
    assert.equal((await call("GET", "/runs?workflowId=wf_expense_approval")).body.length, 0);
  });

  it("reports health without a token", async () => {
    assert.equal((await call("GET", "/health", { token: null })).status, 200);
  });

  it("returns 404 for unknown resources", async () => {
    assert.equal((await call("GET", "/runs/nope")).status, 404);
    assert.equal((await call("POST", "/approvals/nope/approve")).status, 404);
    assert.equal((await call("POST", "/workflows/nope/trigger", { body: {} })).status, 404);
  });
});
