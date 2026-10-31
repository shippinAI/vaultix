import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE vaultix_totp_replays (
      "factorId" uuid PRIMARY KEY REFERENCES totp_configs(id) ON DELETE CASCADE,
      "lastStep" bigint NOT NULL CHECK ("lastStep" >= 0)
    );
    CREATE TABLE vaultix_identity_reauth_totp (
      "userId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      "schemaVersion" integer NOT NULL DEFAULT 1 CHECK ("schemaVersion" = 1),
      "proofId" uuid NOT NULL UNIQUE,
      "factorId" uuid NOT NULL REFERENCES totp_configs(id) ON DELETE CASCADE,
      "factorDigest" bytea NOT NULL CHECK (octet_length("factorDigest") = 32),
      step bigint NOT NULL CHECK (step >= 0)
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE vaultix_totp_replays, vaultix_identity_reauth_totp IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vaultix_totp_replays) OR EXISTS (SELECT 1 FROM vaultix_identity_reauth_totp) THEN
        RAISE EXCEPTION 'TOTP authentication state exists; retain this additive migration during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vaultix_identity_reauth_totp, vaultix_totp_replays;
  `);
}
