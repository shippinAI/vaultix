import type { Knex } from "knex";

import { createOnUpdateTrigger } from "../utils";

// Per-tier models for each AI provider, a model override for each persona, and the assistant's
// memories (docs/0124). The Go service owns these rows. A memory without a person belongs to the
// whole instance and is written by its administrators; one with a person is that person's own.
// Memories never hold secret values; the service refuses text shaped like one.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE vx_ai_providers
      ADD COLUMN "fastModel" varchar(128) NOT NULL DEFAULT '',
      ADD COLUMN "deepModel" varchar(128) NOT NULL DEFAULT '';
    ALTER TABLE vx_ai_personas
      ADD COLUMN model varchar(128) NOT NULL DEFAULT '';

    CREATE TABLE vx_ai_memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "orgId" uuid REFERENCES vx_workspace_organizations(id) ON DELETE CASCADE,
      "userId" uuid REFERENCES vx_auth_users(id) ON DELETE CASCADE,
      content text NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
      persona varchar(32) NOT NULL DEFAULT '' CHECK (persona = '' OR persona ~ '^[a-z][a-z0-9-]{1,31}$'),
      source varchar(16) NOT NULL DEFAULT 'person' CHECK (source IN ('person','assistant')),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX vx_ai_memories_user ON vx_ai_memories ("userId") WHERE "userId" IS NOT NULL;
    CREATE INDEX vx_ai_memories_org ON vx_ai_memories ("orgId") WHERE "orgId" IS NOT NULL;
  `);
  await createOnUpdateTrigger(knex, "vx_ai_memories");
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE vx_ai_memories, vx_ai_personas, vx_ai_providers IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vx_ai_memories)
        OR EXISTS (SELECT 1 FROM vx_ai_providers WHERE "fastModel" <> '' OR "deepModel" <> '')
        OR EXISTS (SELECT 1 FROM vx_ai_personas WHERE model <> '') THEN
        RAISE EXCEPTION 'AI memories or tier models exist; retain this additive migration during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vx_ai_memories;
    ALTER TABLE vx_ai_personas DROP COLUMN model;
    ALTER TABLE vx_ai_providers DROP COLUMN "fastModel", DROP COLUMN "deepModel";
  `);
}
