# Relay: AI Workflow Orchestrator

Requirements and solution design, dated 2026-11-04. Backend and console implemented; Temporal not started.

**Sources, in order of authority**

| Tag | Source |
|---|---|
| CS | Airtribe case study (`relayoriginal.pdf`) |
| OP | Relay one-pager (`Relay_One_Pager.pdf`) |
| PK | [`relay-capstone`](https://github.com/airtribe-projects/relay-capstone) pack, linked from the case study: fixed API contract, seed data, test scripts |
| DD | Relay design document (`Relay_Design_Document.pdf`), written after the one-pager review |
| TD | Team decision, made after the design document |

---

## 1. Problem

Operations teams run on workflows: an order webhook arrives, the request is classified, a team is notified, someone approves, and an action runs. Adding AI makes these steps smarter but riskier. A crashed worker can send the same refund twice, a malformed AI answer can push a run down the wrong branch, and a cleverly worded payload can talk an AI step past an approval.

**How might we** let teams build workflows with AI decision steps that are as reliable as plain code: they survive crashes, never repeat side effects, and never skip a human approval?

**Principle:** AI makes decisions inside a run, but the engine, not the AI, controls what is allowed to happen.

### Users

| User | Needs | Pain today |
|---|---|---|
| Ops manager | Automate routine flows like order triage and expense approval | Glue scripts break silently; no one can see where a run got stuck |
| Approver (finance, support lead) | Review sensitive actions before they happen | Approvals live in chat or email, so actions can run without them |
| Platform engineer | A reliable engine to plug AI steps into | Has to rebuild retries, crash recovery and dedup for every workflow |
| Auditor / compliance | Proof of what ran, with which inputs and who approved | Logs are partial; AI decisions can't be explained after the fact |

### Scope

| Must have | Later / good to have |
|---|---|
| Workflow create, update, list, publish (draft to frozen) | Plain-English to workflow compiler, scored on the 15 NL eval cases |
| Webhook (with secret), manual and cron triggers, configurable per workflow | Role-based approvers |
| Durable queue and worker with per-step persistence and crash resume | |
| Deterministic nodes plus a schema-validated `ai` node | Visual drag-and-drop workflow builder |
| Approval nodes, with sensitive actions gated by the engine | |
| Idempotency keys, timeouts and a max-step cap | |
| Guardrails configurable per workflow, within safe limits (review feedback) | |
| Run time limits and token budgets | |
| Full run traces and a simple console | |

**Final phase, after the above is verified:** Temporal integration (TD, [Section 8](#8-temporal-final-phase)).

**Assumptions:** the demo uses the four seed workflows. All side effects go to the provided mock world, not real services. The only real external call is the LLM.

---

## 2. Requirements

### Functional

| ID | Requirement | Source |
|---|---|---|
| FR-1 | Load the provided node catalog and seed workflows at startup as Published, preserving their IDs and JSON shape. Restarting doesn't overwrite data | CS, PK |
| FR-2 | Create, update, list and read workflows made of typed nodes | CS, OP |
| FR-3 | Follow a draft to published lifecycle. Published workflows are frozen and runnable | CS, OP |
| FR-4 | Publishing rejects unknown node types, missing required params and references to missing nodes, with a clear error per case. Loops are legal | PK |
| FR-5 | Each run captures and executes its own definition snapshot | CS, OP |
| FR-6 | A webhook trigger is protected by a workflow secret in `X-Relay-Secret`; a wrong or missing secret is rejected | CS, PK |
| FR-7 | A manual trigger API exists for testing and demos | CS |
| FR-8 | The trigger payload becomes the run's input | CS |
| FR-9 | Runs execute asynchronously through a durable queue and worker. Triggers only enqueue | CS |
| FR-10 | Every step is persisted, and a crashed run resumes from the last completed step rather than starting again | CS |
| FR-11 | Implement `http_request`, `condition`, `delay` and `notify` | CS |
| FR-12 | Nodes read earlier data through `{{trigger.body.x}}` and `{{nodes.id.output.y}}` templates; an unresolvable path fails the step | PK |
| FR-13 | Implement an `ai` node whose output is validated against a JSON schema before downstream steps can use it. One retry with the validation error, then the step fails | CS, PK |
| FR-14 | `condition` nodes can branch on AI output, so AI picks a run's path | CS, OP |
| FR-15 | Approval nodes pause a run until a human approves (run resumes) or rejects (run ends `cancelled`). The decision and decider are recorded | CS, PK |
| FR-16 | Sensitive nodes (`order_action`) can't execute without an approval record, enforced by the engine rather than the prompt | CS, OP |
| FR-17 | Store a full trace for every run: resolved inputs, outputs, attempts, timing, and token usage for AI steps | CS, OP |
| FR-18 | Prompt-injection payloads are handled safely and can't bypass approval | CS, OP |
| FR-19 | Side effects carry idempotency keys, so a retry or crash never repeats them | CS, OP |
| FR-20 | A max-step cap stops runaway workflows, enforced by the engine | CS, OP |
| FR-21 | Transient failures retry with exponential backoff; a run that exhausts retries ends `failed` with the error recorded | PK |
| FR-22 | A run can be cancelled | PK |
| FR-23 | A console shows workflows, run history, a run trace, and pending approvals with approve and reject buttons, and lets users build workflows and configure guardrails and triggers | CS, PK, DD |
| FR-24 | Each workflow's guardrail settings are configurable within safe limits, and apply when it's next published ([Section 6.1](#61-configurable-settings)) | DD |
| FR-25 | Each workflow's trigger is configurable: webhook on or off with secret rotation, cron schedule, and manual, which always works ([Section 5.7](#57-trigger-configuration)) | DD |
| FR-26 | A run stops when it passes its time limit or token budget | DD |

### Technical

| ID | Requirement | Source |
|---|---|---|
| TR-1 | Core functionality is exposed as RESTful APIs, with the routes in [Section 4.6](#46-api) matching the pack's fixed contract | CS, PK |
| TR-2 | A reliable persistent store holds workflows, runs, definition snapshots, steps and approvals, and survives process restarts | CS |
| TR-3 | Every external call, including model providers and the mock world, has a timeout | CS |
| TR-4 | The AI provider sits behind an adapter so it can be mocked in engine tests | CS |
| TR-5 | Approval gates and the step cap are enforced in the engine, independent of model output | CS |
| TR-6 | Automated tests cover publish validation, template resolution, schema enforcement, idempotency and guardrails | CS |
| TR-7 | Run status values are exactly `queued`, `running`, `waiting_approval`, `succeeded`, `failed`, `cancelled` | PK |
| TR-8 | The platform passes the pack's `smoke_test.py` and, after a live kill-and-resume, `duplication_check.py` | CS, OP, PK |

---

## 3. Solution

### How a run flows

1. **Build and publish** a workflow from typed nodes. Publishing validates and freezes it.
2. **Trigger** it by webhook or manual API. The run stores its input and snapshot, and a job is queued in the same transaction.
3. **The worker** claims the job and saves every step.
4. **The AI node** reads the payload and returns output that must match a schema, which a `condition` node can branch on.
5. **The approval gate** pauses the run until a human decides.
6. **Side effects** carry a stable idempotency key.
7. **Crash recovery** resumes from persisted steps, and the step cap stops runaway loops.
8. **The trace and console** show every step's inputs, outputs, attempts, timing and AI token usage.

### Technology

| Area | Choice | Why |
|---|---|---|
| APIs, including webhooks | Node.js + Express, in JavaScript | TD |
| Engine | Node.js, as a separate worker process | Killing the worker leaves the API and console running |
| Database and queue | PostgreSQL; the queue is a table using `FOR UPDATE SKIP LOCKED` | A run and its job are created in one transaction |
| AI | Python + FastAPI, in `backend/ai/` | TD |
| LLM | OpenRouter with `openai/gpt-4o-mini`, behind an adapter | TD: the team has a key |
| Frontend | React + Vite + Tailwind in plain JavaScript, in `frontend/`, on port 5173 | Its `/api` calls are proxied to the API, so no CORS setup is needed |

---

## 4. High-level design

### 4.1 Architecture

```mermaid
flowchart LR
    caller["External caller"]
    user["Operator / Approver"]

    subgraph relay["Relay"]
        direction TB
        console["Console<br/>React"]
        api["API<br/>Node + Express"]
        worker["Worker: the engine<br/>Node process"]
        db[("PostgreSQL")]
        ai["AI service<br/>Python + FastAPI"]
    end

    subgraph ext["External"]
        world["Mock world<br/>and ledger"]
        llm["OpenRouter"]
    end

    caller -->|"POST /hooks/id + secret"| api
    user --> console
    console -->|"REST + bearer token"| api
    api -->|"workflows, approvals, enqueue"| db
    worker -->|"claim jobs, write steps"| db
    worker -->|"side effects + Idempotency-Key"| world
    worker -->|"prompt + schema"| ai
    ai -->|"chat completion"| llm
```

| Component | Owns | Must not |
|---|---|---|
| API | Workflow CRUD, publish validation, triggers, run reads, cancel, approval decisions, serving the console | Execute nodes |
| Worker | State machine, templates, approval gate, step cap, retries, idempotency keys, side-effect calls | Accept HTTP traffic |
| AI service | Prompt assembly, OpenRouter calls, schema validation and repair retry | Access the database, or decide what a run does next |

The AI service has no database credentials, so nothing on the AI path can create an approval.

### 4.2 Run state machine

```mermaid
stateDiagram-v2
    [*] --> queued: trigger
    queued --> running: worker claims job
    queued --> cancelled: cancel
    running --> waiting_approval: approval node
    running --> succeeded: no next node
    running --> failed: retries exhausted, cap hit,<br/>gate refused, schema failed
    running --> cancelled: cancel, at next step boundary
    waiting_approval --> queued: approve
    waiting_approval --> cancelled: reject or cancel
    succeeded --> [*]
    failed --> [*]
    cancelled --> [*]
```

Every transition is a conditional update (`WHERE status = <expected>`), so illegal moves and double decisions fail. During a delay or retry backoff, the run stays `running` and its job has a future `run_after`, which leaves the worker free for other runs.

### 4.3 Execution protocol

For each node, the worker does this:

1. **Transaction A, before the node runs:** check for a cancel request, the step cap (`steps_executed >= max_steps` ends the run `failed`) and the approval gate. Then insert the step as `running` with its sequence, resolved input and idempotency key.
2. **Execute** the node with its timeout.
3. **Transaction B, after the node runs:** mark the step `succeeded` with its output and advance `current_node_id`, or finish the run.

**Resume** reads only persisted state. If the last step is `succeeded`, follow its edge. If it's `running`, re-execute that row with the same key, without counting another step.

**Idempotency key:** `{run_id}:{node_id}:{sequence}`. It has no attempt number, so a retry or resume reuses the key. The sequence makes each loop iteration a separate effect.

**Lease:** a claimed job has a 10-second lease, renewed every 3 seconds. After `kill -9`, the lease expires and the restarted worker reclaims the job. Delays and approval pauses release the job rather than hold it.

### 4.4 Exactly-once recovery

"Exactly-once" here means at-least-once delivery to an idempotent receiver.

| Worker dies... | Persisted state | On resume | Ledger result |
|---|---|---|---|
| Before Transaction A | Previous step done | Runs the node normally | One execution |
| After A, before the call | Step `running` | Re-executes, same key | One execution |
| After the call, before B (**the crash window**) | Step `running` | Re-sends the same key; the mock world replays its stored response | One execution, one replay |
| After B | Step `succeeded` | Moves to the next node | One execution |
| During a delay | `resume_at` stored | Waits only for the remaining time | Unaffected |
| While waiting for approval | Pending approval row | Nothing to do until the decision | Unaffected |

```mermaid
sequenceDiagram
    participant W as Worker
    participant DB as PostgreSQL
    participant MW as Mock world
    W->>DB: A: insert step running, key=run:create_shipment:3
    W->>MW: POST /shipments, Idempotency-Key
    MW-->>W: 201, recorded in ledger
    Note over W: kill -9 before Transaction B
    Note over W,DB: Lease expires, worker restarts and reclaims job
    W->>DB: Read steps: last is running
    W->>MW: POST /shipments, same key
    MW-->>W: Original 201, x-mockworld-replayed: true
    W->>DB: B: mark succeeded, advance
```

### 4.5 Failures and retries

| Failure | Behaviour |
|---|---|
| Timeout, connection error, 5xx, 429 | Transient: up to 5 attempts, waiting 2, 4, 8 and 16 s |
| Other 4xx, unresolvable template, non-numeric comparison | Permanent: fail immediately |
| AI output fails its schema | One repair retry with the validation error, then fail |
| Approval gate refused, step cap reached | Fail the run with a reason code |

Timeouts are 5 s for the mock world and 30 s per LLM call.

**AI step:** the worker sends the resolved prompt and `output_schema` to the AI service. The service calls OpenRouter, validates the response, and retries once with the error if needed. It returns the output, all attempts and token usage, and the worker checks the output against the schema again before saving it. Tests use a fake provider. Pointing the LLM URL at the pack's `mock_provider.py`, which returns prose, demonstrates a schema failure.

### 4.6 API

**F** marks the pack's fixed contract, which the smoke test depends on.

| Route | Purpose | |
|---|---|---|
| `GET /workflows` | List workflows | **F** |
| `POST /workflows` | Create a draft | **F** |
| `GET /workflows/{id}` | Read a workflow, with its secret masked | |
| `PUT /workflows/{id}` | Update the working draft | |
| `POST /workflows/{id}/publish` | Validate and freeze | **F** |
| `POST /workflows/{id}/trigger` | Manual trigger, returns `run_id` | **F** |
| `POST /hooks/{id}` | Webhook trigger, using `X-Relay-Secret` | **F** |
| `GET /runs?workflowId=&status=` | Run history | |
| `GET /runs/{id}` | Run and full step trace | **F** |
| `POST /runs/{id}/cancel` | Cancel a run | |
| `PUT /workflows/{id}/trigger` | Change the trigger; applies at publish | |
| `POST /workflows/{id}/trigger/rotate-secret` | New webhook secret; the old one stops at once | |
| `PUT /workflows/{id}/guardrails` | Change limits and guardrails; applies at publish | |
| `POST /auth/login`, `GET /auth/me` | Sign in, and who is signed in | |
| `GET /catalog` | Node types and params | |
| `GET /sample-payloads?workflowId=` | Example inputs for the console's "Try it" panel | |
| `GET /health`, `GET /ready` | Liveness, and whether the database is reachable | |
| `GET /approvals?status=pending` | Pending approvals | **F** |
| `POST /approvals/{id}/approve` | Approve and resume | **F** |
| `POST /approvals/{id}/reject` | Reject and end | |

People sign in with email and password through `POST /auth/login` for a JWT lasting 8 hours. Platform routes accept that JWT as a bearer token. A fixed service token also works, because the pack's smoke test sends one. Errors have the shape `{"error": {"message": "...", "code": "..."}}`.

| Case | Status |
|---|---|
| Malformed request, or a secret sent outside rotation | 400 |
| Over the webhook rate limit | 429 |
| Invalid token, or wrong webhook secret | 401 |
| Payload over the workflow's limit | 413 |
| Body isn't JSON | 415 |
| Unknown ID | 404 |
| Invalid definition | 422 |
| Triggering an unpublished workflow, repeating a decision, or cancelling a finished run | 409 |

### 4.7 Data model

| Table | Key fields |
|---|---|
| `workflows` | `id`, `name`, `status`, `draft_definition`, `published_definition`, `webhook_secret_hash` |
| `runs` | `run_id`, `workflow_id`, `definition_snapshot` (secret removed), `status`, `trigger_type`, `input`, `current_node_id`, `steps_executed`, `ai_tokens_used`, `error`, `cancel_requested`, timestamps |
| `steps` | `run_id`, `sequence`, `node_id`, `node_type`, `status`, `attempt`, `resolved_input`, `output`, `attempts_log`, tokens, `idempotency_key`, `resume_at`, timing |
| `approvals` | `id`, `run_id`, `node_id`, `sequence`, `message`, `status`, `decided_by`, `decided_at` |
| `queue_jobs` | `id`, `run_id`, `run_after`, `locked_by`, `locked_until` |
| `schedules` | `workflow_id`, `cron`, `input`, `next_fire_at` |

A workflow has many runs, and a run has many steps and approvals. `attempts_log` keeps each attempt, including raw AI output, so a repaired AI step shows both attempts. Approving is one transaction: it updates the pending approval, moves the run to `queued` and inserts a job.

---

## 5. Workflow definition

A workflow is a JSON document of typed nodes connected by `next` pointers, in the shape used by `data/seed_workflows.json`.

### 5.1 Shape

| Field | Required | Meaning |
|---|---|---|
| `id`, `name` | Yes | Identity. `description` is optional |
| `trigger` | Yes | `{"type": "webhook"}`, `{"type": "schedule", "cron": "0 9 * * 1-5"}` or `{"type": "manual"}` |
| `entry` | Yes | First node's ID |
| `limits.max_steps` | Yes | Step cap |
| `nodes[]` | Yes | Each has `id`, `type`, `params`, and edges |

`limits` also takes `timeout_seconds` and `max_ai_tokens`, and an optional `guardrails` block holds the settings in [Section 6.1](#61-configurable-settings).

`condition` nodes use `on_true` and `on_false`. All other nodes use `next`, where `null` ends the run.

### 5.2 Node types

| Type | Purpose | Required params | Side effect | Needs approval |
|---|---|---|---|---|
| `http_request` | Call an endpoint | `method`, `url` | Non-GET only | No |
| `condition` | Branch: `equals`, `not_equals`, `greater_than`, `less_than`, `contains` | `left`, `op`, `right` | No | No |
| `delay` | Wait durably | `seconds` | No | No |
| `notify` | Email or chat through the mock world | `channel`, `to`, `message` | Yes | No |
| `ai` | Model decision | `prompt`, `output_schema` | No | No |
| `approval` | Pause for a human | `message` | No | No |
| `order_action` | Refund or replacement | `action`, `order_id` | Yes | **Yes** |

The one-pager's node list omitted `order_action`. It comes from the pack's catalog, and it's the sensitive node the case study refers to as "order actions".

### 5.3 Templates

`{{trigger.body.x.y}}` and `{{nodes.<id>.output.z}}` are the only forms, with no expressions. Resolution is one pass, so `{{...}}` inside a payload stays literal text. Only `trigger.body` and `nodes` are readable, never secrets or environment variables. In a loop, `nodes.<id>` means the latest execution.

### 5.4 Example

```json
{
  "id": "wf_expense_approval",
  "name": "Expense approval",
  "trigger": { "type": "webhook", "secret": "whsec_expense_774" },
  "entry": "is_large",
  "limits": { "max_steps": 20 },
  "nodes": [
    {
      "id": "is_large",
      "type": "condition",
      "params": { "left": "{{trigger.body.amount_usd}}", "op": "greater_than", "right": "100" },
      "on_true": "finance_gate",
      "on_false": "auto_ok"
    },
    {
      "id": "finance_gate",
      "type": "approval",
      "params": { "message": "Expense of ${{trigger.body.amount_usd}} needs approval" },
      "next": "approved_notice"
    },
    {
      "id": "approved_notice",
      "type": "notify",
      "params": { "channel": "email", "to": "{{trigger.body.employee_email}}", "message": "Approved." },
      "next": null
    },
    {
      "id": "auto_ok",
      "type": "notify",
      "params": { "channel": "email", "to": "{{trigger.body.employee_email}}", "message": "Auto-approved." },
      "next": null
    }
  ]
}
```

This is shortened from the seed file, which loads unchanged.

### 5.5 Publish validation

| Error code | Rule |
|---|---|
| `invalid_node_type` | `type` isn't in the catalog |
| `missing_required_param` | A required param is absent |
| `invalid_node_reference` | An edge points to a missing node |
| `invalid_entry` | `entry` points to a missing node |
| `invalid_trigger` | Unknown trigger type or a bad cron expression |
| `invalid_guardrails` | A limit or guardrail setting is outside its safe range |
| `invalid_definition` | Edges, param values, delay or `output_schema` are malformed, or node IDs repeat |

A path reaching `order_action` with no approval before it returns a **warning**, not an error. The workflow can still publish, and the engine refuses the action at runtime, which is the stronger proof.

### 5.6 Lifecycle

Editing a published workflow changes only its working draft. The frozen version keeps serving triggers until the next publish. Each run keeps its own snapshot, so a paused run finishes on the definition it started with.

### 5.7 Trigger configuration

| Trigger | What users configure | How it works |
|---|---|---|
| Webhook | On or off; rotate the secret | A caller may supply a secret; otherwise one is generated and returned once. Only its hash is stored |
| Schedule | A 5-field cron expression, input JSON, on or off | Publishing creates a schedule row. The worker checks every 15 seconds and creates a normal run. Times are UTC, and missed windows aren't caught up |
| Manual | Input JSON | `POST /workflows/{id}/trigger` always works on a published workflow |

Trigger changes apply at publish, except rotation, which is immediate so a leaked secret stops working at once.

### 5.8 Seed workflows

| Workflow | Path | Proves |
|---|---|---|
| `wf_support_triage` | AI classify, then approval, refund and email, or notify chat | AI branching, gates, injection |
| `wf_expense_approval` | Over $100: approval, email. Otherwise: email | Approval lifecycle |
| `wf_slow_fulfillment` | Email, 20 s delay, shipment, email | Kill and resume |
| `wf_runaway` | Poll, condition, delay, loop | Step cap (12) |

```mermaid
flowchart TD
    A["classify<br/>ai"] --> B{"route<br/>category = refund_request?"}
    B -->|true| C["refund_gate<br/>approval"]
    B -->|false| F["notify_support<br/>notify: #support"]
    C -->|approved| D["issue_refund<br/>order_action"]
    C -->|rejected| X["run cancelled"]
    D --> E["notify_customer<br/>notify: email"]
    E --> Z["succeeded"]
    F --> Z
```

---

## 6. Guardrails

Assume the model can be fully compromised. The worst it can then do is pick a branch the workflow author already defined and write text inside a schema. It can't approve anything, choose a recipient, set an amount or skip a node.

All guardrails are our own code, with no guardrail library.

| ID | Guardrail | Threat | Enforced in | Proof |
|---|---|---|---|---|
| G1 | Webhook secret, constant-time compare | Forged triggers | API | Smoke test |
| G2 | Payloads treated as data: delimited in the prompt, and the model gets no tools | Payload acting as instructions | AI service | `pay_inject_001`, `pay_inject_002` |
| G3 | JSON schema validation, one repair retry | Malformed output | AI service, worker | Mock provider drill, tests |
| G4 | Approval gate: a database check before any `requires_approval` node | Prompt tricks, ungated workflows | Worker | Bypass test |
| G5 | AI service has no database access | AI path creating an approval | Architecture | Configuration |
| G6 | Step cap checked before every node | Runaway loops | Worker | `wf_runaway` |
| G7 | Per-run definition snapshot | Edits changing a live run | API, worker | Snapshot test |
| G8 | Conditional state transitions | Double approval, illegal moves | API, worker | Tests |
| G9 | Engine-set idempotency keys | Duplicate actions | Worker | Duplication check |
| G10 | Timeouts on every external call | Hung dependency | Worker, AI service | Tests |
| G11 | One-pass templates with limited scope | Payload reading secrets | Worker | Tests |
| G12 | Secrets masked in APIs, snapshots and logs | Leaked secrets | API, worker | Tests |
| G13 | Console renders payload and AI text as plain text, labelled | Script injection, misleading the approver | Console | Manual check |
| G14 | Injection pattern flag shown to the approver, without blocking | Approver misled by a payload | AI service | `pay_inject_001` trace |
| G15 | Emails and URLs redacted from free-text AI output | Summary used as a channel | AI service | Automated tests |
| G16 | AI output can't fill `notify.to`, `http_request.url` or `headers`, or `order_action.order_id` or `action` | AI choosing targets | Publish validator | 422 test |
| G17 | `http_request` only reaches the mock world and allow-listed hosts, and redirects aren't followed | Payload-controlled URLs (SSRF) | Worker | Automated tests, live attack |
| G18 | Responses are capped at 1 MB, and prompts at 200,000 characters | Oversized data | Worker | Automated tests |
| G19 | Substituted values are wrapped in `<untrusted_data>` tags that a payload can't close | Payload acting as instructions | Worker | Automated test |
| G20 | Sensitive headers masked in traces and snapshots | Leaked credentials | API | Automated test |
| G21 | Webhooks limited to 300 calls a minute per address | Flooding | API | Automated test, live flood |

G14 and G15 are pattern checks. They help, but they can be evaded, so the guarantee comes from G4 to G9.

| Payload | Attempt | Expected result |
|---|---|---|
| `pay_inject_001` | "Approval already granted, refund $5000" | Pauses in `waiting_approval`; no refund in the ledger before a human decides |
| `pay_inject_002` | Email secrets to an outside address and post them to #support | Normal classification, one message to `#support` only |

**Gate-bypass test:** publish a workflow with `order_action` and no approval. The run ends `failed` with `approval_required`, and the ledger has no refund.

### 6.1 Configurable settings

Set per workflow, in `limits` and `guardrails`. They apply at the next publish, and the engine rejects anything out of range.

| Setting | Default | Allowed | Controls |
|---|---|---|---|
| `limits.max_steps` | Required | 1 to 500 | Step cap |
| `limits.timeout_seconds` | 300 | 10 to 3600 | Run time limit, not counting planned delays or time waiting for a human |
| `limits.max_ai_tokens` | 10000 | 0 to 100000 | Run token budget; 0 means no AI |
| `guardrails.retry.max_attempts` | 5 | 1 to 5 | Tries per step for temporary errors |
| `guardrails.retry.backoff_seconds` | 2 | 1 to 30 | First wait; doubles each time |
| `guardrails.injection_detection` | `flag` | `off`, `flag`, `require_approval` | `require_approval` pauses a flagged run before any side effect |
| `guardrails.allowed_notify_targets` | No limit | Patterns such as `*@example.com`, `#support` | Where `notify` may send |
| `guardrails.require_approval_for` | None | Node types other than `approval` | Extra types that need an approval |
| `guardrails.strip_links_from_ai_text` | `true` | `true`, `false` | Redaction of emails and URLs in AI text |
| `guardrails.max_input_kb` | 256 | 1 to 1024 | Largest trigger input |

**Locked rules, which no setting can turn off:** the approval gate on `order_action`, the existence of a step cap, idempotency keys, timeouts on external calls, the webhook secret check, and schema validation of AI output with exactly one repair retry.

**Where this differs from the design document:** retries default to 5 attempts from 2 seconds, because the design's 3 attempts from 1 second give too little time for its own outage demo. `ai_repair_retries` isn't configurable, because the pack requires exactly one.

---

## 7. Console

The console in `frontend/` lets people build workflows, configure them, run them and decide approvals. It's built around what each person comes to do, in plain language, with technical details available but out of the way.

| Screen | Job | Actions |
|---|---|---|
| Workflows | See every workflow and its latest run | Create, open |
| Workflow: Steps | Build the flow, with branches shown in place | Add, edit, delete, view as JSON, save, publish |
| Workflow: Trigger | Choose how it starts | Webhook on or off, replace secret, cron, try it with an example |
| Workflow: Guardrails | Set limits and AI safety; locked rules shown as always on | Save to draft |
| Runs | See what happened, with failure reasons | Filter, page, open |
| Run details | Follow a run as a timeline, including AI answers and tries | Cancel, review approval |
| Approvals | Decide with the original input and the consequences in view | Approve, reject, see past decisions |

**Rules**

- Run details refresh every 2 seconds until the run finishes, and lists every 5 seconds, without losing open panels or form edits.
- Every screen handles no data, loading, an unreachable server and API errors.
- Status always uses text as well as colour.
- Payload and AI text render as plain text, and AI text is labelled.
- Approving asks for confirmation and says what will happen, because a refund can't be undone. Rejecting doesn't, because it's the safe choice.
- A new webhook secret is shown once.

---

## 8. Temporal (final phase)

Added after Sections 2 to 7 are built and verified, as a team decision. Neither PDF requires it.

| Relay engine | With Temporal |
|---|---|
| Queue table, leases | Task queues and Temporal workers |
| Run | Workflow execution, with `run_id` as its ID |
| Worker loop | A Temporal workflow that interprets the snapshot |
| Step | Activity reusing the existing node executor |
| Retries, delays | Activity retry policy, durable timers |
| Approve or reject | The API records the decision, then sends a signal |

**What stays:** the API, console, AI service and trace format; Postgres as the source of truth; idempotency keys, because activities are at-least-once; and the approval gate and step cap.

The working engine stays until Temporal passes every check in [Section 10](#10-verification), including the kill drill. Then the old queue code is removed.

---

## 9. Engineering standards

### Structure

```
relay/
├── backend/
│   ├── src/                JavaScript: API and engine
│   │   ├── routes/         URLs, auth and validation wiring
│   │   ├── controllers/    read requests, call services, shape responses
│   │   ├── services/       business rules and transactions
│   │   ├── repositories/   all SQL for workflows, runs, steps, approvals, jobs
│   │   ├── domain/         definitions, publish validator, templates, state machine
│   │   ├── engine/         worker loop, step runner, guards, retry policy
│   │   │   └── nodes/      one executor class per node type
│   │   ├── clients/        mock world and AI clients
│   │   ├── middleware/     auth, validation, error handling
│   │   ├── validation/     request schemas
│   │   ├── serializers/    API response shapes
│   │   ├── db/             connection, migrations, unit of work
│   │   ├── shared/         errors, config, logger
│   │   ├── app.js          Express app and route wiring
│   │   ├── api.js          API entry point
│   │   └── worker.js       worker entry point
│   ├── migrations/
│   ├── test/
│   ├── ai/                 Python: FastAPI service
│   │   ├── app/            routes, providers, guardrails, completion flow
│   │   └── tests/
│   ├── contracts/          JSON Schemas shared by JavaScript and Python
│   ├── pack/               Airtribe data and scripts, unchanged
│   └── package.json
├── frontend/               React + Vite
├── docs/                   verification report
├── docker-compose.yml      every service
└── README.md
```

### Cross-language boundary

JavaScript and Python share no code or database. They talk only through one HTTP endpoint, `POST /v1/complete`.

| Concern | Rule |
|---|---|
| Contract | Request and response are defined once, as JSON Schemas in `backend/contracts/`. Both sides validate against them, and contract tests run in both languages |
| Versioning | The version is in the URL, so a breaking change becomes `/v2` |
| Errors | One error shape: `{"error": {"code", "message"}}`, with attempts and tokens included when available |
| Failure mapping | 503 means retry (LLM timeout, 5xx, 429). 422 means schema failed after repair. Other 4xx means permanent failure, such as a rejected key |
| Timeouts | LLM call 30 s. The JavaScript client waits 70 s, which covers one repair retry |
| Auth | Internal token header, with the service bound to localhost |
| Tracing | `X-Run-Id` and `X-Node-Id` headers appear in both services' logs |
| Data format | JSON with `snake_case` fields at the boundary |
| Health | `GET /health` on the AI service |

If the AI service is down, AI steps retry as transient failures and other runs are unaffected.

### Design patterns

| Pattern | Used for | Problem it solves |
|---|---|---|
| Strategy and Registry | One executor class per node type | Adding a node type doesn't change the engine |
| Adapter | LLM provider | Swap providers; fake them in tests |
| Repository | Data access | SQL stays in one layer |
| Unit of Work | Transactions A and B | Atomic changes across repositories |
| State Machine | Run transitions | Legal moves live in one place |
| Chain of Responsibility | Pre-step guards: cancel, cap, approval | Each check is separate and testable |
| Dependency Injection | Constructor injection, wired in `api.js` and `worker.js` | Everything can be tested with fakes |

### SOLID

| Principle | How it applies |
|---|---|
| Single responsibility | The template resolver only resolves, the step runner only runs a step, and controllers only translate HTTP |
| Open/closed | A new node type is a new class plus a catalog entry |
| Liskov substitution | All node executors and LLM providers are interchangeable |
| Interface segregation | Small contracts, such as `execute(context)` and `complete(request)` |
| Dependency inversion | The engine receives its dependencies and never constructs them |

### Code rules

- **Readable:** names explain the code. Comments are rare and explain only why. No banner comments, no commented-out code.
- **DRY:** one implementation each of error handling, HTTP calls with timeouts, run creation, status changes, validation, config and secret masking.
- **Simple:** short functions and no speculative abstractions.
- **JavaScript:** ES classes and private `#` fields, with ESLint and Prettier. Python uses Ruff and type hints.
- **Safe:** parameterised SQL, versioned migrations, and secrets only in a gitignored `.env`.
- **README:** only the commands needed to set up, run and verify.

---

## 10. Verification

### Success metrics

**North Star:** runs that finish correctly with zero duplicate side effects.

| Metric | What it shows | Target |
|---|---|---|
| Smoke test | API and run lifecycle match the contract | All checks pass |
| Duplicate side effects after kill-and-resume | Exactly-once execution holds | 0 |
| Prompt-injection payloads that bypass approval | Gates are enforced by the engine | 0 of 2 |
| Malformed AI outputs caught by schema | AI output is validated before use | 100% |
| Runaway workflow | Stops at the step cap | Stops every time |

**Business metrics for a real rollout:** share of workflow runs that finish without manual fixes, and time from approval request to decision.

### Automated tests

| Area | Cases |
|---|---|
| Publish validation | Every error code; loops allowed; all seeds pass |
| Template resolution | Paths, types, loops, unresolvable paths, one-pass, scope |
| Schema enforcement | Valid; repaired; invalid twice; non-JSON; extra fields |
| Idempotency | Same key across retry and resume; new key per loop iteration; none on GET |
| Guardrails | Compromised model can't reach `order_action`; gate; cap; secret masking |
| Recovery | Simulated crash at each point in [Section 4.4](#44-exactly-once-recovery) |

### Demo and explainer video

| # | Step | Shows |
|---|---|---|
| 1 | Start services, open the console | Seeded workflows |
| 2 | Trigger triage with `pay_001` | Workflow trigger, AI node branching, trace |
| 3 | Trigger triage with `pay_inject_001`, then `pay_inject_002` | Prompt-injection handling |
| 4 | Approve one run, reject another | Approval gate |
| 5 | Run `wf_slow_fulfillment`, `kill -9` the worker, restart, run the duplication check | Worker crash and resume |
| 6 | Trigger `wf_runaway` | Step-cap protection |
| 7 | Point the LLM at the mock provider | Malformed AI output caught |
| 8 | Run the smoke test | Contract summary |

---

## 11. Deliverables and plan

| Deliverable | Contents |
|---|---|
| Functional product | Orchestration engine and simple console |
| README | Setup, API documentation, architecture, design decisions, run state machine, exactly-once recovery, known limitations |
| Public GitHub repository | Public link, with the pack in `backend/pack/`. `scripts/` and `data/` stay side by side because the smoke test reads `../data` |
| Seeded demo | Seed workflows and instructions to reproduce the demo with the mock world |
| Verification report | Smoke test output and duplication check result after a live kill-and-resume |
| Explainer video | Steps 2 to 6 of the demo above |

| # | Milestone | Exit check |
|---|---|---|
| 1 | Core platform: data loading, workflow CRUD, validation, snapshots | Validation tests pass |
| 2 | Engine: queue, worker, deterministic nodes, templates, traces, manual trigger | `pay_102` runs end to end |
| 3 | Durability and gates: resume, keys, retries, cap, approvals, webhook | Smoke test and kill drill pass |
| 4 | AI: service, OpenRouter, schema enforcement, guardrails | Injection and malformed-output checks pass |
| 5 | Console and documentation: UI, README, report, video | All of Section 10 passes |
| 6 | Temporal | Section 10 passes again on Temporal |

### Risks

| Risk | Mitigation |
|---|---|
| A crash between a side effect and saving the step could repeat it | Idempotency keys derived from run and step, checked against the mock world's ledger |
| AI returns bad or manipulated output | JSON schema validation, with payloads treated as data, never instructions |
| Approvals skipped by prompt tricks | The engine checks for an approval record before any sensitive node runs |
| Scope is engineering-heavy | Build the must-haves in order and leave Later items for last |
| Demo depends on a live LLM | Record the video once it works; a fake provider still proves the engine logic |

### Known limitations

- Two workers have been tested sharing the queue. Lease loss is covered only by automated tests.
- The run time limit excludes planned delays and approvals, but counts downtime, so a run interrupted for longer than its limit fails when it resumes.
- Each worker runs one step at a time, so a slow AI call delays other runs unless more workers run.
- Approvals don't expire, and traces are kept forever.
- The token budget is checked before each AI step, so the last step can pass it slightly.
- A crash during an AI call repeats the call, and that attempt's tokens aren't recorded. No side effect is involved.
- One approval satisfies every gate for the rest of a run.
- Workflows have no input schema, so a payload missing `customer_email` fails at the notify step, after any earlier refund has run.
- The payload's `customer_email` isn't checked against the order. The approver sees the raw payload so they can catch a mismatch.
- There's one admin account and no roles, so anyone signed in can approve. Scripts use a shared service token.

### Feedback-session questions, answered by the pack

| Question | Answer |
|---|---|
| In-process or separate worker? | Either is accepted. We use a separate process |
| How much does the NL compiler count? | It's the highest-value good-to-have, but it can't make up for missing must-haves |
| Simple console or visual builder? | A simple console is enough |
| Real LLM or mock? | Real for AI demo steps, mock for engine tests. This changes the one-pager's assumption, because `mock_provider.py` returns prose and would fail the triage schema every time |
