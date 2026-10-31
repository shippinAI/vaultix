import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE vaultix_device_session_events
      ADD COLUMN "preparationStatus" varchar(16) NOT NULL DEFAULT 'pending'
        CHECK ("preparationStatus" IN ('pending','preparing','prepared','unresolved','exhausted')),
      ADD COLUMN "preparationSnapshot" jsonb CHECK ("preparationSnapshot" IS NULL OR
        (jsonb_typeof("preparationSnapshot")='object' AND
          COALESCE("preparationSnapshot"->>'version'='1',false) AND octet_length("preparationSnapshot"::text)<=16384)),
      ADD COLUMN "preparationCursor" uuid,
      ADD COLUMN "preparationAttempts" integer NOT NULL DEFAULT 0 CHECK ("preparationAttempts" BETWEEN 0 AND 12),
      ADD COLUMN "preparationNextAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      ADD COLUMN "preparationLease" uuid,
      ADD COLUMN "preparationLeaseUntil" timestamptz,
      ADD COLUMN "preparedAt" timestamptz,
      ADD CONSTRAINT vaultix_device_preparation_lease CHECK
        (("preparationStatus"='preparing' AND "preparationLease" IS NOT NULL AND "preparationLeaseUntil" IS NOT NULL)
          OR ("preparationStatus"<>'preparing' AND "preparationLease" IS NULL AND "preparationLeaseUntil" IS NULL)),
      ADD CONSTRAINT vaultix_device_preparation_complete CHECK
        (("preparationStatus"='prepared')=("preparedAt" IS NOT NULL));
    CREATE INDEX vaultix_device_preparation_ready ON vaultix_device_session_events ("preparationNextAt",id)
      WHERE "preparationStatus" IN ('pending','preparing');

    CREATE TABLE vaultix_device_event_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "eventId" uuid NOT NULL REFERENCES vaultix_device_session_events(id) ON DELETE CASCADE,
      "orgId" uuid NOT NULL,
      destination varchar(16) NOT NULL CHECK (destination IN ('audit','notification','email')),
      "recipientId" uuid NOT NULL,
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND COALESCE(payload->>'version'='1',false)
        AND octet_length(payload::text)<=65536),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "expiresAt" timestamptz NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'pending' CHECK
        (status IN ('pending','processing','delivered','disabled','not-applicable','expired','exhausted','unknown')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
      "nextAttemptAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "leaseToken" uuid,
      "leaseUntil" timestamptz,
      "settledAt" timestamptz,
      outcome jsonb CHECK (outcome IS NULL OR (jsonb_typeof(outcome)='object' AND octet_length(outcome::text)<=1024)),
      UNIQUE ("eventId",destination,"recipientId"),
      CHECK ((status='processing' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
        OR (status<>'processing' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)),
      CHECK ((status IN ('delivered','disabled','not-applicable','expired'))=("settledAt" IS NOT NULL))
    );
    CREATE INDEX vaultix_device_delivery_ready ON vaultix_device_event_deliveries ("nextAttemptAt",id)
      WHERE status IN ('pending','processing');

    CREATE FUNCTION vaultix_guard_device_delivery() RETURNS trigger LANGUAGE plpgsql AS $body$
    DECLARE source_org uuid;
    BEGIN
      IF TG_OP='INSERT' THEN
        SELECT "orgId" INTO source_org FROM vaultix_device_session_events WHERE id=NEW."eventId";
        IF source_org IS NULL OR source_org IS DISTINCT FROM NEW."orgId" THEN
          RAISE EXCEPTION 'Device delivery organization does not match its source';
        END IF;
        IF NEW.destination='audit' AND NEW."recipientId" IS DISTINCT FROM source_org THEN
          RAISE EXCEPTION 'Device audit destination does not match its source organization';
        END IF;
      ELSIF NEW.id IS DISTINCT FROM OLD.id OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
        OR NEW."orgId" IS DISTINCT FROM OLD."orgId" OR NEW.destination IS DISTINCT FROM OLD.destination
        OR NEW."recipientId" IS DISTINCT FROM OLD."recipientId" OR NEW.payload IS DISTINCT FROM OLD.payload
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
        RAISE EXCEPTION 'Prepared device delivery is immutable';
      END IF;
      RETURN NEW;
    END $body$;
    CREATE TRIGGER vaultix_guard_device_delivery BEFORE INSERT OR UPDATE ON vaultix_device_event_deliveries
      FOR EACH ROW EXECUTE FUNCTION vaultix_guard_device_delivery();
    CREATE FUNCTION vaultix_guard_device_preparation() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF OLD."preparationSnapshot" IS NOT NULL AND
        NEW."preparationSnapshot" IS DISTINCT FROM OLD."preparationSnapshot" THEN
        RAISE EXCEPTION 'Device preparation snapshot is immutable';
      END IF;
      RETURN NEW;
    END $body$;
    CREATE TRIGGER vaultix_guard_device_preparation BEFORE UPDATE ON vaultix_device_session_events
      FOR EACH ROW EXECUTE FUNCTION vaultix_guard_device_preparation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE vaultix_device_session_events, vaultix_device_event_deliveries IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vaultix_device_event_deliveries) OR EXISTS
        (SELECT 1 FROM vaultix_device_session_events WHERE "preparationStatus"<>'pending'
          OR "preparationSnapshot" IS NOT NULL OR "preparationAttempts"<>0) THEN
        RAISE EXCEPTION 'Device delivery state exists; retain the additive schema during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vaultix_device_event_deliveries;
    DROP FUNCTION vaultix_guard_device_delivery();
    DROP TRIGGER vaultix_guard_device_preparation ON vaultix_device_session_events;
    DROP FUNCTION vaultix_guard_device_preparation();
    DROP INDEX vaultix_device_preparation_ready;
    ALTER TABLE vaultix_device_session_events
      DROP CONSTRAINT vaultix_device_preparation_lease, DROP CONSTRAINT vaultix_device_preparation_complete,
      DROP COLUMN "preparationStatus", DROP COLUMN "preparationSnapshot", DROP COLUMN "preparationCursor",
      DROP COLUMN "preparationAttempts", DROP COLUMN "preparationNextAt", DROP COLUMN "preparationLease",
      DROP COLUMN "preparationLeaseUntil", DROP COLUMN "preparedAt";
  `);
}
