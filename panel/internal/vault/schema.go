package vault

// Schema is the Vaultix-owned store. Every table is vaultix_*. This is not
// the leftover dump under leftover/schema-dump.
const Schema = `
CREATE TABLE IF NOT EXISTS vaultix_boxes (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS vaultix_boxes_tenant_idx ON vaultix_boxes (tenant_id);

CREATE TABLE IF NOT EXISTS vaultix_secrets (
  id text PRIMARY KEY,
  box_id text NOT NULL REFERENCES vaultix_boxes(id) ON DELETE CASCADE,
  env text NOT NULL,
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (box_id, env, name)
);
CREATE INDEX IF NOT EXISTS vaultix_secrets_box_env_idx ON vaultix_secrets (box_id, env);

CREATE TABLE IF NOT EXISTS vaultix_secret_versions (
  id text PRIMARY KEY,
  secret_id text NOT NULL REFERENCES vaultix_secrets(id) ON DELETE CASCADE,
  version int NOT NULL,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (secret_id, version)
);

CREATE TABLE IF NOT EXISTS vaultix_injects (
  id text PRIMARY KEY,
  handle_hash text NOT NULL UNIQUE,
  box_id text NOT NULL REFERENCES vaultix_boxes(id) ON DELETE CASCADE,
  env text NOT NULL,
  name text NOT NULL,
  created_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS vaultix_injects_expiry_idx ON vaultix_injects (expires_at);

CREATE TABLE IF NOT EXISTS vaultix_audit (
  id text PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  box_id text,
  env text,
  secret_name text,
  ok boolean NOT NULL,
  detail text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vaultix_audit_actor_idx ON vaultix_audit (actor, at);
`
