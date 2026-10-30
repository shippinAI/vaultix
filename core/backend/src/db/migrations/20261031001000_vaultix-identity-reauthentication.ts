import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE vaultix_identity_reauth_attempts (
      "userId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      "windowStartedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      attempts integer NOT NULL CHECK (attempts BETWEEN 1 AND 5)
    );
    CREATE TABLE vaultix_identity_reauth_proofs (
      "userId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      id uuid NOT NULL UNIQUE,
      "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion" = 1),
      digest bytea NOT NULL UNIQUE CHECK (octet_length(digest) = 32),
      issuer text COLLATE "C" NOT NULL CHECK (octet_length(issuer) BETWEEN 1 AND 2048 AND issuer LIKE 'https://%'),
      action text NOT NULL CHECK (action IN ('link', 'revoke')),
      "bindingId" uuid REFERENCES vaultix_identity_bindings(id),
      "sessionId" uuid NOT NULL REFERENCES auth_token_sessions(id) ON DELETE CASCADE,
      "accessVersion" bigint NOT NULL CHECK ("accessVersion" >= 0),
      "orgId" uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      "policyDigest" bytea NOT NULL CHECK (octet_length("policyDigest") = 32),
      "authenticatedAt" timestamptz NOT NULL,
      "consumedAt" timestamptz,
      "expiresAt" timestamptz NOT NULL,
      CHECK ((action = 'link' AND "bindingId" IS NULL) OR (action = 'revoke' AND "bindingId" IS NOT NULL)),
      CHECK ("expiresAt" > "authenticatedAt" AND "expiresAt" <= "authenticatedAt" + interval '5 minutes')
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Binary rollback retains proof consumption and attempt admission state.
  await knex.raw(`
    LOCK TABLE vaultix_identity_reauth_attempts, vaultix_identity_reauth_proofs IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vaultix_identity_reauth_attempts) OR
         EXISTS (SELECT 1 FROM vaultix_identity_reauth_proofs) THEN
        RAISE EXCEPTION 'Identity reauthentication state exists; retain this additive migration during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vaultix_identity_reauth_proofs, vaultix_identity_reauth_attempts;
  `);
}
