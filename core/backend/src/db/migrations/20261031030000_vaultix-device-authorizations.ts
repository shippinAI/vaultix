import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE vaultix_device_authorizations (
      id uuid PRIMARY KEY,
      "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion" = 1),
      "deviceDigest" bytea NOT NULL UNIQUE CHECK (octet_length("deviceDigest") = 32),
      "userCodeDigest" bytea NOT NULL UNIQUE CHECK (octet_length("userCodeDigest") = 32),
      "clientId" varchar(64) NOT NULL,
      resource varchar(2048) NOT NULL,
      scope varchar(128) NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','consumed')),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "expiresAt" timestamptz NOT NULL,
      "nextPollAt" timestamptz NOT NULL,
      "intervalSeconds" integer NOT NULL DEFAULT 5 CHECK ("intervalSeconds" BETWEEN 5 AND 60),
      "userId" uuid REFERENCES users(id) ON DELETE CASCADE,
      "sessionId" uuid REFERENCES auth_token_sessions(id) ON DELETE CASCADE,
      approval jsonb,
      CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '10 minutes'),
      CHECK (approval IS NULL OR (jsonb_typeof(approval) = 'object' AND octet_length(approval::text) <= 2048)),
      CHECK ((status IN ('pending','denied') AND approval IS NULL AND "userId" IS NULL AND "sessionId" IS NULL)
        OR (status IN ('approved','consumed') AND approval IS NOT NULL AND "userId" IS NOT NULL AND "sessionId" IS NOT NULL))
    );
    CREATE INDEX vaultix_device_authorizations_expiry ON vaultix_device_authorizations ("expiresAt",id);
    CREATE INDEX vaultix_device_authorizations_user ON vaultix_device_authorizations ("userId") WHERE "userId" IS NOT NULL;
    CREATE INDEX vaultix_device_authorizations_session ON vaultix_device_authorizations ("sessionId") WHERE "sessionId" IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE vaultix_device_authorizations IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vaultix_device_authorizations) THEN
        RAISE EXCEPTION 'Device authorization state exists; retain this additive migration during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vaultix_device_authorizations;
  `);
}
