import { Knex } from "knex";

import { TableName } from "../schemas";
import { makeObjectName } from "../table-namespace-names";

const CONSTRAINT_NAME = "internal_certificate_authorities_serialNumber_key";

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable(TableName.InternalCertificateAuthority);
  if (!hasTable) return;

  // createTableLike copied the unique constraint and PostgreSQL named the copy after the table:
  // the inherited name on older stores, the vx_ name on stores created after docs/0119.
  for (const name of [CONSTRAINT_NAME, makeObjectName(TableName.InternalCertificateAuthority, "serialNumber", "key")]) {
    // eslint-disable-next-line no-await-in-loop
    await knex.raw(`ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??`, [TableName.InternalCertificateAuthority, name]);
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable(TableName.InternalCertificateAuthority);
  if (!hasTable) return;

  await knex.raw(
    `ALTER TABLE "${TableName.InternalCertificateAuthority}" ADD CONSTRAINT "${CONSTRAINT_NAME}" UNIQUE ("serialNumber")`
  );
}
