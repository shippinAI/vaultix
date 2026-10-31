import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE auth_token_sessions ADD COLUMN "sessionType" varchar(16) NOT NULL DEFAULT 'browser'
      CHECK ("sessionType" IN ('browser','device-v1'));
    CREATE TABLE vaultix_device_sessions (
      "sessionId" uuid PRIMARY KEY REFERENCES auth_token_sessions(id) ON DELETE CASCADE,
      "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion"=1),
      "clientId" varchar(64) NOT NULL CHECK ("clientId"='vaultix-cli'),
      resource varchar(2048) NOT NULL,
      scope varchar(128) NOT NULL CHECK (scope='vaultix:user'),
      approval jsonb NOT NULL CHECK (jsonb_typeof(approval)='object' AND octet_length(approval::text)<=2048),
      "refreshDigest" bytea NOT NULL CHECK (octet_length("refreshDigest")=32),
      "createdAt" timestamptz NOT NULL,
      "expiresAt" timestamptz NOT NULL CHECK ("expiresAt">"createdAt"),
      CHECK (approval->>'sessionId'="sessionId"::text)
    );
    CREATE INDEX vaultix_device_sessions_expiry ON vaultix_device_sessions ("expiresAt","sessionId");
    CREATE TABLE vaultix_device_session_events (
      id uuid PRIMARY KEY,
      "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion"=1),
      "sessionId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "orgId" uuid NOT NULL,
      action varchar(24) NOT NULL CHECK (action IN ('issued','rotated','reuse','revoked','policy-denied')),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=4096),
      "auditDeliveredAt" timestamptz,
      "notificationDeliveredAt" timestamptz
    );
    CREATE INDEX vaultix_device_session_events_pending ON vaultix_device_session_events ("createdAt",id)
      WHERE "auditDeliveredAt" IS NULL OR "notificationDeliveredAt" IS NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE auth_token_sessions, vaultix_device_sessions, vaultix_device_session_events IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM auth_token_sessions WHERE "sessionType"='device-v1')
        OR EXISTS (SELECT 1 FROM vaultix_device_session_events) THEN
        RAISE EXCEPTION 'Device session or security event state exists; retain this additive migration during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vaultix_device_session_events;
    DROP TABLE vaultix_device_sessions;
    ALTER TABLE auth_token_sessions DROP COLUMN "sessionType";
  `);
}
