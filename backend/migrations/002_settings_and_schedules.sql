ALTER TABLE workflows ADD COLUMN webhook_secret_hash TEXT;

UPDATE workflows
SET webhook_secret_hash = encode(
  sha256(convert_to(COALESCE(published_definition #>> '{trigger,secret}', draft_definition #>> '{trigger,secret}'), 'UTF8')),
  'hex'
)
WHERE COALESCE(published_definition #>> '{trigger,secret}', draft_definition #>> '{trigger,secret}') IS NOT NULL;

UPDATE workflows
SET draft_definition = draft_definition #- '{trigger,secret}',
    published_definition = published_definition #- '{trigger,secret}';

CREATE TABLE schedules (
  workflow_id  TEXT PRIMARY KEY REFERENCES workflows (id),
  cron         TEXT NOT NULL,
  input        JSONB NOT NULL,
  next_fire_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX schedules_due_idx ON schedules (next_fire_at);
