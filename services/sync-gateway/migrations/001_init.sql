CREATE TABLE IF NOT EXISTS sync_orgs (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_members (
  org_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, member_id)
);

CREATE TABLE IF NOT EXISTS sync_snapshots (
  org_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  encrypted_file TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (org_id, vault_id)
);

CREATE TABLE IF NOT EXISTS sync_audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_members_by_member ON sync_members(member_id);
CREATE INDEX IF NOT EXISTS sync_snapshots_by_org_updated ON sync_snapshots(org_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sync_audit_by_org_created ON sync_audit_events(org_id, created_at DESC);
