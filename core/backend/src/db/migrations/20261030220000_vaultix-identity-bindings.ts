import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE vaultix_identity_bindings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      issuer text COLLATE "C" NOT NULL CHECK (octet_length(issuer) BETWEEN 1 AND 2048 AND issuer LIKE 'https://%'),
      subject text COLLATE "C" NOT NULL CHECK (octet_length(subject) BETWEEN 1 AND 255 AND subject !~ '[^ -~]' AND btrim(subject) <> ''),
      "userId" uuid REFERENCES users(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "revokedAt" timestamptz,
      "proofId" uuid NOT NULL,
      "sessionId" uuid NOT NULL,
      UNIQUE (issuer, subject),
      CHECK ("userId" IS NOT NULL OR "revokedAt" IS NOT NULL)
    );
    CREATE INDEX vaultix_identity_bindings_user_idx ON vaultix_identity_bindings ("userId") WHERE "userId" IS NOT NULL;

    CREATE TABLE vaultix_identity_link_challenges (
      "userId" uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      id uuid NOT NULL UNIQUE,
      digest bytea NOT NULL UNIQUE CHECK (octet_length(digest) = 32),
      issuer text COLLATE "C" NOT NULL CHECK (octet_length(issuer) BETWEEN 1 AND 2048),
      "sessionId" uuid NOT NULL REFERENCES auth_token_sessions(id) ON DELETE CASCADE,
      "accessVersion" bigint NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "expiresAt" timestamptz NOT NULL,
      CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + interval '5 minutes')
    );

    CREATE TABLE vaultix_identity_binding_events (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      "bindingId" uuid NOT NULL REFERENCES vaultix_identity_bindings(id),
      "userId" uuid NOT NULL,
      action text NOT NULL CHECK (action IN ('linked', 'revoked', 'relinked', 'user-deleted')),
      "proofId" uuid NOT NULL,
      "sessionId" uuid NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX vaultix_identity_binding_events_binding_idx ON vaultix_identity_binding_events ("bindingId", id);

    CREATE FUNCTION vaultix_guard_identity_binding() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Identity binding history must be retained' USING ERRCODE = '23514';
      END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.issuer IS DISTINCT FROM OLD.issuer OR
         NEW.subject IS DISTINCT FROM OLD.subject OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR
         (NEW."userId" IS DISTINCT FROM OLD."userId" AND NEW."userId" IS NOT NULL) THEN
        RAISE EXCEPTION 'Identity binding ownership is immutable' USING ERRCODE = '23514';
      END IF;
      IF NEW."userId" IS NULL THEN
        NEW."revokedAt" := COALESCE(OLD."revokedAt", clock_timestamp());
        NEW."proofId" := OLD."proofId";
        NEW."sessionId" := OLD."sessionId";
      END IF;
      RETURN NEW;
    END $body$;
    CREATE TRIGGER vaultix_identity_binding_guard BEFORE UPDATE OR DELETE ON vaultix_identity_bindings
      FOR EACH ROW EXECUTE FUNCTION vaultix_guard_identity_binding();

    CREATE FUNCTION vaultix_record_identity_binding() RETURNS trigger LANGUAGE plpgsql AS $body$
    DECLARE action_name text;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        action_name := 'linked';
      ELSIF OLD."userId" IS NOT NULL AND NEW."userId" IS NULL THEN
        action_name := 'user-deleted';
      ELSIF OLD."revokedAt" IS NULL AND NEW."revokedAt" IS NOT NULL THEN
        action_name := 'revoked';
      ELSIF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS NULL THEN
        action_name := 'relinked';
      ELSE
        RETURN NEW;
      END IF;
      INSERT INTO vaultix_identity_binding_events ("bindingId", "userId", action, "proofId", "sessionId")
        VALUES (NEW.id, COALESCE(NEW."userId", OLD."userId"), action_name, NEW."proofId", NEW."sessionId");
      RETURN NEW;
    END $body$;
    CREATE TRIGGER vaultix_identity_binding_history AFTER INSERT OR UPDATE ON vaultix_identity_bindings
      FOR EACH ROW EXECUTE FUNCTION vaultix_record_identity_binding();

    CREATE FUNCTION vaultix_guard_identity_history() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      RAISE EXCEPTION 'Identity binding events are append only' USING ERRCODE = '23514';
    END $body$;
    CREATE TRIGGER vaultix_identity_history_guard BEFORE UPDATE OR DELETE ON vaultix_identity_binding_events
      FOR EACH ROW EXECUTE FUNCTION vaultix_guard_identity_history();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Binary rollback retains identity tombstones. Empty-schema rollback must not race a link.
  await knex.raw(`
    LOCK TABLE vaultix_identity_link_challenges, vaultix_identity_bindings, vaultix_identity_binding_events IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vaultix_identity_bindings) OR
         EXISTS (SELECT 1 FROM vaultix_identity_link_challenges) OR
         EXISTS (SELECT 1 FROM vaultix_identity_binding_events) THEN
        RAISE EXCEPTION 'Identity binding data exists; retain this additive migration during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vaultix_identity_binding_events, vaultix_identity_link_challenges, vaultix_identity_bindings;
    DROP FUNCTION vaultix_record_identity_binding(), vaultix_guard_identity_binding(), vaultix_guard_identity_history();
  `);
}
