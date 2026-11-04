import type { Knex } from "knex";

import { createOnUpdateTrigger } from "../utils";

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE super_admin ADD COLUMN "earlyAccessRequestsEnabled" boolean NOT NULL DEFAULT false;
    CREATE TABLE vaultix_early_access_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email varchar(254) NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
      name varchar(128),
      organization varchar(128),
      "useCase" varchar(1000),
      status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invited','declined')),
      "reviewedByUserId" uuid REFERENCES users(id) ON DELETE SET NULL,
      "reviewedAt" timestamptz,
      "invitedOrgId" uuid REFERENCES organizations(id) ON DELETE SET NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX vaultix_early_access_requests_review ON vaultix_early_access_requests (status, "createdAt" DESC);
  `);
  await createOnUpdateTrigger(knex, "vaultix_early_access_requests");
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE vaultix_early_access_requests IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vaultix_early_access_requests) THEN
        RAISE EXCEPTION 'Early access requests exist; retain this additive migration during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vaultix_early_access_requests;
    ALTER TABLE super_admin DROP COLUMN "earlyAccessRequestsEnabled";
  `);
}
