CREATE TABLE workflows (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  draft_definition     JSONB NOT NULL,
  published_definition JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  run_id              TEXT PRIMARY KEY,
  workflow_id         TEXT NOT NULL REFERENCES workflows (id),
  definition_snapshot JSONB NOT NULL,
  status              TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled')
  ),
  trigger_type        TEXT NOT NULL,
  input               JSONB NOT NULL,
  current_node_id     TEXT,
  steps_executed      INTEGER NOT NULL DEFAULT 0,
  ai_tokens_used      INTEGER NOT NULL DEFAULT 0,
  error               JSONB,
  cancel_requested    BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ
);
CREATE INDEX runs_workflow_idx ON runs (workflow_id, created_at DESC);
CREATE INDEX runs_created_idx ON runs (created_at DESC);

CREATE TABLE steps (
  run_id            TEXT NOT NULL REFERENCES runs (run_id),
  sequence          INTEGER NOT NULL,
  node_id           TEXT NOT NULL,
  node_type         TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (
    status IN ('running', 'waiting', 'succeeded', 'failed', 'cancelled')
  ),
  attempt           INTEGER NOT NULL DEFAULT 0,
  resolved_input    JSONB,
  output            JSONB,
  attempts_log      JSONB NOT NULL DEFAULT '[]',
  tokens_prompt     INTEGER,
  tokens_completion INTEGER,
  guardrail_flags   JSONB NOT NULL DEFAULT '[]',
  idempotency_key   TEXT,
  resume_at         TIMESTAMPTZ,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms       INTEGER,
  PRIMARY KEY (run_id, sequence)
);

CREATE TABLE approvals (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs (run_id),
  node_id    TEXT NOT NULL,
  sequence   INTEGER NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'closed')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, node_id, sequence)
);
CREATE INDEX approvals_status_idx ON approvals (status, created_at);

CREATE TABLE queue_jobs (
  id           BIGSERIAL PRIMARY KEY,
  run_id       TEXT NOT NULL UNIQUE REFERENCES runs (run_id),
  run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by    TEXT,
  locked_until TIMESTAMPTZ
);
CREATE INDEX queue_jobs_ready_idx ON queue_jobs (run_after);
