import type { Knex } from "knex";

import { createOnUpdateTrigger } from "../utils";

// The in-app assistant's providers and personas (docs/0123, docs/0124). The Go service owns these
// rows. Rows without an organization belong to the whole instance and are managed by its
// administrators; the organization column lets an organization bring its own later. Provider
// credentials are encrypted under the instance root key.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE vx_ai_providers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "orgId" uuid REFERENCES vx_workspace_organizations(id) ON DELETE CASCADE,
      kind varchar(32) NOT NULL CHECK (kind IN ('anthropic','bedrock','vertex','openai','openai-compatible')),
      name varchar(64) NOT NULL,
      model varchar(128) NOT NULL,
      "baseUrl" varchar(512) NOT NULL DEFAULT '',
      region varchar(32) NOT NULL DEFAULT '',
      "cloudProject" varchar(30) NOT NULL DEFAULT '',
      "encryptedCredential" bytea,
      active boolean NOT NULL DEFAULT false,
      "lastTestedAt" timestamptz,
      "lastTestOutcome" varchar(16) CHECK ("lastTestOutcome" IN ('passed','failed')),
      "lastTestMessage" varchar(300),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX vx_ai_providers_instance_active ON vx_ai_providers (active) WHERE active AND "orgId" IS NULL;
    CREATE UNIQUE INDEX vx_ai_providers_org_active ON vx_ai_providers ("orgId") WHERE active AND "orgId" IS NOT NULL;
    CREATE INDEX vx_ai_providers_org ON vx_ai_providers ("orgId") WHERE "orgId" IS NOT NULL;

    CREATE TABLE vx_ai_personas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "orgId" uuid REFERENCES vx_workspace_organizations(id) ON DELETE CASCADE,
      slug varchar(32) NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{1,31}$'),
      name varchar(64) NOT NULL,
      role varchar(16) NOT NULL CHECK (role IN ('router','specialist','guard')),
      tier varchar(16) NOT NULL CHECK (tier IN ('fast','standard','deep')),
      description varchar(300) NOT NULL DEFAULT '',
      instructions text NOT NULL CHECK (length(instructions) BETWEEN 1 AND 16384),
      domains text[] NOT NULL CHECK (cardinality(domains) BETWEEN 1 AND 8),
      "providerId" uuid REFERENCES vx_ai_providers(id) ON DELETE SET NULL,
      enabled boolean NOT NULL DEFAULT true,
      "builtIn" boolean NOT NULL DEFAULT false,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX vx_ai_personas_instance_slug ON vx_ai_personas (slug) WHERE "orgId" IS NULL;
    CREATE UNIQUE INDEX vx_ai_personas_org_slug ON vx_ai_personas ("orgId", slug) WHERE "orgId" IS NOT NULL;
    CREATE INDEX vx_ai_personas_provider ON vx_ai_personas ("providerId") WHERE "providerId" IS NOT NULL;
  `);
  await createOnUpdateTrigger(knex, "vx_ai_providers");
  await createOnUpdateTrigger(knex, "vx_ai_personas");
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE vx_ai_personas, vx_ai_providers IN ACCESS EXCLUSIVE MODE;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vx_ai_providers) OR EXISTS (SELECT 1 FROM vx_ai_personas) THEN
        RAISE EXCEPTION 'AI providers or personas exist; retain this additive migration during binary rollback';
      END IF;
    END $body$;
    DROP TABLE vx_ai_personas;
    DROP TABLE vx_ai_providers;
  `);
}
