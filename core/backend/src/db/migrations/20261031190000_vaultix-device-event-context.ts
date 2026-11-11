import type { Knex } from "knex";

// Capture delivery context at the existing store boundary, including deletes
// made by older session consumers. These hooks make no authentication decisions.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE vaultix_device_sessions ADD COLUMN "sourceContext" jsonb
      CHECK ("sourceContext" IS NULL OR
        (jsonb_typeof("sourceContext")='object' AND "sourceContext"->>'version'='1'
          AND octet_length("sourceContext"::text)<=16384));
    ALTER TABLE vaultix_device_session_events ADD COLUMN "sourceContext" jsonb
      CHECK ("sourceContext" IS NULL OR
        (jsonb_typeof("sourceContext")='object' AND "sourceContext"->>'version'='1'
          AND octet_length("sourceContext"::text)<=16384));
    CREATE INDEX vaultix_device_session_events_session_action
      ON vaultix_device_session_events ("sessionId",action);

    CREATE FUNCTION vaultix_device_source_context(session_id uuid, org_id uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $body$
      SELECT jsonb_build_object(
        'version',1,'basis','session-creation',
        'subject',jsonb_build_object('id',u.id,'username',u.username,'email',u.email,
          'firstName',u."firstName",'lastName',u."lastName"),
        'organization',jsonb_build_object('id',o.id,'name',o.name),
        'sessionOrigin',jsonb_build_object('ip',s.ip,'userAgent',s."userAgent",'createdAt',s."createdAt")
      ) FROM vx_auth_sessions s JOIN vx_auth_users u ON u.id=s."userId"
        JOIN vx_workspace_organizations o ON o.id=org_id WHERE s.id=session_id
    $body$;

    CREATE FUNCTION vaultix_capture_device_session_context() RETURNS trigger LANGUAGE plpgsql AS $body$
    DECLARE subject_id uuid;
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF NEW."sessionId" IS DISTINCT FROM OLD."sessionId" OR NEW.approval IS DISTINCT FROM OLD.approval THEN
          RAISE EXCEPTION 'Device session source identity is immutable';
        END IF;
        IF OLD."sourceContext" IS NOT NULL THEN
          IF NEW."sourceContext" IS DISTINCT FROM OLD."sourceContext" THEN
            RAISE EXCEPTION 'Device session source context is immutable';
          END IF;
          RETURN NEW;
        END IF;
      END IF;
      SELECT "userId" INTO subject_id FROM vx_auth_sessions WHERE id=NEW."sessionId";
      IF subject_id IS NULL OR subject_id::text IS DISTINCT FROM NEW.approval->>'userId' THEN
        RAISE EXCEPTION 'Device session source identity does not match its canonical session';
      END IF;
      NEW."sourceContext" := vaultix_device_source_context(NEW."sessionId",(NEW.approval->>'orgId')::uuid);
      IF TG_OP='INSERT' AND NEW."sourceContext" IS NULL THEN
        RAISE EXCEPTION 'Device session source context is unavailable';
      END IF;
      IF TG_OP='UPDATE' AND NEW."sourceContext" IS NOT NULL THEN
        -- A legacy snapshot is current at capture, never historical evidence.
        NEW."sourceContext" := jsonb_set(NEW."sourceContext",'{basis}','"legacy-capture"');
      END IF;
      RETURN NEW;
    END $body$;
    CREATE TRIGGER vaultix_capture_device_session_context BEFORE INSERT OR UPDATE
      ON vaultix_device_sessions FOR EACH ROW EXECUTE FUNCTION vaultix_capture_device_session_context();

    CREATE FUNCTION vaultix_capture_device_event_context() RETURNS trigger LANGUAGE plpgsql AS $body$
    DECLARE metadata vaultix_device_sessions%ROWTYPE;
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
          OR NEW."sessionId" IS DISTINCT FROM OLD."sessionId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
          OR NEW."orgId" IS DISTINCT FROM OLD."orgId" OR NEW.action IS DISTINCT FROM OLD.action
          OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW.provenance IS DISTINCT FROM OLD.provenance
          OR NEW."sourceContext" IS DISTINCT FROM OLD."sourceContext" THEN
          RAISE EXCEPTION 'Device security event source is immutable';
        END IF;
        RETURN NEW;
      END IF;
      SELECT * INTO metadata FROM vaultix_device_sessions WHERE "sessionId"=NEW."sessionId";
      IF NOT FOUND OR metadata.approval->>'userId' IS DISTINCT FROM NEW."userId"::text
        OR metadata.approval->>'orgId' IS DISTINCT FROM NEW."orgId"::text THEN
        RAISE EXCEPTION 'Device security event identity does not match its session';
      END IF;
      -- Never trust caller-supplied context. Null marks unresolved legacy state.
      NEW."sourceContext" := metadata."sourceContext";
      RETURN NEW;
    END $body$;
    CREATE TRIGGER vaultix_capture_device_event_context BEFORE INSERT OR UPDATE
      ON vaultix_device_session_events FOR EACH ROW EXECUTE FUNCTION vaultix_capture_device_event_context();

    CREATE FUNCTION vaultix_record_device_session_delete() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      -- Native revoke/reuse/policy denial already records its precise reason in
      -- this transaction. Canonical DAL and account-cascade deletes need a fact.
      IF NOT EXISTS (SELECT 1 FROM vaultix_device_session_events
        WHERE "sessionId"=OLD."sessionId" AND action IN ('revoked','reuse','policy-denied')) THEN
        INSERT INTO vaultix_device_session_events(id,"sessionId","userId","orgId",action,provenance)
        VALUES(gen_random_uuid(),OLD."sessionId",(OLD.approval->>'userId')::uuid,
          (OLD.approval->>'orgId')::uuid,'revoked',jsonb_build_object(
            'authMethod',OLD.approval->>'authMethod',
            'mfaVerified',COALESCE(OLD.approval->'mfaVerified','false'::jsonb),
            'mfaMethod',COALESCE(OLD.approval->>'mfaMethod',''),
            'ssoBypass',COALESCE(OLD.approval->'ssoBypass','false'::jsonb),
            'rootOrgId',OLD.approval->>'rootOrgId','clientId',OLD."clientId",
            'termination','canonical-delete','initiator','unattributed'));
      END IF;
      RETURN OLD;
    END $body$;
    CREATE TRIGGER vaultix_record_device_session_delete BEFORE DELETE ON vaultix_device_sessions
      FOR EACH ROW EXECUTE FUNCTION vaultix_record_device_session_delete();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE vx_auth_sessions, vaultix_device_sessions, vaultix_device_session_events IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vaultix_device_sessions)
        OR EXISTS (SELECT 1 FROM vaultix_device_session_events) THEN
        RAISE EXCEPTION 'Device source state exists; retain the additive schema during binary rollback';
      END IF;
    END $body$;
    DROP TRIGGER vaultix_record_device_session_delete ON vaultix_device_sessions;
    DROP TRIGGER vaultix_capture_device_event_context ON vaultix_device_session_events;
    DROP TRIGGER vaultix_capture_device_session_context ON vaultix_device_sessions;
    DROP FUNCTION vaultix_record_device_session_delete();
    DROP FUNCTION vaultix_capture_device_event_context();
    DROP FUNCTION vaultix_capture_device_session_context();
    DROP FUNCTION vaultix_device_source_context(uuid,uuid);
    DROP INDEX vaultix_device_session_events_session_action;
    ALTER TABLE vaultix_device_session_events DROP COLUMN "sourceContext";
    ALTER TABLE vaultix_device_sessions DROP COLUMN "sourceContext";
  `);
}
